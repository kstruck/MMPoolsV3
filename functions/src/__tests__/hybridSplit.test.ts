import { describe, it, expect } from 'vitest';
import { hybridSplitProblem } from '../shared/hybridSplit';
import { hybridNoOpKeys, hybridSplitRefusal, hybridSplitNeedsClearing, touchesHybridSplitSettings } from '../lib/hybridSplitGate';

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

describe('hybridSplitRefusal — type scoping (codex P2, r2)', () => {
  it('refuses a split written to a Survivor pool, even a balanced one', () => {
    const survivor = { type: 'NFL_SURVIVOR', settings: { entryFee: 25 } };
    expect(hybridSplitRefusal(survivor, {
      'settings.payoutMode': 'HYBRID',
      'settings.hybridSplit': { weeklyPerEntry: 18, seasonPerEntry: 7 },
    })).toContain('HYBRID_SPLIT_WRONG_TYPE');
  });
  it('ignores fee edits on other pool types — not this gate\'s business', () => {
    expect(hybridSplitRefusal({ type: 'NFL_SURVIVOR', settings: {} }, { 'settings.entryFee': 30 })).toBeNull();
    expect(hybridSplitRefusal({ type: 'BRACKET', settings: {} }, { 'settings.entryFee': 30 })).toBeNull();
  });
});

describe('hybridNoOpKeys — equal keys strip so they are never written', () => {
  // qodo #12 post-merge (the waste) + codex P1 on the first fix (why the skip
  // was wrong): a sparse stale patch matching the pre-read could clobber a
  // concurrent fee+split commit into an invalid trio. Keys that strip are
  // never written; presence over the stripped patch becomes the change test.
  const pool = (settings: Record<string, unknown>) => ({ type: 'NFL_PICKEM', settings });
  const stored = { entryFee: 25, payoutMode: 'HYBRID', hybridSplit: { weeklyPerEntry: 18, seasonPerEntry: 7 } };

  it('strips all three when the patch re-sends exactly the stored values', () => {
    expect(hybridNoOpKeys(pool(stored), {
      'settings.entryFee': 25,
      'settings.payoutMode': 'HYBRID',
      'settings.hybridSplit': { weeklyPerEntry: 18, seasonPerEntry: 7 },
    })).toEqual(['settings.hybridSplit', 'settings.payoutMode', 'settings.entryFee']);
  });

  it('strips nothing when the patch touches none of the three keys', () => {
    expect(hybridNoOpKeys(pool(stored), { 'settings.lockBufferMinutes': 5 })).toEqual([]);
  });

  it('compares the split by NAMED FIELDS — property order must not matter', () => {
    // JSON.stringify preserves insertion order; a Firestore read returning the
    // keys reversed would have reported equal splits as changed and re-entered
    // the transaction on every save. (codex P2, gate-fix r1.)
    const reversed = { seasonPerEntry: 7, weeklyPerEntry: 18 };
    expect(hybridNoOpKeys(pool(stored), { 'settings.hybridSplit': reversed }))
      .toEqual(['settings.hybridSplit']);
  });

  it('treats null and undefined as the same absence', () => {
    expect(hybridNoOpKeys(pool({ entryFee: 25, payoutMode: 'SEASON' }), {
      'settings.hybridSplit': null,
    })).toEqual(['settings.hybridSplit']);
  });

  it('keeps a changed entryFee', () => {
    expect(hybridNoOpKeys(pool(stored), { 'settings.entryFee': 30 })).toEqual([]);
  });

  it('keeps a changed payoutMode while stripping the unchanged fee', () => {
    expect(hybridNoOpKeys(pool(stored), {
      'settings.entryFee': 25,
      'settings.payoutMode': 'SEASON',
    })).toEqual(['settings.entryFee']);
  });

  it('keeps a changed split even with the other two unchanged', () => {
    expect(hybridNoOpKeys(pool(stored), {
      'settings.entryFee': 25,
      'settings.payoutMode': 'HYBRID',
      'settings.hybridSplit': { weeklyPerEntry: 17, seasonPerEntry: 8 },
    })).toEqual(['settings.payoutMode', 'settings.entryFee']);
  });

  it('keeps a split that first APPEARS on a pool that had none', () => {
    expect(hybridNoOpKeys(pool({ entryFee: 25, payoutMode: 'HYBRID' }), {
      'settings.hybridSplit': { weeklyPerEntry: 18, seasonPerEntry: 7 },
    })).toEqual([]);
  });

  it('a split differing only in one field is NOT equal', () => {
    expect(hybridNoOpKeys(pool(stored), {
      'settings.hybridSplit': { weeklyPerEntry: 18, seasonPerEntry: 6 },
    })).toEqual([]);
  });
});
