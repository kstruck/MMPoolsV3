/**
 * Firestore rules test for payoutRecords / payoutRecordsPrivate (ADR 0005 Phase 4).
 *
 * Run:
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/payoutRecords.rules.test.mjs"
 *
 * Verifies:
 *   - participants read payoutRecords (who-won-what is pool-public)
 *   - outsiders/guests cannot
 *   - payoutRecordsPrivate readable ONLY by owner/manager/admin + the affected recipient
 *   - no client writes to either
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
    projectId: 'gridiron-gamble-uzuqo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const OWNER = 'owner1';
const WINNER = 'winner1';
const MEMBER = 'member1';
const OUTSIDER = 'outsider1';

await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'pools', 'p1'), {
        type: 'NFL_PICKEM', status: 'COMPLETED',
        ownerId: OWNER, participantIds: [OWNER, WINNER, MEMBER],
    });
    await setDoc(doc(db, 'pools', 'p1', 'payoutRecords', 'a1'), {
        uid: WINNER, amount: 100, kind: 'PLACE', place: 1, recordedAt: 1, schemaVersion: 1,
    });
    await setDoc(doc(db, 'pools', 'p1', 'payoutRecordsPrivate', 'a1'), {
        uid: WINNER, settled: false, note: 'venmo pending', recordedBy: OWNER, schemaVersion: 1,
    });
});

const owner = env.authenticatedContext(OWNER).firestore();
const winner = env.authenticatedContext(WINNER).firestore();
const member = env.authenticatedContext(MEMBER).firestore();
const outsider = env.authenticatedContext(OUTSIDER).firestore();
const guest = env.unauthenticatedContext().firestore();

// Public award doc: participants read, outsiders/guests do not.
await assertSucceeds(getDoc(doc(member, 'pools', 'p1', 'payoutRecords', 'a1')));
await assertSucceeds(getDoc(doc(winner, 'pools', 'p1', 'payoutRecords', 'a1')));
await assertSucceeds(getDoc(doc(owner, 'pools', 'p1', 'payoutRecords', 'a1')));
await assertFails(getDoc(doc(outsider, 'pools', 'p1', 'payoutRecords', 'a1')));
await assertFails(getDoc(doc(guest, 'pools', 'p1', 'payoutRecords', 'a1')));

// Private settlement doc: owner + recipient only — NOT other participants.
await assertSucceeds(getDoc(doc(owner, 'pools', 'p1', 'payoutRecordsPrivate', 'a1')));
await assertSucceeds(getDoc(doc(winner, 'pools', 'p1', 'payoutRecordsPrivate', 'a1')));
await assertFails(getDoc(doc(member, 'pools', 'p1', 'payoutRecordsPrivate', 'a1')));
await assertFails(getDoc(doc(outsider, 'pools', 'p1', 'payoutRecordsPrivate', 'a1')));

// No client writes.
await assertFails(setDoc(doc(owner, 'pools', 'p1', 'payoutRecords', 'a2'), { uid: OWNER, amount: 999, kind: 'PLACE', recordedAt: 2, schemaVersion: 1 }));
await assertFails(setDoc(doc(winner, 'pools', 'p1', 'payoutRecordsPrivate', 'a1'), { settled: true }, { merge: true }));

await env.cleanup();
console.log('payoutRecords.rules.test.mjs: ALL ASSERTIONS PASSED');
