import { describe, it, expect } from 'vitest';
import { splitPrizes, placePrize } from '../shared/prizeSplit';

/**
 * PLAN-WEEKLY-PRIZES §4 (B3, D6 — signed 2026-08-15). k players tied at place p
 * consume places p..p+k-1; those prizes sum and split evenly in whole dollars;
 * the next player lands at p+k. §4c lists the invariants that WILL be got wrong;
 * every one is pinned here.
 */

const P3 = [
  { rank: 1, percentage: 50 },
  { rank: 2, percentage: 30 },
  { rank: 3, percentage: 20 },
];

describe('splitPrizes — the §4a rule', () => {
  it('k = 1 reduces to the untied case, exactly', () => {
    const r = splitPrizes({ places: P3, pot: 100, ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 3 }] });
    expect(r.awards).toEqual({ a: 50, b: 30, c: 20 });
    expect(r.awarded).toBe(100);
    expect(r.remainder).toBe(0);
  });

  it('two tied for 1st: (1st + 2nd) ÷ 2 each; next player is 3rd', () => {
    const r = splitPrizes({ places: P3, pot: 100, ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 }, { id: 'c', rank: 3 }] });
    expect(r.awards).toEqual({ a: 40, b: 40, c: 20 });
  });

  it('three tied for 1st: (1st + 2nd + 3rd) ÷ 3 each; next player is 4th and unpaid', () => {
    const r = splitPrizes({
      places: P3, pot: 100,
      ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 }, { id: 'c', rank: 1 }, { id: 'd', rank: 4 }],
    });
    expect(r.awards).toEqual({ a: 33, b: 33, c: 33, d: 0 });
    expect(r.remainder).toBe(1); // named, never handed to first place (D6)
  });

  it('§3a worked example: pay-to-3, three tied at 2 consume 2,3,4 — paid 2+3 split THREE ways, nobody dropped', () => {
    const r = splitPrizes({
      places: P3, pot: 100,
      ranked: [{ id: 'w', rank: 1 }, { id: 'a', rank: 2 }, { id: 'b', rank: 2 }, { id: 'c', rank: 2 }, { id: 'e', rank: 5 }],
    });
    expect(r.awards).toEqual({ w: 50, a: 16, b: 16, c: 16, e: 0 });
    expect(r.remainder).toBe(2);
  });

  it('a tie spanning the last paid place consumes only the places that exist (three tied for 2nd in a two-place payout split 2nd alone, three ways)', () => {
    const places = [{ rank: 1, percentage: 60 }, { rank: 2, percentage: 40 }];
    const r = splitPrizes({ places, pot: 100, ranked: [{ id: 'w', rank: 1 }, { id: 'a', rank: 2 }, { id: 'b', rank: 2 }, { id: 'c', rank: 2 }] });
    expect(r.awards).toEqual({ w: 60, a: 13, b: 13, c: 13 });
  });

  it('a tie entirely below the last paid place awards nothing and does not throw', () => {
    const r = splitPrizes({ places: [{ rank: 1, percentage: 100 }], pot: 100, ranked: [{ id: 'w', rank: 1 }, { id: 'a', rank: 2 }, { id: 'b', rank: 2 }] });
    expect(r.awards).toEqual({ w: 100, a: 0, b: 0 });
  });

  it('sparse, unordered ranks are honoured verbatim ([{rank:3},{rank:1}])', () => {
    const r = splitPrizes({ places: [{ rank: 3, percentage: 20 }, { rank: 1, percentage: 50 }], pot: 100, ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 3 }] });
    expect(r.awards).toEqual({ a: 50, b: 0, c: 20 });
    expect(r.remainder).toBe(30);
  });

  it('ordering independence — the same ranked set in a different order yields identical awards', () => {
    const ranked = [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 }, { id: 'c', rank: 3 }, { id: 'd', rank: 3 }];
    const x = splitPrizes({ places: P3, pot: 97, ranked });
    const y = splitPrizes({ places: P3, pot: 97, ranked: [...ranked].reverse() });
    expect(x).toEqual(y);
  });

  it('never negative, never NaN: empty places / empty ranked / zero pot', () => {
    expect(splitPrizes({ places: [], pot: 100, ranked: [{ id: 'a', rank: 1 }] })).toEqual({ awards: { a: 0 }, awarded: 0, remainder: 100 });
    expect(splitPrizes({ places: P3, pot: 100, ranked: [] })).toEqual({ awards: {}, awarded: 0, remainder: 100 });
    const z = splitPrizes({ places: P3, pot: 0, ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 }] });
    expect(z).toEqual({ awards: { a: 0, b: 0 }, awarded: 0, remainder: 0 });
  });

  it('property: Σ awarded ≤ pot for random tie arrangements', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let t = 0; t < 300; t++) {
      const pot = Math.floor(rnd() * 500);
      const n = 1 + Math.floor(rnd() * 8);
      const ranked: { id: string; rank: number }[] = [];
      let rank = 1;
      while (ranked.length < n) {
        const k = 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < k && ranked.length < n; i++) ranked.push({ id: `e${ranked.length}`, rank });
        rank = ranked.length + 1;
      }
      const r = splitPrizes({ places: P3, pot, ranked });
      expect(r.awarded).toBeLessThanOrEqual(pot);
      expect(r.remainder).toBeGreaterThanOrEqual(0);
      expect(Object.values(r.awards).every(v => Number.isInteger(v) && v >= 0)).toBe(true);
    }
  });
});

