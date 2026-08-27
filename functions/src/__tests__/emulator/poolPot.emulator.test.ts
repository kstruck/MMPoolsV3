import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { calculatePoolPot, recomputeGlobalStats } from '../../statsTrigger';
import { finalizeTournamentPayouts } from '../../bracketScoring';

/**
 * calculatePoolPot against a live Firestore emulator (PLAN-STATS-INTEGRITY §8.3
 * step 1). An emulator suite rather than a unit suite on purpose: every branch
 * this PR adds is defined by WHICH SUBCOLLECTION it reads, and a hand-rolled
 * Firestore mock would let a wrong collection name pass.
 *
 * The bug being fixed: NFL_PICKEM / NFL_SURVIVOR / NFL_MARGIN and PROPS all fell
 * through to the squares branch, and none of them has a `squares` array or a
 * `costPerSquare` — so each computed a pot of exactly ZERO, into the
 * world-readable `stats/global`. Every NFL/Props assertion below therefore
 * asserts a NON-zero figure: revert the routing and it returns 0 and fails.
 */

const db = admin.firestore();

async function wipe() {
  const pools = await db.collection('pools').get();
  for (const p of pools.docs) {
    for (const sub of ['members', 'propCards', 'entries', 'playoff_entries']) {
      const s = await p.ref.collection(sub).get();
      await Promise.all(s.docs.map((d) => d.ref.delete()));
    }
    await p.ref.delete();
  }
  // The recompute suite below writes this; leaving it behind would let one test's
  // total satisfy the next test's assertion.
  await db.doc('stats/global').delete();
}

/** Member Record fields the dues maths actually reads (shared/memberRecord.ts). */
async function member(
  poolId: string,
  uid: string,
  fields: { paidStatus: 'PAID' | 'UNPAID'; feeOwed?: number; rebuyOwed?: number; rebuyPaid?: number; role?: string; unitsOwned?: number; unitsPaid?: number },
) {
  await db.collection('pools').doc(poolId).collection('members').doc(uid).set({
    uid, poolId, userName: uid, ...fields,
  });
}

beforeEach(wipe);

