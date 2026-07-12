/**
 * Firestore rules test for the Phase 5 backdoor removal
 * (PLAN-NFL-SIM-HARNESS items 28-30).
 *
 * Run:
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/simBackdoors.rules.test.mjs"
 *
 * Proves the two dropped backdoors are actually gone:
 *   1. A SUPER_ADMIN client can NO LONGER raw-create a pool doc, even with a
 *      `sim-*` slug (the old Test Suite exception).
 *   2. A SUPER_ADMIN client can NO LONGER raw-write pool entries (create,
 *      update, or delete) — entries are server-side only.
 * And the surfaces that must keep working, still do:
 *   3. SUPER_ADMIN can still READ entries and UPDATE the pool doc
 *      (the general isSuperAdmin update rule is intentionally unchanged).
 *   4. An ordinary member still reads their own entry.
 */
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

const ADMIN = 'admin1';
const ALICE = 'alice';

await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'pools', 'p1'), {
        type: 'NFL_PICKEM', status: 'OPEN',
        ownerId: 'owner1', managerUid: 'owner1',
        participantIds: ['owner1', ALICE],
        slug: 'real-pool', name: 'Real Pool',
    });
    await setDoc(doc(db, 'pools', 'p1', 'entries', ALICE), { ownerUid: ALICE, picks: { g1: 'KC' } });
});

const admin = env.authenticatedContext(ADMIN, { role: 'SUPER_ADMIN' }).firestore();
const alice = env.authenticatedContext(ALICE).firestore();

let failures = 0;
async function check(label, promise) {
    try {
        await promise;
        console.log(`  OK  ${label}`);
    } catch (e) {
        failures++;
        console.error(`FAIL  ${label}: ${e.message}`);
    }
}

console.log('Backdoor 1 — sim-* slug client pool create is gone:');
await check('SUPER_ADMIN cannot raw-create a sim-* pool', assertFails(
    setDoc(doc(admin, 'pools', 'sim-raw-1'), {
        slug: 'sim-raw-1', slugLower: 'sim-raw-1', type: 'BRACKET',
        name: 'Raw Sim Pool', ownerId: ADMIN, managerUid: ADMIN, status: 'OPEN',
    }),
));
await check('SUPER_ADMIN cannot raw-create a non-sim pool either', assertFails(
    setDoc(doc(admin, 'pools', 'raw-2'), {
        slug: 'anything', type: 'SQUARES', name: 'Raw Pool', ownerId: ADMIN,
    }),
));

console.log('Backdoor 2 — SUPER_ADMIN raw entry writes are gone:');
await check('SUPER_ADMIN cannot create an entry', assertFails(
    setDoc(doc(admin, 'pools', 'p1', 'entries', 'sim-x-mallory'), { ownerUid: 'sim-x-mallory', picks: {} }),
));
await check('SUPER_ADMIN cannot update an entry', assertFails(
    updateDoc(doc(admin, 'pools', 'p1', 'entries', ALICE), { totalScore: 999 }),
));
await check('SUPER_ADMIN cannot delete an entry', assertFails(
    deleteDoc(doc(admin, 'pools', 'p1', 'entries', ALICE)),
));

console.log('Unchanged surfaces:');
await check('SUPER_ADMIN still reads entries', assertSucceeds(
    getDoc(doc(admin, 'pools', 'p1', 'entries', ALICE)),
));
await check('SUPER_ADMIN still updates the pool doc (general rule untouched)', assertSucceeds(
    updateDoc(doc(admin, 'pools', 'p1'), { name: 'Renamed' }),
));
await check('member still reads their own entry', assertSucceeds(
    getDoc(doc(alice, 'pools', 'p1', 'entries', ALICE)),
));

await env.cleanup();
if (failures > 0) {
    console.error(`\n${failures} rules assertion(s) FAILED.`);
    process.exit(1);
}
console.log('\nOK — all sim-backdoor rules checks passed.');
