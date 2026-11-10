import { describe, it, expect } from 'vitest';
import {
  computeEventPayouts,
  computePeriodPayouts,
  axisForPeriod,
  hybridWeights,
  periodBase,
  periodPercent,
  reverseSquare,
  splitCents,
  squaresPot,
  SQUARES_RULES_SINCE_MS,
  storedTimeMs,
  usesCurrentWinnerRules,
  winningSquare,
  ROLLOVER,
  UNSOLD,
  type PayoutPool,
  type PeriodClaim,
} from '../shared/squaresPayouts';

/**
 * SQUARES PAYOUT MATH (PLAN-SQUARES-REOPEN B1).
 *
 * Every number asserted here is a dollar amount a commissioner pays out, so the
 * expectations are written out by hand from the rule, not derived from the code.
 *
 * THE GRID. `IDENTITY` puts digit N on row N (away) and column N (home), so a
 * score of away 3 / home 7 wins square 37 — readable without a lookup table.
 */

const IDENTITY = { home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };

/** A full grid at $10 a square: a $1,000 pot. Square N is owned by `P{N}`. */
const fullGrid = () => Array.from({ length: 100 }, (_, i) => ({ id: i, owner: `P${i}` as string | null }));

const pool = (over: Partial<PayoutPool> = {}, unsold: number[] = []): PayoutPool => {
  const squares = fullGrid();
  for (const id of unsold) squares[id].owner = null;
  return {
    costPerSquare: 10,
    squares,
    payouts: { q1: 20, half: 20, q3: 20, final: 40 },
    axisNumbers: IDENTITY,
    numberSets: 1,
    ruleVariations: {},
    ...over,
  };
};

/** home/away → the square on the identity grid: row = away digit, column = home digit. */
const sq = (home: number, away: number) => (away % 10) * 10 + (home % 10);

const claim = (claims: PeriodClaim[], docId: string) => {
  const c = claims.find((x) => x.docId === docId);
  if (!c) throw new Error(`no claim ${docId}; have ${claims.map((x) => x.docId).join(',')}`);
  return c;
};

const allClaims = (p: PayoutPool, scores: Parameters<typeof computePeriodPayouts>[1], recorded?: Parameters<typeof computePeriodPayouts>[2]) =>
  computePeriodPayouts(p, scores, recorded).flatMap((r) => r.claims);

const paidToPlayers = (claims: PeriodClaim[]) =>
  Math.round(claims.filter((c) => c.sold).reduce((n, c) => n + c.amount, 0) * 100) / 100;

const FULL_GAME = { q1: { home: 7, away: 3 }, half: { home: 14, away: 10 }, q3: { home: 21, away: 17 }, final: { home: 28, away: 24 } };