describe('calculatePoolPot — NFL season pools read Member Records (§2.8)', () => {
  it('counts PAID members only, at the pool entry fee', async () => {
    const pool = { type: 'NFL_PICKEM', settings: { entryFee: 25 } };
    await db.collection('pools').doc('p1').set(pool);
    await member('p1', 'a', { paidStatus: 'PAID' });
    await member('p1', 'b', { paidStatus: 'PAID' });
    await member('p1', 'c', { paidStatus: 'UNPAID' });

    const { prizePot } = await calculatePoolPot(db, 'p1', pool);
    // 2 x 25. The squares branch this used to fall through to returns 0.
    expect(prizePot).toBe(50);
  });

  it('does NOT read entry docs, which stay UNPAID forever — the §2.8 trap', async () => {
    // An NFL pool whose entries all say UNPAID but whose Member Records say PAID
    // is the NORMAL state: setPaidStatus writes the member record and nothing
    // updates the entry. Reading entries here would report a paid pool as $0.
    const pool = { type: 'NFL_SURVIVOR', settings: { entryFee: 40 } };
    await db.collection('pools').doc('p2').set(pool);
    await db.collection('pools').doc('p2').collection('entries').doc('a').set({ ownerUid: 'a', paidStatus: 'UNPAID' });
    await db.collection('pools').doc('p2').collection('entries').doc('b').set({ ownerUid: 'b', paidStatus: 'UNPAID' });
    await member('p2', 'a', { paidStatus: 'PAID' });
    await member('p2', 'b', { paidStatus: 'PAID' });

    const { prizePot } = await calculatePoolPot(db, 'p2', pool);
    expect(prizePot).toBe(80);
  });

  it('adds rebuy money when rebuyPaid is set — but SEE THE NEXT TEST, nothing sets it', async () => {
    const pool = { type: 'NFL_SURVIVOR', settings: { entryFee: 20 } };
    await db.collection('pools').doc('p3').set(pool);
    await member('p3', 'a', { paidStatus: 'PAID', rebuyOwed: 20, rebuyPaid: 20 });
    // Owes a rebuy, has not paid it: the dues are owed, the pot is not funded.
    await member('p3', 'b', { paidStatus: 'PAID', rebuyOwed: 20, rebuyPaid: 0 });

    const { prizePot } = await calculatePoolPot(db, 'p3', pool);
    expect(prizePot).toBe(20 + 20 + 20);
  });

  it('OPEN DEFECT: a real Survivor rebuy contributes NOTHING, because rebuyPaid is never written', async () => {
    // Found by codex r2 on this PR and verified before accepting:
    // executeSurvivorRebuyInternal (nflPools.ts:758,763) increments `rebuyOwed`
    // ONLY, setPaidStatus touches only the base `paidStatus`, and a grep across
    // functions/src and src/ finds NO writer of `rebuyPaid` anywhere. So
    // memberDues's `collected += rebuyPaid` is always +0 in production and every
    // rebuy dollar is missing from the pot.
    //
    // NOT fixed here, deliberately. `memberDues` is the SHARED dues helper that
    // also backs the commissioner roster (lib/rosterSummary.ts), so redefining
    // "collected" moves a second money surface at the same time. And the honest
    // options — add a rebuy-paid control, or treat paidStatus PAID as covering
    // rebuyOwed — are a product decision, not a refactor. Its own PR.
    //
    // Pinned so the gap is a recorded decision rather than a surprise, and so
    // whoever fixes it has a test that flips.
    const pool = { type: 'NFL_SURVIVOR', settings: { entryFee: 20 } };
    await db.collection('pools').doc('p7').set(pool);
    // Exactly the shape production produces: rebuyOwed from the rebuy path,
    // paidStatus PAID from the commissioner, rebuyPaid absent.
    await member('p7', 'a', { paidStatus: 'PAID', rebuyOwed: 20 });

    const { prizePot } = await calculatePoolPot(db, 'p7', pool);
    expect(prizePot).toBe(20); // base fee only — the $20 rebuy is invisible
  });

  it('OPEN FINDING (PLAN-MULTI-ENTRY-DUES §7): a PARTIALLY paid member funds the pot with ZERO', async () => {
    // Found by the P2-T7 sweep, and NEW to Phase 2 — before it, a partial
    // payment was not representable at all. One checkbox meant $0 or the whole
    // amount, and `memberDues` was right in both cases.
    //
    // Per-entry dues made the middle reachable: the commissioner can mark entry
    // 1 paid and leave entry 2 unpaid. `derivePaidStatus` then correctly returns
    // UNPAID — the member is not paid IN FULL — but `memberDues`
    // (shared/memberRecord.ts:487) is all-or-nothing:
    //
    //     if (m.paidStatus === 'PAID') collected += fee;
    //
    // so the $25 that WAS collected counts as $0, in a world-readable figure.
    // `src/utils/poolRoster.ts:387,432` have the same shape and show the member
    // owing their full dues rather than the remainder.
    //
    // Direction is an UNDER-count: the published pot reads low, nobody is
    // over-charged, no payout is inflated. Same failure direction as the
    // rebuyPaid gap above.
    //
    // NOT fixed here, deliberately, for the same reason that one is not: the
    // honest figure needs a per-entry-aware number, and the per-entry map is
    // SEALED by D1 (`private/dues__{uid}`, `allow read: if false`), while
    // `memberDues` lives in shared/ and runs on the client too. Every option —
    // mirror a `paidEntryCount` onto the participant-readable Member Record,
    // teach only the Admin-SDK pot to read the sealed map, or accept the
    // under-count — changes a money figure. That is a Rule 3 plan decision, not
    // a sweep. §7 of PLAN-MULTI-ENTRY-DUES-SWEEPS.md carries the three options.
    //
    // Pinned so the gap is a recorded decision rather than a surprise, and so
    // whoever fixes it has a test that flips.
    const pool = { type: 'NFL_PICKEM', settings: { entryFee: 25 } };
    await db.collection('pools').doc('p8').set(pool);
    // Exactly the shape production produces: two liable entries, `feeOwed`
    // already the multiplied figure (D2), entry 1 paid and entry 2 not, so the
    // derived summary is UNPAID.
    await member('p8', 'partial', { paidStatus: 'UNPAID', feeOwed: 50 });
    // Control in the same pool, so the assertion cannot pass by reading zero
    // members: this one IS paid in full and contributes all of it.
    await member('p8', 'full', { paidStatus: 'PAID', feeOwed: 50 });

    const { prizePot } = await calculatePoolPot(db, 'p8', pool);
    expect(prizePot).toBe(50); // 50 from `full`, and 0 — not 25 — from `partial`
  });

  it('honours the per-record feeOwed stamp — a seeded owner who never played owes 0', async () => {
    // ADR 0005: hosting is not playing. Without the feeOwed stamp this would
    // silently invent an extra entry fee per pool across the whole platform.
    const pool = { type: 'NFL_MARGIN', settings: { entryFee: 30 } };
    await db.collection('pools').doc('p4').set(pool);
    await member('p4', 'host', { paidStatus: 'PAID', role: 'MANAGER', feeOwed: 0 });
    await member('p4', 'player', { paidStatus: 'PAID', feeOwed: 30 });

    const { prizePot } = await calculatePoolPot(db, 'p4', pool);
    expect(prizePot).toBe(30);
  });

  it('splits charity out of the new NFL branch, not just the old ones', async () => {
    const pool = { type: 'NFL_PICKEM', settings: { entryFee: 100, charity: { enabled: true, percentage: 10 } } };
    await db.collection('pools').doc('p5').set(pool);
    await member('p5', 'a', { paidStatus: 'PAID' });

    const { prizePot, charityAmount } = await calculatePoolPot(db, 'p5', pool);
    expect(charityAmount).toBe(10);
    expect(prizePot).toBe(90);
  });

  it('reports zero for a pool with no Member Records — states the migration dependency', async () => {
    // Not a defect, a documented dependency: a pool whose members predate the
    // Member Record wiring contributes nothing until backfillMemberRecords runs.
    // Pinned so the behaviour is a decision on record rather than a surprise.
    const pool = { type: 'NFL_PICKEM', settings: { entryFee: 25 } };
    await db.collection('pools').doc('p6').set(pool);
    const { prizePot } = await calculatePoolPot(db, 'p6', pool);
    expect(prizePot).toBe(0);
  });
});

