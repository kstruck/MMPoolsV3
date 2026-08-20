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

/**
 * runNFLSpreadFreeze (SUPER_ADMIN) — PLAN-NFL-SPREAD-FREEZE 1.5b.
 *
 * The manual invocation of the weekly freeze, because a `0 9 * * 2` schedule
 * cannot rehearse itself: the rollout asks for dry-run reports on Saturday,
 * Sunday and Monday from a job that runs on none of those days.
 *
 * dryRun DEFAULTS TRUE AT THE SCHEMA LAYER (house Rule 1) — a handler-side truthy
 * check runs LIVE when the flag is omitted. The config kill-switch can also hold
 * it dry, but never force it live: a live manual freeze needs the config armed AND
 * an explicit `dryRun: false`.
 */
export const runNFLSpreadFreezeSchema = z.strictObject({
    dryRun: z.boolean().optional().default(true),
});

/**
 * overrideLockedSpread (SUPER_ADMIN) — PLAN-NFL-SPREAD-FREEZE 2.1.
 *
 * The ONE path that may change a frozen line, or give one to a game added to a
 * slate after it froze. `reason` is required and non-trivial on purpose: the whole
 * value of an audited override is the sentence explaining why the number members
 * picked against is being changed, and a one-character reason is the same as none.
 *
 * `value` is home-relative, matching `nfl_games.spread.value`. Bounded rather than
 * unbounded: nothing in the NFL is a 200-point favourite, and a fat-fingered
 * exponent should be a validation error rather than a graded result.
 */
export const overrideLockedSpreadSchema = z.strictObject({
    gameId: z.string().trim().min(1).max(200),
    value: z.number().finite().min(-100).max(100),
    reason: z.string().trim().min(10).max(500),
});

export type JoinNFLPoolInput = z.infer<typeof joinNFLPoolSchema>;
export type ExecuteSurvivorRebuyInput = z.infer<typeof executeSurvivorRebuySchema>;
export type ScoreNFLWeekInput = z.infer<typeof scoreNFLWeekSchema>;
export type RunNFLSpreadFreezeInput = z.infer<typeof runNFLSpreadFreezeSchema>;
export type OverrideLockedSpreadInput = z.infer<typeof overrideLockedSpreadSchema>;
