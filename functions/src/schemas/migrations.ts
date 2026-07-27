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
 *
 * IT MUST ACCEPT NULL AS FIRST-PAGE. OperationsPanel sends `startAfter: cursor`
 * with cursor undefined on page 1, and the Firebase JS SDK's callable
 * serializer encodes an explicit-undefined property as NULL on the wire — so
 * the server receives `startAfter: null`, which a plain `.optional()` rejects.
 * Found in prod 2026-07-27: the FIRST dry-run page of the D25 backfill failed
 * schema validation before scanning a single pool. The emulator suite never
 * saw it because firebase-functions-test bypasses the client serializer.
 * For a cursor, null is unambiguously "no cursor yet" — this is not the
 * null-means-clear convention (updateEntryPayment), so mapping null→undefined
 * loses nothing.
 */
export const backfillMemberRecordsSchema = z.strictObject({
    dryRun: z.boolean().optional().default(true),
    // REPLACES `includeAll` (PLAN-PAYMENT-TRUTH P4, Kevin's Q3 2026-07-26).
    //
    // `includeAll` conflated two independent questions and answered both with one
    // boolean: "process finished pools?" and "process sim/test pools?". Reaching
    // the historical pools whose money the all-time total is missing REQUIRED
    // setting it, which also aimed the migration at sim data - pure write
    // amplification against the pools PR D just taught the stats to ignore.
    //
    // So it is split. This flag widens the sweep over FINISHED pools only; the
    // sim-pool exclusion is now unconditional in the handler and there is no
    // longer any input that can switch it off.
    //
    // Defaulted here rather than left bare-optional, same reasoning as dryRun
    // above and the #183 fixParticipantIds lesson: the narrow sweep must be what
    // an omitted flag means, declared at the schema layer where it is
    // machine-checked, not inferred from a handler-side truthy check.
    includeFinished: z.boolean().optional().default(false),
    limit: z.number().int().positive().max(100).optional(),
    startAfter: z.preprocess(
        (v) => (v === null ? undefined : v),
        z.string().min(1).max(1500).optional(),
    ),
});

/**
 * backfillPublishedWeeks - SUPER_ADMIN prod batch migration (PLAN-REALTIME-SCORING
 * §4). Stamps `publishedWeeks.{week}` for weeks scored BEFORE the auto-scorer
 * started writing the marker, so the new extendWeekDeadline publish guard sees
 * them.
 *
 * dryRun defaults TRUE at the schema layer, same reasoning as above: a handler-side
 * truthy check runs LIVE when the flag is omitted.
 */
export const backfillPublishedWeeksSchema = z.strictObject({
    dryRun: z.boolean().optional().default(true),
    limit: z.number().int().positive().max(200).optional(),
    // Same null-as-first-page contract as backfillMemberRecordsSchema above —
    // OperationsPanel sends the identical `startAfter: cursor` shape here.
    startAfter: z.preprocess(
        (v) => (v === null ? undefined : v),
        z.string().min(1).max(1500).optional(),
    ),
});
