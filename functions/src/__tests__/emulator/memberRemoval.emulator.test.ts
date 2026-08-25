import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import './setup';
import { voidMemberRecord, reconcileMembership } from '../../lib/memberRecord';
import { getPoolPicks } from '../../nflPickReveal';

/**
 * PLAN-MEMBER-REMOVAL-HARDENING — the two halves of removal that only a live
 * Firestore can prove.
 *
 * H1 — COMPLETENESS AND ATOMICITY. `voidMemberRecord` / `reconcileMembership`
 * are the whole of removal in this repo (no callable calls them yet — see the
 * plan doc's triage of claim (a)). They must write all SIX membership facts —
 * `participantIds`, `coManagers`, the Member Record, and the three reciprocal
 * indexes — and they must write them together or not at all. A unit test of
 * `planMembershipWrite` proves the DECISION and nothing about the writes, and
 * the all-or-nothing half is a property of Firestore's commit that only a real
 * commit can demonstrate.
 *
 * H2 — THE STALE TOKEN. This is the load-bearing one, and it is a REGRESSION
 * GUARD ON A REJECTED CLAIM: the external finding said a removed member's next
 * request still succeeds because removal relies on refresh-token revocation,
 * which does not bite until the ID token expires. It does not. Nothing in this
 * repo puts pool membership in a token claim, and `getPoolPicks` re-reads
 * `pools/{id}/members/{uid}` from Firestore on EVERY call
 * (`nflPickReveal.ts` assertPickReader). The test below holds the token object
 * FIXED across the removal — literally the same `auth` value, minted while the
 * caller was a member, reused afterwards — and asserts the very next call is
 * refused. If somebody ever "optimises" admission onto a claim, this goes red.
 *
 * ⚠️ WHY A FIXED TOKEN OBJECT IS THE HONEST SIMULATION. `firebase-functions-test`
 * hands the callable a decoded `auth` payload; there is no verification step to
 * fake and no expiry to wind forward. A stale ID token IS exactly "a decoded
 * payload asserted before the state changed, presented after it". Holding the
 * object constant while Firestore moves underneath reproduces that precisely.
 * The rules half of the same claim — direct client reads — is proved separately
 * and against the real rules engine in `functions/scripts/memberRemoval.rules.test.mjs`.
 */
const test = ftest();
const db = admin.firestore();
const wGetPicks = test.wrap(getPoolPicks);

const POOL = 'rm_pool';
const SEASON = '2029-removal';
const OWNER = 'rm_owner';
const ALICE = 'rm_alice';
const BOB = 'rm_bob';

/**
 * The token minted WHILE Alice was a member. Never rebuilt after the removal —
 * that is the whole experiment. No membership claim on it because no such claim
 * exists in this system; the empty token is what a real member actually holds.
 */
const aliceStaleToken = { uid: ALICE, token: {} } as never;

async function seedPool(over: Record<string, unknown> = {}) {
  await db.collection('pools').doc(POOL).set({
    name: 'Removal', type: 'NFL_PICKEM', league: 'NFL', season: SEASON, seasonType: 1,
    ownerId: OWNER, participantIds: [OWNER, ALICE, BOB], coManagers: [ALICE],
    status: 'OPEN', billing: { status: 'free' },
    settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
    ...over,
  });
}

async function seedMember(uid: string) {
  await db.collection('pools').doc(POOL).collection('members').doc(uid).set({
    uid, poolId: POOL, userName: uid, role: uid === OWNER ? 'MANAGER' : 'PARTICIPANT',
    paidStatus: 'UNPAID', joinedAt: Date.now(), feeOwed: 25, feeOwedSource: 'LIVE',
  });
}

