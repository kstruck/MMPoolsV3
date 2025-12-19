
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

import { Timestamp } from "firebase-admin/firestore";

const db = admin.firestore();

// ----------------------------------------------------------------------------
// Mark Entry Paid Status
// ----------------------------------------------------------------------------
export const markEntryPaidStatus = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const { poolId, entryId, isPaid } = request.data;
    const uid = request.auth.uid;

    if (!poolId || !entryId) {
        throw new HttpsError("invalid-argument", "Missing poolId or entryId.");
    }

    const poolRef = db.collection("pools").doc(poolId);
    const entryRef = poolRef.collection("entries").doc(entryId);

    // Verify Ownership/Managership
    const poolDoc = await poolRef.get();
    if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }
    const poolData = poolDoc.data();

    // Allow Manager OR Owner to update paid status
    if (poolData?.managerUid !== uid && poolData?.ownerId !== uid) {
        throw new HttpsError("permission-denied", "Only the pool manager can update payment status.");
    }

    await entryRef.update({
        paidStatus: isPaid ? 'PAID' : 'UNPAID',
        updatedAt: Timestamp.now().toMillis()
    });

    return { success: true };
});


// ----------------------------------------------------------------------------
// Update Tournament Data (Admin / ESPN Sync)
// ----------------------------------------------------------------------------
export const updateTournamentData = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    // Role check: Only SuperAdmin should call this
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== 'SUPER_ADMIN') {
        throw new HttpsError("permission-denied", "Admin only.");
    }

    const { tournamentId, tournamentData } = request.data;
    // tournamentData should match Partial<Tournament>

    await db.collection("tournaments").doc(tournamentId).set(tournamentData, { merge: true });

    return { success: true };
});
