/**
 * Input schemas for the playoff-entry TARGET-NOW callables (sweep #58, #59):
 * submitPlayoffPicks, managePlayoffEntry. PURE: zod + zodHelpers only.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";

const poolId = z.string().trim().min(1).max(200);
const entryId = z.string().trim().min(1).max(200);

/**
 * submitPlayoffPicks — rankings maps teamId → points. Team-id membership and
 * the 0..teamCount point bound REQUIRE pool context, so they stay in the
 * handler; the gate bounds shape only (<=100 keys, ints 0-1000). entryId is
 * null for a NEW entry (RankingForm sends null explicitly).
 */
export const submitPlayoffPicksSchema = z.strictObject({
    poolId,
    rankings: z
        .record(z.string().min(1).max(100), z.number().int().min(0).max(1000))
        .refine((o) => Object.keys(o).length <= 100, { message: "too many rankings" }),
    tiebreaker: nullish(z.union([z.number().finite(), z.string().max(50)])),
    entryId: nullish(entryId),
    entryName: nullish(z.string().max(200)),
});

/**
 * managePlayoffEntry — discriminated on `action`. togglePaid's `value` is now
 * a strict boolean (the old code wrote it raw into entries.{id}.paid); delete
 * sends no value (undefined is dropped by the Firebase serializer).
 */
export const managePlayoffEntrySchema = z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("togglePaid"), poolId, entryId, value: z.boolean() }),
    z.strictObject({ action: z.literal("delete"), poolId, entryId }),
]);

export type SubmitPlayoffPicksInput = z.infer<typeof submitPlayoffPicksSchema>;
export type ManagePlayoffEntryInput = z.infer<typeof managePlayoffEntrySchema>;
