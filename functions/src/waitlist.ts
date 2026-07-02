import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";

interface JoinWaitlistData {
    poolId: string;
    name: string;
    email: string;
}

import { sendEmail } from "./reminders";
import { renderEmailHtml, BASE_URL } from "./emailStyles";

export const joinWaitlist = functions.https.onCall(async (request) => {
    const db = admin.firestore();
    const { poolId, name, email } = request.data as JoinWaitlistData;

    if (!poolId || !name || !email) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "Missing poolId, name, or email."
        );
    }

    const poolRef = db.collection("pools").doc(poolId);
    let poolName = "March Melee Pool"; // Default

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(poolRef);
            if (!doc.exists) {
                throw new functions.https.HttpsError("not-found", "Pool not found.");
            }

            const poolData = doc.data();
            poolName = poolData?.name || poolName;
            const waitlist = poolData?.waitlist || [];

            // Check if already on waitlist
            const isAlreadyOnList = waitlist.some((entry: any) =>
                entry.email.toLowerCase() === email.toLowerCase()
            );

            if (isAlreadyOnList) {
                throw new functions.https.HttpsError("already-exists", "You are already on the waitlist.");
            }

            const entry = {
                name: name.trim(),
                email: email.trim(),
                timestamp: Date.now(),
                userId: request.auth?.uid || null // Optional: link to user if logged in
            };

            t.update(poolRef, {
                waitlist: admin.firestore.FieldValue.arrayUnion(entry),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        // Send Confirmation Email
        const subject = `You're on the Waitlist: ${poolName}`;
        const body = `
            <p>Hi ${name},</p>
            <p>You have successfully joined the waitlist for <strong>${poolName}</strong>.</p>
            <p>If a square becomes available, we will notify you immediately via email.</p>
        `;
        const html = renderEmailHtml("Waitlist Confirmed", body, `${BASE_URL}/pool/${poolId}`, "View Pool");

        // Fire and forget email (don't block response) - checking promise for clean logs though
        sendEmail(db, email, subject, html, { poolId, reason: 'WAITLIST_JOIN' })
            .catch(err => console.error("Failed to send waitlist confirmation email:", err));

        return { success: true };
    } catch (error: any) {
        console.error("Error joining waitlist:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "Failed to join waitlist.");
    }
});

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { notifyWaitlist } from "./reminders";
import { GameState } from "./types";
import { SQUARE_PRIVATE } from "./squarePrivate";

export const onSquareReleased = onDocumentUpdated("pools/{poolId}", async (event) => {
    if (!event.data) return;

    const before = event.data.before.data() as GameState;
    const after = event.data.after.data() as GameState;

    if (!before.squares || !after.squares) return;

    // Determine which squares went from owned -> unowned.
    const releasedIds: number[] = [];
    for (let i = 0; i < 100; i++) {
        const ownerBefore = before.squares[i]?.owner;
        const ownerAfter = after.squares[i]?.owner;
        if (ownerBefore && !ownerAfter) {
            releasedIds.push(before.squares[i].id);
        }
    }
    const releasedSquaresCount = releasedIds.length;

    // Clean up PII for released squares regardless of how they were released.
    // (Safe to run even if a release path already deleted the doc.)
    if (releasedSquaresCount > 0) {
        const cleanupDb = admin.firestore();
        await Promise.all(releasedIds.map(id =>
            cleanupDb.collection("pools").doc(event.params.poolId)
                .collection(SQUARE_PRIVATE).doc(String(id)).delete()
                .catch(err => console.error(`[SquarePrivate cleanup] Failed for #${id}:`, err))
        ));
    }

    if (!after.waitlist || after.waitlist.length === 0) return;

    if (releasedSquaresCount > 0) {
        console.log(`[Waitlist] Detected ${releasedSquaresCount} released squares in pool ${event.params.poolId}. Notifying waitlist...`);
        const db = admin.firestore();
        try {
            await notifyWaitlist(db, after, releasedSquaresCount);

            // Note: If you want to automatically clear the waitlist or handle queuing logic,
            // that logic could be added here. Currently, notifyWaitlist just sends emails.
        } catch (e) {
            console.error(`[Waitlist] Error notifying waitlist for pool ${event.params.poolId}:`, e);
        }
    }
});
