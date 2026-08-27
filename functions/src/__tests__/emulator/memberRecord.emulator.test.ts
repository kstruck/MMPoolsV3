import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { createNFLPool, joinNFLPool, executeSurvivorRebuy } from '../../nflPools';
import { setPaidStatus } from '../../setPaidStatus';
import { reconcilePaymentTruth } from '../../migrations/reconcilePaymentTruth';
import { calculatePoolPot } from '../../statsTrigger';
import { voidMemberRecord, reconcileMembership } from '../../lib/memberRecord';

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

/**
 * 🛑 ENUMERATED, NOT LISTED. This used to carry a HARDCODED array of
 * subcollection names, and it silently stopped wiping the moment a new one
 * existed — deleting a pool does NOT delete its subcollections, so anything not
 * named survived into the next test.
 *
 * It cost a real debugging session: `private/dues__{uid}` (PLAN-MULTI-ENTRY-DUES
 * D1) leaked from one test into the next, so a member seeded UNPAID was
 * materialized from the PREVIOUS test's paid rows, the PAID mark became a no-op,
 * and "MARKED_PAID + MARKED_UNPAID" came back with only the un-mark. The
 * assertion that caught it was a ledger COUNT, which pointed nowhere near the
 * cause.
 *
 * `listCollections()` cannot go stale. Nothing to remember to update.
 */
