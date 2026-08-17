import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import { NFL_SEASON_TYPES } from "./shared/poolTypes";
import { isSimPool } from "./shared/testPool";
import { sortMarginLeaderboard } from "./nflScoringEngine";
import { recomputeUserProfile } from "./userProfile";
import { writeAdminAudit } from "./lib/adminAudit";
import type { NFLPickemEntry, SurvivorEntry, MarginEntry } from "./nflPoolTypes";
import { withHeartbeat, configReadFailedVerdict } from "./lib/heartbeat";
import { fencedWrite, withScoringLease, type ScoringFence } from "./lib/scoringLease";
import { isVoidedPool } from "./lib/autoScoreDecisions";
import { isTerminalGame } from "./lib/weekCompletion";
import { computeSeasonPrizeSnapshot, priceSeasonPlaces, type SeasonPlace, type SeasonPrizeSnapshot } from "./shared/seasonPrizes";

/**
 * Season Finalization (ADR 0005 decision 2 / PLAN-PLAYER-PROFILES Phase 3).
 *
 * When an NFL pool's season is COMPLETE (every game of its season/seasonType is
 * FINAL or CANCELLED, and every week that has games appears in pool.scoredWeeks),
 * the server settles competitive results with no human in the loop:
 *   - users/{uid}/seasonHistory/{poolId} for every member WITH a playable entry
 *     (roster-only members and pick-less commissioners get no competitive history)
 *   - pool.firstFinalizedAt (audit metadata, written once)
 *   - pool.finalizedAt (last successful run — the staleness key vs lastScoredAt)
 *
 * Finalization is a RE-RUNNABLE OVERWRITE, not a one-shot: a rescore of a
 * completed pool re-derives ranks and overwrites seasonHistory (ADR 0004
 * re-derive principle). Distinct from admin close, which stays stats-free.
 * Money is NOT touched here — payouts are a separate Commissioner action
 * (Phase 4); the platform never computes a payout nobody recorded.
 */

interface FinalizeOutcome {
  finalized: boolean;
  reason?: string;
  members?: number;
  /** Set when the blocker was a stalled (likely postponed) game — structured so
   *  the sweep reports it without parsing the human-readable reason string. */
  stalledGameIds?: string[];
}

/** The minimum of an nfl_games doc completeness reasons about. */
export interface CompletenessGame {
  id: string;
  week?: number;
  status?: string;
  startTime?: number;
  /**
   * Needed because "concluded" is not a status test any more: a FINAL the feed
   * reported no scores for is not a played game (NFL7-3). Without this field
   * finalization would apply a LOOSER rule than the scorer and settle a season
   * on a game the scorer refused to grade (codex r4).
   */
  scores?: { home?: number; away?: number } | null;
}

export interface Completeness {
  complete: boolean;
  reason?: string;
  /** Games that are neither FINAL nor CANCELLED — the set blocking finalization. */
  unfinishedGameIds: string[];
  /** Weeks with games that the pool has never scored. */
  unscoredWeeks: number[];
  /**
   * Unfinished games still SCHEDULED long after their own kickoff. This is the
   * postponed/moved signature (mapEspnGameStatus maps POSTPONED → SCHEDULED,
   * nflSchedule.ts:25) and it is the one blocker that does NOT resolve itself
   * with time — see the STALLED note on isSeasonComplete.
   */
  stalledGameIds: string[];
}

/**
 * How far past its own kickoff a game must sit in a non-terminal state before we
 * call it stalled rather than merely in progress. Generous: a game plus overtime
 * plus feed lag is well under this.
 */
export const STALLED_GAME_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Every game concluded + every game-bearing week scored. Pure, so the
 * postponed-game case is pinned by unit tests rather than discovered in August.
 *
 * STALLED GAMES (PLAN-NFL-PRESEASON-PILOT A10) — intended behavior, verified:
 * a postponed game maps to SCHEDULED, which is neither FINAL nor CANCELLED, so
 * the season never reads complete and the pool is never finalized. **Waiting is
 * correct** — finalizing partially would settle standings and season history
 * while a real game is still pending, and finalization is a re-runnable
 * overwrite, so there is no benefit to settling early. What was wrong is that
 * it waited SILENTLY and forever: the sweep discarded this reason, so a pool
 * blocked by a game ESPN never reschedules looked identical to a pool blocked
 * by a game kicking off tonight. `stalledGameIds` names that difference so the
 * sweep can report it and a human can decide (reschedule lands, or the game is
 * marked CANCELLED).
 */
