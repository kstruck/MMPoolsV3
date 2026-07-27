// The auto-scorer's decision logic: which pools are eligible, whether anything
// has changed since the last pass, and whether a run was healthy.
//
// Split from nflAutoScore.ts (the job) so these can be unit-tested without a
// Firestore emulator. Importing the job pulls in the scorer, which pulls in
// billing.ts, which calls admin.firestore() at module load — so a "pure" test
// that reaches through the job is not pure at all and fails at import.

import { createHash } from 'crypto';
import {
  effectiveLockSettings,
  effectiveGameLockAt,
  isGameLocked as isGameLockedAt,
  weekLockDecision,
  usesWeeklyHardLock,
} from './effectiveLock';
import { isTerminalGame } from './weekCompletion';
import type { NFLGame } from '../nflPoolTypes';

/** Pool statuses that mean "settled — never score this again". */
const TERMINAL_POOL_STATUSES = new Set(['FINAL', 'CANCELED', 'COMPLETED', 'ARCHIVED']);

/**
 * Has this pool been retired? Scoring a voided or archived pool would write
 * entry scores, standings and audit for something the manager has closed out.
 *
 * Deliberately an explicit predicate over the statuses these write paths
 * actually persist, NOT `normalizePhase` — that helper maps `CANCELED` to
 * `open`, so it would wave a cancelled pool straight through. Compared
 * case-insensitively because the casing is inconsistent across writers
 * (`cancelPool` writes `CANCELED`, `archivePool` writes `archived`).
 *
 * `FINAL` as a STATUS is distinct from the `isFinal` boolean and is how payout
 * handling marks a settled pool; omitting it would rewrite settled pools on
 * every active slot.
 */
export function isTerminalPool(pool: {
  isFinal?: unknown;
  finalizedAt?: unknown;
  status?: unknown;
} | undefined | null): boolean {
  if (!pool) return true;
  if (pool.isFinal === true) return true;
  if (pool.finalizedAt !== undefined && pool.finalizedAt !== null) return true;
  return isRetiredPool(pool);
}

/**
 * The half of `isTerminalPool` the QUEUED reconciliation tier still honours
 * (§5b, codex r9).
 *
 * A late correction must be able to rescore a pool the scorer itself finalized —
 * that is the whole point of the queue — so the drain bypasses the FINALIZATION
 * markers (`isFinal` / `finalizedAt`, both written by `maybeFinalizeNFLPool`) and
 * re-finalizes afterwards. It must NOT bypass the retirement STATUSES: a slate
 * queued while active can be cancelled or archived before the drain reaches it,
 * and `maybeFinalizeNFLPool` only checks cancellation AFTER the writes, so it
 * cannot undo entry/standings/recap/audit writes into a voided pool.
 *
 * `FINAL` as a status stays on the retired side, which is stricter than the
 * plan's literal "bypass the finalization exclusion" wording and is deliberate:
 * `maybeFinalizeNFLPool` writes `finalizedAt`/`firstFinalizedAt` and never this
 * status — the status is what payout handling stamps once money has been settled
 * against the standings. Rescoring THAT silently is a worse failure than leaving
 * it stale, and it is a manual decision either way.
 */
export function isRetiredPool(pool: { status?: unknown } | undefined | null): boolean {
  if (!pool) return true;
  const status = typeof pool.status === 'string' ? pool.status.toUpperCase() : '';
  return TERMINAL_POOL_STATUSES.has(status);
}

/**
 * When must this pool's week be looked at again because a TERMINAL game is still
 * behind its own lock (§5b, codex r8)?
 *
 * A Pick'em commissioner can push one game's lock ~24h later. A game that
 * finalizes at kickoff+3h under an override expiring at kickoff+23h55m is
 * withheld by the pass that sees it, and the slate has left the 24h live window
 * by the time the override expires — and NOTHING happens AT the expiry to make it
 * a candidate again, so the reveal never runs and the raw game data never changes
 * to move the fingerprint. Returning the earliest such lock instant lets the pass
 * enqueue a `lockPending` reminder for exactly that moment.
 *
 * `null` when nothing is withheld: either no game is terminal yet (the live
 * window still covers those) or every terminal game is already revealable.
 */
export function nextWithheldLockAt(
  pool: { type?: string; settings?: unknown } | undefined,
  week: number,
  games: NFLGame[],
  now: number,
): number | null {
  const lockSettings = effectiveLockSettings(pool?.settings as never, pool?.type);
  let earliest: number | null = null;
  for (const g of games) {
    if (!isTerminalGame(g)) continue;
    if (isGameLockedAt(now, g.startTime, week, lockSettings)) continue;
    const lockAt = effectiveGameLockAt(g.startTime, week, lockSettings);
    if (earliest === null || lockAt < earliest) earliest = lockAt;
  }
  return earliest;
}

