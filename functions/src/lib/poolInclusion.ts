// Functions-side mirror of src/utils/poolSport.ts isActiveManagedPool — the shared
// inclusion predicate for commissioner rosters/stats. Excludes finished, admin-closed,
// canceled, archived, and sim-* test pools (PLAN-COMMISSIONER-DASH.md step 13).

export interface PoolDocLike {
  id?: string;
  slug?: string;
  type?: string;
  status?: string;
  isFinal?: boolean;
  closedVia?: string;
  simRunId?: string;
  season?: string;
}

/**
 * The STATUS half of the inclusion rule: finished, admin-closed, canceled or archived.
 *
 * Split out of `isActivePoolForStats` for PLAN-PAYMENT-TRUTH P4 so the Member Record
 * backfill can gate on "is it finished?" INDEPENDENTLY of "is it a sim pool?". Those
 * are two different questions and `isActivePoolForStats` answered both with one
 * boolean, which is why the backfill's old `includeAll` flag had to widen the sweep
 * onto sim data in order to reach finished pools at all (Kevin's Q3, 2026-07-26).
 *
 * PURE EXTRACTION — the three conditions and their order are unchanged, and
 * `isActivePoolForStats` below composes it to exactly its previous behaviour. Its
 * other two callers (`consensus.ts`, `lib/commissionerAggregate.ts`) see no change.
 */
export function isFinishedPool(pool: PoolDocLike): boolean {
  if (pool.closedVia === 'ADMIN_CLOSE') return true;
  if (pool.status === 'CANCELED' || pool.status === 'COMPLETED' || pool.status === 'archived') return true;
  if (pool.closedVia || pool.isFinal) return true;
  return false;
}

export function isActivePoolForStats(pool: PoolDocLike, id?: string): boolean {
  if (isFinishedPool(pool)) return false;
  // Test Pools: the persisted simRunId field (or a sim- season) is the trust anchor —
  // callable-created sim pools have server-generated doc IDs, so an id/slug prefix
  // check alone excludes nothing (PLAN-NFL-SIM-HARNESS Phase 0.4, Codex R1#3).
  if (pool.simRunId || String(pool.season || '').startsWith('sim-')) return false;
  const key = id || pool.id || pool.slug || '';
  if (typeof key === 'string' && key.startsWith('sim-')) return false;
  return true;
}