describe('the pot', () => {
  it('is squares sold times the price', () => {
    expect(squaresPot(pool())).toEqual({ sold: 100, gross: 1000, charity: 0, net: 1000 });
    expect(squaresPot(pool({}, [0, 1, 2]))).toMatchObject({ sold: 97, gross: 970 });
  });

  it('takes charity off the top, floored to a whole dollar', () => {
    expect(squaresPot(pool({ charity: { enabled: true, percentage: 10 } }))).toEqual({ sold: 100, gross: 1000, charity: 100, net: 900 });
    // 97 squares × $10 × 15% = $145.50 → $145 to charity.
    expect(squaresPot(pool({ charity: { enabled: true, percentage: 15 } }, [0, 1, 2]))).toMatchObject({ charity: 145, net: 825 });
  });

  // A fee with cents is allowed by the create contract. The prize pot keeps
  // them: flooring it would strand money the players paid in.
  it('keeps the cents of a fee that has them — the prize pot is not floored', () => {
    // 97 squares × $2.50 = $242.50; 10% = $24.25 → $24 to charity; $218.50 for prizes.
    const pot = squaresPot(pool({ costPerSquare: 2.5, charity: { enabled: true, percentage: 10 } }, [0, 1, 2]));
    expect(pot).toEqual({ sold: 97, gross: 242.5, charity: 24, net: 218.5 });
    expect(pot.charity + pot.net).toBe(pot.gross);
  });

  it('is exact to the cent — 100 squares at $1.10 is $110, not 110.00000000000001', () => {
    expect(100 * 1.1).not.toBe(110);
    expect(squaresPot(pool({ costPerSquare: 1.1 }))).toEqual({ sold: 100, gross: 110, charity: 0, net: 110 });
    // 100 × $1.10 with 7% to charity: $7.70 → $7; $103 for prizes.
    expect(squaresPot(pool({ costPerSquare: 1.1, charity: { enabled: true, percentage: 7 } }))).toEqual({ sold: 100, gross: 110, charity: 7, net: 103 });
    // 97 × $1.40 = $135.80; 10% = $13.58 → $13; the rest is $122.80, not 122.80000000000001.
    expect(squaresPot(pool({ costPerSquare: 1.4, charity: { enabled: true, percentage: 10 } }, [0, 1, 2]))).toEqual({ sold: 97, gross: 135.8, charity: 13, net: 122.8 });
  });

  it('ignores a charity percentage that is switched off, and bounds one that is not sane', () => {
    expect(squaresPot(pool({ charity: { enabled: false, percentage: 50 } })).charity).toBe(0);
    expect(squaresPot(pool({ charity: { enabled: true, percentage: 250 } })).net).toBe(0);
    expect(squaresPot(pool({ charity: { enabled: true, percentage: -5 } })).charity).toBe(0);
  });

  it('is zero, not NaN, for a pool with no squares or no price', () => {
    expect(squaresPot({})).toEqual({ sold: 0, gross: 0, charity: 0, net: 0 });
    expect(squaresPot({ squares: fullGrid() }).gross).toBe(0);
  });
});

describe('which square wins', () => {
  it('the AWAY digit picks the row and the HOME digit the column', () => {
    expect(winningSquare(IDENTITY, { home: 17, away: 3 })).toEqual({ squareId: 37, homeDigit: 7, awayDigit: 3 });
  });

  it('follows the shuffled numbers, not the position', () => {
    const axis = { home: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], away: [5, 6, 7, 8, 9, 0, 1, 2, 3, 4] };
    // away 3 is at row index 8; home 7 is at column index 2.
    expect(winningSquare(axis, { home: 7, away: 3 })?.squareId).toBe(82);
  });

  it('the reverse square swaps the digits', () => {
    expect(reverseSquare(IDENTITY, { home: 7, away: 3 })).toBe(73);
  });

  it('there is NO reverse square when both digits are the same', () => {
    expect(reverseSquare(IDENTITY, { home: 24, away: 14 })).toBeNull();
    expect(reverseSquare(IDENTITY, { home: 0, away: 0 })).toBeNull();
  });

  it('returns nothing rather than a wrong square when the numbers are incomplete', () => {
    expect(winningSquare({ home: [0, 1, 2], away: IDENTITY.away }, { home: 7, away: 3 })).toBeNull();
  });
});

