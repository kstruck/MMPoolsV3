/**
 * Firestore rules test for the squarePrivate PII subcollection (audit H1).
 *
 * Requires Java (the Firestore emulator is a Java process) and the
 * @firebase/rules-unit-testing package. Run via the emulator:
 *
 *   npm i -D @firebase/rules-unit-testing
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/squarePrivate.rules.test.mjs"
 *
 * Verifies:
 *   - a non-owner authed user CANNOT read another pool's squarePrivate
 *   - the pool owner CAN read squarePrivate
 *   - no client can write squarePrivate (Cloud Functions only)
 *   - guests can still `get` the public pool doc (guest-link join)
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const POOL_ID = 'pool1';
const OWNER_UID = 'owner1';
const OTHER_UID = 'intruder1';

// Seed a pool + a squarePrivate doc, bypassing rules.
await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'pools', POOL_ID), {
        ownerId: OWNER_UID,
        isPublic: true,
        squares: [{ id: 0, owner: 'Alice' }],
    });
    await setDoc(doc(db, 'pools', POOL_ID, 'squarePrivate', '0'), {
        squareId: 0,
        email: 'alice@example.com',
        phone: '555-1234',
    });
});

const owner = env.authenticatedContext(OWNER_UID).firestore();
const other = env.authenticatedContext(OTHER_UID).firestore();
const guest = env.unauthenticatedContext().firestore();

// Guest can still read the public pool doc (guest-link join).
await assertSucceeds(getDoc(doc(guest, 'pools', POOL_ID)));

// Non-owner CANNOT read PII.
await assertFails(getDoc(doc(other, 'pools', POOL_ID, 'squarePrivate', '0')));
// Unauthenticated CANNOT read PII.
await assertFails(getDoc(doc(guest, 'pools', POOL_ID, 'squarePrivate', '0')));
// Owner CAN read PII.
await assertSucceeds(getDoc(doc(owner, 'pools', POOL_ID, 'squarePrivate', '0')));

// No client (even owner) can write PII — Cloud Functions only.
await assertFails(setDoc(doc(owner, 'pools', POOL_ID, 'squarePrivate', '1'), { squareId: 1, email: 'x@y.com' }));
await assertFails(setDoc(doc(other, 'pools', POOL_ID, 'squarePrivate', '1'), { squareId: 1, email: 'x@y.com' }));

await env.cleanup();
console.log('OK — squarePrivate rules behave correctly.');
