import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { Firestore } from 'firebase-admin/firestore';
import { withHeartbeat, configReadFailedVerdict } from './lib/heartbeat';
import { readJobGate, HOT_WINDOW_LOOKBACK_MS } from './nflSchedule';
import { scoreNFLWeekInternal } from './nflPools';
import { isWeekComplete } from './lib/weekCompletion';
import { isSimPool } from './nflFinalize';
import {
  isTerminalPool,
  isRetiredPool,
  nextWithheldLockAt,
  computeWeekFingerprint,
  autoScoreHeartbeat,
  rotateForRun,
  type AutoScoreResult,
} from './lib/autoScoreDecisions';
import { readEntryRevisionSum } from './lib/entryRevision';
import {
  readRescoreQueue,
  groupBySlate,
  ackRescoreEvents,
  rescoreEventDoc,
  survivorAllowedForGroup,
  slateKeyOf,
  RESCORE_QUEUE,
  type RescoreReason,
} from './lib/rescoreQueue';
import type { NFLGame } from './nflPoolTypes';

/**
 * nflAutoScoreJob — the LIVE tier of real-time scoring (PLAN-REALTIME-SCORING §5).
 *
 * Every 10 minutes it finds the NFL slates currently in play, scores every
 * non-terminal pool on them through `scoreNFLWeekInternal`, and publishes live
 * standings. Mid-week passes run `provisional`, which withholds finalization
 * markers, the weekly recap and any result whose pick window is still open.
 *
 * SAFETY (Rule 1, mmp-change-control): kill-switch
 * `system/config.nflAutoScore.enabled === true` required (default OFF,
 * fail-safe on a config read error); dry-run by default
 * (`nflAutoScore.dryRun !== false`), and a dry run writes NOTHING — including
 * the fingerprint, which is the subtle one: persisting it on a dry run would
 * leave every pool "already current" so the first LIVE run skips them all and
 * never scores anything.
 *
 * CONCURRENCY (PR-B′): every pass runs under the fenced scoring lease taken
 * inside `scoreNFLWeekInternal`, so this job, the manual "Score Week" button and
 * the finalize sweep cannot overlap on one pool. The skip decision folds in the
 * per-entry revision sum, so a submission committing after the previous pass
 * read entries always forces one more pass.
 *
 * RECONCILIATION (§5b): every run also drains `nfl_rescore_queue`, the durable
 * tier that catches what the 24h window cannot see — an ESPN correction days
 * later, a postponed game first going terminal, a manual locked-spread edit, and
 * a terminal game this job itself withheld behind an unexpired lock override.
 * Queued slates score finalized pools too (and re-finalize), but never retired
 * ones. A dry run reads the queue and acknowledges NOTHING, so flipping to live
 * still finds the work.
 */

/** Pool types this job scores. */
const NFL_POOL_TYPES = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'] as const;

/**
 * Safety cap on pools ATTEMPTED per run, mirroring autoClosePools /
 * nflFinalizeSweepJob. Pools that take the cheap fingerprint skip do not count
 * against it — only pools the scorer is actually invoked on.
 *
 * It counts ATTEMPTS rather than successful scores on purpose. A pool that
 * scores nothing (no entries, or every entry still held pending) deliberately
 * banks no fingerprint, so it is retried on every run — and if those retries were
 * free, a slate with more than a capful of them would consume the whole cap
 * forever and the pools behind them would never be reached. An attempt costs the
 * same reads whether or not it scores anybody, so the cap has to price it.
 */
const MAX_POOLS_PER_RUN = 200;

/** One live week of one (season, seasonType) — the unit this job scores. */
export interface ActiveSlate {
  season: string;
  seasonType: number;
  week: number;
  /** The FULL slate for the week, not just the games inside the active window. */
  games: NFLGame[];
}

