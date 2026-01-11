"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTournamentData = exports.markEntryPaidStatus = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
// ----------------------------------------------------------------------------
// Mark Entry Paid Status
// ----------------------------------------------------------------------------
exports.markEntryPaidStatus = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    }
    const { poolId, entryId, isPaid } = request.data;
    const uid = request.auth.uid;
    if (!poolId || !entryId) {
        throw new https_1.HttpsError("invalid-argument", "Missing poolId or entryId.");
    }
    const db = admin.firestore();
    const poolRef = db.collection("pools").doc(poolId);
    const entryRef = poolRef.collection("entries").doc(entryId);
    // Verify Ownership/Managership
    const poolDoc = await poolRef.get();
    if (!poolDoc.exists) {
        throw new https_1.HttpsError("not-found", "Pool not found.");
    }
    const poolData = poolDoc.data();
    // Allow Manager OR Owner to update paid status
    if ((poolData === null || poolData === void 0 ? void 0 : poolData.managerUid) !== uid && (poolData === null || poolData === void 0 ? void 0 : poolData.ownerId) !== uid) {
        throw new https_1.HttpsError("permission-denied", "Only the pool manager can update payment status.");
    }
    await entryRef.update({
        paidStatus: isPaid ? 'PAID' : 'UNPAID',
        updatedAt: firestore_1.Timestamp.now().toMillis()
    });
    return { success: true };
});
// ----------------------------------------------------------------------------
// Update Tournament Data (Admin / ESPN Sync)
// ----------------------------------------------------------------------------
exports.updateTournamentData = (0, https_1.onCall)(async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    }
    // Role check: Only SuperAdmin should call this
    const db = admin.firestore();
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError("permission-denied", "Admin only.");
    }
    const { tournamentId, tournamentData } = request.data;
    // tournamentData should match Partial<Tournament>
    await db.collection("tournaments").doc(tournamentId).set(tournamentData, { merge: true });
    return { success: true };
});
//# sourceMappingURL=bracketOps.js.map