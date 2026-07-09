import { describe, it, expect } from 'vitest';
import { computeFinalRanks } from '../nflFinalize';

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

describe('computeFinalRanks — non-NFL types', () => {
  it('returns nothing (finalize never touches other pool types)', () => {
    expect(computeFinalRanks('BRACKET', [pickem('a', 1)])).toEqual([]);
  });
});
