// The Weekly Winners List and the frozen weekly prize (PLAN-WEEKLY-PRIZES §3,
// §4, §9 A1–A5 — signed 2026-08-15; consumed by PLAN-PAYMENT-LEDGER D3/D4).
//
// Pure. The server publishes `weeklyPlaces` + `weeklyPrize` on the week's recap
// (functions/src/nflPools.ts) and the client renders them; both sides import
// these types and helpers so the ranking the page shows IS the ranking the
// prize was computed from.
//
// The platform moves no money. `prize` is a printed estimate the commissioner
// settles; nothing here is an instruction to a payment system.

import { splitPrizes, type PayoutPlace } from './prizeSplit';
import { perWeekPrizePot, potBreakdown, weeklyPlacesFor } from './prizePot';

/** One entry's claim on the week, as the ranking sees it (A1: keyed by ENTRY). */
export interface WeeklyPlaceCandidate {
  entryId: string;
  userId: string;
  /** The OWNER's display name. */
  userName: string;
  /** The entry's own name when the owner named it (multi-entry T2/K5); display `entryName ?? userName`. */
  entryName?: string;
  points: number;
  /** `|prediction − target|`; undefined = no prediction. NEVER coerce to 0. */
  tiebreakDiff?: number;
}

/** One row of the published Weekly Winners List. */
export interface WeeklyPlace extends WeeklyPlaceCandidate {
  /** Competition rank: ties share, the next rank skips (1,1,3). */
  rank: number;
  /** Whole dollars, present only on a paid rank of a priced week. */
  prize?: number;
}

/**
 * The OUTPUT frozen at first publication (§3b-i): re-read verbatim on every
 * later pass, so a rescore re-ranks PLAYERS against a pot that does not move.
 */
export interface WeeklyPrizeSnapshot {
  /** One week's prize pot, whole dollars (`perWeekPrizePot`). */
  pot: number;
  /** The place list applied to it — `weeklyPlacesFor(settings)` as it stood. */
  places: PayoutPlace[];
  /** `pool.entryCount` as it stood (A3) — every entry, not only PAID (D8). */
  entryCount: number;
  /** The divisor used (D5). Never a hardcoded 18. */
  weeksInSeason: number;
  payoutMode: 'WEEKLY' | 'HYBRID';
  /** Epoch ms of first publication. */
  frozenAt: number;
}

/**
 * Full competition ranking of every scored entry (A2): points desc, then
 * tiebreakDiff asc with "no prediction" ranking BELOW every prediction, then
 * residual ties SHARE a rank and the next rank skips. Input order never
 * matters; ids break nothing (a tie stays a tie).
 */
export function rankWeeklyPlaces(candidates: ReadonlyArray<WeeklyPlaceCandidate>): WeeklyPlace[] {
  const sorted = [...candidates].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const da = typeof a.tiebreakDiff === 'number' ? a.tiebreakDiff : Number.POSITIVE_INFINITY;
    const db = typeof b.tiebreakDiff === 'number' ? b.tiebreakDiff : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    // Deterministic output order within a tie (display only — the rank is shared).
    return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
  });
  const out: WeeklyPlace[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : undefined;
    const tied = prev !== undefined && prev.points === c.points
      && (typeof prev.tiebreakDiff === 'number' ? prev.tiebreakDiff : undefined) === (typeof c.tiebreakDiff === 'number' ? c.tiebreakDiff : undefined);
    const rank = tied ? out[i - 1].rank : i + 1;
    // Rebuilt field by field: a literal `undefined` value throws in Firestore set().
    const row: WeeklyPlace = { entryId: c.entryId, userId: c.userId, userName: c.userName, points: c.points, rank };
    if (typeof c.entryName === 'string' && c.entryName) row.entryName = c.entryName;
    if (typeof c.tiebreakDiff === 'number') row.tiebreakDiff = c.tiebreakDiff;
    out.push(row);
  }
  return out;
}

/**
 * The frozen prize snapshot for a week, computed from LIVE settings — called
 * ONLY when the recap has no snapshot yet (first publication). Returns
 * undefined when the week has no priceable pot: SEASON mode, a HYBRID pool
 * without a declared split, no fee, no entries, or an unknown weeks divisor.
 * The list still publishes in those cases, with no Prize column (D7).
 */
export function computeWeeklyPrizeSnapshot(
  settings: Parameters<typeof potBreakdown>[0] & Parameters<typeof weeklyPlacesFor>[0],
  entryCount: number | undefined,
  weeksInSeason: number | undefined,
  nowMs: number,
): WeeklyPrizeSnapshot | undefined {
  const mode = settings?.payoutMode;
  if (mode !== 'WEEKLY' && mode !== 'HYBRID') return undefined;
  const pots = potBreakdown(settings, entryCount);
  const pot = perWeekPrizePot(pots?.weeklySeasonAllocation, weeksInSeason);
  if (pot === undefined || entryCount === undefined || weeksInSeason === undefined) return undefined;
  return {
    pot,
    places: weeklyPlacesFor(settings).map(p => ({ rank: p.rank, percentage: p.percentage })),
    entryCount,
    weeksInSeason,
    payoutMode: mode,
    frozenAt: nowMs,
  };
}

/**
 * Attach `prize` to the paid rows of a ranked list from a frozen snapshot, with
 * ties splitting per `splitPrizes` (§4). THROWS on a malformed place list
 * (duplicate ranks, >100 %) — the caller publishes fail-closed (A5).
 */
export function priceWeeklyPlaces(places: ReadonlyArray<WeeklyPlace>, snapshot: WeeklyPrizeSnapshot): { rows: WeeklyPlace[]; awarded: number; remainder: number } {
  const split = splitPrizes({
    places: snapshot.places,
    pot: snapshot.pot,
    ranked: places.map(p => ({ id: p.entryId, rank: p.rank })),
  });
  const rows = places.map(p => {
    const prize = split.awards[p.entryId] ?? 0;
    return prize > 0 ? { ...p, prize } : { ...p };
  });
  return { rows, awarded: split.awarded, remainder: split.remainder };
}
