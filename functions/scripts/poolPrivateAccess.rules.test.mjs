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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, FieldPath } from 'firebase/firestore';

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

// --- PER-ENTRY DUES (PLAN-MULTI-ENTRY-DUES D1, AMENDED 2026-08-26) ---------
//
// 🛑 THIS IS THE WHOLE REASON THE MAP MOVED, SO IT IS ASSERTED RATHER THAN
// INHERITED FROM THE WILDCARD'S REPUTATION.
//
// `paidEntries` is keyed by entry id, and those ids are entries that have
// COMMITTED A PICK. It used to sit on `pools/{id}/members/{uid}`, which every
// participant can read — so it told the whole pool which of another player's
// entries was live, the exact bit the Member Record's `entries` field refuses
// to persist (commissioner-blind picks). Kevin ruled the move on 2026-08-26
// after cross-model review found it on PR #602.
//
// The claim being tested is that the move needed NO rules change because this
// subcollection was already sealed. A claim like that is worth exactly one
// test, and this is it: the MEMBER whose dues these are cannot read them, and
// neither can a co-participant, the owner, or a SUPER_ADMIN.
const DUES_DOC = `dues__${MEMBER_UID}`;
await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pools', POOL_ID, 'private', DUES_DOC), {
        uid: MEMBER_UID,
        poolId: POOL_ID,
        paidEntries: { [`e2:${MEMBER_UID}`]: { paidAt: 1, method: 'cash' } },
        updatedAt: 1,
    });
});
const duesDoc = (db) => doc(db, 'pools', POOL_ID, 'private', DUES_DOC);
for (const [label, db] of [['guest', guest], ['other', other], ['member (its own subject!)', member], ['owner', owner], ['superadmin', admin]]) {
    await assertFails(getDoc(duesDoc(db)));
    await assertFails(setDoc(duesDoc(db), { paidEntries: {} }));
    await assertFails(updateDoc(duesDoc(db), { paidEntries: {} }));
    await assertFails(deleteDoc(duesDoc(db)));
    console.log(`  ok: ${label} cannot read or write pools/{id}/private/${DUES_DOC}`);
}

// GUARD THE GUARD: the denials above must be able to FAIL, or they prove
// nothing. The document the map moved OFF is genuinely readable by a
// CO-PARTICIPANT — that readability IS the leak — so a separate pool is set up
// with two participants to demonstrate it, and to show the summary survives.
const DUES_POOL = 'pool-dues-readable';
const PEER_UID = 'peer-pa';
await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'pools', DUES_POOL), {
        type: 'NFL_PICKEM', ownerId: OWNER_UID, managerUid: OWNER_UID, isPublic: true,
        status: 'OPEN', name: 'Dues Pool', participantIds: [MEMBER_UID, PEER_UID],
    });
    await setDoc(doc(db, 'pools', DUES_POOL, 'members', MEMBER_UID), {
        uid: MEMBER_UID, poolId: DUES_POOL, userName: 'Member', paidStatus: 'PAID', joinedAt: 1,
    });
    await setDoc(doc(db, 'pools', DUES_POOL, 'private', DUES_DOC), {
        uid: MEMBER_UID, poolId: DUES_POOL,
        paidEntries: { [`e2:${MEMBER_UID}`]: { paidAt: 1 } }, updatedAt: 1,
    });
});
const peer = env.authenticatedContext(PEER_UID).firestore();
// The leak, in its own hand: a PEER really can read another member's record...
const memberSnap = await assertSucceeds(getDoc(doc(peer, 'pools', DUES_POOL, 'members', MEMBER_UID)));
assert.strictEqual(memberSnap.data().paidStatus, 'PAID', 'the SUMMARY stays readable — every roster surface reads it');
assert.ok(!('paidEntries' in memberSnap.data()), 'the per-entry MAP must never be on this document');
// ...and cannot reach the map that used to sit on it.
await assertFails(getDoc(doc(peer, 'pools', DUES_POOL, 'private', DUES_DOC)));
console.log('  ok: a co-participant reads the summary, and CANNOT reach the per-entry map');

// The dues id cannot collide with the password record, for ANY uid.
assert.notStrictEqual('dues__access', 'access');
assert.ok(DUES_DOC.startsWith('dues__'), 'the prefix is what keeps the two apart');

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

// --- …and CLEARING a legacy password is denied too (codex r5 P1) ------------
//
// The first version of the predicate only refused a NON-EMPTY value, so an
// owner could submit `''` and delete the plaintext that is the ONLY thing
// making PoolRoute render the gate for a pre-migration pool. Clearing is
// exactly as dangerous as setting, and in the fail-OPEN direction.
for (const cleared of [{ gridPassword: '' }, { gridPassword: null }, { gridPassword: deleteField() }]) {
    await assertFails(updateDoc(doc(owner, 'pools', LEGACY_ID), cleared));
}
await assertFails(updateDoc(doc(admin, 'pools', LEGACY_ID), { gridPassword: '' }));
// Same for the nested accessControl form.
const LEGACY_AC = 'pool-legacy-accesscontrol';
await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pools', LEGACY_AC), {
        type: 'BRACKET', ownerId: OWNER_UID, managerUid: OWNER_UID, isPublic: true,
        status: 'OPEN', name: 'LegacyAC', accessControl: { password: 'oldvalue', requireEmail: false },
    });
});
await assertFails(updateDoc(doc(owner, 'pools', LEGACY_AC), { 'accessControl.password': '' }));
await assertFails(updateDoc(doc(owner, 'pools', LEGACY_AC), { accessControl: { requireEmail: true } }));
// …but a sibling edit that carries the password through UNCHANGED still works,
// which is what keeps an ordinary settings save from failing.
await assertSucceeds(updateDoc(doc(owner, 'pools', LEGACY_AC), {
    accessControl: { password: 'oldvalue', requireEmail: true },
}));
console.log('  ok: clearing a legacy password is denied; a sibling edit carrying it through is not');