/**
 * Which (season, seasonType, week) slates are in play right now?
 *
 * The window mirrors `syncScoresWindow`: games that started within the last
 * `lookbackMs` through the next 2h. The lookback is the 24h
 * `HOT_WINDOW_LOOKBACK_MS`, NOT a short one — a single-game slate (the Hall of
 * Fame opener) or any game running long would otherwise fall out of the window
 * before it finalized and never be scored at all.
 *
 * Each discovered slot is then re-read IN FULL, because provisional-ness and the
 * fingerprint are properties of the whole week: a Thursday game sits inside the
 * window while the following Monday game does not, and judging completeness from
 * the windowed subset would call the week finished on Thursday night.
 */
export async function findActiveSlates(
  db: Firestore,
  now: number,
  lookbackMs: number,
): Promise<ActiveSlate[]> {
  const windowSnap = await db.collection('nfl_games')
    .where('startTime', '>=', now - lookbackMs)
    .where('startTime', '<=', now + 2 * 60 * 60 * 1000)
    .get();

  if (windowSnap.empty) return [];

  const slots = new Map<string, { season: string; seasonType: number; week: number }>();
  for (const doc of windowSnap.docs) {
    const g = doc.data() as NFLGame;
    const season = String(g.season ?? '');
    const seasonType = Number(g.seasonType);
    const week = Number(g.week);
    if (!season || !Number.isFinite(seasonType) || !Number.isFinite(week)) continue;
    slots.set(`${season}_${seasonType}_${week}`, { season, seasonType, week });
  }

  const slates: ActiveSlate[] = [];
  for (const slot of slots.values()) {
    const slateSnap = await db.collection('nfl_games')
      .where('season', '==', slot.season)
      .where('seasonType', '==', slot.seasonType)
      .where('week', '==', slot.week)
      .get();
    const games = slateSnap.docs.map(d => d.data() as NFLGame);
    if (games.length > 0) slates.push({ ...slot, games });
  }
  return slates;
}

/**
 * Pools eligible to be scored for one live slate.
 *
 * Four query shapes are wrong here and each one was arrived at the hard way:
 *  - filtering on `pool.isLocked` excludes exactly the pools to score (it stays
 *    `false` on live pools; NFL locks are per-week/per-game, not pool-wide);
 *  - reusing the finalizer's `scoredThroughWeek` inequality drops every
 *    brand-new pool, because a Firestore inequality omits missing-field docs and
 *    a pool has no such field until its first successful score;
 *  - an equality on `seasonType` drops valid pools, because the create schema
 *    allows it OMITTED and scoring treats missing as regular season via
 *    `Number(pool.seasonType || 2)` — so the query asks for the superset
 *    `(type, season)` and normalizes in memory;
 *  - filtering on `scoredWeeks.{week}` would drop active pools, since a
 *    provisional pass deliberately never writes that marker. The fingerprint is
 *    the sole decider of whether an active pool needs another pass.
 *
 * Uses the existing `pools(type, season)` composite index — no new index, and
 * therefore no way for this to die with a silent FAILED_PRECONDITION.
 */
export async function findCandidatePools(
  db: Firestore,
  slate: ActiveSlate,
  opts: { includeFinalized?: boolean } = {},
): Promise<Array<{ id: string; pool: any }>> {
  const snap = await db.collection('pools')
    .where('type', 'in', NFL_POOL_TYPES as unknown as string[])
    .where('season', '==', slate.season)
    .get();

  return snap.docs
    .map(d => ({ id: d.id, pool: d.data() as any }))
    .filter(({ pool }) => Number(pool.seasonType || 2) === slate.seasonType)
    // Simulation pools live in the same collections as real ones. The harness
    // owns their scoring (simFinalizePool is the only finalize door) and
    // cleanupSimPool asserts zero residue afterwards, so a scheduled pass
    // writing their entries, standings, recap and audit would both corrupt a
    // run in flight and leave residue the cleanup contract does not expect.
    // maybeFinalizeNFLPool refusing to FINALIZE a sim pool does not prevent any
    // of those writes. nflLockWatchJob and the finalize sweep already filter
    // this way; this job was the odd one out.
    .filter(({ id, pool }) => !isSimPool(pool, id))
    // The queued tier passes `includeFinalized` so a late correction can rescore a
    // pool the scorer already finalized — `scoreNFLWeekInternal` re-finalizes at
    // the end of the same pass. The retirement statuses still apply either way;
    // see `isRetiredPool` for why that split is not symmetric.
    .filter(({ pool }) => (opts.includeFinalized ? !isRetiredPool(pool) : !isTerminalPool(pool)));
}

