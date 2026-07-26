import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { calculatePoolPot } from '../../statsTrigger';

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
