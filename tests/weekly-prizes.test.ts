import { describe, it, expect } from 'vitest';
import { rankWeeklyPlaces, computeWeeklyPrizeSnapshot, priceWeeklyPlaces } from '../shared/weeklyPrizes';

/**
 * PLAN-WEEKLY-PRIZES §3, §9 A1–A5 — the pure half of the Weekly Winners List.
 * The persisted half (recap fields, the freeze across a rescore, fail-closed) is
 * pinned in functions/src/__tests__/emulator/autoScore.emulator.test.ts.
 */

const c = (entryId: string, points: number, tiebreakDiff?: number, userId = entryId) => ({
  entryId, userId, userName: userId.toUpperCase(), points,
  ...(tiebreakDiff === undefined ? {} : { tiebreakDiff }),
});

describe('rankWeeklyPlaces — full competition ranking (A2)', () => {
  it('points desc, then tiebreakDiff asc, residual ties share and the next rank skips (1,1,3)', () => {
    const r = rankWeeklyPlaces([c('a', 10, 3), c('b', 12), c('d', 10, 3), c('e', 10, 7), c('f', 2)]);
    expect(r.map(p => [p.entryId, p.rank])).toEqual([['b', 1], ['a', 2], ['d', 2], ['e', 4], ['f', 5]]);
  });
  it('no prediction ranks BELOW any prediction at the same points — never coerced to 0', () => {
    const r = rankWeeklyPlaces([c('none', 10), c('far', 10, 40), c('close', 10, 1)]);
    expect(r.map(p => [p.entryId, p.rank])).toEqual([['close', 1], ['far', 2], ['none', 3]]);
    expect('tiebreakDiff' in r[2]).toBe(false);
  });
  it('two entries with no prediction and the same points share a rank', () => {
    const r = rankWeeklyPlaces([c('x', 5), c('y', 5)]);
    expect(r.map(p => p.rank)).toEqual([1, 1]);
  });
  it('is keyed by ENTRY: two entries of one owner are two rows (A1 — the multi-entry fixture)', () => {
    const r = rankWeeklyPlaces([c('u1', 9, 2, 'u1'), c('e2:u1', 11, undefined, 'u1'), c('u2', 9, 5, 'u2')]);
    expect(r.map(p => [p.entryId, p.userId, p.rank])).toEqual([['e2:u1', 'u1', 1], ['u1', 'u1', 2], ['u2', 'u2', 3]]);
  });
  it('input order does not matter', () => {
    const a = rankWeeklyPlaces([c('a', 1), c('b', 3), c('c', 3, 2)]);
    const b = rankWeeklyPlaces([c('c', 3, 2), c('a', 1), c('b', 3)]);
    expect(a).toEqual(b);
  });
  it('empty → []', () => {
    expect(rankWeeklyPlaces([])).toEqual([]);
  });
});

describe('computeWeeklyPrizeSnapshot — the frozen OUTPUT (§3b-i, A3, A4)', () => {
  it('HYBRID #423 example over 18 weeks: $180 weekly total → $10 pot; snapshot carries the places, entryCount, weeks', () => {
    const s = computeWeeklyPrizeSnapshot(
      { payoutMode: 'HYBRID', entryFee: 25, hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 }, payouts: { places: [{ rank: 1, percentage: 100 }] } },
      10, 18, 1234,
    )!;
    expect(s).toEqual({ pot: 10, places: [{ rank: 1, percentage: 100 }], entryCount: 10, weeksInSeason: 18, payoutMode: 'HYBRID', frozenAt: 1234 });
  });
  it('HYBRID prefers weeklyPayouts over payouts (A4 / LEDGER D1)', () => {
    const s = computeWeeklyPrizeSnapshot(
      { payoutMode: 'HYBRID', entryFee: 25, hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 }, payouts: { places: [{ rank: 1, percentage: 100 }] }, weeklyPayouts: { places: [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }] } },
      10, 18, 0,
    )!;
    expect(s.places).toEqual([{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }]);
  });
  it('WEEKLY: whole net pot ÷ weeks; charity off first', () => {
    const s = computeWeeklyPrizeSnapshot({ payoutMode: 'WEEKLY', entryFee: 20, charity: { enabled: true, percentage: 10 }, payouts: { places: [] } }, 5, 4, 0)!;
    // gross 100, cut 10, net 90, ÷ 4 = 22
    expect(s.pot).toBe(22);
  });
  it('SEASON, HYBRID-without-split, no fee, no entries, unknown weeks → undefined (list publishes with no prize — D7)', () => {
    expect(computeWeeklyPrizeSnapshot({ payoutMode: 'SEASON', entryFee: 20, payouts: { places: [] } }, 5, 4, 0)).toBeUndefined();
    expect(computeWeeklyPrizeSnapshot({ payoutMode: 'HYBRID', entryFee: 20, payouts: { places: [] } }, 5, 4, 0)).toBeUndefined();
    expect(computeWeeklyPrizeSnapshot({ payoutMode: 'WEEKLY', entryFee: 0, payouts: { places: [] } }, 5, 4, 0)).toBeUndefined();
    expect(computeWeeklyPrizeSnapshot({ payoutMode: 'WEEKLY', entryFee: 20, payouts: { places: [] } }, 0, 4, 0)).toBeUndefined();
    expect(computeWeeklyPrizeSnapshot({ payoutMode: 'WEEKLY', entryFee: 20, payouts: { places: [] } }, 5, undefined, 0)).toBeUndefined();
  });
});

describe('priceWeeklyPlaces — prizes on the ranked list from a frozen snapshot (§4)', () => {
  const snap = { pot: 30, places: [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }], entryCount: 3, weeksInSeason: 2, payoutMode: 'WEEKLY' as const, frozenAt: 0 };
  it('A alone first → 18; B and C tied at 2 consume 2+3 → 12 split → 6 each; remainder named', () => {
    const rows = rankWeeklyPlaces([c('a', 2), c('b', 1), c('c', 1)]);
    const r = priceWeeklyPlaces(rows, snap);
    expect(r.rows.map(p => [p.entryId, p.prize])).toEqual([['a', 18], ['b', 6], ['c', 6]]);
    expect(r.awarded).toBe(30);
    expect(r.remainder).toBe(0);
  });
  it('unpaid ranks carry NO prize key (Firestore-safe), and a zero pot prices nobody', () => {
    const rows = rankWeeklyPlaces([c('a', 2), c('b', 1), c('c', 0)]);
    const r = priceWeeklyPlaces(rows, snap);
    expect('prize' in r.rows[2]).toBe(false);
    const z = priceWeeklyPlaces(rows, { ...snap, pot: 0 });
    expect(z.rows.every(p => !('prize' in p))).toBe(true);
  });
  it('THROWS on a malformed place list (the scorer publishes fail-closed, A5)', () => {
    const rows = rankWeeklyPlaces([c('a', 2)]);
    expect(() => priceWeeklyPlaces(rows, { ...snap, places: [{ rank: 1, percentage: 50 }, { rank: 1, percentage: 30 }] })).toThrow(/PRIZE_SPLIT_DUPLICATE_RANK/);
  });
});