/**
 * The full slate for a queued (season, seasonType, week). The live tier gets this
 * for free from `findActiveSlates`; a queued slate is outside the window, so it
 * has to be read directly.
 *
 * Same three-equality query `findActiveSlates` already uses per slot, so it rides
 * the same index and cannot introduce a new FAILED_PRECONDITION.
 */
export async function readSlateGames(
  db: Firestore,
  slot: { season: string; seasonType: number; week: number },
): Promise<NFLGame[]> {
  const snap = await db.collection('nfl_games')
    .where('season', '==', slot.season)
    .where('seasonType', '==', slot.seasonType)
    .where('week', '==', slot.week)
    .get();
  return snap.docs.map(d => d.data() as NFLGame);
}



/** Mutable state shared by every slate in one run. */
interface RunContext {
  /** Pools the scorer was actually invoked on, against MAX_POOLS_PER_RUN. */
  attempts: number;
  /** `lockPending` reminders already enqueued this run, keyed slate+instant, so N pools on one slate do not write N copies. */
  remindersSent: Set<string>;
}

interface SlatePassOptions {
  dryRun: boolean;
  now: number;
  /** Queued tier only: rescore pools this job already finalized. */
  includeFinalized: boolean;
  /**
   * The queued group's reasons, or null on the live tier. Survivor eligibility is
   * decided per POOL from these plus the pool's own `scoredWeeks`, so it cannot
   * be precomputed for the slate.
   */
  queuedReasons: Set<RescoreReason> | null;
}

/**
 * Score every eligible pool on one slate. Shared by both candidate sources — the
 * live active window and the queue drain — so the fingerprint skip, the cap, the
 * lease handling and the fingerprint-banking rules cannot drift between them.
 *
 * Returns false if any pool on this slate threw, which is what stops the queued
 * tier from acknowledging an event whose work did not complete.
 */
