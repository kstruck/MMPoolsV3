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

export type SendPoolInvitesInput = z.infer<typeof sendPoolInvitesSchema>;
export type SubmitBracketEntryInput = z.infer<typeof submitBracketEntrySchema>;
