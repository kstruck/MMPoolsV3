/**
 * Input schemas for the pool-engagement TARGET-NOW callables: sendPoolInvites
 * (invites.ts — email fan-out abuse surface) and submitBracketEntry
 * (bracketEntries.ts — sweep C7: had NO head-level validation; the internal
 * helper trusted request.data wholesale). PURE: zod + zodHelpers only.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";

const poolId = z.string().trim().min(1).max(200);

/**
 * sendPoolInvites — limits mirror the old hand checks (50 addresses / 500-char
 * note). Each address stays a plain string at the gate: per-address validity is
 * judged in the send loop (EMAIL_REGEX → `invalid` counter) so one junk address
 * skips, not rejects, the batch — pre-wrapper behavior preserved.
 */
export const sendPoolInvitesSchema = z.strictObject({
    poolId,
    emails: z.array(z.string().max(320)).min(1).max(50),
    personalNote: nullish(z.string().max(500)),
});

/**
 * submitBracketEntry — the exact dbService payload
 * { poolId, entryId, picks, tieBreakerPrediction?, name? }. picks maps
 * slotId → teamId. Optionals accept null (Firebase serializer, C2).
 */
export const submitBracketEntrySchema = z.strictObject({
    poolId,
    entryId: z.string().trim().min(1).max(200),
    // A full NCAA bracket is 63 games (+ play-ins); 200 keys is a generous
    // ceiling that still blocks txn-amplification payloads (qodo, PR #164).
    picks: z
        .record(z.string().min(1).max(100), z.string().min(1).max(100))
        .refine((o) => Object.keys(o).length <= 200, { message: "too many picks" }),
    tieBreakerPrediction: nullish(z.number().finite()),
    name: nullish(z.string().max(200)),
});

/**
 * createBracketEntry — the real dbService payload is { poolId, name,
 * tiebreakerScore? } (createBracketEntry(poolId, data) spreads
 * data = { name, tiebreakerScore? }). The handler only reads poolId + name,
 * but tiebreakerScore MUST stay accepted or a strict schema would reject
 * legitimate calls that send it (verify-before-strict, PLAN #1).
 */
export const createBracketEntrySchema = z.strictObject({
    poolId,
    name: z.string().trim().min(1).max(200),
    tiebreakerScore: nullish(z.number().finite()),
});

/**
 * updateBracketEntry — dbService payload
 * { poolId, entryId, picks, tieBreakerPrediction?, name? }. picks is required
 * (handler throws on a missing picks) and mirrors submitBracketEntry's shape.
 */
export const updateBracketEntrySchema = z.strictObject({
    poolId,
    entryId: z.string().trim().min(1).max(200),
    picks: z
        .record(z.string().min(1).max(100), z.string().min(1).max(100))
        .refine((o) => Object.keys(o).length <= 200, { message: "too many picks" }),
    tieBreakerPrediction: nullish(z.number().finite()),
    name: nullish(z.string().max(200)),
});

/** deleteBracketEntry — dbService payload { poolId, entryId }. */
export const deleteBracketEntrySchema = z.strictObject({
    poolId,
    entryId: z.string().trim().min(1).max(200),
});

const entryId = z.string().trim().min(1).max(200);

/**
 * updateEntryPayment — dbService payload
 * { poolId, entryId, paidStatus, paymentMethod?, paidAt?, paymentNote? }.
 * paidAt/paymentNote deliberately use `.nullable().optional()` NOT nullish():
 * the handler stores an explicit `null` to CLEAR the field (parity with the
 * old raw client write), so null must survive to the handler — mapping it to
 * undefined (nullish) would silently break the clear semantics.
 */
export const updateEntryPaymentSchema = z.strictObject({
    poolId,
    entryId,
    paidStatus: z.enum(["PAID", "UNPAID"]),
    paymentMethod: z.enum(["Cash", "Check", "Venmo", "Google Pay", "Cash.me", "Other"]).optional(),
    paidAt: z.number().finite().nullable().optional(),
    paymentNote: z.string().max(500).nullable().optional(),
});

/**
 * adminUpdateEntryOverrides (SUPER_ADMIN) — { poolId, entryId, overrides }.
 * overrides is an allowlisted, strict, non-empty map of the 4 override fields
 * to finite numbers (mirrors the handler's OVERRIDE_FIELDS gate).
 */
export const adminUpdateEntryOverridesSchema = z.strictObject({
    poolId,
    entryId,
    overrides: z
        .strictObject({
            score: z.number().finite().optional(),
            payout: z.number().finite().optional(),
            tiebreakerScore: z.number().finite().optional(),
            tieBreakerPrediction: z.number().finite().optional(),
        })
        .refine((o) => Object.keys(o).length > 0, { message: "No overrides provided." }),
});

/** adminDeleteEntry (SUPER_ADMIN) — { poolId, entryId }. */
export const adminDeleteEntrySchema = z.strictObject({ poolId, entryId });

export type SendPoolInvitesInput = z.infer<typeof sendPoolInvitesSchema>;
export type SubmitBracketEntryInput = z.infer<typeof submitBracketEntrySchema>;
export type CreateBracketEntryInput = z.infer<typeof createBracketEntrySchema>;
export type UpdateBracketEntryInput = z.infer<typeof updateBracketEntrySchema>;
export type DeleteBracketEntryInput = z.infer<typeof deleteBracketEntrySchema>;
export type UpdateEntryPaymentInput = z.infer<typeof updateEntryPaymentSchema>;
export type AdminUpdateEntryOverridesInput = z.infer<typeof adminUpdateEntryOverridesSchema>;
export type AdminDeleteEntryInput = z.infer<typeof adminDeleteEntrySchema>;
