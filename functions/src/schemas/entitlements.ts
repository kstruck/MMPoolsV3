/**
 * Input schemas for the entitlements TARGET-NOW callables: adminGrantEntitlement,
 * adminRevokeEntitlement. PURE: zod only, no firebase imports.
 */

import { z } from "zod";

const targetUid = z.string().trim().min(1).max(200);
const bundleId = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(1).max(2000);

/**
 * Shared grant fields. poolType stays a plain optional string: the handler
 * folds unknown/"ALL" values to "ALL" via isPoolType (lenient by design —
 * pre-wrapper behavior preserved). Numbers are normalized (floor/clamp) in the
 * handler; the MAX_CREDITS_PER_BUNDLE cap stays there too (specific message).
 */
const grantCommon = {
    targetUid,
    reason,
    name: z.string().max(200).optional(),
    price: z.number().finite().optional(),
    poolType: z.string().max(100).optional(),
    maxPlayersPerPool: z.number().finite().optional(),
};

/** adminGrantEntitlement — discriminated on `productKind` (sweep C1). */
export const adminGrantEntitlementSchema = z.discriminatedUnion("productKind", [
    z.strictObject({
        ...grantCommon,
        productKind: z.literal("CREDIT_BUNDLE"),
        creditsTotal: z.number().finite().min(1),
    }),
    z.strictObject({
        ...grantCommon,
        productKind: z.literal("UNLIMITED_PASS"),
        termDays: z.number().finite().min(1),
    }),
]);

/** adminRevokeEntitlement — discriminated on `scope` (sweep C1). */
export const adminRevokeEntitlementSchema = z.discriminatedUnion("scope", [
    z.strictObject({ scope: z.literal("bundle"), bundleId, reason }),
    z.strictObject({ scope: z.literal("credit"), bundleId, creditId: z.string().trim().min(1).max(200), reason }),
    z.strictObject({ scope: z.literal("pass"), bundleId, reason }),
]);

export type AdminGrantEntitlementInput = z.infer<typeof adminGrantEntitlementSchema>;
export type AdminRevokeEntitlementInput = z.infer<typeof adminRevokeEntitlementSchema>;
