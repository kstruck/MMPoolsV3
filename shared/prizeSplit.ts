// Tie prize-splitting (PLAN-WEEKLY-PRIZES §4, D6 — signed 2026-08-15).
//
// k players tied at place p CONSUME places p..p+k-1; those places' prizes are
// summed and split evenly in whole dollars; the next player lands at p+k. This
// is the money counterpart of the competition ranking already on screen
// (`rankByWeek` / `rankBySeason` produce the 1,1,3 numbering this consumes).
//
// Pure. No I/O. ONE implementation for the client display and the server-side
// publication alike — it is money, so it gets exactly one.
//
// ⚠️ `places` is `pool.settings.payouts.places` VERBATIM — the persisted shape
// is `{ rank, percentage }` (`shared/schemas/common.ts` payoutPlaceSchema).
// There is deliberately no normalization step; a normalization step is one
// more place the two shapes can drift (codex P2, plan review r3).

export interface PayoutPlace {
  rank: number;
  percentage: number;
}

export interface RankedEntry {
  /** Entry id (multi-entry aware — never assume one per uid). */
  id: string;
  /** Competition rank: ties SHARE a rank, the next rank skips (1,1,3). */
  rank: number;
}

export interface PrizeSplitInput {
  places: ReadonlyArray<PayoutPlace>;
  /** The frozen pot for this week/season, whole dollars, ≥ 0. */
  pot: number;
  ranked: ReadonlyArray<RankedEntry>;
}

export interface PrizeSplitResult {
  /** id → whole dollars. Every id in `ranked` is present (0 when unpaid). */
  awards: Record<string, number>;
  /** Σ awards. Always ≤ pot. */
  awarded: number;
  /**
   * `pot − awarded`: dollars the split could not assign to a player — whole-
   * dollar rounding, paid places nobody reached, and any share of the pot the
   * commissioner's percentages leave unassigned. NAMED on the page, never
   * silently handed to first place (D6). The commissioner's call.
   */
  remainder: number;
}

/**
 * Whole-dollar prize for one configured place on a pot: `floor(pot × pct/100)`.
 * Same floor convention as `PayoutsPanel` (§3b) so one pool never prints two
 * figures for the same place.
 */
export function placePrize(pot: number, percentage: number): number {
  return Math.floor(pot * (percentage / 100));
}

/**
 * Throws on input that would make the award ambiguous or exceed the pot:
 * duplicate ranks (the schema allows them — §4b), non-positive-integer ranks,
 * percentages outside 0..100 or summing past 100, a negative / non-finite pot.
 * A quietly wrong prize is worse than an error the commissioner can fix.
 */
function assertValid(input: PrizeSplitInput): void {
  const { places, pot } = input;
  if (!Number.isFinite(pot) || pot < 0) {
    throw new Error(`PRIZE_SPLIT_BAD_POT: pot must be a finite number ≥ 0, got ${pot}`);
  }
  const seen = new Set<number>();
  let total = 0;
  for (const p of places) {
    if (!Number.isInteger(p.rank) || p.rank < 1) {
      throw new Error(`PRIZE_SPLIT_BAD_RANK: rank must be a positive integer, got ${p.rank}`);
    }
    if (seen.has(p.rank)) {
      throw new Error(`PRIZE_SPLIT_DUPLICATE_RANK: rank ${p.rank} appears more than once in payouts.places`);
    }
    seen.add(p.rank);
    if (!Number.isFinite(p.percentage) || p.percentage < 0 || p.percentage > 100) {
      throw new Error(`PRIZE_SPLIT_BAD_PERCENTAGE: rank ${p.rank} has percentage ${p.percentage}`);
    }
    total += p.percentage;
  }
  // Tolerate float noise (33.3 + 33.3 + 33.4); refuse a real overshoot.
  if (total > 100 + 1e-9) {
    throw new Error(`PRIZE_SPLIT_OVER_100: payouts.places percentages sum to ${total}`);
  }
}

/**
 * Split a pot across competition ranks with ties consuming consecutive places.
 *
 * Invariants pinned by `tests/prize-split.test.ts` (§4c): Σ awarded ≤ pot; a
 * tie spanning the last paid place consumes only the places that exist; a tie
 * entirely below the last paid place awards nothing and does not throw; k = 1
 * reduces to the untied case; ordering independence; no negative, no NaN on
 * empty `places`, empty `ranked`, or a zero pot.
 */
export function splitPrizes(input: PrizeSplitInput): PrizeSplitResult {
  assertValid(input);
  const { places, pot, ranked } = input;

  const prizeByRank = new Map<number, number>();
  for (const p of places) prizeByRank.set(p.rank, placePrize(pot, p.percentage));

  // Group by competition rank. Order-independent: groups are keyed by rank and
  // members within a group all receive the same figure.
  const groups = new Map<number, string[]>();
  for (const r of ranked) {
    if (!Number.isInteger(r.rank) || r.rank < 1) {
      throw new Error(`PRIZE_SPLIT_BAD_ENTRY_RANK: ${r.id} has rank ${r.rank}`);
    }
    const g = groups.get(r.rank);
    if (g) g.push(r.id);
    else groups.set(r.rank, [r.id]);
  }

  const awards: Record<string, number> = {};
  let awarded = 0;
  for (const [rank, ids] of groups) {
    const k = ids.length;
    let pool = 0;
    for (let place = rank; place < rank + k; place++) pool += prizeByRank.get(place) ?? 0;
    const each = Math.floor(pool / k);
    for (const id of ids) {
      awards[id] = each;
      awarded += each;
    }
  }
  return { awards, awarded, remainder: pot - awarded };
}
