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
    /**
     * Skip the stated-cutoff check — and ONLY that check (Kevin, 2026-08-21).
     *
     * The cutoff exists so a live manual freeze cannot commit a slate before the
     * Tuesday 09:00 ET members were promised. It earns its keep every week except
     * the ones where waiting buys nothing: **regular-season week 1 has no games
     * before it**, so the Tuesday cadence — which exists to let the previous week
     * finish — is pure cost there. Measured: the 2026 opener is a WEDNESDAY, so
     * the unforced pick window is 35.3 hours against ~59 for every other week.
     *
     * Freezing EARLY does not break fairness: every member still picks against an
     * identical line. It breaks PREDICTABILITY, which is why it takes an explicit
     * flag, a written reason, and an audit row rather than being the default.
     *
     * `force` does NOT make a run live. Both dry-run gates still apply.
     */
    force: z.boolean().optional().default(false),
    /** Required whenever `force` is set — see the refine below. */
    reason: z.string().trim().min(10).max(500).optional(),
    /**
     * Freeze THIS slate rather than auto-selecting the one that is due.
     *
     * Naming a slate bypasses the 7-day freeze HORIZON, which `force` alone does
     * not: horizon is part of "is this slate due", so a forced run with no target
     * still could not reach regular week 1 until seven days out. Everything else
     * still holds — once-per-slate, all-or-nothing, the lease, and a first kickoff
     * that must still be in the future.
     *
     * It is deliberately explicit rather than widening the horizon under `force`:
     * "the earliest slate with no frozen record" over an unbounded horizon walks
     * forward and freezes the wrong week, which is the codex round-8 defect. An
     * operator naming a week cannot do that by accident.
     */
    slate: z.strictObject({
        season: z.string().trim().min(1).max(10),
        seasonType: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        week: z.number().int().min(1).max(25),
    }).optional(),
}).refine((o) => !o.force || !!o.reason, {
    message: 'force requires a reason of at least 10 characters — an early freeze is a decision, and the audit row is where it is recorded',
    path: ['reason'],
}).refine((o) => !o.slate || o.force, {
    message: 'naming a slate requires force: it bypasses the freeze horizon, which is a deliberate act',
    path: ['force'],
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