describe('which numbers a period is judged against', () => {
  const q = (n: number) => ({ home: IDENTITY.home.map((d) => (d + n) % 10), away: IDENTITY.away });
  const four = pool({ numberSets: 4, axisNumbers: q(9), quarterlyNumbers: { q1: q(1), q2: q(2), q3: q(3), q4: q(4) } });

  it('one set: the grid numbers for every period', () => {
    for (const p of ['q1', 'half', 'q3', 'final'] as const) expect(axisForPeriod(pool(), p)).toBe(IDENTITY);
  });

  it('four sets: q1 → first quarter, q2 → halftime, q3 → third, q4 → final', () => {
    expect(axisForPeriod(four, 'q1')).toEqual(q(1));
    expect(axisForPeriod(four, 'half')).toEqual(q(2));
    expect(axisForPeriod(four, 'q3')).toEqual(q(3));
    expect(axisForPeriod(four, 'final')).toEqual(q(4));
  });

  it('four sets with a quarter missing falls back to the grid numbers', () => {
    const partial = pool({ numberSets: 4, quarterlyNumbers: { q1: q(1) } });
    expect(axisForPeriod(partial, 'final')).toBe(IDENTITY);
  });

  it('no numbers at all → null, and no winner is computed', () => {
    const unlocked = pool({ axisNumbers: null });
    expect(axisForPeriod(unlocked, 'q1')).toBeNull();
    expect(computePeriodPayouts(unlocked, FULL_GAME)).toEqual([]);
  });

  it('each period is paid on its OWN set of numbers', () => {
    // 7–3 on the q(1) grid: home digit 7 sits at column index 6 → square 36.
    expect(claim(allClaims(four, { q1: { home: 7, away: 3 } }), 'q1').squareId).toBe(36);
    // The same score at halftime is judged on q(2): column index 5 → square 35.
    expect(claim(allClaims(four, { q1: { home: 0, away: 0 }, half: { home: 7, away: 3 } }), 'half').squareId).toBe(35);
  });
});

describe('a standard pool', () => {
  it('pays each period its percentage of the pot', () => {
    const claims = allClaims(pool(), FULL_GAME);
    expect(claims.map((c) => [c.docId, c.squareId, c.owner, c.amount])).toEqual([
      ['q1', sq(7, 3), 'P37', 200],
      ['half', sq(14, 10), 'P4', 200],
      ['q3', sq(21, 17), 'P71', 200],
      ['final', sq(28, 24), 'P48', 400],
    ]);
    expect(paidToPlayers(claims)).toBe(1000);
  });

  it('computes only the periods that are final', () => {
    expect(allClaims(pool(), { q1: FULL_GAME.q1 }).map((c) => c.docId)).toEqual(['q1']);
    expect(allClaims(pool(), {})).toEqual([]);
  });

  it('a 0–0 quarter is a real score, not a missing one', () => {
    expect(claim(allClaims(pool(), { q1: { home: 0, away: 0 } }), 'q1')).toMatchObject({ squareId: 0, owner: 'P0', amount: 200 });
  });

  it('records the digits the winner is paid on', () => {
    expect(claim(allClaims(pool(), FULL_GAME), 'q1')).toMatchObject({ homeDigit: 7, awayDigit: 3, isReverse: false, isRollover: false, sold: true });
  });

  it('M1 — percentages apply to the pot AFTER charity', () => {
    const claims = allClaims(pool({ charity: { enabled: true, percentage: 10 } }), FULL_GAME);
    expect(claims.map((c) => c.amount)).toEqual([180, 180, 180, 360]);
    expect(paidToPlayers(claims)).toBe(900);
  });

  it('pays to the cent on an awkward pot', () => {
    // 33 squares × $7 = $231; 12.5% is not offered, so use 25%: $57.75.
    const p = pool({ costPerSquare: 7, payouts: { q1: 25, half: 25, q3: 25, final: 25 } }, Array.from({ length: 67 }, (_, i) => i + 33));
    expect(squaresPot(p).net).toBe(231);
    expect(periodBase(p, 'q1')).toBe(57.75);
  });
});

