"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillPools = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
exports.backfillPools = (0, https_1.onCall)(async (request) => {
    // 1. Auth Check (Super Admin Only)
    if (!request.auth || request.auth.token.role !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'Only Super Admin can run migration.');
    }
    const db = admin.firestore();
    const poolsRef = db.collection('pools');
    const usersRef = db.collection('users');
    const poolsSnap = await poolsRef.get();
    let updatedCount = 0;
    const batch = db.batch();
    for (const poolDoc of poolsSnap.docs) {
        const pool = poolDoc.data();
        const ownerId = pool.ownerId;
        const poolId = poolDoc.id;
        if (!ownerId)
            continue;
        // 1. Set createdByUid if missing
        if (!pool.createdByUid) {
            batch.update(poolDoc.ref, {
                createdByUid: ownerId,
                status: pool.isLocked ? 'LOCKED' : (pool.isFinal ? 'FINAL' : 'DRAFT') // Best guess
            });
            updatedCount++;
        }
        // 2. Create Managed Pool Index
        const indexRef = usersRef.doc(ownerId).collection('managedPools').doc(poolId);
        batch.set(indexRef, {
            poolId,
            createdAt: pool.createdAt || admin.firestore.Timestamp.now(),
            name: pool.name
        }, { merge: true });
        // 3. Upgrade User Role if needed
        // We can't read every user in this loop easily without N reads. 
        // For backfill, we might just assume they should be upgraded.
        // But let's check one by one or trust they are already managers?
        // Let's blindly set role to POOL_MANAGER if it's currently PARTICIPANT? 
        // No, that overwrites SUPER_ADMIN.
        // Let's skip role upgrade in this bulk script to avoid complexity, or do safe update.
        // "role" update is better done individually or we risk overwriting.
        // Actually, let's update role only if it doesn't exist?
        // Firestore update with condition is hard in batch.
        // Let's just do indices and pool fields.
    }
    await batch.commit();
    return { success: true, updatedCount };
});
//# sourceMappingURL=backfill.js.map