/** The three reciprocal indexes a join writes, seeded the way the join paths write them. */
async function seedReciprocalIndexes(uid: string) {
  await db.collection('pools').doc(POOL).collection('participants').doc(uid).set({
    uid, squaresCount: 2, squareIds: ['0_0', '0_1'], paidCount: 0,
  });
  await db.collection('users').doc(uid).collection('participations').doc(POOL).set({
    poolId: POOL, joinedAt: Date.now(), name: 'Removal', type: 'NFL_PICKEM', role: 'PARTICIPANT',
  });
  await db.collection('users').doc(uid).collection('joinedPools').doc(POOL).set({
    poolId: POOL, joinedAt: Date.now(), role: 'MEMBER',
  });
}

const poolDoc = () => db.collection('pools').doc(POOL).get().then((s) => s.data());
const memberDoc = (uid: string) =>
  db.collection('pools').doc(POOL).collection('members').doc(uid).get();
const participantIndex = (uid: string) =>
  db.collection('pools').doc(POOL).collection('participants').doc(uid).get();
const participationIndex = (uid: string) =>
  db.collection('users').doc(uid).collection('participations').doc(POOL).get();
const joinedPoolIndex = (uid: string) =>
  db.collection('users').doc(uid).collection('joinedPools').doc(POOL).get();

async function wipe() {
  const pools = await db.collection('pools').get();
  for (const p of pools.docs) {
    for (const sub of ['members', 'entries', 'participants']) {
      const s = await p.ref.collection(sub).get();
      await Promise.all(s.docs.map((d) => d.ref.delete()));
    }
    await p.ref.delete();
  }
  for (const uid of [OWNER, ALICE, BOB]) {
    for (const sub of ['participations', 'joinedPools']) {
      const s = await db.collection('users').doc(uid).collection(sub).get();
      await Promise.all(s.docs.map((d) => d.ref.delete()));
    }
    await db.collection('users').doc(uid).delete().catch(() => undefined);
  }
  const games = await db.collection('nfl_games').where('season', '==', SEASON).get();
  await Promise.all(games.docs.map((d) => d.ref.delete()));
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  test.cleanup();
});

