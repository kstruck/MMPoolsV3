/**
 * Input schemas for the pool-core TARGET-NOW callables (sweep #20, #21, #34,
 * #36): createPool, updatePoolSettings, createNFLPool, submitNFLPicks.
 * PURE: zod + zodHelpers only.
 *
 * createPool / createNFLPool are TARGET-NOW-PERMISSIVE (ADR-0001): they get
 * the wrapper (auth + App Check monitor + object envelope) but the payload
 * stays an open record — stripPrivilegedPoolFields + the shared
 * validateCreateInput gate keep doing the field-level work in the handler.
 * Tightening the create envelope is its own future change.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";
import { ENTRY_NAME_MAX, MAX_ENTRIES_PER_USER_CAP } from "../shared/multiEntry";

const poolId = z.string().trim().min(1).max(200);

/** Permissive create envelope: any object (arrays/primitives rejected). */
export const createPoolPermissiveSchema = z.record(z.string(), z.unknown());

/** updatePoolSettings — updates stays open: buildPoolSettingsUpdate enforces the editability matrix. */
export const updatePoolSettingsSchema = z.strictObject({
    poolId,
    updates: z.record(z.string(), z.unknown()),
});

/** submitNFLPicks — the exact dbService payload; per-pick validation needs pool/week context (handler). */
export const submitNFLPicksSchema = z.strictObject({
    poolId,
    week: z.number().int().min(1).max(23),
    picks: z
        .record(z.string().min(1).max(100), z.string().min(1).max(100))
        .refine((o) => Object.keys(o).length <= 50, { message: "too many picks" }),
    confidence: nullish(
        z.record(z.string().min(1).max(100), z.number().int().min(0).max(1000))
            .refine((o) => Object.keys(o).length <= 50, { message: "too many confidence entries" }),
    ),
    tiebreakerPrediction: nullish(z.number().finite()),
    requestId: nullish(z.string().max(200)),
    // PLAN-MULTI-ENTRY T2 (D1/D7). Which of the caller's entries this write
    // addresses — 1..max, default 1 — and an optional display name for it (K5).
    // The server derives the entry id from ctx.subjectUid + entryIndex; the
    // client only ever sends a small integer, so the id is not forgeable.
    entryIndex: nullish(z.number().int().min(1).max(MAX_ENTRIES_PER_USER_CAP)),
    entryName: nullish(z.string().trim().min(1).max(ENTRY_NAME_MAX)),
});

export type UpdatePoolSettingsInput = z.infer<typeof updatePoolSettingsSchema>;
export type SubmitNFLPicksInput = z.infer<typeof submitNFLPicksSchema>;
