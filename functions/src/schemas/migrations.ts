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

/**
 * reconcilePaymentTruth - SUPER_ADMIN prod one-off (PLAN-PAYMENT-TRUTH P2, Q5).
 * Converges the two payment stores on NFL season pools that diverged before P1:
 * entry-PAID/member-UNPAID promotes the member (+ missing ledger row);
 * member-PAID/entry-UNPAID mirrors the entry display. Its DRY RUN is the
 * divergence count.
 *
 * dryRun defaults TRUE at the schema layer (house Rule 1); the cursor takes
 * null as first-page (the JS SDK undefined→null encoding, same as the two
 * schemas above — found in prod on the D25 run, 2026-07-27).
 */
export const reconcilePaymentTruthSchema = z.strictObject({
    dryRun: z.boolean().optional().default(true),
    limit: z.number().int().positive().max(100).optional(),
    startAfter: z.preprocess(
        (v) => (v === null ? undefined : v),
        z.string().min(1).max(1500).optional(),
    ),
});

/**
 * backfillProfileData - SUPER_ADMIN prod batch migration (ADR 0005 /
 * PLAN-PLAYER-PROFILES Phase 8, Operations tab). PLAN-AUDIT-BACKEND-RESIDUE 17b:
 * the callable was a raw onCall with NO schema at all, so `request.data` reached
 * the handler unvalidated and untyped.
 *
 * dryRun defaults TRUE at the schema layer, house Rule 1 and the #183 lesson the
 * three schemas above record: a handler-side truthy check runs LIVE when the
 * flag is omitted. The handler's own `!== false` already failed safe; declaring
 * it here makes the default explicit and machine-checked.
 *
 * afterPoolId is the resume cursor, compared against FieldPath.documentId() - a
 * document id, so it is NOT trimmed (altering it would silently skip or repeat a
 * page). It takes NULL as first-page for the same reason its three siblings do:
 * the Firebase JS SDK's callable serializer encodes an explicit-undefined
 * property as null on the wire, which a plain .optional() rejects (found in prod
 * on the D25 run, 2026-07-27). No client sends it today - OperationsPanel sends
 * `{ dryRun }` alone - but the handler implements the cursor, so the schema
 * describes the handler rather than the current caller.
 */
export const backfillProfileDataSchema = z.strictObject({
    dryRun: z.boolean().optional().default(true),
    afterPoolId: z.preprocess(
        (v) => (v === null ? undefined : v),
        z.string().min(1).max(1500).optional(),
    ),
});

/**
 * backfillFrozenSpreads - SUPER_ADMIN prod one-off (PLAN-NFL-SPREAD-FREEZE
 * Revision 1, "Cutover: backfill first, or the fallback is a hole").
 *
 * Writes an `nfl_frozen_spreads` record for every game whose
 * `nfl_games.spread.locked === true` today, so the `frozen ?? working` fallback
 * covers only slates that were never locked at all. It is a PRECONDITION of the
 * read path, not a tidy-up: while a live locked slate has no frozen record, its
 * line is still whatever the Spread Manager last wrote and can move between pick
 * time and grading.
 *
 * dryRun defaults TRUE at the schema layer (house Rule 1), and the cursor takes
 * null as first-page — the same JS SDK undefined-to-null encoding the three
 * schemas above were bitten by in prod on 2026-07-27.
 */
export const backfillFrozenSpreadsSchema = z.strictObject({
    dryRun: z.boolean().optional().default(true),
    limit: z.number().int().positive().max(500).optional(),
    startAfter: z.preprocess(
        (v) => (v === null ? undefined : v),
        z.string().min(1).max(1500).optional(),
    ),
});
