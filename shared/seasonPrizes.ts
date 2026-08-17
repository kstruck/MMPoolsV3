// The Season Places list and the frozen SEASON prize (PLAN-WEEKLY-PRIZES §2c,
// §4, build step 3 — signed 2026-08-15; consumed by PLAN-PAYMENT-LEDGER D3).
//
// Pure. The server publishes `seasonPlaces` + `seasonPrize` on the POOL doc at
// finalization (functions/src/nflFinalize.ts) and the ledger renders them;
// both sides import these types so the ranking the page shows IS the ranking
// the prize was computed from. Same shape and rules as the weekly half
// (shared/weeklyPrizes.ts): competition ranks, ties split per shared/prizeSplit,
// whole dollars, `null` = published UNPRICED, frozen once, never re-priced.
//
// The platform moves no money. `prize` is a printed estimate the commissioner
// settles; nothing here is an instruction to a payment system.

import { splitPrizes, type PayoutPlace } from './prizeSplit';
import { potBreakdown } from './prizePot';

/** One row of the published Season Places list (keyed by ENTRY — multi-entry aware). */
export interface SeasonPlace {
  entryId: string;
  userId: string;
  /** The OWNER's display name. */
  userName: string;
  /** The entry's own name when the owner named it; display `entryName ?? userName`. */
  entryName?: string;
  /** Competition rank after the §2c tie cascade: residual ties SHARE a rank, the next rank skips. */
  rank: number;
  /** Season points (Pick'em totalScore / Margin seasonTotal); null for Survivor. */
  points: number | null;
  /** Whole dollars, present only on a paid rank of a priced pool. */
  prize?: number;
}

/** The OUTPUT frozen at finalization: re-read verbatim, never re-priced. */
export interface SeasonPrizeSnapshot {
  /** The season pot, whole dollars (`potBreakdown(...).seasonPot`). */
  pot: number;
  /** The place list applied to it — `settings.payouts.places` as it stood. */
  places: PayoutPlace[];
  /** `pool.entryCount` as it stood — every entry, not only PAID (D8). */
  entryCount: number;
  payoutMode: 'SEASON' | 'HYBRID';
  /** Epoch ms of finalization. */
  frozenAt: number;
}

/**
 * Deterministic id of a season PLACE award: one live record per (entry, place),
 * so a double-click or two commissioner tabs cannot record the same win twice.
 * Season places are published once (finalization is terminal), so unlike
 * `weeklyAwardId` there is no `~k` re-record suffix.
 */
export function seasonAwardId(entryId: string, place: number): string {
  return `season-${entryId}-p${place}`;
}

/**
 * The season pot + place list to freeze, or `undefined` when the pool has no
 * priceable season pot: WEEKLY mode, a HYBRID pool without a declared split,
 * no fee, no entries, or no place list. The list still publishes in those
 * cases, with no Prize column (D7).
 */
export function computeSeasonPrizeSnapshot(
  settings: Parameters<typeof potBreakdown>[0] & { payouts?: { places?: ReadonlyArray<PayoutPlace> } | null } | null | undefined,
  entryCount: number | undefined,
  nowMs: number,
): SeasonPrizeSnapshot | undefined {
  const mode = settings?.payoutMode;
  if (mode !== 'SEASON' && mode !== 'HYBRID') return undefined;
  const pots = potBreakdown(settings, entryCount);
  const pot = pots?.seasonPot;
  if (pot === undefined || entryCount === undefined) return undefined;
  const places = settings?.payouts?.places ?? [];
  if (places.length === 0) return undefined;
  return {
    pot,
    places: places.map(p => ({ rank: p.rank, percentage: p.percentage })),
    entryCount,
    payoutMode: mode,
    frozenAt: nowMs,
  };
}

/**
 * Attach `prize` to the paid rows of a ranked list from a frozen snapshot, with
 * ties splitting per `splitPrizes` (§4). THROWS on a malformed place list
 * (duplicate ranks, >100 %) — the caller publishes fail-closed.
 */
export function priceSeasonPlaces(places: ReadonlyArray<SeasonPlace>, snapshot: SeasonPrizeSnapshot): { rows: SeasonPlace[]; awarded: number; remainder: number } {
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
