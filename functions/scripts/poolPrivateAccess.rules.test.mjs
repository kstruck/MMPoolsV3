/**
 * Firestore rules test for the pool password store
 * (PLAN-AUDIT-AUTH-HARDENING Phase B; audit items 1 and 13a).
 *
 * Run via the shared runner:
 *   npm --prefix functions run test:rules
 *
 * Or alone:
 *   npx firebase emulators:exec --only firestore --project demo-mmp \
 *     "node functions/scripts/poolPrivateAccess.rules.test.mjs"
 *
 * Verifies:
 *   - NOBODY reads `pools/{id}/private/access` — not a guest, not a member, not
 *     the pool OWNER, not a SUPER_ADMIN. The verify callable holds an Admin SDK
 *     handle and bypasses rules; no client ever needs the value.
 *   - Nobody writes it either.
 *   - `pool_access_attempts` (the throttle store) is closed both ways.
 *   - The pool OWNER cannot write a non-empty `gridPassword`,
 *     `accessControl.password`, `passwordHash` or `hasPoolPassword` onto the
 *     public pool document — the leak the audit found, in its own hand.
 *   - A SUPER_ADMIN cannot either: the guard sits OUTSIDE the disjunction, and
 *     `isSuperAdmin()` short-circuits everything inside it.
 *   - An ORDINARY settings save still works, including one that carries
 *     `gridPassword: ''` (the wizard's empty default) — an unconditional deny on
 *     the key would break every squares settings save, which is why the rule
 *     bans the VALUE and not the field.
 *   - Guests can still `get` the public pool doc (guest-link join is unchanged).
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const POOL_ID = 'pool-private-access';
const OWNER_UID = 'owner-pa';
const MEMBER_UID = 'member-pa';
const OTHER_UID = 'intruder-pa';
const ADMIN_UID = 'admin-pa';

await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'pools', POOL_ID), {
        type: 'SQUARES',
        ownerId: OWNER_UID,
        managerUid: OWNER_UID,
        isPublic: true,
        status: 'OPEN',
        participantIds: [MEMBER_UID],
        hasPoolPassword: true,
        name: 'Private Access Pool',
    });
    await setDoc(doc(db, 'pools', POOL_ID, 'private', 'access'), {
        passwordHash: 'deadbeef:cafebabe',
        updatedAt: 1,
    });
    await setDoc(doc(db, 'pool_access_attempts', 'somekey'), { failures: 3, windowStartedAt: 1 });
    // A real SUPER_ADMIN user doc, so isSuperAdmin() has something to agree with.
    await setDoc(doc(db, 'users', ADMIN_UID), { role: 'SUPER_ADMIN' });
});

const owner = env.authenticatedContext(OWNER_UID).firestore();
const member = env.authenticatedContext(MEMBER_UID).firestore();
const other = env.authenticatedContext(OTHER_UID).firestore();
const admin = env.authenticatedContext(ADMIN_UID, { role: 'SUPER_ADMIN' }).firestore();
const guest = env.unauthenticatedContext().firestore();

const accessDoc = (db) => doc(db, 'pools', POOL_ID, 'private', 'access');

// --- The secret store is closed to EVERY principal --------------------------
for (const [label, db] of [['guest', guest], ['other', other], ['member', member], ['owner', owner], ['superadmin', admin]]) {
    await assertFails(getDoc(accessDoc(db)));
    await assertFails(setDoc(accessDoc(db), { passwordHash: 'mine:now' }));
    await assertFails(updateDoc(accessDoc(db), { passwordHash: 'mine:now' }));
    await assertFails(deleteDoc(accessDoc(db)));
    console.log(`  ok: ${label} cannot read or write pools/{id}/private/access`);
}

// A future sibling doc under the same subcollection is closed too (wildcard).
await assertFails(getDoc(doc(owner, 'pools', POOL_ID, 'private', 'something-else')));
await assertFails(setDoc(doc(owner, 'pools', POOL_ID, 'private', 'something-else'), { x: 1 }));

// --- The throttle store is server-only --------------------------------------
await assertFails(getDoc(doc(other, 'pool_access_attempts', 'somekey')));
await assertFails(setDoc(doc(other, 'pool_access_attempts', 'somekey'), { failures: 0 }));
await assertFails(getDoc(doc(admin, 'pool_access_attempts', 'somekey')));

// --- Guest link still works -------------------------------------------------
const publicSnap = await assertSucceeds(getDoc(doc(guest, 'pools', POOL_ID)));
assert.strictEqual(publicSnap.data().hasPoolPassword, true, 'the non-secret marker must stay readable');
assert.ok(!('gridPassword' in publicSnap.data()), 'no plaintext on the public doc');

// --- Password material cannot be written onto the PUBLIC pool doc -----------
for (const [label, db] of [['owner', owner], ['superadmin', admin]]) {
    await assertFails(updateDoc(doc(db, 'pools', POOL_ID), { gridPassword: 'letmein' }));
    await assertFails(updateDoc(doc(db, 'pools', POOL_ID), { accessControl: { password: 'letmein' } }));
    await assertFails(updateDoc(doc(db, 'pools', POOL_ID), { 'accessControl.password': 'letmein' }));
    await assertFails(updateDoc(doc(db, 'pools', POOL_ID), { passwordHash: 'forged:hash' }));
    await assertFails(updateDoc(doc(db, 'pools', POOL_ID), { hasPoolPassword: false }));
    console.log(`  ok: ${label} cannot write password material onto pools/{id}`);
}

// --- …but an ordinary settings save still works -----------------------------
await assertSucceeds(updateDoc(doc(owner, 'pools', POOL_ID), { name: 'Renamed Pool' }));
// The wizard's empty default rides along on every full-object save. Denying the
// KEY would break this; the rule denies the VALUE.
await assertSucceeds(updateDoc(doc(owner, 'pools', POOL_ID), { name: 'Renamed Again', gridPassword: '' }));
await assertSucceeds(updateDoc(doc(owner, 'pools', POOL_ID), {
    accessControl: { requireEmail: true, password: '' },
}));
console.log('  ok: ordinary settings saves, including an empty gridPassword, still pass');

// --- A pre-migration pool stays editable ------------------------------------
// A same-value write is not an affectedKey, so a legacy pool that still carries
// its plaintext can still be edited until the sweep reaches it.
const LEGACY_ID = 'pool-legacy-password';
await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pools', LEGACY_ID), {
        type: 'SQUARES', ownerId: OWNER_UID, managerUid: OWNER_UID,
        isPublic: true, status: 'OPEN', name: 'Legacy', gridPassword: 'oldvalue',
    });
});
await assertSucceeds(updateDoc(doc(owner, 'pools', LEGACY_ID), { name: 'Legacy Renamed', gridPassword: 'oldvalue' }));
await assertFails(updateDoc(doc(owner, 'pools', LEGACY_ID), { gridPassword: 'changed' }));
console.log('  ok: a legacy pool is still editable, but its password cannot be changed client-side');

await env.cleanup();
console.log('poolPrivateAccess.rules.test.mjs: ALL PASS');
process.exit(0);
