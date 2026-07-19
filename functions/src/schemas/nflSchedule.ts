/**
 * Input schema for importNFLSchedule (functions/src/nflSchedule.ts).
 * PURE: zod only, no firebase imports.
 */

import { z } from "zod";

/**
 * importNFLSchedule - SUPER_ADMIN. SWEEP-LATER batch 17.
 *
 * DESTRUCTIVE AND UNGATED: importNFLSeason() batch-DELETES every existing
 * nfl_games doc matching season+seasonType before re-importing, and there is no
 * dryRun flag. That is pre-existing behavior this sweep deliberately does not
 * change (a dry-run retrofit is a behavior change needing its own review), but
 * it is why the envelope is tightened hard here.
 *
 * Every field is optional in the handler with coercing defaults (season->'2026',
 * seasonType->2, weeks->all 18). Those defaults are LOAD BEARING and are left in
 * the handler: making the fields required would break any caller relying on
 * them. The frontend always sends all three.
 *
 * season is a LOOKUP KEY for the delete sweep (.where('season','==',season)), so
 * it is NOT trimmed - the stored values come from this same importer, and
 * normalising only one side is how you delete the wrong set.
 */
export const importNFLScheduleSchema = z.strictObject({
    season: z.union([z.string().min(1).max(10), z.number().int()]).optional(),
    // Constrained to the three real ESPN season types. The handler does a bare
    // parseInt cast with no range check, so this is the only thing stopping a
    // nonsense seasonType from reaching a destructive delete.
    seasonType: z.union([
        z.literal(1), z.literal(2), z.literal(3),
        z.literal("1"), z.literal("2"), z.literal("3"),
    ]).optional(),
    // Accepts a scalar or an array, matching the handler's own coercion.
    weeks: z.union([
        z.number().int().positive().max(25),
        z.array(z.number().int().positive().max(25)).min(1).max(25),
    ]).optional(),
});
