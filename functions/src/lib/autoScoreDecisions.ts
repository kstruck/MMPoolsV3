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
  const status = typeof pool.status === 'string' ? pool.status.toUpperCase() : '';
  return TERMINAL_POOL_STATUSES.has(status);
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
 * KNOWN GAP (PR-B′, deliberate): entry mutations are NOT a term. `submitNFLPicks`
 * captures its clock before its transaction, so a valid submission can commit
 * after the scorer has read entries; with games and settings unchanged this hash
 * matches and that entry keeps an omitted grade until something else moves.
 * Closed by the per-entry revision watermark, which §7 requires before arming.
 */
export function computeWeekFingerprint(
  pool: { type?: string; settings?: any },
  week: number,
  games: NFLGame[],
  now: number,
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
    .update([`week=${week}`, ...gameTerms, ...settingsTerms, ...lockTerms].join('|'))
    .digest('hex');
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
