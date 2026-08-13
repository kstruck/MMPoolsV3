import { describe, it, expect } from 'vitest';
import { hybridSplitProblem } from '../shared/hybridSplit';
import { hybridSplitRefusal, hybridSplitNeedsClearing, touchesHybridSplitSettings } from '../lib/hybridSplitGate';

/** The HYBRID entry-fee split (PLAN-HYBRID-SPLIT). Money — every branch pinned. */

const ok = { payoutMode: 'HYBRID', entryFee: 25, hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 } };

describe('hybridSplitProblem — the single money check', () => {
  it("accepts Kevin's example: $18 + $7 = $25", () => {
    expect(hybridSplitProblem(ok)).toBeNull();
  });
  it('accepts an absent split on any mode — pre-existing pools declare nothing', () => {
    expect(hybridSplitProblem({ payoutMode: 'HYBRID', entryFee: 25 })).toBeNull();
    expect(hybridSplitProblem({ payoutMode: 'SEASON', entryFee: 25 })).toBeNull();
    expect(hybridSplitProblem(undefined)).toBeNull();
  });
  it('refuses a split on a non-HYBRID mode — a stored lie waiting for a mode flip', () => {
    expect(hybridSplitProblem({ ...ok, payoutMode: 'SEASON' })).toContain('HYBRID_SPLIT_WRONG_MODE');
  });
  it('refuses a sum that misses the fee, and names the numbers', () => {
    const p = hybridSplitProblem({ ...ok, hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 8 } });
    expect(p).toContain('HYBRID_SPLIT_MISMATCH');
    expect(p).toContain('$26');
    expect(p).toContain('$25');
  });
  it('refuses fractions — whole dollars are the contract', () => {
    expect(hybridSplitProblem({ ...ok, hybridSplit: { weeklyPerEntry: 17.5, seasonPerEntry: 7.5 } })).toContain('HYBRID_SPLIT_INVALID');
  });
  it('refuses negatives and junk shapes', () => {
    expect(hybridSplitProblem({ ...ok, hybridSplit: { weeklyPerEntry: -1, seasonPerEntry: 26 } })).toContain('HYBRID_SPLIT_INVALID');
    expect(hybridSplitProblem({ ...ok, hybridSplit: 'yes' })).toContain('HYBRID_SPLIT_INVALID');
  });
  it('refuses a split with no positive whole-dollar fee to sum to', () => {
    expect(hybridSplitProblem({ ...ok, entryFee: 0 })).toContain('HYBRID_SPLIT_NEEDS_FEE');
    expect(hybridSplitProblem({ ...ok, entryFee: 25.5 })).toContain('HYBRID_SPLIT_NEEDS_FEE');
  });
  it('a $0 fee pool cannot declare a split, but $0+$25 on a $25 fee is fine', () => {
    expect(hybridSplitProblem({ ...ok, hybridSplit: { weeklyPerEntry: 0, seasonPerEntry: 25 } })).toBeNull();
  });
});

describe('hybridSplitRefusal — judged over the settings AS SAVED', () => {
  const pool = (settings: Record<string, unknown>) => ({ type: 'NFL_PICKEM', settings });
  const stored = pool({ payoutMode: 'HYBRID', entryFee: 25, hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 } });

  it('untouched patches are not judged', () => {
    expect(touchesHybridSplitSettings({ 'settings.pointsPerPick': 2 })).toBe(false);
    expect(hybridSplitRefusal(stored, { 'settings.pointsPerPick': 2 })).toBeNull();
  });
  it('an entryFee edit that unbalances a stored split is refused', () => {
    expect(hybridSplitRefusal(stored, { 'settings.entryFee': 30 })).toContain('HYBRID_SPLIT_MISMATCH');
  });
  it('a balanced fee+split edit in one patch is allowed', () => {
    expect(hybridSplitRefusal(stored, {
      'settings.entryFee': 30,
      'settings.hybridSplit': { weeklyPerEntry: 20, seasonPerEntry: 10 },
    })).toBeNull();
  });
  it('leaving HYBRID clears the stored split instead of deadlocking', () => {
    const patch = { 'settings.payoutMode': 'SEASON' };
    expect(hybridSplitNeedsClearing(stored, patch)).toBe(true);
    // Judged as if cleared → no WRONG_MODE refusal → the mode change saves.
    expect(hybridSplitRefusal(stored, patch)).toBeNull();
  });
  it('does not clear when no split is stored, or when the patch replaces it itself', () => {
    expect(hybridSplitNeedsClearing(pool({ payoutMode: 'HYBRID', entryFee: 25 }), { 'settings.payoutMode': 'SEASON' })).toBe(false);
    expect(hybridSplitNeedsClearing(stored, { 'settings.payoutMode': 'SEASON', 'settings.hybridSplit': null })).toBe(false);
  });
  it('switching TO HYBRID with a bad split is refused', () => {
    const seasonPool = pool({ payoutMode: 'SEASON', entryFee: 25 });
    expect(hybridSplitRefusal(seasonPool, {
      'settings.payoutMode': 'HYBRID',
      'settings.hybridSplit': { weeklyPerEntry: 1, seasonPerEntry: 1 },
    })).toContain('HYBRID_SPLIT_MISMATCH');
  });
});
