import { describe, it, expect } from 'vitest';
import { computeSeasonPrizeSnapshot, priceSeasonPlaces, seasonAwardId } from '../shared/seasonPrizes';

/**
 * PLAN-WEEKLY-PRIZES step 3 — the pure half of the Season Places list. The
 * publication (pool fields at finalization) is pinned in
 * functions/src/__tests__/nflFinalize.test.ts; the callable binding in
 * functions/src/__tests__/emulator/payoutLedger.emulator.test.ts case 6.
 */
const place = (entryId: string, rank: number) => ({ entryId, userId: entryId, userName: entryId.toUpperCase(), rank, points: 0 });

describe('computeSeasonPrizeSnapshot', () => {
  it('SEASON: pot = net; HYBRID: pot = net − weekly allocation; WEEKLY / no split / no fee / no places → undefined', () => {
    const places = { places: [{ rank: 1, percentage: 100 }] };
    expect(computeSeasonPrizeSnapshot({ payoutMode: 'SEASON', entryFee: 20, payouts: places }, 4, 1)).toMatchObject({ pot: 80, entryCount: 4, payoutMode: 'SEASON', frozenAt: 1 });
    expect(computeSeasonPrizeSnapshot({ payoutMode: 'HYBRID', entryFee: 20, hybridSplit: { weeklyPerEntry: 10, seasonPerEntry: 10 }, payouts: places }, 4, 1)).toMatchObject({ pot: 40, payoutMode: 'HYBRID' });
    expect(computeSeasonPrizeSnapshot({ payoutMode: 'WEEKLY', entryFee: 20, payouts: places }, 4, 1)).toBeUndefined();
    expect(computeSeasonPrizeSnapshot({ payoutMode: 'HYBRID', entryFee: 20, payouts: places }, 4, 1)).toBeUndefined();
    expect(computeSeasonPrizeSnapshot({ payoutMode: 'SEASON', entryFee: 0, payouts: places }, 4, 1)).toBeUndefined();
    expect(computeSeasonPrizeSnapshot({ payoutMode: 'SEASON', entryFee: 20, payouts: { places: [] } }, 4, 1)).toBeUndefined();
    expect(computeSeasonPrizeSnapshot({ payoutMode: 'SEASON', entryFee: 20, payouts: places }, undefined, 1)).toBeUndefined();
  });
  it('an ABSENT payoutMode (Survivor / legacy pools) is one season pot = net, published as SEASON (codex r5 on #464)', () => {
    expect(computeSeasonPrizeSnapshot({ entryFee: 25, payouts: { places: [{ rank: 1, percentage: 100 }] } }, 4, 1)).toMatchObject({ pot: 100, payoutMode: 'SEASON' });
  });
  it('charity comes off first', () => {
    expect(computeSeasonPrizeSnapshot({ payoutMode: 'SEASON', entryFee: 20, charity: { enabled: true, percentage: 10 }, payouts: { places: [{ rank: 1, percentage: 100 }] } }, 4, 1)?.pot).toBe(72);
  });
});

describe('priceSeasonPlaces', () => {
  it('shared ranks split the places they cover; unpaid ranks carry no prize; remainder is named', () => {
    const snap = { pot: 80, places: [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }], entryCount: 4, payoutMode: 'SEASON' as const, frozenAt: 1 };
    const { rows, awarded, remainder } = priceSeasonPlaces([place('a', 1), place('b', 1), place('c', 3)], snap);
    expect(rows.map(r => [r.entryId, r.prize])).toEqual([['a', 40], ['b', 40], ['c', undefined]]);
    expect(awarded).toBe(80); expect(remainder).toBe(0);
  });
  it('throws on a malformed place list (the caller publishes fail-closed)', () => {
    const snap = { pot: 80, places: [{ rank: 1, percentage: 60 }, { rank: 1, percentage: 40 }], entryCount: 4, payoutMode: 'SEASON' as const, frozenAt: 1 };
    expect(() => priceSeasonPlaces([place('a', 1)], snap)).toThrow();
  });
});

describe('seasonAwardId', () => {
  it('is deterministic per (entry, place) and distinct from weekly ids', () => {
    expect(seasonAwardId('e1', 2)).toBe('season-e1-p2');
  });
});