describe('splitPrizes — refuses ambiguous input (§4b: throw, never guess)', () => {
  it('duplicate ranks throw', () => {
    expect(() => splitPrizes({ places: [{ rank: 1, percentage: 50 }, { rank: 1, percentage: 20 }], pot: 100, ranked: [] })).toThrow(/DUPLICATE_RANK/);
  });
  it('percentages past 100 throw', () => {
    expect(() => splitPrizes({ places: [{ rank: 1, percentage: 70 }, { rank: 2, percentage: 40 }], pot: 100, ranked: [] })).toThrow(/OVER_100/);
  });
  it('tolerates float noise summing to 100', () => {
    expect(() => splitPrizes({ places: [{ rank: 1, percentage: 33.3 }, { rank: 2, percentage: 33.3 }, { rank: 3, percentage: 33.4 }], pot: 100, ranked: [] })).not.toThrow();
  });
  it('a negative or NaN pot throws', () => {
    expect(() => splitPrizes({ places: P3, pot: -1, ranked: [] })).toThrow(/BAD_POT/);
    expect(() => splitPrizes({ places: P3, pot: NaN, ranked: [] })).toThrow(/BAD_POT/);
  });
  it('a malformed ranking that would double-consume a place throws (dense 1,2,2,3; overlap 1,1,2) — qodo #6 on #451', () => {
    expect(() => splitPrizes({ places: P3, pot: 100, ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 2 }, { id: 'd', rank: 3 }] })).toThrow(/RANK_OVERLAP/);
    expect(() => splitPrizes({ places: P3, pot: 100, ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 }, { id: 'c', rank: 2 }] })).toThrow(/RANK_OVERLAP/);
    // Gaps are fine (a subset of the ranking): 1 then 5.
    expect(splitPrizes({ places: P3, pot: 100, ranked: [{ id: 'a', rank: 1 }, { id: 'e', rank: 5 }] }).awards).toEqual({ a: 50, e: 0 });
  });
  it('an entry id of __proto__ (a legal Firestore doc id) keeps its award — codex r2 on #451', () => {
    const r = splitPrizes({ places: P3, pot: 100, ranked: [{ id: '__proto__', rank: 1 }, { id: 'b', rank: 2 }] });
    expect(r.awards['__proto__']).toBe(50);
    expect(Object.keys(r.awards)).toEqual(['__proto__', 'b']);
  });
  it('a duplicate entry id throws', () => {
    expect(() => splitPrizes({ places: P3, pot: 100, ranked: [{ id: 'a', rank: 1 }, { id: 'a', rank: 1 }] })).toThrow(/DUPLICATE_ID/);
  });
  it('a non-positive-integer rank in places or in ranked throws', () => {
    expect(() => splitPrizes({ places: [{ rank: 0, percentage: 10 }], pot: 10, ranked: [] })).toThrow(/BAD_RANK/);
    expect(() => splitPrizes({ places: P3, pot: 10, ranked: [{ id: 'a', rank: 1.5 }] })).toThrow(/BAD_ENTRY_RANK/);
  });
});

describe('placePrize', () => {
  it('floors like PayoutsPanel', () => {
    expect(placePrize(97, 33)).toBe(32);
    expect(placePrize(0, 50)).toBe(0);
  });
});
