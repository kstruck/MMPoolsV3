import { describe, it, expect } from 'vitest';
import {
  computeWeeklyWinners,
  computeMNFTiebreakerTotal,
  buildWeeklyRecap,
  type WeeklyWinnerCandidate,
} from '../nflScoringEngine';
import type { NFLGame } from '../nflPoolTypes';

/**
 * The weekly winner decides who a commissioner pays on a `payoutMode: WEEKLY`
 * pool, so every branch of the cascade is pinned here
 * (PLAN-WEEKLY-TIEBREAKERS §8c).
 *
 * The behaviour this replaces was `if (points > sharpUser.val)` — a strict `>`
 * that awarded every TIED week to whichever entry Firestore iterated first.
 * The tests that matter most are therefore the tie ones.
 */

const cand = (
  userId: string,
  points: number,
  tiebreakDiff?: number,
): WeeklyWinnerCandidate => ({
  entryId: userId,
  userId,
  userName: userId.toUpperCase(),
  points,
  ...(tiebreakDiff === undefined ? {} : { tiebreakDiff }),
});

const names = (ws: { userName: string }[]) => ws.map(w => w.userName).sort();

describe('computeWeeklyWinners — the points step', () => {
  it('returns nothing for no candidates', () => {
    expect(computeWeeklyWinners([])).toEqual([]);
  });

  it('returns the single highest scorer', () => {
    const out = computeWeeklyWinners([cand('a', 9), cand('b', 11), cand('c', 4)]);
    expect(names(out)).toEqual(['B']);
    expect(out[0].points).toBe(11);
  });

  it('ignores tiebreak diffs entirely when one player outscores the rest', () => {
    // b wins on points despite the worst prediction in the pool.
    const out = computeWeeklyWinners([cand('a', 9, 0), cand('b', 11, 99)]);
    expect(names(out)).toEqual(['B']);
  });

  it('a highest score of zero still wins the week', () => {
    // Not an empty week — nobody outscored anybody, so everyone shares.
    const out = computeWeeklyWinners([cand('a', 0), cand('b', 0)]);
    expect(names(out)).toEqual(['A', 'B']);
  });

  it('handles negative scores (Margin), where the least-bad week wins', () => {
    const out = computeWeeklyWinners([cand('a', -14), cand('b', -3), cand('c', -21)]);
    expect(names(out)).toEqual(['B']);
  });
});

describe('computeWeeklyWinners — the tiebreak step', () => {
  it('breaks a points tie by the closest prediction', () => {
    const out = computeWeeklyWinners([cand('a', 11, 7), cand('b', 11, 2), cand('c', 9, 0)]);
    expect(names(out)).toEqual(['B']);
    expect(out[0].tiebreakDiff).toBe(2);
  });

  it('SHARES when the tiebreak diffs are also equal', () => {
    const out = computeWeeklyWinners([cand('a', 11, 3), cand('b', 11, 3)]);
    expect(names(out)).toEqual(['A', 'B']);
  });

  it('SHARES when no tied leader made a prediction', () => {
    // No target (NONE rule / no Monday game / not final) reaches this shape.
    const out = computeWeeklyWinners([cand('a', 11), cand('b', 11)]);
    expect(names(out)).toEqual(['A', 'B']);
  });

  it('drops a non-answerer when ANOTHER tied leader answered', () => {
    // The money rule: you cannot share a weekly payout with somebody who never
    // answered the tiebreaker, when somebody else did. (codex P1, plan r11.)
    const out = computeWeeklyWinners([cand('a', 11), cand('b', 11, 5)]);
    expect(names(out)).toEqual(['B']);
  });

  it('a missing prediction is NOT treated as a prediction of zero', () => {
    // The `?? 0` coercion this code deliberately does not copy would give `a` a
    // diff of |0 - 0| = 0 against a low target and hand them the week.
    const withNothing = cand('a', 11);
    const withGuess = cand('b', 11, 0);
    const out = computeWeeklyWinners([withNothing, withGuess]);
    expect(names(out)).toEqual(['B']);
  });

  it('keeps every answerer tied at the same closest diff', () => {
    const out = computeWeeklyWinners([cand('a', 11, 2), cand('b', 11, 2), cand('c', 11, 9)]);
    expect(names(out)).toEqual(['A', 'B']);
  });
});

