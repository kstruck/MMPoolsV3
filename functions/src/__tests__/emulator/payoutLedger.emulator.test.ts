import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { recordPoolPayouts, setPayoutSettled } from '../../payoutRecords';

/**
 * PLAN-PAYMENT-LEDGER T4 (D4, K4/K5/K11/K12) — the ledger's checkbox, end to end.
 *
 *  1. a WEEKLY PLACE award is recorded at the deterministic id once the week is
 *     published; the same call again writes nothing and returns the same id.
 *  2. wrong amount / wrong owner / entry not in places / unpublished week → refused.
 *  3. a season award on an unfinalized pool → POOL_NOT_SETTLED, and a mixed
 *     batch is refused whole (the valid weekly award is NOT written).
 *  4. setPayoutSettled flips settled transition-only, refuses a superseded award,
 *     never touches the amount.
 *  5. K12: after a rescore changes the row, re-record with staleAwardId
 *     supersedes to `~2`; a second re-record against the same stale id returns
 *     the live award and writes nothing.
 */
const test = ftest();
const db = admin.firestore();
const wRecord = test.wrap(recordPoolPayouts);
const wSettle = test.wrap(setPayoutSettled);

const HOST = 'pl-host';
const ALICE = 'pl-alice';
const BOB = 'pl-bob';
const auth = (uid: string, role?: string) => ({ uid, token: role ? { role } : {} }) as any;

let n = 0;
let POOL = '';
const createdPools: string[] = [];
const poolRef = () => db.collection('pools').doc(POOL);
const rec = async (id: string) => (await poolRef().collection('payoutRecords').doc(id).get());
const priv = async (id: string) => (await poolRef().collection('payoutRecordsPrivate').doc(id).get());
const record = (uid: string, awards: unknown[]) => wRecord({ data: { poolId: POOL, awards }, auth: auth(uid) } as any);
const settle = (uid: string, awardId: string, settled: boolean) => wSettle({ data: { poolId: POOL, awardId, settled }, auth: auth(uid) } as any);

async function seedPool(opts: { published?: boolean; finalized?: boolean } = {}) {
  n += 1;
  POOL = `pool-pl-${n}`;
  createdPools.push(POOL);
  await poolRef().set({
    name: 'Ledger', type: 'NFL_PICKEM', league: 'NFL', season: 'pl-season', seasonType: 1,
    ownerId: HOST, managerUid: HOST, participantIds: [HOST, ALICE, BOB], status: opts.finalized ? 'FINAL' : 'OPEN',
    billing: { status: 'free' }, entryCount: 3,
    settings: { entryFee: 20, payoutMode: 'WEEKLY', payouts: { places: [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }], bonuses: [] } },
    ...(opts.finalized ? { finalizedAt: Date.now() } : {}),
  });
  if (opts.published !== false) {
    await poolRef().collection('weekly_recaps').doc('week_1').set({
      id: 'week_1', poolId: POOL, week: 1, createdAt: Date.now(),
      weeklyPlaces: [
        { entryId: ALICE, userId: ALICE, userName: ALICE, points: 2, rank: 1, prize: 18 },
        { entryId: BOB, userId: BOB, userName: BOB, points: 1, rank: 2, prize: 12 },
        { entryId: HOST, userId: HOST, userName: HOST, points: 0, rank: 3 },
      ],
      weeklyPrize: { pot: 30, places: [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }], entryCount: 3, weeksInSeason: 2, payoutMode: 'WEEKLY', frozenAt: Date.now() },
    });
  }
}

