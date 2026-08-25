import type { BillingStatus } from '../../types';

/**
 * Which of a commissioner's pools /pricing can actually sell them
 * (PLAN-WIZARD-BUYFLOW-FIXES T3 / G3).
 *
 * The dead end this closes: the page listed only `trial` and `grace_period`
 * pools, and the checkout card rendered ONLY inside that branch. But the 10/10
 * free-plan lock banner and the lock email both send the commissioner here —
 * `BillingGate` and `functions/src/billing.ts` — and a `free` (or `locked`)
 * pool appeared nowhere on the page, so the single most important monetization
 * moment ended on an estimate-only calculator.
 *
 * `active` is deliberately absent: that pool is paid and has nothing to sell.
 */
const UPGRADEABLE_STATUSES: readonly BillingStatus[] = ['trial', 'grace_period', 'free', 'locked'];

export function isUpgradeableStatus(status: unknown): boolean {
    return (UPGRADEABLE_STATUSES as readonly string[]).includes(String(status ?? 'free'));
}

export interface UpgradeablePool {
    id?: string;
    ownerId?: string;
    createdByUid?: string;
    managerUid?: string;
    billing?: { status?: BillingStatus } | null;
}

/**
 * Can `uid` buy hosting for this pool? Mirrors the server's
 * `assertCheckoutOwnership` → `isPoolOwnerOrManager`, including its `||`
 * fallback for a legacy empty-string `ownerId`.
 *
 * Client-side this only decides whether to OFFER checkout. The server refuses
 * regardless; showing a pay button that always fails is the point of the check.
 * Co-commissioners are excluded on purpose — hosting is the owner's bill and
 * the callable says so.
 */
export function canCheckoutPool(pool: UpgradeablePool | null | undefined, uid: string | undefined): boolean {
    if (!pool || !uid) return false;
    const owner = pool.ownerId || pool.createdByUid;
    return uid === owner || uid === pool.managerUid;
}

/** The pools to list as upgradeable: owned by this user and not already paid. */
export function upgradeablePools<T extends UpgradeablePool>(pools: T[], uid: string | undefined): T[] {
    return pools.filter((p) => canCheckoutPool(p, uid) && isUpgradeableStatus(p.billing?.status));
}

/** Short badge for the pool row, so the list stops calling every pool a trial. */
export function upgradeStatusLabel(status: unknown): string {
    switch (String(status ?? 'free')) {
        case 'trial': return 'Trial';
        case 'grace_period': return 'Grace period';
        case 'locked': return 'Locked';
        case 'active': return 'Active';
        default: return 'Free plan';
    }
}
