import { describe, it, expect } from 'vitest';
import { payoutsSchema, weeklyPayoutsSchema } from '../shared/schemas/common';
import { pickemCreateInputSchema, marginCreateInputSchema, survivorCreateInputSchema } from '../shared/schemas/nfl';
import { normalizeCreatePayoutLists, normalizePayoutListsPatch, payoutListsNoOpKeys, payoutListsRefusal, touchesPayoutLists, weeklyPayoutsNeedsClearing } from '../lib/weeklyPayoutsGate';

/**
 * PLAN-PAYMENT-LEDGER T1 (D1, K9): `settings.weeklyPayouts` schema, unique
 * ranks on BOTH lists, and the updatePoolSettings gate (mode coherence +
 * HYBRID-exit clearing). The callable end-to-end is in
 * emulator/weeklyPayouts.emulator.test.ts; the rules parity in
 * scripts/survivorParitySettings.rules.test.mjs.
 */
const P = (rank: number, percentage: number) => ({ rank, percentage });

describe('payoutsSchema — unique ranks (K9)', () => {
  it('accepts distinct ranks and refuses a duplicate rank', () => {
    expect(payoutsSchema.safeParse({ places: [P(1, 60), P(2, 40)], bonuses: [] }).success).toBe(true);
    const r = payoutsSchema.safeParse({ places: [P(1, 60), P(1, 40)], bonuses: [] });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.success ? '' : r.error.issues)).toMatch(/PAYOUT_DUPLICATE_RANK/);
  });
  it('still refuses > 100 %', () => {
    expect(payoutsSchema.safeParse({ places: [P(1, 70), P(2, 40)], bonuses: [] }).success).toBe(false);
  });
});

describe('weeklyPayoutsSchema', () => {
  it('places only, ≤ 100 %, unique ranks; bonuses are not a thing (stripped)', () => {
    expect(weeklyPayoutsSchema.safeParse({ places: [P(1, 100)] }).success).toBe(true);
    expect(weeklyPayoutsSchema.safeParse({ places: [P(1, 60), P(2, 50)] }).success).toBe(false);
    expect(weeklyPayoutsSchema.safeParse({ places: [P(1, 50), P(1, 50)] }).success).toBe(false);
    const r = weeklyPayoutsSchema.safeParse({ places: [P(1, 100)], bonuses: [{ percentage: 5 }] });
    expect(r.success && !('bonuses' in r.data)).toBe(true);
  });
});

describe('create schemas — weeklyPayouts is HYBRID-only (D1)', () => {
  const basePickem = { name: 'p', type: 'NFL_PICKEM' as const, season: '2026', settings: { entryFee: 20, payouts: { places: [P(1, 100)], bonuses: [] } } };
  it("Pick'em: accepted on HYBRID with a coherent split; refused on SEASON / WEEKLY", () => {
    const hybrid = { ...basePickem, settings: { ...basePickem.settings, payoutMode: 'HYBRID', hybridSplit: { weeklyPerEntry: 10, seasonPerEntry: 10 }, weeklyPayouts: { places: [P(1, 100)] } } };
    expect(pickemCreateInputSchema.safeParse(hybrid).success).toBe(true);
    for (const mode of ['SEASON', 'WEEKLY'] as const) {
      const r = pickemCreateInputSchema.safeParse({ ...basePickem, settings: { ...basePickem.settings, payoutMode: mode, weeklyPayouts: { places: [P(1, 100)] } } });
      expect(r.success, mode).toBe(false);
      expect(JSON.stringify(r.success ? '' : r.error.issues)).toMatch(/WEEKLY_PAYOUTS_WRONG_MODE/);
    }
  });
  it('Margin: weeklyPayouts on a WEEKLY-mode pool is refused (WRONG_MODE)', () => {
    const m = { name: 'm', type: 'NFL_MARGIN' as const, season: '2026', settings: { entryFee: 20, payouts: { places: [P(1, 100)], bonuses: [] }, payoutMode: 'WEEKLY', weeklyPayouts: { places: [P(1, 100)] } } };
    expect(marginCreateInputSchema.safeParse(m).success).toBe(false);
  });
  it('Survivor: has no payoutMode, so an unknown weeklyPayouts key is stripped, never stored', () => {
    const s = { name: 's', type: 'NFL_SURVIVOR' as const, season: '2026', settings: { entryFee: 20, payouts: { places: [P(1, 100)], bonuses: [] }, maxStrikes: 0, maxRebuys: 0, rebuyDeadlineWeek: 1, rebuyCost: 0, weeklyPayouts: { places: [P(1, 100)] } } };
    const r = survivorCreateInputSchema.safeParse(s);
    expect(r.success && !('weeklyPayouts' in (r.data as any).settings)).toBe(true);
  });
});

