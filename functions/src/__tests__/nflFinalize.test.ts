import { describe, it, expect } from 'vitest';
import { computeFinalRanks, seasonPlacesPublication } from '../nflFinalize';

// PLAN-PLAYER-PROFILES Phase 3 (ADR 0005 decision 2): final rank derivation per
// NFL pool type. Pure-function coverage; the finalize write path + sweep run
// against the emulator/dev harness.

const pickem = (uid: string, totalScore: number, weeklyResults?: any) => ({
  id: uid, ownerUid: uid, userName: uid, totalScore, weeklyResults,
});

describe('computeFinalRanks — NFL_PICKEM', () => {
  it('ranks by totalScore desc; ties share a rank (competition ranking)', () => {
    const rows = computeFinalRanks('NFL_PICKEM', [
      pickem('a', 90), pickem('b', 100), pickem('c', 90), pickem('d', 80),
    ]);
    const byUid = Object.fromEntries(rows.map(r => [r.entry.ownerUid, r.rank]));
    expect(byUid).toEqual({ b: 1, a: 2, c: 2, d: 4 });
    expect(rows.every(r => r.points === r.entry.totalScore)).toBe(true);
  });

  it('sums the season W-L record from weeklyResults', () => {
    const rows = computeFinalRanks('NFL_PICKEM', [
      pickem('a', 20, { 1: { correct: 9, total: 14 }, 2: { correct: 11, total: 16 } }),
    ]);
    expect(rows[0].record).toEqual({ correct: 20, total: 30 });
  });
});

describe('computeFinalRanks — NFL_SURVIVOR', () => {
  const survivor = (uid: string, over: any) => ({
    id: uid, ownerUid: uid, userName: uid, status: 'ELIMINATED', strikesUsed: 0, ...over,
  });

  it('alive entries are co-champions at rank 1; eliminated ranked by week desc', () => {
    const rows = computeFinalRanks('NFL_SURVIVOR', [
      survivor('out5', { eliminatedWeek: 5 }),
      survivor('alive1', { status: 'ALIVE' }),
      survivor('out12', { eliminatedWeek: 12 }),
      survivor('alive2', { status: 'ALIVE' }),
    ]);
    const byUid = Object.fromEntries(rows.map(r => [r.entry.ownerUid, r.rank]));
    expect(byUid.alive1).toBe(1);
    expect(byUid.alive2).toBe(1);
    expect(byUid.out12).toBe(3); // lasted longer than out5
    expect(byUid.out5).toBe(4);
  });

  it('same eliminatedWeek + strikes tie; record carries survival stats', () => {
    const rows = computeFinalRanks('NFL_SURVIVOR', [
      survivor('x', { eliminatedWeek: 7, strikesUsed: 2, weeklyResults: { 1: { survived: true }, 2: { survived: false } } }),
      survivor('y', { eliminatedWeek: 7, strikesUsed: 2 }),
    ]);
    expect(rows[0].rank).toBe(rows[1].rank);
    const x = rows.find(r => r.entry.ownerUid === 'x')!;
    expect(x.record).toEqual({ survivedWeeks: 1, strikes: 2, eliminatedWeek: 7, alive: false });
  });
});

describe('computeFinalRanks — NFL_MARGIN', () => {
  const margin = (uid: string, over: any) => ({
    id: uid, ownerUid: uid, userName: uid,
    seasonTotal: 0, negativeBurden: 0, positiveWeeks: 0, bestWeek: 0, ...over,
  });

  it('uses the 5-level cascade (seasonTotal, then negativeBurden)', () => {
    const rows = computeFinalRanks('NFL_MARGIN', [
      margin('low', { seasonTotal: 10 }),
      margin('highBurden', { seasonTotal: 40, negativeBurden: 20 }),
      margin('cleanest', { seasonTotal: 40, negativeBurden: 5 }),
    ]);
    expect(rows.map(r => r.entry.ownerUid)).toEqual(['cleanest', 'highBurden', 'low']);
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3]);
    expect(rows[0].record).toEqual({ seasonTotal: 40 });
  });
});

