/**
 * Firestore rules test for the `coManagers` / `coManagersRevision` write lock
 * (PLAN-CO-COMMISSIONERS T1, deploy step 2 of D2).
 *
 * Run (or via `npm --prefix functions run test:rules`, which runs every
 * `functions/scripts/*.rules.test.mjs`):
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/coManagers.rules.test.mjs"
 *
 * ## Why this rule exists
 *
 * `coManagers` was a field three functions gates TRUSTED (assertPoolOwnerOrSuperAdmin,
 * simulateGameUpdate, simFillSquares) and nothing else knew about — absent from
 * firestore.rules entirely and NOT in `protectedFieldsUnchanged()`. So a pool's
 * owner could `updateDoc({ coManagers: [anyUid] })` from a browser and hand that
 * uid scoreNFLWeek / recordPoolPayouts / cancelPool. Same class of hole as
 * `participantIds` before #432, one field over. `coManagersRevision` is locked
 * with it: it is the add-vs-remove race fence for the setter callable, and a
 * client-writable revision lets a current co-manager reset it after a remove.
 *
 * ## What is asserted (mirrors participantIds.rules.test.mjs, same reasoning)
 *
 *   1. an owner cannot ADD a uid to coManagers          (the attack)
 *   2. an owner cannot CLEAR it                          (same door, other way)
 *   3. an owner cannot write coManagersRevision
 *   4. a SUPER_ADMIN CAN — `protectedFieldsUnchanged()` sits inside the manager
 *      branch and `isSuperAdmin()` short-circuits it. Asserted as the current
 *      shape, not an endorsement (stated + accepted in the plan, D2)
 *   5. an owner's ordinary (non-settings) edit still works
 *   6. a full-object update that RESENDS the same array still passes — the
 *      wizards do exactly this; a same-value write is not an affectedKey
 *   7. an owner cannot introduce the field on a pool that never had it
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const OWNER = 'cm-owner';
const ALICE = 'cm-alice';
const BOB = 'cm-bob';
const ADMIN = 'cm-admin';
const POOL = 'cm-pool';
const BARE_POOL = 'cm-pool-bare';

const BASE = {
    id: POOL,
    name: 'Co-manager lock pool',
    type: 'NFL_PICKEM',
    league: 'NFL',
    ownerId: OWNER,
    managerUid: OWNER,
    season: '2026',
    status: 'OPEN',
    isLocked: false,
    createdAt: Date.now(),
    participantIds: [OWNER, ALICE, BOB],
    coManagers: [ALICE],
    coManagersRevision: 3,
    settings: { entryFee: 0, paymentInstructions: '', isListedPublic: false },
};

await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pools', POOL), BASE);
    const { coManagers: _c, coManagersRevision: _r, ...bare } = BASE;
    await setDoc(doc(ctx.firestore(), 'pools', BARE_POOL), { ...bare, id: BARE_POOL });
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

console.log('coManagers write lock (PLAN-CO-COMMISSIONERS T1)');

// 1 — the attack.
await check(
    'an owner CANNOT add a uid to coManagers',
    assertFails(updateDoc(doc(owner, 'pools', POOL), { coManagers: [ALICE, BOB] })),
);

// 2 — clearing is a write too.
await check(
    'an owner CANNOT clear coManagers',
    assertFails(updateDoc(doc(owner, 'pools', POOL), { coManagers: [] })),
);

// 3 — the race fence.
await check(
    'an owner CANNOT write coManagersRevision',
    assertFails(updateDoc(doc(owner, 'pools', POOL), { coManagersRevision: 0 })),
);

// 4 — SUPER_ADMIN, current shape.
await check(
    'a SUPER_ADMIN CAN still write it from a client — admin paths use the Admin SDK',
    assertSucceeds(updateDoc(doc(admin, 'pools', POOL), { coManagers: [ALICE, BOB] })),
);

// 5 — no collateral. NOT a settings write (nflSettingsWriteBlocked would fire first).
await check(
    'an owner CAN still update an ordinary field',
    assertSucceeds(updateDoc(doc(owner, 'pools', POOL), { name: 'Renamed pool' })),
);

// 6 — the wizard resend.
await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pools', POOL), BASE);
});
await check(
    'a full-object update that RESENDS the same coManagers + revision still passes',
    assertSucceeds(updateDoc(doc(owner, 'pools', POOL), {
        coManagers: [ALICE],
        coManagersRevision: 3,
        name: 'Wizard resend',
    })),
);

// 7 — introducing the field on a pool that never had it is an affectedKey.
await check(
    'an owner CANNOT introduce coManagers on a pool that never had it',
    assertFails(updateDoc(doc(owner, 'pools', BARE_POOL), { coManagers: [BOB] })),
);

// ---------------------------------------------------------------------------
// T3 — the READERS (deploy step 3, shipped with the setter callable). ALICE is
// a co-commissioner of the NFL pool. Each row of the capability table that
// touches rules is pinned, plus the two negatives that matter most: the type
// guard (a coManagers array on a SQUARES pool grants nothing) and C8 (delete
// stays owner/managerUid).
// ---------------------------------------------------------------------------
console.log('coManagers readers (PLAN-CO-COMMISSIONERS T3)');
const SQ_POOL = 'cm-pool-squares';
await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, 'pools', POOL), { ...BASE, isPublic: false });
    await setDoc(doc(f, 'pools', SQ_POOL), { ...BASE, id: SQ_POOL, type: 'SQUARES', league: 'NFL', isPublic: false });
    await setDoc(doc(f, 'pools', POOL, 'payoutRecordsPrivate', 'award-bob'), { uid: BOB, amount: 10 });
    await setDoc(doc(f, 'pools', POOL, 'audit', 'a1'), { type: 'POOL_CREATED' });
    await setDoc(doc(f, 'pools', POOL, 'squarePrivate', 's1'), { name: 'pii' });
    await setDoc(doc(f, 'pools', POOL, 'shareClicks', 'c1'), { at: 1 });
    await setDoc(doc(f, 'pools', SQ_POOL, 'audit', 'a1'), { type: 'POOL_CREATED' });
});
const alice = env.authenticatedContext(ALICE).firestore();

await check('C2 — a co-commissioner CAN update an ordinary field on the NFL pool',
    assertSucceeds(updateDoc(doc(alice, 'pools', POOL), { name: 'Co-comm renamed' })));
await check('C10 — a co-commissioner still CANNOT write coManagers (the lock binds them too)',
    assertFails(updateDoc(doc(alice, 'pools', POOL), { coManagers: [ALICE, BOB] })));
await check('C8 — a co-commissioner CANNOT delete the pool',
    assertFails(deleteDoc(doc(alice, 'pools', POOL))));
await check('type guard — the same uid in a coManagers array on a SQUARES pool CANNOT update it',
    assertFails(updateDoc(doc(alice, 'pools', SQ_POOL), { name: 'forged' })));
await check('type guard — ...nor read its audit',
    assertFails(getDoc(doc(alice, 'pools', SQ_POOL, 'audit', 'a1'))));
// A list rule is proved from the QUERY, not the documents: `array-contains` alone
// cannot discharge the type guard, so the Hub query carries the type filter too.
await check('D7 — the Hub query (coManagers array-contains uid AND type in NFL) succeeds for a co-commissioner',
    assertSucceeds(getDocs(query(collection(alice, 'pools'),
        where('coManagers', 'array-contains', ALICE),
        where('type', 'in', ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'])))));
await check('D7 — the array-contains query WITHOUT the type filter is refused (not provable)',
    assertFails(getDocs(query(collection(alice, 'pools'), where('coManagers', 'array-contains', ALICE)))));
await check('C6 (K3 Yes) — a co-commissioner CAN read another member private payout record',
    assertSucceeds(getDoc(doc(alice, 'pools', POOL, 'payoutRecordsPrivate', 'award-bob'))));
await check('C11 — a co-commissioner CAN read audit',
    assertSucceeds(getDoc(doc(alice, 'pools', POOL, 'audit', 'a1'))));
await check('C11 — a co-commissioner CAN read shareClicks',
    assertSucceeds(getDoc(doc(alice, 'pools', POOL, 'shareClicks', 'c1'))));
await check('C11 — a co-commissioner CAN write an announcement',
    assertSucceeds(setDoc(doc(alice, 'pools', POOL, 'announcements', 'n1'), { text: 'hi', authorUid: ALICE })));
await check('K7 — a co-commissioner CANNOT read squarePrivate',
    assertFails(getDoc(doc(alice, 'pools', POOL, 'squarePrivate', 's1'))));
const bobCtx = env.authenticatedContext(BOB).firestore();
await check('a plain member (not in coManagers) still CANNOT read audit',
    assertFails(getDoc(doc(bobCtx, 'pools', POOL, 'audit', 'a1'))));

await env.cleanup();

if (failures > 0) {
    console.error(`\n${failures} coManagers rules assertion(s) FAILED`);
    process.exit(1);
}
console.log('\nAll coManagers rules assertions passed.');
