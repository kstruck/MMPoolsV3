/**
 * Input schemas for the poolOps.ts SWEEP-LATER callables: recalculatePoolWinners,
 * toggleWinnerPaid, fixParticipantIds. PURE: zod only, no firebase imports.
 */

import { z } from "zod";

const poolId = z.string().trim().min(1).max(200);
const winnerId = z.string().trim().min(1).max(200);

/** recalculatePoolWinners (SUPER_ADMIN) — { poolId }. */
export const recalculatePoolWinnersSchema = z.strictObject({
    poolId,
});

/** toggleWinnerPaid (owner/SUPER_ADMIN, checked in-handler) — { poolId, winnerId }. */
export const toggleWinnerPaidSchema = z.strictObject({
    poolId,
    winnerId,
});

/**
 * fixParticipantIds (SUPER_ADMIN) — one optional dryRun flag. Defaults to
 * `true` (dry-run) at the schema layer — this is a prod batch-mutation
 * backfill, and the repo convention (PRs #127/#129/#180) is that these must
 * fail safe when the flag is omitted, not silently run live.
 */
export const fixParticipantIdsSchema = z.strictObject({
    dryRun: z.boolean().optional().default(true),
    // Resume cursor (PLAN-API-TRUST-BOUNDARY Phase 4) — paged run,
    // deterministic documentId order; null→undefined (JS SDK null encoding),
    // NOT trimmed (compared against a document id verbatim).
    afterPoolId: z.union([z.string().min(1).max(1500), z.null()])
        .optional()
        .transform((v) => (v === null ? undefined : v)),
});

/**
 * clearLegacyCoManagers (SUPER_ADMIN) — PLAN-CO-COMMISSIONERS D2 step 2, the
 * one-off audited clear of every legacy `coManagers` array. Same fail-safe
 * dryRun default as fixParticipantIds.
 */
export const clearLegacyCoManagersSchema = z.strictObject({
    dryRun: z.boolean().optional().default(true),
});

export type RecalculatePoolWinnersInput = z.infer<typeof recalculatePoolWinnersSchema>;
export type ToggleWinnerPaidInput = z.infer<typeof toggleWinnerPaidSchema>;
export type FixParticipantIdsInput = z.infer<typeof fixParticipantIdsSchema>;
