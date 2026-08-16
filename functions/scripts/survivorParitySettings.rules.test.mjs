/**
 * Firestore rules test for the survivor parity settings deny
 * (PLAN-SURVIVOR-PARITY-SCORING decision 4, review rounds 8 and 9).
 *
 * Run:
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/survivorParitySettings.rules.test.mjs"
 *
 * `updatePoolSettings` refuses to change `settings.tieCountsAs` or
 * `settings.maxTeamUses` once a pool has published a scored week, because both
 * regrade past weeks on the next rescore. `firestore.rules` grants isSuperAdmin()
 * unrestricted pool updates, so without a rules-level deny that refusal is one
 * direct client write away from decorative.
 *
 * ⚠️ WHAT THIS TEST IS REALLY FOR. The obvious way to write the rule — a
 * per-field check against the ROOT `diff().affectedKeys()` — CANNOT SEE nested
 * fields; it reports only the top-level `settings` key. A rule written that way
 * looks like a guard, passes review, and never fires. So these cases cover all
 * three write SHAPES, not just the happy one:
 *   1. a dotted `settings.maxTeamUses` update
 *   2. a wholesale `settings` replacement with the value changed inside it
 *   3. a deletion of the field
 * plus the surfaces that must KEEP working, because a blanket lockout of NFL
 * settings would change the super-admin repair surface well beyond this plan.
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteField } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const ADMIN = 'admin1';
const OWNER = 'owner1';

const BASE_SETTINGS = {
    entryFee: 0,
    maxStrikes: 0,
    pickLosersMode: false,
    tieCountsAs: 'LOSS',
    maxTeamUses: 1,
};

async function seed() {
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'pools', 'sv1'), {
            type: 'NFL_SURVIVOR', status: 'OPEN',
            ownerId: OWNER, managerUid: OWNER,
            participantIds: [OWNER],
            name: 'Survivor Pool',
            publishedWeeks: { 1: true },
            settings: { ...BASE_SETTINGS },
        });
        // A BRACKET pool: carries the SAME maxEntriesPerUser key and saves it by
        // direct updateDoc (BracketPoolDashboard handleSaveSettings), so the
        // NFL-only scoping of that key is what keeps this write working.
        await setDoc(doc(db, 'pools', 'br1'), {
            type: 'BRACKET', status: 'OPEN',
            ownerId: OWNER, managerUid: OWNER,
            participantIds: [OWNER],
            name: 'Bracket Pool',
            settings: { entryFee: 0, maxEntriesPerUser: 1, maxEntriesTotal: 100 },
        });
    });
}
await seed();

const admin = env.authenticatedContext(ADMIN, { role: 'SUPER_ADMIN' }).firestore();
const owner = env.authenticatedContext(OWNER).firestore();

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

console.log('Denied for EVERY client principal, super-admin included:');

await check('SUPER_ADMIN cannot dotted-update settings.maxTeamUses', assertFails(
    updateDoc(doc(admin, 'pools', 'sv1'), { 'settings.maxTeamUses': 3 }),
));
await check('SUPER_ADMIN cannot dotted-update settings.tieCountsAs', assertFails(
    updateDoc(doc(admin, 'pools', 'sv1'), { 'settings.tieCountsAs': 'WIN' }),
));
await check('SUPER_ADMIN cannot smuggle it inside a WHOLESALE settings replacement', assertFails(
    // The shape a root-level affectedKeys() check cannot see: only `settings`
    // shows as affected, and the changed field is buried inside the map.
    updateDoc(doc(admin, 'pools', 'sv1'), { settings: { ...BASE_SETTINGS, tieCountsAs: 'WIN' } }),
));
// PLAN-MULTI-ENTRY D8: same guard, one more key — raise-only through the callable.
await check('SUPER_ADMIN cannot dotted-update settings.maxEntriesPerUser', assertFails(
    updateDoc(doc(admin, 'pools', 'sv1'), { 'settings.maxEntriesPerUser': 3 }),
));
await check('SUPER_ADMIN cannot smuggle maxEntriesPerUser inside a WHOLESALE settings replacement', assertFails(
    updateDoc(doc(admin, 'pools', 'sv1'), { settings: { ...BASE_SETTINGS, maxEntriesPerUser: 3 } }),
));
await check('the pool OWNER cannot write settings.maxEntriesPerUser', assertFails(
    updateDoc(doc(owner, 'pools', 'sv1'), { 'settings.maxEntriesPerUser': 3 }),
));
await check('SUPER_ADMIN cannot DELETE either field', assertFails(
    updateDoc(doc(admin, 'pools', 'sv1'), { 'settings.maxTeamUses': deleteField() }),
));
// Belt and braces, not proof of THIS rule: nflSettingsWriteBlocked() already
// denies an owner any client-direct `settings` write on an NFL pool. It is here
// so a future relaxation of that rule cannot quietly reopen this path.
await check('the pool OWNER cannot either', assertFails(
    updateDoc(doc(owner, 'pools', 'sv1'), { 'settings.maxTeamUses': 3 }),
));

console.log('Surfaces that must keep working:');

await check('SUPER_ADMIN still updates an UNRELATED settings field', assertSucceeds(
    updateDoc(doc(admin, 'pools', 'sv1'), { settings: { ...BASE_SETTINGS, maxStrikes: 2 } }),
));
await check('SUPER_ADMIN still updates a top-level pool field', assertSucceeds(
    updateDoc(doc(admin, 'pools', 'sv1'), { name: 'Renamed' }),
));
await check('a BRACKET owner still writes settings.maxEntriesPerUser directly (the key is NFL-scoped — qodo #1 on #449)', assertSucceeds(
    updateDoc(doc(owner, 'pools', 'br1'), { 'settings.maxEntriesPerUser': 3 }),
));
await check('a same-value settings write is not a change, so it passes', assertSucceeds(
    // The manager UI submits a COMPLETE settings object on every save. If an
    // unchanged value tripped the deny, ordinary saves would break.
    updateDoc(doc(admin, 'pools', 'sv1'), { settings: { ...BASE_SETTINGS, maxStrikes: 2 } }),
));

await env.cleanup();
if (failures > 0) {
    console.error(`\n${failures} rules assertion(s) FAILED.`);
    process.exit(1);
}
console.log('\nOK — all survivor-parity settings rules checks passed.');
