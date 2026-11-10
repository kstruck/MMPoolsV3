import { describe, it, expect } from 'vitest';
import { calculateQuarterlyPayouts, payoutTotals, recordedWinnersOf } from './payouts';
import type { GameState, Winner } from '../types';
import { recordedEntry } from '@shared/squaresWinnerPlan';

/**
 * The period cards on a squares pool page (PLAN-SQUARES-REOPEN B3).
 *
 * The cards must say what the server records. Both now run the same shared
 * function, so these pin the DISPLAY decisions around it: what an unplayed
 * period shows, how a live projection reads, and that a recorded winner wins
 * over the grid as it stands today.
 *
 * Grid: numbers 0–9 in order, square N owned by `P{N}`, $10 a square → $1,000.
 */
const IDENTITY = { home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };

const pool = (over: Record<string, unknown> = {}, unsold: number[] = []): GameState => {
  const squares = Array.from({ length: 100 }, (_, i) => ({ id: i, owner: unsold.includes(i) ? null : `P${i}` }));
  return {
    id: 'p1',
    type: 'SQUARES',
    // On the CURRENT rules unless a test says otherwise. A pool with no
    // creation date is read as one played under the old rules.
    createdAt: Date.UTC(2026, 10, 20),
    costPerSquare: 10,
    squares,
    payouts: { q1: 20, half: 20, q3: 20, final: 40 },
    axisNumbers: IDENTITY,
    numberSets: 1,
    ruleVariations: {},
    scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' },
    ...over,
  } as unknown as GameState;
};

const scores = (s: Record<string, unknown>) => ({ current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'in', ...s });
const card = (cards: ReturnType<typeof calculateQuarterlyPayouts>, period: string) => cards.find((c) => c.period === period)!;

describe('before the game', () => {
  it('shows every prize and no winner', () => {
    const cards = calculateQuarterlyPayouts(pool(), []);
    expect(cards.map((c) => [c.period, c.amount, c.winnerName, c.isLocked])).toEqual([
      ['q1', 200, 'TBD', false], ['half', 200, 'TBD', false], ['q3', 200, 'TBD', false], ['final', 400, 'TBD', false],
    ]);
  });

  it('M1 — the prizes shown are after charity', () => {
    const cards = calculateQuarterlyPayouts(pool({ charity: { enabled: true, percentage: 10 } }), []);
    expect(cards.map((c) => c.amount)).toEqual([180, 180, 180, 360]);
  });

  it('is empty for a pool type that has no period cards', () => {
    expect(calculateQuarterlyPayouts(pool({ type: 'BRACKET' }), [])).toEqual([]);
  });
});

describe('during the game', () => {
  const live = pool({ scores: scores({ current: { home: 10, away: 3 }, q1: { home: 7, away: 3 } }) });

  it('a final period is locked on its own score', () => {
    expect(card(calculateQuarterlyPayouts(live, []), 'q1')).toMatchObject({ home: 7, away: 3, winnerName: 'P37', amount: 200, isLocked: true });
  });

  it('an unfinished period is projected on the current score, and not locked', () => {
    expect(card(calculateQuarterlyPayouts(live, []), 'half')).toMatchObject({ home: 10, away: 3, winnerName: 'P30', isLocked: false, qPointsHome: 3, qPointsAway: 0 });
  });

  it('reverse winners: the card shows the half each of them gets', () => {
    const p = pool({ ruleVariations: { reverseWinners: true }, scores: scores({ current: { home: 7, away: 3 }, q1: { home: 7, away: 3 } }) });
    expect(card(calculateQuarterlyPayouts(p, []), 'q1')).toMatchObject({ winnerName: 'P37', reverseWinnerName: 'P73', amount: 100 });
  });

  it('M2 — reverse winners with matching digits: one winner, the whole prize', () => {
    const p = pool({ ruleVariations: { reverseWinners: true }, scores: scores({ current: { home: 24, away: 14 }, q1: { home: 24, away: 14 } }) });
    expect(card(calculateQuarterlyPayouts(p, []), 'q1')).toMatchObject({ winnerName: 'P44', reverseWinnerName: null, amount: 200 });
  });
});