async function wipeDocWithSubcollections(ref: FirebaseFirestore.DocumentReference) {
  for (const sub of await ref.listCollections()) {
    const s = await sub.get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
  await ref.delete();
}

async function wipe() {
  const pools = await db.collection('pools').get();
  for (const p of pools.docs) await wipeDocWithSubcollections(p.ref);
  const users = await db.collection('users').get();
  for (const u of users.docs) await wipeDocWithSubcollections(u.ref);
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
 * PLAN-SETPAIDSTATUS-MEMBERSHIP. The claim branch's `set(..., {merge:true})`
 * CREATES the Member Record when absent, and a Member Record is roster truth
 * (ADR 0003) — so before this guard any authenticated user could mint
 * themselves onto any pool's roster, its memberCount, its dues figures and
 * (via #338) its reminder emails.
 *
 * The evidence matrix is unit-tested on the pure predicate
 * (`memberRecord.plan.test.ts`); these tests prove the callable actually CALLS
 * it, refuses without writing, and still admits real members.
 */
describe('setPaidStatus claim — the membership guard', () => {
  const poolId = 'pg_pool';

  async function seedGuardPool(extra: Record<string, unknown> = {}) {
    await db.collection('pools').doc(poolId).set({
      id: poolId, type: 'NFL_PICKEM', name: 'Guard Pool', ownerId: 'pg_boss',
      participantIds: ['pg_boss', 'pg_listed'], status: 'OPEN',
      settings: { entryFee: 25 },
      ...extra,
    });
    // A canonical record: server-seeded joinedAt, and deliberately NOT in
    // participantIds, so it can only pass on evidence 1.
    await db.collection('pools').doc(poolId).collection('members').doc('pg_legacy').set({
      uid: 'pg_legacy', poolId, userName: 'Legacy', role: 'PARTICIPANT',
      paidStatus: 'UNPAID', joinedAt: Date.now(),
    });
  }

  const memberDoc = (uid: string) =>
    db.collection('pools').doc(poolId).collection('members').doc(uid).get();

  it('REFUSES a stranger and creates NO document', async () => {
    await seedGuardPool();
    await expect(wrappedSetPaid({
      data: { poolId, memberUid: 'pg_stranger', claim: true },
      auth: { uid: 'pg_stranger', token: {} },
    } as never)).rejects.toThrow(/NOT_A_POOL_MEMBER/);

    // The whole point: the refusal must not leave the document it was minting.
    expect((await memberDoc('pg_stranger')).exists).toBe(false);
  });

  it('REFUSES a forged claim-only record — the fix does not ratify the exploit', async () => {
    await seedGuardPool();
    // Exactly what the vulnerable path wrote before this guard existed.
    await db.collection('pools').doc(poolId).collection('members').doc('pg_forged').set({
      memberReportedPaid: true, memberReportedAt: Date.now(),
    });

    await expect(wrappedSetPaid({
      data: { poolId, memberUid: 'pg_forged', claim: true },
      auth: { uid: 'pg_forged', token: {} },
    } as never)).rejects.toThrow(/NOT_A_POOL_MEMBER/);
  });

  it('ADMITS a canonical Member Record that is absent from participantIds', async () => {
    await seedGuardPool();
    await wrappedSetPaid({
      data: { poolId, memberUid: 'pg_legacy', claim: true },
      auth: { uid: 'pg_legacy', token: {} },
    } as never);
    expect((await memberDoc('pg_legacy')).data()!.memberReportedPaid).toBe(true);
  });

  it('ADMITS a participantIds member with no record, and CREATES it', async () => {
    await seedGuardPool();
    expect((await memberDoc('pg_listed')).exists).toBe(false);
    await wrappedSetPaid({
      data: { poolId, memberUid: 'pg_listed', claim: true },
      auth: { uid: 'pg_listed', token: {} },
    } as never);
    // Creation on claim is retained deliberately — a manager-listed participant
    // with no record yet is a real state, and refusing them would be the
    // false-negative D1 rejects.
    const created = (await memberDoc('pg_listed')).data()!;
    expect(created.memberReportedPaid).toBe(true);
    // ...and the created record is CANONICAL (codex P2 on #338). Without the
    // stamp, the record this very call wrote would be indistinguishable from a
    // forgery, and `resolveReminderTargets` would drop the member from every
    // nudge — the guard admitting them and the filter refusing them, about the
    // same person, in the same feature.
    expect(created.joinedAt).toEqual(expect.any(Number));
    expect(created.paidStatus).toBe('UNPAID');
    expect(created.uid).toBe('pg_listed');
    expect(created.poolId).toBe(poolId);
  });

  it('does NOT restamp joinedAt on an existing record', async () => {
    // The stamp is a seed, not an update. Re-reporting must not look like a
    // fresh join, and it must never touch a commissioner-owned field.
    await seedGuardPool();
    const before = (await memberDoc('pg_legacy')).data()!;

    await wrappedSetPaid({
      data: { poolId, memberUid: 'pg_legacy', claim: true },
      auth: { uid: 'pg_legacy', token: {} },
    } as never);

    const after = (await memberDoc('pg_legacy')).data()!;
    expect(after.joinedAt).toBe(before.joinedAt);
    expect(after.paidStatus).toBe(before.paidStatus);
    expect(after.userName).toBe('Legacy');
  });

  it('HEALS a legitimate claim-only record left by the pre-rollout callable', async () => {
    // codex r3. A genuine participant who self-reported BEFORE this rollout
    // already has a claim-only document, so a create-only seed would never
    // reach them and the §4a filter would exclude them from every nudge
    // permanently. `pg_listed` is in participantIds, so the guard admits them
    // and the stamp must land on the EXISTING document.
    await seedGuardPool();
    await db.collection('pools').doc(poolId).collection('members').doc('pg_listed').set({
      memberReportedPaid: false, memberReportedAt: 1,
    });

    await wrappedSetPaid({
      data: { poolId, memberUid: 'pg_listed', claim: true },
      auth: { uid: 'pg_listed', token: {} },
    } as never);

    expect((await memberDoc('pg_listed')).data()!.joinedAt).toEqual(expect.any(Number));
  });

  it('does NOT reset a commissioner-set PAID while healing', async () => {
    // `reconcilePaymentTruth` can promote a claim-only document to PAID from a
    // paid entry, so a non-canonical record may already carry a
    // commissioner-owned PAID. Seeding `paidStatus: UNPAID` on the heal path
    // would let a member reset their own payment status by self-reporting —
    // a member-triggered write to the one field they may never set.
    await seedGuardPool();
    await db.collection('pools').doc(poolId).collection('members').doc('pg_listed').set({
      memberReportedPaid: false, memberReportedAt: 1, paidStatus: 'PAID', paidBy: 'pg_boss',
    });

    await wrappedSetPaid({
      data: { poolId, memberUid: 'pg_listed', claim: true },
      auth: { uid: 'pg_listed', token: {} },
    } as never);

    const after = (await memberDoc('pg_listed')).data()!;
    expect(after.paidStatus).toBe('PAID');
    expect(after.joinedAt).toEqual(expect.any(Number));
  });

  it('REFUSES the "guest" sentinel even though it is in participantIds', async () => {
    await seedGuardPool({ participantIds: ['pg_boss', 'guest'] });
    await expect(wrappedSetPaid({
      data: { poolId, memberUid: 'guest', claim: true },
      auth: { uid: 'guest', token: {} },
    } as never)).rejects.toThrow(/NOT_A_POOL_MEMBER/);
  });

  it('REFUSES when the pool is gone but its members subcollection survives', async () => {
    await seedGuardPool();
    // Deleting a Firestore document does NOT delete its subcollections, so a
    // canonical record outlives its pool — and evidence 1 would happily admit
    // its owner, recreating an orphan under a pool that no longer exists.
    //
    // ⚠️ This exercises the callable's OPENING `poolSnap.exists` check, which
    // pre-dates this guard. Mutation testing proved that: deleting the
    // TRANSACTIONAL re-check left this test green, because the outer one throws
    // first. The race the transactional check exists for — a delete landing
    // BETWEEN the opening read and the transaction — cannot be staged from
    // outside the callable, so it is pinned by a source invariant instead
    // (tests/setpaidstatus-membership-guard.test.ts). Kept here anyway: it is
    // the reachable half of the same rule.
    await db.collection('pools').doc(poolId).delete();
    expect((await memberDoc('pg_legacy')).exists).toBe(true);

    await expect(wrappedSetPaid({
      data: { poolId, memberUid: 'pg_legacy', claim: true },
      auth: { uid: 'pg_legacy', token: {} },
    } as never)).rejects.toThrow(/Pool not found/);
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

// PLAN-CO-COMMISSIONERS D2 / sweeps S8: a departed member must never keep a
// co-commissioner grant. There is no live removal callable today — these two
// helpers ARE every removal path — so the invariant is pinned here, on the
// helpers, and whichever callable is wired later inherits it.
describe('coManagers — a departed member is dropped from the array (PLAN-CO-COMMISSIONERS T1)', () => {
  const seed = async (poolId: string) => {
    await db.collection('pools').doc(poolId).set({
      type: 'NFL_PICKEM', name: 'co', ownerId: 'cm_boss',
      participantIds: ['cm_boss', 'cm_x', 'cm_y'], coManagers: ['cm_x', 'cm_y'], status: 'OPEN',
    });
    await db.collection('pools').doc(poolId).collection('members').doc('cm_x').set({ uid: 'cm_x', role: 'PARTICIPANT' });
  };

  it('voidMemberRecord removes the uid from participantIds AND coManagers, leaving the others', async () => {
    await seed('cm_pool_a');
    await db.runTransaction(async (tx) => { voidMemberRecord(tx, db, 'cm_pool_a', 'cm_x'); });
    const pool = (await db.collection('pools').doc('cm_pool_a').get()).data()!;
    expect(pool.participantIds).toEqual(['cm_boss', 'cm_y']);
    expect(pool.coManagers).toEqual(['cm_y']);
  });

  it('reconcileMembership with present:false removes the uid from coManagers too', async () => {
    await seed('cm_pool_b');
    await db.runTransaction(async (tx) => {
      reconcileMembership(tx, db, 'cm_pool_b', 'cm_x',
        { userName: 'X', poolType: 'NFL_PICKEM', present: false }, null, Date.now());
    });
    const pool = (await db.collection('pools').doc('cm_pool_b').get()).data()!;
    expect(pool.participantIds).toEqual(['cm_boss', 'cm_y']);
    expect(pool.coManagers).toEqual(['cm_y']);
  });

  it('on a pool with no coManagers field, arrayRemove materialises an EMPTY array — stated, accepted (grants nothing; the clear invariant is nonEmpty === 0)', async () => {
    await db.collection('pools').doc('cm_pool_c').set({ type: 'NFL_PICKEM', ownerId: 'cm_boss', participantIds: ['cm_boss', 'cm_x'], status: 'OPEN' });
    await db.runTransaction(async (tx) => { voidMemberRecord(tx, db, 'cm_pool_c', 'cm_x'); });
    const pool = (await db.collection('pools').doc('cm_pool_c').get()).data()!;
    expect(pool.participantIds).toEqual(['cm_boss']);
    expect(pool.coManagers).toEqual([]);
  });
});

/**
 * PLAN-MULTI-ENTRY-DUES P2-T7 — `reconcilePaymentTruth` under per-entry dues.
 *
 * 🛑 D1a CALLED THIS "THE WRITER THAT WILL BE MISSED": it runs from the
 * Operations panel, sits in no hot path, and nothing exercises it in normal
 * testing. `paidStatus` is now DERIVED from the per-entry map, so a promotion
 * that writes the summary and not the map is un-paid by the next writer.
 */
/** The shape `reconcilePaymentTruth` returns — named so these tests need no `any`. */
type ReconcileResult = { ok: boolean; membersPromoted: number; ambiguousSkipped: number; alreadyConsistent: number; entriesPaidNotLiable: number };

describe('reconcilePaymentTruth — per-entry dues (DUES T7)', () => {
  const poolId = 'p2-dues-pool';
  const BOSS = { uid: 'p2d_boss', token: { role: 'SUPER_ADMIN' } };

  async function seedPool(opts: { entries: Array<{ id: string; picks: Record<string, unknown>; paidStatus?: string }>; dues?: Record<string, unknown> }) {
    // validated({role}) enforces claim AND users-doc agreement (assertCallerRole).
    await seedUser('p2d_boss', 'Boss', 'SUPER_ADMIN');
    const pool = db.collection('pools').doc(poolId);
    await pool.set({
      id: poolId, type: 'NFL_PICKEM', name: 'Dues Reconcile', ownerId: 'p2d_boss',
      participantIds: ['p2d_boss', 'dm1'], status: 'OPEN', settings: { entryFee: 25 },
    });
    await pool.collection('members').doc('dm1').set({
      uid: 'dm1', poolId, userName: 'Dues Member', role: 'PARTICIPANT',
      paidStatus: 'UNPAID', joinedAt: Date.now(), feeOwed: 50,
      playableEntryCount: 2, hasPlayableEntry: true,
    });
    for (const e of opts.entries) {
      await pool.collection('entries').doc(e.id).set({
        id: e.id, poolId, ownerUid: 'dm1', userName: 'Dues Member',
        picks: e.picks, ...(e.paidStatus ? { paidStatus: e.paidStatus } : {}),
      });
    }
    if (opts.dues) {
      await pool.collection('private').doc('dues__dm1').set({ uid: 'dm1', poolId, paidEntries: opts.dues, updatedAt: 1 });
    }
  }

  const duesOf = async () =>
    (await db.collection('pools').doc(poolId).collection('private').doc('dues__dm1').get()).data()?.paidEntries;

  it('records the ENTRY payment in the dues map, not just the member summary', async () => {
    // Without the map write, the next `setPaidStatus` or delete recomputes the
    // summary from a map that never heard about this payment — and un-pays it.
    await seedPool({ entries: [
      { id: 'dm1', picks: { g1: 'KC' }, paidStatus: 'PAID' },
      { id: 'e2:dm1', picks: { g1: 'BUF' } },
    ] });

    const r = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never) as ReconcileResult;
    expect(r.ok).toBe(true);
    expect(Object.keys(await duesOf())).toEqual(['dm1']);
  });

  it('🛑 does NOT promote the member when their OTHER liable entry is unpaid', async () => {
    // The commissioner marked ONE entry paid pre-P1, and that is all this
    // knows. Writing a literal PAID would claim two fees were collected on the
    // evidence of one — the money lie per-entry dues exists to remove.
    await seedPool({ entries: [
      { id: 'dm1', picks: { g1: 'KC' }, paidStatus: 'PAID' },
      { id: 'e2:dm1', picks: { g1: 'BUF' } },
    ] });

    await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('dm1').get()).data() as Record<string, unknown>;
    expect(m.paidStatus).toBe('UNPAID');          // one of two — not paid in full
    expect(Object.keys(await duesOf())).toEqual(['dm1']);   // ...but the payment IS recorded
  });

  it('DOES promote when every liable entry is accounted for', async () => {
    // Entry 2 was already settled per-entry; the pre-P1 entry write covers
    // entry 1. Together that is the whole liability, so the summary is PAID and
    // the behaviour matches what this migration did before the ticket.
    await seedPool({
      entries: [
        { id: 'dm1', picks: { g1: 'KC' }, paidStatus: 'PAID' },
        { id: 'e2:dm1', picks: { g1: 'BUF' } },
      ],
      dues: { 'e2:dm1': { paidAt: 1 } },
    });

    await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('dm1').get()).data() as Record<string, unknown>;
    expect(m.paidStatus).toBe('PAID');
    expect(Object.keys(await duesOf()).sort()).toEqual(['dm1', 'e2:dm1']);
  });

  it('a PARTIAL existing dues map is preserved, never replaced', async () => {
    // The map is the authority; this migration adds one key to it and must not
    // discard what a commissioner already recorded per entry.
    await seedPool({
      entries: [
        { id: 'dm1', picks: { g1: 'KC' }, paidStatus: 'PAID' },
        { id: 'e2:dm1', picks: { g1: 'BUF' } },
        { id: 'e3:dm1', picks: {} },
      ],
      dues: { 'e2:dm1': { paidAt: 1, method: 'cash' } },
    });

    await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never);
    const dues = await duesOf();
    expect(Object.keys(dues).sort()).toEqual(['dm1', 'e2:dm1']);
    expect(dues['e2:dm1'].method).toBe('cash');    // the pre-existing row survives
  });

  it('🛑 IS IDEMPOTENT on a partial repair — run 2 must not call it AMBIGUOUS', async () => {
    // The defect this pins (codex r6) was introduced BY this ticket. Before T7
    // the migration wrote a literal 'PAID', so run 2 saw `entry PAID + member
    // PAID` and counted `alreadyConsistent`. T7 makes it write the DERIVED
    // summary — correctly UNPAID for a member with one of two liable entries
    // paid — so run 2 sees the SAME shape it started with, and now also finds
    // the MARKED_PAID ledger row run 1 appended. The ambiguity gate keys on
    // exactly that ledger history, so every partial payment the migration
    // repaired would be re-reported for manual resolution, forever.
    //
    // The dues map is the evidence that tells the two apart, and its check must
    // run BEFORE the ledger-history check — run 1 wrote both.
    await seedPool({ entries: [
      { id: 'dm1', picks: { g1: 'KC' }, paidStatus: 'PAID' },
      { id: 'e2:dm1', picks: { g1: 'BUF' } },
    ] });

    const r1 = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never) as ReconcileResult;
    expect(r1.membersPromoted).toBe(1);
    // Run 1 left the member UNPAID (only one of two entries paid) and appended
    // a ledger row — the exact preconditions the gate would misread.
    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.docs.filter(d => d.data().type === 'MARKED_PAID').length).toBe(1);

    const r2 = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never) as ReconcileResult;
    expect(r2.ambiguousSkipped).toBe(0);      // <-- 1 before the fix
    expect(r2.membersPromoted).toBe(0);       // nothing left to promote
    expect(r2.alreadyConsistent).toBeGreaterThanOrEqual(1);
    // ...and run 2 appended nothing.
    const ledger2 = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger2.docs.filter(d => d.data().type === 'MARKED_PAID').length).toBe(1);
  });

  it('🛑 a MALFORMED dues row does NOT suppress the repair', async () => {
    // `derivePaidStatus` fails malformed money data CLOSED — a `null` value is
    // not a paid row, it is the mistake D1b forbids (un-marking by writing a
    // falsy value instead of DELETING the key). The idempotence gate must use
    // the SAME predicate, or it reports `alreadyConsistent` for an entry that
    // is PAID while its member is UNPAID — the exact divergence this
    // migration exists to repair, silently skipped (codex r7).
    await seedPool({
      entries: [
        { id: 'dm1', picks: { g1: 'KC' }, paidStatus: 'PAID' },
        { id: 'e2:dm1', picks: { g1: 'BUF' } },
      ],
      dues: { dm1: null },                 // present as a KEY, not a valid row
    });

    const r = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never) as ReconcileResult;
    expect(r.membersPromoted).toBe(1);     // repaired, NOT skipped
    const dues = (await db.collection('pools').doc(poolId)
      .collection('private').doc('dues__dm1').get()).data()?.paidEntries;
    expect(dues.dm1).toEqual({});          // the malformed row is replaced by a real one
  });

  it('an existing dues row for the entry blocks a duplicate ledger event', async () => {
    // 🛑 WHAT THIS DOES AND DOES NOT COVER — read before trusting it.
    //
    // COVERS: the settled case. A dues row already records this entry as paid,
    // the member is UNPAID because their OTHER entry is not, and the migration
    // must neither re-promote nor mint a MARKED_PAID event.
    //
    // TWO guards catch this, and the mutation results are exact:
    //   remove the page gate alone            — GREEN (the tx re-check catches it)
    //   remove the tx re-check alone          — GREEN (the page gate catches it)
    //   remove BOTH                           — RED, 'expected 1 to be +0'
    // So this test pins the BEHAVIOUR, not either guard. The page gate has its
    // own single-mutation test above (IS IDEMPOTENT), which goes red when only
    // that gate is removed.
    //
    // DOES NOT COVER: the concurrent-commissioner RACE codex r7 raised — a
    // `setPaidStatus` landing BETWEEN the page read and the transaction. That
    // is the only case where the tx re-check is load-bearing ALONE, and this
    // harness cannot stage it without a seam built to pause the migration
    // mid-run. The guard is kept as defence in depth and the gap is recorded
    // rather than papered over: an earlier version of this comment claimed the
    // page-gate mutation failed this test, and the mutation run said otherwise.
    // This repo has shipped inert guards before (#596, the T6 entry mirror).
    //
    // Before T7 the race was unreachable anyway: the concurrent write set the
    // member PAID and `fm?.paidStatus === 'PAID'` caught it. Deriving the
    // summary is what re-opened it.
    await seedPool({
      entries: [
        { id: 'dm1', picks: { g1: 'KC' }, paidStatus: 'PAID' },
        { id: 'e2:dm1', picks: { g1: 'BUF' } },
      ],
      dues: { dm1: { paidAt: 5, method: 'venmo' } },
    });

    const r = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never) as ReconcileResult;
    expect(r.membersPromoted).toBe(0);
    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.docs.filter(d => d.data().type === 'MARKED_PAID').length).toBe(0);
    // ...and the commissioner's own row is untouched.
    const dues = (await db.collection('pools').doc(poolId)
      .collection('private').doc('dues__dm1').get()).data()?.paidEntries;
    expect(dues.dm1.method).toBe('venmo');
  });

  it('🛑 a STALE fully-paid summary is repaired, not filed as consistent', async () => {
    // The idempotence gate keys on 'this entry is already in the dues map'.
    // That is only a reason to skip while the map still DERIVES to UNPAID. If
    // every liable entry has a valid row, the stored UNPAID is stale and the
    // member must be promoted — skipping it leaves them unpaid forever and
    // prints `alreadyConsistent`, which is a false statement about money
    // (codex r8).
    await seedPool({
      entries: [
        { id: 'dm1', picks: { g1: 'KC' }, paidStatus: 'PAID' },
        { id: 'e2:dm1', picks: { g1: 'BUF' } },
      ],
      dues: { 'dm1': { paidAt: 1 }, 'e2:dm1': { paidAt: 2 } },   // BOTH liable entries paid
    });
    // — LEDGER HISTORY IS PART OF THE SCENARIO, NOT DECORATION —
    // Whatever filled that dues map (setPaidStatus, or an earlier run of this
    // migration) ALSO wrote ledger rows, so in production this member ALWAYS
    // has history here. Without these rows the test passes even when the
    // ambiguity gate swallows the case, which is exactly how the first version
    // of this fix shipped inert (self-review, after codex r10 came back clean).
    await db.collection('pools').doc(poolId).collection('payments').doc().set({
      type: 'MARKED_PAID', uid: 'dm1', actorUid: 'p2d_boss', at: 1, note: 'prior',
    });

    const r = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never) as ReconcileResult;
    expect(r.ambiguousSkipped).toBe(0);   // the map settles it; not the operator's problem
    expect(r.membersPromoted).toBe(1);
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('dm1').get())
      .data() as Record<string, unknown>;
    expect(m.paidStatus).toBe('PAID');
  });

  it('🛑 refuses to record money against an entry that never PICKED', async () => {
    // Liability is 'this entry has committed a pick'. `setPaidStatus` refuses a
    // non-liable id with ENTRY_NOT_FOUND, so a dues row and a MARKED_PAID event
    // here would put a payment on the participant-readable ledger that the
    // authoritative path would have rejected — and it could never make the
    // member paid, because derivePaidStatus only consults liable ids (codex r8).
    await seedPool({ entries: [
      { id: 'dm1', picks: { g1: 'KC' } },                    // liable, unpaid
      { id: 'e2:dm1', picks: {}, paidStatus: 'PAID' },       // PAID but NEVER PICKED
    ] });

    const r = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never) as ReconcileResult;
    expect(r.entriesPaidNotLiable).toBe(1);
    expect(r.membersPromoted).toBe(0);
    // No dues row, and no money event.
    const duesDoc = await db.collection('pools').doc(poolId)
      .collection('private').doc('dues__dm1').get();
    expect(duesDoc.exists).toBe(false);
    const ledger = await db.collection('pools').doc(poolId).collection('payments').get();
    expect(ledger.docs.filter(d => d.data().type === 'MARKED_PAID').length).toBe(0);
  });

  it('🛑 the DRY RUN reaches the same verdict as the live run on a non-liable entry', async () => {
    // This file's contract is that the dry run IS the divergence count and
    // lists what a live run would do. Classifying non-liability inside the
    // transaction broke that: the transaction only runs LIVE, so the dry run
    // reported PROMOTE_MEMBER for an entry the live run refuses (codex r9).
    await seedPool({ entries: [
      { id: 'dm1', picks: { g1: 'KC' } },                 // liable, unpaid
      { id: 'e2:dm1', picks: {}, paidStatus: 'PAID' },    // PAID, never picked
    ] });

    const dry = await wrappedReconcile({ data: { dryRun: true }, auth: BOSS } as never) as ReconcileResult;
    const live = await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never) as ReconcileResult;
    expect(dry.entriesPaidNotLiable).toBe(live.entriesPaidNotLiable);
    expect(dry.membersPromoted).toBe(live.membersPromoted);
    expect(dry.entriesPaidNotLiable).toBe(1);
    expect(dry.membersPromoted).toBe(0);
  });

  it('🛑 folds in the LEGACY primary entry when promoting an EXTRA entry', async () => {
    // `entries/{uid}` predates `ownerUid`, so the `where('ownerUid','==',uid)`
    // query MISSES it. Folding it in only when it is the TRIGGERING document
    // is not enough: promoting the paid EXTRA entry would derive liability
    // from a set that omits the member's unpaid primary pick, and the
    // derivation would return PAID on the evidence of ONE fee — a paid
    // status `setPaidStatus` would never have written (codex r9, P1).
    await seedUser('p2d_boss', 'Boss', 'SUPER_ADMIN');
    const pool = db.collection('pools').doc(poolId);
    await pool.set({
      id: poolId, type: 'NFL_PICKEM', name: 'Legacy Primary', ownerId: 'p2d_boss',
      participantIds: ['p2d_boss', 'dm1'], status: 'OPEN', settings: { entryFee: 25 },
    });
    await pool.collection('members').doc('dm1').set({
      uid: 'dm1', poolId, userName: 'Dues Member', role: 'PARTICIPANT',
      paidStatus: 'UNPAID', joinedAt: Date.now(), feeOwed: 50,
      playableEntryCount: 1, hasPlayableEntry: true,     // STALE: really 2
    });
    // The legacy primary: has a pick, carries NO ownerUid, and is UNPAID.
    await pool.collection('entries').doc('dm1').set({ id: 'dm1', poolId, userName: 'Dues Member', picks: { g1: 'KC' } });
    // The extra entry: has a pick, carries ownerUid, and IS marked paid.
    await pool.collection('entries').doc('e2:dm1').set({
      id: 'e2:dm1', poolId, ownerUid: 'dm1', userName: 'Dues Member',
      picks: { g1: 'BUF' }, paidStatus: 'PAID',
    });

    await wrappedReconcile({ data: { dryRun: false }, auth: BOSS } as never);
    const m = (await pool.collection('members').doc('dm1').get()).data() as Record<string, unknown>;
    expect(m.paidStatus).toBe('UNPAID');    // TWO liable entries, ONE paid
    const dues = (await pool.collection('private').doc('dues__dm1').get()).data()?.paidEntries;
    expect(Object.keys(dues)).toEqual(['e2:dm1']);
  });

  it('DRY RUN still writes nothing at all, dues document included', async () => {
    await seedPool({ entries: [
      { id: 'dm1', picks: { g1: 'KC' }, paidStatus: 'PAID' },
      { id: 'e2:dm1', picks: { g1: 'BUF' } },
    ] });

    const r = await wrappedReconcile({ data: { dryRun: true }, auth: BOSS } as never) as ReconcileResult;
    expect(r.ok).toBe(true);
    expect(r.membersPromoted).toBe(1);             // it still REPORTS the fix
    expect(await duesOf()).toBeUndefined();        // ...and performs none of it
    const m = (await db.collection('pools').doc(poolId).collection('members').doc('dm1').get()).data() as Record<string, unknown>;
    expect(m.paidStatus).toBe('UNPAID');
  });
});
