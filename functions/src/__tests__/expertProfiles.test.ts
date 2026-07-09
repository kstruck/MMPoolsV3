import { describe, it, expect } from 'vitest';
import { gradeExpertGame } from '../expertProfiles';

// PLAN-PLAYER-PROFILES Phase 6 (ADR 0005 decision 4): straight-up grading of the
// ingested expert predictions. The profile rendering itself reuses buildPublicProfile
// (covered by profileBuild.test.ts).

const game = (over: any = {}) => ({
  status: 'FINAL',
  homeTeam: { abbreviation: 'KC' },
  awayTeam: { abbreviation: 'BUF' },
  scores: { home: 27, away: 24 },
  ...over,
});

describe('gradeExpertGame', () => {
  it('HOME pick on a home win grades W; AWAY pick grades L', () => {
    expect(gradeExpertGame('HOME', game())).toEqual({ pick: 'KC', result: 'W', away: 'BUF', home: 'KC' });
    expect(gradeExpertGame('AWAY', game())).toEqual({ pick: 'BUF', result: 'L', away: 'BUF', home: 'KC' });
  });

  it('tie grades PUSH; EVEN prediction grades VOID with no pick', () => {
    expect(gradeExpertGame('HOME', game({ scores: { home: 20, away: 20 } }))!.result).toBe('PUSH');
    expect(gradeExpertGame('EVEN', game())).toEqual({ pick: '', result: 'VOID', away: 'BUF', home: 'KC' });
  });

  it('cancelled grades VOID; non-final and missing predictions grade nothing', () => {
    expect(gradeExpertGame('HOME', game({ status: 'CANCELLED' }))!.result).toBe('VOID');
    expect(gradeExpertGame('HOME', game({ status: 'IN_PROGRESS' }))).toBeNull();
    expect(gradeExpertGame(undefined, game())).toBeNull();
  });
});
