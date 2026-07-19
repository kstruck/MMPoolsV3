
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { UserRecord } from "firebase-functions/v1/auth";
import { onCall, CallableRequest } from "firebase-functions/v2/https";
import { assertCallerRole } from "./adminClaims";
import { validated } from "./lib/validated";
import { syncAllUsersSchema } from "./schemas/noInputAdmin";



export const onUserCreated = functions.auth.user().onCreate(async (user: UserRecord) => {
    const db = admin.firestore();
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
                searchEmail: (email || "").toLowerCase(), // lowercase for admin prefix search
                searchName: name.toLowerCase(), // lowercase for admin name prefix search
                picture: photoURL || null,
                registrationMethod: method,
                createdAt: FieldValue.serverTimestamp(),

                lastLogin: FieldValue.serverTimestamp(),
                role: 'MEMBER'
            });
            console.log(`[UserSync] Successfully synced user ${uid} (${email}) to Firestore.`);
        } else {
            console.log(`[UserSync] User ${uid} already exists in Firestore. Using merge just in case.`);
            await userRef.set({
                email: email || "", // Ensure email is up to date
                searchEmail: (email || "").toLowerCase(),
                searchName: name.toLowerCase(),
                lastLogin: FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (error) {
        console.error(`[UserSync] Failed to sync user ${uid}:`, error);
    }
});

// Force Sync All Users (Callable)
export const syncAllUsers = validated(
    { schema: syncAllUsersSchema, label: "syncAllUsers", role: "SUPER_ADMIN", appCheck: "monitor" },
    async (_input, request) => {
    const db = admin.firestore();
    // SUPER_ADMIN only: this lists up to 1000 Auth users (emails/providers) and
    // writes user docs. Previously any signed-in user could trigger it (sweep C4).
    // assertCallerRole enforces the JWT claim AND the users/{uid}.role doc.
    await assertCallerRole(request, "SUPER_ADMIN");

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

            const syncName = user.displayName || user.email?.split('@')[0] || 'Unknown';
            const userData = {
                id: user.uid,
                name: syncName,
                email: user.email || '',
                searchEmail: (user.email || '').toLowerCase(), // backfills searchEmail for existing users
                searchName: syncName.toLowerCase(), // backfills searchName for existing users
                picture: user.photoURL || null,
                registrationMethod: method,
                // Don't overwrite createdAt if it exists, but ensure sync timestamp
                syncedAt: FieldValue.serverTimestamp()
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
