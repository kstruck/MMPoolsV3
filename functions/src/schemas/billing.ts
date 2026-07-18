/**
 * Input schema for the billing.ts SWEEP-LATER callable: validateBillingAccess.
 * PURE: zod only, no firebase imports.
 *
 * getPoolQuote (the other SWEEP-LATER row in billing.ts) reuses the existing
 * shared poolQuoteInputSchema (functions/src/shared/schemas/quote.ts) as-is —
 * that schema is deliberately NOT .strict() (matrix note) and is a
 * cross-boundary shared contract, so it stays untouched here; only the
 * auth+parse gate moves onto validated().
 */

import { z } from "zod";

const poolId = z.string().trim().min(1).max(200);

/** validateBillingAccess (PUBLIC/ANON, no auth required) — { poolId, feature? }. */
export const validateBillingAccessSchema = z.strictObject({
    poolId,
    feature: z.string().trim().min(1).max(100).optional(),
});

export type ValidateBillingAccessInput = z.infer<typeof validateBillingAccessSchema>;