describe('payoutListsRefusal — updatePoolSettings (T1)', () => {
  const pool = (settings: Record<string, unknown>, type = 'NFL_PICKEM') => ({ type, settings });
  it('an unknown payoutMode is refused, never used to clear a stored weekly list (qodo #4 on #470)', () => {
    const stored = pool({ payoutMode: 'HYBRID', weeklyPayouts: { places: [P(1, 100)] } });
    expect(payoutListsRefusal(stored, { 'settings.payoutMode': 'BOGUS' })).toMatch(/PAYOUT_MODE_INVALID/);
  });
  it('an explicit payoutMode: null and an explicit payouts: null are refused (codex r7 on #470)', () => {
    const stored = pool({ payoutMode: 'HYBRID', weeklyPayouts: { places: [P(1, 100)] }, payouts: { places: [P(1, 100)], bonuses: [] } });
    expect(payoutListsRefusal(stored, { 'settings.payoutMode': null })).toMatch(/PAYOUT_MODE_INVALID/);
    expect(payoutListsRefusal(stored, { 'settings.payouts': null })).toMatch(/PAYOUTS_INVALID/);
    // …but a legacy pool with NO stored mode saving something else is untouched (the key is absent from the patch)
    expect(payoutListsRefusal(pool({}), { 'settings.weeklyPayouts': null })).toBeNull();
  });
  it('touches: any of payouts / weeklyPayouts / payoutMode', () => {
    expect(touchesPayoutLists({ 'settings.entryFee': 5 })).toBe(false);
    expect(touchesPayoutLists({ 'settings.weeklyPayouts': { places: [] } })).toBe(true);
    expect(touchesPayoutLists({ 'settings.payoutMode': 'SEASON' })).toBe(true);
  });
  it('accepts weeklyPayouts on a HYBRID pool; refuses on SEASON / WEEKLY (merged mode wins)', () => {
    expect(payoutListsRefusal(pool({ payoutMode: 'HYBRID' }), { 'settings.weeklyPayouts': { places: [P(1, 100)] } })).toBeNull();
    expect(payoutListsRefusal(pool({ payoutMode: 'SEASON' }), { 'settings.weeklyPayouts': { places: [P(1, 100)] } })).toMatch(/WEEKLY_PAYOUTS_WRONG_MODE/);
    // patch mode wins over stored mode
    expect(payoutListsRefusal(pool({ payoutMode: 'HYBRID' }), { 'settings.payoutMode': 'WEEKLY', 'settings.weeklyPayouts': { places: [P(1, 100)] } })).toMatch(/WEEKLY_PAYOUTS_WRONG_MODE/);
  });
  it('refuses duplicates and > 100 % on either list; refuses weeklyPayouts on a Survivor pool', () => {
    expect(payoutListsRefusal(pool({ payoutMode: 'HYBRID' }), { 'settings.weeklyPayouts': { places: [P(1, 60), P(1, 40)] } })).toMatch(/PAYOUT_DUPLICATE_RANK/);
    expect(payoutListsRefusal(pool({ payoutMode: 'HYBRID' }), { 'settings.weeklyPayouts': { places: [P(1, 60), P(2, 50)] } })).toMatch(/exceed 100/);
    expect(payoutListsRefusal(pool({}), { 'settings.payouts': { places: [P(1, 60), P(1, 40)], bonuses: [] } })).toMatch(/PAYOUT_DUPLICATE_RANK/);
    expect(payoutListsRefusal(pool({ payoutMode: 'HYBRID' }, 'NFL_SURVIVOR'), { 'settings.weeklyPayouts': { places: [P(1, 100)] } })).toMatch(/WEEKLY_PAYOUTS_WRONG_TYPE/);
  });
  it('a mode-only save away from HYBRID with a stored weekly list is judged WITHOUT it and CLEARS it (both directions of every transition)', () => {
    const stored = pool({ payoutMode: 'HYBRID', weeklyPayouts: { places: [P(1, 100)] } });
    for (const to of ['SEASON', 'WEEKLY']) {
      expect(weeklyPayoutsNeedsClearing(stored, { 'settings.payoutMode': to })).toBe(true);
      expect(payoutListsRefusal(stored, { 'settings.payoutMode': to })).toBeNull();
    }
    // back to HYBRID does not resurrect anything and clears nothing
    expect(weeklyPayoutsNeedsClearing(pool({ payoutMode: 'SEASON' }), { 'settings.payoutMode': 'HYBRID' })).toBe(false);
    // caller replacing the list decides its own fate
    expect(weeklyPayoutsNeedsClearing(stored, { 'settings.payoutMode': 'SEASON', 'settings.weeklyPayouts': null })).toBe(false);
  });
});