describe('PLAN-PAYMENT-LEDGER T4 — recordPoolPayouts weekly awards + setPayoutSettled', () => {
  beforeEach(async () => {
    for (const uid of [HOST, ALICE, BOB]) await db.collection('users').doc(uid).set({ name: uid, role: 'PLAYER' });
  }, 30000);

  afterAll(async () => {
    try {
      for (const id of createdPools) await db.recursiveDelete(db.collection('pools').doc(id));
      for (const uid of [HOST, ALICE, BOB]) await db.recursiveDelete(db.collection('users').doc(uid));
    } catch { /* best-effort */ }
    test.cleanup();
  }, 30000);

  it('1. records a weekly PLACE award at the deterministic id; a repeat call writes nothing and returns the same id', async () => {
    await seedPool();
    const r1 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', place: 1, week: 1, settled: true }]);
    expect(r1.awardIds).toEqual(['wk1-pl-alice-p1']);
    expect(r1.written).toBe(1);
    expect((await rec('wk1-pl-alice-p1')).data()).toMatchObject({ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', place: 1, week: 1, schemaVersion: 2 });
    expect((await priv('wk1-pl-alice-p1')).data()).toMatchObject({ uid: ALICE, settled: true, recordedBy: HOST });
    const r2 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', place: 1, week: 1, settled: true }]);
    expect(r2.awardIds).toEqual(['wk1-pl-alice-p1']);
    expect(r2.written).toBe(0);
    expect((await poolRef().collection('payoutRecords').get()).size).toBe(1);
  }, 30000);

  it('2. refuses a wrong amount, a wrong owner, an entry not in the places, an unprized place, and an unpublished week', async () => {
    await seedPool();
    await expect(record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 20, kind: 'PLACE', week: 1, settled: true }])).rejects.toThrow(/AMOUNT_MISMATCH/);
    await expect(record(HOST, [{ uid: BOB, entryId: ALICE, amount: 18, kind: 'PLACE', week: 1, settled: true }])).rejects.toThrow(/ENTRY_NOT_OWNED/);
    await expect(record(HOST, [{ uid: ALICE, entryId: 'e2:pl-alice', amount: 18, kind: 'PLACE', week: 1, settled: true }])).rejects.toThrow(/NOT_IN_WEEKLY_PLACES/);
    await expect(record(HOST, [{ uid: HOST, entryId: HOST, amount: 0, kind: 'PLACE', week: 1, settled: true }])).rejects.toThrow(/NO_PRIZE/);
    await expect(record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', week: 2, settled: true }])).rejects.toThrow(/WEEK_NOT_PUBLISHED/);
    await expect(record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', place: 2, week: 1, settled: true }])).rejects.toThrow(/PLACE_MISMATCH/);
    expect((await poolRef().collection('payoutRecords').get()).size).toBe(0);
  }, 30000);

  it('3. a season award on an unfinalized pool is POOL_NOT_SETTLED, and a mixed batch is refused WHOLE', async () => {
    await seedPool();
    await expect(record(HOST, [{ uid: ALICE, amount: 100, kind: 'PLACE', place: 1, settled: false }])).rejects.toThrow(/POOL_NOT_SETTLED/);
    await expect(record(HOST, [
      { uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', week: 1, settled: true },
      { uid: ALICE, amount: 100, kind: 'PLACE', place: 1, settled: false },
    ])).rejects.toThrow(/POOL_NOT_SETTLED/);
    expect((await poolRef().collection('payoutRecords').get()).size).toBe(0);
    // A member (not the commissioner) cannot record at all.
    await expect(record(BOB, [{ uid: BOB, entryId: BOB, amount: 12, kind: 'PLACE', week: 1, settled: true }])).rejects.toThrow(/permission-denied|Only the pool commissioner/);
  }, 30000);

  it('4. setPayoutSettled flips settled transition-only, refuses a superseded award, and leaves the amount alone', async () => {
    await seedPool();
    await record(HOST, [{ uid: BOB, entryId: BOB, amount: 12, kind: 'PLACE', week: 1, settled: false }]);
    expect((await priv('wk1-pl-bob-p2')).data()!.settled).toBe(false);
    expect((await settle(HOST, 'wk1-pl-bob-p2', true)).changed).toBe(true);
    expect((await priv('wk1-pl-bob-p2')).data()).toMatchObject({ settled: true, settledBy: HOST });
    expect((await settle(HOST, 'wk1-pl-bob-p2', true)).changed).toBe(false);
    expect((await settle(HOST, 'wk1-pl-bob-p2', false)).changed).toBe(true);
    expect((await rec('wk1-pl-bob-p2')).data()!.amount).toBe(12);
    await expect(settle(BOB, 'wk1-pl-bob-p2', true)).rejects.toThrow(/permission-denied|Only the pool commissioner/);
    await expect(settle(HOST, 'nope', true)).rejects.toThrow(/not found/i);
  }, 30000);

  it('5. K12: after a rescore, re-record with staleAwardId supersedes to ~2; a second re-record against the same stale id returns the live award and writes nothing', async () => {
    await seedPool();
    await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', week: 1, settled: true }]);
    // Rescore: Bob overtakes; Alice is now 2nd for $12.
    await poolRef().collection('weekly_recaps').doc('week_1').update({
      weeklyPlaces: [
        { entryId: BOB, userId: BOB, userName: BOB, points: 3, rank: 1, prize: 18 },
        { entryId: ALICE, userId: ALICE, userName: ALICE, points: 2, rank: 2, prize: 12 },
        { entryId: HOST, userId: HOST, userName: HOST, points: 0, rank: 3 },
      ],
    });
    // The old figure is refused now (recap wins)…
    await expect(record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', week: 1, settled: true }])).rejects.toThrow(/AMOUNT_MISMATCH/);
    // …and the re-record supersedes.
    const r = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 12, kind: 'PLACE', week: 1, settled: true, staleAwardId: 'wk1-pl-alice-p1' }]);
    expect(r.awardIds).toEqual(['wk1-pl-alice-p2~2']);
    expect(r.written).toBe(1);
    expect((await rec('wk1-pl-alice-p1')).data()!.supersededBy).toBe('wk1-pl-alice-p2~2');
    expect((await rec('wk1-pl-alice-p2~2')).data()).toMatchObject({ amount: 12, place: 2, week: 1 });
    // Two tabs: the second re-record against the already-superseded id returns the live award, writes nothing.
    const r2 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 12, kind: 'PLACE', week: 1, settled: true, staleAwardId: 'wk1-pl-alice-p1' }]);
    expect(r2.awardIds).toEqual(['wk1-pl-alice-p2~2']);
    expect(r2.written).toBe(0);
    // Settling the superseded record is refused.
    await expect(settle(HOST, 'wk1-pl-alice-p1', false)).rejects.toThrow(/AWARD_SUPERSEDED/);
    // Profit-side invariant: exactly one LIVE record for Alice.
    const live = (await poolRef().collection('payoutRecords').where('uid', '==', ALICE).get()).docs.filter(d => !d.data().supersededBy);
    expect(live.map(d => d.id)).toEqual(['wk1-pl-alice-p2~2']);
  }, 30000);
});
