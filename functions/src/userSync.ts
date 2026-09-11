
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { UserRecord } from "firebase-functions/v1/auth";
import { onCall, CallableRequest } from "firebase-functions/v2/https";
import { assertCallerRole } from "./adminClaims";
import { validated } from "./lib/validated";
import { syncAllUsersSchema } from "./schemas/noInputAdmin";
import { pickPreferredName } from "./shared/displayName";



// v1 trigger — setGlobalOptions (v2) does not reach it; cap instances inline.
export const onUserCreated = functions.runWith({ maxInstances: 10 }).auth.user().onCreate(async (user: UserRecord) => {
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
            // The client may already have written the TYPED name here (the
            // email-signup race); the Auth record at this instant carries none.
            // Index whatever name the profile actually shows, not the email
            // prefix (codex r1 P1). `name` is never written on this path.
            const indexed = pickPreferredName(doc.get('name'), name) ?? name;
            await userRef.set({
                email: email || "", // Ensure email is up to date
                searchEmail: (email || "").toLowerCase(),
                searchName: indexed.toLowerCase(),
                lastLogin: FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (error) {
        console.error(`[UserSync] Failed to sync user ${uid}:`, error);
    }
});

const GET_ALL_CHUNK = 100;
const WRITE_CHUNK = 400;

/**
 * The fields `syncAllUsers` merges onto one profile. Pure, so the one rule that
 * matters is unit-tested: a real stored `name` survives the sync; Auth's name
 * only fills a missing or placeholder one. `searchName` follows the name that
 * is actually kept.
 */
export function syncedUserFields(
    existing: Record<string, unknown> | undefined,
    user: Pick<UserRecord, 'uid' | 'email' | 'displayName' | 'photoURL' | 'providerData'>,
): Record<string, unknown> {
    let method: 'google' | 'email' | 'unknown' = 'unknown';
    if (user.providerData && user.providerData.length > 0) {
        const pid = user.providerData[0].providerId;
        if (pid === 'google.com') method = 'google';
        else if (pid === 'password') method = 'email';
    }
    const authName = user.displayName || user.email?.split('@')[0] || 'Unknown';
    const name = pickPreferredName(existing?.name, authName) ?? authName;
    return {
        id: user.uid,
        name,
        email: user.email || '',
        searchEmail: (user.email || '').toLowerCase(), // backfills searchEmail for existing users
        searchName: name.toLowerCase(), // backfills searchName for existing users
        picture: user.photoURL || null,
        registrationMethod: method,
    };
}

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

        // 🛑 READ BEFORE WRITE. This used to `merge` `name: <Auth displayName>`
        // onto every profile unconditionally — which, with `onUserNameChanged`
        // now pushing profile names into every pool, would have reverted every
        // admin / self-service name fix across the site in one click (codex r1
        // P1). The stored profile name wins; Auth only fills a missing or
        // placeholder one. Chunked: a write batch holds 500 ops, and this lists
        // up to 1000 users.
        const refs = users.map(u => db.collection("users").doc(u.uid));
        const existing = new Map<string, FirebaseFirestore.DocumentSnapshot>();
        for (let i = 0; i < refs.length; i += GET_ALL_CHUNK) {
            const snaps = await db.getAll(...refs.slice(i, i + GET_ALL_CHUNK));
            for (const s of snaps) existing.set(s.id, s);
        }

        let count = 0;
        for (let i = 0; i < users.length; i += WRITE_CHUNK) {
            const batch = db.batch();
            for (const user of users.slice(i, i + WRITE_CHUNK)) {
                const userRef = db.collection("users").doc(user.uid);
                const userData = {
                    ...syncedUserFields(existing.get(user.uid)?.data(), user),
                    // Don't overwrite createdAt if it exists, but ensure sync timestamp
                    syncedAt: FieldValue.serverTimestamp()
                };
                batch.set(userRef, userData, { merge: true });
                count++;
            }
            await batch.commit();
        }

        return { success: true, count };
    } catch (error) {
        console.error("Sync Users Error:", error);
        throw new functions.https.HttpsError('internal', 'Failed to sync users.');
    }
});
