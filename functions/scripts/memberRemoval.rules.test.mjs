/**
 * Firestore rules test — A REMOVED MEMBER'S NEXT DIRECT CLIENT READ IS DENIED,
 * ON THE SAME TOKEN THEY WERE HOLDING WHEN THEY WERE REMOVED.
 * (PLAN-MEMBER-REMOVAL-HARDENING, triage of external claim (b).)
 *
 * Run:
 *   npm --prefix functions run test:rules
 *   # or, for this file alone:
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/memberRemoval.rules.test.mjs"
 *
 * ## The claim this exists to disprove — and keep disproved
 *
 * An external review asserted that removal in this app "relies on
 * refresh-token revocation, which does not take effect until the client's ID
 * token expires (up to an hour)", so a removed member's next request still
 * succeeds. That is false here, and the reason is structural rather than
 * lucky: POOL MEMBERSHIP HAS NEVER BEEN CARRIED IN A TOKEN CLAIM. Every rule
 * below resolves it with a LIVE `get()` of the pool document —
 * `request.auth.uid in get(/pools/$(poolId)).data.participantIds` — which the
 * rules engine evaluates against the CURRENT document on every single request.
 * `admin.auth().revokeRefreshTokens` is called only by `adminClaims.ts`, and
 * only for the platform SUPER_ADMIN role claim.
 *
 * ## Why the token here is genuinely "stale"
 *
 * `env.authenticatedContext(uid)` mints ONE decoded token payload and reuses it
 * for every request made through that context. This file mints Alice's context
 * BEFORE the removal and keeps using it AFTER — never re-minting, never
 * cleaning up, no delay. That is exactly the shape the claim describes: an ID
 * token issued while the caller was a member, presented after they stopped
 * being one. If a future refactor moved membership onto a custom claim, these
 * assertions would flip from FAIL to SUCCEED and this file would go red.
 *
 * The callable half of the same claim is proved separately, against the real
 * handler, in `functions/src/__tests__/emulator/memberRemoval.emulator.test.ts`
 * ("H2"). Rules govern direct client reads; the callables govern the rest.
 *
 * ## What is covered
 *
 * The five member-gated surfaces under `pools/{poolId}` that key off
 * `participantIds`: the Member Records themselves, `standings`, `rosterSummary`,
 * `consensus`, and `payoutRecords`. Plus two controls: the pool document itself
 * stays readable (it is `allow get: if true` BY DESIGN — the client uses that
 * surviving read to notice its own removal and drop cached data,
 * `NFLPoolDashboard.tsx`), and a member who was NOT removed keeps every read.
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const OWNER = 'rmr-owner';
const ALICE = 'rmr-alice';
const BOB = 'rmr-bob';
const POOL = 'rmr-pool';

const BASE = {
    id: POOL,
    name: 'Removal pool',
    type: 'NFL_PICKEM',
    league: 'NFL',
    ownerId: OWNER,
    managerUid: OWNER,
    season: '2026',
    status: 'OPEN',
    isLocked: false,
    createdAt: Date.now(),
    participantIds: [OWNER, ALICE, BOB],
    settings: { entryFee: 0, paymentInstructions: '', isListedPublic: false },
};

await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, 'pools', POOL), BASE);
    await setDoc(doc(fs, 'pools', POOL, 'members', ALICE), { uid: ALICE, poolId: POOL, userName: 'Alice', joinedAt: Date.now(), paidStatus: 'UNPAID' });
    await setDoc(doc(fs, 'pools', POOL, 'members', BOB), { uid: BOB, poolId: POOL, userName: 'Bob', joinedAt: Date.now(), paidStatus: 'UNPAID' });
    await setDoc(doc(fs, 'pools', POOL, 'standings', 'current'), { rows: [] });
    await setDoc(doc(fs, 'pools', POOL, 'rosterSummary', 'current'), { dues: 0 });
    await setDoc(doc(fs, 'pools', POOL, 'consensus', 'g1'), { counts: {} });
    await setDoc(doc(fs, 'pools', POOL, 'payoutRecords', 'a1'), { uid: BOB, amount: 10 });
    await setDoc(doc(fs, 'users', OWNER), { role: 'COMMISSIONER' });
    await setDoc(doc(fs, 'users', ALICE), { role: 'MEMBER' });
    await setDoc(doc(fs, 'users', BOB), { role: 'MEMBER' });
});

// 🛑 MINTED BEFORE THE REMOVAL AND NEVER RE-MINTED. This is the stale token.
const aliceStale = env.authenticatedContext(ALICE).firestore();
const bobStale = env.authenticatedContext(BOB).firestore();

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

// The five member-gated surfaces, as (label, path-segments) pairs.
const SURFACES = [
    ['the Member Records', ['pools', POOL, 'members', BOB]],
    ['the standings projection', ['pools', POOL, 'standings', 'current']],
    ['the roster summary', ['pools', POOL, 'rosterSummary', 'current']],
    ['the pool consensus', ['pools', POOL, 'consensus', 'g1']],
    ['the payout records', ['pools', POOL, 'payoutRecords', 'a1']],
];

console.log('member removal — stale-token denial (PLAN-MEMBER-REMOVAL-HARDENING claim b)');

console.log('\n  BEFORE removal — the token works');
for (const [label, path] of SURFACES) {
    await check(
        `Alice CAN read ${label}`,
        assertSucceeds(getDoc(doc(aliceStale, ...path))),
    );
}

// ---------------------------------------------------------------------------
// THE REMOVAL. Server-side only (rules make `participantIds` server-owned and
// the members subcollection `create, delete: if false`), which is why it runs
// with rules disabled here. No token is reissued and no time passes.
// ---------------------------------------------------------------------------
await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await updateDoc(doc(fs, 'pools', POOL), { participantIds: [OWNER, BOB] });
    await deleteDoc(doc(fs, 'pools', POOL, 'members', ALICE));
});

console.log('\n  AFTER removal — the SAME token, the very next read');
for (const [label, path] of SURFACES) {
    await check(
        `Alice CANNOT read ${label}`,
        assertFails(getDoc(doc(aliceStale, ...path))),
    );
}

// Control 1 — the denial is targeted, not a blanket break. Bob's context is
// exactly as old as Alice's.
console.log('\n  Controls');
for (const [label, path] of SURFACES) {
    await check(
        `Bob (still a member, equally old token) CAN still read ${label}`,
        assertSucceeds(getDoc(doc(bobStale, ...path))),
    );
}

// Control 2 — the pool document itself STAYS readable. `allow get: if true`
// (firestore.rules, "Allow GET by anyone (Guest Access via Link)"). This is not
// a leak the removal missed; it is load-bearing. The client watches its own
// absence from `participantIds` on that surviving read to revoke its cached
// reveal data (`src/components/NFLPoolDashboard/NFLPoolDashboard.tsx`). If this
// assertion ever flips, that client-side revocation goes blind.
await check(
    'the pool document itself is STILL readable after removal (by design — the client uses it to notice it was removed)',
    assertSucceeds(getDoc(doc(aliceStale, 'pools', POOL))),
);

// Control 3 — a removed member cannot write herself back in. `participantIds`
// is server-owned (K9) and the members subcollection refuses client creates.
await check(
    'a removed member CANNOT re-add herself to participantIds',
    assertFails(updateDoc(doc(aliceStale, 'pools', POOL), { participantIds: [OWNER, ALICE, BOB] })),
);
await check(
    'a removed member CANNOT recreate her own Member Record',
    assertFails(setDoc(doc(aliceStale, 'pools', POOL, 'members', ALICE), { uid: ALICE, joinedAt: Date.now() })),
);

await env.cleanup();

if (failures > 0) {
    console.error(`\n${failures} member-removal rules assertion(s) FAILED`);
    process.exit(1);
}
console.log('\nAll member-removal rules assertions passed.');