describe('calculatePoolPot — PROPS pools read propCards (codex R3 finding (j))', () => {
  it('counts EVERY card at props.cost — isPaid is not a real field on this path', async () => {
    // The asymmetry with BRACKET/NFL is the point. codex r1 on this PR found that
    // nothing writes `isPaid`: purchasePropCard omits it, no UI sets it, and
    // firestore.rules allows propCards writes to SUPER_ADMIN only. Filtering on it
    // published ZERO for every real Props pool. Card count is also what
    // PoolStatistics.tsx and the SuperAdmin Overview already call the props pot.
    const pool = { type: 'PROPS', props: { cost: 15 } };
    await db.collection('pools').doc('q1').set(pool);
    const cards = db.collection('pools').doc('q1').collection('propCards');
    await cards.doc('c1').set({ userId: 'a' });
    await cards.doc('c2').set({ userId: 'b' });
    await cards.doc('c3').set({ userId: 'c' });

    const { prizePot } = await calculatePoolPot(db, 'q1', pool);
    expect(prizePot).toBe(45);
  });

  it('a card carrying isPaid still counts once — the flag is inert, not a filter', async () => {
    const pool = { type: 'PROPS', props: { cost: 10 } };
    await db.collection('pools').doc('q3').set(pool);
    const cards = db.collection('pools').doc('q3').collection('propCards');
    await cards.doc('c1').set({ userId: 'a', isPaid: true });
    await cards.doc('c2').set({ userId: 'b', isPaid: false });

    const { prizePot } = await calculatePoolPot(db, 'q3', pool);
    expect(prizePot).toBe(20);
  });

  it('a Props pool with no cost contributes nothing and reads no cards', async () => {
    const pool = { type: 'PROPS', props: {} };
    await db.collection('pools').doc('q2').set(pool);
    await db.collection('pools').doc('q2').collection('propCards').doc('c1').set({ userId: 'a', isPaid: true });
    const { prizePot } = await calculatePoolPot(db, 'q2', pool);
    expect(prizePot).toBe(0);
  });
});

