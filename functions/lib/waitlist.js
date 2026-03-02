"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onSquareReleased = exports.joinWaitlist = void 0;
const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
const reminders_1 = require("./reminders");
const emailStyles_1 = require("./emailStyles");
exports.joinWaitlist = functions.https.onCall(async (request) => {
    const db = admin.firestore();
    const { poolId, name, email } = request.data;
    if (!poolId || !name || !email) {
        throw new functions.https.HttpsError("invalid-argument", "Missing poolId, name, or email.");
    }
    const poolRef = db.collection("pools").doc(poolId);
    let poolName = "March Melee Pool"; // Default
    try {
        await db.runTransaction(async (t) => {
            var _a;
            const doc = await t.get(poolRef);
            if (!doc.exists) {
                throw new functions.https.HttpsError("not-found", "Pool not found.");
            }
            const poolData = doc.data();
            poolName = (poolData === null || poolData === void 0 ? void 0 : poolData.name) || poolName;
            const waitlist = (poolData === null || poolData === void 0 ? void 0 : poolData.waitlist) || [];
            // Check if already on waitlist
            const isAlreadyOnList = waitlist.some((entry) => entry.email.toLowerCase() === email.toLowerCase());
            if (isAlreadyOnList) {
                throw new functions.https.HttpsError("already-exists", "You are already on the waitlist.");
            }
            const entry = {
                name: name.trim(),
                email: email.trim(),
                timestamp: Date.now(),
                userId: ((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid) || null // Optional: link to user if logged in
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
        const html = (0, emailStyles_1.renderEmailHtml)("Waitlist Confirmed", body, `${emailStyles_1.BASE_URL}/pool/${poolId}`, "View Pool");
        // Fire and forget email (don't block response) - checking promise for clean logs though
        (0, reminders_1.sendEmail)(db, email, subject, html, { poolId, reason: 'WAITLIST_JOIN' })
            .catch(err => console.error("Failed to send waitlist confirmation email:", err));
        return { success: true };
    }
    catch (error) {
        console.error("Error joining waitlist:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "Failed to join waitlist.");
    }
});
const firestore_1 = require("firebase-functions/v2/firestore");
const reminders_2 = require("./reminders");
exports.onSquareReleased = (0, firestore_1.onDocumentUpdated)("pools/{poolId}", async (event) => {
    var _a, _b;
    if (!event.data)
        return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!before.squares || !after.squares)
        return;
    if (!after.waitlist || after.waitlist.length === 0)
        return;
    let releasedSquaresCount = 0;
    // Determine how many squares went from having an owner to not having an owner
    for (let i = 0; i < 100; i++) {
        const ownerBefore = (_a = before.squares[i]) === null || _a === void 0 ? void 0 : _a.owner;
        const ownerAfter = (_b = after.squares[i]) === null || _b === void 0 ? void 0 : _b.owner;
        if (ownerBefore && !ownerAfter) {
            releasedSquaresCount++;
        }
    }
    if (releasedSquaresCount > 0) {
        console.log(`[Waitlist] Detected ${releasedSquaresCount} released squares in pool ${event.params.poolId}. Notifying waitlist...`);
        const db = admin.firestore();
        try {
            await (0, reminders_2.notifyWaitlist)(db, after, releasedSquaresCount);
            // Note: If you want to automatically clear the waitlist or handle queuing logic,
            // that logic could be added here. Currently, notifyWaitlist just sends emails.
        }
        catch (e) {
            console.error(`[Waitlist] Error notifying waitlist for pool ${event.params.poolId}:`, e);
        }
    }
});
//# sourceMappingURL=waitlist.js.map