export function assessSeasonCompleteness(
  games: CompletenessGame[],
  scoredWeeks: Record<string, boolean>,
  nowMs: number,
): Completeness {
  if (games.length === 0) {
    return { complete: false, reason: 'no games for season', unfinishedGameIds: [], unscoredWeeks: [], stalledGameIds: [] };
  }

  const unfinished: CompletenessGame[] = [];
  const unscoredWeeks = new Set<number>();
  for (const g of games) {
    // ONE definition of concluded, shared with the scorer. This was a third
    // independent copy of the status test, and it was the one that decided
    // whether to write `finalizedAt` and season history — so a scoreless FINAL
    // left ungraded by the scorer could still be finalized here.
    if (!isTerminalGame(g)) unfinished.push(g);
    // A doc with a missing/garbage week must not put NaN into the unscored set —
    // it would render as "weeks not scored: NaN" and block finalization forever
    // on a data defect nobody can act on. Skip it; the game itself still gates
    // via the unfinished check above if it hasn't concluded.
    const week = Number(g.week);
    if (Number.isFinite(week) && !scoredWeeks[String(g.week)]) unscoredWeeks.add(week);
  }

  // Only SCHEDULED counts as stalled. An IN_PROGRESS game sitting for 12h is
  // also wrong, but it is a stuck-feed problem, not a postponement — labeling it
  // "likely postponed" would send an operator to the wrong fix.
  const stalledGameIds = unfinished
    .filter((g) => g.status === 'SCHEDULED' && typeof g.startTime === 'number' && nowMs - g.startTime > STALLED_GAME_AFTER_MS)
    .map((g) => g.id);
  const unfinishedGameIds = unfinished.map((g) => g.id);
  const weeks = [...unscoredWeeks].sort((a, b) => a - b);

  if (unfinishedGameIds.length > 0) {
    const stalledNote = stalledGameIds.length
      ? ` (${stalledGameIds.length} STALLED — still SCHEDULED >12h past kickoff, likely postponed: ${stalledGameIds.slice(0, 5).join(',')})`
      : '';
    return {
      complete: false,
      reason: `${unfinishedGameIds.length} games not concluded${stalledNote}`,
      unfinishedGameIds, unscoredWeeks: weeks, stalledGameIds,
    };
  }
  if (weeks.length > 0) {
    return {
      complete: false,
      reason: `weeks not scored: ${weeks.join(',')}`,
      unfinishedGameIds, unscoredWeeks: weeks, stalledGameIds,
    };
  }
  return { complete: true, unfinishedGameIds: [], unscoredWeeks: [], stalledGameIds: [] };
}

async function isSeasonComplete(db: Firestore, pool: any): Promise<Completeness> {
  const gamesSnap = await db.collection('nfl_games')
    .where('season', '==', pool.season)
    .where('seasonType', '==', Number(pool.seasonType || 2))
    .get();
  const games: CompletenessGame[] = gamesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  return assessSeasonCompleteness(games, pool.scoredWeeks || {}, Date.now());
}

/** Σ weeklyResults[*].correct — the Pick'em season-tie discriminator (§2c). */
function pickemCorrect(e: any): number {
  const wr = Object.values((e as NFLPickemEntry).weeklyResults || {}) as Array<{ correct?: number }>;
  return wr.reduce((s, w) => s + (w.correct || 0), 0);
}

/**
 * Competition ranking over a list already sorted by the cascade: two adjacent
 * rows SHARE a rank when every key of the cascade is equal, the next rank skips.
 */
function cascadeRanks<T>(sorted: T[], keys: Array<(e: T) => number>): Map<T, number> {
  const ranks = new Map<T, number>();
  sorted.forEach((e, idx) => {
    const prev = idx > 0 ? sorted[idx - 1] : null;
    ranks.set(e, prev && keys.every(k => k(e) === k(prev)) ? (ranks.get(prev) as number) : idx + 1);
  });
  return ranks;
}

/**
 * Final ranks + type-specific record per entry. Pure given the entries array.
 * Season-prize ties break on the §2c cascade (PLAN-WEEKLY-PRIZES, D4) and
 * residual ties SHARE a rank so the prize splits (§4):
 * - Pickem: totalScore desc → Σ correct picks desc (a real discriminator only in
 *   confidence mode; in standard scoring points ARE the correct count) → share
 * - Survivor: ALIVE entries rank 1 (co-champions), then eliminated by
 *   eliminatedWeek desc (lasted longer = better), strikes asc as tiebreak
 * - Margin: the standings cascade IN FULL AND IN ORDER — seasonTotal desc →
 *   negativeBurden asc → positiveWeeks desc → bestWeek desc → share. The uid
 *   fallback in `sortMarginLeaderboard` orders the rows but never separates a
 *   rank: a prize order that contradicts the visible standings is the worst
 *   outcome, and the standings show those four keys.
 */
