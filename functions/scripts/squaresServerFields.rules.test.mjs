/**
 * Firestore rules test for `squaresServerFieldsUnchanged()`
 * (PLAN-SQUARES-SERVER-FIELDS; plan K1, K4, K11 of PLAN-SQUARES-REOPEN).
 *
 * Run:
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/squaresServerFields.rules.test.mjs"
 *
 * What it pins, in order:
 *   A. each server-owned field is refused to a squares MANAGER in exactly the
 *      condition the rule names, and allowed outside it;
 *   B. the writes the admin page still makes keep working — other fields,
 *      prize terms before lock, team names on an unlinked pool, scores on a
 *      hand-scored pool, and a full-object resend of unchanged values;
 *   C. a SUPER_ADMIN's client writes are unchanged (current posture);
 *   D. 🛑 NO COLLATERAL ON OTHER POOL TYPES — the same writes on an NFL,
 *      Bracket and Playoff pool still pass. This rules file governs running
 *      NFL pools; this section is why the change can ship during a season.
 *
 * Every case starts from a freshly written pool (`reset`), so no case depends
 * on what an earlier one did.
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
    projectId: 'gridiron-gamble-uzuqo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const OWNER = 'ssf-owner';
const ADMIN = 'ssf-admin';
const POOL = 'ssf-pool';

const AXIS = { home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], away: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] };
const SCORES = { current: null, q1: { home: 7, away: 3 }, half: null, q3: null, final: null };

/** An unlocked, unlinked squares pool — the setup state. */
const SQUARES = {
    id: POOL,
    name: 'Server fields pool',
    type: 'SQUARES',
    ownerId: OWNER,
    managerUid: OWNER,
    status: 'DRAFT',
    createdAt: 1,
    isLocked: false,
    homeTeam: 'Lions',
    awayTeam: 'Bears',
    costPerSquare: 5,
    numberSets: 1,
    includeOvertime: true,
    scoreChangePayoutAmount: 0,
    payouts: { q1: 25, half: 25, q3: 25, final: 25 },
    charity: { enabled: false, percentage: 0 },
    ruleVariations: { reverseWinners: false, quarterlyRollover: false, scoreChangePayout: false },
    scores: SCORES,
    manualScoreOverride: false,
};
const LINKED = { gameId: '401772900', gameTime: 1764190800000, league: 'nfl' };
const LOCKED = { isLocked: true, axisNumbers: AXIS };

const reset = async (data) => {
    await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'pools', POOL), data);
    });
};

await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', ADMIN), { role: 'SUPER_ADMIN' });
    await setDoc(doc(ctx.firestore(), 'users', OWNER), { role: 'COMMISSIONER' });
});

const owner = env.authenticatedContext(OWNER).firestore();
const admin = env.authenticatedContext(ADMIN, { role: 'SUPER_ADMIN' }).firestore();
const pool = (db) => doc(db, 'pools', POOL);

