"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculatePoolWinners = exports.createPool = exports.assertPoolOwnerOrSuperAdmin = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
// Helper to determine if user can manage pool
const assertPoolOwnerOrSuperAdmin = (pool, uid, userRole) => {
    // If Super Admin, allow
    if (userRole === 'SUPER_ADMIN')
        return;
    // Use createdByUid if available, fallback to ownerId for legacy/migration
    const owner = pool.createdByUid || pool.ownerId;
    if (owner !== uid) {
        throw new https_1.HttpsError('permission-denied', 'You do not have permission to manage this pool.');
    }
};
exports.assertPoolOwnerOrSuperAdmin = assertPoolOwnerOrSuperAdmin;
// V2 Create Pool Function
exports.createPool = (0, https_1.onCall)(async (request) => {
    try {
        // 1. Validate Auth
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be logged in.');
        }
        const uid = request.auth.uid;
        const db = admin.firestore();
        // Sanitize data: remove undefined values by JSON cycle (simplest way for deep clean)
        const rawData = request.data || {};
        const data = JSON.parse(JSON.stringify(rawData));
        // Validate inputs
        if (!data.name || !data.costPerSquare) {
            throw new https_1.HttpsError('invalid-argument', 'Missing required fields (name, costPerSquare).');
        }
        const poolsRef = db.collection('pools');
        const userRef = db.collection('users').doc(uid);
        // Generate ID
        const poolRef = poolsRef.doc();
        const poolId = poolRef.id;
        // Prepare Pool Data
        const now = admin.firestore.Timestamp.now();
        const newPool = Object.assign(Object.assign({}, data), { id: poolId, createdByUid: uid, ownerId: uid, createdAt: now, updatedAt: now, status: 'DRAFT', squares: Array(100).fill(null).map((_, i) => ({ id: i, owner: null })), isLocked: false, 
            // Ensure scores structure is valid and sanitized
            scores: {
                current: null,
                q1: null,
                half: null,
                q3: null,
                final: null,
                gameStatus: 'pre'
            } });
        // Explicitly remove undefined for safety (though JSON.parse above handles most)
        if (newPool.gameId === undefined)
            delete newPool.gameId;
        if (newPool.startTime === undefined)
            delete newPool.startTime;
        // Transaction
        await db.runTransaction(async (t) => {
            const userDoc = await t.get(userRef);
            if (!userDoc.exists) {
                throw new https_1.HttpsError('not-found', 'User profile not found.');
            }
            const userData = userDoc.data();
            const currentRole = (userData === null || userData === void 0 ? void 0 : userData.role) || 'PARTICIPANT';
            // 1. Create Pool
            t.set(poolRef, newPool);
            // 2. Upgrade Role if needed
            if (currentRole === 'PARTICIPANT') {
                t.update(userRef, { role: 'POOL_MANAGER' });
            }
            // 3. Write Manager Index
            const indexRef = userRef.collection('managedPools').doc(poolId);
            t.set(indexRef, {
                poolId,
                createdAt: now,
                name: newPool.name
            });
        });
        return { success: true, poolId };
    }
    catch (error) {
        console.error("createPool Failure:", error);
        // Re-throw HttpsErrors as is
        if (error.code && error.details)
            throw error;
        // Wrap unknown errors
        throw new https_1.HttpsError('internal', `Failed to create pool: ${error.message || 'Unknown error'}`, error);
    }
});
// ============ RECALCULATE POOL WINNERS ============
// Used to fix pools affected by the home/away reversal bug
// SuperAdmin only - re-fetches ESPN scores and recalculates all winners
exports.recalculatePoolWinners = (0, https_1.onCall)(async (request) => {
    var _a;
    const db = admin.firestore();
    // Auth check
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const uid = request.auth.uid;
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'SuperAdmin access required.');
    }
    const { poolId } = request.data;
    if (!poolId) {
        throw new https_1.HttpsError('invalid-argument', 'poolId is required.');
    }
    // Get pool data
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new https_1.HttpsError('not-found', `Pool ${poolId} not found.`);
    }
    const pool = poolSnap.data();
    // Delete existing winners subcollection
    const winnersRef = poolRef.collection('winners');
    const existingWinners = await winnersRef.get();
    const deleteBatch = db.batch();
    existingWinners.docs.forEach(doc => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();
    console.log(`[RecalcWinners] Deleted ${existingWinners.size} existing winners for pool ${poolId}`);
    // Clear stored period scores to trigger recalculation on next sync
    await poolRef.update({
        'scores.q1': null,
        'scores.half': null,
        'scores.q3': null,
        'scores.final': null,
        '_winnersCleared': admin.firestore.FieldValue.serverTimestamp(),
        '_winnersManualFix': true
    });
    // Log to audit
    await db.collection('pools').doc(poolId).collection('audit').add({
        type: 'WINNERS_RECALCULATED',
        message: `Winners cleared and pool queued for resync. ${existingWinners.size} winners deleted.`,
        severity: 'WARNING',
        actor: { uid, role: 'SUPER_ADMIN', label: 'Manual Fix' },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        payload: {
            clearedWinners: existingWinners.size,
            poolName: pool.name,
            espnGameId: pool.espnGameId || 'N/A'
        }
    });
    return {
        success: true,
        message: `Cleared ${existingWinners.size} winners for pool "${pool.name}". Pool will resync on next score update.`,
        clearedWinners: existingWinners.size
    };
});
//# sourceMappingURL=poolOps.js.map