/**
 * The recompute's SELECTION rule (PLAN-STATS-INTEGRITY §2.7, Kevin's Q5).
 *
 * `recalculateGlobalStats` queried `isLocked == true` alone, and NFL season pools
 * are created `isLocked: false` (`nflPools.ts:100`) — they lock per week at
 * kickoff and finalize by stamping `finalizedAt`. So the recompute had never once
 * visited an NFL pool: PR B taught calculatePoolPot to price them, and without
 * this it would never be asked.
 */
describe('recomputeGlobalStats — selection', () => {
  async function statsGlobal() {
    return (await db.doc('stats/global').get()).data() ?? {};
  }

  it('visits an UNLOCKED NFL pool that has scored a week — the §2.7 defect', async () => {
    const pool = { type: 'NFL_PICKEM', isLocked: false, scoredThroughWeek: 3, settings: { entryFee: 25 } };
    await db.collection('pools').doc('n1').set(pool);
    await member('n1', 'a', { paidStatus: 'PAID' });
    await member('n1', 'b', { paidStatus: 'PAID' });

    const r = await recomputeGlobalStats(db, { dryRun: true });
    expect(r.pools).toBe(1);
    expect(r.totalPrizes).toBe(50);
  });

  it('ignores an NFL pool that has never scored a week', async () => {
    // scoredThroughWeek 0, and Firestore inequality filters also drop documents
    // missing the field entirely — both cases are "no real volume yet".
    await db.collection('pools').doc('n2').set({ type: 'NFL_PICKEM', isLocked: false, scoredThroughWeek: 0, settings: { entryFee: 25 } });
    await member('n2', 'a', { paidStatus: 'PAID' });
    await db.collection('pools').doc('n3').set({ type: 'NFL_PICKEM', isLocked: false, settings: { entryFee: 25 } });
    await member('n3', 'a', { paidStatus: 'PAID' });

    const r = await recomputeGlobalStats(db, { dryRun: true });
    expect(r.pools).toBe(0);
    expect(r.totalPrizes).toBe(0);
  });

  it('still visits locked non-NFL pools, and counts a pool in BOTH sets exactly once', async () => {
    await db.collection('pools').doc('s2').set({
      type: 'SQUARES', isLocked: true, costPerSquare: 10,
      squares: [{ id: 0, owner: 'a' }, { id: 1, owner: 'b' }],
    });
    // Satisfies both queries — the dedupe by document id is what stops this
    // pool's money being added to the public totals twice.
    await db.collection('pools').doc('n4').set({ type: 'NFL_MARGIN', isLocked: true, scoredThroughWeek: 2, settings: { entryFee: 30 } });
    await member('n4', 'a', { paidStatus: 'PAID' });

    const r = await recomputeGlobalStats(db, { dryRun: true });
    expect(r.pools).toBe(2);
    expect(r.totalPrizes).toBe(20 + 30);
  });

  it('skips a CANCELED NFL pool that had already scored a week (codex r1)', async () => {
    // cancelPool leaves scoredThroughWeek and the paid Member Records intact, so
    // the new scored-week query ADMITS a canceled pool that the old isLocked-only
    // selector never reached. Its contest is void; its money is not prize volume.
    await db.collection('pools').doc('n5').set({
      type: 'NFL_PICKEM', isLocked: false, scoredThroughWeek: 4, status: 'CANCELED',
      settings: { entryFee: 50 },
    });
    await member('n5', 'a', { paidStatus: 'PAID' });

    const r = await recomputeGlobalStats(db, { dryRun: true });
    expect(r.pools).toBe(0);
    expect(r.totalPrizes).toBe(0);
  });

  it('a COMPLETED pool still counts — only CANCELED is excluded', async () => {
    // Guards the over-correction: excluding finished pools would delete real
    // history from the public totals, which is the opposite failure.
    await db.collection('pools').doc('n6').set({
      type: 'NFL_PICKEM', isLocked: false, scoredThroughWeek: 18, status: 'COMPLETED',
      settings: { entryFee: 50 },
    });
    await member('n6', 'a', { paidStatus: 'PAID' });

    const r = await recomputeGlobalStats(db, { dryRun: true });
    expect(r.pools).toBe(1);
    expect(r.totalPrizes).toBe(50);
  });

  it('refuses to PUBLISH a partial total when a pool could not be priced (codex r1)', async () => {
    // stats/global is world-readable and this write is an absolute overwrite, so
    // publishing an undercount replaces a correct figure with a smaller wrong one
    // and leaves it there. Stale beats wrong on a public number.
    await db.doc('stats/global').set({ totalPrizes: 500, totalDonated: 50 });
    await db.collection('pools').doc('s6').set({
      type: 'SQUARES', isLocked: true, costPerSquare: 10, squares: [{ id: 0, owner: 'a' }],
    });
    // Reaches calculatePoolPot's pre-existing NaN guard: gross = 1 x Infinity,
    // charity = 100% of Infinity, prizePot = Infinity - Infinity = NaN. Contrived
    // on purpose — a real NaN comes from corrupt stored data, which is exactly
    // what that guard is there for. `costPerSquare: NaN` does NOT work, because
    // `NaN || 0` is 0 and the pot comes out a clean zero.
    await db.collection('pools').doc('s7').set({
      type: 'SQUARES', isLocked: true, costPerSquare: Number.POSITIVE_INFINITY,
      squares: [{ id: 0, owner: 'b' }],
      charity: { enabled: true, percentage: 100 },
    });

    const r = await recomputeGlobalStats(db, { dryRun: false });
    expect(r.errors).toBe(1);
    expect(r.published).toBe(false);
    expect((await statsGlobal()).totalPrizes).toBe(500); // previous value kept
  });

  it('excludes every arm of isTestPool from the public totals (PR D)', async () => {
    // One real pool and one of each discriminator arm. The real pool is the
    // control: without it a broken filter that excluded EVERYTHING would pass.
    await db.collection('pools').doc('real').set({
      type: 'SQUARES', isLocked: true, costPerSquare: 10, squares: [{ id: 0, owner: 'a' }],
    });
    // arm 1a — persisted simRunId
    await db.collection('pools').doc('t1').set({
      type: 'SQUARES', isLocked: true, costPerSquare: 10, simRunId: 'run-abc1',
      squares: [{ id: 0, owner: 'a' }],
    });
    // arm 1b — sim- season
    await db.collection('pools').doc('t2').set({
      type: 'SQUARES', isLocked: true, costPerSquare: 10, season: 'sim-run-abc1',
      squares: [{ id: 0, owner: 'a' }],
    });
    // arm 1c — sim- doc id
    await db.collection('pools').doc('sim-legacy').set({
      type: 'SQUARES', isLocked: true, costPerSquare: 10, squares: [{ id: 0, owner: 'a' }],
    });
    // arm 2 — NFL preseason. Kevin: preseason pools NEVER count, including
    // friends' pools. Expect the Overview to look quiet through the pilot.
    await db.collection('pools').doc('t4').set({
      type: 'NFL_PICKEM', isLocked: false, scoredThroughWeek: 1, seasonType: 1,
      settings: { entryFee: 25 },
    });
    await member('t4', 'a', { paidStatus: 'PAID' });
    // arm 3 — the explicit flag Kevin sets on legacy untagged test pools
    await db.collection('pools').doc('t5').set({
      type: 'SQUARES', isLocked: true, costPerSquare: 10, isTestPool: true,
      squares: [{ id: 0, owner: 'a' }],
    });

    const r = await recomputeGlobalStats(db, { dryRun: true });
    expect(r.pools).toBe(1);
    expect(r.totalPrizes).toBe(10);
    expect(r.testPoolsSkipped).toBe(5);
  });

  it('a REGULAR-season NFL pool is not caught by the preseason arm', async () => {
    // The over-correction guard: seasonType 2 must still count, or the fix that
    // removes test pools also removes the season the pilot exists to prepare for.
    await db.collection('pools').doc('t6').set({
      type: 'NFL_PICKEM', isLocked: false, scoredThroughWeek: 1, seasonType: 2,
      settings: { entryFee: 25 },
    });
    await member('t6', 'a', { paidStatus: 'PAID' });

    const r = await recomputeGlobalStats(db, { dryRun: true });
    expect(r.pools).toBe(1);
    expect(r.totalPrizes).toBe(25);
    expect(r.testPoolsSkipped).toBe(0);
  });

  it('skips admin-closed pools (T2), which are locked for lifecycle reasons only', async () => {
    await db.collection('pools').doc('s3').set({
      type: 'SQUARES', isLocked: true, costPerSquare: 10, closedVia: 'ADMIN_CLOSE',
      squares: [{ id: 0, owner: 'a' }],
    });
    const r = await recomputeGlobalStats(db, { dryRun: true });
    expect(r.pools).toBe(0);
  });

  it('dryRun writes NOTHING to the world-readable stats/global', async () => {
    await db.doc('stats/global').set({ totalPrizes: 999, totalDonated: 111 });
    await db.collection('pools').doc('s4').set({
      type: 'SQUARES', isLocked: true, costPerSquare: 10, squares: [{ id: 0, owner: 'a' }],
    });

    const dry = await recomputeGlobalStats(db, { dryRun: true });
    expect(dry.totalPrizes).toBe(10);
    expect(dry.dryRun).toBe(true);
    // Untouched — the whole point of the gate's report-only mode.
    expect((await statsGlobal()).totalPrizes).toBe(999);

    await recomputeGlobalStats(db, { dryRun: false });
    expect((await statsGlobal()).totalPrizes).toBe(10);
  });

  it('is idempotent — it writes ABSOLUTE totals, never increments', async () => {
    // This is what makes running it on a schedule safe, and it is the property
    // the 2026-07-18 migration audit called the pattern to copy.
    await db.collection('pools').doc('s5').set({
      type: 'SQUARES', isLocked: true, costPerSquare: 10, squares: [{ id: 0, owner: 'a' }, { id: 1, owner: 'b' }],
    });
    await recomputeGlobalStats(db, { dryRun: false });
    await recomputeGlobalStats(db, { dryRun: false });
    await recomputeGlobalStats(db, { dryRun: false });
    expect((await statsGlobal()).totalPrizes).toBe(20);
  });
});

