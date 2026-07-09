import { describe, it, expect } from 'vitest';
import {
  gradePickemGames,
  scorePickemEntry,
  gradeSurvivorWeekGame,
  gradeMarginWeekGame,
  buildStandingsRows,
} from '../nflScoringEngine';
import type { NFLGame, NFLPickemPool, NFLPickemEntry, SurvivorEntry, MarginEntry } from '../nflPoolTypes';

// PLAN-PLAYER-PROFILES Phase 2 (ADR 0005): per-pick graded outcomes + the standings
// projection. scorePickemEntry is now DERIVED from gradePickemGames — the consistency
// suite below is the certified-scoring non-regression guard for that refactor.

const game = (over: Partial<NFLGame>): NFLGame => ({
  id: 'g1', espnGameId: 'e1', season: '2026', seasonType: 2, week: 1,
  homeTeam: { id: '1', name: 'Chiefs', abbreviation: 'KC' },
  awayTeam: { id: '2', name: 'Bills', abbreviation: 'BUF' },
  startTime: 0, status: 'FINAL',
  scores: { home: 27, away: 24 },
  spread: { value: -7, locked: true }, // KC favored by 7
  ...over,
} as NFLGame);

const pool = (pickMode: 'STRAIGHT' | 'ATS', confidenceMode = false): NFLPickemPool => ({
  id: 'p1', type: 'NFL_PICKEM', name: 'T', season: '2026',
  settings: { pickMode, confidenceMode, entryFee: 0 },
} as unknown as NFLPickemPool);

const entry = (picks: Record<string, string>, confidence?: Record<string, number>): NFLPickemEntry => ({
  id: 'u1', poolId: 'p1', ownerUid: 'u1', userName: 'Alice',
  picks, confidence, weeklyPoints: {}, totalScore: 0,
  submittedAt: 0, paidStatus: 'PAID',
} as unknown as NFLPickemEntry);

describe('gradePickemGames — per-pick results', () => {
  it('straight-up: winner pick W, loser pick L', () => {
    const games = [game({ spread: undefined })];
    expect(gradePickemGames(entry({ g1: 'KC' }), games, pool('STRAIGHT')).g1).toEqual({ pick: 'KC', result: 'W', away: 'BUF', home: 'KC' });
    expect(gradePickemGames(entry({ g1: 'BUF' }), games, pool('STRAIGHT')).g1).toEqual({ pick: 'BUF', result: 'L', away: 'BUF', home: 'KC' });
  });

  it('straight-up tie grades PUSH (earns 0, same as before)', () => {
    const games = [game({ scores: { home: 20, away: 20 }, spread: undefined })];
    expect(gradePickemGames(entry({ g1: 'KC' }), games, pool('STRAIGHT')).g1.result).toBe('PUSH');
    expect(scorePickemEntry(entry({ g1: 'KC' }), games, pool('STRAIGHT')).points).toBe(0);
  });

  it('ATS: cover W, non-cover L, exact spread PUSH', () => {
    const games = [game({})]; // KC 27-24, favored 7 → BUF covers
    expect(gradePickemGames(entry({ g1: 'BUF' }), games, pool('ATS')).g1.result).toBe('W');
    expect(gradePickemGames(entry({ g1: 'KC' }), games, pool('ATS')).g1.result).toBe('L');
    const push = [game({ scores: { home: 31, away: 24 } })]; // exactly 7
    expect(gradePickemGames(entry({ g1: 'KC' }), push, pool('ATS')).g1.result).toBe('PUSH');
  });

  it('ATS with missing spread grades straight-up (repair-case fallback)', () => {
    const games = [game({ spread: undefined })];
    expect(gradePickemGames(entry({ g1: 'KC' }), games, pool('ATS')).g1.result).toBe('W');
  });

  it('cancelled game grades VOID; unpicked and non-final games are absent', () => {
    const games = [
      game({}),
      game({ id: 'g2', status: 'CANCELLED' }),
      game({ id: 'g3', status: 'IN_PROGRESS' as never }),
    ];
    const grades = gradePickemGames(entry({ g1: 'KC', g2: 'KC', g3: 'KC' }), games, pool('STRAIGHT'));
    expect(grades.g2).toEqual({ pick: 'KC', result: 'VOID', away: 'BUF', home: 'KC' });
    expect(grades.g3).toBeUndefined();
    const unpicked = gradePickemGames(entry({}), games, pool('STRAIGHT'));
    expect(Object.keys(unpicked)).toHaveLength(0);
  });

  it('rescore idempotence: grading twice yields identical maps', () => {
    const games = [game({}), game({ id: 'g2', scores: { home: 10, away: 30 } })];
    const e = entry({ g1: 'KC', g2: 'BUF' });
    expect(gradePickemGames(e, games, pool('ATS'))).toEqual(gradePickemGames(e, games, pool('ATS')));
  });
});

