/**
 * Input schema for the migration callables (functions/src/migrations/).
 * PURE: zod only, no firebase imports.
 */

import { z } from "zod";

/**
 * backfillMemberRecords - SUPER_ADMIN prod batch migration. SWEEP-LATER batch 17.
 *
 * dryRun DEFAULTS TRUE AT THE SCHEMA LAYER, not in the handler. qodo caught the
 * handler-side variant on #183: a `=== true` check runs LIVE when the flag is
 * omitted, contradicting the repo's dry-run-by-default convention. The handler's
 * own `!== false` already fails safe; declaring it here makes the default
 * explicit and machine-checked.
 *
 * startAfter is a PAGINATION CURSOR compared against FieldPath.documentId() - a
 * document id. Not trimmed: altering it would silently skip or repeat a page.
 * OperationsPanel sends the key with undefined on the first page, so it must be
 * optional rather than absent-only.
 */
export const backfillMemberRecordsSchema = z.strictObject({
    dryRun: z.boolean().optional().default(true),
    // Omission means "skip sim-/completed/archived/canceled pools" - the safe
    // subset. Only an explicit true widens the sweep.
    includeAll: z.boolean().optional(),
    limit: z.number().int().positive().max(100).optional(),
    startAfter: z.string().min(1).max(1500).optional(),
});