describe('calculatePoolPot — the existing branches are untouched', () => {
  it('SQUARES still uses squares x costPerSquare', async () => {
    const pool = {
      type: 'SQUARES',
      costPerSquare: 10,
      squares: [{ id: 0, owner: 'a' }, { id: 1, owner: 'b' }, { id: 2, owner: null }],
    };
    await db.collection('pools').doc('s1').set(pool);
    const { prizePot } = await calculatePoolPot(db, 's1', pool);
    expect(prizePot).toBe(20);
  });

  it('NFL_PLAYOFFS prices the pool.entries MAP, not a subcollection nobody writes', async () => {
    // `playoff_entries` appeared exactly ONCE in the repository — in the line this
    // replaced. Playoff entries live in the pool document's `entries` map and the
    // paid flag is `entries.{id}.paid` (playoffPools.ts togglePaid). So every real
    // playoff pool has been contributing $0 to the world-readable prize total for
    // as long as calculatePoolPot has existed. Found by codex r1 on PR D.
    const pool = {
      type: 'NFL_PLAYOFFS',
      settings: { entryFee: 20 },
      entries: {
        e1: { userId: 'a', paid: true },
        e2: { userId: 'b', paid: true },
        e3: { userId: 'c' },              // unpaid
        e4: { userId: 'd', paid: false }, // explicitly unpaid
      },
    };
    await db.collection('pools').doc('pl1').set(pool);
    // Seeded to prove the OLD source is empty and would still return 0.
    const { prizePot } = await calculatePoolPot(db, 'pl1', pool);
    expect(prizePot).toBe(40);
  });

  it('NFL_PLAYOFFS also accepts paidStatus PAID, matching the BRACKET reader', async () => {
    const pool = { type: 'NFL_PLAYOFFS', settings: { entryFee: 15 }, entries: { e1: { paidStatus: 'PAID' } } };
    await db.collection('pools').doc('pl2').set(pool);
    const { prizePot } = await calculatePoolPot(db, 'pl2', pool);
    expect(prizePot).toBe(15);
  });

  it('BRACKET still uses entry docs, which for that type ARE the payment truth', async () => {
    const pool = { type: 'BRACKET', settings: { entryFee: 12 } };
    await db.collection('pools').doc('b1').set(pool);
    const entries = db.collection('pools').doc('b1').collection('entries');
    await entries.doc('e1').set({ paidStatus: 'PAID' });
    await entries.doc('e2').set({ paid: true });
    await entries.doc('e3').set({ paidStatus: 'UNPAID' });
    const { prizePot } = await calculatePoolPot(db, 'b1', pool);
    expect(prizePot).toBe(24);
  });
});

