/**
 * Input schemas for the billing/checkout TARGET-NOW callables (sweep #32,
 * #67, #88): redeemCoupon, redeemPoolCredit, createCheckoutSession.
 * PURE: zod + shared quote schema + zodHelpers only.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";
import { checkoutPoolInputSchema } from "../shared/schemas/quote";

const poolId = z.string().trim().min(1).max(200);

/** redeemCoupon — { couponCode, poolId } (pool-owner check stays in handler). */
export const redeemCouponSchema = z.strictObject({
    couponCode: z.string().trim().min(1).max(64),
    poolId,
});

/** redeemPoolCredit — { poolId, bundleId?, creditId? } (preferred-credit targeting). */
export const redeemPoolCreditSchema = z.strictObject({
    poolId,
    bundleId: nullish(z.string().trim().min(1).max(200)),
    creditId: nullish(z.string().trim().min(1).max(200)),
});

/**
 * createCheckoutSession — two payload shapes, discriminated by the presence
 * of bundleType (pre-wrapper behavior): a bundle purchase sends ONLY
 * { bundleType }; a pool purchase sends the shared checkoutPoolInputSchema
 * (already the single price-input authority — server-priced either way).
 */
export const createCheckoutSessionSchema = z.union([
    z.strictObject({ bundleType: z.string().trim().min(1).max(100) }),
    checkoutPoolInputSchema,
]);

export type RedeemCouponInput = z.infer<typeof redeemCouponSchema>;
export type RedeemPoolCreditInput = z.infer<typeof redeemPoolCreditSchema>;
export type CreateCheckoutSessionInput = z.infer<typeof createCheckoutSessionSchema>;