async function scoreSlateOnce(
  db: Firestore,
  slate: ActiveSlate,
  opts: SlatePassOptions,
  result: AutoScoreResult,
  ctx: RunContext,
): Promise<boolean> {
  const now = opts.now;
  let allOk = true;
  const candidates = rotateForRun(
    await findCandidatePools(db, slate, { includeFinalized: opts.includeFinalized }),
    now,
  );
  for (const { id: poolId, pool } of candidates) {
      // Re-running a Survivor week has no safe automatic repair: it keeps the
      // later strikeWeeks while rewriting eliminatedWeek to the re-run week, after
      // which every later week is skipped and the ledger is wrong. Only a delayed
      // FIRST score of an unscored week goes through; everything else waits for
      // the reset-and-replay sub-PR.
      if (opts.queuedReasons && pool?.type === 'NFL_SURVIVOR'
          && !survivorAllowedForGroup(opts.queuedReasons, pool, slate.week)) {
        result.survivorQueuedDeferred++;
        console.warn(
          `[nflAutoScoreJob] Survivor pool ${poolId} skipped for a queued rescore of ` +
          `${slateKeyOf(slate)} week ${slate.week} — needs the reset-and-replay path.`,
        );
        continue;
      }
      // The entry-revision sum is the term that makes a submission committing
      // after the previous pass's entries read defeat the skip (§7 PR-B′). A
      // `null` means the aggregate could not be read: treat it as "unknown" and
      // score, never as 0 — guessing would reinstate exactly the skip-forever
      // hole the watermark exists to close.
      const entryRevisionSum = await readEntryRevisionSum(db, poolId);
      const fingerprint = entryRevisionSum === null
        ? null
        : computeWeekFingerprint(pool, slate.week, slate.games, now, entryRevisionSum);
      const stored = pool.autoScore?.fingerprintByWeek?.[String(slate.week)];
      if (fingerprint !== null && stored === fingerprint) {
        result.poolsSkipped++;
        continue;
      }

      if (ctx.attempts >= MAX_POOLS_PER_RUN) {
        result.overflow++;
        allOk = false;
        continue;
      }
      ctx.attempts++;

      try {
        const scored = await scoreNFLWeekInternal(db, poolId, slate.week, {
          pool,
          games: slate.games,
          actor: { uid: 'system', role: 'SYSTEM', label: 'Auto Scorer' },
          dryRun: opts.dryRun,
          provisional: !isWeekComplete(pool, slate.week, slate.games, now),
          now,
        });
        // The mutex refused this pool to us — another scorer (the manual button,
        // the finalize sweep, an overrunning previous run) owns it. Nothing was
        // read or written, so it is a skip, not a score and not a failure; the
        // next 10-minute run picks it up.
        if (scored.leaseBusy) {
          result.poolsSkipped++;
          // Nothing was done for this pool, so a queued event covering it has not
          // been served yet — hold the ack rather than dropping the reconciliation
          // on the floor because another scorer happened to hold the lease.
          allOk = false;
          continue;
        }
        result.poolsScored++;

        // A terminal game withheld behind an unexpired lock override is the one
        // case where nothing external will ever make this slate a candidate again
        // once it leaves the 24h window. Leave a durable reminder for the instant
        // the lock closes. Live passes only: a dry run writes nothing, and the
        // reminder is a write.
        //
        // Decided from a POST-PASS re-read, not the candidate snapshot (codex
        // r5). `extendWeekDeadline` can commit between candidate selection and
        // the scorer's lease: the scorer re-reads and correctly withholds the
        // result, but a stale snapshot here sees nothing withheld, so the pass
        // would bank a fingerprint with no reminder behind it and the reveal
        // would fall out of both candidate sources for good. One extra read, and
        // only on a live pass that actually scored.
        const post = opts.dryRun
          ? pool
          : ((await db.collection('pools').doc(poolId).get()).data() ?? pool);
        const withheldAt = opts.dryRun ? null : nextWithheldLockAt(post, slate.week, slate.games, now);
        const reminderKey = withheldAt === null ? null : `${slateKeyOf(slate)}@${withheldAt}`;
        const needsReminder = reminderKey !== null && !ctx.remindersSent.has(reminderKey);

        // The fingerprint is recorded ONLY after a live pass that actually did
        // something. Three separate reasons to withhold it, and each one is a
        // skip-forever bug if you get it wrong:
        //
        // A dry run must not write it: that would both break the
        // dry-run-writes-nothing contract and leave the pool looking current, so
        // the first live run would skip it and never score it at all.
        //
        // A pass whose finalize THREW must not record it. Finalization is
        // best-effort and does not fail the pass, so a season-completing pass
        // could otherwise bank its fingerprint, take the skip path on every later
        // poll, and leave the pool unfinalized forever — the backstop sweep is
        // disabled by default. Declining to record it retries the idempotent
        // finalize next pass.
        //
        // A pass that scored NOTHING must not record it either. The pool may have
        // had no entries at all (the scorer returns before it can finalize, so
        // finalization never even runs), or every entry may still be held pending
        // by the provisional gates. In both cases the games can already be
        // terminal, so nothing else will ever move the hash — an entry submitted
        // afterwards would be skipped forever. Nothing was written, so there is
        // nothing to remember; retrying costs one entries read per poll.
        //
        // Nor may a pass whose fingerprint is `null` (the entry-revision
        // aggregate was unreadable): there is no hash to bank.
        //
        // And the fingerprint is written in the SAME BATCH as any `lockPending`
        // reminder (codex r1/r2). Two separate writes have a losing interleaving:
        // the fingerprint banks, the reminder write fails, every later poll takes
        // the skip path, and once the slate leaves the 24h window there is no
        // queue event either — so the withheld result is never revealed by
        // anything. Batched, either both land or neither does and the pool is
        // simply retried.
        const scoredAny = scored.pickemScored + scored.survivorScored + scored.marginScored > 0;
        const bankFingerprint = !opts.dryRun && fingerprint !== null && !scored.finalizeFailed && scoredAny;
        if (bankFingerprint || needsReminder) {
          const batch = db.batch();
          if (bankFingerprint) {
            batch.update(db.collection('pools').doc(poolId), {
              [`autoScore.fingerprintByWeek.${slate.week}`]: fingerprint,
              'autoScore.lastRunAt': admin.firestore.FieldValue.serverTimestamp(),
            });
          }
          if (needsReminder) {
            batch.set(db.collection(RESCORE_QUEUE).doc(), rescoreEventDoc({
              season: slate.season,
              seasonType: slate.seasonType,
              week: slate.week,
              reason: 'lockPending',
              enqueuedAt: now,
              notBefore: withheldAt!,
            }));
          }
          try {
            await batch.commit();
            // Only after it is durable — otherwise a failure here would suppress
            // the retry by the next pool on the same slate in this very run.
            if (needsReminder) ctx.remindersSent.add(reminderKey!);
          } catch (e) {
            allOk = false;
            console.error(`[nflAutoScoreJob] fingerprint/reminder commit failed for pool ${poolId} week ${slate.week}:`, e);
          }
        }

        // Work the queue must not consider served (codex r1/P1). Finalization is
        // best-effort inside the scorer and does not fail the pass, but for an
        // out-of-window slate the queue event is the ONLY thing that will bring
        // the pool back — acknowledging it would strand `finalizedAt` and the
        // season-history projection stale forever.
        if (scored.finalizeFailed) allOk = false;
      } catch (e) {
        result.poolsFailed++;
        allOk = false;
        console.error(`[nflAutoScoreJob] scoring failed for pool ${poolId} week ${slate.week}:`, e);
      }
  }
  return allOk;
}