describe('rollover', () => {
  it('an unsold period shows as rolling over, and the next card carries the money', () => {
    const p = pool({ ruleVariations: { quarterlyRollover: true }, scores: scores({ current: { home: 14, away: 10 }, q1: { home: 7, away: 3 }, half: { home: 14, away: 10 } }) }, [37]);
    const cards = calculateQuarterlyPayouts(p, []);
    expect(card(cards, 'q1')).toMatchObject({ winnerName: 'Rollover', isRollover: true, amount: 0 });
    expect(card(cards, 'half')).toMatchObject({ winnerName: 'P4', amount: 396, rolloverAdded: 198 });
  });

  it('a carry waiting on an UNPLAYED period is shown on that period only', () => {
    // Scored by hand: the first quarter is in, the game status was never moved off "pre".
    const p = pool({ ruleVariations: { quarterlyRollover: true }, scores: scores({ gameStatus: 'pre', q1: { home: 7, away: 3 } }) }, [37]);
    const cards = calculateQuarterlyPayouts(p, []);
    expect(cards.map((c) => c.amount)).toEqual([0, 396, 198, 396]);
    expect(card(cards, 'half').rolloverAdded).toBe(198);
    expect(card(cards, 'q3').rolloverAdded).toBe(0);
  });

  it('an unclaimed FINAL prize names who it went to', () => {
    const final = { q1: { home: 7, away: 3 }, half: { home: 14, away: 10 }, q3: { home: 21, away: 17 }, final: { home: 28, away: 24 } };
    const p = pool({ ruleVariations: { quarterlyRollover: true }, scores: scores({ gameStatus: 'post', current: final.final, ...final }) }, [48]);
    expect(card(calculateQuarterlyPayouts(p, []), 'final')).toMatchObject({ winnerName: 'Rollover', bonusWinnerName: 'P71', bonusAmount: 396 });
  });

  it('…or that it is waiting on the draw', () => {
    const final = { q1: { home: 7, away: 3 }, half: { home: 14, away: 10 }, q3: { home: 21, away: 17 }, final: { home: 28, away: 24 } };
    const p = pool({ ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' }, scores: scores({ gameStatus: 'post', current: final.final, ...final }) }, [48]);
    expect(card(calculateQuarterlyPayouts(p, []), 'final').bonusWinnerName).toBe('Awaiting random draw');
  });
});

describe('what is on record wins over the grid as it stands', () => {
  const live = pool({ scores: scores({ current: { home: 7, away: 3 }, q1: { home: 7, away: 3 } }) });

  it('a recorded Unsold stays Unsold after someone takes the square', () => {
    const recorded = [{ id: 'q1', period: 'q1', squareId: 37, owner: 'Unsold', amount: 200, homeDigit: 7, awayDigit: 3 }] as Winner[];
    expect(card(calculateQuarterlyPayouts(live, recorded), 'q1').winnerName).toBe('Unsold');
  });

  it('a recorded winner keeps the prize after their square is released', () => {
    const released = pool({ scores: live.scores }, [37]);
    const recorded = [{ id: 'q1', period: 'q1', squareId: 37, owner: 'Alice', amount: 200, homeDigit: 7, awayDigit: 3, isPaid: true }] as Winner[];
    expect(card(calculateQuarterlyPayouts(released, recorded), 'q1')).toMatchObject({ winnerName: 'Alice', isPaid: true });
  });

  it('a recorded AMOUNT is shown as recorded — a pool paid under the old rules keeps its history', () => {
    // Recorded on the gross pot ($200); today's math, after 10% charity, says $180.
    const charity = pool({ charity: { enabled: true, percentage: 10 }, scores: live.scores });
    const recorded = [{ id: 'q1', period: 'q1', squareId: 37, owner: 'P37', amount: 200, homeDigit: 7, awayDigit: 3 }] as Winner[];
    expect(card(calculateQuarterlyPayouts(charity, recorded), 'q1').amount).toBe(200);
    expect(card(calculateQuarterlyPayouts(charity, []), 'q1').amount).toBe(180);
  });

  it('a recorded reverse winner and a recorded final-prize award are shown from their records', () => {
    const final = { q1: { home: 7, away: 3 }, half: { home: 14, away: 10 }, q3: { home: 21, away: 17 }, final: { home: 28, away: 24 } };
    const done = pool({ scores: scores({ gameStatus: 'post', current: final.final, ...final }) });
    const recorded = [
      { id: 'final', period: 'final', squareId: 48, owner: 'Rollover', amount: 0, homeDigit: 8, awayDigit: 4 },
      { id: 'final_reverse', period: 'final', squareId: 84, owner: 'Rita', amount: 55, homeDigit: 4, awayDigit: 8, isReverse: true },
      { id: 'final_rollover', period: 'final', squareId: 12, owner: 'Dana', amount: 345, homeDigit: 8, awayDigit: 4, drawnAt: 1 },
    ] as Winner[];
    expect(card(calculateQuarterlyPayouts(done, recorded), 'final')).toMatchObject({
      winnerName: 'Rollover', isRollover: true, reverseWinnerName: 'Rita', amount: 55, bonusWinnerName: 'Dana', bonusAmount: 345,
    });
  });

  it('a scoring-event record is not mistaken for a period winner', () => {
    const recorded = [{ id: 'event_7_3', period: 'Event', squareId: 37, owner: 'Unsold', amount: 0, homeDigit: 7, awayDigit: 3 }] as Winner[];
    expect(card(calculateQuarterlyPayouts(live, recorded), 'q1').winnerName).toBe('P37');
  });
});

describe('Every Score Pays', () => {
  it('equal split: no period pays', () => {
    const p = pool({ ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'equal_split' } });
    expect(calculateQuarterlyPayouts(p, []).map((c) => [c.amount, c.winnerName])).toEqual([[0, '—'], [0, '—'], [0, '—'], [0, '—']]);
  });

  it('hybrid with rollover: money rolling out of halftime skips the third quarter, which pays nothing', () => {
    // 99 sold → $990. Halftime (20% = $198) lands on an unsold square and rolls to the FINAL.
    const p = pool({
      ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: 'hybrid', quarterlyRollover: true },
      scores: scores({ gameStatus: 'pre', half: { home: 14, away: 10 } }),
    }, [4]);
    const cards = calculateQuarterlyPayouts(p, []);
    expect(cards.map((c) => c.amount)).toEqual([0, 0, 0, 594]);
    expect(card(cards, 'q3')).toMatchObject({ winnerName: '—', rolloverAdded: 0 });
    expect(card(cards, 'final').rolloverAdded).toBe(198);
  });

  it('hybrid (and an unset strategy): halftime 20%, final 40%, nothing on q1 or q3', () => {
    for (const strategy of ['hybrid', undefined]) {
      const p = pool({ ruleVariations: { scoreChangePayout: true, scoreChangePayoutStrategy: strategy } });
      expect(calculateQuarterlyPayouts(p, []).map((c) => c.amount)).toEqual([0, 200, 0, 400]);
    }
  });
});

