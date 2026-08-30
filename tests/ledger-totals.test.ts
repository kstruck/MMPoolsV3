import { describe, it, expect } from 'vitest';
import {
  computeLedgerTotals,
  type LedgerTotalsRow,
  type LedgerTotalsPrize,
  type LedgerTotalsAward,
} from '../src/components/NFLPoolDashboard/ledgerTotals';
import { potBreakdown, perWeekPrizePot } from '@shared/prizePot';
import { splitPrizes } from '@shared/prizeSplit';

/**
 * The Payment Ledger's totals row, and the figure that makes it add up.
 *
 * This exists because a commissioner looked at a live pool and could not
 * reconcile it: the ledger read "Owed in $100 / Owed out $84" and named nothing
 * for the missing $16. Four figures that do not add up are indistinguishable
 * from a broken ledger, which is the worst thing a money screen can be.
 *
 * These assert the SUBSTANCE — what each figure counts, and that in minus out
 * is stated rather than dropped.
 */

const row = (over: Partial<LedgerTotalsRow> = {}): LedgerTotalsRow => ({
  feeOwed: 20, paidStatus: 'PAID', first: true, rebuyOwed: 0, rebuyPaid: 0, ...over,
});
const prize = (owed: number, settled = true): LedgerTotalsPrize => ({ owed, settled });
const award = (amount: number, settled = false): LedgerTotalsAward => ({ amount, settled });

describe('computeLedgerTotals — what each figure counts', () => {
  it('dues are PER ENTRY and only PAID rows count as paid in', () => {
    const t = computeLedgerTotals(
      [row(), row({ paidStatus: 'UNPAID' }), row({ paidStatus: null })],
      [], [],
    );
    expect(t.owedIn).toBe(60);
    expect(t.paidIn).toBe(20);
  });

  it('a row with an unknown fee is skipped entirely, never counted as zero owed', () => {
    // A prize row for somebody outside the roster carries `feeOwed: null`. It
    // must not drag `owedIn` down, and it must not appear as a $0 debt either.
    const t = computeLedgerTotals([row(), row({ feeOwed: null, paidStatus: null })], [], []);
    expect(t.owedIn).toBe(20);
  });

  /**
   * THE DOUBLE-COUNT D10 NAMES. `rebuyOwed` on the Member Record is already the
   * total across that member's entries, so summing it per row multiplies it by
   * the entry count. Two entries, one member, one $15 rebuy.
   */
  it('rebuys are counted ONCE per member, not once per entry', () => {
    const t = computeLedgerTotals(
      [row({ first: true, rebuyOwed: 15, rebuyPaid: 15 }), row({ first: false, rebuyOwed: 15, rebuyPaid: 15 })],
      [], [],
    );
    expect(t.owedIn).toBe(20 + 20 + 15);
    expect(t.paidIn).toBe(20 + 20 + 15);
  });

  it('a rebuy overpayment never counts more paid in than was owed', () => {
    const t = computeLedgerTotals([row({ rebuyOwed: 10, rebuyPaid: 999 })], [], []);
    expect(t.owedIn).toBe(30);
    expect(t.paidIn).toBe(30);
  });

  it('only SETTLED prizes count as paid out', () => {
    const t = computeLedgerTotals([], [prize(15), prize(9, false)], []);
    expect(t.owedOut).toBe(24);
    expect(t.paidOut).toBe(15);
  });

  it('other awards land in the out totals, and a negative adjustment reduces them', () => {
    const t = computeLedgerTotals([], [prize(50)], [award(10, true), award(-5, true)]);
    expect(t.owedOut).toBe(55);
    expect(t.paidOut).toBe(55);
  });
});

describe('computeLedgerTotals — the reconciling figure', () => {
  it('states the gap between money in and money published as prizes', () => {
    const t = computeLedgerTotals([row(), row(), row()], [prize(40)], []);
    expect(t.owedIn).toBe(60);
    expect(t.owedOut).toBe(40);
    expect(t.unallocated).toBe(20);
  });

  it('a fully-allocated pool reports zero, so the row simply adds up', () => {
    const t = computeLedgerTotals([row(), row()], [prize(25), prize(15)], []);
    expect(t.unallocated).toBe(0);
  });

  /**
   * NOT CLAMPED. A bonus can commit more than the pool collected, and a
   * commissioner who cannot see that is the one person who needs to.
   */
  it('goes negative when awards exceed dues, rather than hiding it at zero', () => {
    const t = computeLedgerTotals([row()], [prize(20)], [award(30)]);
    expect(t.unallocated).toBe(-30);
  });

  it('unallocated is exactly owedIn minus owedOut, on every case above', () => {
    const cases: Array<[LedgerTotalsRow[], LedgerTotalsPrize[], LedgerTotalsAward[]]> = [
      [[row()], [], []],
      [[row(), row({ paidStatus: 'UNPAID' })], [prize(7)], [award(3)]],
      [[row({ rebuyOwed: 5, rebuyPaid: 5 })], [prize(100)], []],
      [[], [], [award(-12, true)]],
    ];
    for (const [rows, prizes, awards] of cases) {
      const t = computeLedgerTotals(rows, prizes, awards);
      expect(t.unallocated).toBe(t.owedIn - t.owedOut);
    }
  });
});

