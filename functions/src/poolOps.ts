import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

// Helper to determine if user can manage pool
export const assertPoolOwnerOrSuperAdmin = (pool: any, uid: string, userRole?: string) => {
    // If Super Admin, allow
    if (userRole === 'SUPER_ADMIN') return;

    // Use createdByUid if available, fallback to ownerId for legacy/migration
    const owner = pool.createdByUid || pool.ownerId;
    if (owner !== uid) {
        throw new HttpsError('permission-denied', 'You do not have permission to manage this pool.');
    }
};

// V2 Create Pool Function
export const createPool = onCall(async (request) => {
    // 1. Validate Auth
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const uid = request.auth.uid;
    const db = admin.firestore();
    const data = request.data;

    // Validate inputs
    if (!data.name || !data.costPerSquare) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    const poolsRef = db.collection('pools');
    const userRef = db.collection('users').doc(uid);

    // Generate ID
    const poolRef = poolsRef.doc();
    const poolId = poolRef.id;

    // Prepare Pool Data
    const now = admin.firestore.Timestamp.now();

    const newPool = {
        ...data,
        id: poolId,
        createdByUid: uid,
        ownerId: uid, // Keep for backward compatibility
        createdAt: now,
        updatedAt: now,
        status: 'DRAFT',
        squares: Array(100).fill(null).map((_, i) => ({ id: i, owner: null })), // Init empty squares
        // Ensure defaults for critical fields
        isLocked: false,
        scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' }
    };

    // Transaction
    await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        if (!userDoc.exists) {
            throw new HttpsError('not-found', 'User profile not found.');
        }

        const userData = userDoc.data();
        const currentRole = userData?.role || 'PARTICIPANT';

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
});
