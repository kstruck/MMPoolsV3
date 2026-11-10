import { describe, it, expect } from 'vitest';
import {
  SQUARES_DEFAULT_PAYOUTS,
  SQUARES_RULES_WHEN_ABSENT,
  isFeedLogoUrl,
  squaresCharity,
  squaresCreateDefaults,
  squaresGameLink,
  squaresRules,
  validSquaresPayouts,
  withSquaresDefaults,
  SQUARES_LOCK_LEAD_MS,
  squaresPicksCloseMs,
} from '../shared/squaresDefaults';
import { computePeriodPayouts, periodBase, squaresPot } from '../shared/squaresPayouts';
import { effectiveSquareCap } from '../shared/squaresClaim';
import { squaresCreateInputSchema } from '../shared/schemas/squares';

/**
 * `shared/squaresDefaults.ts` (PLAN-SQUARES-REOPEN C0).
 *
 * The file exists because a squares pool created by the wizard had no
 * `ruleVariations`, and its own page read `pool.ruleVariations.quarterlyRollover`
 * with no guard. Two things are proved here:
 *
 *   1. A document missing ANY piece comes back safe to dereference.
 *   2. A filled-in hole reads the way the SERVER treats a missing value — the
 *      payout engine and the claim path are run on both the raw and the
 *      defaulted document and must agree. A default that looked nicer than what
 *      the scorer does would show members a prize nobody will be paid.
 */

const KICKOFF = Date.UTC(2026, 10, 26, 17, 30); // Thanksgiving 2026, 12:30 ET

