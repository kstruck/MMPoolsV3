/**
 * Firestore rules test for the paid-provider usage telemetry collections
 * (PLAN-COST-CONTROLS.md Phase 1.3/1.4).
 *
 * Run:
 *   npm --prefix functions run test:rules
 *
 * ## Why these rules exist
 *
 * `provider_usage_events` and `provider_usage_daily` are the measured record of
 * what the paid providers cost. Phase 2.3's circuit breaker reads the rollup to
 * decide when to cut spend off, and Phase 7.3 reconciles it against the real
 * invoices. So a client-writable counter is a client-CONTROLLABLE spend ceiling:
 * anyone who could increment `estimatedCostUSD` could trip the breaker and take
 * the AI Commissioner down for a paying pool, and anyone who could zero it could
 * hold the breaker open while the bill ran. Server-written, append-only, exactly
 * like `admin_audit`.
 *
 * The read side is SUPER_ADMIN-only for a different reason: the events carry no
 * prompts, responses or phone numbers by construction (`lib/usageEvents.ts`),
 * but they DO carry the `userId`/`poolId` attribution pair, which is who-asked-
 * what-when metadata.
 *
 * Cases:
 *   1. an ordinary signed-in user cannot create an event  (the spend-ceiling hole)
 *   2. ...cannot create a daily aggregate
 *   3. ...cannot update an existing aggregate            (the increment attack)
 *   4. ...cannot delete an event                          (covering tracks)
 *   5. an unauthenticated client cannot write
 *   6. an ordinary user cannot READ (attribution metadata)
 *   7. a SUPER_ADMIN CAN read — the surface Phase 6's cost card is built on;
 *      a rule that denied everyone would pass every FAIL case above and still
 *      be wrong
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, addDoc, collection, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const USER = 'usage-user';
const ADMIN = 'usage-admin';
const EVENT_ID = 'seeded-event';
const AGG_ID = '2026-08-23__gemini__ai.dispute__pool1';

// Seed one of each, server-side, so the update/delete/read cases act on real docs.
await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'provider_usage_events', EVENT_ID), {
        provider: 'gemini', feature: 'ai.dispute', outcome: 'success',
        poolId: 'pool1', userId: USER, estimatedCostUSD: 0.002, priced: true,
    });
    await setDoc(doc(db, 'provider_usage_daily', AGG_ID), {
        dayKey: '2026-08-23', provider: 'gemini', feature: 'ai.dispute',
        poolId: 'pool1', calls: 1, estimatedCostUSD: 0.002,
    });
    // NB: `isSuperAdmin()` (firestore.rules:78) reads the CUSTOM AUTH CLAIM,
    // not this doc — the claim is the authz authority in this repo. The doc is
    // seeded only so the admin looks like a real user; the claim below is what
    // actually grants the read.
    await setDoc(doc(db, 'users', ADMIN), { role: 'SUPER_ADMIN', email: 'admin@example.com' });
});

const userDb = env.authenticatedContext(USER).firestore();
const adminDb = env.authenticatedContext(ADMIN, { role: 'SUPER_ADMIN' }).firestore();
const anonDb = env.unauthenticatedContext().firestore();

let failures = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (e) {
        failures++;
        console.error(`  FAIL  ${label}\n        ${e.message}`);
    }
};

console.log('provider_usage_* rules:');

await check('1. ordinary user CANNOT create a usage event', () =>
    assertFails(addDoc(collection(userDb, 'provider_usage_events'), {
        provider: 'gemini', feature: 'forged', outcome: 'success', estimatedCostUSD: 999,
    })));

await check('2. ordinary user CANNOT create a daily aggregate', () =>
    assertFails(setDoc(doc(userDb, 'provider_usage_daily', '2026-08-23__gemini__forged__pool1'), {
        calls: 1, estimatedCostUSD: 999,
    })));

await check('3. ordinary user CANNOT update an aggregate (the increment attack)', () =>
    assertFails(updateDoc(doc(userDb, 'provider_usage_daily', AGG_ID), { estimatedCostUSD: 999 })));

await check('4. ordinary user CANNOT delete an event', () =>
    assertFails(deleteDoc(doc(userDb, 'provider_usage_events', EVENT_ID))));

await check('5. unauthenticated client CANNOT write', () =>
    assertFails(addDoc(collection(anonDb, 'provider_usage_events'), { provider: 'gemini' })));

await check('6. ordinary user CANNOT read (attribution metadata)', () =>
    assertFails(getDoc(doc(userDb, 'provider_usage_events', EVENT_ID))));

await check('7. SUPER_ADMIN CAN read both collections', async () => {
    await assertSucceeds(getDoc(doc(adminDb, 'provider_usage_events', EVENT_ID)));
    await assertSucceeds(getDoc(doc(adminDb, 'provider_usage_daily', AGG_ID)));
});

await env.cleanup();

if (failures > 0) {
    console.error(`provider_usage rules: ${failures} case(s) failed`);
    process.exit(1);
}
console.log('provider_usage rules: all cases passed');
process.exit(0);
