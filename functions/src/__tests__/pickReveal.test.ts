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
import { revealMode, weekRevealFor, fullReveal, weekPickCount, pickProgressFor } from '../lib/pickReveal';
import { eligiblePlayerUids } from '../shared/memberRecord';

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

  /**
   * ⚠️ confidenceMode is a WEEKLY lock even when lockMode still reads PER_GAME.
   * `submitNFLPicksInternal` derives its submission lock as
   * `confidenceMode || lockMode === 'WEEKLY'`, and this predicate must mirror
   * that expression — otherwise the commissioner is held out of a sheet that has
   * been immutable for hours, and the weekly tiebreaker is withheld until the
   * last kickoff. codex r4.
   */
  it('is WEEK for a confidence pool whose lockMode still says PER_GAME', () => {
    expect(revealMode({ type: 'NFL_PICKEM', settings: { confidenceMode: true } })).toBe('WEEK');
    expect(revealMode({ type: 'NFL_PICKEM', settings: { confidenceMode: true, lockMode: 'PER_GAME' } })).toBe('WEEK');
    expect(revealMode({ type: 'NFL_PICKEM', settings: { confidenceMode: false, lockMode: 'PER_GAME' } })).toBe('PER_GAME');
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

describe('weekRevealFor — a confidence sheet reveals as a WHOLE SHEET', () => {
  const conf = { type: 'NFL_PICKEM', settings: { confidenceMode: true, lockMode: 'PER_GAME' } };

  it('reveals nothing before the earliest deadline', () => {
    expect(weekRevealFor(conf, 1, games, KICK - 10 * MIN).weekRevealed).toBe(false);
  });

  it('reveals every game at the earliest deadline, not game by game', () => {
    const r = weekRevealFor(conf, 1, games, KICK);
    expect(r.mode).toBe('WEEK');
    expect(r.weekRevealed).toBe(true);
    expect(r.revealedGameIds).toEqual(['g1', 'g2', 'g3']);
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

/**
 * PLAN-MEMBER-PICK-PROGRESS — "12 of 16 players have their picks in".
 *
 * Every case below is a regression guard for a version of this that adversarial
 * review rejected, and each one failed the SAME way: by reporting that everyone
 * was done when somebody was not. The round that found it is named.
 */
const GAMES = ['g1', 'g2', 'g3'];
const E = (ownerUid: string, picks?: Record<string, unknown>) => ({ ownerUid, picks });
const FULL = { g1: 'KC', g2: 'BUF', g3: 'SF' };

describe('eligiblePlayerUids — the denominator set', () => {
  const rec = (uid: string, extra: Record<string, unknown> = {}) =>
    ({ uid, poolId: 'p', userName: uid, paidStatus: 'UNPAID', joinedAt: 1, ...extra }) as never;

  it('a joined member who has never picked is IN — the whole point of the number (r3)', () => {
    // Counting only entry owners reported "12 of 12" on a pool where four people
    // had not started.
    expect(eligiblePlayerUids([rec('a'), rec('b', { hasPlayableEntry: false })], 'host'))
      .toEqual(['a', 'b']);
  });

  it('a NON-PLAYING HOST is OUT — otherwise the pool reads "3 of 4" for ever (r8)', () => {
    expect(eligiblePlayerUids([rec('host', { hasPlayableEntry: false }), rec('a')], 'host'))
      .toEqual(['a']);
  });

  it('…but a host who DOES play is in, by the normal route (r8)', () => {
    expect(eligiblePlayerUids([rec('host', { hasPlayableEntry: true }), rec('a')], 'host'))
      .toEqual(['host', 'a']);
  });

  it('an UNDEFINED latch is not evidence of anything — the host stays in (r9)', () => {
    // `=== false`, never falsy. Same unknown-is-not-false discipline
    // `lib/memberRecord.ts` keeps for the field itself.
    expect(eligiblePlayerUids([rec('host'), rec('a')], 'host')).toEqual(['host', 'a']);
  });

  it('a CO-COMMISSIONER who has not picked yet is IN — they joined as a player (r9)', () => {
    // `setPoolCoCommissioner` only accepts an existing canonical member, so a
    // co-commissioner is a promoted player. Excluding them is the r3 defect again.
    expect(eligiblePlayerUids([rec('host', { hasPlayableEntry: false }), rec('co', { hasPlayableEntry: false })], 'host'))
      .toEqual(['co']);
  });

  it('a distinct managerUid who plays is IN — only the OWNER record is the host (r10)', () => {
    // The caller passes `pool.ownerId ?? pool.managerUid`, so a pool WITH an owner
    // never hands this function its manager's uid.
    expect(eligiblePlayerUids([rec('owner', { hasPlayableEntry: false }), rec('mgr', { hasPlayableEntry: false })], 'owner'))
      .toEqual(['mgr']);
  });

  it('a FORGED member record with no joinedAt is OUT (r10)', () => {
    const forged = { uid: 'ghost', poolId: 'p', userName: 'ghost', paidStatus: 'UNPAID' } as never;
    expect(eligiblePlayerUids([rec('a'), forged], 'host')).toEqual(['a']);
  });
});

describe('pickProgressFor — the pool-wide fraction', () => {
  const base = { poolType: 'NFL_PICKEM', week: 1, weekGameIds: GAMES };

  it('counts players with a COMPLETE week, out of the eligible roster', () => {
    expect(pickProgressFor({
      ...base,
      playerUids: ['a', 'b', 'c'],
      entries: [E('a', FULL), E('b', { g1: 'KC' }), E('c', FULL)],
    })).toEqual({ complete: 2, total: 3 });
  });

  it('a rostered player with NO ENTRY counts toward total and never toward complete (r3)', () => {
    expect(pickProgressFor({ ...base, playerUids: ['a', 'b'], entries: [E('a', FULL)] }))
      .toEqual({ complete: 1, total: 2 });
  });

  it("a DEPARTED owner's complete entry cannot cover for a current member (r6)", () => {
    // The reachable case the count-only design got wrong: `gone` is off the
    // roster and `b` has not picked. The answer is 1 of 2, never 2 of 2.
    expect(pickProgressFor({
      ...base,
      playerUids: ['a', 'b'],
      entries: [E('a', FULL), E('gone', FULL)],
    })).toEqual({ complete: 1, total: 2 });
  });

  it('an EMPTY SLATE is {0,0}, not "everyone is done" (r1)', () => {
    // `need` would be 0 and every entry would satisfy it. Short-circuited before
    // the predicate, never left to it.
    expect(pickProgressFor({ ...base, weekGameIds: [], playerUids: ['a', 'b'], entries: [E('a')] }))
      .toEqual({ complete: 0, total: 0 });
  });

  it('NO playerUids — a schema-1 rosterSummary — is {0,0}, so the chip hides (r5/r6)', () => {
    expect(pickProgressFor({ ...base, playerUids: undefined, entries: [E('a', FULL)] }))
      .toEqual({ complete: 0, total: 0 });
    expect(pickProgressFor({ ...base, playerUids: [], entries: [E('a', FULL)] }))
      .toEqual({ complete: 0, total: 0 });
  });

  it('a multi-entry player counts ONCE, and only when EVERY entry is complete', () => {
    expect(pickProgressFor({
      ...base,
      playerUids: ['a'],
      entries: [E('a', FULL), E('a', { g1: 'KC' })],
    })).toEqual({ complete: 0, total: 1 });
    expect(pickProgressFor({
      ...base,
      playerUids: ['a'],
      entries: [E('a', FULL), E('a', FULL)],
    })).toEqual({ complete: 1, total: 1 });
  });

  it('survivor/margin need ONE pick, keyed by the week number', () => {
    expect(pickProgressFor({
      poolType: 'NFL_SURVIVOR', week: 2, weekGameIds: GAMES,
      playerUids: ['a', 'b'],
      entries: [E('a', { '2': 'KC' }), E('b', { '1': 'KC' })],
    })).toEqual({ complete: 1, total: 2 });
  });

  it('complete can never exceed total — there is no clamp because there is one set', () => {
    const r = pickProgressFor({ ...base, playerUids: ['a'], entries: [E('a', FULL), E('b', FULL)] });
    expect(r).toEqual({ complete: 1, total: 1 });
  });
});
