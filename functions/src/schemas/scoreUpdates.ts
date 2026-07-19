/**
 * Input schema for fixPoolScores (functions/src/scoreUpdates.ts).
 * PURE: zod only, no firebase imports.
 */

import { z } from "zod";

/**
 * fixPoolScores - SUPER_ADMIN repair tool. SWEEP-LATER batch 17.
 *
 * poolId IS OPTIONAL AND OMISSION MEANS "FIX EVERY POOL". The handler treats an
 * absent/falsy poolId as the GLOBAL path across every pool whose
 * scores.gameStatus is in/post. Both shapes exist in the tree today and BOTH
 * must keep working:
 *   - dbService.fixPoolScores(poolId?) always sends the key, sometimes as
 *     { poolId: undefined } - so this cannot be an absent-key-only optional;
 *   - OperationsPanel calls call('fixPoolScores') -> {}, the global sweep.
 * .optional() accepts both an absent key and an explicit undefined.
 *
 * The global-by-default behavior is pre-existing and NOT changed here; it is
 * flagged because a strict schema is the wrong place to fix a dangerous default,
 * and doing so silently would break the OperationsPanel button.
 */
export const fixPoolScoresSchema = z.strictObject({
    poolId: z.string().trim().min(1).max(200).optional(),
});
