import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { writeAdminAudit } from "./lib/adminAudit";
import { validated } from "./lib/validated";
import { backfillPoolsSchema } from "./schemas/noInputAdmin";

export const backfillPools = validated(
    { schema: backfillPoolsSchema, label: "backfillPools", role: "SUPER_ADMIN", appCheck: "monitor" },
    async (_data, request) => {
    const db = admin.firestore();
    const poolsRef = db.collection('pools');
    const usersRef = db.collection('users');

    const poolsSnap = await poolsRef.get();
    let updatedCount = 0;

    let batch = db.batch();
    let batchCount = 0;

    for (const poolDoc of poolsSnap.docs) {
        const pool = poolDoc.data();
        const ownerId = pool.ownerId;
        const poolId = poolDoc.id;

        if (!ownerId) continue;

        // 1. Backfill missing base fields (createdByUid, isPublic)
        const updates: any = {};
        if (!pool.createdByUid) {
            updates.createdByUid = ownerId;
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
        if (pool.status === 'COMPLETED' || pool.status === 'ARCHIVED') {
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

                if (batchCount >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                }
            }
        }

        updatedCount++;

        if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    await writeAdminAudit({
        actorUid: request.auth!.uid,
        actorEmail: request.auth!.token.email as string | undefined,
        action: "BACKFILL_RUN",
        targetType: "collection",
        targetId: "pools",
        metadata: { updatedCount },
        status: "success",
    });

    return { success: true, updatedCount };
    },
);

