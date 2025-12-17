
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { UserRecord } from "firebase-functions/v1/auth";
import { onCall, CallableRequest } from "firebase-functions/v2/https";

const db = admin.firestore();

export const onUserCreated = functions.auth.user().onCreate(async (user: UserRecord) => {
    const { uid, email, displayName, photoURL } = user;

    // Determine registration method
    let method: 'google' | 'email' | 'unknown' = 'unknown';
    if (user.providerData && user.providerData.length > 0) {
        const providerId = user.providerData[0].providerId;
        if (providerId === 'google.com') method = 'google';
        else if (providerId === 'password') method = 'email';
    }

    const name = displayName || email?.split('@')[0] || 'Unknown User';

    try {
        const userRef = db.collection("users").doc(uid);
        const doc = await userRef.get();

        if (!doc.exists) {
            await userRef.set({
                id: uid,
                name,
                email: email || "",
                picture: photoURL || null,
                registrationMethod: method,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),

                lastLogin: admin.firestore.FieldValue.serverTimestamp(),
                role: 'PARTICIPANT'
            });
            console.log(`[UserSync] Successfully synced user ${uid} (${email}) to Firestore.`);
        } else {
            console.log(`[UserSync] User ${uid} already exists in Firestore. Using merge just in case.`);
            await userRef.set({
                email: email || "", // Ensure email is up to date
                lastLogin: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (error) {
        console.error(`[UserSync] Failed to sync user ${uid}:`, error);
    }
});

// Force Sync All Users (Callable)
export const syncAllUsers = onCall(async (request: CallableRequest) => {
    if (!request.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }

    try {
        // List max 1000 users (pagination needed for large apps, but fine for MVP)
        const listUsersResult = await admin.auth().listUsers(1000);
        const users = listUsersResult.users;

        const batch = db.batch();
        let count = 0;

        for (const user of users) {
            const userRef = db.collection("users").doc(user.uid);

            let method: 'google' | 'email' | 'unknown' = 'unknown';
            if (user.providerData && user.providerData.length > 0) {
                const pid = user.providerData[0].providerId;
                if (pid === 'google.com') method = 'google';
                else if (pid === 'password') method = 'email';
            }

            const userData = {
                id: user.uid,
                name: user.displayName || user.email?.split('@')[0] || 'Unknown',
                email: user.email || '',
                picture: user.photoURL || null,
                registrationMethod: method,
                // Don't overwrite createdAt if it exists, but ensure sync timestamp
                syncedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            batch.set(userRef, userData, { merge: true });
            count++;
        }

        await batch.commit();
        return { success: true, count };
    } catch (error) {
        console.error("Sync Users Error:", error);
        throw new functions.https.HttpsError('internal', 'Failed to sync users.');
    }
});
