/**
 * Client mirror of `poolIsOver` in `functions/src/lib/settlement.ts`
 * (PLAN-SPLIT-POT-SETTLEMENT §2.3): voided (CANCELED / COMPLETED / ARCHIVED,
 * any case), closed by any route (`closedVia`), or finalized. The server rule
 * is the authority — every NFL play path refuses with `POOL_OVER` — and this
 * copy only decides what the UI OFFERS. If the two ever drift, the worst case
 * is a control shown that the server then refuses, or one hidden too early;
 * never a write the server would not have checked.
 */
const VOIDED = new Set(['CANCELED', 'COMPLETED', 'ARCHIVED']);

export function poolIsOver(pool: { status?: unknown; closedVia?: unknown; finalizedAt?: unknown } | null | undefined): boolean {
  if (!pool) return true;
  const status = typeof pool.status === 'string' ? pool.status.toUpperCase() : '';
  return VOIDED.has(status)
    || (pool.closedVia !== undefined && pool.closedVia !== null)
    || (pool.finalizedAt !== undefined && pool.finalizedAt !== null);
}
