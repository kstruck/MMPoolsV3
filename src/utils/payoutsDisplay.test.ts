import { describe, it, expect } from 'vitest';
import { calculateQuarterlyPayouts, formatPrize, latestPlayerWinner } from './payouts';
import type { GameState, Winner } from '../types';

/**
 * Three things a browser walk-through of a wizard-created pool showed wrong on
 * the pool page (PLAN-SQUARES-REOPEN PR-C). None of them changes what anybody
 * is paid; each of them is what a player READS.
 */

const IDENTITY = { home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
const w = (over: Record<string, unknown>) =>
  ({ period: 'q1', squareId: 1, owner: 'Alice', amount: 100, homeDigit: 1, awayDigit: 0, ...over }) as unknown as Winner;

describe('formatPrize — a prize never reads "$12.5"', () => {
  it.each([
    [12.5, '$12.50'],
    [6.25, '$6.25'],
    [18.75, '$18.75'],
    [0.1, '$0.10'],
    [1234.5, '$1,234.50'],
  ])('%s is shown to the cent', (n, text) => {
    expect(formatPrize(n)).toBe(text);
  });

  it.each([
    [12, '$12'],
    [0, '$0'],
    [250, '$250'],
    [1000, '$1,000'],
  ])('%s is a whole number of dollars and stays bare', (n, text) => {
    expect(formatPrize(n)).toBe(text);
  });

  it.each([undefined, null, NaN, Infinity])('%s is $0', (n) => {
    expect(formatPrize(n as number)).toBe('$0');
  });
});

describe('latestPlayerWinner — the "In the money" banner names a player', () => {
  it('THE BUG: an unsold reverse square after the winner does not put "Rollover" in the banner', () => {
    // Document-id order, as the page receives them.
    const winners = [
      w({ id: 'q1', owner: 'Gina Guest', amount: 6.25 }),
      w({ id: 'q1_reverse', owner: 'Rollover', amount: 0 }),
    ];
    expect(latestPlayerWinner(winners)).toBe('Gina Guest');
  });

  it('never names "Unsold" either', () => {
    expect(latestPlayerWinner([w({ id: 'q1', owner: 'Unsold', amount: 50 })])).toBeNull();
    expect(latestPlayerWinner([w({ id: 'q1', owner: 'Alice' }), w({ id: 'half', owner: 'Unsold', amount: 50 })])).toBe('Alice');
  });

  it('the latest QUARTER wins, whatever order the records arrive in', () => {
    const winners = [
      w({ id: 'final', owner: 'Dana' }),
      w({ id: 'half', owner: 'Bob' }),
      w({ id: 'q1', owner: 'Alice' }),
      w({ id: 'q3', owner: 'Cara' }),
    ];
    expect(latestPlayerWinner(winners)).toBe('Dana');
    expect(latestPlayerWinner(winners.filter((x) => x.id !== 'final'))).toBe('Cara');
    expect(latestPlayerWinner(winners.filter((x) => x.id === 'half' || x.id === 'q1'))).toBe('Bob');
  });

  it('within a quarter, the winning square is named before its reverse', () => {
    expect(latestPlayerWinner([w({ id: 'half_reverse', owner: 'Rev' }), w({ id: 'half', owner: 'Reg' })])).toBe('Reg');
    // ...and the reverse winner is named when the winning square itself was unsold.
    expect(latestPlayerWinner([w({ id: 'half', owner: 'Rollover', amount: 0 }), w({ id: 'half_reverse', owner: 'Rev' })])).toBe('Rev');
  });

  it('whoever was awarded an unclaimed final prize is the latest winner of all', () => {
    expect(latestPlayerWinner([w({ id: 'final', owner: 'Rollover', amount: 0 }), w({ id: 'final_rollover', owner: 'Lucky', amount: 400 }), w({ id: 'q3', owner: 'Cara' })])).toBe('Lucky');
  });

  it('a winner with a prize is named before a later one whose prize is $0', () => {
    // A drawn prize the scores no longer call for is kept on record at $0.
    expect(latestPlayerWinner([w({ id: 'final_rollover', owner: 'Drawn', amount: 0 }), w({ id: 'q3', owner: 'Cara', amount: 100 })])).toBe('Cara');
    // ...but a $0 player winner is still better than nobody.
    expect(latestPlayerWinner([w({ id: 'q1', owner: 'Alice', amount: 0 })])).toBe('Alice');
  });

  it('Every Score Pays: the most recent scoring event, when no quarter has a player winner', () => {
    const events = [w({ id: 'event_3_0', owner: 'First' }), w({ id: 'event_3_3', owner: 'Unsold' }), w({ id: 'event_10_3', owner: 'Latest' })];
    expect(latestPlayerWinner(events)).toBe('Latest');
    expect(latestPlayerWinner([...events, w({ id: 'half', owner: 'Halftime Hal' })])).toBe('Halftime Hal');
    // The most recent event landing on an unsold square names the last PLAYER, not "Unsold".
    expect(latestPlayerWinner([...events, w({ id: 'event_17_3', owner: 'Unsold' })])).toBe('Latest');
  });

  it('nobody yet', () => {
    expect(latestPlayerWinner([])).toBeNull();
    expect(latestPlayerWinner([w({ owner: 'Alice' })])).toBeNull(); // a record with no id is not a record
  });
});

describe('card.prize — the payout list shows the whole quarter, not one winner\'s half', () => {
  const pool = (over: Record<string, unknown> = {}, unsold: number[] = []): GameState => ({
    id: 'p1', type: 'SQUARES', createdAt: Date.UTC(2026, 10, 20), costPerSquare: 10,
    squares: Array.from({ length: 100 }, (_, i) => ({ id: i, owner: unsold.includes(i) ? null : `P${i}` })),
    payouts: { q1: 25, half: 25, q3: 25, final: 25 },
    axisNumbers: IDENTITY, numberSets: 1, ruleVariations: {},
    scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' },
    ...over,
  }) as unknown as GameState;
  const card = (cards: ReturnType<typeof calculateQuarterlyPayouts>, period: string) => cards.find((c) => c.period === period)!;
  const played = { current: { home: 7, away: 3 }, q1: { home: 7, away: 3 }, half: null, q3: null, final: null, gameStatus: 'in' };

  it('THE BUG: with reverse winners on, a played quarter still lists its full 25%', () => {
    const cards = calculateQuarterlyPayouts(pool({ ruleVariations: { reverseWinners: true }, scores: played }), []);
    const q1 = card(cards, 'q1');
    expect(q1.amount).toBe(125); // what ONE winner is paid — the card under the grid
    expect(q1.prize).toBe(250);  // the quarter — the "1st Quarter (25%)" row
  });

  it('before the game every quarter lists its share', () => {
    const cards = calculateQuarterlyPayouts(pool({ ruleVariations: { reverseWinners: true } }), []);
    expect(cards.map((c) => c.prize)).toEqual([250, 250, 250, 250]);
  });

  it('a quarter that money rolled into lists the larger prize', () => {
    const p = pool({ ruleVariations: { quarterlyRollover: true }, scores: { ...played, half: { home: 14, away: 10 } } }, [37]);
    const cards = calculateQuarterlyPayouts(p, []);
    expect(card(cards, 'half').prize).toBe(495); // 99 sold: 247.50 of its own + 247.50 rolled in
    expect(card(cards, 'q1').prize).toBe(247.5);
  });

  it('a pool played under the old rules lists what was RECORDED for the quarter', () => {
    const old = pool({ createdAt: Date.UTC(2026, 1, 8), ruleVariations: { reverseWinners: true }, scores: played });
    const recorded = [
      w({ id: 'q1', squareId: 37, owner: 'P37', amount: 111 }),
      w({ id: 'q1_reverse', squareId: 73, owner: 'P73', amount: 111 }),
    ];
    expect(card(calculateQuarterlyPayouts(old, recorded), 'q1').prize).toBe(222);
  });

  it('and an old pool\'s unrecorded quarter lists the plain share its card shows', () => {
    const old = pool({ createdAt: Date.UTC(2026, 1, 8), ruleVariations: { reverseWinners: true }, scores: played });
    const q1 = card(calculateQuarterlyPayouts(old, []), 'q1');
    expect(q1.isUnrecorded).toBe(true);
    expect(q1.prize).toBe(q1.amount);
    expect(q1.prize).toBe(250);
  });
});
