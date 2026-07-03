import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { sendEmail } from "./reminders";
import { renderEmailHtml, BASE_URL, escapeHtml } from "./emailStyles";
import { NotificationLog, User } from "./types";

// Commissioner-initiated ("nudge") reminders for NFL pools (pick'em / survivor / margin).
// Scheduler-driven reminders live in reminders.ts; this callable lets a pool
// owner/manager email specific members (or everyone) on demand.

type ReminderKind = "PICKS" | "PAYMENT";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * Idempotency check — same pattern as the private createNotificationOnce in
 * reminders.ts (not exported there, replicated minimally). Creates a doc in
 * the `notifications` collection keyed by dedupeKey inside a transaction;
 * returns true if created (should send), false if it already exists (skip).
 */
async function createNotificationOnce(
    db: admin.firestore.Firestore,
    dedupeKey: string,
    logData: Omit<NotificationLog, "id">
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

interface SendManualReminderData {
    poolId: string;
    targetUids?: string[];
    kind: ReminderKind;
}

export const sendManualReminder = onCall(async (request) => {
    // 1. Auth
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }
    const uid = request.auth.uid;

    // 2. Validate input
    const { poolId, targetUids, kind } = (request.data || {}) as SendManualReminderData;
    if (!poolId || typeof poolId !== "string") {
        throw new HttpsError("invalid-argument", "poolId is required.");
    }
    if (kind !== "PICKS" && kind !== "PAYMENT") {
        throw new HttpsError("invalid-argument", "kind must be 'PICKS' or 'PAYMENT'.");
    }
    if (targetUids !== undefined && (!Array.isArray(targetUids) || targetUids.some((t) => typeof t !== "string"))) {
        throw new HttpsError("invalid-argument", "targetUids must be an array of uids.");
    }

    const db = admin.firestore();

    // 3. Permission: caller must be pool owner/manager (or SUPER_ADMIN)
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }
    const pool = { id: poolSnap.id, ...poolSnap.data() } as any;
    assertPoolOwnerOrSuperAdmin(pool, uid, request.auth.token.role as string | undefined);

    // 4. Resolve target entries (entry doc id == owner uid for NFL pools)
    const entriesSnap = await poolRef.collection("entries").get();
    let entryDocs = entriesSnap.docs;
    if (targetUids && targetUids.length > 0) {
        const targetSet = new Set(targetUids);
        entryDocs = entryDocs.filter((d) => targetSet.has((d.data().ownerUid as string) || d.id));
    }

    const poolName = pool.name || "Your pool";
    const deepLink = `${BASE_URL}/pool/${poolId}`;
    const subject = kind === "PICKS"
        ? `Reminder: Your Week picks are due — ${poolName}`
        : `Reminder: Entry payment due — ${poolName}`;

    // 4-hour rate-limit bucket shared across a pool+target+kind
    const timeBucket = Math.floor(Date.now() / FOUR_HOURS_MS);

    let sent = 0;
    let skipped = 0;
    const seenUids = new Set<string>();

    for (const doc of entryDocs) {
        const entry = doc.data();
        const targetUid = (entry.ownerUid as string) || doc.id;
        if (seenUids.has(targetUid)) continue; // one email per member
        seenUids.add(targetUid);

        // Resolve email from the user profile (same approach as the bracket
        // reminder path in reminders.ts: entry.ownerUid -> users/{uid}.email)
        const userDoc = await db.collection("users").doc(targetUid).get();
        const email = userDoc.exists ? (userDoc.data() as User).email : undefined;
        if (!email) {
            skipped++;
            continue;
        }

        // Rate limit: dedupe per pool + target + kind within a 4h bucket
        const dedupeKey = `MANUAL_${kind}:${poolId}:${targetUid}:${timeBucket}`;
        const created = await createNotificationOnce(db, dedupeKey, {
            poolId,
            type: kind === "PICKS" ? "LOCK_COUNTDOWN" : "PAYMENT_USER",
            recipient: email,
            sentAt: Date.now(),
            status: "SENT",
            metadata: { manual: true, kind, sentBy: uid },
        });
        if (!created) {
            skipped++;
            continue;
        }

        const displayName = entry.userName || entry.ownerName || "there";
        const body = kind === "PICKS"
            ? `
                <p>Hi ${escapeHtml(displayName)},</p>
                <p>Your commissioner sent a friendly reminder: your picks for <strong>${escapeHtml(poolName)}</strong> haven't been submitted yet this week.</p>
                <p>Get them in before kickoff — unsubmitted picks lock automatically.</p>
            `
            : `
                <p>Hi ${escapeHtml(displayName)},</p>
                <p>Your commissioner sent a friendly reminder: your entry payment for <strong>${escapeHtml(poolName)}</strong> is still due.</p>
                ${pool.settings?.paymentInstructions ? `<p><strong>How to pay:</strong> ${escapeHtml(pool.settings.paymentInstructions)}</p>` : ""}
            `;

        const html = renderEmailHtml(
            kind === "PICKS" ? "Picks Reminder" : "Payment Reminder",
            body,
            deepLink,
            "Open Pool"
        );
        await sendEmail(db, email, subject, html, { poolId, reason: `manual_${kind.toLowerCase()}_reminder` });
        sent++;
    }

    return { sent, skipped };
});