describe('a pool played under the old rules shows its records and nothing worked out today', () => {
  // Rollover was ON, but the old server recorded an unsold quarter as "Unsold" and moved nothing.
  const OLD = Date.UTC(2026, 1, 8);
  const NEW = Date.UTC(2026, 10, 20);
  const played = (createdAt: number) => pool({
    createdAt,
    ruleVariations: { quarterlyRollover: true },
    scores: scores({ gameStatus: 'post', current: { home: 14, away: 10 }, q1: { home: 7, away: 3 }, half: { home: 14, away: 10 } }),
  }, [37]);
  const recorded = [
    { id: 'q1', period: 'q1', squareId: 37, owner: 'Unsold', amount: 198, homeDigit: 7, awayDigit: 3 },
    { id: 'half', period: 'half', squareId: 4, owner: 'P4', amount: 198, homeDigit: 4, awayDigit: 0 },
  ] as Winner[];

  it('no "includes $X rolled over" on a card whose pool never rolled anything', () => {
    const half = card(calculateQuarterlyPayouts(played(OLD), recorded), 'half');
    expect(half).toMatchObject({ winnerName: 'P4', amount: 198, rolloverAdded: 0 });
  });

  it('a pool on the current rules does show what rolled in', () => {
    const rolled = [
      { id: 'q1', period: 'q1', squareId: 37, owner: 'Rollover', amount: 0, homeDigit: 7, awayDigit: 3 },
      { id: 'half', period: 'half', squareId: 4, owner: 'P4', amount: 396, homeDigit: 4, awayDigit: 0 },
    ] as Winner[];
    expect(card(calculateQuarterlyPayouts(played(NEW), rolled), 'half')).toMatchObject({ amount: 396, rolloverAdded: 198 });
  });
});

