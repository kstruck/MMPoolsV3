/**
 * Firestore rules test for the `ai_requests` create gate
 * (PLAN-COST-CONTROLS.md Phase 0.5.1).
 *
 * Run:
 *   npm --prefix functions run test:rules
 *
 * ## Why this rule exists
 *
 * Creating an `ai_requests` doc SPENDS MONEY: `onAIRequest` picks it up and
 * calls Gemini. Before 0.5.1 the create rule required only `request.auth != null`
 * and `userId == request.auth.uid`, so **any signed-in user could burn the paid
 * provider on any pool**, including pools that never bought the AI Commissioner
 * addon. Pool participation was required to READ the collection and not to write
 * it, which is the wrong way round when the write is the expensive half.
 *
 * ## ⚠️ What this test is really for
 *
 * The rule is a four-condition conjunction, and every condition is load-bearing
 * for a DIFFERENT reason. That makes it exactly the kind of predicate someone
 * later "simplifies" — dropping the identity binding because the participant
 * check looks stronger, or dropping the participant check because the
 * entitlement looks stronger. Each case below names the specific hole its
 * condition closes, so a future edit that removes one fails here with a reason:
 *
 *   1. a stranger (not a participant) cannot create — the unbounded-spend hole
 *   2. a participant cannot forge someone else's `userId` — attribution
 *      poisoning today, and per-user quota framing once PLAN Phase 2 lands
 *   3. an unauthenticated client cannot create
 *   4. a participant of a pool WITHOUT the addon cannot create — the
 *      entitlement, i.e. "unpaid pools cannot consume the paid feature"
 *   5. a pool with NO billing map at all denies — deny-by-default. This is the
 *      legacy-pool case, and it is the one `lib/billingAccess.checkBillingAccess`
 *      would get WRONG (its `!billing => allowed` carve-out), which is why
 *      0.5.2 mirrors `onWeeklyRecapCreated` instead of calling that helper
 *   6. 🛑 a participant of an UNLOCKED pool CAN still create — the case that
 *      would silently kill the paying customers' AI Commissioner if the rule
 *      were over-tightened. The SUCCEED cases matter as much as the FAIL ones
 *   7. update/delete stay closed — unchanged by 0.5.1, asserted so a rewrite
 *      of this block cannot quietly reopen them
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, addDoc, collection, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const OWNER = 'ai-owner';
const ALICE = 'ai-alice';       // participant of every pool below
const STRANGER = 'ai-stranger';  // participant of nothing

const PAID = 'ai-pool-paid';      // entitlement true
const UNPAID = 'ai-pool-unpaid';  // entitlement explicitly false
const LEGACY = 'ai-pool-legacy';  // no billing map at all
const PARTIAL = 'ai-pool-partial'; // billing present, featuresUnlocked missing

const basePool = (id) => ({
    id,
    name: `AI gate pool ${id}`,
    type: 'SQUARES',
    ownerId: OWNER,
    managerUid: OWNER,
    season: '2026',
    status: 'OPEN',
    isLocked: false,
    createdAt: Date.now(),
    participantIds: [OWNER, ALICE],
    settings: { entryFee: 0, paymentInstructions: '', isListedPublic: false },
});

await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'pools', PAID), {
        ...basePool(PAID),
        billing: { status: 'active', featuresUnlocked: { aiCommissioner: true } },
    });
    await setDoc(doc(db, 'pools', UNPAID), {
        ...basePool(UNPAID),
        billing: { status: 'active', featuresUnlocked: { aiCommissioner: false } },
    });
    // No `billing` key whatsoever — a legacy/free pool.
    await setDoc(doc(db, 'pools', LEGACY), basePool(LEGACY));
    // billing present but NO featuresUnlocked map — the half-shaped doc that
    // the second link of the .get() chain exists for.
    await setDoc(doc(db, 'pools', PARTIAL), {
        ...basePool(PARTIAL),
        billing: { status: 'free', tier: 'free_tier' },
    });
    // An existing request, so the update/delete cases have something to aim at.
    await setDoc(doc(db, 'pools', PAID, 'ai_requests', 'seeded'), {
        userId: ALICE, poolId: PAID, question: 'seeded', category: 'DISPUTE',
        status: 'PENDING', createdAt: Date.now(),
    });
});

const alice = env.authenticatedContext(ALICE).firestore();
const stranger = env.authenticatedContext(STRANGER).firestore();
const anon = env.unauthenticatedContext().firestore();

const req = (uid, poolId) => ({
    userId: uid,
    poolId,
    question: 'Who won the third quarter?',
    category: 'DISPUTE',
    status: 'PENDING',
    createdAt: Date.now(),
});

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

console.log('ai_requests create gate (PLAN-COST-CONTROLS 0.5.1)');

// 1 — the unbounded-spend hole: a non-participant spending on someone's pool.
await check(
    'a NON-PARTICIPANT cannot create an ai_request (the unbounded-spend hole)',
    assertFails(addDoc(collection(stranger, 'pools', PAID, 'ai_requests'), req(STRANGER, PAID))),
);

// 2 — identity binding. A participant is allowed to spend; they are not allowed
// to spend as SOMEBODY ELSE.
await check(
    'a participant cannot forge another uid in userId',
    assertFails(addDoc(collection(alice, 'pools', PAID, 'ai_requests'), req(OWNER, PAID))),
);

// 3 — no anonymous spend.
await check(
    'an unauthenticated client cannot create',
    assertFails(addDoc(collection(anon, 'pools', PAID, 'ai_requests'), req(ALICE, PAID))),
);

// 4 — the entitlement: the addon is what is being paid for.
await check(
    'a participant of a pool WITHOUT the addon cannot create',
    assertFails(addDoc(collection(alice, 'pools', UNPAID, 'ai_requests'), req(ALICE, UNPAID))),
);

// 5 — deny-by-default on a pool with no billing map. See the header: this is
// the case a `!billing => allowed` helper would get wrong.
await check(
    'a pool with NO billing map denies (deny-by-default, not allow-by-omission)',
    assertFails(addDoc(collection(alice, 'pools', LEGACY, 'ai_requests'), req(ALICE, LEGACY))),
);

// 5b — billing exists, featuresUnlocked does not. Each link of the .get()
// chain has to hold independently; this is the one that would break if someone
// "simplified" it to .get('billing', {}).featuresUnlocked.aiCommissioner.
await check(
    'a pool with billing but NO featuresUnlocked map denies',
    assertFails(addDoc(collection(alice, 'pools', PARTIAL, 'ai_requests'), req(ALICE, PARTIAL))),
);

// 6 — 🛑 the paying customer still works. If this ever fails, the tighten went
// too far and every unlocked pool's AI Commissioner is dead.
await check(
    'a participant of an UNLOCKED pool CAN still create',
    assertSucceeds(addDoc(collection(alice, 'pools', PAID, 'ai_requests'), req(ALICE, PAID))),
);

// 7 — the immutability half, unchanged by 0.5.1 but asserted so a rewrite of
// this rules block cannot quietly reopen it.
await check(
    'nobody can update an existing ai_request',
    assertFails(updateDoc(doc(alice, 'pools', PAID, 'ai_requests', 'seeded'), { status: 'COMPLETED' })),
);
await check(
    'nobody can delete an existing ai_request',
    assertFails(deleteDoc(doc(alice, 'pools', PAID, 'ai_requests', 'seeded'))),
);

await env.cleanup();

if (failures > 0) {
    console.error(`\n${failures} ai_requests rules assertion(s) FAILED`);
    process.exit(1);
}
console.log('\nAll ai_requests rules assertions passed.');
