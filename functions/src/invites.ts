import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { validated } from "./lib/validated";
import { sendPoolInvitesSchema } from "./schemas/poolEngagement";
import { sendEmail } from "./reminders";
import { renderEmailHtml, BASE_URL, escapeHtml } from "./emailStyles";
import { User } from "./types";

// Bulk email invites (UX overhaul Phase 3.7). Lets a commissioner paste a list
// of addresses and invite them to the pool without leaving the app. Mirrors the
// manualReminders.ts callable: owner/manager permission check + notifications
// collection dedupe docs as the rate limit.

const MAX_EMAILS_PER_CALL = 50;
const MAX_NOTE_LENGTH = 500;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Deliberately loose — real validation is delivery. Just filters obvious junk.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Idempotency check — same pattern as manualReminders.ts / the private
 * createNotificationOnce in reminders.ts. Creates a doc in `notifications`
 * keyed by dedupeKey inside a transaction; returns true if created (should
 * send), false if it already exists (skip).
 */
async function createNotificationOnce(
    db: admin.firestore.Firestore,
    dedupeKey: string,
    logData: Record<string, unknown>
): Promise<boolean> {
    const ref = db.collection("notifications").doc(dedupeKey);
    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            if (doc.exists) {
                throw new Error("ALREADY_SENT");
            }
            t.set(ref, { id: dedupeKey, ...logData });
        });
        return true;
    } catch (e) {
        if (e instanceof Error && e.message === "ALREADY_SENT") {
            return false;
        }
        throw e;
    }
}

/** Stable, non-reversible key component so raw addresses don't become doc ids. */
function hashEmail(email: string): string {
    return createHash("sha256").update(email).digest("hex").slice(0, 24);
}

export const sendPoolInvites = validated(
    // Auth + shape (50-address / 500-char-note caps) enforced by the wrapper.
    { schema: sendPoolInvitesSchema, label: "sendPoolInvites", appCheck: "monitor" },
    async (input, request) => {
    const uid = request.auth!.uid;
    const { poolId, emails, personalNote } = input;

    const db = admin.firestore();

    // 3. Permission: caller must be pool owner/manager (or SUPER_ADMIN)
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }
    const pool = { id: poolSnap.id, ...poolSnap.data() } as any;
    assertPoolOwnerOrSuperAdmin(pool, uid, request.auth!.token.role as string | undefined);

    // 4. Resolve sender display name for the subject line
    const managerDoc = await db.collection("users").doc(uid).get();
    const managerName = (managerDoc.exists && (managerDoc.data() as User).name) || "Your pool commissioner";

    const poolName = pool.name || "a pool";
    // Same join URL the share modal copies: /pool/{slug} (falls back to the doc
    // id — joinPreview resolves both slug fields and raw ids).
    const joinUrl = `${BASE_URL}/pool/${pool.slug || pool.urlSlug || poolId}`;
    const subject = `${managerName} invited you to join ${poolName}`;

    const entryFee = typeof pool.settings?.entryFee === "number" ? pool.settings.entryFee : undefined;
    const noteHtml = personalNote?.trim()
        ? `<blockquote style="margin: 0 0 20px; padding: 12px 16px; border-left: 4px solid #4f46e5; background-color: #f8fafc; color: #334155; font-size: 15px; font-style: italic;">${escapeHtml(personalNote.trim())}</blockquote>`
        : "";

    const body = `
        <p>Hi there,</p>
        <p><strong>${escapeHtml(managerName)}</strong> invited you to join their pool <strong>${escapeHtml(poolName)}</strong> on March Melee Pools.</p>
        ${entryFee && entryFee > 0 ? `<p>Entry fee: <strong>$${entryFee}</strong> (paid to the pool host, not to us).</p>` : ""}
        ${noteHtml}
        <p>Click below to see the pool and get in on the action.</p>
    `;
    const html = renderEmailHtml("You're Invited!", body, joinUrl, "View Invitation");

    // 24h rate-limit bucket: the same address can't be invited to the same pool
    // twice within a bucket. Key format: INVITE:{poolId}:{emailHash}:{bucket}
    const timeBucket = Math.floor(Date.now() / TWENTY_FOUR_HOURS_MS);

    let sent = 0;
    let skipped = 0;
    let invalid = 0;
    const seen = new Set<string>();

    for (const raw of emails) {
        const email = raw.trim().toLowerCase();
        if (!email || seen.has(email)) continue; // in-batch duplicates are silently collapsed
        seen.add(email);

        if (!EMAIL_REGEX.test(email)) {
            invalid++;
            continue;
        }

        const dedupeKey = `INVITE:${poolId}:${hashEmail(email)}:${timeBucket}`;
        const created = await createNotificationOnce(db, dedupeKey, {
            poolId,
            type: "POOL_INVITE",
            recipient: email,
            sentAt: Date.now(),
            status: "SENT",
            metadata: { sentBy: uid },
        });
        if (!created) {
            skipped++;
            continue;
        }

        await sendEmail(db, email, subject, html, { poolId, category: "announcements", reason: "pool_invite" });
        sent++;
    }

    return { sent, skipped, invalid };
    },
);
