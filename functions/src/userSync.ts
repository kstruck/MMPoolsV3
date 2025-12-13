
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { UserRecord } from "firebase-functions/v1/auth";

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
                lastLogin: admin.firestore.FieldValue.serverTimestamp()
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