describe('withSquaresDefaults — a document with holes still renders', () => {
  it('fills every nested object the pages dereference', () => {
    const pool = withSquaresDefaults({ id: 'p', name: 'Bare' });
    // The exact reads that threw: PoolRoute / AdminPanel, with no guard.
    expect(pool.ruleVariations.quarterlyRollover).toBe(false);
    expect(pool.ruleVariations.reverseWinners).toBe(false);
    expect(pool.ruleVariations.scoreChangePayout).toBe(false);
    expect(pool.ruleVariations.unclaimedFinalPrizeStrategy).toBe('last_winner');
    expect(pool.payouts.q1).toBe(0);
    expect(pool.charity.enabled).toBe(false);
    expect(pool.charity.percentage).toBe(0);
    expect(pool.scores.q1).toBeNull();
    expect(pool.scores.gameStatus).toBe('pre');
    expect(pool.squares).toHaveLength(100);
    expect(pool.squares.filter((s) => s.owner).length).toBe(0);
    expect(pool.scoreEvents).toEqual([]);
    expect(pool.numberSets).toBe(1);
    expect(pool.costPerSquare).toBe(0);
    expect(pool.maxSquaresPerPlayer).toBe(0);
    expect(pool.homeTeam).toBe('');
    expect(pool.awayTeam).toBe('');
  });

  it('survives every wrong shape a field can arrive in', () => {
    for (const junk of [null, undefined, 'x', 7, [], true]) {
      const pool = withSquaresDefaults({
        ruleVariations: junk, payouts: junk, charity: junk, scores: junk, squares: junk, scoreEvents: junk,
        numberSets: junk, costPerSquare: junk, maxSquaresPerPlayer: junk, homeTeam: junk, awayTeam: junk,
      } as Record<string, unknown>);
      expect(pool.ruleVariations.quarterlyRollover, String(junk)).toBe(false);
      expect(pool.payouts).toEqual({ q1: 0, half: 0, q3: 0, final: 0 });
      expect(pool.charity).toMatchObject({ enabled: false, percentage: 0, name: '' });
      expect(pool.squares).toHaveLength(100);
      expect(pool.scoreEvents).toEqual([]);
      expect(pool.numberSets).toBe(1);
      // A number IS the right shape for a price, and a string for a team name.
      expect(pool.costPerSquare).toBe(typeof junk === 'number' ? junk : 0);
      expect(pool.homeTeam).toBe(typeof junk === 'string' ? junk : '');
    }
  });

  it('never changes a value the document carries', () => {
    const squares = Array.from({ length: 100 }, (_, i) => ({ id: i, owner: i === 4 ? 'Alice' : null }));
    const stored = {
      id: 'p',
      ruleVariations: { quarterlyRollover: true, reverseWinners: true, unclaimedFinalPrizeStrategy: 'random', scoreChangePayout: true, scoreChangePayoutStrategy: 'hybrid' },
      payouts: { q1: 10, half: 20, q3: 10, final: 60 },
      charity: { enabled: true, name: 'Food bank', percentage: 15, url: 'https://example.org' },
      scores: { current: { home: 7, away: 3 }, q1: { home: 7, away: 3 }, half: null, q3: null, final: null, gameStatus: 'in', startTime: 'x' },
      squares,
      scoreEvents: [{ id: 'e1' }],
      numberSets: 4,
      costPerSquare: 25,
      maxSquaresPerPlayer: 5,
      homeTeam: 'Lions',
      awayTeam: 'Packers',
      isLocked: true,
    };
    const pool = withSquaresDefaults(stored);
    expect(pool.ruleVariations).toMatchObject(stored.ruleVariations);
    expect(pool.payouts).toEqual(stored.payouts);
    expect(pool.charity).toMatchObject(stored.charity);
    expect(pool.scores).toMatchObject(stored.scores);
    expect(pool.scoreEvents).toEqual(stored.scoreEvents);
    expect(pool.numberSets).toBe(4);
    expect(pool.costPerSquare).toBe(25);
    expect(pool.maxSquaresPerPlayer).toBe(5);
    expect(pool.homeTeam).toBe('Lions');
    expect(pool.isLocked).toBe(true);
    // Unknown rule keys ride along — Every-Score-Pays keeps its strategy.
    expect(pool.ruleVariations.scoreChangePayoutStrategy).toBe('hybrid');
  });

  it('hands back the SAME squares array when the grid is intact', () => {
    // The grid component keys effects and memos on the array's identity; a
    // fresh copy on every render would re-run all of them.
    const squares = Array.from({ length: 100 }, (_, i) => ({ id: i, owner: null }));
    expect(withSquaresDefaults({ squares }).squares).toBe(squares);
  });

  it('repairs a short or holed grid without dropping the squares that are there', () => {
    const short = [{ id: 0, owner: 'Alice' }, null, { id: 2, owner: 'Bob' }] as unknown[];
    const { squares } = withSquaresDefaults({ squares: short });
    expect(squares).toHaveLength(100);
    expect(squares[0]).toMatchObject({ id: 0, owner: 'Alice' });
    expect(squares[1]).toMatchObject({ id: 1, owner: null });
    expect(squares[2]).toMatchObject({ id: 2, owner: 'Bob' });
    expect(squares[99]).toMatchObject({ id: 99, owner: null });
  });
});

/**
 * THE RULE THE FILE'S HEADER STATES: a default is what the server enforces for
 * a missing value. Proved by running the scorer and the claim path on a bare
 * document and on its defaulted twin — same answer, or the page lies.
 */
