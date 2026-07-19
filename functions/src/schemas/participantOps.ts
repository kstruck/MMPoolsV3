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

/**
 * claimMySquares - SWEEP-LATER batch 17. Any authenticated user (self-service).
 *
 * guestDeviceKey IS A LOOKUP KEY - compared by strict equality against the
 * stored squares[].guestDeviceKey. It MUST NOT be trimmed or normalised here:
 * reserveSquare stores whatever the guest supplied, so normalising at the
 * boundary would silently stop matching squares whose stored key carries
 * whitespace. This is exactly the regression shipped in #194 and fixed in #195.
 *
 * Optional because omission is currently a no-op, not an error: with no key,
 * zero squares match and the call returns {success:true, warnings:[]}. Keeping
 * it optional preserves that contract.
 *
 * NOTE: a separate, KNOWN and UNFIXED security finding applies to this callable
 * - guestDeviceKey is readable from the public pool doc, so knowing it is not
 * really proof of ownership. Wrapping in validated() does NOT address that; it
 * needs a data-model or rules change. See HANDOFF.
 */
export const claimMySquaresSchema = z.strictObject({
    poolId: z.string().trim().min(1).max(200),
    guestDeviceKey: z.string().min(1).max(500).optional(),
});