// ---------------------------------------------------------------------------
// H1 — completeness + atomicity
// ---------------------------------------------------------------------------
describe('H1 removal writes every membership fact, in one commit', () => {
  it('voidMemberRecord clears participantIds, coManagers, the Member Record AND all three reciprocal indexes', async () => {
    await seedPool();
    await seedMember(ALICE);
    await seedReciprocalIndexes(ALICE);

    await db.runTransaction(async (tx) => { voidMemberRecord(tx, db, POOL, ALICE); });

    const pool = (await poolDoc())!;
    expect(pool.participantIds).toEqual([OWNER, BOB]);
    expect(pool.coManagers).toEqual([]);
    expect((await memberDoc(ALICE)).exists).toBe(false);
    // The three copies the helper used to miss. `pools/{id}/participants/{uid}`
    // is read by `migrations/backfillMemberRecords.ts` as a name source, so a
    // survivor there lets the next backfill rebuild a removed member's record;
    // `users/{uid}/participations/{poolId}` is read by `recomputeUserProfile`
    // and by the client's own pool-discovery query; `users/{uid}/joinedPools/
    // {poolId}` has no reader today and is cleared anyway (see the helper).
    expect((await participantIndex(ALICE)).exists).toBe(false);
    expect((await participationIndex(ALICE)).exists).toBe(false);
    expect((await joinedPoolIndex(ALICE)).exists).toBe(false);
  });

  it('reconcileMembership with present:false clears the same six facts', async () => {
    await seedPool();
    await seedMember(ALICE);
    await seedReciprocalIndexes(ALICE);

    await db.runTransaction(async (tx) => {
      reconcileMembership(tx, db, POOL, ALICE,
        { userName: 'Alice', poolType: 'NFL_PICKEM', present: false }, null, Date.now());
    });

    const pool = (await poolDoc())!;
    expect(pool.participantIds).toEqual([OWNER, BOB]);
    expect(pool.coManagers).toEqual([]);
    expect((await memberDoc(ALICE)).exists).toBe(false);
    expect((await participantIndex(ALICE)).exists).toBe(false);
    expect((await participationIndex(ALICE)).exists).toBe(false);
  });

  it('leaves ANOTHER member\'s reciprocal indexes alone', async () => {
    await seedPool();
    await seedMember(ALICE);
    await seedMember(BOB);
    await seedReciprocalIndexes(ALICE);
    await seedReciprocalIndexes(BOB);

    await db.runTransaction(async (tx) => { voidMemberRecord(tx, db, POOL, ALICE); });

    expect((await participantIndex(BOB)).exists).toBe(true);
    expect((await participationIndex(BOB)).exists).toBe(true);
    expect((await joinedPoolIndex(BOB)).exists).toBe(true);
    expect((await memberDoc(BOB)).exists).toBe(true);
  });

  it('a pool carrying NEITHER index removes cleanly (tx.delete on a missing doc is a no-op)', async () => {
    // Every non-SQUARES, non-NFL pool is this shape: no `participants`
    // subcollection, no `participations` doc, no `coManagers` field. The three
    // extra deletes must be harmless there, or the helper cannot be the single
    // removal path for all pool types.
    await seedPool({ type: 'BRACKET' });
    await db.collection('pools').doc(POOL).update({ coManagers: admin.firestore.FieldValue.delete() });
    await seedMember(ALICE);

    await db.runTransaction(async (tx) => { voidMemberRecord(tx, db, POOL, ALICE); });

    const pool = (await poolDoc())!;
    expect(pool.participantIds).toEqual([OWNER, BOB]);
    expect((await memberDoc(ALICE)).exists).toBe(false);
  });

  it('ATOMIC: a transaction that throws after the removal leaves ALL SIX facts standing', async () => {
    await seedPool();
    await seedMember(ALICE);
    await seedReciprocalIndexes(ALICE);

    // The failure mode claim (a) describes: a removal that partially lands. It
    // cannot happen through these helpers, because every write rides ONE
    // transaction — abort it and Firestore discards the whole set. This is the
    // half a unit test cannot reach: the writes are only queued until commit.
    await expect(db.runTransaction(async (tx) => {
      voidMemberRecord(tx, db, POOL, ALICE);
      throw new Error('simulated mid-removal failure');
    })).rejects.toThrow(/simulated mid-removal failure/);

    const pool = (await poolDoc())!;
    expect(pool.participantIds).toEqual([OWNER, ALICE, BOB]);
    expect(pool.coManagers).toEqual([ALICE]);
    expect((await memberDoc(ALICE)).exists).toBe(true);
    expect((await participantIndex(ALICE)).exists).toBe(true);
    expect((await participationIndex(ALICE)).exists).toBe(true);
    expect((await joinedPoolIndex(ALICE)).exists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H2 — the stale token
// ---------------------------------------------------------------------------
describe('H2 a removed member\'s NEXT callable request fails on a token minted while they were a member', () => {
  /** One scheduled game an hour out, so the week exists and nothing is revealed. */
  async function seedWeek() {
    await db.collection('nfl_games').doc('rm_g1').set({
      id: 'rm_g1', espnGameId: 'rm_g1', season: SEASON, seasonType: 1, week: 1,
      startTime: Date.now() + 60 * 60 * 1000, status: 'SCHEDULED', isMonday: false,
      homeTeam: { id: 'KC', name: 'KC', abbreviation: 'KC' },
      awayTeam: { id: 'BUF', name: 'BUF', abbreviation: 'BUF' },
      scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
    });
  }

  it('succeeds before removal and is permission-denied immediately after, same token object', async () => {
    // No co-commissioner grant here on purpose: this test must exercise the
    // PARTICIPANT admission path, whose only evidence is the Member Record.
    // The commissioner path is measured by the hazard pair below.
    await seedPool({ coManagers: [] });
    await seedMember(OWNER);
    await seedMember(ALICE);
    await seedReciprocalIndexes(ALICE);
    await seedWeek();

    // 1. The token works while Alice is a member.
    const before = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: aliceStaleToken } as never);
    expect(before).toBeTruthy();

    // 2. Removal. Alice's client is not involved and no token is reissued.
    await db.runTransaction(async (tx) => { voidMemberRecord(tx, db, POOL, ALICE); });

    // 3. THE NEXT REQUEST, on the SAME token object, with no delay, no refresh
    //    and no revocation call anywhere in the system. There is no window.
    await expect(wGetPicks({ data: { poolId: POOL, week: 1 }, auth: aliceStaleToken } as never))
      .rejects.toThrow(/members can read/i);
  });

  /**
   * 🛑 THE PARTIAL STATE CLAIM (a) IMAGINES, AND WHY THE ONE TRANSACTION MATTERS.
   *
   * Suppose a removal deleted the Member Record but had not yet cleared
   * `coManagers`. `assertPickReader` tries `isPoolCommissioner` BEFORE it looks
   * for a Member Record (`nflPickReveal.ts`), and `isPoolCommissioner` honours
   * `coManagers` on an NFL pool (`poolOps.ts`) — so the departed member is
   * admitted, and admitted at the WIDER commissioner level: she sees departed
   * members' entries and the un-filtered roster.
   *
   * This is not a defect in `assertPickReader`; a co-commissioner is supposed to
   * read the pool's picks. It is the concrete cost of a non-atomic removal, and
   * it is the reason the two writes have to ride the same commit. The pair below
   * measures both halves: the hand-built partial state IS admitted, and the same
   * removal done through the helper is NOT.
   */
  it('a HAND-BUILT partial state (record deleted, coManagers grant left standing) is still admitted — the hazard', async () => {
    await seedPool();               // seedPool puts ALICE in coManagers
    await seedMember(OWNER);
    await seedMember(ALICE);
    await seedWeek();

    await db.collection('pools').doc(POOL).collection('members').doc(ALICE).delete();

    // Documented as the CURRENT, correct behaviour of a co-commissioner read —
    // and as the exact outcome the atomic helper makes unreachable.
    await expect(wGetPicks({ data: { poolId: POOL, week: 1 }, auth: aliceStaleToken } as never))
      .resolves.toBeTruthy();
  });

  it('the same removal through the helper is refused — the grant went in the SAME commit', async () => {
    await seedPool();               // ALICE IS a co-commissioner here
    await seedMember(OWNER);
    await seedMember(ALICE);
    await seedWeek();

    await db.runTransaction(async (tx) => { voidMemberRecord(tx, db, POOL, ALICE); });

    expect((await poolDoc())!.coManagers).toEqual([]);
    await expect(wGetPicks({ data: { poolId: POOL, week: 1 }, auth: aliceStaleToken } as never))
      .rejects.toThrow(/members can read/i);
  });

  it('denies only the removed member — a still-listed member on an equally old token is unaffected', async () => {
    await seedPool({ coManagers: [] });
    await seedMember(OWNER);
    await seedMember(ALICE);
    await seedMember(BOB);
    await seedWeek();

    const bobStaleToken = { uid: BOB, token: {} } as never;
    await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: bobStaleToken } as never);

    await db.runTransaction(async (tx) => { voidMemberRecord(tx, db, POOL, ALICE); });

    // The point of the pair: the denial is targeted at the removed uid, not a
    // side effect of the transaction touching the pool document. Bob's token is
    // exactly as old as Alice's and still works.
    await expect(wGetPicks({ data: { poolId: POOL, week: 1 }, auth: aliceStaleToken } as never))
      .rejects.toThrow(/members can read/i);
    await expect(wGetPicks({ data: { poolId: POOL, week: 1 }, auth: bobStaleToken } as never))
      .resolves.toBeTruthy();
  });
});
