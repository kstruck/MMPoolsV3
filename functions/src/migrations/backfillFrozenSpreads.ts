// Cutover backfill for `nfl_frozen_spreads` (PLAN-NFL-SPREAD-FREEZE Revision 1,
// "Cutover: backfill first, or the fallback is a hole"). SUPER_ADMIN, kill-switch,
// dry-run by default, paged, audited.
//
// WHY IT IS A PRECONDITION AND NOT A TIDY-UP (codex round 2 on the revision).
// Reads resolve `frozen ?? working`. For any slate locked BEFORE this ships —
// including the sixteen Kevin locked by hand on 2026-08-19 — there is no frozen
// record, so every read falls back to `nfl_games.spread`, a field the Spread
// Manager can still change at will. Until this has run, a live locked slate's
// line can still move between pick time and grading. Running it is what turns
// that fallback into a legacy read rather than a live dependency.
//
// Rule 1 (mmp-change-control) — this writes production data:
//   - a kill-switch, OFF by default (`system/config.nflFrozenSpreadBackfill`);
//   - dry-run DEFAULT, declared at the SCHEMA layer, not a handler `=== true`;
//   - a per-run cap and a cursor;
//   - an `admin_audit` summary on every run, dry or live.
//
// ⚠️ THAT AUDIT ROW IS NOT A COPY OF THE DRY RUN, and an earlier version of this
// comment claimed it was. `capMetadata` collapses every array to the literal
// string "[array]", so the row records the COUNTS and the fact that it ran, and
// preserves none of the planned values. The returned object on screen is the only
// place those exist — and the Operations panel slices it to 400 characters, which
// is why the counts now come first in the report.
import * as admin from "firebase-admin";
import { validated } from "../lib/validated";
import { writeAdminAudit } from "../lib/adminAudit";
import { backfillFrozenSpreadsSchema } from "../schemas/migrations";
import { FROZEN_SPREADS_COLLECTION, slateFieldsOf, type FrozenSpread } from "../shared/frozenSpread";
import { readJobGate } from "../nflSchedule";

/**
 * The record this writes, or the reason it cannot.
 *
 * `source: 'backfill'` IS NOT OPTIONAL. The rescore trigger judges approval per
 * source, so a record written without one is filed as an unapproved change — for
 * every legacy game the backfill touches (codex round 8 on the revision).
 * `legacy: true` says the `frozenAt` here is the BACKFILL instant, not a measured
 * freeze instant, so nobody later reads it as evidence of when the line was taken.
 */
export function plannedRecord(
  gameId: string,
  game: Record<string, unknown>,
  frozenAt: number,
): FrozenSpread | { skip: string } {
  const spread = game.spread as { value?: unknown; locked?: unknown } | undefined;
  if (spread?.locked !== true) return { skip: "not locked" };
  const value = spread?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return { skip: "locked with no usable value" };

  // The slate fields are load-bearing, not decoration: the client subscribes by
  // `season`, the freeze pass selects by the three-equality slate, and a DELETE
  // trigger can only recover the slate from the record's own copy. A record with
  // a malformed slate would be invisible to all three, so refuse to write one.
  const slate = slateFieldsOf(game);
  if (!slate) {
    return { skip: `malformed slate (season=${game.season ?? "?"}, seasonType=${game.seasonType}, week=${game.week})` };
  }

  return { gameId, value, frozenAt, ...slate, source: "backfill", legacy: true };
}