export function computeFinalRanks(
  poolType: string,
  entries: any[],
): Array<{ entry: any; rank: number; record: Record<string, number | boolean | null>; points: number | null }> {
  if (poolType === 'NFL_PICKEM') {
    const sorted = [...entries].sort((a, b) =>
      (b.totalScore || 0) - (a.totalScore || 0) ||
      pickemCorrect(b) - pickemCorrect(a) ||
      String(a.ownerUid ?? a.id).localeCompare(String(b.ownerUid ?? b.id)));
    const ranks = cascadeRanks(sorted, [e => e.totalScore || 0, pickemCorrect]);
    return sorted.map(e => {
      const wr = Object.values((e as NFLPickemEntry).weeklyResults || {}) as Array<{ correct?: number; total?: number }>;
      const correct = wr.reduce((s, w) => s + (w.correct || 0), 0);
      const total = wr.reduce((s, w) => s + (w.total || 0), 0);
      return { entry: e, rank: ranks.get(e) as number, record: { correct, total }, points: e.totalScore || 0 };
    });
  }
  if (poolType === 'NFL_SURVIVOR') {
    const alive = entries.filter(e => (e as SurvivorEntry).status !== 'ELIMINATED');
    const out = [...entries.filter(e => (e as SurvivorEntry).status === 'ELIMINATED')]
      .sort((a, b) =>
        (b.eliminatedWeek || 0) - (a.eliminatedWeek || 0) ||
        (a.strikesUsed || 0) - (b.strikesUsed || 0) ||
        String(a.ownerUid).localeCompare(String(b.ownerUid)));
    const rows: Array<{ entry: any; rank: number; record: Record<string, number | boolean | null>; points: number | null }> = [];
    for (const e of alive) {
      rows.push({ entry: e, rank: 1, record: recordOfSurvivor(e), points: null });
    }
    let rank = alive.length + 1;
    let prev: any = null;
    for (const e of out) {
      const tied = prev && (e.eliminatedWeek || 0) === (prev.eliminatedWeek || 0) && (e.strikesUsed || 0) === (prev.strikesUsed || 0);
      if (!tied) rank = alive.length + out.indexOf(e) + 1;
      rows.push({ entry: e, rank, record: recordOfSurvivor(e), points: null });
      prev = e;
    }
    return rows;
  }
  if (poolType === 'NFL_MARGIN') {
    const ranked = sortMarginLeaderboard(entries as MarginEntry[]);
    const ranks = cascadeRanks(ranked, [
      e => e.seasonTotal ?? 0, e => e.negativeBurden ?? 0, e => e.positiveWeeks ?? 0, e => e.bestWeek ?? 0,
    ]);
    return ranked.map((e) => ({
      entry: e,
      rank: ranks.get(e) as number,
      record: { seasonTotal: e.seasonTotal ?? 0 },
      points: e.seasonTotal ?? 0,
    }));
  }
  return [];
}

function recordOfSurvivor(e: any): Record<string, number | boolean | null> {
  const wr = Object.values((e as SurvivorEntry).weeklyResults || {}) as Array<{ survived?: boolean }>;
  return {
    survivedWeeks: wr.filter(w => w.survived).length,
    strikes: e.strikesUsed || 0,
    eliminatedWeek: e.eliminatedWeek ?? null,
    alive: e.status !== 'ELIMINATED',
  };
}

/**
 * Finalizes one NFL pool if its season is complete. Re-runnable; safe to call
 * after every scoring pass. Returns what happened for callers/sweep reporting.
 *
 * Test Pools (persisted `simRunId`, or a `sim-` season/doc-id) are refused unless
 * `allowSim` is passed — ONLY the guarded `simFinalizePool` harness callable sets it,
 * so a full-season Sim Run never writes seasonHistory/profile docs as a side effect
 * of inline scoring or the sweep. (PLAN-NFL-SIM-HARNESS Phase 0.2, Codex R1#2/R2#1.)
 *
 * `isSimPool` now LIVES IN shared/testPool.ts and is re-exported here unchanged, so
 * the client's stats surface applies the identical rule (PLAN-STATS-INTEGRITY §2.4).
 * Existing importers (nflAutoScore, nflLockWatch, the sweep below) keep this path.
 */
export { isSimPool };

/**
 * What the POOL doc carries for the season places and prize at finalization
 * (PLAN-WEEKLY-PRIZES step 3 — the season half of §3b-i/§4), computed from the
 * pool doc AS READ IN THE FINALIZE TRANSACTION (`freshPool`), never the
 * pre-lease snapshot. Never throws: a malformed place list (duplicate ranks,
 * >100 %) publishes the ranking with `seasonPlacesError` and no prize —
 * fail-closed, same as the weekly publication (§9 A5).
 *
 * `frozen`: an existing `seasonPrize` on the pool — a snapshot or `null`
 * (published unpriced) — is reused verbatim; `undefined` = compute now.
 * Finalization is terminal so this runs once per pool in practice; the reuse
 * rule keeps a sim/re-run from re-pricing.
 */