/**
 * One pass of the auto-scorer. Extracted from the scheduled wrapper so the whole
 * write path is testable without a scheduler, and so the caller owns the gate.
 *
 * TWO candidate sources, in order: the live active window, then the queue drain.
 * A slate can legitimately appear in both (a correction landing on a slate still
 * inside the window); the fingerprint skip makes the second visit cost one
 * entries read, and processing it anyway is what lets the event be acknowledged.
 */
export async function autoScoreOnce(
  db: Firestore,
  now: number,
  opts: { dryRun: boolean; lookbackMs?: number },
): Promise<AutoScoreResult> {
  const result: AutoScoreResult = {
    activeSlates: 0, poolsScored: 0, poolsSkipped: 0, overflow: 0, poolsFailed: 0,
    queuedEvents: 0, queuedSlates: 0, queuedDeferred: 0, queuedAcked: 0,
    survivorQueuedDeferred: 0,
  };
  const ctx: RunContext = { attempts: 0, remindersSent: new Set() };

  const slates = await findActiveSlates(db, now, opts.lookbackMs ?? HOT_WINDOW_LOOKBACK_MS);
  result.activeSlates = slates.length;
  for (const slate of slates) {
    await scoreSlateOnce(
      db, slate,
      { dryRun: opts.dryRun, now, includeFinalized: false, queuedReasons: null },
      result, ctx,
    );
  }

  await drainRescoreQueue(db, now, opts.dryRun, result, ctx);
  return result;
}