/**
 * qodo, PR #759 round 3. An old pool with a FINISHED quarter and no record for
 * it — a hand-scored pool recorded no winners before 2026-11. There is no
 * history to show, and today's reverse/rollover/unclaimed-prize rules were not
 * the rules that game was played under.
 */
describe('an old pool with a finished quarter that was never recorded', () => {
  const OLD = Date.UTC(2026, 1, 8);
  const NEW = Date.UTC(2026, 10, 20);
  const game = scores({ gameStatus: 'post', current: { home: 11, away: 11 }, q1: { home: 7, away: 3 }, half: { home: 14, away: 10 }, q3: { home: 21, away: 17 }, final: { home: 11, away: 11 } });
  const rules = { reverseWinners: true, quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'last_winner' };
  // Q1's square (37) and the final square (11) were never sold.
  const played = (createdAt: number) => pool({ createdAt, ruleVariations: rules, scores: game }, [37, 11]);
  const base = (98 * 10) * 0.2; // 98 sold at $10, 20% a quarter

  it('shows who owns the square the score lands on, the plain share, and says it is not a record', () => {
    const cards = calculateQuarterlyPayouts(played(OLD), []);
    const half = card(cards, 'half');
    expect(half).toMatchObject({ winnerName: 'P4', amount: base, isUnrecorded: true, isLocked: true });
  });

  it('applies none of today\'s rules to it: no reverse split, no rollover, no unclaimed-prize award', () => {
    const cards = calculateQuarterlyPayouts(played(OLD), []);
    // Reverse winners is on: under today's rules P4 would be shown HALF, with P40 beside them.
    expect(card(cards, 'half')).toMatchObject({ amount: base, reverseWinnerName: null });
    // Q1's square is unsold: named as unsold, at its own share, rolling nothing.
    expect(card(cards, 'q1')).toMatchObject({ winnerName: 'Unsold', amount: base, isRollover: false, isUnrecorded: true });
    for (const c of cards) expect(c.rolloverAdded, c.period).toBe(0);
    // The final square is unsold too: today's rules would award it to the last winner.
    expect(card(cards, 'final')).toMatchObject({ winnerName: 'Unsold', bonusWinnerName: null, bonusAmount: 0 });
  });

  it('a quarter that WAS recorded on that pool is shown as recorded, unflagged', () => {
    const recorded = [{ id: 'half', period: 'half', squareId: 4, owner: 'P4', amount: 123, homeDigit: 4, awayDigit: 0 }] as Winner[];
    const cards = calculateQuarterlyPayouts(played(OLD), recorded);
    expect(card(cards, 'half')).toMatchObject({ winnerName: 'P4', amount: 123, isUnrecorded: false });
    expect(card(cards, 'q3').isUnrecorded).toBe(true);
  });

  it('a pool on the current rules is never flagged — its unrecorded quarter is worked out in full', () => {
    const cards = calculateQuarterlyPayouts(played(NEW), []);
    for (const c of cards) expect(c.isUnrecorded, c.period).toBe(false);
    // ...with today's rules: the reverse winner shares the halftime prize.
    expect(card(cards, 'half').reverseWinnerName).toBe('P40');
  });

  it('an old pool\'s quarter that has not finished is a projection, not "unrecorded"', () => {
    const live = pool({ createdAt: OLD, scores: scores({ gameStatus: 'in', current: { home: 7, away: 3 } }) });
    for (const c of calculateQuarterlyPayouts(live, [])) expect(c.isUnrecorded, c.period).toBe(false);
  });
});

