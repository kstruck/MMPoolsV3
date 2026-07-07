// Pure client-side derivations for the Monetization dashboard
// (PLAN-BUYFLOW-OVERHAUL Phase 6 #21). ALL revenue/liability numbers are
// computed here from the immutable billingCharges ledger + coupons + bundles —
// no server round-trip, no price math beyond summing what the ledger recorded.
// Kept pure so the components stay thin and the arithmetic is obvious.
import type {
    MonetizationBillingCharge,
    MonetizationBundle,
    MonetizationCoupon,
    MonetizationCouponUsage,
} from '../../../services/dbService';

export type Period = 'day' | 'week' | 'month';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Format a dollar number as USD. Negative (refund/dispute) shown with a minus. */
export function fmtUSD(n: number): string {
    const v = Number.isFinite(n) ? n : 0;
    const sign = v < 0 ? '-' : '';
    return `${sign}$${Math.abs(v).toFixed(2)}`;
}

/** Format an epoch-ms timestamp compactly, or '—' if absent. */
export function fmtDate(ms: number | undefined): string {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
    try {
        return new Date(ms).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return '—';
    }
}

export function fmtDateTime(ms: number | undefined): string {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
    try {
        return new Date(ms).toLocaleString();
    } catch {
        return '—';
    }
}

/** Stripe test-mode deep link for a payment intent (falls back to the payments list). */
export function stripePaymentLink(paymentIntentId?: string): string {
    if (paymentIntentId && paymentIntentId.trim()) {
        return `https://dashboard.stripe.com/test/payments/${paymentIntentId.trim()}`;
    }
    return 'https://dashboard.stripe.com/test/payments';
}

