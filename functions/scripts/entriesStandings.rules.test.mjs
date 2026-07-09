/**
 * Firestore rules test for the ADR 0005 Phase 2 entry-read tightening + the
 * standings projection (PLAN-PLAYER-PROFILES.md).
 *
 * Run:
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/entriesStandings.rules.test.mjs"
 *
 * Verifies (NFL pool, LOCKED):
 *   - a member reads their OWN entry
 *   - a member CANNOT read another member's entry (pre-FINAL)
 *   - pool owner + manager still read all entries
 *   - members read /standings/current; non-participants and guests cannot
 * Verifies (NFL pool, FINAL): a member CAN read another member's entry
 * Verifies (BRACKET pool, LOCKED): coarse post-lock read unchanged (reveal by design)
 */
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

const OWNER = 'owner1';
const MANAGER = 'manager1';
const ALICE = 'alice';
const BOB = 'bob';
const OUTSIDER = 'outsider';

await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // NFL pickem pool, locked mid-season
    await setDoc(doc(db, 'pools', 'nfl1'), {
        type: 'NFL_PICKEM', status: 'LOCKED', isLocked: true,
        ownerId: OWNER, managerUid: MANAGER,
        participantIds: [OWNER, ALICE, BOB],
    });
    await setDoc(doc(db, 'pools', 'nfl1', 'entries', ALICE), { ownerUid: ALICE, picks: { g9: 'KC' } });
    await setDoc(doc(db, 'pools', 'nfl1', 'entries', BOB), { ownerUid: BOB, picks: { g9: 'BUF' } });
    await setDoc(doc(db, 'pools', 'nfl1', 'standings', 'current'), {
        poolType: 'NFL_PICKEM', lastScoredWeek: 1,
        rows: [{ ownerUid: ALICE, userName: 'Alice', totalScore: 9 }],
    });
    // Same pool shape but FINAL
    await setDoc(doc(db, 'pools', 'nfl2'), {
        type: 'NFL_PICKEM', status: 'FINAL',
        ownerId: OWNER, participantIds: [ALICE, BOB],
    });
    await setDoc(doc(db, 'pools', 'nfl2', 'entries', BOB), { ownerUid: BOB, picks: { g9: 'BUF' } });
    // Bracket pool, locked — coarse read is by design
    await setDoc(doc(db, 'pools', 'br1'), {
        type: 'BRACKET', status: 'LOCKED', isLocked: true,
        ownerId: OWNER, participantIds: [ALICE, BOB],
    });
    await setDoc(doc(db, 'pools', 'br1', 'entries', 'bobEntry'), { ownerUid: BOB, picks: { s1: 't1' } });
});

const alice = env.authenticatedContext(ALICE).firestore();
const owner = env.authenticatedContext(OWNER).firestore();
const manager = env.authenticatedContext(MANAGER).firestore();
const outsider = env.authenticatedContext(OUTSIDER).firestore();
const guest = env.unauthenticatedContext().firestore();

// --- NFL LOCKED: own yes, other's no, owner/manager yes ---
await assertSucceeds(getDoc(doc(alice, 'pools', 'nfl1', 'entries', ALICE)));
await assertFails(getDoc(doc(alice, 'pools', 'nfl1', 'entries', BOB)));
await assertSucceeds(getDoc(doc(owner, 'pools', 'nfl1', 'entries', BOB)));
await assertSucceeds(getDoc(doc(manager, 'pools', 'nfl1', 'entries', BOB)));
await assertFails(getDoc(doc(outsider, 'pools', 'nfl1', 'entries', BOB)));

// --- Standings projection: participants yes, outsiders/guests no, writes never ---
await assertSucceeds(getDoc(doc(alice, 'pools', 'nfl1', 'standings', 'current')));
await assertSucceeds(getDoc(doc(owner, 'pools', 'nfl1', 'standings', 'current')));
await assertFails(getDoc(doc(outsider, 'pools', 'nfl1', 'standings', 'current')));
await assertFails(getDoc(doc(guest, 'pools', 'nfl1', 'standings', 'current')));
await assertFails(setDoc(doc(alice, 'pools', 'nfl1', 'standings', 'current'), { rows: [] }));

// --- NFL FINAL: participant reads another's entry ---
await assertSucceeds(getDoc(doc(alice, 'pools', 'nfl2', 'entries', BOB)));

// --- BRACKET LOCKED: coarse participant read unchanged ---
await assertSucceeds(getDoc(doc(alice, 'pools', 'br1', 'entries', 'bobEntry')));
await assertFails(getDoc(doc(outsider, 'pools', 'br1', 'entries', 'bobEntry')));

await env.cleanup();
console.log('entriesStandings.rules.test.mjs: ALL ASSERTIONS PASSED');