export const backfillFrozenSpreads = validated(
  { schema: backfillFrozenSpreadsSchema, label: "backfillFrozenSpreads", role: "SUPER_ADMIN", appCheck: "monitor" },
  async (input, request) => {
    const dryRun = input.dryRun; // schema default TRUE
    const limit = Math.min(input.limit ?? 100, 500);
    const startAfter = input.startAfter;

    const db = admin.firestore();

    // Kill-switch, same gate shape and the same fail-safe default as every other
    // NFL job. A config read that THROWS must not be read as "enabled" — it is
    // the one failure mode where guessing runs a production write.
    const cfg = (await db.doc("system/config").get()).data()?.nflFrozenSpreadBackfill as
      | { enabled?: boolean; dryRun?: boolean }
      | undefined;
    const gate = readJobGate(cfg);
    if (!gate.enabled) {
      return {
        enabled: false,
        message:
          "backfillFrozenSpreads is disabled. Set system/config.nflFrozenSpreadBackfill.enabled = true to run it.",
      };
    }
    // Either gate may hold it dry. The config flag is what an operator can pull
    // without a redeploy; the argument is what makes a single live page deliberate.
    const live = !dryRun && gate.dryRun === false;

    let q = db
      .collection("nfl_games")
      .where("spread.locked", "==", true)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit);
    if (startAfter) q = q.startAfter(startAfter);
    const snap = await q.get();

    const frozenAt = Date.now();
    const report = {
      enabled: true,
      dryRun: !live,
      gamesScanned: snap.docs.length,
      alreadyFrozen: 0,
      written: 0,
      // ⚠️ COUNTS BEFORE ARRAYS, AND THAT ORDER IS LOAD-BEARING (2026-08-21).
      // `OperationsPanel.tsx:536` renders `JSON.stringify(result).slice(0, 400)` —
      // its own line 79 says "KEY ORDER IS LOAD-BEARING" — so a 33-entry
      // `plannedWrites` placed ahead of these consumed the entire budget and made
      // `skipped`, `failures` and `nextCursor` literally unreadable on the one run
      // whose whole purpose is to be read. Scalars first; the arrays are detail,
      // capped for the same reason the other migrations cap theirs — an audit doc
      // has a 1MiB ceiling.
      //
      // ⚠️ INCREMENTED WHERE THE EVENT HAPPENS, never derived from the arrays
      // (codex r1). Deriving them was the first spelling and it inherits the caps:
      // a 300-game run would report `plannedCount: 200, skippedCount: 100` and read
      // as complete. A summary that is only right until it matters is worse than no
      // summary, because these are now the fields an auditor is told to trust.
      plannedCount: 0,
      skippedCount: 0,
      failureCount: 0,
      nextCursor: null as string | null,
      plannedWrites: [] as { gameId: string; value: number; slate: string }[],
      skipped: [] as { gameId: string; reason: string }[],
      failures: [] as { gameId: string; error: string }[],
    };

    for (const doc of snap.docs) {
      try {
        const planned = plannedRecord(doc.id, doc.data() as Record<string, unknown>, frozenAt);
        if ("skip" in planned) {
          // Counted where it HAPPENS, not from the capped array below.
          report.skippedCount++;
          if (report.skipped.length < 100) report.skipped.push({ gameId: doc.id, reason: planned.skip });
          continue;
        }

        const ref = db.collection(FROZEN_SPREADS_COLLECTION).doc(doc.id);
        if ((await ref.get()).exists) {
          report.alreadyFrozen++;
          continue;
        }

        report.plannedCount++;
        if (report.plannedWrites.length < 200) {
          report.plannedWrites.push({
            gameId: doc.id,
            value: planned.value,
            slate: `${planned.season}/${planned.seasonType}/${planned.week}`,
          });
        }

        if (live) {
          // `create`, not `set`: it fails rather than overwriting if a real freeze
          // or an override got there in the gap between the read above and this
          // write. A backfill must never replace a measured freeze instant with
          // its own, and ALREADY_EXISTS is the right answer here, not an error.
          try {
            await ref.create(planned);
            report.written++;
          } catch (err: any) {
            if (err?.code === 6 || /already exists/i.test(String(err?.message || ""))) {
              report.alreadyFrozen++;
            } else {
              throw err;
            }
          }
        }
      } catch (err: any) {
        report.failureCount++;
        report.failures.push({ gameId: doc.id, error: String(err?.message || err) });
      }
    }

    if (snap.docs.length === limit) report.nextCursor = snap.docs[snap.docs.length - 1].id;

    await writeAdminAudit({
      actorUid: request.auth!.uid,
      actorEmail: request.auth!.token.email as string | undefined,
      action: "BACKFILL_FROZEN_SPREADS",
      targetType: "nfl_game",
      metadata: {
        dryRun: report.dryRun,
        gamesScanned: report.gamesScanned,
        alreadyFrozen: report.alreadyFrozen,
        written: report.written,
        // ⚠️ `capMetadata` COLLAPSES EVERY ARRAY TO THE STRING "[array]", so the
        // three lists below preserve nothing. An earlier comment on this file
        // called the audit row "reviewable evidence" of a dry run; it is not, and
        // saying so was worse than the gap. The COUNTS are what survive, so they
        // are what an auditor actually gets.
        plannedCount: report.plannedCount,
        skippedCount: report.skippedCount,
        failureCount: report.failureCount,
        nextCursor: report.nextCursor,
      },
      status: report.failures.length > 0 ? "error" : "success",
    });

    return report;
  },
);
