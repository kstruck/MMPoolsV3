
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
 * What the exists-path of `createUserProfileIfMissing` may write: only the
 * index/login fields the profile does NOT already carry. Pure, unit-tested.
 * `email` counts as missing when absent or empty (the client's create path
 * always writes it, possibly as ""); the rest when absent.
 */
export function missingProfileIndexFields(
    existing: Record<string, unknown>,
    fields: Record<string, unknown>,
): Record<string, unknown> {
    const fill: Record<string, unknown> = {};
    const hasEmail = typeof existing.email === 'string' && existing.email.trim() !== '';
    if (!hasEmail && fields.email) fill.email = fields.email;
    if (existing.searchEmail === undefined) fill.searchEmail = hasEmail ? (existing.email as string).toLowerCase() : fields.searchEmail;
    if (existing.searchName === undefined) {
        const indexed = pickPreferredName(existing.name, fields.name) ?? (fields.name as string);
        fill.searchName = indexed.toLowerCase();
    }
    if (existing.lastLogin === undefined) fill.lastLogin = FieldValue.serverTimestamp();
    return fill;
}

/**
 * Create `users/{uid}` ONLY if nothing has written it yet; otherwise fill in
 * the index/login fields it lacks and leave everything else alone.
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
 * The merge path FILLS, never overwrites (qodo #691 round 2, finding 3). With
 * `failurePolicy: true` an Auth-create event can be re-delivered up to days
 * later carrying the ORIGINAL snapshot, so merging its `email` / `searchEmail`
 * unconditionally would put the sign-up email back over one an admin has since
 * edited, and re-stamp `lastLogin` with the replay. So: `email` only when the
 * profile has none, `searchEmail` / `searchName` / `lastLogin` only when
 * absent. `searchName` is indexed from the name the profile actually shows
 * (the typed one), not the email prefix (codex r1 P1 on #690), and
 * `onUserNameChanged` keeps it current from then on. `name` is never written.
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
            const fill = missingProfileIndexFields(snap.data() ?? {}, fields);
            if (Object.keys(fill).length > 0) t.set(ref, fill, { merge: true });
            return 'exists';
        }
        t.set(ref, {
            ...fields,
            // NUMERIC, like the client's own create path (`syncUserToFirestore`
            // writes `createdAt: Date.now()`) and the `User.createdAt?: number`
            // contract. This used to be `FieldValue.serverTimestamp()`, and the
            // Members tab does `new Date(u.createdAt)` on the raw document — a
            // Firestore Timestamp there renders as an invalid date. With this
            // trigger now the ONLY server-side creator, every profile it wins
            // the race for would have carried one (qodo #691 finding 5).
            // `lastLogin` stays a server timestamp: the client type admits it.
            createdAt: Date.now(),
            lastLogin: FieldValue.serverTimestamp(),
        });
        return 'created';
    });
}

// v1 trigger — setGlobalOptions (v2) does not reach it; cap instances inline.
//
// `failurePolicy: true` + rethrow: this is the ONLY server-side profile creator
// now (qodo #691 finding 4), so a transient Firestore failure must be retried by
// the platform rather than acknowledged and forgotten. The work is a
// create-if-absent transaction, so a retry can never overwrite a profile the
// client wrote in the meantime — it takes the merge path.
export const onUserCreated = functions.runWith({ maxInstances: 10, failurePolicy: true }).auth.user().onCreate(async (user: UserRecord) => {
    const { uid, email } = user;
    try {
        const outcome = await createUserProfileIfMissing(admin.firestore(), user);
        console.log(outcome === 'created'
            ? `[UserSync] Created profile for ${uid} (${email}).`
            : `[UserSync] Profile for ${uid} already existed; refreshed index/login fields, name left alone.`);
    } catch (error) {
        console.error(`[UserSync] Failed to sync user ${uid}; rethrowing so the event is retried:`, error);
        throw error;
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