export function seasonPlacesPublication(
  freshPool: any,
  ranked: ReadonlyArray<{ entry: any; rank: number; points: number | null }>,
  entryDocCount: number,
): { seasonPlaces: SeasonPlace[]; seasonPrize?: SeasonPrizeSnapshot | null; seasonPlacesError?: string } {
  const rows: SeasonPlace[] = ranked
    .filter(r => r.entry?.ownerUid || r.entry?.id)
    .map(r => ({
      entryId: String(r.entry.id ?? r.entry.ownerUid),
      userId: String(r.entry.ownerUid ?? r.entry.id),
      userName: String(r.entry.userName ?? r.entry.ownerUid ?? ''),
      ...(r.entry.entryName ? { entryName: String(r.entry.entryName) } : {}),
      rank: r.rank,
      points: r.points,
    }));
  try {
    const frozen: SeasonPrizeSnapshot | null | undefined = freshPool?.seasonPrize;
    let snapshot: SeasonPrizeSnapshot | null | undefined = frozen;
    if (snapshot === undefined) {
      const entryCount = Number.isInteger(freshPool?.entryCount) && freshPool.entryCount >= 0 ? freshPool.entryCount : entryDocCount;
      snapshot = computeSeasonPrizeSnapshot(freshPool?.settings ?? {}, entryCount, Date.now()) ?? null;
    }
    if (snapshot === null) return { seasonPlaces: rows, seasonPrize: null };
    const priced = priceSeasonPlaces(rows, snapshot);
    return { seasonPlaces: priced.rows, seasonPrize: snapshot };
  } catch (e) {
    const code = e instanceof Error ? (e.message.split(':')[0] || 'SEASON_PLACES_ERROR') : 'SEASON_PLACES_ERROR';
    return { seasonPlaces: rows, seasonPlacesError: code };
  }
}

export async function maybeFinalizeNFLPool(
  db: Firestore,
  poolId: string,
  opts?: { allowSim?: boolean; fence?: ScoringFence },
): Promise<FinalizeOutcome> {
  // Season-history and `finalizedAt` writes go through the caller's scoring
  // fence when there is one (PLAN-REALTIME-SCORING §3a): this function snapshots
  // the entry set and derives final ranks from it, so a pass that lost its lease
  // would write season history computed from entries a newer pass has since
  // rewritten — and `finalizedAt` is terminal, so nothing retracts it. Callers
  // without a fence (the sim harness's simFinalizePool) keep the plain write.
  const fence = opts?.fence;
  const poolRef = db.collection('pools').doc(poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) return { finalized: false, reason: 'pool missing' };
  const pool = poolSnap.data() as any;

  if (!NFL_SEASON_TYPES.includes(pool.type)) return { finalized: false, reason: 'not an NFL season pool' };
  // Every VOIDED status, not just CANCELED (codex r8). `checkFence` now refuses a
  // voided pool inside the write transaction, so a COMPLETED/ARCHIVED pool that is
  // season-complete but unfinalized would reach `fencedWrite` and throw FENCE_LOST
  // on every sweep, forever. Declining here is the same answer, cleanly, before
  // any write is attempted.
  if (isVoidedPool(pool)) return { finalized: false, reason: 'voided (cancelled, closed or archived)' };
  if (isSimPool(pool, poolId) && !opts?.allowSim) {
    return { finalized: false, reason: 'sim pool (finalize only via simFinalizePool)' };
  }

  const completeness = await isSeasonComplete(db, pool);
  if (!completeness.complete) {
    return { finalized: false, reason: completeness.reason, stalledGameIds: completeness.stalledGameIds };
  }

  const entriesSnap = await poolRef.collection('entries').get();
  const entries = entriesSnap.docs.map(d => ({ ...(d.data() as any), id: d.id }));
  if (entries.length === 0) return { finalized: false, reason: 'no entries' };

  const ranked = computeFinalRanks(pool.type, entries);
  const season = String(pool.season ?? '');

  let staged: Array<[FirebaseFirestore.DocumentReference, Record<string, unknown>]> = [];
  const commitStaged = async () => {
    if (staged.length === 0) return;
    const chunk = staged;
    staged = [];
    if (fence) {
      await fencedWrite(db, poolRef, fence, (tx) => {
        for (const [ref, data] of chunk) tx.set(ref, data, { merge: true });
      });
      return;
    }
    const batch = db.batch();
    for (const [ref, data] of chunk) batch.set(ref, data, { merge: true });
    await batch.commit();
  };
  for (const { entry, rank, record, points } of ranked) {
    if (!entry.ownerUid) continue;
    staged.push([
      db.collection('users').doc(entry.ownerUid).collection('seasonHistory').doc(poolId),
      {
        poolId,
        poolName: pool.name || '',
        poolType: pool.type,
        season,
        finalRank: rank,
        totalEntries: ranked.length,
        record,
        ...(points !== null ? { points } : {}),
        ...(entry.entryName ? { entryName: entry.entryName } : {}),
        isChampion: rank === 1,
        completedAt: Date.now(),
      },
    ]);
    if (staged.length >= 400) await commitStaged();
  }
  await commitStaged();

  const finalizeStamp = {
    finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(pool.firstFinalizedAt ? {} : { firstFinalizedAt: admin.firestore.FieldValue.serverTimestamp() }),
  };
  // Season Places + frozen season prize ride the same write as `finalizedAt`
  // (PLAN-WEEKLY-PRIZES step 3): derived from the pool AS READ IN THE FENCED
  // TRANSACTION so a settings edit racing the finalize is frozen in or out,
  // never half-seen. `seasonPlacesError` is only ever SET here (fail-closed);
  // a clean publication clears any earlier one.
  const seasonPatch = (freshPool: any) => {
    const pub = seasonPlacesPublication(freshPool ?? pool, ranked, entries.length);
    return {
      seasonPlaces: pub.seasonPlaces,
      ...(pub.seasonPrize !== undefined ? { seasonPrize: pub.seasonPrize } : {}),
      seasonPlacesError: pub.seasonPlacesError ?? admin.firestore.FieldValue.delete(),
    };
  };
  if (fence) {
    await fencedWrite(db, poolRef, fence, (_tx, poolData) => seasonPatch(poolData), finalizeStamp);
  } else {
    await poolRef.update({ ...finalizeStamp, ...seasonPatch(pool) });
  }

  // Refresh each member's public profile projection (bounded by pool size;
  // best-effort per member so one bad profile never blocks the rest).
  for (const { entry } of ranked) {
    if (!entry.ownerUid) continue;
    try {
      await recomputeUserProfile(db, entry.ownerUid);
    } catch (e) {
      console.warn(`[finalizeNFLPool] profile recompute failed for ${entry.ownerUid}:`, e);
    }
  }

  return { finalized: true, members: ranked.length };
}

