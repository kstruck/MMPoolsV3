import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { potBreakdown, perWeekPrizePot, charityFactor, weeklyPlacesFor } from '../shared/prizePot';

/**
 * PLAN-PAYMENT-LEDGER R5 / PLAN-WEEKLY-PRIZES §3b: ONE set of pot maths for the
 * member Payouts panel, the weekly prize list and the ledger, with TWO named
 * units — the season-long weekly allocation ("weekly total") and the per-week
 * prize pot. Only the latter prices a weekly award. Pinned on the #423 example.
 */

const HYBRID_423 = { payoutMode: 'HYBRID', entryFee: 25, hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 } };

describe('potBreakdown — byte-identical to PayoutsPanel (#423)', () => {
  it('the #423 example: $25 = $18 + $7, 10 entries → weekly total $180, season $70', () => {
    const p = potBreakdown(HYBRID_423, 10)!;
    expect(p).toEqual({ gross: 250, charityCut: 0, net: 250, charityFactor: 1, weeklySeasonAllocation: 180, seasonPot: 70 });
  });

  it('charity comes off BEFORE percentages, floored, and the season pot absorbs the remainder (codex r4/r5 on #423)', () => {
    // 10% charity on $230 gross = $23 cut → net $207; weekly floor(18×10×0.9)=162; season 207−162=45
    const p = potBreakdown({ ...HYBRID_423, entryFee: 23, hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 5 }, charity: { enabled: true, percentage: 10 } }, 10)!;
    expect(p.gross).toBe(230);
    expect(p.charityCut).toBe(23);
    expect(p.net).toBe(207);
    expect(p.weeklySeasonAllocation).toBe(162);
    expect(p.seasonPot).toBe(45);
    expect(p.weeklySeasonAllocation! + p.seasonPot!).toBe(p.net);
  });

  it('WEEKLY: the whole net pot is the weekly allocation; SEASON: the whole net pot is the season pot', () => {
    expect(potBreakdown({ payoutMode: 'WEEKLY', entryFee: 20 }, 5)).toMatchObject({ net: 100, weeklySeasonAllocation: 100 });
    expect(potBreakdown({ payoutMode: 'WEEKLY', entryFee: 20 }, 5)!.seasonPot).toBeUndefined();
    expect(potBreakdown({ payoutMode: 'SEASON', entryFee: 20 }, 5)).toMatchObject({ net: 100, seasonPot: 100 });
    expect(potBreakdown({ payoutMode: 'SEASON', entryFee: 20 }, 5)!.weeklySeasonAllocation).toBeUndefined();
  });

  it('HYBRID without a declared split has no separately-known pots (the "ask your commissioner" fallback)', () => {
    const p = potBreakdown({ payoutMode: 'HYBRID', entryFee: 25 }, 10)!;
    expect(p.net).toBe(250);
    expect(p.weeklySeasonAllocation).toBeUndefined();
    expect(p.seasonPot).toBeUndefined();
  });

  it('never guesses: no fee, or no/zero entries → undefined', () => {
    expect(potBreakdown(HYBRID_423, undefined)).toBeUndefined();
    expect(potBreakdown(HYBRID_423, 0)).toBeUndefined();
    expect(potBreakdown({ payoutMode: 'WEEKLY', entryFee: 0 }, 10)).toBeUndefined();
  });

  it('charityFactor', () => {
    expect(charityFactor(undefined)).toBe(1);
    expect(charityFactor({ enabled: false, percentage: 50 })).toBe(1);
    expect(charityFactor({ enabled: true, percentage: 10 })).toBeCloseTo(0.9);
  });
});

describe('perWeekPrizePot — the ONLY figure that prices a weekly award', () => {
  it('#423 example over an 18-week season: $180 ÷ 18 = $10 per week; over a 4-week preseason: $45', () => {
    expect(perWeekPrizePot(180, 18)).toBe(10);
    expect(perWeekPrizePot(180, 4)).toBe(45);
  });
  it('floors', () => {
    expect(perWeekPrizePot(100, 18)).toBe(5);
  });
  it('unknown allocation or invalid weeks → undefined (never a hardcoded 18)', () => {
    expect(perWeekPrizePot(undefined, 18)).toBeUndefined();
    expect(perWeekPrizePot(180, 0)).toBeUndefined();
    expect(perWeekPrizePot(180, undefined)).toBeUndefined();
    expect(perWeekPrizePot(180, 2.5)).toBeUndefined();
  });
});

describe('weeklyPlacesFor — the selector (§9 A4 / LEDGER D1 mode matrix)', () => {
  const season = [{ rank: 1, percentage: 100 }];
  const weekly = [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }];
  it("HYBRID with weeklyPayouts → the weekly list; without → payouts (today's behaviour, verbatim)", () => {
    expect(weeklyPlacesFor({ payoutMode: 'HYBRID', payouts: { places: season }, weeklyPayouts: { places: weekly } })).toBe(weekly);
    expect(weeklyPlacesFor({ payoutMode: 'HYBRID', payouts: { places: season } })).toBe(season);
  });
  it('WEEKLY → payouts even if a stray weeklyPayouts exists; SEASON → []', () => {
    expect(weeklyPlacesFor({ payoutMode: 'WEEKLY', payouts: { places: season }, weeklyPayouts: { places: weekly } })).toBe(season);
    expect(weeklyPlacesFor({ payoutMode: 'SEASON', payouts: { places: season } })).toEqual([]);
  });
  it('missing settings → []', () => {
    expect(weeklyPlacesFor(undefined)).toEqual([]);
  });
});

describe('PayoutsPanel reads the shared helper (R5 — one implementation)', () => {
  it('imports potBreakdown from @shared/prizePot and no longer floors its own pots', () => {
    const src = readFileSync(resolve(__dirname, '../src/components/PayoutsPanel.tsx'), 'utf8');
    expect(src).toContain("import { potBreakdown } from '@shared/prizePot'");
    // The entry-fee block must not carry a private copy of the HYBRID split maths.
    expect(src).not.toMatch(/Math\.floor\(\(split\.weeklyPerEntry/);
  });
});
