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
  const src = readFileSync(resolve(__dirname, '../src/components/PayoutsPanel.tsx'), 'utf8');
  it('imports potBreakdown from @shared/prizePot and no longer floors its own pots', () => {
    expect(src).toContain("import { potBreakdown, weeklyPlacesFor } from '@shared/prizePot'");
    // The entry-fee block must not carry a private copy of the HYBRID split maths.
    expect(src).not.toMatch(/Math\.floor\(\(split\.weeklyPerEntry/);
  });

  /**
   * PLAN-PAYMENT-LEDGER T2 / D1. The panel must not re-derive "which list
   * prices the weekly pot" — that is `weeklyPlacesFor`'s whole job, and a
   * second copy of the rule is how the join page and the ledger start printing
   * different prizes for the same pool.
   */
  it('picks the weekly places with weeklyPlacesFor and prices each pot from its OWN list (T2)', () => {
    expect(src).toContain('weeklyPlacesFor(settings)');
    // Two lists ⇒ two pot nouns; the combined "weekly total / season" line is
    // only correct while ONE list prices both pots.
    expect(src).toContain('potNoun="the weekly pot"');
    expect(src).toContain('potNoun="the season pot"');
    expect(src).toContain("separateWeekly = payoutMode === 'HYBRID' && Array.isArray(settings.weeklyPayouts?.places)");
  });

  /**
   * qodo #1 on #471, and the rule the repo accepted on #456: never print a
   * plausible substitute for data that is not there. A legacy HYBRID pool that
   * declared only one half of its split would have read as a real zero-dollar
   * allocation on the other half.
   */
  it('a MISSING half of the hybrid split is named, never printed as $0 (T2)', () => {
    expect(src).toContain('const perEntry = (n: number | undefined) =>');
    expect(src).toContain('an amount your commissioner has not set');
    expect(src).not.toContain('split.weeklyPerEntry ?? 0');
    expect(src).not.toContain('split.seasonPerEntry ?? 0');
  });

  /**
   * The #423 example under T2: $25 = $18 weekly + $7 season, 10 entries, and a
   * weekly list that is NOT the season list. Each place resolves against its
   * own pot — the figures the panel prints.
   */
  it('the #423 example with separate lists: $180 weekly pot 60/40, $70 season pot 100 (T2)', () => {
    const settings = {
      payoutMode: 'HYBRID' as const,
      entryFee: 25,
      hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 },
      payouts: { places: [{ rank: 1, percentage: 100 }] },
      weeklyPayouts: { places: [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }] },
    };
    const pots = potBreakdown(settings, 10)!;
    expect(pots.weeklySeasonAllocation).toBe(180);
    expect(pots.seasonPot).toBe(70);
    const weekly = weeklyPlacesFor(settings).map(p => Math.floor(pots.weeklySeasonAllocation! * (p.percentage / 100)));
    expect(weekly).toEqual([108, 72]);
    const season = settings.payouts.places.map(p => Math.floor(pots.seasonPot! * (p.percentage / 100)));
    expect(season).toEqual([70]);
  });
});