/**
 * OPEN DEFECT, REPORT ONLY (Kevin 2026-07-26, MORNING-2026-07-26-OVERNIGHT §7):
 * `finalizeTournamentPayouts` sizes the pot from PAID entries
 * (functions/src/bracketScoring.ts:410-411) but ranks payouts over ALL entries
 * (:414-421) — so an UNPAID rank-1 entry is paid out of a pot it did not fund,
 * and the members who DID fund it get nothing.
 *
 * it.fails() pins the defect without fixing it: the body asserts the natural
 * product rule — an entry that did not fund the pot cannot win money from it —
 * which is exactly what does not hold today. Whichever way the fix goes
 * (exclude UNPAID entries from ranking, or size the pot over every ranked
 * entry), this flips to "expected failure passed"; promote it to a plain it()
 * pinning the chosen semantics then.
 */
describe('finalizeTournamentPayouts — unpaid winner paid from a pot they did not fund (bracketScoring.ts:410)', () => {
  const test = ftest();
  const wFinalizePayouts = test.wrap(finalizeTournamentPayouts);
  const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN' } };

  it.fails('an UNPAID rank-1 entry receives no payout', async () => {
    const tid = 'potdefect-t1';
    await db.collection('tournaments').doc(tid).set({ isFinalized: true, seasonYear: 2026 });
    await db.collection('pools').doc('potdefect-pool').set({
      name: 'Pot defect', type: 'BRACKET', tournamentId: tid, status: 'COMPLETED',
      // rank 1 wins 100% of the pot
      settings: { entryFee: 10, payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] } },
    });
    const entries = db.collection('pools').doc('potdefect-pool').collection('entries');
    // No ownerUid on purpose: keeps the post-finalization season-history and
    // recap steps from writing user docs this suite would have to clean up.
    await entries.doc('freeloader').set({ rank: 1, score: 30, paidStatus: 'UNPAID' });
    await entries.doc('funder-a').set({ rank: 2, score: 20, paidStatus: 'PAID' });
    await entries.doc('funder-b').set({ rank: 3, score: 10, paidStatus: 'PAID' });

    await wFinalizePayouts({ data: { tournamentId: tid }, auth: superAdmin } as never);

    // Cleanup BEFORE the assertion: in an it.fails() the assertion throwing is
    // the expected path, so anything after it would never run. (The pool and
    // its entries are wiped by the next test's beforeEach; the tournament doc
    // is the one thing wipe() does not touch.)
    await db.collection('tournaments').doc(tid).delete();

    // Pot today: 2 paid × $10 = $20 — and 100% of it lands on the UNPAID
    // rank-1 entry. DESIRED: no payout to an entry that put nothing in.
    const freeloader = (await entries.doc('freeloader').get()).data()!;
    expect(freeloader.amountWon ?? 0).toBe(0);
  }, 30000);
});
