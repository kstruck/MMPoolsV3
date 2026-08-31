import { describe, it, expect } from 'vitest';
import { favouredSide, planQuickPicks, type QuickPickStrategy } from './quickPicks';
import type { NFLGame } from '../../../types';

/**
 * Quick Picks is one press that writes up to sixteen picks, so the two ways it
 * can be wrong are both expensive: filling a game it should have skipped (a
 * guessed pick on a game with no line) and overwriting a pick the member
 * already made. Both are pinned here.
 */

const game = (id: string, away: string, home: string, spread?: number | null): NFLGame => ({
  id,
  week: 1,
  season: 2026,
  seasonType: 1,
  startTime: 1_000_000,
  status: 'SCHEDULED',
  homeTeam: { abbreviation: home, name: home, logoUrl: '' },
  awayTeam: { abbreviation: away, name: away, logoUrl: '' },
  ...(spread === undefined ? {} : { spread: { value: spread as number, locked: false } }),
} as unknown as NFLGame);

const always = () => true;

describe('favouredSide — the stored line is home-relative', () => {
  it('negative favours the HOME team', () => {
    expect(favouredSide(game('g', 'CAR', 'ARI', -6.5))).toBe('home');
  });

  it('positive favours the AWAY team', () => {
    expect(favouredSide(game('g', 'CAR', 'ARI', 3))).toBe('away');
  });

  it('a pick-em line (0) names no favourite', () => {
    // Not "home by default" — 0 means the book calls it even, and inventing a
    // side there is exactly the guess this module exists to refuse.
    expect(favouredSide(game('g', 'CAR', 'ARI', 0))).toBeNull();
  });

  it('no spread at all names no favourite', () => {
    expect(favouredSide(game('g', 'CAR', 'ARI'))).toBeNull();
  });

  it('a non-numeric or non-finite stored value names no favourite', () => {
    expect(favouredSide(game('g', 'CAR', 'ARI', NaN))).toBeNull();
    expect(favouredSide({ ...game('g', 'CAR', 'ARI'), spread: { value: '-3' } } as unknown as NFLGame)).toBeNull();
  });
});

describe('planQuickPicks — spread strategies skip rather than guess', () => {
  // The live shape this was written for: preseason weeks 3-4 carry ZERO lines
  // across 32 games, so "some games have no line" is the normal case here.
  const slate = [
    game('a', 'CAR', 'ARI', -6.5),  // ARI favoured
    game('b', 'KC', 'BUF', 3),      // KC favoured
    game('c', 'GB', 'CHI'),         // no line
  ];

  it('FAVORITES takes the favoured side and reports the unpriced game', () => {
    const plan = planQuickPicks(slate, 'FAVORITES', {}, always);
    expect(plan.picks).toEqual({ a: 'ARI', b: 'KC' });
    expect(plan.pickCount).toBe(2);
    expect(plan.skipCount).toBe(1);
  });

  it('UNDERDOGS takes the other side of the same two games', () => {
    const plan = planQuickPicks(slate, 'UNDERDOGS', {}, always);
    expect(plan.picks).toEqual({ a: 'CAR', b: 'BUF' });
    expect(plan.skipCount).toBe(1);
  });

  it('HOME and AWAY never skip — they need no line', () => {
    expect(planQuickPicks(slate, 'HOME', {}, always)).toMatchObject({
      picks: { a: 'ARI', b: 'BUF', c: 'CHI' },
      skipCount: 0,
    });
    expect(planQuickPicks(slate, 'AWAY', {}, always)).toMatchObject({
      picks: { a: 'CAR', b: 'KC', c: 'GB' },
      skipCount: 0,
    });
  });

  it('a whole week with no lines fills nothing and says so', () => {
    const unpriced = [game('a', 'CAR', 'ARI'), game('b', 'KC', 'BUF')];
    const plan = planQuickPicks(unpriced, 'FAVORITES', {}, always);
    expect(plan.pickCount).toBe(0);
    expect(plan.skipCount).toBe(2);
  });
});

describe('planQuickPicks — it never destroys work', () => {
  const slate = [game('a', 'CAR', 'ARI', -6.5), game('b', 'KC', 'BUF', 3)];

  it.each<QuickPickStrategy>(['FAVORITES', 'UNDERDOGS', 'HOME', 'AWAY'])(
    '%s leaves an already-picked game alone',
    strategy => {
      const plan = planQuickPicks(slate, strategy, { a: 'CAR' }, always);
      expect(plan.picks).not.toHaveProperty('a');
      expect(Object.keys(plan.picks)).toEqual(['b']);
    },
  );

  it('an existing pick on an unpriced game is not counted as skipped', () => {
    // It was not skipped for want of a line — it was already answered. Counting
    // it would print "1 game has no line" beside a game the member has picked.
    const plan = planQuickPicks([game('c', 'GB', 'CHI')], 'FAVORITES', { c: 'GB' }, always);
    expect(plan.skipCount).toBe(0);
    expect(plan.pickCount).toBe(0);
  });

  it('a locked game is left alone even when empty', () => {
    // The sheet owns the lock predicate; this proves the plan honours it rather
    // than filling a pick the server would refuse.
    const plan = planQuickPicks(slate, 'HOME', {}, g => g.id !== 'a');
    expect(plan.picks).toEqual({ b: 'BUF' });
  });

  it('a game with no team abbreviation is dropped without inflating skipCount', () => {
    // skipCount is the member-facing "no line yet" number. A malformed game
    // document is a different fact and must not be reported as a missing line.
    const broken = { ...game('x', 'CAR', 'ARI', -3), homeTeam: { name: 'Cardinals' } } as unknown as NFLGame;
    const plan = planQuickPicks([broken], 'FAVORITES', {}, always);
    expect(plan.pickCount).toBe(0);
    expect(plan.skipCount).toBe(0);
  });
});
