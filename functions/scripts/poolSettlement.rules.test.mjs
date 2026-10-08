/**
 * Firestore rules test for PLAN-SPLIT-POT-SETTLEMENT §2.4b.
 *
 * Run (all rules files):  npm --prefix functions run test:rules
 *
 * Two guards:
 *
 * 1. SERVER-OWNED settlement + finalization fields. The "the pot was split
 *    between A and B" banner is rendered from `pool.settlement` alone, so a
 *    manager who could write it could announce a split nobody agreed to.
 *    `finalizedAt` ends play on every NFL path.
 *
 * 2. 🛑 NFL LIFECYCLE IS CALLABLE-ONLY FOR MANAGERS (codex plan-review r2 #4).
 *    `poolIsEditable()` checks only the CURRENT status, so one direct write used
 *    to move a manager's NFL pool OPEN → FINAL, and the entries read rule then
 *    opens every member's un-revealed picks to every participant. The case that
 *    proves it is the last one in section 2: after the denied flip, a member
 *    still cannot read another member's entry.
 *
 * Plus the surfaces that must KEEP working: a bracket manager still locks their
 * bracket directly, a super-admin repair still works, and an NFL manager's
 * ordinary top-level edit still saves.
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const ADMIN = 'admin1';
const OWNER = 'owner1';
const MEMBER = 'member1';
const OTHER = 'member2';

async function seed() {
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'pools', 'sv1'), {
            type: 'NFL_SURVIVOR', status: 'OPEN',
            ownerId: OWNER, managerUid: OWNER,
            participantIds: [OWNER, MEMBER, OTHER],
            name: 'Survivor Pool',
            settings: { entryFee: 25, maxStrikes: 0 },
        });
        await setDoc(doc(db, 'pools', 'sv1', 'entries', OTHER), {
            ownerUid: OTHER, status: 'ALIVE', picks: { 5: 'KC' },
        });
        await setDoc(doc(db, 'pools', 'br1'), {
            type: 'BRACKET', status: 'OPEN',
            ownerId: OWNER, managerUid: OWNER,
            participantIds: [OWNER],
            name: 'Bracket Pool',
            settings: { entryFee: 0 },
        });
    });
}
await seed();

const admin = env.authenticatedContext(ADMIN, { role: 'SUPER_ADMIN' }).firestore();
const owner = env.authenticatedContext(OWNER).firestore();
const member = env.authenticatedContext(MEMBER).firestore();

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

console.log('1. Settlement and finalization fields are server-owned:');
for (const [field, value] of [
    ['settlement', { kind: 'SPLIT', entryIds: [OWNER], winnerNames: ['Me'] }],
    ['settlementStartedAt', 1],
    ['finalizedAt', 1],
    ['firstFinalizedAt', 1],
]) {
    await check(`the pool OWNER cannot write ${field}`, assertFails(
        updateDoc(doc(owner, 'pools', 'sv1'), { [field]: value }),
    ));
}
await check('nor a plain member', assertFails(
    updateDoc(doc(member, 'pools', 'sv1'), { settlement: { kind: 'SPLIT' } }),
));

console.log('2. An NFL manager cannot change the lifecycle from the client:');
for (const [field, value] of [
    ['status', 'FINAL'],
    ['status', 'COMPLETED'],
    ['closedVia', 'SETTLED'],
    ['closedAt', 1],
    ['isFinal', true],
]) {
    await check(`the NFL pool OWNER cannot set ${field} = ${JSON.stringify(value)}`, assertFails(
        updateDoc(doc(owner, 'pools', 'sv1'), { [field]: value }),
    ));
}
await check('so another member\'s entry stays unreadable to a member (the disclosure this closes)', assertFails(
    getDoc(doc(member, 'pools', 'sv1', 'entries', OTHER)),
));

console.log('Surfaces that must keep working:');
await check('an NFL owner still saves an ordinary top-level field', assertSucceeds(
    updateDoc(doc(owner, 'pools', 'sv1'), { name: 'Renamed Survivor' }),
));
await check('a BRACKET owner still locks their bracket directly (BracketPoolDashboard)', assertSucceeds(
    updateDoc(doc(owner, 'pools', 'br1'), { status: 'LOCKED' }),
));
await check('a SUPER_ADMIN repair of an NFL pool status still works (super-admin branch)', assertSucceeds(
    updateDoc(doc(admin, 'pools', 'sv1'), { status: 'OPEN' }),
));

await env.cleanup();
if (failures > 0) {
    console.error(`\n${failures} rules assertion(s) FAILED.`);
    process.exit(1);
}
console.log('\nOK — all pool settlement rules checks passed.');
