/**
 * Firestore rules test for the `participantIds` write lock
 * (PLAN-MEMBER-PICKS-VISIBILITY, Kevin's K9 ruling 2026-08-14).
 *
 * Run:
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/participantIds.rules.test.mjs"
 *
 * ## Why this rule exists
 *
 * `participantIds` decides who may read a pool's PICKS — `isProvableMember`
 * accepts it as membership evidence, and `getPoolPicks` now admits proven
 * members. While the array stayed client-writable, a pool manager could add any
 * uid and hand that account a DURABLE, self-refreshing feed of every future
 * reveal: not a one-time disclosure they could have made verbally anyway, but a
 * standing capability that outlives their interest in granting it.
 *
 * `participants` was already in `protectedFieldsUnchanged()`. `participantIds`
 * — the one every membership check actually reads — was not.
 *
 * ## ⚠️ What this test is really for
 *
 * The rule is one string in a list, which is exactly the kind of change that
 * gets "tidied" out later by someone who sees `participants` next to it and
 * assumes they are duplicates. It is also the kind of lock that can break real
 * flows silently, so the SUCCEED cases below matter as much as the FAIL ones:
 *
 *   1. a manager cannot add a uid            (the attack)
 *   2. a manager cannot remove one           (the same door, other direction)
 *   3. a SUPER_ADMIN CAN still write it — `protectedFieldsUnchanged()` sits
 *      INSIDE the manager branch and `isSuperAdmin()` short-circuits the whole
 *      disjunction. Asserted as the current shape, not as an endorsement: if it
 *      ever starts failing, the rule moved and its comment must move with it
 *   4. a manager's ordinary (non-settings) field edit still works — no
 *      collateral. NOT a `settings` write: `nflSettingsWriteBlocked()` already
 *      refuses a manager those on an NFL pool, so testing one here would have
 *      blamed this rule for a pre-existing one
 *   5. a full-object update that RESENDS the same array still works — the
 *      wizards do exactly this, and a same-value write is not an affectedKey.
 *      This is the case that would break the pool wizards if the rule were
 *      written as "the field must be absent from the payload".
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const OWNER = 'pid-owner';
const ALICE = 'pid-alice';
const STRANGER = 'pid-stranger';
const ADMIN = 'pid-admin';
const POOL = 'pid-pool';

const BASE = {
    id: POOL,
    name: 'Participant lock pool',
    type: 'NFL_PICKEM',
    league: 'NFL',
    ownerId: OWNER,
    managerUid: OWNER,
    season: '2026',
    status: 'OPEN',
    isLocked: false,
    createdAt: Date.now(),
    participantIds: [OWNER, ALICE],
    settings: { entryFee: 0, paymentInstructions: '', isListedPublic: false },
};

await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pools', POOL), BASE);
    await setDoc(doc(ctx.firestore(), 'users', ADMIN), { role: 'SUPER_ADMIN' });
    await setDoc(doc(ctx.firestore(), 'users', OWNER), { role: 'COMMISSIONER' });
});

const owner = env.authenticatedContext(OWNER).firestore();
const admin = env.authenticatedContext(ADMIN, { role: 'SUPER_ADMIN' }).firestore();

let failures = 0;
const check = async (label, promise) => {
    try {
        await promise;
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL  ${label} — ${err?.message || err}`);
    }
};

console.log('participantIds write lock (PLAN-MEMBER-PICKS-VISIBILITY K9)');

// 1 — the attack this rule exists to stop.
await check(
    'a manager CANNOT add a uid to participantIds',
    assertFails(updateDoc(doc(owner, 'pools', POOL), {
        participantIds: [OWNER, ALICE, STRANGER],
    })),
);

// 2 — the same door in the other direction; removing a member is equally a
// roster edit and equally the server's job.
await check(
    'a manager CANNOT remove a uid from participantIds',
    assertFails(updateDoc(doc(owner, 'pools', POOL), {
        participantIds: [OWNER],
    })),
);

// 3 — SUPER_ADMIN too. `protectedFieldsUnchanged()` is inside the manager
// branch and `isSuperAdmin()` short-circuits it, so this asserts the CURRENT
// shape rather than an aspiration: if this ever starts failing, the rule moved
// and the comment above it needs to move with it.
await check(
    'a SUPER_ADMIN CAN still write it from a client — admin paths use the Admin SDK',
    assertSucceeds(updateDoc(doc(admin, 'pools', POOL), {
        participantIds: [OWNER, ALICE, STRANGER],
    })),
);

// 4 — no collateral damage on the manager's ordinary edits.
//
// ⚠️ NOT a `settings` write. `nflSettingsWriteBlocked()` already refuses a
// MANAGER any settings change on an NFL pool — those go through the
// `updatePoolSettings` callable — so using one here would have tested that
// pre-existing rule and blamed this one. (Caught by running it.)
await check(
    'a manager CAN still update an ordinary field',
    assertSucceeds(updateDoc(doc(owner, 'pools', POOL), { name: 'Renamed pool' })),
);

// 5 — 🛑 THE CASE THAT WOULD BREAK THE WIZARDS. They send the whole pool object
// back, `participantIds` included. A same-value write is not an affectedKey, so
// it must still pass. Read the array first so the resend is genuinely identical.
await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pools', POOL), { ...BASE, participantIds: [OWNER, ALICE] });
});
await check(
    'a full-object update that RESENDS the same participantIds still passes',
    assertSucceeds(updateDoc(doc(owner, 'pools', POOL), {
        participantIds: [OWNER, ALICE],
        name: 'Wizard resend',
    })),
);

await env.cleanup();

if (failures > 0) {
    console.error(`\n${failures} participantIds rules assertion(s) FAILED`);
    process.exit(1);
}
console.log('\nAll participantIds rules assertions passed.');