describe('computeWeeklyWinners — output shape', () => {
  it('omits tiebreakDiff entirely rather than setting it undefined', () => {
    // Firestore set() throws on a literal `undefined`, so the key must be ABSENT.
    const out = computeWeeklyWinners([cand('a', 11)]);
    expect(Object.prototype.hasOwnProperty.call(out[0], 'tiebreakDiff')).toBe(false);
  });

  it('carries the diff through when there is one', () => {
    const out = computeWeeklyWinners([cand('a', 11, 4), cand('b', 11, 9)]);
    expect(out[0].tiebreakDiff).toBe(4);
  });
});

// ---------------------------------------------------------------------------

const game = (id: string, opts: Partial<NFLGame> & { isMonday?: boolean }): NFLGame =>
  ({
    id,
    espnGameId: id,
    week: 1,
    season: '2026',
    seasonType: 2,
    homeTeam: { id: 'h', name: 'Home', abbreviation: 'HOM' },
    awayTeam: { id: 'a', name: 'Away', abbreviation: 'AWY' },
    startTime: 0,
    status: 'FINAL',
    ...opts,
  }) as unknown as NFLGame;

describe('computeMNFTiebreakerTotal — the rule chooses the target', () => {
  const early = game('g_early', { isMonday: true, startTime: 1000, scores: { home: 10, away: 7 } });
  const late = game('g_late', { isMonday: true, startTime: 5000, scores: { home: 20, away: 14 } });

  it('defaults to MNF_COMBINED, byte-identical to the historical behaviour', () => {
    // No `rule` argument at all — this is the call every pre-existing caller made.
    expect(computeMNFTiebreakerTotal([early, late])).toBe(51);
  });

  it('MNF_COMBINED sums every Monday game', () => {
    expect(computeMNFTiebreakerTotal([early, late], 'MNF_COMBINED')).toBe(51);
  });

  it('MNF_LAST_GAME sums only the latest kickoff', () => {
    expect(computeMNFTiebreakerTotal([early, late], 'MNF_LAST_GAME')).toBe(34);
  });

  it('MNF_LAST_GAME picks by kickoff regardless of array order', () => {
    expect(computeMNFTiebreakerTotal([late, early], 'MNF_LAST_GAME')).toBe(34);
  });

  it('MNF_LAST_GAME breaks a shared kickoff deterministically by id, not by order', () => {
    // Two Monday games at the same startTime: the answer must not depend on
    // Firestore query order, or the same week resolves differently per pass.
    const a = game('g_aaa', { isMonday: true, startTime: 5000, scores: { home: 3, away: 0 } });
    const b = game('g_bbb', { isMonday: true, startTime: 5000, scores: { home: 30, away: 7 } });
    expect(computeMNFTiebreakerTotal([a, b], 'MNF_LAST_GAME')).toBe(37);
    expect(computeMNFTiebreakerTotal([b, a], 'MNF_LAST_GAME')).toBe(37);
  });

  it('NONE has no target at all', () => {
    expect(computeMNFTiebreakerTotal([early, late], 'NONE')).toBeNull();
  });

  it('no Monday game: legacy MNF_COMBINED has no target; LAST/FIRST fall back to the final game of the week (PLAN-WEEKLY-PRIZES §2b)', () => {
    const early = game('g_early', { isMonday: false, startTime: 100, scores: { home: 3, away: 3 } });
    const sunday = game('g_sun', { isMonday: false, startTime: 200, scores: { home: 10, away: 7 } });
    expect(computeMNFTiebreakerTotal([early, sunday], 'MNF_COMBINED')).toBeNull();
    expect(computeMNFTiebreakerTotal([early, sunday], 'MNF_LAST_GAME')).toBe(17);
    expect(computeMNFTiebreakerTotal([early, sunday], 'MNF_FIRST_GAME')).toBe(17);
  });

  it('MNF_FIRST_GAME sums only the FIRST Monday game to kick off — the exact mirror of MNF_LAST_GAME', () => {
    expect(computeMNFTiebreakerTotal([early, late], 'MNF_FIRST_GAME')).toBe(
      (early.scores!.home) + (early.scores!.away),
    );
  });

  it('a FROZEN target list wins over the live schedule, and a frozen game that is CANCELLED or gone yields null (D3: tie shared)', () => {
    // Frozen to the early game only, even though the rule would pick the late one.
    expect(computeMNFTiebreakerTotal([early, late], 'MNF_LAST_GAME', [early.id])).toBe(
      (early.scores!.home) + (early.scores!.away),
    );
    // Legacy combined pool frozen to BOTH Monday games sums both.
    expect(computeMNFTiebreakerTotal([early, late], 'MNF_COMBINED', [early.id, late.id])).toBe(51);
    // Frozen game no longer in the schedule → no target.
    expect(computeMNFTiebreakerTotal([late], 'MNF_LAST_GAME', [early.id])).toBeNull();
    // Frozen game cancelled → no target.
    const cancelled = game(early.id, { ...early, status: 'CANCELLED' } as never);
    expect(computeMNFTiebreakerTotal([cancelled, late], 'MNF_LAST_GAME', [early.id])).toBeNull();
    // An EMPTY frozen list is a real frozen state — "no target this week" — and
    // does NOT fall through to the rule (qodo #9 on #452); only undefined does.
    expect(computeMNFTiebreakerTotal([early, late], 'MNF_LAST_GAME', [])).toBeNull();
    expect(computeMNFTiebreakerTotal([early, late], 'MNF_LAST_GAME', undefined)).toBe(
      (late.scores!.home) + (late.scores!.away),
    );
  });

  it('MNF_COMBINED waits for EVERY Monday game', () => {
    const unfinished = game('g_late', { isMonday: true, startTime: 5000, status: 'IN_PROGRESS', scores: { home: 3, away: 0 } });
    expect(computeMNFTiebreakerTotal([early, unfinished], 'MNF_COMBINED')).toBeNull();
  });

  it('MNF_LAST_GAME waits only for the game it names', () => {
    // The earlier game is still being played/corrected; the last one is final.
    // Resolving here is the rule working, not a hole in it.
    const unfinishedEarly = game('g_early', { isMonday: true, startTime: 1000, status: 'IN_PROGRESS', scores: { home: 3, away: 0 } });
    expect(computeMNFTiebreakerTotal([unfinishedEarly, late], 'MNF_LAST_GAME')).toBe(34);
  });

  it('MNF_LAST_GAME is null while the last game itself is unfinished', () => {
    const unfinishedLate = game('g_late', { isMonday: true, startTime: 5000, status: 'IN_PROGRESS', scores: { home: 3, away: 0 } });
    expect(computeMNFTiebreakerTotal([early, unfinishedLate], 'MNF_LAST_GAME')).toBeNull();
  });
});

describe('buildWeeklyRecap — weeklyWinners', () => {
  const base = {
    poolId: 'p1',
    week: 4,
    poolType: 'NFL_PICKEM',
    sharpUser: null,
    closestTie: null,
    aliveCount: 0,
    nowMs: 1,
  };

  it('omits the field entirely when there are no winners', () => {
    // ABSENT means "not computed". An empty array would assert "nobody won",
    // and Firestore's set() throws on a literal undefined either way.
    const recap = buildWeeklyRecap({ ...base, weeklyWinners: [] });
    expect(Object.prototype.hasOwnProperty.call(recap, 'weeklyWinners')).toBe(false);
  });

  it('omits the field when the caller passes nothing', () => {
    const recap = buildWeeklyRecap(base);
    expect(Object.prototype.hasOwnProperty.call(recap, 'weeklyWinners')).toBe(false);
  });

  it('carries a shared win as the full array', () => {
    const recap = buildWeeklyRecap({
      ...base,
      weeklyWinners: [
        { userId: 'a', userName: 'A', points: 11 },
        { userId: 'b', userName: 'B', points: 11 },
      ],
    });
    expect(recap.weeklyWinners).toHaveLength(2);
  });
});
