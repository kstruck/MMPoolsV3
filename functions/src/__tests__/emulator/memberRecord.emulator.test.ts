import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { createNFLPool, joinNFLPool, executeSurvivorRebuy } from '../../nflPools';
import { setPaidStatus } from '../../setPaidStatus';
import { reconcilePaymentTruth } from '../../migrations/reconcilePaymentTruth';
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
const wrappedReconcile = test.wrap(reconcilePaymentTruth);

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

    // Exactly one ledger row, carrying the dispute-prevention detail under
    // `note` — the field PaymentLedgerEvent/PaymentsPanel actually render.
    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.size).toBe(1);
    const row = ledger.docs[0].data();
    expect(row.type).toBe('MARKED_PAID');
    expect(row.uid).toBe('p1_m1');
    expect(row.amount).toBe(25);
    expect(row.note).toBe('Zelle — txn 123');

    // rosterSummary.paidCount moved.
    const summary = (await db.collection('pools').doc(poolId).collection('rosterSummary').doc('current').get()).data() as Record<string, any>;
    expect(summary.paidCount).toBe(1);

    // ...and the pot now includes the member (the figure the whole plan exists for).
    const pool = (await db.collection('pools').doc(poolId).get()).data() as Record<string, any>;
    const { prizePot } = await calculatePoolPot(db, poolId, pool);
    expect(prizePot).toBe(25);
  });

  it('marking UNPAID is a FULL clear through both stores (codex r2)', async () => {
    await seedP1Pool();
    await wrappedSetPaid({
      data: { poolId, memberUid: 'p1_m1', isPaid: true, paymentMethod: 'Cash', paidAt: 1_750_000_000_000, paymentNote: 'x' },
      auth: BOSS,
    } as never);
    // UNPAID sends no details (the schema refuses them) — and the server
    // clears the stale ones, so an unpaid member never displays a payment
    // method or a transaction note.
    await wrappedSetPaid({ data: { poolId, memberUid: 'p1_m1', isPaid: false }, auth: BOSS } as never);

    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p1_m1').get()).data() as Record<string, any>;
    expect(m.paidStatus).toBe('UNPAID');
    expect(m.paidAt).toBeUndefined();
    expect(m.paymentMethod).toBeUndefined();
    expect(m.paymentNote).toBeUndefined();

    const e = (await db.collection('pools').doc(poolId).collection('entries').doc('p1_m1').get()).data() as Record<string, any>;
    expect(e.paidStatus).toBe('UNPAID');
    expect(e.paymentMethod).toBeUndefined();
    // Entry-doc clears keep the old client write's literal-null convention.
    expect(e.paidAt).toBeNull();
    expect(e.paymentNote).toBeNull();

    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.size).toBe(2); // MARKED_PAID + MARKED_UNPAID — the audit trail keeps both

    const pool = (await db.collection('pools').doc(poolId).get()).data() as Record<string, any>;
    const { prizePot } = await calculatePoolPot(db, poolId, pool);
    expect(prizePot).toBe(0);
  });

  it('a metadata-only edit of a PAID row updates details WITHOUT another ledger event (codex r3)', async () => {
    await seedP1Pool();
    // Quick toggle: no details sent — the mirror still gets the RESOLVED
    // timestamp, so the panel's date column matches the authoritative record.
    const before = Date.now();
    await wrappedSetPaid({ data: { poolId, memberUid: 'p1_m1', isPaid: true }, auth: BOSS } as never);
    let e = (await db.collection('pools').doc(poolId).collection('entries').doc('p1_m1').get()).data() as Record<string, any>;
    expect(typeof e.paidAt).toBe('number');
    expect(e.paidAt).toBeGreaterThanOrEqual(before);

    // Editing method/note on the already-PAID row is not a payment-state
    // change — the details move, the ledger does not grow.
    await wrappedSetPaid({
      data: { poolId, memberUid: 'p1_m1', isPaid: true, paymentMethod: 'Cash', paymentNote: 'corrected' },
      auth: BOSS,
    } as never);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p1_m1').get()).data() as Record<string, any>;
    expect(m.paymentMethod).toBe('Cash');
    expect(m.paymentNote).toBe('corrected');
    e = (await db.collection('pools').doc(poolId).collection('entries').doc('p1_m1').get()).data() as Record<string, any>;
    expect(e.paymentMethod).toBe('Cash');
    expect(e.paymentNote).toBe('corrected');

    // Re-asserting PAID without a method preserves the stored one on BOTH
    // stores (codex r4 — the mirror used to delete what the member record kept).
    await wrappedSetPaid({ data: { poolId, memberUid: 'p1_m1', isPaid: true }, auth: BOSS } as never);
    expect(((await db.collection('pools').doc(poolId).collection('members').doc('p1_m1').get()).data() as Record<string, any>).paymentMethod).toBe('Cash');
    expect(((await db.collection('pools').doc(poolId).collection('entries').doc('p1_m1').get()).data() as Record<string, any>).paymentMethod).toBe('Cash');

    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.size).toBe(1); // the original MARKED_PAID transition only
  });

  it('isPaid true + paidAt null clears the date while staying PAID, in BOTH stores (codex r2)', async () => {
    await seedP1Pool();
    await wrappedSetPaid({
      data: { poolId, memberUid: 'p1_m1', isPaid: true, paidAt: 1_750_000_000_000 },
      auth: BOSS,
    } as never);
    await wrappedSetPaid({
      data: { poolId, memberUid: 'p1_m1', isPaid: true, paidAt: null },
      auth: BOSS,
    } as never);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p1_m1').get()).data() as Record<string, any>;
    expect(m.paidStatus).toBe('PAID');
    expect(m.paidAt).toBeUndefined(); // cleared, NOT re-stamped with Date.now()
    const e = (await db.collection('pools').doc(poolId).collection('entries').doc('p1_m1').get()).data() as Record<string, any>;
    expect(e.paidStatus).toBe('PAID');
    expect(e.paidAt).toBeNull();
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

/**
 * PLAN-PAYMENT-TRUTH P3 (Q2 = option B): the rebuy-paid control — the writer
 * `rebuyPaid` never had. A rebuy is dues OWED ("$X due to the commissioner",
 * SurvivorPickEntry copy), settled out of band and INDEPENDENTLY of base dues.
 * memberDues has always added rebuyPaid to `collected`, so this moves BOTH
 * money surfaces at once (the pot and the roster's duesCollected) — the plan
 * requires tests on both.
 */
describe('setPaidStatus settleRebuys — the rebuy-paid control (P3)', () => {
  const poolId = 'p3_pool';
  const BOSS = { uid: 'p3_boss', token: {} };

  async function seedRebuyPool() {
    await db.collection('pools').doc(poolId).set({
      id: poolId, type: 'NFL_SURVIVOR', name: 'P3 Pool', ownerId: 'p3_boss',
      participantIds: ['p3_boss', 'p3_m1'], status: 'OPEN', settings: { entryFee: 25, rebuyCost: 20 },
    });
    // Exactly the shape production produces: rebuyOwed from executeSurvivorRebuy,
    // base dues PAID from the commissioner, rebuyPaid absent.
    await db.collection('pools').doc(poolId).collection('members').doc('p3_m1').set({
      uid: 'p3_m1', poolId, userName: 'Rebuyer', role: 'PARTICIPANT', paidStatus: 'PAID', rebuyOwed: 20,
    });
  }

  it('settle flips rebuyPaid to rebuyOwed, appends ONE ledger event, and moves BOTH money surfaces', async () => {
    await seedRebuyPool();
    // Before: the D12 defect state — the $20 rebuy is invisible.
    let pool = (await db.collection('pools').doc(poolId).get()).data() as any;
    expect((await calculatePoolPot(db, poolId, pool)).prizePot).toBe(25);

    await wrappedSetPaid({ data: { poolId, memberUid: 'p3_m1', settleRebuys: true }, auth: BOSS } as never);

    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p3_m1').get()).data() as any;
    expect(m.rebuyPaid).toBe(20);
    expect(m.paidStatus).toBe('PAID'); // base dues untouched — independent settlements

    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0].data().type).toBe('REBUY_SETTLED');
    expect(ledger.docs[0].data().amount).toBe(20);

    // Money surface 1: the pot now counts the rebuy dollar.
    pool = (await db.collection('pools').doc(poolId).get()).data() as any;
    expect((await calculatePoolPot(db, poolId, pool)).prizePot).toBe(45);
    // Money surface 2: the roster projection agrees.
    const summary = (await db.collection('pools').doc(poolId).collection('rosterSummary').doc('current').get()).data() as any;
    expect(summary.duesCollected).toBe(45);
    expect(summary.duesExpected).toBe(45);

    // Transition-only: settling an already-settled member appends nothing.
    await wrappedSetPaid({ data: { poolId, memberUid: 'p3_m1', settleRebuys: true }, auth: BOSS } as never);
    expect((await db.collection('pools').doc(poolId).collection('payments').get()).size).toBe(1);
  });

  it('a LATER rebuy reopens the debt, and settling again moves only the delta', async () => {
    await seedRebuyPool();
    await wrappedSetPaid({ data: { poolId, memberUid: 'p3_m1', settleRebuys: true }, auth: BOSS } as never);
    // Second rebuy: owed grows to 40 while paid stays 20 → outstanding again.
    await db.collection('pools').doc(poolId).collection('members').doc('p3_m1').set({ rebuyOwed: 40 }, { merge: true });

    await wrappedSetPaid({ data: { poolId, memberUid: 'p3_m1', settleRebuys: true }, auth: BOSS } as never);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p3_m1').get()).data() as any;
    expect(m.rebuyPaid).toBe(40);
    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.size).toBe(2);
    const amounts = ledger.docs.map((d) => d.data().amount).sort();
    expect(amounts).toEqual([20, 20]); // each event carries the amount that MOVED
  });

  it('unsettle reverses to 0 with a REBUY_UNSETTLED event carrying the reversed amount', async () => {
    await seedRebuyPool();
    await wrappedSetPaid({ data: { poolId, memberUid: 'p3_m1', settleRebuys: true }, auth: BOSS } as never);
    await wrappedSetPaid({ data: { poolId, memberUid: 'p3_m1', settleRebuys: false }, auth: BOSS } as never);

    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p3_m1').get()).data() as any;
    expect(m.rebuyPaid).toBe(0);
    const events = (await db.collection('pools').doc(poolId).collection('payments').get()).docs.map((d) => d.data());
    expect(events.map((e: any) => e.type).sort()).toEqual(['REBUY_SETTLED', 'REBUY_UNSETTLED']);
    expect((events.find((e: any) => e.type === 'REBUY_UNSETTLED') as any).amount).toBe(20);
    const pool = (await db.collection('pools').doc(poolId).get()).data() as any;
    expect((await calculatePoolPot(db, poolId, pool)).prizePot).toBe(25); // back to base dues only
  });

  it('LEGACY: a member whose rebuy pre-dates the rebuyOwed writer settles from the entry evidence (codex r2)', async () => {
    // Survivor pools exist since 2026-05-25; the rebuyOwed writer since
    // 2026-07-08 (1bb7e89). A rebuy from that window left rebuysUsed on the
    // entry and NOTHING on the (backfill-created) member record.
    await db.collection('pools').doc(poolId).set({
      id: poolId, type: 'NFL_SURVIVOR', name: 'P3 Legacy', ownerId: 'p3_boss',
      participantIds: ['p3_boss', 'p3_leg'], status: 'COMPLETED', settings: { entryFee: 25, rebuyCost: 20 },
    });
    await db.collection('pools').doc(poolId).collection('members').doc('p3_leg').set({
      uid: 'p3_leg', poolId, userName: 'Legacy', role: 'PARTICIPANT', paidStatus: 'PAID', // NO rebuyOwed
    });
    await db.collection('pools').doc(poolId).collection('entries').doc('p3_leg').set({
      id: 'p3_leg', ownerUid: 'p3_leg', rebuysUsed: 2, paidStatus: 'PAID',
    });

    await wrappedSetPaid({ data: { poolId, memberUid: 'p3_leg', settleRebuys: true }, auth: BOSS } as never);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p3_leg').get()).data() as any;
    // Debt derived (2 × $20), STAMPED so every money surface sees it, and settled.
    expect(m.rebuyOwed).toBe(40);
    expect(m.rebuyPaid).toBe(40);
    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.docs.map((d) => d.data().type)).toEqual(['REBUY_SETTLED']);
    expect(ledger.docs[0].data().amount).toBe(40);
    const pool = (await db.collection('pools').doc(poolId).get()).data() as any;
    expect((await calculatePoolPot(db, poolId, pool)).prizePot).toBe(25 + 40);
  });

  it('LEGACY derive prefers REBUY_DUE ledger amounts over the CURRENT price (codex r4)', async () => {
    // Two rebuys happened at $15; the commissioner later raised rebuyCost to
    // $20. The ledger rows carry what was actually charged.
    await db.collection('pools').doc(poolId).set({
      id: poolId, type: 'NFL_SURVIVOR', name: 'P3 Price Drift', ownerId: 'p3_boss',
      participantIds: ['p3_boss', 'p3_drift'], status: 'OPEN', settings: { entryFee: 25, rebuyCost: 20 },
    });
    await db.collection('pools').doc(poolId).collection('members').doc('p3_drift').set({
      uid: 'p3_drift', poolId, userName: 'Drift', role: 'PARTICIPANT', paidStatus: 'UNPAID', // NO rebuyOwed
    });
    await db.collection('pools').doc(poolId).collection('entries').doc('p3_drift').set({
      id: 'p3_drift', ownerUid: 'p3_drift', rebuysUsed: 2, paidStatus: 'UNPAID',
    });
    for (const week of [2, 3]) {
      await db.collection('pools').doc(poolId).collection('payments').add({
        type: 'REBUY_DUE', uid: 'p3_drift', amount: 15, actorUid: 'p3_drift', at: Date.now(), note: `Survivor rebuy (week ${week})`,
      });
    }

    await wrappedSetPaid({ data: { poolId, memberUid: 'p3_drift', settleRebuys: true }, auth: BOSS } as never);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p3_drift').get()).data() as any;
    expect(m.rebuyOwed).toBe(30); // 15 + 15 from the ledger — NOT 2 × the current $20
    expect(m.rebuyPaid).toBe(30);
  });

  it('a STAMPED rebuyOwed of 0 is trusted — no derive, no event', async () => {
    await seedRebuyPool();
    await db.collection('pools').doc(poolId).collection('members').doc('p3_m1').set({ rebuyOwed: 0 }, { merge: true });
    await db.collection('pools').doc(poolId).collection('entries').doc('p3_m1').set({ id: 'p3_m1', ownerUid: 'p3_m1', rebuysUsed: 3 });
    await wrappedSetPaid({ data: { poolId, memberUid: 'p3_m1', settleRebuys: true }, auth: BOSS } as never);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('p3_m1').get()).data() as any;
    expect(m.rebuyOwed).toBe(0);
    expect(m.rebuyPaid ?? 0).toBe(0);
    expect((await db.collection('pools').doc(poolId).collection('payments').get()).size).toBe(0);
  });

  it('refuses non-commissioners and members not on the roster', async () => {
    await seedRebuyPool();
    await expect(wrappedSetPaid({ data: { poolId, memberUid: 'p3_m1', settleRebuys: true }, auth: { uid: 'p3_m1', token: {} } } as never))
      .rejects.toThrow(/commissioner/i);
    await expect(wrappedSetPaid({ data: { poolId, memberUid: 'nobody', settleRebuys: true }, auth: BOSS } as never))
      .rejects.toThrow(/roster/i);
  });
});