/**
 * A hash of everything that could change this week's grades for this pool.
 * Unchanged → the pool is skipped and nothing is written.
 *
 * Every term is here because without it some real change leaves the hash
 * identical and the pool is skipped FOREVER:
 *  - `status` + scores: a restated final score keeps the FINAL *count*
 *    unchanged, and a flip to CANCELLED does not grow it — both change grades.
 *  - `spread.value`: ATS Pick'em grades on it, so a corrected locked spread
 *    changes winners without touching a score.
 *  - the reveal-eligibility bit: a game finalized under a still-open
 *    `weekLockOverride` is withheld on one pass, and once the override expires
 *    the raw game data is unchanged — so without this bit the pool would take
 *    the skip path forever and never reveal it.
 *  - the scoring settings: the engine's output changes when these change even
 *    with identical game data (a mid-week STRAIGHT→ATS or `maxStrikes` edit).
 *  - the weekly-lock bit, for the hard-lock types only: a pass in the pre-kickoff
 *    part of the window persists a fingerprint with the no-pick penalty gated
 *    OFF, and at the lock the games, settings and picks can all still be
 *    identical — so the penalty would wait for a game to finish instead of
 *    applying at the deadline. Pick'em has no such penalty, so including the bit
 *    there would only buy a pointless extra pass.
 *
 *  - `entryRevisionSum`: entry mutations. `submitNFLPicks` captures its clock
 *    before its transaction, so a valid submission can commit AFTER the scorer
 *    has read entries; with games and settings unchanged the rest of this hash
 *    matches and that entry would keep an omitted grade until something else
 *    moved. The sum is monotone and changes on EVERY mutation — see
 *    lib/entryRevision.ts for why a max or a count stalls instead.
 *
 * `entryRevisionSum` defaults to 0 only so the pure fingerprint tests can pin
 * one term at a time; the job always passes the real value, and
 * `autoScore.emulator.test.ts` pins that wiring (a bumped entry revision must
 * defeat the skip).
 */
export function computeWeekFingerprint(
  pool: { type?: string; settings?: any },
  week: number,
  games: NFLGame[],
  now: number,
  entryRevisionSum = 0,
): string {
  const lockSettings = effectiveLockSettings(pool?.settings, pool?.type);

  const gameTerms = games
    .filter(isTerminalGame)
    .map(g => [
      g.id,
      g.status,
      g.scores?.home ?? '',
      g.scores?.away ?? '',
      g.spread?.value ?? '',
      isGameLockedAt(now, g.startTime, week, lockSettings) ? '1' : '0',
    ].join(':'))
    .sort();

  const s = pool?.settings ?? {};
  // Margin grading is pure margin-of-victory with no settings input, so it
  // contributes nothing here — noted so its absence reads as checked, not missed.
  const settingsTerms = [
    `pickMode=${s.pickMode ?? ''}`,
    `confidenceMode=${s.confidenceMode ?? ''}`,
    `maxStrikes=${s.maxStrikes ?? ''}`,
    `pickLosersMode=${s.pickLosersMode ?? ''}`,
    `autoSurviveExemptionEnabled=${s.autoSurviveExemptionEnabled ?? ''}`,
  ];

  const lockTerms: string[] = [];
  if (usesWeeklyHardLock(pool?.type)) {
    const weekLockAt = weekLockDecision(pool as never, week, games.map(g => g.startTime)).lockAt;
    lockTerms.push(`weekLocked=${now >= weekLockAt ? '1' : '0'}`);
  }

  return createHash('sha256')
    .update([
      `week=${week}`,
      ...gameTerms,
      ...settingsTerms,
      ...lockTerms,
      `entryRev=${entryRevisionSum}`,
    ].join('|'))
    .digest('hex');
}

/** The auto-scorer's cadence, and so the step size of the rotation below. */
export const RUN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Rotate the candidate order by run, so the per-run cap cannot permanently
 * starve the tail of a large slate.
 *
 * Firestore returns candidates in a stable document order, so without rotation
 * the same prefix is attempted every run — and pools that legitimately bank no
 * fingerprint (no entries, or every entry still held pending) are attempted
 * every run by design. A slate with more than a capful of those would pin the
 * window over the same pools forever and the ones behind them would never be
 * scored at all. Advancing the start by one run-interval slides the window
 * across the whole list, so every pool reaches the front within one cycle.
 */
export function rotateForRun<T>(items: T[], now: number, intervalMs = RUN_INTERVAL_MS): T[] {
  if (items.length === 0) return items;
  const start = Math.floor(now / intervalMs) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

export interface AutoScoreResult {
  activeSlates: number;
  /** Pools scored — or that WOULD be scored, on a dry run. */
  poolsScored: number;
  /** Pools whose fingerprint was unchanged: no work, no writes. */
  poolsSkipped: number;
  /** Pools deferred to the next run by the per-run cap. */
  overflow: number;
  /** Pools whose scoring threw. The run continues; this is what makes it unhealthy. */
  poolsFailed: number;

  // ---- the queued reconciliation tier (§5b) ----
  /** Queue events actionable this run. */
  queuedEvents: number;
  /** Distinct slates the queue asked for. */
  queuedSlates: number;
  /** Events held back by `notBefore` (a deferred lock). Left in the queue, not work. */
  queuedDeferred: number;
  /** Events deleted after their slate was processed. Always 0 on a dry run — see below. */
  queuedAcked: number;
  /**
   * Survivor pools a queued pass skipped because re-scoring cannot repair
   * elimination ordering until the reset-and-replay sub-PR ships — a correction,
   * or any reason at all once the week has already been scored.
   *
   * Reported, but deliberately NOT unhealthy: there is no action anyone can take
   * on the alert today, and an alarm with no remedy is how the real ones get
   * ignored (the same argument that keeps `overflow` healthy). The arming notes
   * carry the standing caveat instead.
   */
  survivorQueuedDeferred: number;
}

/**
 * Turn a run into a heartbeat verdict.
 *
 * `overflow` is reported but does NOT mark the run unhealthy: the job runs every
 * 10 minutes and a deferred pool is served by the very next one, so alarming on
 * it would cry wolf — and an alarm that cries wolf is how the real one gets
 * ignored. A pool that actually THREW is a different matter, and is the thing
 * this verdict exists to surface.
 */
export function autoScoreHeartbeat(
  r: AutoScoreResult,
  dryRun: boolean,
): { ok: boolean; error?: string; detail: Record<string, unknown> } {
  const detail = { ...r, dryRun };
  return r.poolsFailed > 0
    ? { ok: false, error: `${r.poolsFailed} pool(s) failed to score`, detail }
    : { ok: true, detail };
}
