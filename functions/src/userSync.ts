
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { UserRecord } from "firebase-functions/v1/auth";
import { onCall, CallableRequest } from "firebase-functions/v2/https";
import { assertCallerRole } from "./adminClaims";
import { validated } from "./lib/validated";
import { syncAllUsersSchema } from "./schemas/noInputAdmin";
import { pickPreferredName } from "./shared/displayName";



type AuthUserLike = Pick<UserRecord, 'uid' | 'email' | 'displayName' | 'photoURL' | 'providerData'>;

/**
 * The ONE schema a server-created profile has. Pure, so it is unit-tested.
 *
 * Until 2026-09-11 two Auth-create triggers wrote this document with two
 * different schemas — this file (`picture`, `registrationMethod`, `searchName`,
 * timestamps) and participant.ts `createParticipantProfile` (`photoURL`,
 * `provider`, numeric `createdAt`). Whichever landed first decided the shape.
 * Consolidated here. `provider` is carried over because the client reads it
 * (`user.provider === 'password'` gates the change-password panel and the
 * verify-email banner) and the client only writes it on ITS create path,
 * which loses the race to this trigger.
 */
export function newUserProfileFields(user: AuthUserLike): Record<string, unknown> {
    return {
        ...syncedUserFields(undefined, user),
        provider: user.providerData?.[0]?.providerId || 'unknown',
        role: 'MEMBER',
    };
}

/**
 * Create `users/{uid}` ONLY if nothing has written it yet; otherwise refresh
 * the index/login fields and leave `name` alone.
 *
 * 🛑 NEVER OVERWRITE. Three writers race on a fresh email+password signup:
 * this Auth trigger and the client's `syncUserToFirestore` (and, until
 * 2026-09-11, a second trigger in participant.ts). The Auth event fires the
 * instant the account exists — BEFORE the client has called
 * `updateProfile({ displayName })` — so `displayName` is empty here for every
 * email signup, and a plain `set()` landing LAST overwrote the typed name
 * (and the client's referral fields) with a placeholder; the pool join then
 * copied it into every standings page (the 2026-09-10 "New User" bug). The
 * pre-transaction `get` + `set` this used to do had the same window, just
 * narrower. A transaction closes it: the client's write between the read and
 * the commit forces a retry that sees the document and takes the merge path.
 *
 * The merge path indexes whatever name the profile actually shows (the typed
 * one), not the email prefix (codex r1 P1 on #690). `name` is never written
 * on it.
 */
export async function createUserProfileIfMissing(
    db: admin.firestore.Firestore,
    user: AuthUserLike,
): Promise<'created' | 'exists'> {
    const ref = db.collection("users").doc(user.uid);
    const fields = newUserProfileFields(user);
    return db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        if (snap.exists) {
            const indexed = pickPreferredName(snap.get('name'), fields.name) ?? (fields.name as string);
            t.set(ref, {
                email: fields.email, // Ensure email is up to date
                searchEmail: fields.searchEmail,
                searchName: indexed.toLowerCase(),
                lastLogin: FieldValue.serverTimestamp(),
            }, { merge: true });
            return 'exists';
        }
        t.set(ref, {
            ...fields,
            createdAt: FieldValue.serverTimestamp(),
            lastLogin: FieldValue.serverTimestamp(),
        });
        return 'created';
    });
}

// v1 trigger — setGlobalOptions (v2) does not reach it; cap instances inline.
export const onUserCreated = functions.runWith({ maxInstances: 10 }).auth.user().onCreate(async (user: UserRecord) => {
    const { uid, email } = user;
    try {
        const outcome = await createUserProfileIfMissing(admin.firestore(), user);
        console.log(outcome === 'created'
            ? `[UserSync] Created profile for ${uid} (${email}).`
            : `[UserSync] Profile for ${uid} already existed; refreshed index/login fields, name left alone.`);
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
