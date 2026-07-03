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

/** Non-transactional mail categories a recipient can opt out of individually. */
export const EMAIL_CATEGORIES = ["reminders", "results", "announcements"] as const;
export type EmailCategory = typeof EMAIL_CATEGORIES[number];
export type EmailCategoryPrefs = Partial<Record<EmailCategory, boolean>>;

export interface EmailPrefs {
    /** True = block everything non-transactional (Phase-1 unsubscribe-all). */
    optedOutAll: boolean;
    /** Per-category prefs; a category set to false = opted out of that category. */
    categories: EmailCategoryPrefs;
}

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
    // Footer link lands on the preference center (manageEmailPrefs), which
    // includes an "unsubscribe from all" option. The legacy emailUnsubscribe
    // endpoint stays deployed so links in already-sent emails keep working.
    const base = `https://us-central1-${project}.cloudfunctions.net/manageEmailPrefs`;
    return `${base}?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${token}`;
}

export async function isOptedOut(db: admin.firestore.Firestore, email: string): Promise<boolean> {
    const snap = await db.collection("email_optouts").doc(emailHash(email)).get();
    if (!snap.exists) return false;
    // Phase-1 shape ({ email, optedOutAt } with no categories map) means
    // "block everything non-transactional". A doc that carries a categories
    // map holds per-category prefs only and must NOT trigger the all-block.
    return !snap.data()?.categories;
}

/**
 * Full preference read: unsubscribe-all flag + per-category prefs.
 * A missing doc means fully subscribed. false in categories = opted out.
 */
export async function getPrefs(db: admin.firestore.Firestore, email: string): Promise<EmailPrefs> {
    const snap = await db.collection("email_optouts").doc(emailHash(email)).get();
    if (!snap.exists) return { optedOutAll: false, categories: {} };
    const data = snap.data() ?? {};
    const categories = (data.categories ?? {}) as EmailCategoryPrefs;
    return { optedOutAll: !data.categories, categories };
}

/** Constant-time token comparison — exported for the HTTP endpoint. */
export function verifyUnsubToken(email: string, token: string, secret: string): boolean {
    const expected = makeUnsubToken(email, secret);
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expected);
    return tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf);
}
