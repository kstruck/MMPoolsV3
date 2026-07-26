// Canonical "is this pool a TEST pool?" predicate — the SINGLE source of truth
// for every stats surface, shared by src/ (the SuperAdmin Overview's client-side
// `liveStats`) and functions/ (the `stats/global` writers).
//
// It lives in shared/ deliberately. PLAN-STATS-INTEGRITY §2.4 found the reported
// bug WAS the client/server split: the Overview cards aggregate pools in the
// browser and never read `stats/global`, so a server-only filter changed nothing
// on the screen Kevin was looking at. Two copies of this rule is the defect, not
// an implementation detail — import it, do not re-derive it.
//
// Test pools are excluded from every published number: prize volume, charity
// raised, pool counts, entry counts.

import { NFL_SEASON_TYPES } from './poolTypes';

/** The pool-document fields this predicate reads. Everything is optional and
 *  untyped-tolerant: it runs against raw Firestore data on both sides. */
export interface TestPoolDocLike {
  simRunId?: unknown;
  season?: unknown;
  type?: unknown;
  seasonType?: unknown;
  isTestPool?: unknown;
}

/**
 * Sim-harness pools: a persisted `simRunId`, a `sim-` season, or a `sim-` doc id.
 *
 * Moved here from functions/src/nflFinalize.ts (which now re-exports it) so the
 * client can apply the same rule. Behaviour is byte-for-byte the one the finalize
 * sweep, the lock watch and the auto-scorer already depend on — do not "improve"
 * it without checking those three callers.
 */
export function isSimPool(pool: TestPoolDocLike | null | undefined, poolId?: string): boolean {
  return Boolean(
    pool?.simRunId ||
    String(pool?.season || '').startsWith('sim-') ||
    (poolId || '').startsWith('sim-'),
  );
}

/**
 * A pool is a TEST pool — excluded from every stat — if ANY of three arms holds
 * (PLAN-STATS-INTEGRITY §8.1, as amended by Kevin's rulings of 2026-07-25):
 *
 *   1. `isSimPool` — the sim harness's own trust anchor.
 *   2. NFL preseason (`seasonType == 1`). Kevin: "Preseason games are for my
 *      testing only, not a real season pool." This replaced an earlier
 *      creation-date cutoff of 2026-09-09: the two expressed the SAME intent, but
 *      `seasonType` reads it off the document instead of guessing from a calendar,
 *      and so does NOT wrongly exclude the real January NFL-playoff and March
 *      Madness pools that a date line would have deleted.
 *   3. An explicit `isTestPool: true` flag on the document.
 *
 * Arm 3 is the escape hatch for history. §2.6 found that the legacy Squares,
 * Props and Playoff test runners create pools through the normal path with NO
 * marker and a non-preseason type, so arms 1 and 2 cannot see them. Kevin labels
 * those by hand once the census (§8.2) names them — as DATA, with no code change
 * and no redeploy. The field is SERVER-ONLY: `firestore.rules`
 * `protectedFieldsUnchanged()` lists it, so a pool manager can neither set it to
 * hide a real pool's volume nor clear it to inflate the totals with a test one.
 */
export function isTestPool(pool: TestPoolDocLike | null | undefined, poolId?: string): boolean {
  if (isSimPool(pool, poolId)) return true;
  if (pool?.isTestPool === true) return true;
  return isPreseasonNflPool(pool);
}

/** NFL season pool (PICKEM/SURVIVOR/MARGIN) on seasonType 1 = preseason. */
function isPreseasonNflPool(pool: TestPoolDocLike | null | undefined): boolean {
  if (!(NFL_SEASON_TYPES as readonly string[]).includes(String(pool?.type ?? ''))) return false;
  // `|| 2`, NOT `?? 2` — the repo-wide convention for reading this field
  // (functions/src/nflFinalize.ts poolInLiveScope, nflAutoScore.ts:131). The
  // create schema does not always persist it, and it can arrive as a string.
  return Number((pool?.seasonType as number | string | undefined) || 2) === 1;
}