const MAX_PER_RUN = 200; // safety cap, mirrors autoClosePools

export interface SweepGate {
  enabled: boolean;
  dryRun: boolean;
  /** When set, only pools on these seasonTypes may be finalized LIVE. */
  liveSeasonTypes: number[] | null;
  /** Why the run is dry when the operator asked for live. */
  forcedDryReason?: string;
}

/**
 * Read the sweep's gate (PLAN-NFL-PRESEASON-PILOT A6).
 *
 * The pilot's plan is to arm this against PRESEASON POOLS ONLY, after a verified
 * dry-run report. `liveSeasonTypes` is what makes "only" enforceable rather than
 * merely intended.
 *
 * FAIL-SAFE, deliberately stricter than the other jobs: asking for live
 * (`dryRun: false`) WITHOUT naming `liveSeasonTypes` keeps the run dry. Arming
 * the finalizer is the one flip in this system that settles real seasons for
 * real members, and "I meant preseason but forgot the scope field" is exactly
 * the mistake that would settle every regular-season pool by accident. There is
 * no unscoped way to go live; naming the scope is the only way to arm it.
 */
export function readSweepGate(
  cfg: { enabled?: boolean; dryRun?: boolean; liveSeasonTypes?: unknown } | undefined | null,
): SweepGate {
  const enabled = cfg?.enabled === true;
  const requestedLive = cfg?.dryRun === false;

  const raw = Array.isArray(cfg?.liveSeasonTypes) ? cfg!.liveSeasonTypes : null;
  const liveSeasonTypes = raw
    ? (raw as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 3)
    : null;

  if (!requestedLive) return { enabled, dryRun: true, liveSeasonTypes };
  if (!liveSeasonTypes || liveSeasonTypes.length === 0) {
    return {
      enabled, dryRun: true, liveSeasonTypes: null,
      forcedDryReason:
        'dryRun:false was set but liveSeasonTypes is missing or empty — refusing to finalize an unscoped set of pools. ' +
        'Set liveSeasonTypes (e.g. [1] for preseason only) in the same system/config.nflFinalize map.',
    };
  }
  return { enabled, dryRun: false, liveSeasonTypes };
}

