import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { emailHash } from "./emailPrefs";
import { sendEmail } from "./reminders";

/**
 * PLAN-AUDIT-AUTH-HARDENING A3 — notify the account owner after a password
 * reset. The auth audit's one FAIL: email changes alert the owner
 * (userManagement.ts), password resets alerted nobody, so a stolen inbox was
 * a silent account takeover.
 *
 * Deliberately PUBLIC: the reset flow is unauthenticated by nature (the user
 * proves control via the emailed oobCode; the client calls this after
 * confirmPasswordReset succeeds). Firebase Auth exposes no password-change
 * server event without Identity Platform blocking functions, so the client
 * ping is the available trust anchor. Defenses, unit-tested:
 *  - Only addresses WITH an existing account get mail; the response is
 *    identical either way (no account-enumeration oracle).
 *  - One notice per email per hour (`security_notices/{emailHash}`,
 *    transactional), so the worst abuse is one truthful-toned email/hour.
 *  - The copy instructs and never links (nothing to phish with).
 */

export const NOTICE_COOLDOWN_MS = 60 * 60 * 1000;

/** Pure: is a new notice allowed given the last one's timestamp? */
export function noticeAllowed(lastSentAtMs: number | undefined, nowMs: number): boolean {
    return lastSentAtMs === undefined || nowMs - lastSentAtMs >= NOTICE_COOLDOWN_MS;
}

const NOTICE_HTML = `
<p>The password for your March Melee Pools account was just reset using the
"forgot password" email flow.</p>
<p><strong>If this was you</strong>, no action is needed.</p>
<p><strong>If this was NOT you</strong>, someone may have access to your email
inbox. Go to marchmeleepools.com, use "Forgot password" to set a new password,
and secure your email account. This message intentionally contains no links or
buttons.</p>`;

export const notifyPasswordReset = onCall(async (request) => {
    const email = String(request.data?.email ?? "").trim().toLowerCase();
    // The single, constant response for every path below.
    const done = { ok: true };
    if (!email || !email.includes("@") || email.length > 320) return done;

    try {
        await admin.auth().getUserByEmail(email);
    } catch {
        return done; // No account — same response, no mail.
    }

    const db = admin.firestore();
    const ref = db.collection("security_notices").doc(emailHash(email));
    const now = Date.now();
    const allowed = await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const last = snap.data()?.lastSentAt as number | undefined;
        if (!noticeAllowed(last, now)) return false;
        t.set(ref, { kind: "PASSWORD_RESET", lastSentAt: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return true;
    });
    if (!allowed) return done;

    await sendEmail(db, email, "Your March Melee Pools password was reset", NOTICE_HTML, { category: "security" });
    return done;
});
