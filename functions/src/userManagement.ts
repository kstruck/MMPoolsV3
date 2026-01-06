import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { renderEmailHtml } from "./emailStyles";

const db = admin.firestore();
const auth = admin.auth();

/**
 * Completely delete a user account (Auth + Firestore)
 * Callable by SUPER_ADMIN only.
 */
export const deleteUserAccount = functions.https.onCall(async (request) => {
    // 1. Verify Authentication & Permissions
    if (!request.auth) {
        throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
    }

    const callerUid = request.auth.uid;
    const callerSnap = await db.collection("users").doc(callerUid).get();
    const callerData = callerSnap.data();

    if (!callerData || callerData.role !== "SUPER_ADMIN") {
        throw new functions.https.HttpsError("permission-denied", "Only Super Ads can delete accounts.");
    }

    const { targetUid } = request.data;
    if (!targetUid) {
        throw new functions.https.HttpsError("invalid-argument", "Target UID is required.");
    }

    try {
        console.log(`[DeleteUser] Starting deletion for ${targetUid} by ${callerUid}`);

        // 2. Delete from Firebase Auth
        await auth.deleteUser(targetUid);
        console.log(`[DeleteUser] Auth account deleted.`);

        // 3. Delete User Document
        await db.collection("users").doc(targetUid).delete();
        console.log(`[DeleteUser] User profile deleted.`);

        // 4. (Optional) Cleanup detailed data?
        // Ideally we'd remove them from pools too, but that's expensive. 
        // We'll leave pool references for now, as they might be needed for history.
        // If "Delete Pools" logic exists, it handles pool deletion separately.

        return { success: true, message: "User account and profile deleted." };
    } catch (error: any) {
        console.error(`[DeleteUser] Failed:`, error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

/**
 * Generate a password reset link server-side and send it via custom email transport.
 * Callable by SUPER_ADMIN only.
 */
export const sendAdminPasswordReset = functions.https.onCall(async (request) => {
    // 1. Verify Authentication & Permissions
    if (!request.auth) {
        throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
    }

    const callerUid = request.auth.uid;
    const callerSnap = await db.collection("users").doc(callerUid).get();
    const callerData = callerSnap.data();

    if (!callerData || callerData.role !== "SUPER_ADMIN") {
        throw new functions.https.HttpsError("permission-denied", "Only Super Admins can reset passwords.");
    }

    const { email } = request.data;
    if (!email) {
        throw new functions.https.HttpsError("invalid-argument", "Email is required.");
    }

    try {
        console.log(`[PasswordReset] Generating link for ${email}`);

        // 2. Generate Link
        const link = await auth.generatePasswordResetLink(email);

        // 3. Construct Email
        const subject = "Reset your March Melee Pools Password";
        const bodyText = `A password reset was requested for your account.\n\nClick here to reset: ${link}\n\nIf you didn't ask for this, ignore this email.`;

        const bodyHtml = `
            <div style="font-family: sans-serif; padding: 20px;">
                <h2 style="color: #4f46e5;">Password Reset Request</h2>
                <p>An administrator has triggered a password reset for your account.</p>
                <div style="margin: 30px 0;">
                    <a href="${link}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
                </div>
                <p style="font-size: 14px; color: #666;">Or copy this link:</p>
                <p style="font-size: 12px; font-family: monospace; word-break: break-all;">${link}</p>
            </div>
        `;

        const fullHtml = renderEmailHtml("Password Reset", bodyHtml, link, "Reset Password");

        // 4. Queue Email (Write to 'mail' collection)
        await db.collection("mail").add({
            to: email,
            message: {
                subject: subject,
                text: bodyText,
                html: fullHtml
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            type: "PASSWORD_RESET"
        });

        return { success: true, message: "Reset email queued." };

    } catch (error: any) {
        console.error(`[PasswordReset] Failed:`, error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});
