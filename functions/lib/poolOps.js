"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPool = exports.assertPoolOwnerOrSuperAdmin = void 0;
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
//# sourceMappingURL=poolOps.js.map