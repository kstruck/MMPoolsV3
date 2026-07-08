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
}

export function isActivePoolForStats(pool: PoolDocLike, id?: string): boolean {
  if (pool.closedVia === 'ADMIN_CLOSE') return false;
  if (pool.status === 'CANCELED' || pool.status === 'COMPLETED' || pool.status === 'archived') return false;
  if (pool.closedVia || pool.isFinal) return false;
  const key = id || pool.id || pool.slug || '';
  if (typeof key === 'string' && key.startsWith('sim-')) return false;
  return true;
}
