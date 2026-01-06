"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixParticipantIds = exports.toggleWinnerPaid = exports.recalculatePoolWinners = exports.createPool = exports.assertPoolOwnerOrSuperAdmin = void 0;
const admin = require("firebase-admin");
const audit_1 = require("./audit");
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
        if (!data.name) {
            throw new https_1.HttpsError('invalid-argument', 'Missing required field: name');
        }
        const isSquaresPool = !data.type || data.type === 'SQUARES';
        if (isSquaresPool && data.costPerSquare === undefined) {
            throw new https_1.HttpsError('invalid-argument', 'Missing required field: costPerSquare');
        }
        const poolsRef = db.collection('pools');
        const userRef = db.collection('users').doc(uid);
        // Generate ID
        const poolRef = poolsRef.doc();
        const poolId = poolRef.id;
        // Prepare Pool Data
        const now = admin.firestore.Timestamp.now();
        const newPool = Object.assign(Object.assign({}, data), { id: poolId, createdByUid: uid, ownerId: uid, createdAt: now, updatedAt: now, status: 'DRAFT', isLocked: false });
        // Initialize Squares-specific data
        if (isSquaresPool) {
            newPool.squares = Array(100).fill(null).map((_, i) => ({ id: i, owner: null }));
            newPool.scores = {
                current: null,
                q1: null,
                half: null,
                q3: null,
                final: null,
                gameStatus: 'pre'
            };
        }
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
// ============ TOGGLE WINNER PAID STATUS ============
exports.toggleWinnerPaid = (0, https_1.onCall)(async (request) => {
    var _a;
    const db = admin.firestore();
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in.');
    const { poolId, winnerId } = request.data; // winnerId is the doc ID (e.g. 'q1', 'final')
    if (!poolId || !winnerId)
        throw new https_1.HttpsError('invalid-argument', 'Missing poolId or winnerId');
    const uid = request.auth.uid;
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists)
        throw new https_1.HttpsError('not-found', 'Pool not found');
    const pool = poolSnap.data();
    // Check permissions
    // Note: assertPoolOwnerOrSuperAdmin helper takes (pool, uid, role?), we might need user role.
    // For now, let's just check ownerId directly or fetch user claim if needed.
    // The helper is defined above: assertPoolOwnerOrSuperAdmin(pool: any, uid: string, userRole?: string)
    // We can fetch user role optionally or assume owner check is enough for most.
    // Fetch user role if we want to support SuperAdmin override properly
    let userRole = 'USER';
    if (request.auth.token.role)
        userRole = request.auth.token.role; // Custom claim if set
    // Or fetch doc if claims not trusted/set
    // For MVP, just try/catch the helper
    try {
        (0, exports.assertPoolOwnerOrSuperAdmin)(pool, uid, userRole);
    }
    catch (e) {
        // Fallback: fetch user doc to check real role if claim missing
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists && ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) === 'SUPER_ADMIN') {
            // Allowed
        }
        else {
            throw new https_1.HttpsError('permission-denied', 'Only the pool owner can manage payouts.');
        }
    }
    const winnerRef = poolRef.collection('winners').doc(winnerId);
    const winnerSnap = await winnerRef.get();
    if (!winnerSnap.exists)
        throw new https_1.HttpsError('not-found', 'Winner not found');
    const winnerData = winnerSnap.data();
    const isNowPaid = !(winnerData === null || winnerData === void 0 ? void 0 : winnerData.isPaid);
    await winnerRef.update({
        isPaid: isNowPaid,
        paidAt: isNowPaid ? admin.firestore.FieldValue.serverTimestamp() : null,
        paidByUid: isNowPaid ? uid : null
    });
    // Audit
    await (0, audit_1.writeAuditEvent)({
        poolId,
        type: 'SQUARE_MARKED_PAID', // Generic payment type
        message: `Winner ${winnerId} marked as ${isNowPaid ? 'PAID' : 'UNPAID'} by ${uid}`,
        severity: 'INFO',
        actor: { uid, role: 'ADMIN', label: 'Host' },
        payload: { winnerId, isPaid: isNowPaid }
    });
    return { success: true, isPaid: isNowPaid, winnerId };
});
// ============ FIX PARTICIPANT IDS (Backfill) ============
exports.fixParticipantIds = (0, https_1.onCall)(async (request) => {
    var _a;
    const db = admin.firestore();
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in.');
    // Super Admin Check
    const uid = request.auth.uid;
    const userDoc = await db.collection('users').doc(uid).get();
    if (((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'SuperAdmin only.');
    }
    const dryRun = request.data.dryRun === true;
    let processed = 0;
    let updated = 0;
    const poolsSnap = await db.collection('pools').get();
    for (const doc of poolsSnap.docs) {
        const pool = doc.data();
        const participantIds = new Set();
        // 1. Squares Pools
        if (pool.squares && Array.isArray(pool.squares)) {
            pool.squares.forEach((sq) => {
                if (sq.reservedByUid)
                    participantIds.add(sq.reservedByUid);
            });
        }
        // 2. Playoff Pools / Bracket Pools
        if (pool.entries && typeof pool.entries === 'object') {
            Object.values(pool.entries).forEach((entry) => {
                if (entry.userId)
                    participantIds.add(entry.userId);
            });
        }
        // 3. Compare with existing
        const existing = new Set(pool.participantIds || []);
        const toAdd = [...participantIds].filter(id => !existing.has(id));
        processed++;
        if (toAdd.length > 0) {
            console.log(`Pool ${pool.name} (${doc.id}): Adding ${toAdd.length} participants.`);
            if (!dryRun) {
                await doc.ref.update({
                    participantIds: admin.firestore.FieldValue.arrayUnion(...toAdd)
                });
                updated++;
            }
        }
    }
    return { success: true, processed, updated, dryRun };
});
//# sourceMappingURL=poolOps.js.map