describe('reverse winners', () => {
  const reverse = (over: Partial<PayoutPool> = {}, unsold: number[] = []) =>
    pool({ ...over, ruleVariations: { reverseWinners: true, ...(over.ruleVariations ?? {}) } }, unsold);

  it('two different squares split the prize in half', () => {
    const claims = allClaims(reverse(), { q1: { home: 7, away: 3 } });
    expect(claims.map((c) => [c.docId, c.squareId, c.owner, c.amount, c.isReverse])).toEqual([
      ['q1', 37, 'P37', 100, false],
      ['q1_reverse', 73, 'P73', 100, true],
    ]);
  });

  it('the reverse claim stores the swapped digits', () => {
    expect(claim(allClaims(reverse(), { q1: { home: 7, away: 3 } }), 'q1_reverse')).toMatchObject({ homeDigit: 3, awayDigit: 7 });
  });

  it('M2 — when both digits match there is ONE winner and they take the whole prize', () => {
    const claims = allClaims(reverse(), { q1: { home: 24, away: 14 } });
    expect(claims.map((c) => [c.docId, c.owner, c.amount])).toEqual([['q1', 'P44', 200]]);
  });

  it('an odd cent goes to one of the two — the halves always sum to the prize', () => {
    // 3 squares × $0.35 = $1.05 pot, 100% on the final → $1.05 split 0.53 / 0.52.
    const p = reverse({ costPerSquare: 0.35, payouts: { q1: 0, half: 0, q3: 0, final: 100 } }, Array.from({ length: 100 }, (_, i) => i).filter((i) => ![37, 73, 0].includes(i)));
    const claims = allClaims(p, { final: { home: 7, away: 3 } });
    expect(claims.map((c) => c.amount)).toEqual([0.53, 0.52]);
    expect(paidToPlayers(claims)).toBe(1.05);
  });

  it('an unsold reverse square keeps its half with the organizer when rollover is off', () => {
    const claims = allClaims(reverse({}, [73]), { q1: { home: 7, away: 3 } });
    // 99 sold → $990; 20% = $198; half each.
    expect(claim(claims, 'q1')).toMatchObject({ owner: 'P37', amount: 99 });
    expect(claim(claims, 'q1_reverse')).toMatchObject({ owner: UNSOLD, amount: 99, sold: false });
  });

  it('an unsold reverse square rolls its half forward when rollover is on', () => {
    const p = reverse({ ruleVariations: { quarterlyRollover: true } }, [73]);
    const results = computePeriodPayouts(p, { q1: { home: 7, away: 3 }, half: { home: 14, away: 10 } });
    expect(claim(results[0].claims, 'q1_reverse')).toMatchObject({ owner: ROLLOVER, amount: 0, isRollover: true });
    expect(results[0].rolloverOut).toBe(99); // half of 20% of a $990 pot
    // Halftime is 14–10 → squares 4 and 40, both sold: (198 + 99) / 2 each.
    expect(results[1].prize).toBe(297);
    expect(results[1].claims.map((c) => c.amount)).toEqual([148.5, 148.5]);
  });
});