/** Is this pool inside the armed scope? */
export function poolInLiveScope(pool: { seasonType?: number | string }, liveSeasonTypes: number[] | null): boolean {
  if (!liveSeasonTypes) return false;
  // `|| 2`, NOT `?? 2` — must match isSeasonComplete's `Number(pool.seasonType || 2)`
  // exactly. They differ for '' and 0, and a pool scored against one slate but
  // scoped by another is precisely the bug this guard exists to prevent.
  return liveSeasonTypes.includes(Number(pool.seasonType || 2));
}

/**
 * Daily backstop sweep: finalizes season-complete NFL pools that scoreNFLWeek's
 * inline check missed (out-of-order scoring, manual admin scores, transient
 * failures) or whose finalization went stale (finalizedAt < lastScoredAt after
 * a rescore).
 *
 * SAFETY (Rule 1, mmp-change-control): kill-switch
 * system/config.nflFinalize.enabled === true required (default OFF, fail-safe);
 * dry-run by default (nflFinalize.dryRun !== false) — reports what it WOULD
 * finalize to admin_audit, writing nothing, until explicitly flipped.
 *
 * A6 (preseason burn-in): going live additionally REQUIRES naming
 * `liveSeasonTypes` (e.g. [1] for preseason only). See readSweepGate — there is
 * no unscoped way to arm this job. Dry-run reports break candidates down by
 * seasonType so an operator can see what a given scope would arm before arming it.
 */