describe('payoutListsNoOpKeys — an unchanged re-sent list is not a change', () => {
  it('strips payouts / weeklyPayouts equal to the stored value (order-insensitive), keeps a real change', () => {
    const pool = { settings: { payouts: { places: [P(1, 60), P(2, 40)], bonuses: [] }, weeklyPayouts: { places: [P(1, 100)] } } };
    expect(payoutListsNoOpKeys(pool, { 'settings.payouts': { places: [P(2, 40), P(1, 60)], bonuses: [] }, 'settings.weeklyPayouts': { places: [P(1, 100)] } })).toEqual(['settings.payouts', 'settings.weeklyPayouts']);
    expect(payoutListsNoOpKeys(pool, { 'settings.payouts': { places: [P(1, 70), P(2, 30)], bonuses: [] } })).toEqual([]);
    expect(payoutListsNoOpKeys({ settings: {} }, { 'settings.weeklyPayouts': null })).toEqual(['settings.weeklyPayouts']);
  });
  it('malformed shapes never throw here — they are "different" and fall through to the validator', () => {
    const pool = { settings: { payouts: { places: [P(1, 100)], bonuses: [] } } };
    for (const bad of [{ places: 1 }, { places: {} }, { places: [null] }, 7, 'x']) {
      expect(() => payoutListsNoOpKeys(pool, { 'settings.payouts': bad })).not.toThrow();
      expect(payoutListsNoOpKeys(pool, { 'settings.payouts': bad })).toEqual([]);
    }
    expect(payoutListsRefusal(pool, { 'settings.payouts': { places: 1 } })).toMatch(/PAYOUTS_INVALID/);
  });
});

describe('normalizePayoutListsPatch — what is stored is what was validated (codex r3 on #470)', () => {
  it('weeklyPayouts: {} becomes { places: [] } (an explicit EMPTY weekly list, not a fall-through to payouts); unknown keys stripped', () => {
    const patch: Record<string, unknown> = { 'settings.weeklyPayouts': {}, 'settings.payouts': { places: [P(1, 100)], bonuses: [], junk: 1 } };
    normalizePayoutListsPatch(patch);
    expect(patch['settings.weeklyPayouts']).toEqual({ places: [] });
    expect(patch['settings.payouts']).toEqual({ places: [P(1, 100)], bonuses: [] });
  });
});

describe('normalizeCreatePayoutLists — the create twin (codex r4 on #470)', () => {
  it("Pick'em: weeklyPayouts {} → { places: [] }; Survivor: weeklyPayouts dropped; payouts normalized on both", () => {
    const pk: Record<string, unknown> = { payouts: { places: [P(1, 100)], bonuses: [], junk: 1 }, weeklyPayouts: {} };
    normalizeCreatePayoutLists('NFL_PICKEM', pk);
    expect(pk).toEqual({ payouts: { places: [P(1, 100)], bonuses: [] }, weeklyPayouts: { places: [] } });
    const sv: Record<string, unknown> = { payouts: { places: [P(1, 100)] }, weeklyPayouts: { places: [P(1, 100)] } };
    normalizeCreatePayoutLists('NFL_SURVIVOR', sv);
    expect(sv).toEqual({ payouts: { places: [P(1, 100)], bonuses: [] } });
  });
});
