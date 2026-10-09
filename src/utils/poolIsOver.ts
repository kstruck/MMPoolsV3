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

/**
 * A settled pool whose follow-up is still owed: the Super-Admin audit row, or
 * the member emails (some failed, or never sent). Mirrors the FOLLOW_UP row of
 * `settlementPhase` (functions/src/lib/settlement.ts). The manager panel stays
 * up in this state so the owner can retry from the product, not out of band.
 */
export function settlementFollowUpOwed(
  settlement: { notifyMembers?: unknown; adminAuditedAt?: unknown; emailedAt?: unknown } | null | undefined,
): boolean {
  if (!settlement) return false;
  const missing = (v: unknown) => v === undefined || v === null;
  return missing(settlement.adminAuditedAt) || (settlement.notifyMembers === true && missing(settlement.emailedAt));
}

export function poolIsOver(pool: { status?: unknown; closedVia?: unknown; finalizedAt?: unknown } | null | undefined): boolean {
  if (!pool) return true;
  const status = typeof pool.status === 'string' ? pool.status.toUpperCase() : '';
  return VOIDED.has(status)
    || (pool.closedVia !== undefined && pool.closedVia !== null)
    || (pool.finalizedAt !== undefined && pool.finalizedAt !== null);
}
