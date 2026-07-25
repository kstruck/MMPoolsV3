import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { Firestore } from 'firebase-admin/firestore';
import { withHeartbeat, configReadFailedVerdict } from './lib/heartbeat';
import { readJobGate, HOT_WINDOW_LOOKBACK_MS } from './nflSchedule';
import { scoreNFLWeekInternal } from './nflPools';
import { isWeekComplete } from './lib/weekCompletion';
import {
  isTerminalPool,
  computeWeekFingerprint,
  autoScoreHeartbeat,
  type AutoScoreResult,
} from './lib/autoScoreDecisions';
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
 * OUT OF SCOPE, and an arming prerequisite rather than a gap in this job:
 *  - the `nfl_rescore_queue` durable tier (§5b) that catches ESPN corrections
 *    and finals landing beyond the 24h window;
 *  - the per-entry submission revision watermark (§7 PR-B′), without which a
 *    submission committing after the scorer reads entries can be skipped by an
 *    unchanged fingerprint.
 * Both are only reachable once the job is armed, and §7 requires them before
 * arming — the job ships inert.
 */

/** Pool types this job scores. */
const NFL_POOL_TYPES = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'] as const;

/**
 * Safety cap on pools SCORED per run, mirroring autoClosePools /
 * nflFinalizeSweepJob. Counting only scored pools (not skipped ones) is what
 * makes overflow drain: a scored pool records its fingerprint and takes the
 * cheap skip path next run, so the pools deferred by the cap are the ones that
 * get served 10 minutes later.
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
): Promise<Array<{ id: string; pool: any }>> {
  const snap = await db.collection('pools')
    .where('type', 'in', NFL_POOL_TYPES as unknown as string[])
    .where('season', '==', slate.season)
    .get();

  return snap.docs
    .map(d => ({ id: d.id, pool: d.data() as any }))
    .filter(({ pool }) => Number(pool.seasonType || 2) === slate.seasonType)
    .filter(({ pool }) => !isTerminalPool(pool));
}

/**
 * One pass of the auto-scorer. Extracted from the scheduled wrapper so the whole
 * write path is testable without a scheduler, and so the caller owns the gate.
 */
export async function autoScoreOnce(
  db: Firestore,
  now: number,
  opts: { dryRun: boolean; lookbackMs?: number },
): Promise<AutoScoreResult> {
  const result: AutoScoreResult = {
    activeSlates: 0, poolsScored: 0, poolsSkipped: 0, overflow: 0, poolsFailed: 0,
  };

  const slates = await findActiveSlates(db, now, opts.lookbackMs ?? HOT_WINDOW_LOOKBACK_MS);
  result.activeSlates = slates.length;
  if (slates.length === 0) return result;

  for (const slate of slates) {
    for (const { id: poolId, pool } of await findCandidatePools(db, slate)) {
      const fingerprint = computeWeekFingerprint(pool, slate.week, slate.games, now);
      const stored = pool.autoScore?.fingerprintByWeek?.[String(slate.week)];
      if (stored === fingerprint) {
        result.poolsSkipped++;
        continue;
      }

      if (result.poolsScored >= MAX_POOLS_PER_RUN) {
        result.overflow++;
        continue;
      }

      try {
        const scored = await scoreNFLWeekInternal(db, poolId, slate.week, {
          pool,
          games: slate.games,
          actor: { uid: 'system', role: 'SYSTEM', label: 'Auto Scorer' },
          dryRun: opts.dryRun,
          provisional: !isWeekComplete(pool, slate.week, slate.games, now),
          now,
        });
        result.poolsScored++;

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
        const scoredAny = scored.pickemScored + scored.survivorScored + scored.marginScored > 0;
        if (!opts.dryRun && !scored.finalizeFailed && scoredAny) {
          await db.collection('pools').doc(poolId).update({
            [`autoScore.fingerprintByWeek.${slate.week}`]: fingerprint,
            'autoScore.lastRunAt': admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (e) {
        result.poolsFailed++;
        console.error(`[nflAutoScoreJob] scoring failed for pool ${poolId} week ${slate.week}:`, e);
      }
    }
  }

  return result;
}

export const nflAutoScoreJob = onSchedule(
  { schedule: '*/10 * * * *', timeZone: 'America/New_York' },
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