/**
 * PLAN-PAYMENT-TRUTH P2 (Q5): the one-off reconciliation for the population
 * NOTHING else repairs — members who already had a Member Record and were then
 * marked paid through the pre-P1 Bento (entry-only write). The backfill skips
 * existing members and P1 is forward-only.
 *
 * Direction rules: entry-PAID/member-UNPAID promotes the member (the entry
 * carries the commissioner's real action for exactly this population) and
 * appends the missing ledger row; member-PAID/entry-UNPAID mirrors the entry
 * display (truth already right — no ledger row). Q5: the dry run IS the count.
 */
describe('reconcilePaymentTruth — the divergence one-off (P2)', () => {
  const poolId = 'p2_pool';
  const BOSS = { uid: 'p2_boss', token: { role: 'SUPER_ADMIN' } };

  async function seedDivergedPool() {
    // validated({role}) enforces claim AND users-doc agreement (assertCallerRole).
    await seedUser('p2_boss', 'Boss', 'SUPER_ADMIN');
    await db.collection('pools').doc(poolId).set({
      id: poolId, type: 'NFL_PICKEM', name: 'P2 Pool', ownerId: 'p2_boss',
      participantIds: ['p2_boss'], status: 'COMPLETED', settings: { entryFee: 25 },
    });
    const members = db.collection('pools').doc(poolId).collection('members');
    const entries = db.collection('pools').doc(poolId).collection('entries');
    // m1: the D13 victim — Bento said PAID (entry), record still UNPAID.
    await members.doc('m1').set({ uid: 'm1', poolId, userName: 'Victim', paidStatus: 'UNPAID' });
    await entries.doc('m1').set({ id: 'm1', ownerUid: 'm1', paidStatus: 'PAID', paidAt: 1_700_000_000_000, paymentMethod: 'Venmo', paymentNote: 'txn 9' });
    // m2: roster toggle was used (correct path) — record PAID, display never mirrored.
    await members.doc('m2').set({ uid: 'm2', poolId, userName: 'Display', paidStatus: 'PAID', paidAt: 1_690_000_000_000, paymentMethod: 'Cash', paymentNote: 'venmo ref 4' });
    await entries.doc('m2').set({ id: 'm2', ownerUid: 'm2', paidStatus: 'UNPAID' });
    // m6: entry PAID + member UNPAID, BUT the ledger shows the roster toggle
    // touched them (a MARKED_UNPAID row) — so the entry is a STALE display of a
    // payment the commissioner later reversed, not recoverable history.
    await members.doc('m6').set({ uid: 'm6', poolId, userName: 'Reversed', paidStatus: 'UNPAID' });
    await entries.doc('m6').set({ id: 'm6', ownerUid: 'm6', paidStatus: 'PAID' });
    await db.collection('pools').doc(poolId).collection('payments').add({
      type: 'MARKED_UNPAID', uid: 'm6', actorUid: 'p2_boss', at: 1_699_000_000_000,
    });
    // m3: consistent-paid. m5: consistent-unpaid.
    await members.doc('m3').set({ uid: 'm3', poolId, userName: 'Fine', paidStatus: 'PAID' });
    await entries.doc('m3').set({ id: 'm3', ownerUid: 'm3', paidStatus: 'PAID' });
    await members.doc('m5').set({ uid: 'm5', poolId, userName: 'Unpaid', paidStatus: 'UNPAID' });
    await entries.doc('m5').set({ id: 'm5', ownerUid: 'm5', paidStatus: 'UNPAID' });
    // m4: entry PAID with NO member record — the backfill's job, report-only here.
    await entries.doc('m4').set({ id: 'm4', ownerUid: 'm4', paidStatus: 'PAID' });
  }

  it('DRY RUN is the divergence count and writes NOTHING', async () => {
    await seedDivergedPool();
    const r: any = await wrappedReconcile({ data: { dryRun: true }, auth: BOSS } as never);
    expect(r.ok).toBe(true);
    expect(r.poolsScanned).toBe(1);
    expect(r.membersPromoted).toBe(1);
    expect(r.entriesMirrored).toBe(1);
    expect(r.alreadyConsistent).toBe(2);
    expect(r.entriesPaidNoMember).toBe(1);
    expect(r.ambiguousSkipped).toBe(1); // m6 — ledger history, never auto-promoted
    expect(r.plannedFixes).toEqual(expect.arrayContaining([
      { poolId, uid: 'm1', fix: 'PROMOTE_MEMBER' },
      { poolId, uid: 'm2', fix: 'MIRROR_ENTRY' },
      { poolId, uid: 'm6', fix: 'AMBIGUOUS_SKIPPED' },
    ]));
    // Nothing moved: only the SEEDED ledger row, m1 still UNPAID on the record,
    // m2 still UNPAID on the entry.
    expect((await db.collection('pools').doc(poolId).collection('payments').get()).size).toBe(1);
    expect(((await db.collection('pools').doc(poolId).collection('members').doc('m1').get()).data() as any).paidStatus).toBe('UNPAID');
    expect(((await db.collection('pools').doc(poolId).collection('entries').doc('m2').get()).data() as any).paidStatus).toBe('UNPAID');
  });

  it('LIVE run converges both stores, appends the missing ledger row, moves the projections — then finds nothing', async () => {
    await seedDivergedPool();
    const r: any = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never);
    expect(r.ok).toBe(true);
    expect(r.membersPromoted).toBe(1);
    expect(r.entriesMirrored).toBe(1);

    // m1 promoted with the entry's detail carried onto the record.
    const m1 = (await db.collection('pools').doc(poolId).collection('members').doc('m1').get()).data() as any;
    expect(m1.paidStatus).toBe('PAID');
    expect(m1.paidAt).toBe(1_700_000_000_000);
    expect(m1.paidBy).toBe('p2_boss');
    expect(m1.paymentMethod).toBe('Venmo');
    expect(m1.paymentNote).toBe('txn 9');

    // ...and exactly ONE NEW ledger row (the seeded MARKED_UNPAID for m6 makes
    // two total), under `note` (the reader contract), for the PROMOTION only —
    // the mirror is display repair, not a payment event.
    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.size).toBe(2);
    const promoted = ledger.docs.map((d) => d.data()).find((p: any) => p.uid === 'm1') as any;
    expect(promoted.amount).toBe(25);
    // The commissioner's original detail survives into the audit note (codex r3).
    expect(String(promoted.note)).toMatch(/Venmo — txn 9 — reconciled/);

    // m2's entry display now matches its record — method AND note carried across.
    const e2 = (await db.collection('pools').doc(poolId).collection('entries').doc('m2').get()).data() as any;
    expect(e2.paidStatus).toBe('PAID');
    expect(e2.paidAt).toBe(1_690_000_000_000);
    expect(e2.paymentMethod).toBe('Cash');
    expect(e2.paymentNote).toBe('venmo ref 4');

    // m4 still has no member record — creating one is the backfill's job.
    expect((await db.collection('pools').doc(poolId).collection('members').doc('m4').get()).exists).toBe(false);

    // m6 stays exactly as the commissioner left them: UNPAID record, no new
    // ledger event — the stale entry display is the operator's call.
    expect(((await db.collection('pools').doc(poolId).collection('members').doc('m6').get()).data() as any).paidStatus).toBe('UNPAID');

    // Projections moved: m1, m2, m3 now paid.
    const summary = (await db.collection('pools').doc(poolId).collection('rosterSummary').doc('current').get()).data() as any;
    expect(summary.paidCount).toBe(3);
    const pool = (await db.collection('pools').doc(poolId).get()).data() as any;
    expect((await calculatePoolPot(db, poolId, pool)).prizePot).toBe(75);

    // Idempotent: a second live run finds nothing new (m6 stays ambiguous, not re-counted as work).
    const r2: any = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never);
    expect(r2.membersPromoted).toBe(0);
    expect(r2.entriesMirrored).toBe(0);
    expect(r2.ambiguousSkipped).toBe(1);
    expect((await db.collection('pools').doc(poolId).collection('payments').get()).size).toBe(2);
  });

  it('never touches sim/flagged pools or non-NFL-season types', async () => {
    await seedUser('p2_boss', 'Boss', 'SUPER_ADMIN');
    // A flagged pool with a textbook divergence: must stay wrong.
    await db.collection('pools').doc('p2_flagged').set({
      id: 'p2_flagged', type: 'NFL_PICKEM', name: 'Flagged', ownerId: 'p2_boss', isTestPool: true, settings: { entryFee: 10 },
    });
    await db.collection('pools').doc('p2_flagged').collection('members').doc('x').set({ uid: 'x', poolId: 'p2_flagged', paidStatus: 'UNPAID' });
    await db.collection('pools').doc('p2_flagged').collection('entries').doc('x').set({ id: 'x', ownerUid: 'x', paidStatus: 'PAID' });
    // A BRACKET pool: the entry IS the payment store there — out of scope.
    await db.collection('pools').doc('p2_bracket').set({
      id: 'p2_bracket', type: 'BRACKET', name: 'Bracket', ownerId: 'p2_boss', settings: { entryFee: 10 },
    });

    const r: any = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never);
    expect(r.testPoolsSkipped).toBe(1);
    expect(r.otherTypeSkipped).toBe(1);
    expect(r.poolsScanned).toBe(0);
    expect(((await db.collection('pools').doc('p2_flagged').collection('members').doc('x').get()).data() as any).paidStatus).toBe('UNPAID');
  });

  it('refuses non-SUPER_ADMIN callers (claim AND users-doc must agree)', async () => {
    await seedUser('p2_pleb', 'Pleb'); // PARTICIPANT users-doc, no admin claim
    await expect(wrappedReconcile({ data: { dryRun: true }, auth: { uid: 'p2_pleb', token: {} } } as never))
      .rejects.toThrow(/required role|Super Admin/i);
    // Claim without the users-doc role is refused too — the two-source gate.
    await expect(wrappedReconcile({ data: { dryRun: true }, auth: { uid: 'p2_pleb', token: { role: 'SUPER_ADMIN' } } } as never))
      .rejects.toThrow(/required role/i);
  });
});
