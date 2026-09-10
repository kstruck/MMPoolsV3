// One-shot backfill for PLAN-CONFIDENCE-PER-GAME-LOCK D1 (Kevin, 2026-09-10:
// "backfill as long as it does not break the pool"). SUPER_ADMIN, dry-run by
// default, capped, paged, audited — modelled line-for-line on
// backfillPublishedWeeks.
//
// WHAT IT DOES. Every legacy confidence Pick'em pool — `confidenceMode: true`
// and no `settings.lockRuleVersion: 2` stamp — gets `lockMode: 'WEEKLY'` (what
// it has ALWAYS played; on a pool that already stores WEEKLY this is a no-op)
// plus the stamp, plus a `lockRevision` bump (the same bump a commissioner's own
// Lock Mode save makes, so a scoring pass in flight re-reads rather than
// publishing against a stale lock). Dotted paths only: nothing else on the doc,
// never entries, standings, or leases.
//
// WHY THE STAMP AND NOT JUST THE MODE. `shared/nflLockMode.ts` keeps the old
// "confidence forces weekly" reading for any pool without the stamp, so the
// functions deploy that carries this op is safe BEFORE it runs: no pool changes
// mode for any caller until this has touched it (codex r1 #3). A pool created
// after the release is stamped by its creator and never matches (codex r1 #4).
// A pool that already stores WEEKLY still matches — it needs the stamp, or the
// legacy clause can never be retired (codex r2 #3).
//
// Rule 1 (mmp-change-control) — this writes production data:
//   - dry-run DEFAULT, declared at the SCHEMA layer;
//   - a per-run cap, cursor paging (the Operations panel loops every page);
//   - the predicate re-evaluated INSIDE each pool's write transaction;
//   - an `admin_audit` summary on every run, dry or live.
import * as admin from "firebase-admin";
import { validated } from "../lib/validated";
import { writeAdminAudit } from "../lib/adminAudit";
import { backfillConfidenceLockModeSchema } from "../schemas/migrations";
import { needsConfidenceLockModeBackfill, LOCK_RULE_VERSION } from "../lib/lockRuleVersion";
import { readLockRevision } from "../lib/scoringLease";

export const backfillConfidenceLockMode = validated(
    { schema: backfillConfidenceLockModeSchema, label: "backfillConfidenceLockMode", role: "SUPER_ADMIN", appCheck: "monitor" },
    async (input, request) => {
        const dryRun = input.dryRun; // schema default TRUE
        const limit = Math.min(input.limit ?? 50, 200);
        const startAfter = input.startAfter;

        const db = admin.firestore();
        let q = db.collection('pools')
            .where('type', '==', 'NFL_PICKEM')
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(limit);
        if (startAfter) q = q.startAfter(startAfter);
        const snap = await q.get();

        const report = {
            dryRun,
            poolsScanned: snap.docs.length,
            poolsChanged: 0,
            // Per pool, so a dry run is readable evidence: the stored value is
            // what Kevin reads to learn what Donkeys held (plan §7 step 3).
            plannedWrites: [] as { poolId: string; name: string; storedLockMode: string | null }[],
            failures: [] as { poolId: string; error: string }[],
            nextCursor: null as string | null,
        };

        for (const doc of snap.docs) {
            try {
                const data = doc.data() as Record<string, unknown>;
                if (!needsConfidenceLockModeBackfill(data)) continue;
                const settings = (data.settings ?? {}) as { lockMode?: unknown };
                report.poolsChanged++;
                if (report.plannedWrites.length < 100) {
                    report.plannedWrites.push({
                        poolId: doc.id,
                        name: typeof data.name === 'string' ? data.name : '',
                        storedLockMode: typeof settings.lockMode === 'string' ? settings.lockMode : null,
                    });
                }
                if (!dryRun) {
                    await db.runTransaction(async (tx) => {
                        const fresh = (await tx.get(doc.ref)).data() as Record<string, unknown> | undefined;
                        // Re-judged on the transactional read: a pool stamped
                        // between the page read and here is left alone.
                        if (!needsConfidenceLockModeBackfill(fresh)) return;
                        tx.update(doc.ref, {
                            'settings.lockMode': 'WEEKLY',
                            'settings.lockRuleVersion': LOCK_RULE_VERSION,
                            'settings.lockRevision': readLockRevision(fresh as never) + 1,
                            updatedAt: admin.firestore.Timestamp.now(),
                        });
                    });
                }
            } catch (err: unknown) {
                report.failures.push({ poolId: doc.id, error: err instanceof Error ? err.message : String(err) });
            }
        }

        if (snap.docs.length === limit) report.nextCursor = snap.docs[snap.docs.length - 1].id;

        await writeAdminAudit({
            actorUid: request.auth!.uid,
            actorEmail: request.auth!.token.email as string | undefined,
            action: "BACKFILL_CONFIDENCE_LOCK_MODE",
            targetType: "pool",
            metadata: {
                dryRun,
                poolsScanned: report.poolsScanned,
                poolsChanged: report.poolsChanged,
                plannedWrites: report.plannedWrites,
                failures: report.failures.slice(0, 50),
                nextCursor: report.nextCursor,
            },
            status: report.failures.length > 0 ? "error" : "success",
        });

        return report;
    },
);