describe('a filled-in hole reads the way the server treats the hole', () => {
  const axis = { home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
  const sold = Array.from({ length: 100 }, (_, i) => ({ id: i, owner: i === 37 ? null : `P${i}` }));
  const bare = { costPerSquare: 10, squares: sold, axisNumbers: axis };
  const scores = { q1: { home: 7, away: 3 }, half: { home: 4, away: 0 } };

  it('the payout engine gives the same result for both', () => {
    const filled = withSquaresDefaults(bare);
    expect(computePeriodPayouts(filled, scores)).toEqual(computePeriodPayouts(bare, scores));
    expect(squaresPot(filled)).toEqual(squaresPot(bare));
    // And concretely: no percentages on the document means no prize — NOT 25%.
    expect(periodBase(filled, 'q1')).toBe(0);
    // ...and no rollover: the unsold first-quarter prize is not carried.
    const [q1] = computePeriodPayouts({ ...filled, payouts: { q1: 25, half: 25, q3: 25, final: 25 } }, scores);
    expect(q1.claims[0]).toMatchObject({ owner: 'Unsold', isRollover: false });
  });

  it('the square limit is no limit for both', () => {
    expect(effectiveSquareCap(withSquaresDefaults({}).maxSquaresPerPlayer)).toBe(effectiveSquareCap(undefined));
    expect(effectiveSquareCap(withSquaresDefaults({}).maxSquaresPerPlayer)).toBeNull();
  });

  it('the absent-rules constant is every rule off', () => {
    expect({ ...SQUARES_RULES_WHEN_ABSENT }).toEqual({
      reverseWinners: false, quarterlyRollover: false, scoreChangePayout: false, unclaimedFinalPrizeStrategy: 'last_winner',
    });
  });
});

describe('squaresRules / squaresCharity — only an explicit true turns a rule on', () => {
  it.each(['true', 1, 'yes', {}, [], null, undefined])('%s is not on', (v) => {
    expect(squaresRules({ quarterlyRollover: v, reverseWinners: v, scoreChangePayout: v })).toMatchObject({
      quarterlyRollover: false, reverseWinners: false, scoreChangePayout: false,
    });
    expect(squaresCharity({ enabled: v, percentage: 10 }).enabled).toBe(false);
  });

  it('true is on', () => {
    expect(squaresRules({ quarterlyRollover: true }).quarterlyRollover).toBe(true);
    expect(squaresRules({ reverseWinners: true }).reverseWinners).toBe(true);
    expect(squaresCharity({ enabled: true, percentage: 10 }).enabled).toBe(true);
  });

  it('the final-prize strategy is random only when it says random', () => {
    expect(squaresRules({ unclaimedFinalPrizeStrategy: 'random' }).unclaimedFinalPrizeStrategy).toBe('random');
    for (const v of ['RANDOM', 'last_winner', '', null, 7]) {
      expect(squaresRules({ unclaimedFinalPrizeStrategy: v }).unclaimedFinalPrizeStrategy).toBe('last_winner');
    }
  });

  it('a charity percentage is held to 0–100', () => {
    expect(squaresCharity({ enabled: true, percentage: 150 }).percentage).toBe(100);
    expect(squaresCharity({ enabled: true, percentage: -5 }).percentage).toBe(0);
    expect(squaresCharity({ enabled: true, percentage: 'abc' }).percentage).toBe(0);
    expect(squaresCharity({ enabled: true, percentage: 12.5 }).percentage).toBe(12.5);
  });
});

describe('validSquaresPayouts — a split is four percentages that total exactly 100', () => {
  it('accepts a real split', () => {
    expect(validSquaresPayouts({ q1: 25, half: 25, q3: 25, final: 25 })).toEqual({ q1: 25, half: 25, q3: 25, final: 25 });
    expect(validSquaresPayouts({ q1: 0, half: 0, q3: 0, final: 100 })).toEqual({ q1: 0, half: 0, q3: 0, final: 100 });
    expect(validSquaresPayouts({ q1: 12.5, half: 12.5, q3: 25, final: 50 })).not.toBeNull();
  });

  it.each([
    ['totals 99', { q1: 25, half: 25, q3: 25, final: 24 }],
    ['totals 101', { q1: 25, half: 25, q3: 25, final: 26 }],
    ['a negative share', { q1: -10, half: 60, q3: 25, final: 25 }],
    ['a share over 100', { q1: 110, half: -10, q3: 0, final: 0 }],
    ['a missing quarter', { q1: 50, half: 50, q3: 0 }],
    ['a string share', { q1: '25', half: 25, q3: 25, final: 25 }],
    ['NaN', { q1: NaN, half: 50, q3: 25, final: 25 }],
    ['all zero', { q1: 0, half: 0, q3: 0, final: 0 }],
    ['not an object', 'even'],
    ['null', null],
  ])('refuses %s', (_label, raw) => {
    expect(validSquaresPayouts(raw)).toBeNull();
  });

  it('agrees with the create contract on every one of those', () => {
    // Two validators for one rule is how they drift. Same inputs, same verdict.
    const base = { type: 'SQUARES' as const, name: 'Grid', costPerSquare: 5 };
    const cases: unknown[] = [
      { q1: 25, half: 25, q3: 25, final: 25 },
      { q1: 0, half: 0, q3: 0, final: 100 },
      { q1: 25, half: 25, q3: 25, final: 24 },
      { q1: 25, half: 25, q3: 25, final: 26 },
      { q1: -10, half: 60, q3: 25, final: 25 },
      { q1: 110, half: -10, q3: 0, final: 0 },
      { q1: 50, half: 50, q3: 0 },
      { q1: 0, half: 0, q3: 0, final: 0 },
    ];
    for (const squaresPayouts of cases) {
      expect(
        squaresCreateInputSchema.safeParse({ ...base, squaresPayouts }).success,
        JSON.stringify(squaresPayouts),
      ).toBe(validSquaresPayouts(squaresPayouts) !== null);
    }
  });
});

describe('squaresCreateDefaults — what a new pool is written with', () => {
  it('nothing sent: the even split, every rule off, charity off, an empty scoreboard', () => {
    const out = squaresCreateDefaults({});
    expect(out.payouts).toEqual({ ...SQUARES_DEFAULT_PAYOUTS });
    expect(out.payouts).not.toBe(SQUARES_DEFAULT_PAYOUTS); // a copy, not the frozen constant
    expect(out.ruleVariations).toMatchObject({ reverseWinners: false, quarterlyRollover: false, scoreChangePayout: false });
    expect(out.charity).toMatchObject({ enabled: false, percentage: 0 });
    expect(out.scoreEvents).toEqual([]);
    expect(out.numberSets).toBe(1);
    expect(out.scores).toEqual({ current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' });
    expect(out.reminders).toBeUndefined();
  });

  it('the wizard\'s split and rules are kept', () => {
    const out = squaresCreateDefaults({
      requestedPayouts: { q1: 10, half: 20, q3: 10, final: 60 },
      ruleVariations: { reverseWinners: true, quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' },
      charity: { enabled: true, name: 'Food bank', percentage: 10 },
      numberSets: 4,
    });
    expect(out.payouts).toEqual({ q1: 10, half: 20, q3: 10, final: 60 });
    expect(out.ruleVariations).toMatchObject({ reverseWinners: true, quarterlyRollover: true, unclaimedFinalPrizeStrategy: 'random' });
    expect(out.charity).toMatchObject({ enabled: true, name: 'Food bank', percentage: 10 });
    expect(out.numberSets).toBe(4);
  });

  it('a split that is not one falls back to the even split — never a pool paying 0% or 120%', () => {
    for (const bad of [{ q1: 0, half: 0, q3: 0, final: 0 }, { q1: 50, half: 50, q3: 50, final: 50 }, 'x', null]) {
      expect(squaresCreateDefaults({ requestedPayouts: bad }).payouts).toEqual({ q1: 25, half: 25, q3: 25, final: 25 });
    }
  });

  it('numberSets is 4 or it is 1', () => {
    expect(squaresCreateDefaults({ numberSets: '4' }).numberSets).toBe(4);
    for (const v of [1, 2, 3, 0, 'x', null, undefined]) expect(squaresCreateDefaults({ numberSets: v }).numberSets).toBe(1);
  });

  it('a linked game sets the grid to lock at kickoff and gives the score sync a start time', () => {
    const out = squaresCreateDefaults({ gameId: '401772510', gameTime: KICKOFF });
    expect(out.reminders).toEqual({ lock: { scheduleMinutes: [], enabled: true, lockAt: KICKOFF } });
    expect(out.scores.startTime).toBe(new Date(KICKOFF).toISOString());
    expect(out.scores.gameStatus).toBe('pre');
  });

  it.each([
    ['no game id', { gameTime: KICKOFF }],
    ['an empty game id', { gameId: '  ', gameTime: KICKOFF }],
    ['a null game id', { gameId: null, gameTime: KICKOFF }],
    ['no kickoff', { gameId: '401' }],
    ['a zero kickoff', { gameId: '401', gameTime: 0 }],
    ['a string kickoff', { gameId: '401', gameTime: String(KICKOFF) }],
    ['a NaN kickoff', { gameId: '401', gameTime: NaN }],
  ])('%s is not a link: no lock is armed and no start time is written', (_label, input) => {
    const out = squaresCreateDefaults(input);
    expect(out.reminders).toBeUndefined();
    expect('startTime' in out.scores).toBe(false);
  });

  it('a linked game cannot be created with its lock switched off or moved', () => {
    // Whatever arrives in `reminders`, the kickoff lock is on and at kickoff.
    const out = squaresCreateDefaults({
      gameId: '401', gameTime: KICKOFF,
      reminders: { lock: { enabled: false, lockAt: KICKOFF + 86_400_000, scheduleMinutes: [60] }, payment: { enabled: true } },
    });
    expect(out.reminders).toEqual({
      payment: { enabled: true },
      lock: { scheduleMinutes: [60], enabled: true, lockAt: KICKOFF },
    });
  });
});

describe('isFeedLogoUrl — a team badge is an https image on the feed\'s CDN, and nothing else', () => {
  it.each([
    'https://a.espncdn.com/i/teamlogos/nfl/500/det.png',
    'https://a.espncdn.com/i/teamlogos/ncaa/500/2.png',
    'https://a1.espncdn.com/combiner/i%2Fteamlogos/x.png',
  ])('accepts %s', (url) => {
    expect(isFeedLogoUrl(url)).toBe(true);
  });

  it.each([
    'http://a.espncdn.com/i/teamlogos/nfl/500/det.png',
    'https://evil.example/pixel.gif',
    'https://espncdn.com.evil.example/x.png',
    'https://a.espncdn.com.evil.example/x.png',
    'https://evil.example/?u=https://a.espncdn.com/x.png',
    'https://a.espncdn.com/x.png?redirect=https://evil.example',
    'https://a.espncdn.com/x.png#frag',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '//a.espncdn.com/x.png',
    'https://a.espncdn.com/',
    ' https://a.espncdn.com/x.png',
    `https://a.espncdn.com/${'x'.repeat(400)}.png`,
    '',
  ])('refuses %s', (url) => {
    expect(isFeedLogoUrl(url)).toBe(false);
  });

  it.each([null, undefined, 7, {}, []])('refuses a non-string (%s)', (v) => {
    expect(isFeedLogoUrl(v)).toBe(false);
  });

  it('the create contract refuses what it refuses', () => {
    const base = { type: 'SQUARES' as const, name: 'Grid', costPerSquare: 5 };
    expect(squaresCreateInputSchema.safeParse({ ...base, homeTeamLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' }).success).toBe(true);
    expect(squaresCreateInputSchema.safeParse({ ...base, homeTeamLogo: 'https://evil.example/pixel.gif' }).success).toBe(false);
    expect(squaresCreateInputSchema.safeParse({ ...base, awayTeamLogo: 'javascript:alert(1)' }).success).toBe(false);
  });
});

/**
 * Linking a game from the MANAGE page (PLAN-SQUARES-REOPEN C1). The page's own
 * version locked fifteen minutes before kickoff, left the lock's switch as it
 * found it, and — on a pool with no reminder settings — turned on payment
 * emails to every player as a side effect of choosing a game.
 */
describe('squaresGameLink — linking an existing pool to a game', () => {
  const game = {
    id: '401772510', kickoff: KICKOFF, homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers',
    homeLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png',
    awayLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png',
    seasonType: '2' as const, week: 12,
  };

  it('writes the game, the teams, the badges and the kickoff', () => {
    expect(squaresGameLink(game, 'nfl')).toMatchObject({
      gameId: '401772510', gameTime: KICKOFF, league: 'nfl',
      homeTeam: 'Detroit Lions', awayTeam: 'Green Bay Packers',
      homeTeamLogo: game.homeLogo, awayTeamLogo: game.awayLogo,
      seasonType: '2', week: 12,
    });
  });

  it('makes the SAME link the create wizard makes: locked at kickoff, start time for the score sync', () => {
    const created = squaresCreateDefaults({ gameId: game.id, gameTime: game.kickoff });
    const linked = squaresGameLink(game, 'nfl')!;
    expect(linked.reminders).toEqual(created.reminders);
    expect(linked.scores).toEqual(created.scores);
    // Stated outright as well, so the pair cannot both drift together.
    expect(linked.reminders).toEqual({ lock: { scheduleMinutes: [], enabled: true, lockAt: KICKOFF } });
    expect((linked.scores as Record<string, unknown>).startTime).toBe(new Date(KICKOFF).toISOString());
  });

  it('switches on NOTHING but the kickoff lock — no payment emails as a side effect', () => {
    const linked = squaresGameLink(game, 'nfl')!;
    expect(Object.keys(linked.reminders as object)).toEqual(['lock']);
  });

  it('leaves every other reminder setting exactly as it was', () => {
    const reminders = {
      payment: { enabled: false, graceMinutes: 30 },
      winner: { enabled: true, channels: ['email'] },
      lock: { enabled: false, lockAt: 1, scheduleMinutes: [60, 15] },
    };
    const linked = squaresGameLink(game, 'nfl', { reminders })!;
    expect(linked.reminders).toEqual({
      payment: { enabled: false, graceMinutes: 30 },
      winner: { enabled: true, channels: ['email'] },
      // The commissioner's "locking soon" emails are kept; the lock is on, at kickoff.
      lock: { enabled: true, lockAt: KICKOFF, scheduleMinutes: [60, 15] },
    });
    // ...and the input was not edited in place.
    expect(reminders.lock).toEqual({ enabled: false, lockAt: 1, scheduleMinutes: [60, 15] });
  });

  it('keeps scores that are already on the pool', () => {
    const scores = { current: { home: 3, away: 0 }, q1: { home: 3, away: 0 }, half: null, q3: null, final: null, gameStatus: 'in' };
    const linked = squaresGameLink(game, 'nfl', { scores })!;
    expect(linked.scores).toEqual({ ...scores, startTime: new Date(KICKOFF).toISOString() });
  });

  it('a college game is linked as college; anything else as nfl', () => {
    expect(squaresGameLink(game, 'college')!.league).toBe('college');
    expect(squaresGameLink(game, 'xfl' as never)!.league).toBe('nfl');
  });

  it('a badge that is not the feed\'s own is not written', () => {
    const linked = squaresGameLink({ ...game, homeLogo: 'https://evil.example/pixel.gif', awayLogo: undefined }, 'nfl')!;
    expect('homeTeamLogo' in linked).toBe(false);
    expect('awayTeamLogo' in linked).toBe(false);
  });

  it('a season type or week that is not one is not written', () => {
    const linked = squaresGameLink({ ...game, seasonType: '9' as never, week: 0 }, 'nfl')!;
    expect('seasonType' in linked).toBe(false);
    expect('week' in linked).toBe(false);
  });

  it.each([
    ['no id', { ...game, id: '' }],
    ['a blank id', { ...game, id: '   ' }],
    ['no kickoff', { ...game, kickoff: undefined as never }],
    ['a zero kickoff', { ...game, kickoff: 0 }],
    ['a NaN kickoff', { ...game, kickoff: NaN }],
  ])('%s is not a link at all', (_label, bad) => {
    expect(squaresGameLink(bad, 'nfl')).toBeNull();
  });
});

describe('squaresGameLink — a game id is the score feed\'s event id', () => {
  const kickoff = Date.UTC(2026, 10, 26, 18);
  it('digits are linked', () => {
    expect(squaresGameLink({ id: '401772510', kickoff, homeTeam: 'A', awayTeam: 'B' } as never, 'nfl')).not.toBeNull();
  });
  it('anything else is not — it would be put into the feed\'s URL', () => {
    for (const id of ['', '   ', 'abc', '401772510/../x', '401772510?x=1', '401 772', '4017725104017725100']) {
      expect(squaresGameLink({ id, kickoff, homeTeam: 'A', awayTeam: 'B' } as never, 'nfl'), id).toBeNull();
    }
  });
});

describe('squaresPicksCloseMs — the deadline a player is shown is one the grid keeps', () => {
  const KICKOFF = Date.UTC(2026, 10, 26, 17, 30);
  const locking = (lockAt: unknown, enabled: unknown = true) => ({ reminders: { lock: { enabled, lockAt } } });

  it('is the lock time less the lead — the earliest the lock job can shut the grid', () => {
    expect(SQUARES_LOCK_LEAD_MS).toBe(30_000);
    expect(squaresPicksCloseMs(locking(KICKOFF))).toBe(KICKOFF - 30_000);
  });

  // The job locks a grid once `lockAt - now <= lead`. So "now >= close" is
  // exactly "the job may lock it", and before that it cannot.
  it('matches the lock job: a grid cannot be locked before it, and can be from it on', () => {
    const close = squaresPicksCloseMs(locking(KICKOFF)) as number;
    const jobWouldLock = (now: number) => KICKOFF - now <= SQUARES_LOCK_LEAD_MS;
    expect(jobWouldLock(close - 1)).toBe(false);
    expect(jobWouldLock(close)).toBe(true);
    expect(jobWouldLock(KICKOFF)).toBe(true);
  });

  it('a pool the wizard links to a game closes that far ahead of ITS kickoff', () => {
    const created = squaresCreateDefaults({ gameId: '401772510', gameTime: KICKOFF });
    expect(squaresPicksCloseMs(created)).toBe(KICKOFF - SQUARES_LOCK_LEAD_MS);
  });

  it('reads every shape a stored lock time has had', () => {
    expect(squaresPicksCloseMs(locking({ toMillis: () => KICKOFF }))).toBe(KICKOFF - 30_000);
    expect(squaresPicksCloseMs(locking(new Date(KICKOFF)))).toBe(KICKOFF - 30_000);
    expect(squaresPicksCloseMs(locking(new Date(KICKOFF).toISOString()))).toBe(KICKOFF - 30_000);
  });

  it('is null when the grid will not lock itself — there is no deadline to show', () => {
    expect(squaresPicksCloseMs(locking(KICKOFF, false))).toBeNull();
    expect(squaresPicksCloseMs(locking(KICKOFF, 'true'))).toBeNull();
    expect(squaresPicksCloseMs(locking(undefined))).toBeNull();
    expect(squaresPicksCloseMs(locking(null))).toBeNull();
    expect(squaresPicksCloseMs(locking(''))).toBeNull();
    expect(squaresPicksCloseMs(locking(0))).toBeNull();
    expect(squaresPicksCloseMs(locking('not a date'))).toBeNull();
    expect(squaresPicksCloseMs(locking({ nope: 1 }))).toBeNull();
    expect(squaresPicksCloseMs({})).toBeNull();
    expect(squaresPicksCloseMs(null)).toBeNull();
  });
});

