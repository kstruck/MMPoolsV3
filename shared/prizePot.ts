// The prize pots — ONE set of maths for the member Payouts panel, the weekly
// prize list and the payment ledger (PLAN-WEEKLY-PRIZES §3b, PLAN-PAYMENT-LEDGER
// R5/T3 — both signed 2026-08-15).
//
// Two NAMED units, because conflating them mis-prices every weekly award:
//   • `weeklySeasonAllocation` — the money set aside for weekly prizes across
//     the WHOLE season (`PayoutsPanel` labels it "weekly total"; its tooltip
//     says "weekly prize pots", plural).
//   • `perWeekPrizePot` — that allocation ÷ weeksInSeason. ONLY this figure
//     prices a weekly award.
//
// Whole dollars, `Math.floor`, charity taken off BEFORE percentages — byte-for-
// byte the conventions `PayoutsPanel.tsx` shipped with (#423), so the same pool
// never prints two prize figures on two screens. `tests/prize-pot.test.ts` pins
// the #423 example ($25 = $18 + $7).
//
// The platform moves no money. Every figure here is a printed estimate the
// commissioner settles; nothing here is an instruction to a payment system.

export interface PotSettings {
  payoutMode?: 'SEASON' | 'WEEKLY' | 'HYBRID' | string;
  entryFee?: number;
  hybridSplit?: { weeklyPerEntry?: number; seasonPerEntry?: number } | null;
  charity?: { enabled?: boolean; percentage?: number } | null;
}

export interface PotBreakdown {
  /** entryFee × entries, before charity. */
  gross: number;
  /** floor(gross × charity%) when charity is enabled, else 0. */
  charityCut: number;
  /** gross − charityCut. What the place percentages apply to on a single-pot pool. */
  net: number;
  /** 1 − charity%/100 when enabled, else 1. */
  charityFactor: number;
  /**
   * Season-long weekly allocation ("weekly total"): HYBRID with a declared
   * split → floor(weeklyPerEntry × entries × charityFactor); WEEKLY → net;
   * SEASON, or HYBRID without a split → undefined (no separately-known weekly pot).
   */
  weeklySeasonAllocation?: number;
  /** SEASON → net; HYBRID with split → net − weeklySeasonAllocation; WEEKLY → undefined. */
  seasonPot?: number;
}

/** `1 − charity%/100` when charity is enabled, else 1. Matches `PayoutsPanel`. */
export function charityFactor(charity: PotSettings['charity']): number {
  return charity?.enabled ? 1 - (charity.percentage ?? 0) / 100 : 1;
}

/**
 * The pots for a pool with `entries` entries. Returns undefined when the pot
 * cannot be known (no fee, or no/zero entry count) — never guess.
 * `entries` is EVERY entry, not only PAID ones (D8/K6, printed on the page).
 */
export function potBreakdown(settings: PotSettings | null | undefined, entries: number | undefined): PotBreakdown | undefined {
  const entryFee = settings?.entryFee ?? 0;
  if (!(entryFee > 0) || entries === undefined || !(entries > 0)) return undefined;
  const gross = entryFee * entries;
  const charity = settings?.charity;
  const charityCut = charity?.enabled ? Math.floor(gross * ((charity.percentage ?? 0) / 100)) : 0;
  const net = gross - charityCut;
  const cf = charityFactor(charity);
  const mode = settings?.payoutMode;

  const out: PotBreakdown = { gross, charityCut, net, charityFactor: cf };
  if (mode === 'HYBRID') {
    const split = settings?.hybridSplit;
    if (split && typeof split.weeklyPerEntry === 'number') {
      const weekly = Math.floor(split.weeklyPerEntry * entries * cf);
      out.weeklySeasonAllocation = weekly;
      out.seasonPot = net - weekly;
    }
  } else if (mode === 'WEEKLY') {
    out.weeklySeasonAllocation = net;
  } else if (mode === 'SEASON') {
    out.seasonPot = net;
  }
  return out;
}

/**
 * One week's prize pot: the season-long weekly allocation ÷ weeksInSeason,
 * floored. `weeksInSeason` is the FROZEN value (§3b D5) — never a hardcoded 18;
 * a preseason pool has four. Undefined when either input is unknown.
 */
export function perWeekPrizePot(weeklySeasonAllocation: number | undefined, weeksInSeason: number | undefined): number | undefined {
  if (weeklySeasonAllocation === undefined) return undefined;
  if (!Number.isInteger(weeksInSeason) || (weeksInSeason as number) < 1) return undefined;
  return Math.floor(weeklySeasonAllocation / (weeksInSeason as number));
}

/**
 * Which place list prices the WEEKLY pot (PLAN-WEEKLY-PRIZES §9 A4 /
 * PLAN-PAYMENT-LEDGER D1): HYBRID → `settings.weeklyPayouts.places` when the
 * commissioner defined a separate weekly list, else `settings.payouts.places`
 * (today's behaviour — one list applies to both pots); WEEKLY → `payouts.places`;
 * SEASON → `[]` (a season pool has no weekly prize — D7 renders places and
 * scores with no Prize column). Verbatim `{ rank, percentage }`, no normalization.
 */
export function weeklyPlacesFor(settings: {
  payoutMode?: unknown;
  payouts?: { places?: ReadonlyArray<{ rank: number; percentage: number }> } | null;
  weeklyPayouts?: { places?: ReadonlyArray<{ rank: number; percentage: number }> } | null;
} | null | undefined): ReadonlyArray<{ rank: number; percentage: number }> {
  const mode = settings?.payoutMode;
  if (mode === 'SEASON') return [];
  if (mode === 'HYBRID' && settings?.weeklyPayouts?.places) return settings.weeklyPayouts.places;
  return settings?.payouts?.places ?? [];
}
