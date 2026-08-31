/**
 * Input schemas for the poolExceptions TARGET-NOW callables (sweep #39-42):
 * extendWeekDeadline, proxyPick, cancelPool, closePool. PURE: zod only.
 *
 * Permission stays resource-scoped in the handlers (loadPoolAndAssertManager:
 * pool owner/manager or SUPER_ADMIN) — no wrapper role.
 */

import { z } from "zod";
import { MAX_ENTRIES_PER_USER_CAP } from "../shared/multiEntry";

const poolId = z.string().trim().min(1).max(200);
/** Mirrors the old assertReason hand check: 3-200 chars after trim. */
const reason = z.string().trim().min(3).max(200);
/** NFL week: regular season + postseason. */
const week = z.number().int().min(1).max(23);

/** extendWeekDeadline — cap mirrors MAX_EXTRA_MINUTES (24h). */
export const extendWeekDeadlineSchema = z.strictObject({
    poolId,
    week,
    extraMinutes: z.number().finite().positive().max(24 * 60),
    reason,
});

/**
 * proxyPick — picks is gameId→team (PICKEM) or week→team (SURVIVOR/MARGIN;
 * numeric keys arrive as strings after JSON). ≤50 keys: an NFL week has ≤16
 * games, survivor/margin sends 1.
 */
export const proxyPickSchema = z.strictObject({
    poolId,
    week,
    targetUid: z.string().trim().min(1).max(200),
    /** PLAN-MULTI-ENTRY T2 — which of the target's entries (1..max, default 1). */
    entryIndex: z.number().int().min(1).max(MAX_ENTRIES_PER_USER_CAP).optional(),
    picks: z
        .record(z.string().min(1).max(100), z.string().min(1).max(100))
        .refine((o) => Object.keys(o).length <= 50, { message: "too many picks" }),
    reason,
});

/** cancelPool — { poolId, reason }. */
export const cancelPoolSchema = z.strictObject({ poolId, reason });

/** closePool — { poolId } only (no reason field in the client contract). */
export const closePoolSchema = z.strictObject({ poolId });

export type ExtendWeekDeadlineInput = z.infer<typeof extendWeekDeadlineSchema>;
export type ProxyPickInput = z.infer<typeof proxyPickSchema>;
export type CancelPoolInput = z.infer<typeof cancelPoolSchema>;
export type ClosePoolInput = z.infer<typeof closePoolSchema>;