/**
 * The reconciliation tier (§5b).
 *
 * ACKNOWLEDGEMENT RULES, both of which are skip-forever bugs if you get them
 * wrong:
 *  - a DRY RUN acknowledges nothing (codex r30). During the watching period a
 *    queued event is often the ONLY candidate for an out-of-window slate; clearing
 *    it on a dry run would leave the live flip with no queue item and no active
 *    slate, so the stale result would never be applied at all.
 *  - a live drain acknowledges a slate only if every pool on it completed. A throw,
 *    a lease held by another scorer, or the per-run cap all leave the work unserved,
 *    and nothing else outside the window would ever retry it.
 * Events are deleted by the exact ids that were read, so an enqueue landing
 * mid-drain is untouched and drains next run.
 */
async function drainRescoreQueue(
  db: Firestore,
  now: number,
  dryRun: boolean,
  result: AutoScoreResult,
  ctx: RunContext,
): Promise<void> {
  const { events, deferred, malformed } = await readRescoreQueue(db, now);
  result.queuedDeferred = deferred;
  result.queuedEvents = events.length;

  const groups = groupBySlate(events);
  result.queuedSlates = groups.length;

  for (const group of groups) {
    const games = await readSlateGames(db, group);
    // A queued slate with no games in `nfl_games` cannot be scored and never will
    // be — acknowledge it rather than draining the same dead event every 10 min.
    if (games.length === 0) {
      console.warn(`[nflAutoScoreJob] queued slate ${slateKeyOf(group)} has no games; dropping ${group.ids.length} event(s).`);
      if (!dryRun) { await ackRescoreEvents(db, group.ids); result.queuedAcked += group.ids.length; }
      continue;
    }

    const allOk = await scoreSlateOnce(
      db,
      { season: group.season, seasonType: group.seasonType, week: group.week, games },
      { dryRun, now, includeFinalized: true, queuedReasons: group.reasons },
      result, ctx,
    );

    if (!dryRun && allOk) {
      await ackRescoreEvents(db, group.ids);
      result.queuedAcked += group.ids.length;
    }
  }

  if (!dryRun && malformed.length > 0) {
    console.warn(`[nflAutoScoreJob] dropping ${malformed.length} unparseable rescore event(s).`);
    await ackRescoreEvents(db, malformed);
    result.queuedAcked += malformed.length;
  }
}

export const nflAutoScoreJob = onSchedule(
  // timeoutSeconds/memory mirror nflFinalizeSweepJob: a full cap of pools is far
  // more than the platform's 60s default allows, and a run that dies part-way
  // would report a throw rather than an honest overflow. 540s also stays inside
  // the 10-minute cadence, so two runs cannot overlap. A run that does exhaust
  // the budget is self-healing — fingerprints are written per pool as it goes,
  // so the next run resumes rather than restarting.
  { schedule: '*/10 * * * *', timeZone: 'America/New_York', timeoutSeconds: 540, memory: '512MiB' },
  withHeartbeat('nflAutoScoreJob', async () => {
    const db = admin.firestore();

    let gate = { enabled: false, dryRun: true };
    let configError: unknown = null;
    try {
      const cfg = (await db.doc('system/config').get()).data()?.nflAutoScore as
        | { enabled?: boolean; dryRun?: boolean }
        | undefined;
      gate = readJobGate(cfg);
    } catch (e) {
      configError = e ?? new Error('unknown config read error');
    }
    if (configError) return configReadFailedVerdict('nflAutoScoreJob', configError);
    if (!gate.enabled) {
      console.log('[nflAutoScoreJob] disabled (system/config.nflAutoScore.enabled !== true); nothing to do.');
      return { detail: { enabled: false } };
    }

    const result = await autoScoreOnce(db, Date.now(), { dryRun: gate.dryRun });
    console.log(
      `[nflAutoScoreJob] ${result.activeSlates} active slate(s): ${result.poolsScored} pool(s) ${gate.dryRun ? 'would be ' : ''}scored, ` +
      `${result.poolsSkipped} skipped, ${result.overflow} deferred, ${result.poolsFailed} failed.`,
    );
    return autoScoreHeartbeat(result, gate.dryRun);
  }),
);
