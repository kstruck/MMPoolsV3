import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { writeAdminAudit } from "./lib/adminAudit";
import { validated } from "./lib/validated";
import { backfillPoolsSchema } from "./schemas/noInputAdmin";
import { HttpsError } from "firebase-functions/v2/https";

/**
 * backfillPools — paged, budgeted, kill-switched (PLAN-API-TRUST-BOUNDARY
 * Phase 4; was an unbounded full-`pools` scan with per-pool full `entries`
 * scans in one invocation).
 *
 * Contract (shared with fixParticipantIds, defined in the plan, NOT inherited
 * from backfillProfileData):
 *  - OUTER: deterministic `orderBy(documentId())`, MAX_POOLS_PER_RUN + 1
 *    fetched, optional `afterPoolId` cursor; response + admin_audit carry
 *    `{ nextCursor, hasMore, dryRun }`. The panel loops pages; a live run
 *    NEVER continues a dry-run cursor (mode-bound client-side, and the echoed
 *    `dryRun` makes the binding checkable).
 *  - INNER: every per-pool subcollection read is capped at ENTRY_SCAN_CAP + 1.
 *    An over-cap pool is NOT partially processed — its historical-stats leg is
 *    skipped whole, the id lands in `oversizedPools` (dry-run reports it too),
 *    and the outer cursor still advances. Per-entry idempotency markers
 *    (`historicalStatsFoldedAt`) make a later targeted rerun safe.
 *  - BUDGET: WRITE_BUDGET_PER_RUN staged writes, checked BETWEEN pools only —
 *    a pool is never split, so one pool may overshoot (bounded by the inner
 *    cap); when the budget is hit the run stops at the last completed pool and
 *    returns that cursor.
 *  - KILL-SWITCH (live runs only): `dryRun:false` requires
 *    `system/config.backfillPools.enabled === true`. Fail-safe: missing key or
 *    unreadable config = disabled. Dry runs are never blocked. The refusal
 *    names the config key so the operator path is self-describing.
 */

export const MAX_POOLS_PER_RUN = 25;
export const ENTRY_SCAN_CAP = 10_000;
export const WRITE_BUDGET_PER_RUN = 5_000;

export interface BackfillPoolsResult {
    success: true;
    updatedCount: number;
    plannedWrites: number;
    dryRun: boolean;
    nextCursor: string | null;
    hasMore: boolean;
    oversizedPools: string[];
}

/** Core, split from the validated() wrapper so the paging/budget/kill-switch
 *  contract is unit-testable against a hand-rolled Firestore double. */
