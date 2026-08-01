import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { sendManualReminderSchema } from "./schemas/reminderWaitlist";
import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { sendEmail } from "./reminders";
import { renderEmailHtml, BASE_URL, escapeHtml } from "./emailStyles";
import { NotificationLog, User } from "./types";
import type { MemberRecord } from "./shared/memberRecord";
import { resolveReminderTargets, outstandingDuesByUid } from "./lib/reminderTargets";

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

export const sendManualReminder = validated(
    // Shape enforced by the wrapper; pool owner/manager/SUPER_ADMIN permission
    // stays resource-scoped below.
    { schema: sendManualReminderSchema, label: "sendManualReminder", appCheck: "monitor" },
    async (input, request) => {
    const uid = request.auth!.uid;
    const { poolId, targetUids, kind } = input;

    const db = admin.firestore();

    // 3. Permission: caller must be pool owner/manager (or SUPER_ADMIN)
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }
    const pool = { id: poolSnap.id, ...poolSnap.data() } as any;
    assertPoolOwnerOrSuperAdmin(pool, uid, request.auth!.token.role as string | undefined);

    // 4. Resolve targets from the ROSTER, not the entries collection.
    //
    // This used to read entries alone, which made the feature unable to reach
    // the one person it exists for: a member who has never submitted matched no
    // entry, so the call returned `sent: 0, skipped: 0` and nothing was sent.
    // The Member Record (pools/{poolId}/members/{uid}) is the membership truth
    // per ADR 0003; entry existence is a fact ABOUT a member, not the roster.
    //
    // Entries are still read and UNIONed in rather than used as an either/or
    // fallback. Two states need that: pools written before Member Records
    // existed, and pools only partly covered by `backfillMemberRecords` — in a
    // partly-covered pool a "members exist, so ignore entries" branch would
    // silently drop the members who still have only an entry.
    //
    // A voided membership DELETES the record (`voidMemberRecord`), so a present
    // doc is a current member and needs no further filtering.
    const [membersSnap, entriesSnap] = await Promise.all([
        poolRef.collection("members").get(),
        poolRef.collection("entries").get(),
    ]);

    const targetList = resolveReminderTargets(
        membersSnap.docs.map((d) => ({ id: d.id, userName: (d.data() as Partial<MemberRecord>).userName })),
        entriesSnap.docs.map((d) => {
            const entry = d.data();
            return {
                id: d.id,
                ownerUid: entry.ownerUid as string | undefined,
                userName: entry.userName as string | undefined,
                ownerName: entry.ownerName as string | undefined,
            };
        }),
        targetUids,
        Array.isArray(pool.participantIds) ? (pool.participantIds as string[]) : [],
        kind === "PAYMENT"
            ? outstandingDuesByUid(
                pool,
                membersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as MemberRecord) })),
                new Set(entriesSnap.docs.map((d) => (d.data().ownerUid as string) || d.id)),
                new Map(entriesSnap.docs.map((d) => [
                    (d.data().ownerUid as string) || d.id,
                    (d.data().rebuysUsed as number) ?? 0,
                ])),
            )
            : undefined,
    );

    const poolName = pool.name || "Your pool";
    const deepLink = `${BASE_URL}/pool/${poolId}`;
    const subject = kind === "PICKS"
        ? `Reminder: Your Week picks are due — ${poolName}`
        : `Reminder: Entry payment due — ${poolName}`;

    // 4-hour rate-limit bucket shared across a pool+target+kind
    const timeBucket = Math.floor(Date.now() / FOUR_HOURS_MS);

    let sent = 0;
    let skipped = 0;
    // `skipped` alone cannot be explained by the caller: it mixes "no email on
    // the profile" with "already reminded inside the 4h window". The UI was
    // reporting every skip as the second, which is a guess presented as a fact.
    let skippedNoEmail = 0;
    let skippedRateLimited = 0;
    let skippedNoBalance = 0;

    // The Map is keyed by uid, so one email per member is structural — the
    // explicit seen-set the entries loop needed is gone.
    for (const target of targetList) {
        const targetUid = target.uid;

        // Owes nothing — a "payment due" email would be a false chase. Counted,
        // never silently dropped: an empty result is reported by the UI as "not
        // on this pool's roster", which would be a wrong and alarming thing to
        // tell a commissioner about a member who is plainly there.
        if (target.owesNothing) {
            skipped++;
            skippedNoBalance++;
            continue;
        }

        // Resolve email from the user profile (same approach as the bracket
        // reminder path in reminders.ts: entry.ownerUid -> users/{uid}.email)
        const userDoc = await db.collection("users").doc(targetUid).get();
        const email = userDoc.exists ? (userDoc.data() as User).email : undefined;
        if (!email) {
            skipped++;
            skippedNoEmail++;
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
            skippedRateLimited++;
            continue;
        }

        const displayName = target.displayName || "there";
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

    return { sent, skipped, skippedNoEmail, skippedRateLimited, skippedNoBalance };
    },
);
