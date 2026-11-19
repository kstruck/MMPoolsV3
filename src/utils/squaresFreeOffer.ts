import { BillingConfigSchema } from '@shared/schemas/billingConfig';

/**
 * Is hosting a squares pool free RIGHT NOW, by the live price list?
 *
 * The homepage promo (`SQUARES_FREE_PROMO`) is a build-time switch, and the
 * price it advertises lives in `settings/billing_config`, which Super-Admin
 * can change without a deploy. qodo on #792: a raised price would leave the
 * homepage promising "$0 to host" until someone rebuilt `www`. So the promo
 * also needs THIS to say yes.
 *
 * It reads the price the way the server does (functions/src/billing.ts
 * `loadBillingConfig` + functions/src/lib/quoteEngine.ts):
 *   - the WHOLE document is parsed with `BillingConfigSchema`. The server
 *     throws away a document that fails anywhere and prices from a fallback,
 *     so a partial read here could call free what the server does not.
 *   - the tiers are `pricing[formatTierMap.SQUARES]`, not `pricing.squares`
 *     (qodo on #792, round 2): squares can be mapped to a paid tier such as
 *     `season` while `pricing.squares` still reads $0.
 *
 * Yes only when that parse succeeds and every tier of the mapped list is
 * priced 0. Anything else (missing or malformed doc, empty list, any non-zero
 * price) is NO: an unconfirmed price claim is not shown.
 */
export function squaresHostingIsFree(rawBillingConfig: unknown): boolean {
    const parsed = BillingConfigSchema.safeParse(rawBillingConfig ?? {});
    if (!parsed.success) return false;
    const key = parsed.data.formatTierMap.SQUARES;
    const tiers = parsed.data.pricing[key];
    if (!tiers || tiers.length === 0) return false;
    return tiers.every((tier) => tier.price === 0);
}
