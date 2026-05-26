"use strict";
/**
 * Admin Claims - Cloud Functions for managing Custom Claims
 * Used to set/remove SUPER_ADMIN role as a Custom Claim on Firebase Auth tokens.
 * This is the ONLY way the isSuperAdmin() Firestore rule can be satisfied.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncMyClaims = exports.setSuperAdminClaim = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
/**
 * setSuperAdminClaim
 * Callable function that allows an existing SUPER_ADMIN to promote or demote another user.
 * Requires: { targetUid: string, isSuperAdmin: boolean }
 */
exports.setSuperAdminClaim = (0, https_1.onCall)(async (request) => {
    // 1. Must be authenticated
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in.");
    }
    // 2. Caller must already be a SUPER_ADMIN (via custom claim)
    const callerClaims = request.auth.token;
    if (callerClaims.role !== "SUPER_ADMIN") {
        throw new https_1.HttpsError("permission-denied", "Only Super Admins can manage admin claims.");
    }
    const { targetUid, isSuperAdmin } = request.data;
    if (!targetUid || typeof isSuperAdmin !== "boolean") {
        throw new https_1.HttpsError("invalid-argument", "targetUid (string) and isSuperAdmin (boolean) are required.");
    }
    // 3. Verify target user exists
    await admin.auth().getUser(targetUid); // throws if not found
    // 4. Set or remove the custom claim
    const newClaims = isSuperAdmin ? { role: "SUPER_ADMIN" } : { role: "PARTICIPANT" };
    await admin.auth().setCustomUserClaims(targetUid, newClaims);
    // 5. Mirror the role in Firestore for display purposes (not used for security checks)
    await admin.firestore().doc(`users/${targetUid}`).set({ role: newClaims.role }, { merge: true });
    return {
        success: true,
        message: `User ${targetUid} is now ${newClaims.role}.`,
    };
});
/**
 * syncMyClaims
 * Synchronizes the current user's Auth custom claims with their Firestore user document role.
 * This resolves the bootstrap catch-22 where a user is set as SUPER_ADMIN in the database
 * but lacks the custom claim on their Auth token to perform administrative writes or triggers.
 */
exports.syncMyClaims = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in.");
    }
    const uid = request.auth.uid;
    const userDoc = await admin.firestore().doc(`users/${uid}`).get();
    if (!userDoc.exists) {
        throw new https_1.HttpsError("not-found", "User document not found in Firestore.");
    }
    const userData = userDoc.data();
    const role = (userData === null || userData === void 0 ? void 0 : userData.role) || "PARTICIPANT";
    // Set custom claim to match their Firestore role
    const claims = { role };
    await admin.auth().setCustomUserClaims(uid, claims);
    return {
        success: true,
        role,
        message: `Auth custom claims synced with Firestore. Role is now ${role}.`
    };
});
//# sourceMappingURL=adminClaims.js.map