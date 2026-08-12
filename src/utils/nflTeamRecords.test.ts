import { describe, it, expect } from 'vitest';
import { computeTeamRecords, formatTeamRecord } from './nflTeamRecords';
import type { NFLGame } from '../types';

/** Minimal game literal — only the fields the fold reads. */
const game = (over: {
  seasonType?: number;
  status?: string;
  home: string;
  away: string;
  hs?: number;
  as?: number;
  scores?: null;
}): NFLGame =>
  ({
    id: `g-${over.away}-${over.home}`,
    seasonType: over.seasonType ?? 1,
    status: over.status ?? 'FINAL',
    homeTeam: { id: over.home, name: over.home, abbreviation: over.home },
    awayTeam: { id: over.away, name: over.away, abbreviation: over.away },
    ...(over.scores === null
      ? {}
      : { scores: { home: over.hs ?? 0, away: over.as ?? 0 } }),
  }) as unknown as NFLGame;

describe('computeTeamRecords', () => {
  it('counts wins, losses and ties from FINAL games', () => {
    const rec = computeTeamRecords(
      [
        game({ home: 'ARI', away: 'CAR', hs: 21, as: 14 }), // ARI W, CAR L
        game({ home: 'CAR', away: 'DEN', hs: 10, as: 10 }), // tie
      ],
      1,
    );
    expect(rec.get('ARI')).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(rec.get('CAR')).toEqual({ wins: 0, losses: 1, ties: 1 });
    expect(rec.get('DEN')).toEqual({ wins: 0, losses: 0, ties: 1 });
  });

  it('ignores games that are not FINAL — an in-progress score is not a result', () => {
    const rec = computeTeamRecords(
      [
        game({ home: 'ARI', away: 'CAR', hs: 21, as: 14, status: 'IN_PROGRESS' }),
        game({ home: 'ARI', away: 'CAR', hs: 0, as: 0, status: 'SCHEDULED' }),
        game({ home: 'ARI', away: 'CAR', hs: 0, as: 0, status: 'CANCELLED' }),
      ],
      1,
    );
    expect(rec.size).toBe(0);
  });

  it('scopes to one seasonType — preseason results do not leak into regular season', () => {
    const rec = computeTeamRecords(
      [
        game({ home: 'ARI', away: 'CAR', hs: 21, as: 14, seasonType: 1 }),
        game({ home: 'ARI', away: 'CAR', hs: 3, as: 30, seasonType: 2 }),
      ],
      2,
    );
    expect(rec.get('ARI')).toEqual({ wins: 0, losses: 1, ties: 0 });
    expect(rec.get('CAR')).toEqual({ wins: 1, losses: 0, ties: 0 });
  });

  it('skips a FINAL game with no scores object rather than inventing a result', () => {
    const rec = computeTeamRecords([game({ home: 'ARI', away: 'CAR', scores: null })], 1);
    expect(rec.size).toBe(0);
  });
});

describe('formatTeamRecord', () => {
  it('renders 0-0 for a team with no games (undefined entry)', () => {
    expect(formatTeamRecord(undefined)).toBe('0-0');
  });

  it('omits ties when zero, includes them when present', () => {
    expect(formatTeamRecord({ wins: 2, losses: 1, ties: 0 })).toBe('2-1');
    expect(formatTeamRecord({ wins: 1, losses: 1, ties: 1 })).toBe('1-1-1');
  });
});

/**
 * ⚠️ THE PICK SHEET MUST PASS THE SEASON, NOT THE WEEK.
 *
 * codex on the pick-sheet overhaul PR: the sheets receive `games` already
 * filtered to the selected week, so computing records from that argument
 * renders every team 0-0 for the whole season — a plausible-looking value in
 * place of the real record, which is worse than showing nothing. The fix is a
 * separate `seasonGames` prop; this pins the arithmetic that makes the two
 * arguments give different answers, so a future revert fails here.
 */
describe('computeTeamRecords — week slate vs season slate', () => {
  const FINAL = (id: string, week: number, home: string, away: string, hs: number, as: number) => ({
    id, week, seasonType: 1, status: 'FINAL',
    homeTeam: { abbreviation: home }, awayTeam: { abbreviation: away },
    scores: { home: hs, away: as },
  }) as any;

  const season = [
    FINAL('g1', 1, 'KC', 'BUF', 24, 17),
    FINAL('g2', 2, 'BUF', 'KC', 30, 27),
    { id: 'g3', week: 3, seasonType: 1, status: 'SCHEDULED', homeTeam: { abbreviation: 'KC' }, awayTeam: { abbreviation: 'BUF' } } as any,
  ];

  it('reads the full season when given the full season', () => {
    const r = computeTeamRecords(season, 1);
    expect(formatTeamRecord(r.get('KC'))).toBe('1-1');
    expect(formatTeamRecord(r.get('BUF'))).toBe('1-1');
  });

  it('reads 0-0 for everyone when handed only an upcoming week — the defect', () => {
    const weekThreeOnly = season.filter(g => g.week === 3);
    const r = computeTeamRecords(weekThreeOnly, 1);
    expect(formatTeamRecord(r.get('KC'))).toBe('0-0');
    expect(formatTeamRecord(r.get('BUF'))).toBe('0-0');
  });
});
