import { describe, it, expect } from 'vitest';
import { calculateQuarterlyPayouts, recordedWinnersOf } from './payouts';
import type { GameState, Winner } from '../types';

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

describe('recordedWinnersOf', () => {
  it('reads a drawn final prize from what the draw chose', () => {
    const w = [{ id: 'final_rollover', period: 'final', squareId: 71, owner: 'P71', amount: 5, homeDigit: 8, awayDigit: 4, drawnAt: 1, drawnOwner: 'P12', drawnSquareId: 12 }] as Winner[];
    expect(recordedWinnersOf(w)).toEqual({ final_rollover: { squareId: 12, owner: 'P12', drawn: true } });
  });

  it('skips a record with no document id', () => {
    expect(recordedWinnersOf([{ period: 'q1', squareId: 1, owner: 'A', amount: 1, homeDigit: 1, awayDigit: 0 }] as Winner[])).toEqual({});
  });
});
