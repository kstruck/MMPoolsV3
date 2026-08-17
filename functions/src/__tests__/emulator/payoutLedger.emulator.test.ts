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
    // A weekly award is bound to the recap row, not to participantIds: a legacy member absent from the list can still be recorded (codex r4 on T5)…
    await poolRef().update({ participantIds: [HOST] });
    const legacy = await record(HOST, [{ uid: BOB, entryId: BOB, amount: 12, kind: 'PLACE', week: 1, settled: false }]);
    expect(legacy.awardIds).toEqual(['wk1-pl-bob-p2']);
    // …while a season award still needs the participant list.
    await poolRef().update({ status: 'FINAL', finalizedAt: Date.now() });
    await expect(record(HOST, [{ uid: BOB, amount: 5, kind: 'BONUS', settled: false }])).rejects.toThrow(/not a member/);
    await poolRef().update({ status: 'OPEN', finalizedAt: null, participantIds: [HOST, ALICE, BOB] });
    await poolRef().collection('payoutRecords').doc('wk1-pl-bob-p2').delete();
    await poolRef().collection('payoutRecordsPrivate').doc('wk1-pl-bob-p2').delete();
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
    // …and a plain record at the NEW figure is refused too while the old award is live (codex r1: never two live records).
    await expect(record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 12, kind: 'PLACE', week: 1, settled: true }])).rejects.toThrow(/LIVE_AWARD_EXISTS/);
    // …and the re-record supersedes.
    const r = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 12, kind: 'PLACE', week: 1, settled: true, staleAwardId: 'wk1-pl-alice-p1' }]);
    // The place changed, so the new deterministic base is free — used directly.
    expect(r.awardIds).toEqual(['wk1-pl-alice-p2']);
    expect(r.written).toBe(1);
    expect((await rec('wk1-pl-alice-p1')).data()!.supersededBy).toBe('wk1-pl-alice-p2');
    expect((await rec('wk1-pl-alice-p2')).data()).toMatchObject({ amount: 12, place: 2, week: 1 });
    // Two tabs: the second re-record against the already-superseded id returns the live award, writes nothing.
    const r2 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 12, kind: 'PLACE', week: 1, settled: true, staleAwardId: 'wk1-pl-alice-p1' }]);
    expect(r2.awardIds).toEqual(['wk1-pl-alice-p2']);
    expect(r2.written).toBe(0);
    // Settling the superseded record is refused.
    await expect(settle(HOST, 'wk1-pl-alice-p1', false)).rejects.toThrow(/AWARD_SUPERSEDED/);
    // A second rescore back to 1st for $18: re-record from the live id lands at ~2 (base p1 is taken by the superseded doc)…
    await poolRef().collection('weekly_recaps').doc('week_1').update({
      weeklyPlaces: [
        { entryId: ALICE, userId: ALICE, userName: ALICE, points: 3, rank: 1, prize: 18 },
        { entryId: BOB, userId: BOB, userName: BOB, points: 2, rank: 2, prize: 12 },
        { entryId: HOST, userId: HOST, userName: HOST, points: 0, rank: 3 },
      ],
    });
    // Re-recording from the ORIGINAL (already-superseded) id when the live end no longer matches is refused and names the live id (codex r2).
    await expect(record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', week: 1, settled: true, staleAwardId: 'wk1-pl-alice-p1' }]))
      .rejects.toThrow(/STALE_AWARD_SUPERSEDED.*wk1-pl-alice-p2/);
    const r3 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', week: 1, settled: true, staleAwardId: 'wk1-pl-alice-p2' }]);
    expect(r3.awardIds).toEqual(['wk1-pl-alice-p1~2']);
    // …and the ORIGINAL stale id now resolves the FULL chain to the live end (codex r1), writing nothing.
    const r4 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', week: 1, settled: true, staleAwardId: 'wk1-pl-alice-p1' }]);
    expect(r4.awardIds).toEqual(['wk1-pl-alice-p1~2']);
    expect(r4.written).toBe(0);
    // Re-recording against the LIVE id when it already matches does not grow the chain (qodo #8 on #455).
    const r5 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', week: 1, settled: true, staleAwardId: 'wk1-pl-alice-p1~2' }]);
    expect(r5.awardIds).toEqual(['wk1-pl-alice-p1~2']);
    expect(r5.written).toBe(0);
    // Profit-side invariant: exactly one LIVE record for Alice.
    const live = (await poolRef().collection('payoutRecords').where('uid', '==', ALICE).get()).docs.filter(d => !d.data().supersededBy);
    expect(live.map(d => d.id)).toEqual(['wk1-pl-alice-p1~2']);
    // A third rescore drops Alice out of the paid places entirely: a plain re-record with the old figure is refused,
    // and a REVERSAL (amount 0 + staleAwardId) supersedes the live award so Profit no longer counts it (codex r6).
    await poolRef().collection('weekly_recaps').doc('week_1').update({
      weeklyPlaces: [
        { entryId: BOB, userId: BOB, userName: BOB, points: 3, rank: 1, prize: 18 },
        { entryId: HOST, userId: HOST, userName: HOST, points: 2, rank: 2, prize: 12 },
        { entryId: ALICE, userId: ALICE, userName: ALICE, points: 0, rank: 3 },
      ],
    });
    await expect(record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 18, kind: 'PLACE', week: 1, settled: true, staleAwardId: 'wk1-pl-alice-p1~2' }])).rejects.toThrow(/NO_PRIZE/);
    const r6 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 0, kind: 'PLACE', week: 1, settled: true, staleAwardId: 'wk1-pl-alice-p1~2' }]);
    expect(r6.awardIds).toEqual(['wk1-pl-alice-p3']);
    expect((await rec('wk1-pl-alice-p1~2')).data()!.supersededBy).toBe('wk1-pl-alice-p3');
    const live2 = (await poolRef().collection('payoutRecords').where('uid', '==', ALICE).get()).docs.filter(d => !d.data().supersededBy);
    expect(live2.map(d => [d.id, d.data().amount])).toEqual([['wk1-pl-alice-p3', 0]]);
    // A plain (no stale id) zero record is still refused — reversal needs the stale id.
    await expect(record(HOST, [{ uid: HOST, entryId: HOST, amount: 0, kind: 'PLACE', week: 1, settled: true }])).rejects.toThrow(/AMOUNT_MISMATCH/);
    // Two identical weekly awards in one batch are refused (codex r1).
    await expect(record(HOST, [
      { uid: BOB, entryId: BOB, amount: 12, kind: 'PLACE', week: 1, settled: true },
      { uid: BOB, entryId: BOB, amount: 12, kind: 'PLACE', week: 1, settled: false },
    ])).rejects.toThrow(/DUPLICATE_WEEKLY_AWARD/);
  }, 30000);

  it('6. PLAN-WEEKLY-PRIZES step 3: a season PLACE award naming an ENTRY is BOUND to pool.seasonPlaces at a deterministic id; free-form season awards keep the old path', async () => {
    await seedPool({ finalized: true });
    await poolRef().update({
      seasonPlaces: [
        { entryId: ALICE, userId: ALICE, userName: ALICE, rank: 1, points: 90, prize: 36 },
        { entryId: BOB, userId: BOB, userName: BOB, rank: 2, points: 80, prize: 24 },
        { entryId: HOST, userId: HOST, userName: HOST, rank: 3, points: 10 },
      ],
      seasonPrize: { pot: 60, places: [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }], entryCount: 3, payoutMode: 'SEASON', frozenAt: Date.now() },
    });
    // Bound: deterministic id, idempotent on repeat.
    const r1 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 36, kind: 'PLACE', place: 1, settled: true }]);
    expect(r1.awardIds).toEqual(['season-pl-alice-p1']);
    expect(r1.written).toBe(1);
    expect((await rec('season-pl-alice-p1')).data()).toMatchObject({ uid: ALICE, entryId: ALICE, amount: 36, kind: 'PLACE', place: 1 });
    expect((await rec('season-pl-alice-p1')).data()!.week).toBeUndefined();
    const r2 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 36, kind: 'PLACE', settled: false }]);
    expect(r2.awardIds).toEqual(['season-pl-alice-p1']);
    expect(r2.written).toBe(0);
    expect((await priv('season-pl-alice-p1')).data()!.settled).toBe(true); // repeat did not flip settlement
    // Bound: refuses a wrong amount, a wrong place, an unprized entry, a stranger, a wrong owner.
    await expect(record(HOST, [{ uid: BOB, entryId: BOB, amount: 25, kind: 'PLACE', settled: true }])).rejects.toThrow(/AMOUNT_MISMATCH/);
    await expect(record(HOST, [{ uid: BOB, entryId: BOB, amount: 24, kind: 'PLACE', place: 1, settled: true }])).rejects.toThrow(/PLACE_MISMATCH/);
    await expect(record(HOST, [{ uid: HOST, entryId: HOST, amount: 5, kind: 'PLACE', settled: true }])).rejects.toThrow(/NO_PRIZE/);
    await expect(record(HOST, [{ uid: ALICE, entryId: 'nobody', amount: 5, kind: 'PLACE', settled: true }])).rejects.toThrow(/NOT_IN_SEASON_PLACES/);
    await expect(record(HOST, [{ uid: BOB, entryId: ALICE, amount: 36, kind: 'PLACE', settled: true }])).rejects.toThrow(/ENTRY_NOT_OWNED/);
    // Two bound awards for one entry in a batch are refused (codex r1 on step 3).
    await expect(record(HOST, [
      { uid: BOB, entryId: BOB, amount: 24, kind: 'PLACE', settled: true },
      { uid: BOB, entryId: BOB, amount: 24, kind: 'PLACE', settled: false },
    ])).rejects.toThrow(/DUPLICATE_SEASON_AWARD/);
    // A ranked entry missing from participantIds (legacy) can still be paid — ownership comes from the published row.
    await poolRef().update({ participantIds: [HOST] });
    const r4 = await record(HOST, [{ uid: BOB, entryId: BOB, amount: 24, kind: 'PLACE', settled: true }]);
    expect(r4.awardIds).toEqual(['season-pl-bob-p2']);
    await poolRef().update({ participantIds: [HOST, ALICE, BOB] });
    // Free-form (no entryId) season PLACE / BONUS keep today's random-id path.
    const r3 = await record(HOST, [{ uid: BOB, amount: 5, kind: 'BONUS', settled: false, note: 'most improved' }]);
    expect(r3.written).toBe(1);
    expect(r3.awardIds[0]).not.toMatch(/^season-/);
    expect((await poolRef().collection('payoutRecords').get()).size).toBe(3);
  }, 30000);

  it('7. re-finalization (K12 for the season): a live season award that no longer matches re-records via staleAwardId to ~2; a dropped winner reverses to $0; a plain record is refused while a mismatched live award exists', async () => {
    await seedPool({ finalized: true });
    const places = (rows: any[]) => poolRef().update({ seasonPlaces: rows, seasonPrize: { pot: 60, places: [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }], entryCount: 3, payoutMode: 'SEASON', frozenAt: 1 } });
    await places([
      { entryId: ALICE, userId: ALICE, userName: ALICE, rank: 1, points: 90, prize: 36 },
      { entryId: BOB, userId: BOB, userName: BOB, rank: 2, points: 80, prize: 24 },
      { entryId: HOST, userId: HOST, userName: HOST, rank: 3, points: 10 },
    ]);
    await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 36, kind: 'PLACE', settled: true }, { uid: BOB, entryId: BOB, amount: 24, kind: 'PLACE', settled: false }]);
    // Rescore + re-finalize: BOB and ALICE swap; HOST unchanged.
    await places([
      { entryId: BOB, userId: BOB, userName: BOB, rank: 1, points: 95, prize: 36 },
      { entryId: ALICE, userId: ALICE, userName: ALICE, rank: 2, points: 90, prize: 24 },
      { entryId: HOST, userId: HOST, userName: HOST, rank: 3, points: 10 },
    ]);
    // Plain record against the new figure while the old live award exists → refused.
    await expect(record(HOST, [{ uid: BOB, entryId: BOB, amount: 36, kind: 'PLACE', settled: false }])).rejects.toThrow(/LIVE_AWARD_EXISTS/);
    // Re-record via staleAwardId → the base id for the NEW place is free, so it lands there; settlement carries over from the client-supplied value.
    const r1 = await record(HOST, [{ uid: BOB, entryId: BOB, amount: 36, kind: 'PLACE', settled: false, staleAwardId: 'season-pl-bob-p2' }]);
    expect(r1.awardIds).toEqual(['season-pl-bob-p1']);
    expect((await rec('season-pl-bob-p2')).data()!.supersededBy).toBe('season-pl-bob-p1');
    const r2 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 24, kind: 'PLACE', settled: true, staleAwardId: 'season-pl-alice-p1' }]);
    expect(r2.awardIds).toEqual(['season-pl-alice-p2']);
    // Repeat against the already-superseded stale id → returns the live end, writes nothing.
    const r3 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 24, kind: 'PLACE', settled: true, staleAwardId: 'season-pl-alice-p1' }]);
    expect(r3.awardIds).toEqual(['season-pl-alice-p2']); expect(r3.written).toBe(0);
    // A third re-finalization drops ALICE from the paid places → reverse to $0 at ~2 of her rank-2 id? No: reversal binds to rank 0 → base id 'season-pl-alice-p0'.
    await places([
      { entryId: BOB, userId: BOB, userName: BOB, rank: 1, points: 95, prize: 36 },
      { entryId: HOST, userId: HOST, userName: HOST, rank: 2, points: 92, prize: 24 },
      { entryId: ALICE, userId: ALICE, userName: ALICE, rank: 3, points: 90 },
    ]);
    const r4 = await record(HOST, [{ uid: ALICE, entryId: ALICE, amount: 0, kind: 'PLACE', settled: true, staleAwardId: 'season-pl-alice-p2' }]);
    expect(r4.written).toBe(1);
    const liveAlice = (await poolRef().collection('payoutRecords').where('entryId', '==', ALICE).get()).docs.filter(d => !d.data().supersededBy);
    expect(liveAlice.map(d => d.data().amount)).toEqual([0]);
    // Exactly one live award per entry, and the live season total never exceeds the frozen pot.
    const live = (await poolRef().collection('payoutRecords').get()).docs.filter(d => !d.data().supersededBy && d.id.startsWith('season-'));
    expect(live.map(d => [d.data().entryId, d.data().amount]).sort()).toEqual([[ALICE, 0], [BOB, 36]]);
  }, 30000);
});