describe('recordedWinnersOf', () => {
  it('reads a record the way the server does — one reader, not a copy', () => {
    // Every shape the two copies used to disagree about.
    const cases: Array<Record<string, unknown>> = [
      { id: 'final_rollover', squareId: 71, owner: 'P71', drawnAt: 1, drawnOwner: 'P12', drawnSquareId: 12 },
      { id: 'final_rollover', squareId: 71, owner: 'P71', drawnAt: 1 },                       // drawn before drawnOwner existed
      { id: 'final_rollover', squareId: 71, owner: 'P71', drawnAt: 1, drawnOwner: '', drawnSquareId: null },
      { id: 'final_rollover', squareId: 71, owner: 'P71', drawnOwner: 'P12', drawnSquareId: 12 }, // never drawn
      { id: 'q1', squareId: 37, owner: 'P37' },
      { id: 'q1', squareId: 37, owner: null },
    ];
    for (const c of cases) {
      expect(recordedWinnersOf([c as unknown as Winner])[c.id as string], JSON.stringify(c))
        .toEqual(recordedEntry({ id: c.id as string, data: c }));
    }
  });

  it('reads a drawn final prize from what the draw chose', () => {
    const w = [{ id: 'final_rollover', period: 'final', squareId: 71, owner: 'P71', amount: 5, homeDigit: 8, awayDigit: 4, drawnAt: 1, drawnOwner: 'P12', drawnSquareId: 12 }] as Winner[];
    expect(recordedWinnersOf(w)).toEqual({ final_rollover: { squareId: 12, owner: 'P12', drawn: true } });
  });

  it('skips a record with no document id', () => {
    expect(recordedWinnersOf([{ period: 'q1', squareId: 1, owner: 'A', amount: 1, homeDigit: 1, awayDigit: 0 }] as Winner[])).toEqual({});
  });
});

/**
 * qodo, PR #759 round 3 — the Payouts tab's "Pending" went NEGATIVE when a
 * prize fell after it had been marked paid.
 */
describe('payoutTotals — won, handed over, still to hand over', () => {
  const w = (over: Record<string, unknown>) => ({ id: 'q1', period: 'q1', squareId: 1, owner: 'Alice', amount: 200, homeDigit: 1, awayDigit: 0, ...over }) as unknown as Winner;

  it('an unpaid prize is owed in full', () => {
    expect(payoutTotals([w({})])).toEqual({ won: 200, paid: 0, pending: 200 });
  });

  it('a paid prize is owed nothing', () => {
    expect(payoutTotals([w({ isPaid: true, paidAmount: 200 })])).toEqual({ won: 200, paid: 200, pending: 0 });
  });

  it('THE BUG: a prize that FELL after it was paid does not make Pending negative', () => {
    // A drawn final prize paid at $396, then set to $0 when the final score was corrected.
    expect(payoutTotals([w({ amount: 0, isPaid: true, paidAmount: 396 })])).toEqual({ won: 0, paid: 396, pending: 0 });
    // ...and it does not hide what another winner is still owed.
    expect(payoutTotals([w({ amount: 0, isPaid: true, paidAmount: 396 }), w({ id: 'half', amount: 150 })]))
      .toEqual({ won: 150, paid: 396, pending: 150 });
  });

  it('a prize that GREW after it was paid owes the difference', () => {
    expect(payoutTotals([w({ amount: 200, isPaid: true, paidAmount: 190 })])).toEqual({ won: 200, paid: 190, pending: 10 });
  });

  it('a prize paid before paidAmount existed counts as paid at what it is now', () => {
    expect(payoutTotals([w({ isPaid: true })])).toEqual({ won: 200, paid: 200, pending: 0 });
  });

  it('a prize nobody won — unsold, or rolled over — is in none of the three', () => {
    expect(payoutTotals([w({ owner: 'Unsold' }), w({ owner: 'Rollover', amount: 0 }), w({ owner: 'Unsold', isPaid: true, paidAmount: 200 })]))
      .toEqual({ won: 0, paid: 0, pending: 0 });
  });

  it('adds up across winners, and never goes below zero', () => {
    const totals = payoutTotals([
      w({ amount: 200 }),                                    // unpaid
      w({ id: 'half', amount: 200, isPaid: true, paidAmount: 200 }),
      w({ id: 'q3', amount: 100, isPaid: true, paidAmount: 250 }), // overpaid
      w({ id: 'final', amount: 400, isPaid: true, paidAmount: 380 }), // underpaid by 20
    ]);
    expect(totals).toEqual({ won: 900, paid: 830, pending: 220 });
    expect(totals.pending).toBeGreaterThanOrEqual(0);
  });

  it('an amount that is not a number counts as nothing', () => {
    expect(payoutTotals([w({ amount: undefined }), w({ amount: NaN, isPaid: true })])).toEqual({ won: 0, paid: 0, pending: 0 });
  });

  it('no records, no totals', () => {
    expect(payoutTotals([])).toEqual({ won: 0, paid: 0, pending: 0 });
  });
});
