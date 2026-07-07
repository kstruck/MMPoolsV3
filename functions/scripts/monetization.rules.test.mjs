/**
 * Firestore rules test for the buy-flow monetization collections:
 * coupons, couponTemplates, monetization_alerts, checkoutSessions, and
 * bundles (+ the credits subcollection).
 *
 * Requires Java (the Firestore emulator is a Java process) and the
 * @firebase/rules-unit-testing package. Run via the emulator:
 *
 *   npm i -D @firebase/rules-unit-testing
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/monetization.rules.test.mjs"
 *
 * Verifies (per ADR-0002 + PLAN-BUYFLOW-OVERHAUL Phase 6 #24):
 *   - coupons / couponTemplates / monetization_alerts: SUPER_ADMIN reads only,
 *     no ordinary-user reads, no client writes
 *   - checkoutSessions: no client access at all
 *   - bundles: owner reads their own, a non-owner cannot, SUPER_ADMIN reads any,
 *     no client writes
 *   - bundles/{id}/credits: readable only by the parent bundle's owner (or admin)
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

const OWNER_UID = 'owner1';
const OTHER_UID = 'intruder1';
const BUNDLE_ID = 'bundle1';
const CREDIT_ID = 'credit1';

// Seed docs, bypassing rules.
await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'coupons', 'MELEEFREE'), {
        code: 'MELEEFREE', discountType: 'percentage', discountValue: 100, isActive: true,
        usesCount: 3, usageLog: [{ reservationId: 'r1', userId: OWNER_UID, poolId: 'p1', status: 'confirmed' }],
    });
    await setDoc(doc(db, 'couponTemplates', 'blackFriday'), { name: 'Black Friday', discountType: 'percentage', discountValue: 40 });
    await setDoc(doc(db, 'monetization_alerts', 'a1'), { type: 'COUPON_VELOCITY_SPIKE', couponCode: 'MELEEFREE', status: 'open' });
    await setDoc(doc(db, 'checkoutSessions', 'res1'), { userId: OWNER_UID, poolId: 'p1', snapshot: { maxPlayersAllowed: 25 } });
    await setDoc(doc(db, 'bundles', BUNDLE_ID), {
        ownerId: OWNER_UID, productKind: 'CREDIT_BUNDLE', source: 'PURCHASE',
        creditsTotal: 3, creditsUsed: 0, status: 'active',
    });
    await setDoc(doc(db, 'bundles', BUNDLE_ID, 'credits', CREDIT_ID), { status: 'available', constraints: {} });
});

// role is the custom claim the rules read (request.auth.token.role).
const admin = env.authenticatedContext('admin1', { role: 'SUPER_ADMIN' }).firestore();
const owner = env.authenticatedContext(OWNER_UID).firestore();
const other = env.authenticatedContext(OTHER_UID).firestore();
const guest = env.unauthenticatedContext().firestore();

// --- coupons: SUPER_ADMIN read only, no client write ---
await assertSucceeds(getDoc(doc(admin, 'coupons', 'MELEEFREE')));
await assertFails(getDoc(doc(owner, 'coupons', 'MELEEFREE')));   // ordinary user (was allowed before ADR-0002)
await assertFails(getDoc(doc(guest, 'coupons', 'MELEEFREE')));
await assertFails(setDoc(doc(admin, 'coupons', 'X'), { code: 'X' }));   // functions-only write

// --- couponTemplates: SUPER_ADMIN read only, no client write ---
await assertSucceeds(getDoc(doc(admin, 'couponTemplates', 'blackFriday')));
await assertFails(getDoc(doc(owner, 'couponTemplates', 'blackFriday')));
await assertFails(setDoc(doc(admin, 'couponTemplates', 'Y'), { name: 'Y' }));

// --- monetization_alerts: SUPER_ADMIN read only, no client write ---
await assertSucceeds(getDoc(doc(admin, 'monetization_alerts', 'a1')));
await assertFails(getDoc(doc(owner, 'monetization_alerts', 'a1')));
await assertFails(setDoc(doc(admin, 'monetization_alerts', 'a2'), { type: 'X' }));

// --- checkoutSessions: no client access at all ---
await assertFails(getDoc(doc(admin, 'checkoutSessions', 'res1')));
await assertFails(getDoc(doc(owner, 'checkoutSessions', 'res1')));
await assertFails(setDoc(doc(owner, 'checkoutSessions', 'res2'), { userId: OWNER_UID }));

// --- bundles: owner reads own, non-owner denied, admin reads any, no client write ---
await assertSucceeds(getDoc(doc(owner, 'bundles', BUNDLE_ID)));
await assertFails(getDoc(doc(other, 'bundles', BUNDLE_ID)));
await assertSucceeds(getDoc(doc(admin, 'bundles', BUNDLE_ID)));
await assertFails(setDoc(doc(owner, 'bundles', BUNDLE_ID), { creditsUsed: 99 }));   // functions-only write

// --- bundles/{id}/credits: only the parent bundle's owner (or admin) ---
await assertSucceeds(getDoc(doc(owner, 'bundles', BUNDLE_ID, 'credits', CREDIT_ID)));
await assertFails(getDoc(doc(other, 'bundles', BUNDLE_ID, 'credits', CREDIT_ID)));
await assertSucceeds(getDoc(doc(admin, 'bundles', BUNDLE_ID, 'credits', CREDIT_ID)));
await assertFails(setDoc(doc(owner, 'bundles', BUNDLE_ID, 'credits', CREDIT_ID), { status: 'used' }));

await env.cleanup();
console.log('OK — monetization rules behave correctly.');
