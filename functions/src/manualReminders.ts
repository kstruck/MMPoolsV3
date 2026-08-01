import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { sendManualReminderSchema } from "./schemas/reminderWaitlist";
import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { sendEmail } from "./reminders";
import { renderEmailHtml, BASE_URL, escapeHtml } from "./emailStyles";
import { NotificationLog, User } from "./types";
import type { MemberRecord } from "./shared/memberRecord";
import { resolveReminderTargets, outstandingDuesByUid, rebuyPortionByUid } from "./lib/reminderTargets";

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

    // Hoisted: the same liability map answers the owes-anything gate below AND
    // (with rebuyPortionByUid) which debt the email should name.
    const entryRebuys = new Map(entriesSnap.docs.map((d) => [
        (d.data().ownerUid as string) || d.id,
        (d.data().rebuysUsed as number) ?? 0,
    ]));
    const memberRecs = membersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as MemberRecord) }));
    const outstandingByUid = kind === "PAYMENT"
        ? outstandingDuesByUid(
            pool,
            memberRecs,
            new Set(entriesSnap.docs.map((d) => (d.data().ownerUid as string) || d.id)),
            entryRebuys,
        )
        : undefined;

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
        outstandingByUid,
    );

    const poolName = pool.name || "Your pool";
    const deepLink = `${BASE_URL}/pool/${poolId}`;

    // A PAYMENT reminder's debt type varies BY MEMBER, so the subject cannot be
    // computed once for the whole send. A Survivor member who paid their entry
    // fee and still owes rebuys was previously told "Entry payment due" about a
    // fee they had already paid — the reminder named the wrong debt, which is
    // the same class of error as reporting a skip as a success.
    const rebuyOwedByUid = kind === "PAYMENT"
        ? rebuyPortionByUid(pool, memberRecs, entryRebuys)
        : new Map<string, number>();

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

        // Rebuy-only: this member's ENTIRE remaining balance is rebuy dues, so
        // naming the entry fee would assert something false about money they
        // already paid. A member who owes both is told about both rather than
        // getting two emails — the 4h dedupe key is per pool+member+kind, so a
        // second send would be suppressed anyway and they would hear only half.
        // Both debt maps are built from MEMBER RECORDS. A member represented only
        // by an entry - a partially backfilled pool - is absent from both, so the
        // split between entry fee and rebuy is UNKNOWN for them. Saying "Entry
        // payment due" would assert a specific debt the sender cannot see, which
        // is the exact failure this change exists to fix, one case along.
        const classifiable = rebuyOwedByUid.has(targetUid);
        const rebuyOwed = rebuyOwedByUid.get(targetUid) ?? 0;
        const totalOwed = outstandingByUid?.get(targetUid);
        const rebuyOnly = kind === "PAYMENT"
            && classifiable
            && rebuyOwed > 0
            && totalOwed !== undefined
            && rebuyOwed >= totalOwed;
        const owesBoth = kind === "PAYMENT" && classifiable && rebuyOwed > 0 && !rebuyOnly;
        // Also unclassified when the TOTAL is missing: outstandingDuesByUid
        // deliberately deletes a legacy rebuy record whose derived balance is
        // <= 0 (price drift), meaning "unknown, stay eligible". classifiable can
        // still be true there, which would have named the entry fee.
        const unclassified = kind === "PAYMENT" && (!classifiable || totalOwed === undefined);

        const payInstructions = pool.settings?.paymentInstructions
            ? `<p><strong>How to pay:</strong> ${escapeHtml(pool.settings.paymentInstructions)}</p>`
            : "";

        let subject: string;
        let heading: string;
        let body: string;

        if (kind === "PICKS") {
            subject = `Reminder: Your Week picks are due — ${poolName}`;
            heading = "Picks Reminder";
            body = `
                <p>Hi ${escapeHtml(displayName)},</p>
                <p>Your commissioner sent a friendly reminder: your picks for <strong>${escapeHtml(poolName)}</strong> haven't been submitted yet this week.</p>
                <p>Get them in before kickoff — unsubmitted picks lock automatically.</p>
            `;
        } else if (rebuyOnly) {
            subject = `Reminder: Rebuy payment due — ${poolName}`;
            heading = "Rebuy Payment Reminder";
            body = `
                <p>Hi ${escapeHtml(displayName)},</p>
                <p>Your commissioner sent a friendly reminder: your <strong>rebuy</strong> for <strong>${escapeHtml(poolName)}</strong> is still due.</p>
                <p>This is not your entry fee — that is settled. A rebuy is charged separately when you buy back in after being eliminated.</p>
                ${payInstructions}
            `;
        } else if (owesBoth) {
            subject = `Reminder: Entry and rebuy payment due — ${poolName}`;
            heading = "Payment Reminder";
            body = `
                <p>Hi ${escapeHtml(displayName)},</p>
                <p>Your commissioner sent a friendly reminder: your <strong>entry fee and rebuy</strong> for <strong>${escapeHtml(poolName)}</strong> are still due.</p>
                ${payInstructions}
            `;
        } else if (unclassified) {
            subject = `Reminder: Payment due — ${poolName}`;
            heading = "Payment Reminder";
            body = `
                <p>Hi ${escapeHtml(displayName)},</p>
                <p>Your commissioner sent a friendly reminder: you have an outstanding balance for <strong>${escapeHtml(poolName)}</strong>.</p>
                ${payInstructions}
            `;
        } else {
            subject = `Reminder: Entry payment due — ${poolName}`;
            heading = "Payment Reminder";
            body = `
                <p>Hi ${escapeHtml(displayName)},</p>
                <p>Your commissioner sent a friendly reminder: your entry payment for <strong>${escapeHtml(poolName)}</strong> is still due.</p>
                ${payInstructions}
            `;
        }

        const html = renderEmailHtml(
            heading,
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
