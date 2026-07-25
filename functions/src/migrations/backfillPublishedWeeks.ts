// Cold-start backfill for `pool.publishedWeeks` (PLAN-REALTIME-SCORING §4,
// codex r23). SUPER_ADMIN, dry-run by default, capped, audited.
//
// WHY IT IS PART OF THIS PR, not an operational afterthought. PR-B′ adds the
// `extendWeekDeadline` publish guard, which refuses an extension for a week whose
// results members have already seen. It reads `pool.publishedWeeks.{week}` — a
// marker only the auto-scorer writes, and only from this release onward. Every
// week scored MANUALLY before the rollout therefore looks unpublished to the new
// guard, and the exact override the guard exists to refuse would be accepted on
// precisely the weeks whose results have been visible the longest.
//
// The guard ships anyway and this migration closes the legacy window afterwards:
// until it runs, a legacy week is no more reopenable than it is today (the guard
// simply does not fire), so shipping the guard first is not a regression. That
// ordering is stated in the arming checklist rather than left implicit.
//
// Rule 1 (mmp-change-control) — this writes production data:
//   - dry-run DEFAULT, declared at the SCHEMA layer (not a handler `=== true`);
//   - a per-run cap;
//   - an `admin_audit` summary on every run, dry or live, so a dry trial is
//     reviewable evidence rather than a returned object nobody kept.
import * as admin from "firebase-admin";
import { validated } from "../lib/validated";
import { writeAdminAudit } from "../lib/adminAudit";
import { backfillPublishedWeeksSchema } from "../schemas/migrations";
import { missingPublishedWeeks } from "../lib/publishedWeeks";
import { NFL_SEASON_TYPES } from "../shared/poolTypes";

export const backfillPublishedWeeks = validated(
    { schema: backfillPublishedWeeksSchema, label: "backfillPublishedWeeks", role: "SUPER_ADMIN", appCheck: "monitor" },
    async (input, request) => {
        const dryRun = input.dryRun; // schema default TRUE
        const limit = Math.min(input.limit ?? 50, 200);
        const startAfter = input.startAfter;

        const db = admin.firestore();
        let q = db.collection('pools')
            .where('type', 'in', NFL_SEASON_TYPES as unknown as string[])
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(limit);
        if (startAfter) q = q.startAfter(startAfter);
        const snap = await q.get();

        const report = {
            dryRun,
            poolsScanned: snap.docs.length,
            poolsChanged: 0,
            weeksMarked: 0,
            // Per pool, so a dry run is readable evidence and not just a total.
            // Capped for the same reason the sweep caps its reasons map: an audit
            // doc has a 1MiB ceiling.
            plannedWrites: [] as { poolId: string; weeks: number[] }[],
            failures: [] as { poolId: string; error: string }[],
            nextCursor: null as string | null,
        };

        for (const doc of snap.docs) {
            try {
                const weeks = missingPublishedWeeks(doc.data() as Record<string, unknown>);
                if (weeks.length === 0) continue;
                report.poolsChanged++;
                report.weeksMarked += weeks.length;
                if (report.plannedWrites.length < 100) {
                    report.plannedWrites.push({ poolId: doc.id, weeks });
                }
                if (!dryRun) {
                    // Marker-only, set-once, idempotent: a re-run finds nothing
                    // missing and reports zero. Dotted paths so nothing else on
                    // the pool doc — including a live scoring lease — is touched.
                    const patch: Record<string, unknown> = {};
                    for (const w of weeks) patch[`publishedWeeks.${w}`] = true;
                    await doc.ref.update(patch);
                }
            } catch (err: any) {
                report.failures.push({ poolId: doc.id, error: String(err?.message || err) });
            }
        }

        if (snap.docs.length === limit) report.nextCursor = snap.docs[snap.docs.length - 1].id;

        await writeAdminAudit({
            actorUid: request.auth!.uid,
            actorEmail: request.auth!.token.email as string | undefined,
            action: "BACKFILL_PUBLISHED_WEEKS",
            targetType: "pool",
            metadata: {
                dryRun,
                poolsScanned: report.poolsScanned,
                poolsChanged: report.poolsChanged,
                weeksMarked: report.weeksMarked,
                plannedWrites: report.plannedWrites,
                failures: report.failures.slice(0, 50),
                nextCursor: report.nextCursor,
            },
            status: report.failures.length > 0 ? "error" : "success",
        });

        return report;
    },
);
