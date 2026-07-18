import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { writeAdminAudit } from "./lib/adminAudit";
import { validated } from "./lib/validated";
import { backfillPoolsSchema } from "./schemas/noInputAdmin";

export const backfillPools = validated(
    { schema: backfillPoolsSchema, label: "backfillPools", role: "SUPER_ADMIN", appCheck: "monitor" },
    async ({ dryRun }, request) => {
    const db = admin.firestore();
    const poolsRef = db.collection('pools');
    const usersRef = db.collection('users');

    const poolsSnap = await poolsRef.get();
    let updatedCount = 0;

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

    for (const poolDoc of poolsSnap.docs) {
        const pool = poolDoc.data();
        const ownerId = pool.ownerId;
        const poolId = poolDoc.id;

        if (!ownerId) continue;

        // 1. Backfill missing base fields (createdByUid, isPublic)
        const updates: any = {};
        if (!pool.createdByUid) {
            updates.createdByUid = ownerId;
            // Derive a status ONLY for pools that have none. This used to run
            // unconditionally whenever createdByUid was missing, which recomputed
            // status from isLocked/isFinal while ignoring the value already on the
            // doc — silently resetting a COMPLETED pool to DRAFT. isLocked/isFinal
            // cannot express COMPLETED or ARCHIVED, so they must never overwrite a
            // status the pool already carries.
            if (!pool.status) {
                updates.status = pool.isLocked ? 'LOCKED' : (pool.isFinal ? 'FINAL' : 'DRAFT');
            }
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
        // Guarded by a per-pool marker because this leg is NOT idempotent: it
        // folds each entry into users/{uid}.historicalStats with
        // FieldValue.increment(), so folding the same pool twice double-counts.
        // Until the status-clobber fix above, a second run happened to skip this
        // leg (run 1 knocked status off COMPLETED) — that accident was the only
        // thing preventing double-counting. Preserving status correctly removes
        // the accident, so the guard has to be explicit.
        //
        // LIMITATION: pools folded in by a run that predates this marker carry
        // no marker, so they would be folded again. The dry-run default plus the
        // plannedWrites count is the mitigation — inspect before arming.
        const alreadyFolded = !!pool.historicalStatsFoldedAt;
        if ((pool.status === 'COMPLETED' || pool.status === 'ARCHIVED') && !alreadyFolded) {
            const entriesSnap = await poolDoc.ref.collection('entries').get();
            for (const entryDoc of entriesSnap.docs) {
                const entry = entryDoc.data();
                if (!entry.ownerUid) continue;

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
                batchCount++;

                if (batchCount >= 400) await flush();
            }

            // Stamp the pool so a later run does not fold these entries again.
            // Staged in the same batch as the increments it guards, so the
            // marker cannot land without them (or vice versa).
            batch.update(poolDoc.ref, { historicalStatsFoldedAt: FieldValue.serverTimestamp() });
            batchCount++;
        }

        updatedCount++;

        if (batchCount >= 400) await flush();
    }

    await flush();

    await writeAdminAudit({
        actorUid: request.auth!.uid,
        actorEmail: request.auth!.token.email as string | undefined,
        action: "BACKFILL_RUN",
        targetType: "collection",
        targetId: "pools",
        metadata: { updatedCount, plannedWrites, dryRun },
        status: "success",
    });

    return { success: true, updatedCount, plannedWrites, dryRun };
    },
);

