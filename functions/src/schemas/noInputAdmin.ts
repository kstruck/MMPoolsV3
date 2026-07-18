/**
 * Input schemas for the no-input SUPER_ADMIN SWEEP-LATER callables:
 * getAdminHealthSnapshot, backfillPools, refreshExpertPicks, syncPlayoffPools.
 * See noInputSchema's doc comment for the null-vs-{} transport quirk.
 * PURE: zod only, no firebase imports.
 */

import { z } from "zod";
import { noInputSchema } from "../lib/zodHelpers";

export const getAdminHealthSnapshotSchema = noInputSchema;
export const refreshExpertPicksSchema = noInputSchema;
export const syncPlayoffPoolsSchema = noInputSchema;

/**
 * backfillPools — NOT a true no-input callable anymore. It takes a dryRun flag
 * defaulting to `true` (dry-run), matching the repo convention for prod
 * batch-mutation ops (fixParticipantIds, backfillProfileData, PRs #127/#129/#180).
 *
 * The default matters more here than for most. This backfill is destructive in
 * two ways an operator cannot preview without it:
 *   1. Leg 1 rewrites `status` from isLocked/isFinal whenever `createdByUid` is
 *      missing, IGNORING any existing status — so it resets a COMPLETED pool to
 *      DRAFT. (Pre-existing defect, characterized in the emulator test; the
 *      dry-run gate is what makes it visible before it lands.)
 *   2. Leg 3 uses FieldValue.increment() on users/{uid}.historicalStats, which
 *      is not idempotent by construction.
 * An accidental no-arg invocation must therefore report, never write.
 *
 * Keeps the null→{} preprocess: a no-arg httpsCallable(fn)() still delivers
 * request.data as null, which a bare strict object would reject.
 */
export const backfillPoolsSchema = z.preprocess(
    (v) => v ?? {},
    z.strictObject({
        dryRun: z.boolean().optional().default(true),
    }),
);
