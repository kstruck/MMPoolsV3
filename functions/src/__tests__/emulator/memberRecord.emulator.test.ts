import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { createNFLPool, joinNFLPool, executeSurvivorRebuy } from '../../nflPools';
import { setPaidStatus } from '../../setPaidStatus';
import { calculatePoolPot } from '../../statsTrigger';

// Verifies the additive Member Record wiring (ADR 0003) against a live Firestore
// emulator: create seeds the owner's record, join seeds the joiner's, and a survivor
// rebuy adds rebuy dues to the member's record. Existing entry/participantIds logic is
// unchanged (covered by poolCreation.emulator + the NFL unit suite).
const test = ftest();
const db = admin.firestore();
const wrappedCreateNFL = test.wrap(createNFLPool);
const wrappedJoin = test.wrap(joinNFLPool);
const wrappedRebuy = test.wrap(executeSurvivorRebuy);
const wrappedSetPaid = test.wrap(setPaidStatus);

async function seedUser(uid: string, name: string, role = 'PARTICIPANT') {
  await db.collection('users').doc(uid).set({ role, name, email: `${uid}@example.com` });
}

async function wipe() {
  const pools = await db.collection('pools').get();
  for (const p of pools.docs) {
    for (const sub of ['members', 'entries', 'participants', 'payments', 'rosterSummary']) {
      const s = await p.ref.collection(sub).get();
      await Promise.all(s.docs.map((d) => d.ref.delete()));
    }
    await p.ref.delete();
  }
  const users = await db.collection('users').get();
  for (const u of users.docs) {
    for (const sub of ['managedPools', 'participations', 'activity']) {
      const s = await u.ref.collection(sub).get();
      await Promise.all(s.docs.map((d) => d.ref.delete()));
    }
    await u.ref.delete();
  }
}

beforeEach(wipe);
afterAll(() => test.cleanup());

describe('Member Record wiring (emulator)', () => {
  it('createNFLPool seeds the owner Member Record (MANAGER, UNPAID)', async () => {
    await seedUser('owner1', 'Owner One', 'MEMBER');
    const res = (await wrappedCreateNFL({
      data: { type: 'NFL_PICKEM', name: 'Weekly', season: '2025', settings: { entryFee: 20, isListedPublic: true, payouts: { places: [], bonuses: [] } } },
      auth: { uid: 'owner1', token: { name: 'Owner One' } },
    } as never)) as { poolId: string };

    const m = (await db.collection('pools').doc(res.poolId).collection('members').doc('owner1').get()).data() as Record<string, any>;
    expect(m).toBeTruthy();
    expect(m.role).toBe('MANAGER');
    expect(m.paidStatus).toBe('UNPAID');
    expect(m.userName).toBe('Owner One');
  });

  it('persists season as a STRING even when the payload sends a number', async () => {
    // The create envelope is permissive (ADR-0001) and passes the payload
    // through, so a numeric season used to be stored as-is. nfl_games.season is
    // written as a string and Firestore equality is type-sensitive, so such a
    // pool matched NO games anywhere: pick submission threw NOT_FOUND, manual
    // scoring found no slate, and the scheduled scorer's candidate query never
    // returned it. Coerced once at creation rather than tolerated per query.
    await seedUser('numseason', 'Num Season', 'MEMBER');
    const res = (await wrappedCreateNFL({
      data: { type: 'NFL_PICKEM', name: 'Numeric', season: 2026, settings: { entryFee: 0, payouts: { places: [], bonuses: [] } } },
      auth: { uid: 'numseason', token: { name: 'Num Season' } },
    } as never)) as { poolId: string };

    const pool = (await db.collection('pools').doc(res.poolId).get()).data()!;
    expect(pool.season).toBe('2026');
    expect(typeof pool.season).toBe('string');
  });

  it('joinNFLPool seeds the joiner Member Record', async () => {
    await seedUser('owner2', 'Owner Two', 'MEMBER');
    await seedUser('joiner2', 'Joiner Two');
    const res = (await wrappedCreateNFL({
      data: { type: 'NFL_PICKEM', name: 'Weekly2', season: '2025', settings: { entryFee: 10, isListedPublic: true, payouts: { places: [], bonuses: [] } } },
      auth: { uid: 'owner2', token: { name: 'Owner Two' } },
    } as never)) as { poolId: string };

    await wrappedJoin({ data: { poolId: res.poolId }, auth: { uid: 'joiner2', token: { name: 'Joiner Two' } } } as never);

    const m = (await db.collection('pools').doc(res.poolId).collection('members').doc('joiner2').get()).data() as Record<string, any>;
    expect(m).toBeTruthy();
    expect(m.role).toBe('PARTICIPANT');
    expect(m.paidStatus).toBe('UNPAID');
    expect(m.userName).toBe('Joiner Two');
  });

  it('executeSurvivorRebuy adds rebuy dues to the Member Record', async () => {
    await seedUser('sp_owner', 'SP Owner');
    await seedUser('sp_player', 'SP Player');
    const poolId = 'survivor_pool_1';
    await db.collection('pools').doc(poolId).set({
      id: poolId, type: 'NFL_SURVIVOR', name: 'Survivor', ownerId: 'sp_owner', managerUid: 'sp_owner',
      participantIds: ['sp_owner', 'sp_player'], status: 'OPEN',
      settings: { entryFee: 25, rebuyCost: 15, maxRebuys: 2, rebuyDeadlineWeek: 6 },
    });
    await db.collection('pools').doc(poolId).collection('members').doc('sp_player').set({
      uid: 'sp_player', poolId, userName: 'SP Player', role: 'PARTICIPANT', paidStatus: 'UNPAID', joinedAt: Date.now(),
    });
    await db.collection('pools').doc(poolId).collection('entries').doc('sp_player').set({
      id: 'sp_player', poolId, ownerUid: 'sp_player', userName: 'SP Player', status: 'ELIMINATED',
      strikesUsed: 1, strikeWeeks: [1], rebuysUsed: 0, usedTeams: [], picks: {}, exemptWeeks: [], submittedAt: Date.now(), paidStatus: 'UNPAID',
    });

    await wrappedRebuy({ data: { poolId, week: 3 }, auth: { uid: 'sp_player', token: { name: 'SP Player' } } } as never);

    const m = (await db.collection('pools').doc(poolId).collection('members').doc('sp_player').get()).data() as Record<string, any>;
    expect(m.rebuyOwed).toBe(15);
  });
});

