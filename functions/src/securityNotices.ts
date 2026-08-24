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

/** Global send cap: at most this many notices across ALL addresses per hour
 *  bucket (codex r2 P2: the per-email cooldown alone still allowed a broad
 *  targeting campaign). 20/hr covers any legitimate reset volume this app
 *  will see while capping an abuse campaign at 20 truthful-toned emails/hr.
 *  App Check enforce would be the stronger gate; it is BLOCKED repo-wide
 *  (2026-07-30 outage, HANDOFF STOP POINT) — revisit when that lands. */
export const GLOBAL_HOURLY_CAP = 20;

export function hourBucket(nowMs: number): number {
    return Math.floor(nowMs / NOTICE_COOLDOWN_MS);
}

export const notifyPasswordReset = onCall(async (request) => {
    const email = String(request.data?.email ?? "").trim().toLowerCase();
    // The single, constant response for every path below.
    const done = { ok: true };
    if (!email || !email.includes("@") || email.length > 320) return done;

    const db = admin.firestore();
    const ref = db.collection("security_notices").doc(emailHash(email));
    const metaRef = db.collection("security_notices").doc("_meta");
    const now = Date.now();

    // Account lookup FIRST, reservation second — but the reservation
    // transaction runs for existing and missing accounts alike, so the two
    // paths do comparable work (blunts the user-enumeration timing oracle,
    // codex r2 P2).
    let accountExists = true;
    try {
        await admin.auth().getUserByEmail(email);
    } catch {
        accountExists = false;
    }

    const allowed = await db.runTransaction(async (t) => {
        const [snap, metaSnap] = await Promise.all([t.get(ref), t.get(metaRef)]);
        const last = snap.data()?.lastSentAt as number | undefined;
        const meta = metaSnap.data() as { bucket?: number; count?: number } | undefined;
        const bucket = hourBucket(now);
        const count = meta?.bucket === bucket ? (meta.count ?? 0) : 0;
        if (!noticeAllowed(last, now) || count >= GLOBAL_HOURLY_CAP) return false;
        // Reserve even when the account does not exist: same writes, same
        // latency, and repeated probes of ANY address burn the same limits.
        t.set(ref, { kind: "PASSWORD_RESET", lastSentAt: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        t.set(metaRef, { bucket, count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return true;
    });
    if (!allowed || !accountExists) return done;

    // transactional: true (codex r1 P1) — a security notice must bypass the
    // marketing opt-out, or exactly the users who opted out get silent
    // takeovers.
    const outcome = await sendEmail(db, email, "Your March Melee Pools password was reset", NOTICE_HTML, { category: "security", transactional: true });
    if (outcome !== "queued") {
        // Release the per-email cooldown so a transient queue failure does not
        // suppress the NEXT genuine notice for an hour (codex r2 P2). The
        // global counter deliberately keeps its slot — failures still spent work.
        await ref.delete().catch(() => { /* best-effort */ });
    }
    return done;
});
