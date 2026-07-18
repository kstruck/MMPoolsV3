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
});

export type RecalculatePoolWinnersInput = z.infer<typeof recalculatePoolWinnersSchema>;
export type ToggleWinnerPaidInput = z.infer<typeof toggleWinnerPaidSchema>;
export type FixParticipantIdsInput = z.infer<typeof fixParticipantIdsSchema>;