let failures = 0;
let cases = 0;
const check = async (label, setup, promiseFn) => {
    cases++;
    await reset(setup);
    try {
        await promiseFn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL  ${label} — ${err?.message || err}`);
    }
};
const refused = (label, setup, patch) =>
    check(`refused: ${label}`, setup, () => assertFails(updateDoc(pool(owner), patch)));
const allowed = (label, setup, patch, db = owner) =>
    check(`allowed: ${label}`, setup, () => assertSucceeds(updateDoc(pool(db), patch)));

console.log('squaresServerFieldsUnchanged (PLAN-SQUARES-SERVER-FIELDS)');

// ---- A. always server-owned ---------------------------------------------------
console.log('\nA1. always server-owned on a squares pool');
await refused('quarterlyNumbers on an unlocked pool (K1)', SQUARES, { quarterlyNumbers: { q2: AXIS } });
await refused('quarterlyNumbers on a locked pool (K1)', { ...SQUARES, ...LOCKED }, { quarterlyNumbers: { q2: AXIS } });
await refused('isLocked: true — locking is lockPool\'s', SQUARES, { isLocked: true });
await refused('isLocked: false — reopening is unlockSquaresPool\'s (K4)', { ...SQUARES, ...LOCKED }, { isLocked: false });
await refused('randomWinner (K4)', { ...SQUARES, ...LOCKED }, { randomWinner: { squareId: 4, owner: 'Me', amount: 100, timestamp: 1 } });
await refused('gameId — link a game (K11)', SQUARES, { gameId: '401772900' });
await refused('gameId — change the linked game (K11)', { ...SQUARES, ...LINKED }, { gameId: '401772901' });
await refused('gameId — unlink (K11)', { ...SQUARES, ...LINKED }, { gameId: '' });
await refused('gameTime (K11)', { ...SQUARES, ...LINKED }, { gameTime: 1 });
await refused('league (K11)', { ...SQUARES, ...LINKED }, { league: 'college' });

console.log('\nA2. team names');
await refused('homeTeam while a game is linked', { ...SQUARES, ...LINKED }, { homeTeam: 'Bears' });
await refused('awayTeam while a game is linked', { ...SQUARES, ...LINKED }, { awayTeam: 'Lions' });
await refused('homeTeam once locked, unlinked', { ...SQUARES, ...LOCKED }, { homeTeam: 'Bears' });
await allowed('team names on an unlinked, unlocked pool', SQUARES, { homeTeam: 'Packers', awayTeam: 'Vikings' });

console.log('\nA3. prize terms freeze at lock');
const PRIZE_CHANGES = {
    payouts: { q1: 10, half: 10, q3: 10, final: 70 },
    charity: { enabled: true, percentage: 50 },
    ruleVariations: { reverseWinners: true, quarterlyRollover: false, scoreChangePayout: false },
    costPerSquare: 50,
    scoreChangePayoutAmount: 25,
    numberSets: 4,
    includeOvertime: false,
};
for (const [field, value] of Object.entries(PRIZE_CHANGES)) {
    await refused(`${field} once locked`, { ...SQUARES, ...LOCKED }, { [field]: value });
    await allowed(`${field} before lock`, SQUARES, { [field]: value });
}

console.log('\nA4. scores');
const NEW_SCORES = { ...SCORES, q1: { home: 0, away: 21 } };
await refused('scores on a locked, linked pool without Manual Score Override', { ...SQUARES, ...LINKED, ...LOCKED }, { scores: NEW_SCORES });
await allowed('scores on a locked, linked pool WITH Manual Score Override', { ...SQUARES, ...LINKED, ...LOCKED, manualScoreOverride: true }, { scores: NEW_SCORES });
await allowed('scores on a locked, unlinked pool (hand-scored)', { ...SQUARES, ...LOCKED }, { scores: NEW_SCORES });
await allowed('scores on an unlocked, linked pool', { ...SQUARES, ...LINKED }, { scores: NEW_SCORES });
// codex, PR #765: one write that switches the override OFF and changes the
// scores would leave typed scores on a pool that claims feed scoring.
await refused('scores in the same write that turns Manual Score Override OFF', { ...SQUARES, ...LINKED, ...LOCKED, manualScoreOverride: true }, { scores: NEW_SCORES, manualScoreOverride: false });
await allowed('turning Manual Score Override off on its own', { ...SQUARES, ...LINKED, ...LOCKED, manualScoreOverride: true }, { manualScoreOverride: false });

// ---- B. what the admin page still does ------------------------------------------
console.log('\nB. no collateral on the admin page');
await allowed('an ordinary field on a locked, linked pool', { ...SQUARES, ...LINKED, ...LOCKED }, { name: 'Renamed', manualScoreOverride: true });
await allowed(
    'a full-object resend of every frozen field UNCHANGED, on a locked, linked pool',
    { ...SQUARES, ...LINKED, ...LOCKED, quarterlyNumbers: { q1: AXIS } },
    {
        ...LINKED, isLocked: true, quarterlyNumbers: { q1: AXIS },
        homeTeam: SQUARES.homeTeam, awayTeam: SQUARES.awayTeam,
        payouts: SQUARES.payouts, charity: SQUARES.charity, ruleVariations: SQUARES.ruleVariations,
        costPerSquare: SQUARES.costPerSquare, scoreChangePayoutAmount: 0, numberSets: 1,
        includeOvertime: true, scores: SCORES, name: 'Resent',
    },
);

// ---- C. SUPER_ADMIN --------------------------------------------------------------
console.log('\nC. SUPER_ADMIN client writes unchanged (current posture)');
await allowed('a SUPER_ADMIN may reset isLocked and quarterlyNumbers', { ...SQUARES, ...LINKED, ...LOCKED }, { isLocked: false, quarterlyNumbers: null }, admin);
await allowed('a SUPER_ADMIN may change prize terms on a locked pool', { ...SQUARES, ...LOCKED }, { payouts: PRIZE_CHANGES.payouts }, admin);

// ---- D. other pool types ------------------------------------------------------------
console.log('\nD. 🛑 other pool types are untouched');
const OTHER_PATCH = {
    isLocked: true, payouts: { first: 70, second: 30 }, scores: NEW_SCORES,
    homeTeam: 'X', awayTeam: 'Y', randomWinner: null, quarterlyNumbers: null,
};
for (const type of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN', 'BRACKET', 'NFL_PLAYOFFS', 'PROPS']) {
    await allowed(
        `${type}: a manager's write of the squares-frozen fields`,
        { ...SQUARES, ...LINKED, ...LOCKED, type, league: 'NFL', season: '2026' },
        OTHER_PATCH,
    );
}

await env.cleanup();

// Empty-pass guard: a broken loop above must not report a short run as green.
const EXPECTED_CASES = 10 + 4 + 14 + 6 + 2 + 2 + 6;
if (cases !== EXPECTED_CASES) {
    console.error(`\nRan ${cases} cases, expected ${EXPECTED_CASES}.`);
    process.exit(1);
}
if (failures > 0) {
    console.error(`\n${failures} of ${cases} squaresServerFields rules assertion(s) FAILED`);
    process.exit(1);
}
console.log(`\nAll ${cases} squaresServerFields rules assertions passed.`);
