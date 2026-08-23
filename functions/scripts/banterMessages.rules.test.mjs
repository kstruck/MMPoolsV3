/**
 * Firestore rules test for the AI Commissioner banter feed
 * (`pools/{poolId}/messages`) — PLAN-WIZARD-BUYFLOW-FIXES T9.
 *
 * Run:
 *   npm --prefix functions run test:rules
 *
 * ## Why these rules changed
 *
 * The collection existed and was ruled, but NOTHING rendered it: the
 * commissioner's banter card kept its feed in React state and threw it away on
 * navigation ("Draft only — not saved"). T9 makes the feed real and shows it to
 * every member on the pool homepage, which changes what the old rule was worth:
 *
 *   - create required only `auth != null` + own-uid, so ANY signed-in user
 *     could post into ANY pool's feed. Harmless while nothing rendered it;
 *     not harmless the moment every member reads it.
 *   - AI banter is written by `onAIRequest` through the Admin SDK. A client
 *     that could stamp `kind: 'AI'` could put words in the AI's mouth in a feed
 *     the whole pool reads.
 *   - Kevin's requirement: "commissioners must be able to delete any message."
 *
 * ## What each case pins
 *
 *   1. a stranger cannot post into a pool they are not in
 *   2. a participant cannot forge another member's authorUid
 *   3. an unauthenticated client cannot post
 *   4. nobody may claim `kind: 'AI'` from a client
 *   5. 🛑 an ordinary participant CAN still post — the SUCCEED case, which
 *      matters as much as the failures: over-tightening silently kills the feature
 *   6. reads stay participant-scoped (a stranger cannot read the feed)
 *   7. the owner may delete ANY message, including one they did not write
 *   8. a named NFL co-commissioner may delete too
 *   9. an ordinary participant may NOT delete — not even their own. Moderation
 *      is the commissioner's; a member deleting their own message mid-argument
 *      is the thing a feed like this gets used to litigate.
 *  10. UPDATE stays closed for everyone. A message may be removed but never
 *      silently rewritten under its author's name.
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, addDoc, collection, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const OWNER = 'banter-owner';
const CO = 'banter-co';          // named NFL co-commissioner
const ALICE = 'banter-alice';    // ordinary participant
const BOB = 'banter-bob';        // ordinary participant
const STRANGER = 'banter-stranger';

const POOL = 'banter-pool';

await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'pools', POOL), {
        id: POOL,
        name: 'Banter pool',
        type: 'NFL_PICKEM',
        ownerId: OWNER,
        managerUid: OWNER,
        coManagers: [CO],
        season: '2026',
        status: 'OPEN',
        isLocked: false,
        createdAt: Date.now(),
        participantIds: [OWNER, CO, ALICE, BOB],
        settings: { entryFee: 0, paymentInstructions: '', isListedPublic: false },
    });
    // One message from ALICE and one AI message, both seeded past the rules.
    await setDoc(doc(db, 'pools', POOL, 'messages', 'from-alice'), {
        authorUid: ALICE, authorName: 'Alice', text: 'seeded', kind: 'COMMISSIONER', timestamp: Date.now(),
    });
    await setDoc(doc(db, 'pools', POOL, 'messages', 'from-ai'), {
        authorUid: 'ai-commissioner', authorName: 'AI Commissioner', text: 'seeded ai', kind: 'AI', timestamp: Date.now(),
    });
    await setDoc(doc(db, 'pools', POOL, 'messages', 'to-delete-1'), {
        authorUid: ALICE, authorName: 'Alice', text: 'delete me', kind: 'COMMISSIONER', timestamp: Date.now(),
    });
    await setDoc(doc(db, 'pools', POOL, 'messages', 'to-delete-2'), {
        authorUid: BOB, authorName: 'Bob', text: 'delete me too', kind: 'COMMISSIONER', timestamp: Date.now(),
    });
    await setDoc(doc(db, 'pools', POOL, 'messages', 'members-cannot-delete'), {
        authorUid: ALICE, authorName: 'Alice', text: 'mine', kind: 'COMMISSIONER', timestamp: Date.now(),
    });
});

const owner = env.authenticatedContext(OWNER).firestore();
const co = env.authenticatedContext(CO).firestore();
const alice = env.authenticatedContext(ALICE).firestore();
const stranger = env.authenticatedContext(STRANGER).firestore();
const anon = env.unauthenticatedContext().firestore();

let failures = 0;
const check = async (label, promise) => {
    try {
        await promise;
        console.log(`  PASS  ${label}`);
    } catch (e) {
        failures += 1;
        console.error(`  FAIL  ${label}\n        ${e?.message ?? e}`);
    }
};

const msg = (uid, over = {}) => ({
    authorUid: uid,
    authorName: 'Someone',
    text: 'hello pool',
    kind: 'COMMISSIONER',
    timestamp: Date.now(),
    ...over,
});

console.log('\nbanter messages (pools/{poolId}/messages) rules\n');

// 1 — the hole the participant check closes.
await check(
    'a STRANGER cannot post into a pool they are not in',
    assertFails(addDoc(collection(stranger, 'pools', POOL, 'messages'), msg(STRANGER))),
);

// 2 — identity binding.
await check(
    'a participant cannot forge another member’s authorUid',
    assertFails(addDoc(collection(alice, 'pools', POOL, 'messages'), msg(BOB))),
);

// 3 — unauthenticated.
await check(
    'an unauthenticated client cannot post',
    assertFails(addDoc(collection(anon, 'pools', POOL, 'messages'), msg('anyone'))),
);

// 4 — nobody may speak AS the AI. onAIRequest writes those through the Admin
// SDK, which bypasses rules entirely.
await check(
    'a participant cannot claim kind: AI',
    assertFails(addDoc(collection(alice, 'pools', POOL, 'messages'), msg(ALICE, { kind: 'AI' }))),
);
await check(
    'the OWNER cannot claim kind: AI either',
    assertFails(addDoc(collection(owner, 'pools', POOL, 'messages'), msg(OWNER, { kind: 'AI' }))),
);

// 4b — nor may a human row CLAIM the AI's byline (codex r2 [P1]). `kind` is
// refused above, but the feed prints authorName for human rows, and that is the
// one identity in this feed that carries authority.
await check(
    'a participant cannot post under the AI Commissioner byline',
    assertFails(addDoc(collection(alice, 'pools', POOL, 'messages'), msg(ALICE, { authorName: 'AI Commissioner' }))),
);

// 4c — text sanity. The feed is member-visible, so an empty or unbounded post
// is not a shape it should be able to hold.
await check(
    'an empty message is refused',
    assertFails(addDoc(collection(alice, 'pools', POOL, 'messages'), msg(ALICE, { text: '' }))),
);
await check(
    'a non-string message is refused',
    assertFails(addDoc(collection(alice, 'pools', POOL, 'messages'), msg(ALICE, { text: 42 }))),
);
await check(
    'an absurdly long message is refused',
    assertFails(addDoc(collection(alice, 'pools', POOL, 'messages'), msg(ALICE, { text: 'x'.repeat(2001) }))),
);
await check(
    'a message at the cap is accepted',
    assertSucceeds(addDoc(collection(alice, 'pools', POOL, 'messages'), msg(ALICE, { text: 'x'.repeat(2000) }))),
);

// 5 — 🛑 the feature still works.
await check(
    'an ordinary participant CAN post their own message',
    assertSucceeds(addDoc(collection(alice, 'pools', POOL, 'messages'), msg(ALICE))),
);
await check(
    'the commissioner CAN post their own message',
    assertSucceeds(addDoc(collection(owner, 'pools', POOL, 'messages'), msg(OWNER))),
);

// 6 — reads stay participant-scoped.
await check(
    'a participant can read the feed',
    assertSucceeds(getDoc(doc(alice, 'pools', POOL, 'messages', 'from-alice'))),
);
await check(
    'a STRANGER cannot read the feed',
    assertFails(getDoc(doc(stranger, 'pools', POOL, 'messages', 'from-alice'))),
);

// 7/8 — moderation: Kevin's requirement.
await check(
    'the OWNER can delete a message they did not write',
    assertSucceeds(deleteDoc(doc(owner, 'pools', POOL, 'messages', 'to-delete-1'))),
);
await check(
    'a named NFL co-commissioner can delete a message',
    assertSucceeds(deleteDoc(doc(co, 'pools', POOL, 'messages', 'to-delete-2'))),
);
await check(
    'the OWNER can delete an AI message too',
    assertSucceeds(deleteDoc(doc(owner, 'pools', POOL, 'messages', 'from-ai'))),
);

// 9 — moderation is the commissioner's, not the author's.
await check(
    'an ordinary participant cannot delete — not even their OWN message',
    assertFails(deleteDoc(doc(alice, 'pools', POOL, 'messages', 'members-cannot-delete'))),
);
await check(
    'a stranger cannot delete',
    assertFails(deleteDoc(doc(stranger, 'pools', POOL, 'messages', 'members-cannot-delete'))),
);

// 10 — removable, never rewritable.
await check(
    'the OWNER cannot UPDATE a message (removable, not rewritable)',
    assertFails(updateDoc(doc(owner, 'pools', POOL, 'messages', 'members-cannot-delete'), { text: 'edited' })),
);
await check(
    'a participant cannot update their own message',
    assertFails(updateDoc(doc(alice, 'pools', POOL, 'messages', 'members-cannot-delete'), { text: 'edited' })),
);

await env.cleanup();

if (failures > 0) {
    console.error(`\n${failures} banter-messages rules assertion(s) FAILED`);
    process.exit(1);
}
console.log('\nAll banter-messages rules assertions passed.');
