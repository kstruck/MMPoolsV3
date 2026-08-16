/**
 * Input schemas for the nflPools.ts SWEEP-LATER callables: joinNFLPool,
 * executeSurvivorRebuy, scoreNFLWeek. PURE: zod only, no firebase imports.
 */

import { z } from "zod";
import { MAX_ENTRIES_PER_USER_CAP } from "../shared/multiEntry";

const poolId = z.string().trim().min(1).max(200);
const week = z.number().int().min(1).max(23);

/** joinNFLPool (AUTHED) — { poolId }. */
export const joinNFLPoolSchema = z.strictObject({
    poolId,
});

/** executeSurvivorRebuy (AUTHED) — { poolId, week }. */
export const executeSurvivorRebuySchema = z.strictObject({
    poolId,
    week,
    /** PLAN-MULTI-ENTRY T2 (D3) — which of the caller's entries is buying back in (1..max, default 1). */
    entryIndex: z.number().int().min(1).max(MAX_ENTRIES_PER_USER_CAP).optional(),
});

/** scoreNFLWeek (AUTHED+owner/admin, checked in-handler) — { poolId, week }. */
export const scoreNFLWeekSchema = z.strictObject({
    poolId,
    week,
});

export type JoinNFLPoolInput = z.infer<typeof joinNFLPoolSchema>;
export type ExecuteSurvivorRebuyInput = z.infer<typeof executeSurvivorRebuySchema>;
export type ScoreNFLWeekInput = z.infer<typeof scoreNFLWeekSchema>;
