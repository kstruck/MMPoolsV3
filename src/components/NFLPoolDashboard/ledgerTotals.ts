// The Payment Ledger's four money figures, and the fifth one that makes them
// reconcile (PLAN-PAYMENT-LEDGER D10; this file added 2026-08-28).
//
// WHY THIS IS A MODULE AND NOT AN INLINE `useMemo`.
//
// The ledger showed `Owed in` beside `Owed out` and never explained the gap
// between them. On a real pool that gap was $16 of a $100 pot — money the
// commissioner had collected and no published prize claimed — with nothing on
// the page naming it. A commissioner reading four figures that do not add up
// has to assume the ledger is broken, and cannot tell that apart from a ledger
// that is right. So the derivation lives here, pure, with a test per case.
//
// THE GAP IS REAL MONEY AND IT HAS FOUR NAMED CAUSES, all of which the rest of
// the codebase already knows about:
//
//   1. `perWeekPrizePot` floors `weeklySeasonAllocation ÷ weeksInSeason`
//      (shared/prizePot.ts). A $75 weekly allocation over 4 weeks prices at
//      $18/week, so $3 never reaches a week at all.
//   2. `splitPrizes` floors every place and every tie share, and RETURNS the
//      leftover as `remainder` (shared/prizeSplit.ts) — "NAMED on the page,
//      never silently handed to first place (D6)". `WeeklyWinnersList.tsx`
//      names it per week; the ledger, the one screen that totals in against
//      out, did not.
//   3. Paid places nobody reached — a 3-place list in a week only two entries
//      scored leaves third place unawarded.
//   4. An entry added AFTER a week's pot was frozen pays dues that that week's
//      pot never counted (`WeeklyPrizeSnapshot.entryCount` is frozen at first
//      publication), and a charity cut comes off the pot but not off dues.
//
// This module does NOT try to attribute the gap to those causes: doing that
// would need every week's frozen snapshot and the charity settings, and a
// wrong attribution on a money screen is worse than an honest total. It states
// the gap, which is arithmetic on two figures already on the row, and the page
// names the causes in prose.
//
// The platform moves no money. Every figure here is a printed estimate the
// commissioner settles.

/** A ledger row as the totals care about it — one per ENTRY. */
export interface LedgerTotalsRow {
  /** Dues for this entry, or null when unknown (a prize row outside the roster). */
  feeOwed: number | null;
  paidStatus: 'PAID' | 'UNPAID' | null;
  /** True on a member's FIRST row — rebuys are a member-level sum. */
  first: boolean;
  /** Member-level rebuy total (already summed across the member's entries). */
  rebuyOwed: number;
  rebuyPaid: number;
}

/** A published prize as the totals care about it. */
export interface LedgerTotalsPrize {
  owed: number;
  settled: boolean;
}

/** A free-form award (BONUS / ADJUSTMENT / legacy PLACE) as the totals care about it. */
export interface LedgerTotalsAward {
  amount: number;
  settled: boolean;
}

export interface LedgerTotals {
  owedIn: number;
  paidIn: number;
  owedOut: number;
  paidOut: number;
  /**
   * `owedIn − owedOut`. POSITIVE means the pool has taken in more than every
   * published prize claims (the rounding gap above). NEGATIVE means it has
   * committed more than it collected — reachable through a BONUS or a positive
   * ADJUSTMENT, and the commissioner has to know that too, so it is not
   * clamped away.
   */
  unallocated: number;
}

/**
 * The four figures plus the reconciling fifth.
 *
 * 🛑 TWO LOOPS OVER THE ROWS, AND D10 SAYS SO EXPLICITLY: "Mixing those two in
 * one loop is exactly how a double-count gets shipped." Base dues are PER ENTRY
 * so they sum over every row; rebuys are a member-level sum already, so they
 * keep the `first` gate. Summing rebuys per row would multiply them by the
 * member's entry count.
 */
export function computeLedgerTotals(
  rows: ReadonlyArray<LedgerTotalsRow>,
  prizes: ReadonlyArray<LedgerTotalsPrize>,
  otherAwards: ReadonlyArray<LedgerTotalsAward>,
): LedgerTotals {
  let owedIn = 0, paidIn = 0, owedOut = 0, paidOut = 0;

  for (const r of rows) {
    if (r.feeOwed === null) continue;          // unknown (a prize row outside the roster)
    owedIn += r.feeOwed;
    if (r.paidStatus === 'PAID') paidIn += r.feeOwed;
  }
  for (const r of rows) {
    if (!r.first) continue;                    // ONCE per member
    owedIn += r.rebuyOwed;
    paidIn += Math.min(r.rebuyPaid, r.rebuyOwed);
  }

  for (const p of prizes) {
    owedOut += p.owed;
    if (p.settled) paidOut += p.owed;
  }
  // Other awards count in the out totals too — an adjustment may be negative (T7).
  for (const a of otherAwards) {
    owedOut += a.amount;
    if (a.settled) paidOut += a.amount;
  }

  return { owedIn, paidIn, owedOut, paidOut, unallocated: owedIn - owedOut };
}
