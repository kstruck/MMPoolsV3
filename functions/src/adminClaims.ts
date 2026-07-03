/**
 * Admin Claims - Cloud Functions for managing Custom Claims
 * Used to set/remove SUPER_ADMIN role as a Custom Claim on Firebase Auth tokens.
 * This is the ONLY way the isSuperAdmin() Firestore rule can be satisfied.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { normalizeRole, isCanonicalRole, type CanonicalRole } from "./lib/roles";
import { writeAdminAudit } from "./lib/adminAudit";

/**
 * setUserRole (T6)
 * Generic role assignment for SUPER_ADMIN: set any target user to any canonical
 * role. Sets the tamper-proof custom claim, mirrors users/{uid}.role for display,
 * writes an admin_audit entry, and logs ROLE_CHANGED to the target's activity.
 * Requires: { targetUid: string, role: CanonicalRole }
 */
export const setUserRole = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be logged in.");
    }
    if (request.auth.token.role !== "SUPER_ADMIN") {
        throw new HttpsError("permission-denied", "Only Super Admins can change roles.");
    }

    const { targetUid, role } = request.data as { targetUid: string; role: string };
    if (!targetUid || typeof role !== "string" || !isCanonicalRole(role)) {
        throw new HttpsError("invalid-argument", "targetUid and a valid canonical role are required.");
    }
    if (targetUid === request.auth.uid && role !== "SUPER_ADMIN") {
        // Guard against an admin accidentally locking themselves out.
        throw new HttpsError("failed-precondition", "You cannot demote your own account.");
    }

    const targetUser = await admin.auth().getUser(targetUid); // throws if not found
    const priorRole = normalizeRole(
        (await admin.firestore().doc(`users/${targetUid}`).get()).data()?.role
    );
    const newRole = role as CanonicalRole;

    await admin.auth().setCustomUserClaims(targetUid, { role: newRole });
    await admin.firestore().doc(`users/${targetUid}`).set({ role: newRole }, { merge: true });

    // Forensic trail + per-user activity.
    await writeAdminAudit({
        actorUid: request.auth.uid,
        actorEmail: request.auth.token.email as string | undefined,
        action: "ROLE_CHANGED",
        targetType: "user",
        targetId: targetUid,
        metadata: { from: priorRole, to: newRole },
        status: "success",
    });
    await admin.firestore().collection(`users/${targetUid}/activity`).add({
        type: "ROLE_CHANGED",
        from: priorRole,
        to: newRole,
        at: Date.now(),
        by: request.auth.uid,
    }).catch(() => { /* activity log is best-effort */ });

    return {
        success: true,
        message: `${targetUser.email || targetUid} is now ${newRole}.`,
        role: newRole,
    };
});

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

    // 4. Set or remove the custom claim (canonical roles; demote → MEMBER)
    const newClaims = isSuperAdmin ? { role: "SUPER_ADMIN" } : { role: "MEMBER" };
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

/**
 * syncMyClaims
 * Synchronizes the current user's Auth custom claims with their Firestore user document role.
 * This resolves the bootstrap catch-22 where a user is set as SUPER_ADMIN in the database
 * but lacks the custom claim on their Auth token to perform administrative writes or triggers.
 */
export const syncMyClaims = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be logged in.");
    }

    const uid = request.auth.uid;
    const userDoc = await admin.firestore().doc(`users/${uid}`).get();

    if (!userDoc.exists) {
        throw new HttpsError("not-found", "User document not found in Firestore.");
    }

    const userData = userDoc.data();
    // Normalize any legacy stored value so the claim is always canonical.
    const role = normalizeRole(userData?.role);

    // Set custom claim to match their Firestore role
    const claims = { role };
    await admin.auth().setCustomUserClaims(uid, claims);

    return {
        success: true,
        role,
        message: `Auth custom claims synced with Firestore. Role is now ${role}.`
    };
});