export const nflFinalizeSweepJob = functions.scheduler.onSchedule(
  // 04:30 ET. Was "every day 08:30" with no timeZone == 08:30 UTC == 04:30 ET
  // during EDT; now fixed at 04:30 ET year-round. This is the job whose
  // documented run time was wrong for exactly this reason — HANDOFF described
  // it as 08:30 ET when it ran at 04:30 ET.
  { schedule: "30 4 * * *", timeZone: "America/New_York", timeoutSeconds: 540, memory: "512MiB" },
  withHeartbeat("nflFinalizeSweepJob", async () => {
    const db = admin.firestore();

    let gate: SweepGate = { enabled: false, dryRun: true, liveSeasonTypes: null };
    let configError: unknown = null;
    try {
      const cfg = (await db.doc("system/config").get()).data()?.nflFinalize as
        | { enabled?: boolean; dryRun?: boolean; liveSeasonTypes?: unknown }
        | undefined;
      gate = readSweepGate(cfg);
    } catch (e) {
      configError = e ?? new Error("unknown config read error");
    }
    if (configError) return configReadFailedVerdict("nflFinalizeSweepJob", configError);
    const { enabled, dryRun } = gate;
    if (gate.forcedDryReason) {
      console.error(`[nflFinalizeSweep] STAYING DRY: ${gate.forcedDryReason}`);
    }
    if (!enabled) {
      console.log("[nflFinalizeSweep] disabled (system/config.nflFinalize.enabled !== true); nothing to do.");
      // Deliberately ok. A disabled job that still stamps is the whole point of
      // the wrapper: it proves the SCHEDULE fired even when the job did nothing.
      return { detail: { enabled: false } };
    }
    if (gate.forcedDryReason) {
      // The operator set dryRun:false and the sweep refused, because
      // liveSeasonTypes was missing. They believe it is armed and it is not —
      // a mismatch that should surface as unhealthy rather than sit in a log.
      // Reported here rather than at the top so the dry-run report below still runs.
      console.error("[nflFinalizeSweep] arm request refused; continuing dry.");
    }

    // Candidates: NFL pools that have been scored at least once. Staleness and
    // completeness are checked per pool (cheap doc reads; games query only for
    // pools that pass the staleness filter).
    //
    // REQUIRES the composite index pools(type ASC, scoredThroughWeek ASC) — an
    // `in` filter combined with an inequality on a different field cannot use a
    // single-field index. That index was MISSING from firestore.indexes.json
    // until 2026-07-20, so this query threw FAILED_PRECONDITION on every run
    // since the job was first armed on 2026-07-10, and the sweep produced ZERO
    // audit entries in that whole period. Nobody noticed because a scheduled
    // job's throw goes nowhere a human looks.
    //
    // Hence the try/catch below: an infrastructure failure now writes an audit
    // entry of its own. A sweep that CANNOT RUN must not be indistinguishable
    // from a sweep that ran and found nothing.
    let snap;
    try {
      snap = await db.collection("pools")
        .where("type", "in", [...NFL_SEASON_TYPES])
        .where("scoredThroughWeek", ">=", 1)
        .limit(500)
        .get();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[nflFinalizeSweep] CANDIDATE QUERY FAILED — sweep cannot run:", message);
      await writeAdminAudit({
        actorUid: "system",
        action: "NFL_FINALIZE_SWEEP",
        targetType: "pool",
        metadata: {
          dryRun,
          failed: true,
          reason: "candidate query failed — check the pools(type, scoredThroughWeek) composite index",
          error: message.slice(0, 500),
        },
        status: "error",
      });
      // The heartbeat must say so too. This catch exists BECAUSE the missing
      // composite index made this query throw every day for ten days; an audit
      // row alone was already proved insufficient — nobody reads audit rows
      // looking for absence. Returning ok:false is what puts it in front of the
      // staleness check. Not rethrown: the audit row is the durable record, and
      // a Cloud Functions retry cannot conjure a missing index.
      return {
        ok: false,
        error: `candidate query failed: ${message.slice(0, 300)}`,
        detail: { dryRun, phase: "candidate-query" },
      };
    }

    const stale = snap.docs.filter((d) => {
      const p = d.data() as any;
      // Test Pools are marked by the persisted simRunId field / sim- season — their doc
      // IDs are server-generated, so an id-prefix check alone excludes NOTHING (Codex R1#1).
      if (isSimPool(p, d.id)) return false;
      // Same widening as maybeFinalizeNFLPool's decline (codex r8): a closed or
      // archived pool is never finalizable, so leaving it in the candidate set
      // only burns the per-run cap that in-scope pools need.
      if (isVoidedPool(p)) return false;
      const finalizedAt = p.finalizedAt?.toMillis?.() ?? 0;
      const lastScoredAt = p.lastScoredAt?.toMillis?.() ?? 0;
      return finalizedAt === 0 || finalizedAt < lastScoredAt;
    });
    // Scope BEFORE capping. Capping first would let out-of-scope pools occupy the
    // prefix and starve the in-scope ones the operator actually armed — with a
    // preseason-only scope and a mostly regular-season pool list, that could mean
    // the sweep finalizes nothing at all while reporting a full run.
    const eligible = gate.dryRun
      ? stale
      : stale.filter((d) => poolInLiveScope(d.data() as any, gate.liveSeasonTypes));
    const outOfScope = stale.length - eligible.length;
    const capped = eligible.slice(0, MAX_PER_RUN);

    if (dryRun) {
      // Report the seasonType spread so the operator can see exactly what a
      // given liveSeasonTypes value WOULD arm before arming it.
      // Computed over the FULL stale set, not the capped prefix, so the number an
      // operator reads is the number a given liveSeasonTypes value would arm.
      const bySeasonType: Record<string, number> = {};
      for (const d of stale) {
        const st = String(Number((d.data() as any).seasonType || 2));
        bySeasonType[st] = (bySeasonType[st] ?? 0) + 1;
      }
      console.log(`[nflFinalizeSweep] DRY-RUN: ${stale.length} candidate pool(s).`, { bySeasonType });
      const dryAudited = await writeAdminAudit({
        actorUid: "system",
        action: "NFL_FINALIZE_SWEEP",
        targetType: "pool",
        metadata: {
          dryRun: true, candidates: stale.length,
          sample: capped.slice(0, 10).map((d) => d.id),
          bySeasonType,
          ...(gate.forcedDryReason ? { forcedDryReason: gate.forcedDryReason } : {}),
        },
        status: "success",
      });
      // A dry run's ONLY output is that audit entry — losing it means the run
      // produced nothing an operator can read, which is the state this whole
      // job was rebuilt to stop being invisible. A refused arm request is
      // likewise unhealthy: the operator asked for live and got dry, and a
      // config mistake nobody sees is how a sweep stays silently inert.
      return dryRunVerdict(dryAudited, gate.forcedDryReason, stale.length);
    }

    // A6: live runs only touch pools inside the armed scope. Everything else is
    // reported as out-of-scope, so a mis-scoped arm is visible in the very first
    // report instead of silently doing nothing (or silently doing too much).
    const deferred = eligible.length - capped.length;

    let finalized = 0;
    let skipped = 0;
    // Why each pool was skipped. Previously discarded, which made a pool blocked
    // forever by a postponed game (A10) indistinguishable from one blocked by a
    // game kicking off tonight — both just incremented `skipped`.
    const blockedReasons: Record<string, string> = {};
    const stalled: string[] = [];
    // How many pools this run stepped over because a live scoring pass held the
    // lease. Reported, not treated as a failure — the sweep runs daily and the
    // scorer's own finalize call reaches the same pools every 10 minutes.
    let leaseBusy = 0;
    for (const d of capped) {
      try {
        // The sweep is an INDEPENDENT caller of maybeFinalizeNFLPool: without the
        // lease it can overlap a live scoring pass, snapshot a half-updated entry
        // set, and write season history from it (codex r24). Same mutex, same
        // record.
        const leased = await withScoringLease(db, d.id, Date.now(), (fence) =>
          maybeFinalizeNFLPool(db, d.id, { fence }));
        if (leased === 'LEASE_BUSY') {
          leaseBusy++;
          skipped++;
          blockedReasons[d.id] = 'scoring lease held by another pass';
          continue;
        }
        const outcome = leased;
        if (outcome.finalized) {
          finalized++;
        } else {
          skipped++;
          blockedReasons[d.id] = outcome.reason ?? 'unknown';
          if (outcome.stalledGameIds?.length) stalled.push(d.id);
        }
      } catch (e) {
        skipped++;
        blockedReasons[d.id] = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
        console.warn(`[nflFinalizeSweep] finalize failed for ${d.id}:`, e);
      }
    }
    // Cap the log the same way the audit doc is capped — up to MAX_PER_RUN
    // entries would otherwise land in a single log line every day.
    const sampleReasons = Object.fromEntries(Object.entries(blockedReasons).slice(0, 50));
    console.log(
      `[nflFinalizeSweep] finalized ${finalized}, skipped ${skipped} of ${capped.length} processed this run ` +
      `(scope seasonTypes ${gate.liveSeasonTypes?.join(',')}); ${stale.length} stale candidates, ` +
      `${outOfScope} out-of-scope, ${deferred} over the ${MAX_PER_RUN} cap; ${stalled.length} stalled; ` +
      `${leaseBusy} held by a live scoring pass.`,
      { blockedReasons: sampleReasons, stalled: stalled.slice(0, 50) },
    );
    const audited = await writeAdminAudit({
      actorUid: "system",
      action: "NFL_FINALIZE_SWEEP",
      targetType: "pool",
      metadata: {
        // These reconcile: candidates = processed + outOfScope + deferred.
        dryRun: false, finalized, skipped, leaseBusy,
        candidates: stale.length, processed: capped.length, outOfScope, deferred,
        liveSeasonTypes: gate.liveSeasonTypes,
        // Capped so one bad season can't bloat an audit doc past Firestore's 1MiB limit.
        blockedReasons: sampleReasons,
        stalledPools: stalled.slice(0, 50),
      },
      status: "success",
    });

    return sweepRunVerdict(blockedReasons, { finalized, skipped, leaseBusy, candidates: stale.length }, audited);
  }),
);

