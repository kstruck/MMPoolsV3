import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { renderEmailHtml, escapeHtml } from "./emailStyles";
import { courierAuthToken, sendCourierSMS } from "./notifications/smsService";
import { sendEmail } from "./reminders";
import { writeAdminAudit } from "./lib/adminAudit";



/**
 * Completely delete a user account (Auth + Firestore)
 * Callable by SUPER_ADMIN only.
 */
export const deleteUserAccount = functions.https.onCall(async (request) => {
    const db = admin.firestore();
    const auth = admin.auth();
    // 1. Verify Authentication & Permissions
    if (!request.auth) {
        throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
    }

    const callerUid = request.auth.uid;
    // Use JWT custom claim (tamper-proof) instead of reading mutable Firestore doc
    if (request.auth.token.role !== 'SUPER_ADMIN') {
        throw new functions.https.HttpsError("permission-denied", "Only Super Admins can delete accounts.");
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

        await writeAdminAudit({
            actorUid: callerUid,
            actorEmail: request.auth.token.email as string | undefined,
            action: "USER_DELETED",
            targetType: "user",
            targetId: targetUid,
            status: "success",
        });
        return { success: true, message: "User account and profile deleted." };
    } catch (error: any) {
        console.error(`[DeleteUser] Failed:`, error);
        await writeAdminAudit({
            actorUid: callerUid,
            actorEmail: request.auth.token.email as string | undefined,
            action: "USER_DELETED",
            targetType: "user",
            targetId: targetUid,
            status: "error",
            error: error?.message,
        });
        throw new functions.https.HttpsError("internal", error.message);
    }
});

/**
 * Generate a password reset link server-side and send it via custom email transport.
 * Callable by SUPER_ADMIN only.
 */
export const sendAdminPasswordReset = functions.https.onCall(async (request) => {
    const db = admin.firestore();
    const auth = admin.auth();
    // 1. Verify Authentication & Permissions
    if (!request.auth) {
        throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
    }

    // Use JWT custom claim (tamper-proof) instead of reading mutable Firestore doc
    if (request.auth.token.role !== 'SUPER_ADMIN') {
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
        await sendEmail(db, email, subject, fullHtml, { type: "PASSWORD_RESET", transactional: true });

        // 4b. Activity Log dual-write (CONTEXT.md): record PASSWORD_RESET_SENT on the
        // target user's own activity subcollection, not just the actor-side admin_audit.
        try {
            const targetUser = await auth.getUserByEmail(email);
            await db.collection("users").doc(targetUser.uid).collection("activity").add({
                type: "PASSWORD_RESET_SENT",
                at: admin.firestore.FieldValue.serverTimestamp(),
                actorUid: request.auth.uid,
            });
        } catch (e) {
            // Non-fatal: the reset email already went out; the actor-side audit still records it.
            console.warn("[PasswordReset] activity-log write failed (non-fatal):", e);
        }

        await writeAdminAudit({
            actorUid: request.auth.uid,
            actorEmail: request.auth.token.email as string | undefined,
            action: "PASSWORD_RESET_SENT",
            targetType: "user",
            metadata: { email },
            status: "success",
        });
        return { success: true, message: "Reset email queued." };

    } catch (error: any) {
        console.error(`[PasswordReset] Failed:`, error);
        await writeAdminAudit({
            actorUid: request.auth.uid,
            actorEmail: request.auth.token.email as string | undefined,
            action: "PASSWORD_RESET_SENT",
            targetType: "user",
            metadata: { email },
            status: "error",
            error: error?.message,
        });
        throw new functions.https.HttpsError("internal", error.message);
    }
});

/**
 * Send a security SMS alert to the authenticated user.
 */