describe('computeFinalRanks — season-tie cascade (PLAN-WEEKLY-PRIZES §2c / D4, step 3)', () => {
  it("Pick'em: level on totalScore → most correct picks ranks higher; still level → SHARE the rank, next rank skips", () => {
    const rows = computeFinalRanks('NFL_PICKEM', [
      pickem('fewer', 30, { 1: { correct: 8, total: 16 }, 2: { correct: 9, total: 16 } }),
      pickem('more', 30, { 1: { correct: 10, total: 16 }, 2: { correct: 10, total: 16 } }),
      pickem('twin', 30, { 1: { correct: 10, total: 16 }, 2: { correct: 10, total: 16 } }),
      pickem('last', 5, { 1: { correct: 5, total: 16 } }),
    ]);
    expect(rows.map(r => [r.entry.ownerUid, r.rank])).toEqual([['more', 1], ['twin', 1], ['fewer', 3], ['last', 4]]);
    // The tie-break never re-orders across a points gap.
    expect(rows[3].points).toBe(5);
  });
  it('Margin: negativeBurden → positiveWeeks → bestWeek in that order; the uid step orders rows but never separates a rank', () => {
    const margin = (uid: string, over: any) => ({ id: uid, ownerUid: uid, userName: uid, seasonTotal: 40, negativeBurden: 5, positiveWeeks: 3, bestWeek: 20, ...over });
    const rows = computeFinalRanks('NFL_MARGIN', [
      margin('z-twin', {}),
      margin('a-twin', {}),
      margin('fewerPos', { positiveWeeks: 2 }),
      margin('lowerBest', { bestWeek: 10 }),
      margin('burden', { negativeBurden: 9, positiveWeeks: 9, bestWeek: 99 }),
    ]);
    expect(rows.map(r => [r.entry.ownerUid, r.rank])).toEqual([['a-twin', 1], ['z-twin', 1], ['lowerBest', 3], ['fewerPos', 4], ['burden', 5]]);
  });
});

describe('seasonPlacesPublication — the pool-doc publication at finalization (step 3)', () => {
  const ranked = (uids: Array<[string, number, number]>) => uids.map(([uid, rank, points]) => ({ entry: { id: uid, ownerUid: uid, userName: uid.toUpperCase() }, rank, points }));
  it('SEASON pool: prices from settings.payouts.places on the season pot; ties split; frozen snapshot carried', () => {
    const pool = { entryCount: 4, settings: { payoutMode: 'SEASON', entryFee: 20, payouts: { places: [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }] } } };
    const pub = seasonPlacesPublication(pool, ranked([['a', 1, 100], ['b', 1, 100], ['c', 3, 50]]), 4);
    expect(pub.seasonPlacesError).toBeUndefined();
    expect(pub.seasonPrize).toMatchObject({ pot: 80, entryCount: 4, payoutMode: 'SEASON' });
    // 60% + 40% of $80 = $80 shared by the two rank-1 entries → $40 each; rank 3 unpaid.
    expect(pub.seasonPlaces.map(p => [p.entryId, p.rank, p.prize])).toEqual([['a', 1, 40], ['b', 1, 40], ['c', 3, undefined]]);
  });
  it('WEEKLY pool: publishes the ranking UNPRICED (seasonPrize null)', () => {
    const pub = seasonPlacesPublication({ entryCount: 3, settings: { payoutMode: 'WEEKLY', entryFee: 20, payouts: { places: [{ rank: 1, percentage: 100 }] } } }, ranked([['a', 1, 9]]), 3);
    expect(pub.seasonPrize).toBeNull();
    expect(pub.seasonPlaces[0].prize).toBeUndefined();
  });
  it('an existing seasonPrize on the pool is reused verbatim — never re-priced', () => {
    const frozen = { pot: 10, places: [{ rank: 1, percentage: 100 }], entryCount: 1, payoutMode: 'SEASON' as const, frozenAt: 1 };
    const pub = seasonPlacesPublication({ seasonPrize: frozen, entryCount: 99, settings: { payoutMode: 'SEASON', entryFee: 500, payouts: { places: [{ rank: 1, percentage: 100 }] } } }, ranked([['a', 1, 9]]), 99);
    expect(pub.seasonPrize).toBe(frozen);
    expect(pub.seasonPlaces[0].prize).toBe(10);
  });
  it('a malformed place list publishes the ranking with seasonPlacesError and no prize (fail-closed)', () => {
    const pub = seasonPlacesPublication({ entryCount: 2, settings: { payoutMode: 'SEASON', entryFee: 20, payouts: { places: [{ rank: 1, percentage: 60 }, { rank: 1, percentage: 40 }] } } }, ranked([['a', 1, 9], ['b', 2, 8]]), 2);
    expect(pub.seasonPlacesError).toBeTruthy();
    expect(pub.seasonPrize).toBeUndefined();
    expect(pub.seasonPlaces.every(p => p.prize === undefined)).toBe(true);
  });
});

describe('computeFinalRanks — non-NFL types', () => {
  it('returns nothing (finalize never touches other pool types)', () => {
    expect(computeFinalRanks('BRACKET', [pickem('a', 1)])).toEqual([]);
  });
});