export async function backfillPoolsCore(
    db: admin.firestore.Firestore,
    { dryRun, afterPoolId }: { dryRun: boolean; afterPoolId?: string },
): Promise<BackfillPoolsResult> {
    if (!dryRun) {
        // Kill-switch, fail-safe: any read problem or non-true value refuses.
        let enabled = false;
        try {
            const cfg = await db.doc("system/config").get();
            enabled = (cfg.data() as { backfillPools?: { enabled?: unknown } } | undefined)
                ?.backfillPools?.enabled === true;
        } catch (e) {
            console.error("[backfillPools] kill-switch read failed — refusing live run:", e);
            enabled = false;
        }
        if (!enabled) {
            throw new HttpsError(
                "failed-precondition",
                "Live backfillPools runs are disabled. Set system/config.backfillPools.enabled = true to arm them; dry runs are always allowed.",
            );
        }
    }

    const poolsRef = db.collection('pools');
    const usersRef = db.collection('users');

    let outerQ = poolsRef
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(MAX_POOLS_PER_RUN + 1);
    if (afterPoolId) outerQ = outerQ.startAfter(afterPoolId);
    const poolsSnap = await outerQ.get();
    const pageDocs = poolsSnap.docs.slice(0, MAX_POOLS_PER_RUN);
    // hasMore from the sentinel row; it may be refined to true below if the
    // write budget stops the page early.
    let hasMore = poolsSnap.docs.length > MAX_POOLS_PER_RUN;

    let updatedCount = 0;
    const oversizedPools: string[] = [];

    let batch = db.batch();
    let batchCount = 0;
    // Total writes the run staged. On a dry run nothing is committed, so this is
    // "what a live run WOULD write" — the number the operator inspects before arming.
    let plannedWrites = 0;

    // Single commit seam: on a dry run we still stage into the batch (so the
    // counting and the 400-op chunking stay identical to the live path) but drop
    // it instead of committing. Every commit site below goes through this.
    const flush = async () => {
        if (batchCount === 0) return;
        if (!dryRun) await batch.commit();
        plannedWrites += batchCount;
        batch = db.batch();
        batchCount = 0;
    };

    let lastCompletedPoolId: string | undefined;

    for (const poolDoc of pageDocs) {
        // Budget check BETWEEN pools only (a pool is never split). The cursor
        // returned is the last COMPLETED pool, so a retry never half-repeats.
        if (plannedWrites + batchCount >= WRITE_BUDGET_PER_RUN && lastCompletedPoolId) {
            hasMore = true;
            break;
        }

        const pool = poolDoc.data();
        const ownerId = pool.ownerId;
        const poolId = poolDoc.id;

        if (!ownerId) { lastCompletedPoolId = poolId; continue; }

        // 1. Backfill missing base fields (createdByUid, isPublic)
        const updates: any = {};
        if (!pool.createdByUid) {
            updates.createdByUid = ownerId;
        }
        // Derive a status ONLY for pools that have none, and independently of
        // createdByUid. This used to be nested inside the !createdByUid branch
        // AND to run unconditionally there, which meant it (a) recomputed status
        // from isLocked/isFinal while ignoring the value already on the doc —
        // silently resetting a COMPLETED pool to DRAFT — and (b) never reached a
        // pool that had createdByUid but no status. isLocked/isFinal cannot
        // express COMPLETED or ARCHIVED, so they must never overwrite an
        // existing status.
        if (!pool.status) {
            updates.status = pool.isLocked ? 'LOCKED' : (pool.isFinal ? 'FINAL' : 'DRAFT');
        }
        if (pool.isPublic === undefined) {
            updates.isPublic = pool.type === 'BRACKET' ? (pool.isListedPublic ?? false) : true;
        }

        if (Object.keys(updates).length > 0) {
            batch.update(poolDoc.ref, updates);
            batchCount++;
        }

        // 2. Create Managed Pool Index
        const indexRef = usersRef.doc(ownerId).collection('managedPools').doc(poolId);
        batch.set(indexRef, {
            poolId,
            createdAt: pool.createdAt || Timestamp.now(),
            name: pool.name,
            type: pool.type
        }, { merge: true });
        batchCount++;

        // 3. Historical Data Migration (For COMPLETED pools)
        //
        // This leg is NOT idempotent: it folds each entry into
        // users/{uid}.historicalStats with FieldValue.increment(), so folding
        // the same entry twice double-counts. The PER-ENTRY marker
        // (`historicalStatsFoldedAt`) is staged in the SAME batch as the
        // increment it guards — a Firestore batch commits atomically, so a
        // crash can never leave an applied increment unmarked.
        //
        // LIMITATION: entries folded by a run that predates the marker carry
        // none, so they would be folded again. The dry-run default plus the
        // plannedWrites count is the mitigation — inspect before arming.
        if (pool.status === 'COMPLETED' || pool.status === 'ARCHIVED') {
            const entriesSnap = await poolDoc.ref.collection('entries')
                .limit(ENTRY_SCAN_CAP + 1)
                .get();
            if (entriesSnap.docs.length > ENTRY_SCAN_CAP) {
                // Over the inner cap: skip this pool's leg WHOLE — a partial
                // fold would be worse than none — report it, keep going.
                console.error(`[backfillPools] pool ${poolId} exceeds ENTRY_SCAN_CAP (${ENTRY_SCAN_CAP}); historical-stats leg skipped.`);
                oversizedPools.push(poolId);
            } else {
                for (const entryDoc of entriesSnap.docs) {
                    const entry = entryDoc.data();
                    if (!entry.ownerUid) continue;
                    if (entry.historicalStatsFoldedAt) continue;

                    const userRef = usersRef.doc(entry.ownerUid);

                    // Aggregate basic stats
                    const isWinner = entry.rank === 1;
                    const pointsEarned = entry.totalScore || entry.seasonTotal || entry.totalPoints || 0;
                    const payoutEarned = entry.payoutAmount || 0;

                    // Update user's historical stats safely using FieldValue increments
                    batch.set(userRef, {
                        historicalStats: {
                            poolsEntered: FieldValue.increment(1),
                            poolsWon: FieldValue.increment(isWinner ? 1 : 0),
                            totalPoints: FieldValue.increment(pointsEarned),
                            totalEarnings: FieldValue.increment(payoutEarned)
                        }
                    }, { merge: true });
                    batch.update(entryDoc.ref, { historicalStatsFoldedAt: FieldValue.serverTimestamp() });
                    // Both writes counted together, and the flush check runs only
                    // after BOTH are staged, so the pair can never straddle a commit.
                    batchCount += 2;

                    if (batchCount >= 400) await flush();
                }
            }
        }

        updatedCount++;
        lastCompletedPoolId = poolId;

        if (batchCount >= 400) await flush();
    }

    await flush();

    // nextCursor: where a continuation should resume. When the budget stopped
    // the page early this is the last COMPLETED pool; on a full page it is the
    // page's last pool; null when the collection is exhausted.
    const nextCursor = hasMore ? (lastCompletedPoolId ?? afterPoolId ?? null) : null;

    return { success: true, updatedCount, plannedWrites, dryRun, nextCursor, hasMore, oversizedPools };
}

export const backfillPools = validated(
    {
        schema: backfillPoolsSchema,
        label: "backfillPools",
        role: "SUPER_ADMIN",
        appCheck: "monitor",
        // The repo's batch-migration budget (backfillMemberRecords et al.);
        // the v2 default 60s is not survivable on a populated page.
        options: { timeoutSeconds: 300, memory: "512MiB" },
    },
    async ({ dryRun, afterPoolId }, request) => {
    const result = await backfillPoolsCore(admin.firestore(), { dryRun, afterPoolId });

    await writeAdminAudit({
        actorUid: request.auth!.uid,
        actorEmail: request.auth!.token.email as string | undefined,
        action: "BACKFILL_RUN",
        targetType: "collection",
        targetId: "pools",
        metadata: {
            updatedCount: result.updatedCount,
            plannedWrites: result.plannedWrites,
            dryRun,
            afterPoolId: afterPoolId ?? null,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
            oversizedPools: result.oversizedPools,
        },
        status: "success",
    });

    return result;
    },
);