export const sendSecuritySMSAlert = functions.https.onCall({ secrets: [courierAuthToken] }, async (request) => {
    if (!request.auth) {
        throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
    }

    const uid = request.auth.uid;
    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();

    if (!userData || !userData.phone || !userData.smsOptIn) {
        return { success: true, message: "No SMS sent, user not opted in or no phone number." };
    }

    try {
        const message = "Security Alert: A request to change your account email has been initiated.";
        const success = await sendCourierSMS(userData.phone, message);
        return { success, message: success ? "Alert sent" : "Failed to send SMS" };
    } catch (error: any) {
        console.error(`[SecuritySMS] Failed:`, error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

/**
 * Test Endpoint for SMS
 */
export const testSmsHttp = functions.https.onRequest({ secrets: [courierAuthToken] }, async (req, res) => {
    // Security: Require Firebase Auth Bearer token with SUPER_ADMIN role
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).send("Unauthorized: Missing Bearer token");
        return;
    }
    try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(token);
        if (decoded.role !== 'SUPER_ADMIN') {
            res.status(403).send("Forbidden: Super Admin access required");
            return;
        }
    } catch {
        res.status(401).send("Unauthorized: Invalid token");
        return;
    }

    const phone = req.query.phone as string;
    if (!phone) {
        res.status(400).send("Provide ?phone=1234567890");
        return;
    }

    // Normalize to E.164 for debug output
    const digits = phone.replace(/\D/g, "");
    const e164 = digits.length === 10 ? `+1${digits}` : (digits.startsWith("1") && digits.length === 11 ? `+${digits}` : `+${digits}`);

    console.log(`[TestSMS] Raw phone: ${phone}, E.164: ${e164}`);
    console.log(`[TestSMS] Token present: ${!!courierAuthToken.value()}, Token length: ${courierAuthToken.value()?.length}`);

    const success = await sendCourierSMS(phone, "This is a test message from March Melee Pools 🏀");
    res.send({ success, phone_raw: phone, phone_e164: e164, token_present: !!courierAuthToken.value() });
});

/**
 * searchUsersByEmail — paged admin user lookup by email prefix (step 6b).
 * Replaces scanning the full user list for the common "find a user" flow.
 * SUPER_ADMIN or MODERATOR (both view users per CONTEXT.md User Management).
 * Uses the searchEmail (lowercased) field + Firestore's default single-field
 * index, so it stays cheap as the userbase grows.
 */
export const searchUsersByEmail = functions.https.onCall(async (request) => {
    if (!request.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
    }
    const role = request.auth.token.role;
    if (role !== "SUPER_ADMIN" && role !== "MODERATOR") {
        throw new functions.https.HttpsError("permission-denied", "Admins only.");
    }

    const { prefix, limit } = request.data as { prefix?: string; limit?: number };
    const p = (prefix || "").trim().toLowerCase();
    if (!p) {
        throw new functions.https.HttpsError("invalid-argument", "A non-empty email prefix is required.");
    }
    const cap = Math.min(typeof limit === "number" && limit > 0 ? limit : 25, 50);

    const snap = await admin.firestore().collection("users")
        .orderBy("searchEmail")
        .startAt(p)
        .endAt(p + "")
        .limit(cap)
        .get();

    const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { users, count: users.length };
});

/**
 * sendUserEmail (step 6c) — admin one-off email to a single user.
 * SUPER_ADMIN or MODERATOR (both may email any user per CONTEXT.md User
 * Management). Dual-writes the CONTEXT.md contract: EMAIL_SENT on the target
 * user's activity subcollection + an actor-side admin_audit entry.
 */
export const sendUserEmail = functions.https.onCall(async (request) => {
    if (!request.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
    }
    const role = request.auth.token.role;
    if (role !== "SUPER_ADMIN" && role !== "MODERATOR") {
        throw new functions.https.HttpsError("permission-denied", "Only admins can email users.");
    }

    const { targetUid, subject, body } = request.data as { targetUid?: string; subject?: string; body?: string };
    if (!targetUid || !subject?.trim() || !body?.trim()) {
        throw new functions.https.HttpsError("invalid-argument", "targetUid, subject and body are required.");
    }

    const db = admin.firestore();
    const userSnap = await db.doc(`users/${targetUid}`).get();
    const email = userSnap.data()?.email as string | undefined;
    if (!email) {
        throw new functions.https.HttpsError("failed-precondition", "That user has no email on file.");
    }

    // Escape the admin-authored body — it must never be injected as raw HTML.
    const html = renderEmailHtml(subject.trim(), `<p>${escapeHtml(body.trim()).replace(/\n/g, "<br/>")}</p>`);
    await sendEmail(db, email, subject.trim(), html, { type: "ADMIN_ONEOFF", transactional: true });

    try {
        await db.collection("users").doc(targetUid).collection("activity").add({
            type: "EMAIL_SENT",
            at: admin.firestore.FieldValue.serverTimestamp(),
            actorUid: request.auth.uid,
            subject: subject.trim().slice(0, 200),
        });
    } catch (e) {
        console.warn("[sendUserEmail] activity-log write failed (non-fatal):", e);
    }

    await writeAdminAudit({
        actorUid: request.auth.uid,
        actorEmail: request.auth.token.email as string | undefined,
        action: "EMAIL_SENT",
        targetType: "user",
        targetId: targetUid,
        metadata: { subject: subject.trim().slice(0, 200) },
        status: "success",
    });

    return { success: true };
});