// --- The LITERAL dotted field cannot be written either (codex r5 P1) --------
//
// `updateDoc(ref, {'accessControl.password': v})` is parsed by the SDK into the
// NESTED path (covered above). `new FieldPath('accessControl.password')` writes
// a genuine TOP-LEVEL field whose name contains a dot; `affectedKeys()` reports
// that literal key, and nothing but the explicit clause looks at it.
await assertFails(updateDoc(doc(owner, 'pools', POOL_ID), new FieldPath('accessControl.password'), 'secret'));
await assertFails(updateDoc(doc(admin, 'pools', POOL_ID), new FieldPath('accessControl.password'), 'secret'));
console.log('  ok: the literal dotted field is denied to the owner and to a super-admin');

// --- scrubPatch's SHAPE is safe on a doc that has none of the fields --------
//
// ⚠️ THIS IS A PUBLISH-PATH RISK, not a tidiness check. `scrubPatch()` deletes
// `accessControl.password` with a DOTTED path, and `publishBracketPool` applies
// it inside the same transaction that reserves the slug. Most bracket pools have
// no `accessControl` map at all — so if Firestore rejected a nested delete whose
// PARENT is absent, publishing a pool would start failing outright. Rules do not
// answer that question; only the emulator does. Run with rules DISABLED, which
// is how the Admin SDK sees the database.
await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const BARE_ID = 'pool-no-access-fields';
    await setDoc(doc(db, 'pools', BARE_ID), { type: 'BRACKET', name: 'Bare', ownerId: OWNER_UID });
    // The VARARGS form the server helper emits, including the FieldPath that
    // names the literal dotted field. Written out here rather than imported
    // because this file talks to the client SDK; the shape is what is under
    // test, and `poolPassword.test.ts` pins that the helper emits exactly it.
    await updateDoc(
        doc(db, 'pools', BARE_ID),
        'gridPassword', deleteField(),
        'accessControl.password', deleteField(),
        'passwordHash', deleteField(),
        'hasPoolPassword', true,
        new FieldPath('accessControl.password'), deleteField(),
    );
    const after = await getDoc(doc(db, 'pools', BARE_ID));
    assert.strictEqual(after.data().hasPoolPassword, true);
    assert.ok(!('accessControl' in after.data()), 'the delete must not materialise an empty parent map');
    assert.strictEqual(after.data().name, 'Bare', 'unrelated fields survive');
});
console.log('  ok: the scrub applies cleanly to a pool with none of those fields');

// --- …and it actually REMOVES a literal dotted field when one exists --------
//
// This is the claim the r6 fix rests on: that one `update()` can delete both
// the nested `accessControl.password` AND a top-level field literally named
// `accessControl.password`, without the two targets colliding. Asserted rather
// than assumed — the whole dotted-field saga started from an assumption about
// how Firestore parses a key with a dot in it.
await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const DOTTED_ID = 'pool-dotted-legacy';
    // setDoc writes object keys as LITERAL field names, which is exactly how
    // such a field could be minted through the permissive create callable.
    await setDoc(doc(db, 'pools', DOTTED_ID), {
        type: 'SQUARES', name: 'Dotted', ownerId: OWNER_UID,
        'accessControl.password': 'literal-secret',
        accessControl: { password: 'nested-secret', requireEmail: true },
        gridPassword: 'grid-secret',
    });
    const before = await getDoc(doc(db, 'pools', DOTTED_ID));
    assert.strictEqual(before.get(new FieldPath('accessControl.password')), 'literal-secret',
        'the literal dotted field must be creatable, or this test proves nothing');

    await updateDoc(
        doc(db, 'pools', DOTTED_ID),
        'gridPassword', deleteField(),
        'accessControl.password', deleteField(),
        'passwordHash', deleteField(),
        'hasPoolPassword', true,
        new FieldPath('accessControl.password'), deleteField(),
    );
    const after = await getDoc(doc(db, 'pools', DOTTED_ID));
    assert.strictEqual(after.get(new FieldPath('accessControl.password')), undefined,
        'the LITERAL dotted field must be gone');
    assert.strictEqual(after.get(new FieldPath('accessControl', 'password')), undefined,
        'the NESTED password must be gone');
    assert.ok(!('gridPassword' in after.data()), 'the plaintext must be gone');
    assert.strictEqual(after.data().accessControl.requireEmail, true, 'siblings survive');
    assert.strictEqual(after.data().hasPoolPassword, true);
});
console.log('  ok: one update removes the nested AND the literal dotted password field');

await env.cleanup();
console.log('poolPrivateAccess.rules.test.mjs: ALL PASS');
process.exit(0);
