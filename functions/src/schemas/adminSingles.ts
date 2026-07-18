/**
 * Input schemas for four single-callable SWEEP-LATER files, batched together
 * because each file has exactly one row: lockPool (poolParams.ts),
 * logAdminAction (adminOps.ts), recomputeConsensus (consensus.ts),
 * recomputeRevenue (revenueAggregates.ts).
 * PURE: zod only, no firebase imports.
 */

import { z } from "zod";
import { nullish, noInputSchema } from "../lib/zodHelpers";

/** lockPool (AUTHED + owner/SUPER_ADMIN in-handler) — { poolId, forceAxis? }. */
export const lockPoolSchema = z.strictObject({
    poolId: z.string().trim().min(1).max(200),
    // Handler tests `forceAxis === true`, so absent/false behave identically.
    forceAxis: nullish(z.boolean()),
});

/**
 * logAdminAction (SUPER_ADMIN) — mirrors dbService.logAdminAction's entry
 * object. `metadata` is an OPEN record by design: it is caller-supplied
 * annotation forwarded verbatim to writeAdminAudit, and every admin action
 * attaches a different shape. Locking it down would silently drop audit
 * context, so it stays an arbitrary map (the strict gate still applies to the
 * envelope around it).
 */
export const logAdminActionSchema = z.strictObject({
    action: z.string().min(1).max(200),
    targetType: nullish(z.string().max(200)),
    targetId: nullish(z.string().max(200)),
    metadata: nullish(z.record(z.string(), z.unknown())),
    status: nullish(z.enum(["success", "error"])),
    error: nullish(z.string().max(5000)),
});

/**
 * recomputeConsensus (SUPER_ADMIN) — { season, seasonType, week }, all
 * required. The handler coerces with String()/Number(), so numeric strings are
 * legitimate input; the union mirrors that rather than tightening it. No
 * frontend caller today, so this is pinned to the handler's own contract.
 */
const numericish = z.union([z.number(), z.string().min(1).max(20)]);
export const recomputeConsensusSchema = z.strictObject({
    season: numericish,
    seasonType: numericish,
    week: numericish,
});

/** recomputeRevenue (SUPER_ADMIN) — takes no input. */
export const recomputeRevenueSchema = noInputSchema;

export type LockPoolInput = z.infer<typeof lockPoolSchema>;
export type LogAdminActionInput = z.infer<typeof logAdminActionSchema>;
export type RecomputeConsensusInput = z.infer<typeof recomputeConsensusSchema>;
