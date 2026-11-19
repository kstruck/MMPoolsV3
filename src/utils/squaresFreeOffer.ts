import { BillingConfigSchema } from '@shared/schemas/billingConfig';

/**
 * Is hosting a squares pool free RIGHT NOW, by the live price list?
 *
 * The homepage promo (`SQUARES_FREE_PROMO`) is a build-time switch, and the
 * price it advertises lives in `settings/billing_config.pricing.squares`,
 * which Super-Admin can change without a deploy. qodo on #792: a raised price
 * would leave the homepage promising "$0 to host" until someone rebuilt `www`.
 * So the promo also needs THIS to say yes.
 *
 * Yes only when the squares tiers parse with the server's own schema and
 * every tier is priced 0. Anything else (missing doc, missing tiers, a
 * malformed tier, an empty list, any non-zero price) is NO: an unconfirmed
 * price claim is not shown.
 */
const squaresTiersSchema = BillingConfigSchema.shape.pricing.shape.squares;

export function squaresHostingIsFree(rawBillingConfig: unknown): boolean {
    const pricing = (rawBillingConfig as { pricing?: { squares?: unknown } } | null | undefined)?.pricing;
    const parsed = squaresTiersSchema.safeParse(pricing?.squares);
    if (!parsed.success || parsed.data.length === 0) return false;
    return parsed.data.every((tier) => tier.price === 0);
}
