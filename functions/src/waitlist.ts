import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";

interface JoinWaitlistData {
    poolId: string;
    name: string;
    email: string;
}

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

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(poolRef);
            if (!doc.exists) {
                throw new functions.https.HttpsError("not-found", "Pool not found.");
            }

            const poolData = doc.data();
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

        return { success: true };
    } catch (error: any) {
        console.error("Error joining waitlist:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "Failed to join waitlist.");
    }
});