/** Bucket key for a timestamp under a period grouping (YYYY-MM-DD / ISO-week / YYYY-MM). */
export function periodKey(ms: number, period: Period): string {
    const d = new Date(ms);
    if (period === 'day') {
        return d.toISOString().slice(0, 10); // YYYY-MM-DD
    }
    if (period === 'month') {
        return d.toISOString().slice(0, 7); // YYYY-MM
    }
    // week — ISO week key YYYY-Www
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (tmp.getUTCDay() + 6) % 7; // Mon=0
    tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
    const week =
        1 +
        Math.round(
            ((tmp.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
        );
    return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface RevenueTotals {
    gross: number; // positive charge rows (pool + bundle), pre-netting
    discounts: number; // sum of coupon-discounted amount is NOT stored; count of coupon rows
    refunds: number; // sum of refund rows (negative)
    disputes: number; // sum of dispute rows (negative)
    net: number; // everything summed (refunds/disputes are negative)
    byKind: { pool: number; bundle: number; refund: number; dispute: number };
    couponRedemptions: number; // count of charge rows that carried a couponCode
    chargeCount: number;
}

/** Sum the ledger into gross/net/by-kind. Refund/dispute rows carry negatives. */
export function totalsFor(charges: MonetizationBillingCharge[]): RevenueTotals {
    const t: RevenueTotals = {
        gross: 0,
        discounts: 0,
        refunds: 0,
        disputes: 0,
        net: 0,
        byKind: { pool: 0, bundle: 0, refund: 0, dispute: 0 },
        couponRedemptions: 0,
        chargeCount: 0,
    };
    for (const c of charges) {
        const amt = Number(c.amount) || 0;
        t.net += amt;
        t.chargeCount += 1;
        const kind = c.kind ?? 'pool';
        if (kind in t.byKind) t.byKind[kind as keyof RevenueTotals['byKind']] += amt;
        if (kind === 'pool' || kind === 'bundle') t.gross += amt;
        if (kind === 'refund') t.refunds += amt;
        if (kind === 'dispute') t.disputes += amt;
        if (c.couponCode) t.couponRedemptions += 1;
    }
    return t;
}

export interface PeriodBucket {
    key: string;
    net: number;
    pool: number;
    bundle: number;
    refunds: number;
    disputes: number;
    count: number;
}

/** Group ledger rows into period buckets, sorted ascending by key. */
export function bucketByPeriod(charges: MonetizationBillingCharge[], period: Period): PeriodBucket[] {
    const map = new Map<string, PeriodBucket>();
    for (const c of charges) {
        if (typeof c.at !== 'number') continue;
        const key = periodKey(c.at, period);
        let b = map.get(key);
        if (!b) {
            b = { key, net: 0, pool: 0, bundle: 0, refunds: 0, disputes: 0, count: 0 };
            map.set(key, b);
        }
        const amt = Number(c.amount) || 0;
        b.net += amt;
        b.count += 1;
        const kind = c.kind ?? 'pool';
        if (kind === 'pool') b.pool += amt;
        else if (kind === 'bundle') b.bundle += amt;
        else if (kind === 'refund') b.refunds += amt;
        else if (kind === 'dispute') b.disputes += amt;
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Group ledger rows by pool format/tier (the `tier` + `bundleType` fields). */
export interface FormatRow {
    label: string;
    net: number;
    count: number;
}
export function byFormat(charges: MonetizationBillingCharge[]): FormatRow[] {
    const map = new Map<string, FormatRow>();
    for (const c of charges) {
        const label =
            c.kind === 'bundle'
                ? `bundle:${c.bundleType ?? 'unknown'}`
                : c.tier ?? c.kind ?? 'unknown';
        let r = map.get(label);
        if (!r) {
            r = { label, net: 0, count: 0 };
            map.set(label, r);
        }
        r.net += Number(c.amount) || 0;
        r.count += 1;
    }
    return [...map.values()].sort((a, b) => b.net - a.net);
}

// --- Coupon derivations -------------------------------------------------------

/** Is a usageLog entry a live (confirmed+pending+legacy) use? Released excluded. */
export function isLiveCouponUse(e: MonetizationCouponUsage): boolean {
    return e.status !== 'released';
}

/** Count live uses (confirmed + pending + legacy). */
export function liveUseCount(coupon: MonetizationCoupon): number {
    return (coupon.usageLog ?? []).filter(isLiveCouponUse).length;
}

/** Count pending reservations only. */
export function pendingUseCount(coupon: MonetizationCoupon): number {
    return (coupon.usageLog ?? []).filter((e) => e.status === 'pending').length;
}

/** Count confirmed uses (incl. legacy entries with no status). */
export function confirmedUseCount(coupon: MonetizationCoupon): number {
    return (coupon.usageLog ?? []).filter((e) => e.status === 'confirmed' || (!e.status && !e.releasedAt)).length;
}

/** Uses remaining = maxUses − live (confirmed+pending). Undefined when unlimited. */
export function usesRemaining(coupon: MonetizationCoupon): number | undefined {
    if (typeof coupon.maxUses !== 'number') return undefined;
    return Math.max(0, coupon.maxUses - liveUseCount(coupon));
}

/** True if the coupon expires within `days` (default 7) and is not already expired. */
export function isExpiringSoon(coupon: MonetizationCoupon, nowMs: number, days = 7): boolean {
    if (typeof coupon.expiresAt !== 'number') return false;
    if (coupon.expiresAt <= nowMs) return false;
    return coupon.expiresAt - nowMs <= days * DAY_MS;
}

/** Best event timestamp for a usage entry (confirmed > reserved > legacy usedAt). */
export function couponUsageMs(e: MonetizationCouponUsage): number | undefined {
    if (typeof e.confirmedAt === 'number') return e.confirmedAt;
    if (typeof e.reservedAt === 'number') return e.reservedAt;
    if (typeof e.usedAt === 'number') return e.usedAt;
    return undefined;
}

// --- Bundle liability ---------------------------------------------------------

export interface LiabilityRow {
    ownerId: string;
    outstandingCredits: number;
    dollarValue: number;
    bundleCount: number;
}

export interface LiabilitySummary {
    totalOutstandingCredits: number;
    totalDollarLiability: number;
    perOwner: LiabilityRow[];
    revokedCount: number;
}

/**
 * Outstanding liability = Σ (creditsTotal − creditsUsed) over ACTIVE
 * CREDIT_BUNDLE docs, valued at each bundle's per-pool snapshot price. Unlimited
 * passes have no credit liability (creditsTotal 0). Revoked/exhausted/expired
 * bundles are excluded from liability but counted in `revokedCount`.
 */
export function computeLiability(bundles: MonetizationBundle[]): LiabilitySummary {
    const perOwnerMap = new Map<string, LiabilityRow>();
    let totalCredits = 0;
    let totalDollars = 0;
    let revokedCount = 0;

    for (const b of bundles) {
        if (b.status === 'revoked') revokedCount += 1;
        if (b.status !== 'active') continue;
        if (b.productKind !== 'CREDIT_BUNDLE') continue;
        const total = Number(b.creditsTotal) || 0;
        const used = Number(b.creditsUsed) || 0;
        const outstanding = Math.max(0, total - used);
        if (outstanding <= 0) continue;
        const perPool = Number(b.productSnapshot?.price) || 0;
        const perCreditValue = total > 0 ? perPool / total : 0;
        const dollars = outstanding * perCreditValue;

        totalCredits += outstanding;
        totalDollars += dollars;

        const owner = b.ownerId ?? 'unknown';
        let row = perOwnerMap.get(owner);
        if (!row) {
            row = { ownerId: owner, outstandingCredits: 0, dollarValue: 0, bundleCount: 0 };
            perOwnerMap.set(owner, row);
        }
        row.outstandingCredits += outstanding;
        row.dollarValue += dollars;
        row.bundleCount += 1;
    }

    return {
        totalOutstandingCredits: totalCredits,
        totalDollarLiability: totalDollars,
        perOwner: [...perOwnerMap.values()].sort((a, b) => b.dollarValue - a.dollarValue),
        revokedCount,
    };
}
