/**
 * The reveal boundary a commissioner's pick reads are gated on
 * (PLAN-COMMISSIONER-BLIND-PICKS D3/T2).
 *
 * The case that matters most is the MIXED-LOCKED pick'em week: one game kicked
 * off, the rest not. A week-granular answer there hands back the whole sheet and
 * reopens the exact leak the plan exists to close, so it gets its own test rather
 * than riding on the per-game one.
 */
import { describe, it, expect } from 'vitest';
import { revealMode, weekRevealFor, fullReveal, weekPickCount } from '../lib/pickReveal';

const MIN = 60_000;
const KICK = 1_800_000_000_000;

const games = [
  { id: 'g1', startTime: KICK },
  { id: 'g2', startTime: KICK + 3 * 60 * MIN },
  { id: 'g3', startTime: KICK + 48 * 60 * MIN },
];

describe('revealMode', () => {
  it('is WEEK for the hard-weekly-lock types', () => {
    expect(revealMode({ type: 'NFL_SURVIVOR' })).toBe('WEEK');
    expect(revealMode({ type: 'NFL_MARGIN' })).toBe('WEEK');
  });

  it('is PER_GAME for pick\'em by default, WEEK when the pool opted in', () => {
    expect(revealMode({ type: 'NFL_PICKEM' })).toBe('PER_GAME');
    expect(revealMode({ type: 'NFL_PICKEM', settings: { lockMode: 'WEEKLY' } })).toBe('WEEK');
    expect(revealMode({ type: 'NFL_PICKEM', settings: { lockMode: 'PER_GAME' } })).toBe('PER_GAME');
  });

  it('cannot be downgraded on a hard-lock pool by a settings write', () => {
    // The whole point of deriving it from the TYPE: a Survivor pool whose
    // settings claim PER_GAME still reveals wholesale at the weekly deadline.
    expect(revealMode({ type: 'NFL_SURVIVOR', settings: { lockMode: 'PER_GAME' } })).toBe('WEEK');
  });
});

describe('weekRevealFor — PER_GAME pick\'em (Kevin\'s Q1 ruling: per game)', () => {
  const pool = { type: 'NFL_PICKEM', settings: { lockMode: 'PER_GAME' } };

  it('reveals nothing before the first lock', () => {
    const r = weekRevealFor(pool, 1, games, KICK - 10 * MIN);
    expect(r.revealedGameIds).toEqual([]);
    expect(r.weekRevealed).toBe(false);
  });

  /**
   * ⚠️ THE LEAK TEST. One game has locked; the other two have not. If this ever
   * returns three ids, a commissioner reads picks for games that have not kicked
   * off — which is the thing this whole plan removes.
   */
  it('a mixed-locked week reveals ONLY the locked game', () => {
    const r = weekRevealFor(pool, 1, games, KICK - MIN);
    expect(r.revealedGameIds).toEqual(['g1']);
    expect(r.weekRevealed).toBe(false);
  });

  it('reveals the whole week only once every game has locked', () => {
    const r = weekRevealFor(pool, 1, games, KICK + 48 * 60 * MIN);
    expect(r.revealedGameIds).toEqual(['g1', 'g2', 'g3']);
    expect(r.weekRevealed).toBe(true);
  });

  it('honours the lock buffer — the boundary is the members\' own deadline', () => {
    const wide = { type: 'NFL_PICKEM', settings: { lockMode: 'PER_GAME', lockBufferMinutes: 60 } };
    expect(weekRevealFor(wide, 1, games, KICK - 30 * MIN).revealedGameIds).toEqual(['g1']);
    expect(weekRevealFor(pool, 1, games, KICK - 30 * MIN).revealedGameIds).toEqual([]);
  });
});

describe('weekRevealFor — WEEK mode (Survivor / Margin / WEEKLY pick\'em)', () => {
  const survivor = { type: 'NFL_SURVIVOR' };

  it('reveals nothing before the weekly deadline, even with games under way', () => {
    // g1 kicked off an hour ago and g3 has not; a per-game reading would leak.
    const r = weekRevealFor(survivor, 1, games, KICK - 10 * MIN);
    expect(r.revealedGameIds).toEqual([]);
    expect(r.weekRevealed).toBe(false);
  });

  it('reveals the whole week at the weekly deadline', () => {
    const r = weekRevealFor(survivor, 1, games, KICK);
    expect(r.weekRevealed).toBe(true);
    expect(r.revealedGameIds).toEqual(['g1', 'g2', 'g3']);
    expect(r.weekRevealAt).toBe(KICK - 5 * MIN);
  });

  it('uses the FROZEN deadline, so widening the buffer cannot move the reveal later', () => {
    // hardLockByWeek was frozen at the original deadline; a 60-minute buffer
    // would otherwise compute a deadline 55 minutes earlier... and the freeze
    // resolves to the EARLIEST of the two either way.
    const frozen = { type: 'NFL_SURVIVOR', settings: { lockBufferMinutes: 5 }, hardLockByWeek: { 1: KICK - 60 * MIN } };
    const r = weekRevealFor(frozen, 1, games, KICK - 30 * MIN);
    expect(r.weekRevealAt).toBe(KICK - 60 * MIN);
    expect(r.weekRevealed).toBe(true);
  });
});

describe('weekRevealFor — no games', () => {
  it('reveals nothing: with no kickoff there is no deadline to have passed', () => {
    for (const pool of [{ type: 'NFL_PICKEM' }, { type: 'NFL_SURVIVOR' }]) {
      const r = weekRevealFor(pool, 1, [], Number.MAX_SAFE_INTEGER);
      expect(r.revealedGameIds).toEqual([]);
      expect(r.weekRevealed).toBe(false);
    }
  });
});

describe('fullReveal — SUPER_ADMIN', () => {
  it('returns every game whatever the clock says', () => {
    const r = fullReveal({ type: 'NFL_PICKEM' }, games);
    expect(r.revealedGameIds).toEqual(['g1', 'g2', 'g3']);
    expect(r.weekRevealed).toBe(true);
  });
});

describe('weekPickCount', () => {
  it('pick\'em counts THIS week\'s games only', () => {
    // A pick'em entry keys picks by gameId across the whole season, so counting
    // the map would report every pick ever made as this week's.
    const picks = { g1: 'KC', g2: 'BUF', gOtherWeek: 'SF' };
    expect(weekPickCount('NFL_PICKEM', picks, 1, ['g1', 'g2', 'g3'])).toBe(2);
  });

  it('survivor/margin is 0 or 1, keyed by the week number', () => {
    expect(weekPickCount('NFL_SURVIVOR', { '1': 'KC' }, 1, ['g1'])).toBe(1);
    expect(weekPickCount('NFL_SURVIVOR', { '2': 'KC' }, 1, ['g1'])).toBe(0);
    expect(weekPickCount('NFL_MARGIN', undefined, 1, ['g1'])).toBe(0);
  });
});
