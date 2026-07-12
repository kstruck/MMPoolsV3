/**
 * Input schemas for the participant/payment TARGET-NOW callables (sweep #69,
 * #71, #95): createClaimCode, claimByCode, setPaidStatus. PURE: zod only.
 */

import { z } from "zod";

const poolId = z.string().trim().min(1).max(200);

/** createClaimCode — PUBLIC (guest flow): { poolId, guestDeviceKey }. */
export const createClaimCodeSchema = z.strictObject({
    poolId,
    guestDeviceKey: z.string().trim().min(1).max(200),
});

/** claimByCode — { claimCode } (short generated code). */
export const claimByCodeSchema = z.strictObject({
    claimCode: z.string().trim().min(1).max(32),
});

/**
 * setPaidStatus — dual-mode contract preserved exactly:
 *   claim present  → member self-report (own record only, enforced in handler)
 *   claim absent   → authoritative commissioner/owner/admin mark via isPaid
 * dbService today only sends { poolId, memberUid, isPaid }.
 */
export const setPaidStatusSchema = z
    .strictObject({
        poolId,
        memberUid: z.string().trim().min(1).max(200),
        isPaid: z.boolean().optional(),
        claim: z.boolean().optional(),
    })
    // Exactly one mode: { poolId, memberUid } alone used to slip into the
    // authoritative branch as isPaid=undefined and write UNPAID (qodo, PR #165).
    .refine((o) => (o.isPaid !== undefined) !== (o.claim !== undefined), {
        message: "exactly one of isPaid (authoritative) or claim (self-report) is required",
    });

export type CreateClaimCodeInput = z.infer<typeof createClaimCodeSchema>;
export type ClaimByCodeInput = z.infer<typeof claimByCodeSchema>;
export type SetPaidStatusInput = z.infer<typeof setPaidStatusSchema>;