describe('scorePickemEntry consistency with grades (certified non-regression)', () => {
  const fixtures: Array<{ games: NFLGame[]; picks: Record<string, string>; conf?: Record<string, number> }> = [
    { games: [game({ spread: undefined })], picks: { g1: 'KC' } },
    { games: [game({})], picks: { g1: 'BUF' } },
    { games: [game({ scores: { home: 31, away: 24 } })], picks: { g1: 'KC' } },
    { games: [game({ scores: { home: 20, away: 20 }, spread: undefined })], picks: { g1: 'KC' } },
    { games: [game({}), game({ id: 'g2', status: 'CANCELLED' })], picks: { g1: 'BUF', g2: 'KC' }, conf: { g1: 12, g2: 3 } },
  ];

  for (const mode of ['STRAIGHT', 'ATS'] as const) {
    for (const confidenceMode of [false, true]) {
      it(`points/correctCount equal W-derived values (${mode}, confidence=${confidenceMode})`, () => {
        for (const f of fixtures) {
          const p = pool(mode, confidenceMode);
          const e = entry(f.picks, f.conf);
          const { points, correctCount } = scorePickemEntry(e, f.games, p);
          const grades = gradePickemGames(e, f.games, p);
          const wins = Object.entries(grades).filter(([, g]) => g.result === 'W');
          expect(correctCount).toBe(wins.length);
          const expectedPoints = confidenceMode
            ? wins.reduce((s, [gid]) => s + (f.conf?.[gid] ?? 0), 0)
            : wins.length;
          expect(points).toBe(expectedPoints);
        }
      });
    }
  }
});

describe('gradeSurvivorWeekGame', () => {
  const survivor = (picks: Record<number, string>): SurvivorEntry => ({
    id: 'u1', poolId: 'p1', ownerUid: 'u1', userName: 'Alice', status: 'ALIVE',
    strikesUsed: 0, rebuysUsed: 0, usedTeams: [], picks, exemptWeeks: [],
    submittedAt: 0, paidStatus: 'PAID',
  } as unknown as SurvivorEntry);

  it('records SURVIVED / STRUCK per the strike flag', () => {
    const games = [game({})];
    expect(gradeSurvivorWeekGame(survivor({ 1: 'KC' }), 1, games, false)).toEqual({ gameId: 'g1', pick: 'KC', result: 'SURVIVED' });
    expect(gradeSurvivorWeekGame(survivor({ 1: 'BUF' }), 1, games, true)).toEqual({ gameId: 'g1', pick: 'BUF', result: 'STRUCK' });
  });

  it('cancelled game records VOID; no pick or no game records null', () => {
    expect(gradeSurvivorWeekGame(survivor({ 1: 'KC' }), 1, [game({ status: 'CANCELLED' })], false)).toEqual({ gameId: 'g1', pick: 'KC', result: 'VOID' });
    expect(gradeSurvivorWeekGame(survivor({}), 1, [game({})], true)).toBeNull();
    expect(gradeSurvivorWeekGame(survivor({ 1: 'DAL' }), 1, [game({})], false)).toBeNull();
  });
});

