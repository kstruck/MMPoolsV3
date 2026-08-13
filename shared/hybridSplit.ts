// The HYBRID entry-fee split contract (PLAN-HYBRID-SPLIT, Kevin 2026-08-13).
//
// A HYBRID pool pays weekly winners AND season winners, so the entry fee is
// two pots: `weeklyPerEntry` dollars into the weekly pool and `seasonPerEntry`
// into the season pool, per entry. Kevin's example is the spec: $25 = $18
// weekly + $7 season.
//
// ONE validation, used by the create schema AND the update callable, because a
// drift between create-time and edit-time money validation is how a pool ends
// up storing a split its own editor would refuse.
//
// ⚠️ The invariant is EXACT INTEGER arithmetic: weekly + season === entryFee,
// whole dollars. Deliberately NOT "per-week × weeks": no canonical
// weeks-per-season-type constant exists in this codebase, and the preseason
// pilot pools' week count is an importer artifact (HOF = week 1) no
// commissioner should need to know. Per-week figures are display math.

export interface HybridSplit {
  /** Whole dollars per entry into the WEEKLY prize pots. */
  weeklyPerEntry: number;
  /** Whole dollars per entry into the SEASON pot. */
  seasonPerEntry: number;
}

/** Is this a structurally valid split object? (Shape only — not the sum.) */
export function isHybridSplitShape(v: unknown): v is HybridSplit {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.weeklyPerEntry === 'number' && Number.isInteger(s.weeklyPerEntry) && s.weeklyPerEntry >= 0 &&
    typeof s.seasonPerEntry === 'number' && Number.isInteger(s.seasonPerEntry) && s.seasonPerEntry >= 0
  );
}

/**
 * The single money check. Returns a human-readable problem, or null when the
 * settings are coherent.
 *
 * Judged over the WHOLE settings object, not the split alone, because three
 * different fields can break the invariant: the split itself, `payoutMode`
 * (a split stored on a non-HYBRID pool is a lie waiting for a mode flip), and
 * `entryFee` (an edit that unbalances a previously valid split).
 *
 * Absent split on a HYBRID pool is ALLOWED — that is every hybrid pool created
 * before this feature, and the Payouts panel keeps its honest "ask your
 * commissioner" fallback for them. Declaring a split is opt-in; declaring an
 * incoherent one is refused.
 */
export function hybridSplitProblem(settings: {
  payoutMode?: unknown;
  entryFee?: unknown;
  hybridSplit?: unknown;
} | null | undefined): string | null {
  const split = settings?.hybridSplit;
  if (split === undefined || split === null) return null;

  if (settings?.payoutMode !== 'HYBRID') {
    return 'HYBRID_SPLIT_WRONG_MODE: an entry-fee split only applies to the Hybrid payout mode. Remove the split, or switch the payout mode to Hybrid.';
  }
  if (!isHybridSplitShape(split)) {
    return 'HYBRID_SPLIT_INVALID: the split must be two whole-dollar amounts, each 0 or more (weeklyPerEntry, seasonPerEntry).';
  }
  const entryFee = Number(settings?.entryFee ?? 0);
  if (!Number.isInteger(entryFee) || entryFee <= 0) {
    return 'HYBRID_SPLIT_NEEDS_FEE: a split needs a whole-dollar entry fee greater than zero.';
  }
  if (split.weeklyPerEntry + split.seasonPerEntry !== entryFee) {
    return `HYBRID_SPLIT_MISMATCH: $${split.weeklyPerEntry} weekly + $${split.seasonPerEntry} season = $${split.weeklyPerEntry + split.seasonPerEntry}, but the entry fee is $${entryFee}. The two amounts must add up to the entry fee exactly.`;
  }
  return null;
}