/**
 * Was a DRY run healthy?
 *
 * A dry run's only output is its audit entry, so losing that entry means the
 * run produced nothing an operator can read — the precise state this job was
 * rebuilt to stop being invisible. A refused arm request is unhealthy for a
 * different reason: the operator asked for live and got dry, and a config
 * mistake nobody sees is how a sweep stays silently inert.
 */
export function dryRunVerdict(
  audited: boolean,
  forcedDryReason: string | undefined,
  candidates: number,
): { ok?: boolean; error?: string; detail: Record<string, unknown> } {
  const detail = { dryRun: true, candidates };
  const problems: string[] = [];
  if (!audited) problems.push('dry-run report not written');
  if (forcedDryReason) problems.push(forcedDryReason.slice(0, 300));
  return problems.length > 0 ? { ok: false, error: problems.join('; '), detail } : { detail };
}

/** The `blockedReasons` prefix that marks a pool whose finalization THREW. */
export const SWEEP_ERROR_PREFIX = 'ERROR: ';

/**
 * Was a live sweep run healthy?
 *
 * A pool that threw is caught per-pool so one bad pool cannot stop the sweep —
 * but "kept going" is not "fine", and without this the job reports ok:true
 * while the same pool fails to finalize every single day. A pool merely BLOCKED
 * (a game still in progress, a postponed game per A10) is normal operation and
 * must NOT be counted, or the signal cries wolf all season.
 *
 * Pure and exported so the distinction is unit-tested rather than discovered
 * during a preseason week. Found by codex review on PR #245.
 */
export function sweepRunVerdict(
  blockedReasons: Record<string, string>,
  detail: Record<string, unknown>,
  audited = true,
): { ok?: boolean; error?: string; detail: Record<string, unknown> } {
  const errored = Object.values(blockedReasons).filter((r) => r.startsWith(SWEEP_ERROR_PREFIX)).length;
  const problems: string[] = [];
  if (errored > 0) problems.push(`${errored} pool(s) threw during finalization`);
  // writeAdminAudit swallows its own failures, so a lost summary would otherwise
  // leave a live run with no record of what it just did to real pools.
  if (!audited) problems.push('run summary not written');
  return problems.length > 0
    ? { ok: false, error: problems.join('; '), detail: { ...detail, errored } }
    : { detail };
}