describe('gradeMarginWeekGame', () => {
  it('records the signed net for the picked side', () => {
    const games = [game({ spread: undefined })]; // KC 27-24
    expect(gradeMarginWeekGame('KC', games)).toEqual({ gameId: 'g1', pick: 'KC', net: 3 });
    expect(gradeMarginWeekGame('BUF', games)).toEqual({ gameId: 'g1', pick: 'BUF', net: -3 });
  });

  it('cancelled game records net 0; unpicked/no-game/non-final null', () => {
    expect(gradeMarginWeekGame('KC', [game({ status: 'CANCELLED' })])).toEqual({ gameId: 'g1', pick: 'KC', net: 0 });
    expect(gradeMarginWeekGame(undefined, [game({})])).toBeNull();
    expect(gradeMarginWeekGame('DAL', [game({})])).toBeNull();
    expect(gradeMarginWeekGame('KC', [game({ status: 'IN_PROGRESS' as never })])).toBeNull();
  });
});

describe('buildStandingsRows — leak safety (allowlist)', () => {
  it('pickem rows carry summaries but never picks/confidence/tiebreakers or per-game maps', () => {
    const e = {
      ...entry({ g1: 'KC' }, { g1: 12 }),
      weeklyTiebreakers: { 1: 44 },
      totalScore: 9,
      weeklyPoints: { 1: 9 },
      weeklyResults: { 1: { correct: 9, total: 14, points: 9, mode: 'STRAIGHT', games: { g1: { pick: 'KC', result: 'W' } } } },
    } as unknown as NFLPickemEntry;
    const [row] = buildStandingsRows('NFL_PICKEM', [e]);
    expect(row).not.toHaveProperty('picks');
    expect(row).not.toHaveProperty('confidence');
    expect(row).not.toHaveProperty('weeklyTiebreakers');
    expect(row).not.toHaveProperty('usedTeams');
    expect(row.totalScore).toBe(9);
    expect(row.weeklyResults?.[1]).toEqual({ correct: 9, total: 14, points: 9, mode: 'STRAIGHT' });
    expect(row.weeklyResults?.[1]).not.toHaveProperty('games');
  });

  it('survivor rows expose status/strikes but never picks or usedTeams (current-week leak)', () => {
    const s = {
      id: 'u2', poolId: 'p1', ownerUid: 'u2', userName: 'Bob', status: 'ALIVE',
      strikesUsed: 1, strikeWeeks: [3], rebuysUsed: 0, eliminatedWeek: null,
      usedTeams: ['KC', 'DAL'], picks: { 1: 'KC', 4: 'PHI' }, exemptWeeks: [],
      weeklyResults: { 1: { survived: true, strike: false, game: { gameId: 'g1', pick: 'KC', result: 'SURVIVED' } } },
      submittedAt: 0, paidStatus: 'PAID',
    } as unknown as SurvivorEntry;
    const [row] = buildStandingsRows('NFL_SURVIVOR', [s]);
    expect(row).not.toHaveProperty('picks');
    expect(row).not.toHaveProperty('usedTeams');
    expect(row.status).toBe('ALIVE');
    expect(row.strikeWeeks).toEqual([3]);
    expect(row.weeklyResults?.[1]).toEqual({ survived: true, strike: false });
  });

  it('margin rows expose totals/rank but never picks or usedTeams', () => {
    const m = {
      id: 'u3', poolId: 'p1', ownerUid: 'u3', userName: 'Cat',
      picks: { 1: 'KC' }, usedTeams: ['KC'], weeklyScores: { 1: 3 },
      weeklyResults: { 1: { net: 3, game: { gameId: 'g1', pick: 'KC', net: 3 } } },
      seasonTotal: 3, negativeBurden: 0, positiveWeeks: 1, bestWeek: 3, rank: 1,
      submittedAt: 0, paidStatus: 'PAID',
    } as unknown as MarginEntry;
    const [row] = buildStandingsRows('NFL_MARGIN', [m]);
    expect(row).not.toHaveProperty('picks');
    expect(row).not.toHaveProperty('usedTeams');
    expect(row.seasonTotal).toBe(3);
    expect(row.rank).toBe(1);
    expect(row.weeklyResults?.[1]).toEqual({ net: 3 });
  });
});
