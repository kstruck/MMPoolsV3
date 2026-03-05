/**
 * Admin Claims - Cloud Functions for managing Custom Claims
 * Used to set/remove SUPER_ADMIN role as a Custom Claim on Firebase Auth tokens.
 * This is the ONLY way the isSuperAdmin() Firestore rule can be satisfied.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * setSuperAdminClaim
 * Callable function that allows an existing SUPER_ADMIN to promote or demote another user.
 * Requires: { targetUid: string, isSuperAdmin: boolean }
 */
export const setSuperAdminClaim = onCall(async (request) => {
    // 1. Must be authenticated
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be logged in.");
    }

    // 2. Caller must already be a SUPER_ADMIN (via custom claim)
    const callerClaims = request.auth.token;
    if (callerClaims.role !== "SUPER_ADMIN") {
        throw new HttpsError("permission-denied", "Only Super Admins can manage admin claims.");
    }

    const { targetUid, isSuperAdmin } = request.data as { targetUid: string; isSuperAdmin: boolean };

    if (!targetUid || typeof isSuperAdmin !== "boolean") {
        throw new HttpsError("invalid-argument", "targetUid (string) and isSuperAdmin (boolean) are required.");
    }

    // 3. Verify target user exists
    await admin.auth().getUser(targetUid); // throws if not found

    // 4. Set or remove the custom claim
    const newClaims = isSuperAdmin ? { role: "SUPER_ADMIN" } : { role: "PARTICIPANT" };
    await admin.auth().setCustomUserClaims(targetUid, newClaims);

    // 5. Mirror the role in Firestore for display purposes (not used for security checks)
    await admin.firestore().doc(`users/${targetUid}`).set(
        { role: newClaims.role },
        { merge: true }
    );

    return {
        success: true,
        message: `User ${targetUid} is now ${newClaims.role}.`,
    };
});
