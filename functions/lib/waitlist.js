"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.joinWaitlist = void 0;
const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
exports.joinWaitlist = functions.https.onCall(async (request) => {
    const db = admin.firestore();
    const { poolId, name, email } = request.data;
    if (!poolId || !name || !email) {
        throw new functions.https.HttpsError("invalid-argument", "Missing poolId, name, or email.");
    }
    const poolRef = db.collection("pools").doc(poolId);
    try {
        await db.runTransaction(async (t) => {
            var _a;
            const doc = await t.get(poolRef);
            if (!doc.exists) {
                throw new functions.https.HttpsError("not-found", "Pool not found.");
            }
            const poolData = doc.data();
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
//# sourceMappingURL=waitlist.js.map