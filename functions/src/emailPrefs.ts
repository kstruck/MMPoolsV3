import * as admin from "firebase-admin";
import * as crypto from "crypto";

/**
 * Email unsubscribe helpers (CAN-SPAM / GDPR compliance).
 *
 * Every outbound email footer carries a per-recipient link:
 *   {emailUnsubscribe fn URL}?e={email}&t={hmac(email)}
 * Hitting it records an opt-out keyed by a hash of the address, which
 * sendEmail() checks before queuing anything to the /mail collection.
 *
 * The HMAC key is generated once and stored in Firestore (config/internal),
 * which client security rules must not expose. ponytail: Firestore-stored
 * secret keeps deploys friction-free; move to Secret Manager if this ever
 * guards anything higher-value than unsubscribe links.
 *
 * NOTE: keep this module free of firebase-functions imports — it is pulled
 * into reminders.ts whose unit tests mock firebase-functions at import time.
 * The HTTP endpoint lives in emailUnsubscribeHttp.ts.
 */

const SECRET_DOC = "config/internal";
let cachedSecret: string | null = null;

export async function getUnsubSecret(db: admin.firestore.Firestore): Promise<string> {
    if (cachedSecret) return cachedSecret;
    const ref = db.doc(SECRET_DOC);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data()?.emailUnsubSecret as string | undefined) : undefined;
    if (existing) {
        cachedSecret = existing;
        return existing;
    }
    const fresh = crypto.randomBytes(32).toString("hex");
    await ref.set({ emailUnsubSecret: fresh }, { merge: true });
    cachedSecret = fresh;
    return fresh;
}

export function makeUnsubToken(email: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export function emailHash(email: string): string {
    return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export async function buildUnsubUrl(db: admin.firestore.Firestore, email: string): Promise<string> {
    const secret = await getUnsubSecret(db);
    const token = makeUnsubToken(email, secret);
    const project = process.env.GCLOUD_PROJECT;
    const base = `https://us-central1-${project}.cloudfunctions.net/emailUnsubscribe`;
    return `${base}?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${token}`;
}

export async function isOptedOut(db: admin.firestore.Firestore, email: string): Promise<boolean> {
    const snap = await db.collection("email_optouts").doc(emailHash(email)).get();
    return snap.exists;
}

/** Constant-time token comparison — exported for the HTTP endpoint. */
export function verifyUnsubToken(email: string, token: string, secret: string): boolean {
    const expected = makeUnsubToken(email, secret);
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expected);
    return tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf);
}