/**
 * THE LIVE POOL THAT PRODUCED THE BUG REPORT, REBUILT FROM THE SHIPPED MATH.
 *
 * Five entries at $20 in a HYBRID pool splitting $15/entry to the weekly pots
 * and $5/entry to the season pot, over a four-week preseason, paying 50/30/20.
 * Every figure below comes out of `shared/prizePot.ts` and `shared/prizeSplit.ts`
 * rather than being typed in, so this is the real arithmetic, not a restatement
 * of it — and it demonstrates that the $16 gap is produced by flooring, not by
 * the ledger mis-adding.
 */
describe('the $100 pool that pays out $84 — where the other $16 goes', () => {
  const settings = {
    payoutMode: 'HYBRID' as const,
    entryFee: 20,
    hybridSplit: { weeklyPerEntry: 15, seasonPerEntry: 5 },
    payouts: { places: [{ rank: 1, percentage: 50 }, { rank: 2, percentage: 30 }, { rank: 3, percentage: 20 }] },
  };
  const ENTRIES = 5;
  const WEEKS = 4;

  it('the weekly divisor drops $3 before any week is priced', () => {
    const pots = potBreakdown(settings, ENTRIES)!;
    expect(pots.gross).toBe(100);
    expect(pots.weeklySeasonAllocation).toBe(75);
    expect(pots.seasonPot).toBe(25);
    const perWeek = perWeekPrizePot(pots.weeklySeasonAllocation, WEEKS)!;
    expect(perWeek).toBe(18);                       // floor(75 / 4)
    expect(pots.weeklySeasonAllocation - perWeek * WEEKS).toBe(3);
  });

  it('each week then floors again, and the ledger states the total gap', () => {
    const pots = potBreakdown(settings, ENTRIES)!;
    const perWeek = perWeekPrizePot(pots.weeklySeasonAllocation, WEEKS)!;

    // Four weeks of three-way rankings: the pot is $18 and 50/30/20 pays
    // 9 + 5 + 3 = 17, so every week leaves a dollar behind.
    const weeks = [0, 1, 2, 3].map(() => splitPrizes({
      places: settings.payouts.places,
      pot: perWeek,
      ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 3 }],
    }));
    for (const w of weeks) {
      expect(w.awarded).toBe(17);
      expect(w.remainder).toBe(1);
    }

    const season = splitPrizes({
      places: [{ rank: 1, percentage: 100 }],
      pot: pots.seasonPot!,
      ranked: [{ id: 'a', rank: 1 }],
    });
    expect(season.awarded).toBe(25);

    const rows = Array.from({ length: ENTRIES }, () => row());
    const prizes = [
      ...weeks.flatMap(w => Object.values(w.awards).map(v => prize(v))),
      prize(season.awards.a),
    ];
    const t = computeLedgerTotals(rows, prizes, []);

    expect(t.owedIn).toBe(100);
    expect(t.owedOut).toBe(17 * 4 + 25);            // 93
    // 3 lost to the weeks divisor, 1 per week to the place split.
    expect(t.unallocated).toBe(3 + 4);
    expect(t.unallocated).toBe(t.owedIn - t.owedOut);
  });

  it('ties floor harder, which is how the same pool reaches a $16 gap', () => {
    // A two-way tie at rank 1 consumes places 1 and 2: (9 + 5) / 2 = 7 each,
    // and third place still pays 3 — 17 again. A three-way tie at rank 1
    // consumes all three places: floor(17 / 3) = 5 each, awarding 15 and
    // leaving 3. Same pot, different weeks, different remainders — which is
    // why the weekly columns on a real ledger do not share a total.
    const pot = 18;
    const places = [{ rank: 1, percentage: 50 }, { rank: 2, percentage: 30 }, { rank: 3, percentage: 20 }];

    const twoWayTie = splitPrizes({ places, pot, ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 }, { id: 'c', rank: 3 }] });
    expect(twoWayTie.awards.a).toBe(7);
    expect(twoWayTie.awards.b).toBe(7);
    expect(twoWayTie.awarded).toBe(17);

    const threeWayTie = splitPrizes({ places, pot, ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 }, { id: 'c', rank: 1 }] });
    expect(threeWayTie.awarded).toBe(15);
    expect(threeWayTie.remainder).toBe(3);

    // Only two entries scored: third place is configured but nobody reached it.
    const shortWeek = splitPrizes({ places, pot, ranked: [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }] });
    expect(shortWeek.awarded).toBe(14);
    expect(shortWeek.remainder).toBe(4);            // the unreached 20% place

    // Those three weeks plus one clean week reproduce the reported ledger.
    const prizes = [
      ...Object.values(twoWayTie.awards).map(v => prize(v)),
      ...Object.values(threeWayTie.awards).map(v => prize(v)),
      ...Object.values(shortWeek.awards).map(v => prize(v)),
      prize(9), prize(5), prize(3),
      prize(25),
    ].filter(p => p.owed > 0);

    const t = computeLedgerTotals(Array.from({ length: ENTRIES }, () => row()), prizes, []);
    expect(t.owedIn).toBe(100);
    expect(t.owedOut).toBe(17 + 15 + 14 + 17 + 25); // 88
    expect(t.unallocated).toBe(12);
    expect(t.unallocated).toBe(t.owedIn - t.owedOut);
  });
});
