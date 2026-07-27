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
 *
 * PLAN-PAYMENT-TRUTH P1: the authoritative mode also carries the payment detail
 * fields the Bento ledger edits (method / date / note), so the panel can stop
 * calling the display-only updateEntryPayment. paidAt/paymentNote mirror
 * updateEntryPaymentSchema's shape (nullable = explicit clear). paymentMethod is
 * a BOUNDED STRING, not that schema's enum: the Bento select already offers
 * Zelle / PayPal / Card, which the enum rejects at the boundary, and no server
 * logic branches on the value — it is ledger/display metadata.
 */
export const setPaidStatusSchema = z
    .strictObject({
        poolId,
        memberUid: z.string().trim().min(1).max(200),
        isPaid: z.boolean().optional(),
        claim: z.boolean().optional(),
        // PLAN-PAYMENT-TRUTH P3 (Q2 = option B): rebuys are dues OWED, settled
        // out of band like base dues — this is the commissioner control that
        // finally gives `rebuyPaid` a writer. true settles ALL currently-owed
        // rebuy dues (rebuyPaid := rebuyOwed); false reverses to 0.
        settleRebuys: z.boolean().optional(),
        paymentMethod: z.string().trim().min(1).max(40).optional(),
        paidAt: z.number().finite().nullable().optional(),
        paymentNote: z.string().max(500).nullable().optional(),
    })
    // Exactly one mode: { poolId, memberUid } alone used to slip into the
    // authoritative branch as isPaid=undefined and write UNPAID (qodo, PR #165).
    .refine((o) => [o.isPaid, o.claim, o.settleRebuys].filter((v) => v !== undefined).length === 1, {
        message: "exactly one of isPaid (authoritative), claim (self-report) or settleRebuys is required",
    })
    // Detail fields ride only with the authoritative PAID mark. A member's
    // self-report must not stamp commissioner-facing payment details, and an
    // UNPAID mark is a full clear — sending details with it would let the
    // roster show an unpaid member with a payment method and a transaction
    // note (codex r2 on P1).
    .refine((o) => o.isPaid === true
        || (o.paymentMethod === undefined && o.paidAt === undefined && o.paymentNote === undefined), {
        message: "payment details are only valid with the authoritative isPaid: true mark",
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