/**
 * PLAN-PAYMENT-TRUTH P1 (D13): setPaidStatus carries the payment detail fields
 * and mirrors the display projection onto the entry doc IN THE SAME TRANSACTION,
 * so the Bento panel can call it instead of the display-only updateEntryPayment.
 *
 * The full plan §2 test plan, through the real callable: the Member Record
 * flips, the payments ledger gains exactly one row, rosterSummary.paidCount
 * moves, and calculatePoolPot now counts the member — everything the old Bento
 * wiring silently failed to do.
 */
describe('setPaidStatus — detail fields + entry mirror (P1)', () => {
  const poolId = 'p1_pool';
  const BOSS = { uid: 'p1_boss', token: {} };

  async function seedP1Pool() {
    await db.collection('pools').doc(poolId).set({
      id: poolId, type: 'NFL_PICKEM', name: 'P1 Pool', ownerId: 'p1_boss',
      participantIds: ['p1_boss', 'p1_m1', 'p1_m2'], status: 'OPEN',
      settings: { entryFee: 25 },
    });
    await db.collection('pools').doc(poolId).collection('members').doc('p1_m1').set({
      uid: 'p1_m1', poolId, userName: 'Member One', role: 'PARTICIPANT', paidStatus: 'UNPAID', joinedAt: Date.now(),
    });
    // m2 is on the roster but has NO entry doc (joined, never picked).
    await db.collection('pools').doc(poolId).collection('members').doc('p1_m2').set({
      uid: 'p1_m2', poolId, userName: 'Member Two', role: 'PARTICIPANT', paidStatus: 'UNPAID', joinedAt: Date.now(),
    });
    // NFL entry docs are keyed by uid; starts UNPAID like production.
    await db.collection('pools').doc(poolId).collection('entries').doc('p1_m1').set({
      id: 'p1_m1', poolId, ownerUid: 'p1_m1', userName: 'Member One', picks: {}, paidStatus: 'UNPAID',
    });
  }

  it('marks paid with details: Member Record truth + entry mirror + one ledger row + projections + pot', async () => {
    await seedP1Pool();
    const backdated = 1_750_000_000_000;
    // 'Zelle' on purpose: the Bento select offers it and the OLD path's enum
    // rejected it — the detailed save was broken for that method entirely.
    await wrappedSetPaid({
      data: { poolId, memberUid: 'p1_m1', isPaid: true, paymentMethod: 'Zelle', paidAt: backdated, paymentNote: 'txn 123' },
      auth: BOSS,
    } as never);

    // Member Record — the authoritative store.
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p1_m1').get()).data() as Record<string, any>;
    expect(m.paidStatus).toBe('PAID');
    expect(m.paidAt).toBe(backdated);
    expect(m.paidBy).toBe('p1_boss');
    expect(m.paymentMethod).toBe('Zelle');
    expect(m.paymentNote).toBe('txn 123');

    // Entry doc — the display mirror the Bento table reads.
    const e = (await db.collection('pools').doc(poolId).collection('entries').doc('p1_m1').get()).data() as Record<string, any>;
    expect(e.paidStatus).toBe('PAID');
    expect(e.paymentMethod).toBe('Zelle');
    expect(e.paidAt).toBe(backdated);
    expect(e.paymentNote).toBe('txn 123');

    // Exactly one ledger row, carrying the dispute-prevention detail.
    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.size).toBe(1);
    const row = ledger.docs[0].data();
    expect(row.type).toBe('MARKED_PAID');
    expect(row.uid).toBe('p1_m1');
    expect(row.amount).toBe(25);
    expect(row.paymentMethod).toBe('Zelle');
    expect(row.paymentNote).toBe('txn 123');

    // rosterSummary.paidCount moved.
    const summary = (await db.collection('pools').doc(poolId).collection('rosterSummary').doc('current').get()).data() as Record<string, any>;
    expect(summary.paidCount).toBe(1);

    // ...and the pot now includes the member (the figure the whole plan exists for).
    const pool = (await db.collection('pools').doc(poolId).get()).data() as Record<string, any>;
    const { prizePot } = await calculatePoolPot(db, poolId, pool);
    expect(prizePot).toBe(25);
  });

  it('marking UNPAID clears through both stores with updateEntryPayment parity', async () => {
    await seedP1Pool();
    await wrappedSetPaid({
      data: { poolId, memberUid: 'p1_m1', isPaid: true, paymentMethod: 'Cash', paidAt: 1_750_000_000_000, paymentNote: 'x' },
      auth: BOSS,
    } as never);
    // The Bento toggle sends NO details on the way back down.
    await wrappedSetPaid({ data: { poolId, memberUid: 'p1_m1', isPaid: false }, auth: BOSS } as never);

    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p1_m1').get()).data() as Record<string, any>;
    expect(m.paidStatus).toBe('UNPAID');
    expect(m.paidAt).toBeUndefined();

    const e = (await db.collection('pools').doc(poolId).collection('entries').doc('p1_m1').get()).data() as Record<string, any>;
    expect(e.paidStatus).toBe('UNPAID');
    // Parity with updateEntryPayment: a detail-less write clears the method.
    expect(e.paymentMethod).toBeUndefined();

    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.size).toBe(2); // MARKED_PAID + MARKED_UNPAID — the audit trail keeps both

    const pool = (await db.collection('pools').doc(poolId).get()).data() as Record<string, any>;
    const { prizePot } = await calculatePoolPot(db, poolId, pool);
    expect(prizePot).toBe(0);
  });

  it('a member WITHOUT an entry doc can still be marked paid, and no entry doc appears', async () => {
    await seedP1Pool();
    await wrappedSetPaid({
      data: { poolId, memberUid: 'p1_m2', isPaid: true, paymentMethod: 'Cash' },
      auth: BOSS,
    } as never);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p1_m2').get()).data() as Record<string, any>;
    expect(m.paidStatus).toBe('PAID');
    // The mirror is conditional on an existing entry — it must not conjure one.
    const e = await db.collection('pools').doc(poolId).collection('entries').doc('p1_m2').get();
    expect(e.exists).toBe(false);
  });

  it('REJECTS payment details on a member self-report claim', async () => {
    await seedP1Pool();
    await expect(wrappedSetPaid({
      data: { poolId, memberUid: 'p1_m1', claim: true, paymentMethod: 'Cash' },
      auth: { uid: 'p1_m1', token: {} },
    } as never)).rejects.toThrow(/payment details/i);
    // And the plain claim still works exactly as before.
    await wrappedSetPaid({
      data: { poolId, memberUid: 'p1_m1', claim: true },
      auth: { uid: 'p1_m1', token: {} },
    } as never);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p1_m1').get()).data() as Record<string, any>;
    expect(m.memberReportedPaid).toBe(true);
    expect(m.paidStatus).toBe('UNPAID'); // a claim never touches the authoritative field
  });
});