describe('M3 — roll over winnings', () => {
  const rolling = (unsold: number[], over: Partial<PayoutPool> = {}) =>
    pool({ ...over, ruleVariations: { quarterlyRollover: true, ...(over.ruleVariations ?? {}) } }, unsold);

  it('OFF: an unsold winning square is recorded Unsold with the prize, and nothing moves', () => {
    const results = computePeriodPayouts(pool({}, [37]), FULL_GAME);
    expect(claim(results[0].claims, 'q1')).toMatchObject({ owner: UNSOLD, amount: 198, sold: false, isRollover: false });
    expect(results[1].rolloverIn).toBe(0);
    expect(claim(results[1].claims, 'half').amount).toBe(198);
  });

  it('ON: the prize moves to the next period', () => {
    const results = computePeriodPayouts(rolling([37]), FULL_GAME);
    expect(claim(results[0].claims, 'q1')).toMatchObject({ owner: ROLLOVER, amount: 0, isRollover: true, sold: false });
    expect(results[0].rolloverOut).toBe(198);
    expect(results[1]).toMatchObject({ base: 198, rolloverIn: 198, prize: 396 });
    expect(claim(results[1].claims, 'half')).toMatchObject({ owner: 'P4', amount: 396 });
    expect(results[2].rolloverIn).toBe(0);
  });

  it('ON: it keeps rolling through consecutive unsold periods', () => {
    const results = computePeriodPayouts(rolling([37, 4, 71]), FULL_GAME);
    // 97 sold → $970: 194 + 194 + 194 roll into the final's 388.
    expect(results.map((r) => r.rolloverOut)).toEqual([194, 388, 582, 0]);
    expect(claim(results[3].claims, 'final')).toMatchObject({ owner: 'P48', amount: 970 });
    expect(paidToPlayers(results.flatMap((r) => r.claims))).toBe(970);
  });

  it('a period with no score yet does not swallow the carry', () => {
    const results = computePeriodPayouts(rolling([37]), { q1: FULL_GAME.q1 });
    expect(results).toHaveLength(1);
    expect(results[0].rolloverOut).toBe(198);
  });

  describe('the final square is unsold', () => {
    it('last_winner (the default): the money goes to the most recent player who won', () => {
      const claims = allClaims(rolling([48]), FULL_GAME);
      expect(claim(claims, 'final')).toMatchObject({ owner: ROLLOVER, amount: 0 });
      expect(claim(claims, 'final_rollover')).toMatchObject({ owner: 'P71', squareId: 71, amount: 396, sold: true, isRollover: false });
      expect(paidToPlayers(claims)).toBe(990);
    });

    it('last_winner skips back past unsold periods', () => {
      const claims = allClaims(rolling([48, 71]), FULL_GAME);
      // q3 (196) rolled into the final (392): 588 unclaimed, to the halftime winner.
      expect(claim(claims, 'final_rollover')).toMatchObject({ owner: 'P4', amount: 588 });
      expect(paidToPlayers(claims)).toBe(980);
    });

    it('last_winner with reverse on: a sold reverse square in the final is the last winner', () => {
      const p = rolling([48], { ruleVariations: { quarterlyRollover: true, reverseWinners: true } });
      const claims = allClaims(p, FULL_GAME);
      // Final 28–24: square 48 unsold, reverse square 84 sold.
      expect(claim(claims, 'final_reverse')).toMatchObject({ owner: 'P84', amount: 198 });
      expect(claim(claims, 'final_rollover')).toMatchObject({ owner: 'P84', amount: 198 });
    });

    it('nobody won anything: the money is recorded unsold, not invented a winner', () => {
      const claims = allClaims(rolling([37, 4, 71, 48]), FULL_GAME);
      expect(claim(claims, 'final_rollover')).toMatchObject({ owner: UNSOLD, sold: false, amount: 960 });
      expect(paidToPlayers(claims)).toBe(0);
    });

    it('random: the money waits for the draw', () => {
      const p = rolling([48], { ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' } });
      const claims = allClaims(p, FULL_GAME);
      expect(claim(claims, 'final_rollover')).toMatchObject({ owner: ROLLOVER, sold: false, isRollover: true, amount: 396 });
    });

    it('random: once drawn, the drawn player holds it — and a later recompute keeps them', () => {
      const p = rolling([48], { ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' } });
      const claims = allClaims(p, FULL_GAME, { final_rollover: { squareId: 12, owner: 'P12', drawn: true } });
      expect(claim(claims, 'final_rollover')).toMatchObject({ owner: 'P12', squareId: 12, sold: true, amount: 396 });
    });

    it('a draw that has been made STANDS when the rule is switched to "last winner" afterwards', () => {
      // qodo, PR #759 round 3: the rule decides who gets a prize that has not
      // been awarded. Once a draw has awarded it there is nothing left to decide.
      const p = rolling([48], { ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'last_winner' } });
      const claims = allClaims(p, FULL_GAME, { final_rollover: { squareId: 12, owner: 'P12', drawn: true } });
      expect(claim(claims, 'final_rollover')).toMatchObject({ owner: 'P12', squareId: 12, sold: true, amount: 396 });
      // The counter-example: with no draw on record, the same pool pays the last winner.
      expect(claim(allClaims(p, FULL_GAME), 'final_rollover')).toMatchObject({ owner: 'P71' });
    });

    it('…and when the rule is left unset', () => {
      const p = rolling([48], { ruleVariations: { quarterlyRollover: true } });
      const claims = allClaims(p, FULL_GAME, { final_rollover: { squareId: 12, owner: 'P12', drawn: true } });
      expect(claim(claims, 'final_rollover').owner).toBe('P12');
    });

    it('a "draw" that names nobody is not a draw', () => {
      const p = rolling([48], { ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'last_winner' } });
      for (const owner of [null, 'Rollover', 'Unsold', '']) {
        const claims = allClaims(p, FULL_GAME, { final_rollover: { squareId: 12, owner, drawn: true } });
        expect(claim(claims, 'final_rollover').owner, String(owner)).toBe('P71');
      }
    });

    it('random: a recorded final_rollover that was NOT a draw is not treated as one', () => {
      const p = rolling([48], { ruleVariations: { quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' } });
      const claims = allClaims(p, FULL_GAME, { final_rollover: { squareId: 71, owner: 'P71' } });
      expect(claim(claims, 'final_rollover').owner).toBe(ROLLOVER);
    });

    it('no final_rollover claim when the final square is sold', () => {
      expect(allClaims(rolling([37]), FULL_GAME).some((c) => c.docId === 'final_rollover')).toBe(false);
    });
  });
});

describe('D12 — a recorded winner is not re-decided by later changes to the grid', () => {
  it('a name put on the winning square AFTER the fact does not win', () => {
    // On record: q1 went unsold on square 37. Square 37 has since been sold.
    const claims = allClaims(pool(), { q1: FULL_GAME.q1 }, { q1: { squareId: 37, owner: UNSOLD } });
    expect(claim(claims, 'q1')).toMatchObject({ owner: UNSOLD, sold: false });
  });

  it('releasing the winning square afterwards does not take the prize away', () => {
    const claims = allClaims(pool({}, [37]), { q1: FULL_GAME.q1 }, { q1: { squareId: 37, owner: 'Alice' } });
    expect(claim(claims, 'q1')).toMatchObject({ owner: 'Alice', sold: true });
  });

  it('a recorded rollover stays a rollover', () => {
    const p = pool({ ruleVariations: { quarterlyRollover: true } });
    const results = computePeriodPayouts(p, { q1: FULL_GAME.q1 }, { q1: { squareId: 37, owner: ROLLOVER } });
    expect(results[0].rolloverOut).toBe(200);
  });

  it('a corrected score that moves the win to another square uses the grid as it stands', () => {
    // On record for square 37; the score is corrected to 8–3 → square 38.
    const claims = allClaims(pool(), { q1: { home: 8, away: 3 } }, { q1: { squareId: 37, owner: 'Alice' } });
    expect(claim(claims, 'q1')).toMatchObject({ squareId: 38, owner: 'P38' });
  });

  it('the pot still counts every square sold today', () => {
    const claims = allClaims(pool(), { q1: FULL_GAME.q1 }, { q1: { squareId: 37, owner: 'Alice' } });
    expect(claim(claims, 'q1').amount).toBe(200);
  });
});

describe('Every Score Pays', () => {
  const esp = (rules: NonNullable<PayoutPool['ruleVariations']> = {}, unsold: number[] = [], over: Partial<PayoutPool> = {}) =>
    pool({ ...over, ruleVariations: { scoreChangePayout: true, ...rules } }, unsold);

  describe('what the periods pay', () => {
    it('equal split: no period is paid — it all goes to scoring events', () => {
      const p = esp({ scoreChangePayoutStrategy: 'equal_split' });
      expect(computePeriodPayouts(p, FULL_GAME)).toEqual([]);
      for (const period of ['q1', 'half', 'q3', 'final'] as const) expect(periodPercent(p, period)).toBe(0);
    });

    it('hybrid: only halftime and final, by the weights', () => {
      const p = esp({ scoreChangePayoutStrategy: 'hybrid', scoreChangeHybridWeights: { final: 50, halftime: 10 } });
      expect(allClaims(p, FULL_GAME).map((c) => [c.docId, c.amount])).toEqual([['half', 100], ['final', 500]]);
    });

    it('an UNSET strategy is hybrid with 20 / 40 — the same answer everywhere', () => {
      const p = esp();
      expect(allClaims(p, FULL_GAME).map((c) => [c.docId, c.amount])).toEqual([['half', 200], ['final', 400]]);
      // …and the events get exactly what is left, not the whole pot on top.
      expect(computeEventPayouts(p, [{ docId: 'event_7_0', owner: 'A', home: 7, away: 0 }]).pot).toBe(400);
    });

    it('weights that are missing or zero fall back to 20 / 40', () => {
      expect(hybridWeights(esp({ scoreChangeHybridWeights: { final: 0, halftime: 0 } }))).toEqual({ final: 40, halftime: 20, events: 40 });
      expect(hybridWeights(esp({ scoreChangeHybridWeights: null }))).toEqual({ final: 40, halftime: 20, events: 40 });
    });

    it('weights can never add up to more than the pot', () => {
      const w = hybridWeights(esp({ scoreChangeHybridWeights: { final: 70, halftime: 60 } }));
      expect(w).toEqual({ final: 70, halftime: 30, events: 0 });
      expect(w.final + w.halftime + w.events).toBe(100);
    });

    it('hybrid takes charity off first too', () => {
      const p = esp({ scoreChangePayoutStrategy: 'hybrid' }, [], { charity: { enabled: true, percentage: 10 } });
      expect(allClaims(p, FULL_GAME).map((c) => c.amount)).toEqual([180, 360]);
      expect(computeEventPayouts(p, [{ docId: 'event_7_0', owner: 'A', home: 7, away: 0 }]).pot).toBe(360);
    });

    it('a pool that is not Every-Score-Pays has no event pot', () => {
      expect(computeEventPayouts(pool(), [{ docId: 'event_7_0', owner: 'A', home: 7, away: 0 }])).toEqual({ pot: 0, amounts: {}, unclaimed: 0 });
    });
  });

  describe('M4 — what each scoring event is paid', () => {
    const events = [
      { docId: 'event_7_0', owner: 'A', home: 7, away: 0 },
      { docId: 'event_7_3', owner: UNSOLD, home: 7, away: 3 },
      { docId: 'event_14_3', owner: 'B', home: 14, away: 3 },
      { docId: 'event_14_10', owner: 'C', home: 14, away: 10 },
    ];
    const equal = (handling?: 'rollover_next' | 'house' | 'split_winners') =>
      esp({ scoreChangePayoutStrategy: 'equal_split', ...(handling ? { scoreChangeHandleUnsold: handling } : {}) });

    it('every event sold: equal shares of the whole pot', () => {
      const sold = events.map((e) => ({ ...e, owner: e.owner === UNSOLD ? 'D' : e.owner }));
      expect(computeEventPayouts(equal(), sold).amounts).toEqual({ event_7_0: 250, event_7_3: 250, event_14_3: 250, event_14_10: 250 });
    });

    it('rollover_next (the default): an unsold share goes to the NEXT event a player won', () => {
      const r = computeEventPayouts(equal(), events);
      expect(r.amounts).toEqual({ event_7_0: 250, event_7_3: 0, event_14_3: 500, event_14_10: 250 });
      expect(r.unclaimed).toBe(0);
    });

    it('rollover_next: an unsold LAST event goes back to the last player who won', () => {
      const tail = [...events.slice(0, 3), { docId: 'event_14_10', owner: UNSOLD, home: 14, away: 10 }];
      expect(computeEventPayouts(equal('rollover_next'), tail).amounts).toEqual({ event_7_0: 250, event_7_3: 0, event_14_3: 750, event_14_10: 0 });
    });

    it('split_winners: the pot is divided between the sold events only', () => {
      const r = computeEventPayouts(equal('split_winners'), events);
      expect(r.amounts.event_7_3).toBe(0);
      expect([r.amounts.event_7_0, r.amounts.event_14_3, r.amounts.event_14_10]).toEqual([333.34, 333.33, 333.33]);
      expect(r.unclaimed).toBe(0);
    });

    it('house: the unsold share stays where it is and is reported unclaimed', () => {
      const r = computeEventPayouts(equal('house'), events);
      expect(r.amounts).toEqual({ event_7_0: 250, event_7_3: 250, event_14_3: 250, event_14_10: 250 });
      expect(r.unclaimed).toBe(250);
    });

    it('nobody won any event: every share is unclaimed whatever the rule', () => {
      const none = events.map((e) => ({ ...e, owner: UNSOLD }));
      for (const h of ['rollover_next', 'split_winners', 'house'] as const) {
        expect(computeEventPayouts(equal(h), none).unclaimed).toBe(1000);
      }
    });

    it('orders events by the game, not by document id — and a reverse claim after its regular', () => {
      const shuffled = [
        { docId: 'event_14_3', owner: 'B', home: 14, away: 3 },
        { docId: 'event_rev_7_0', owner: 'R', home: 7, away: 0, isReverse: true },
        { docId: 'event_7_0', owner: UNSOLD, home: 7, away: 0 },
      ];
      // 7–0 unsold rolls to its own reverse claim (next in game order), not to 14–3.
      expect(computeEventPayouts(equal(), shuffled).amounts).toEqual({ event_7_0: 0, event_rev_7_0: 666.67, event_14_3: 333.33 });
    });

    it('never creates or loses a cent', () => {
      for (const n of [1, 2, 3, 6, 7, 9, 11, 13]) {
        const many = Array.from({ length: n }, (_, i) => ({ docId: `event_${i * 3}_0`, owner: 'X', home: i * 3, away: 0 }));
        const total = Object.values(computeEventPayouts(equal(), many).amounts).reduce((a, b) => a + b, 0);
        expect(Math.round(total * 100)).toBe(100000);
      }
    });

    it('no events → nothing to pay', () => {
      expect(computeEventPayouts(equal(), [])).toEqual({ pot: 0, amounts: {}, unclaimed: 0 });
    });
  });
});

describe('splitCents', () => {
  it('divides to the cent and gives the odd cents to the earliest shares', () => {
    expect(splitCents(100, 3)).toEqual([33.34, 33.33, 33.33]);
    expect(splitCents(0.05, 2)).toEqual([0.03, 0.02]);
    expect(splitCents(10, 4)).toEqual([2.5, 2.5, 2.5, 2.5]);
  });

  it('has nothing to give to nobody', () => {
    expect(splitCents(100, 0)).toEqual([]);
  });
});

describe('which pools these rules apply to', () => {
  const before = SQUARES_RULES_SINCE_MS - 1;
  const after = SQUARES_RULES_SINCE_MS;

  it('the line is 2026-11-10T00:00:00Z', () => {
    expect(new Date(SQUARES_RULES_SINCE_MS).toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });

  it('a pool created on or after it follows the current rules; one created before it does not', () => {
    expect(usesCurrentWinnerRules({ createdAt: after })).toBe(true);
    expect(usesCurrentWinnerRules({ createdAt: before })).toBe(false);
  });

  it('reads the creation time in every shape a pool document carries it', () => {
    const at = Date.UTC(2026, 10, 20);
    expect(storedTimeMs(at)).toBe(at);
    expect(storedTimeMs(new Date(at))).toBe(at);
    expect(storedTimeMs(new Date(at).toISOString())).toBe(at);
    expect(storedTimeMs({ toMillis: () => at })).toBe(at);                 // Firestore Timestamp
    expect(storedTimeMs({ seconds: at / 1000, nanoseconds: 0 })).toBe(at); // …as plain JSON
    expect(storedTimeMs({ _seconds: at / 1000, _nanoseconds: 0 })).toBe(at);
  });

  it('a pool with no readable creation time is OLD — a record left alone is recoverable, one rewritten is not', () => {
    for (const createdAt of [undefined, null, '', 'not a date', {}, { seconds: 'x' }, NaN]) {
      expect(usesCurrentWinnerRules({ createdAt })).toBe(false);
    }
    expect(usesCurrentWinnerRules(undefined)).toBe(false);
    expect(usesCurrentWinnerRules(null)).toBe(false);
  });
});
