import { describe, it, expect } from 'vitest';
import { buildPublicProfile, type ProfilePoolInput } from '../lib/profileBuild';

// PLAN-PLAYER-PROFILES Phase 5 (ADR 0005): the pure projection builder — leak rules,
// bucketing, yearly rollup, profit reconciliation.

const pickemPool = (over: Partial<ProfilePoolInput> = {}): ProfilePoolInput => ({
  poolId: 'SECRET_POOL_ID',
  poolName: 'SECRET POOL NAME',
  poolType: 'NFL_PICKEM',
  pickMode: 'STRAIGHT',
  season: '2026',
  entry: {
    weeklyResults: {
      1: {
        correct: 2, total: 3, points: 2, mode: 'STRAIGHT',
        games: {
          g1: { pick: 'KC', result: 'W', away: 'BUF', home: 'KC' },
          g2: { pick: 'DAL', result: 'L', away: 'DAL', home: 'PHI' },
          g3: { pick: 'KC', result: 'W', away: 'KC', home: 'DEN' },
        },
      },
    },
  },
  finalRank: null,
  awardsWon: 0,
  feeOwed: 25,
  feeEstimated: false,
  finalized: false,
  payoutsRecorded: false,
  ...over,
});

describe('buildPublicProfile — leak rules', () => {
  it('the public doc contains ZERO pool identifiers anywhere', () => {
    const profile = buildPublicProfile('u1', 'Alice', 'PLAYER', [
      pickemPool({ finalRank: { rank: 1, totalEntries: 12 }, finalized: true }),
    ]);
    const json = JSON.stringify(profile);
    expect(json).not.toContain('SECRET_POOL_ID');
    expect(json).not.toContain('SECRET POOL NAME');
    expect(json).not.toContain('poolId');
    expect(json).not.toContain('poolName');
  });

  it('weekly rows aggregate ACROSS pools per (season, week)', () => {
    const profile = buildPublicProfile('u1', 'Alice', 'PLAYER', [
      pickemPool(),
      pickemPool({ poolId: 'p2', entry: { weeklyResults: { 1: { correct: 3, total: 3, points: 3, games: {} } } } }),
    ]);
    expect(profile.weekly).toHaveLength(1);
    expect(profile.weekly[0]).toEqual({ season: '2026', week: 1, correct: 5, total: 6, points: 5 });
    expect(profile.overall.accuracy).toBe(83);
  });
});

describe('buildPublicProfile — team buckets', () => {
  it('buckets by (poolType, pickMode) — SU and ATS never blend', () => {
    const profile = buildPublicProfile('u1', 'Alice', 'PLAYER', [
      pickemPool(),
      pickemPool({ poolId: 'p2', pickMode: 'ATS', entry: { weeklyResults: { 1: { correct: 0, total: 1, points: 0, games: { g9: { pick: 'KC', result: 'L', away: 'KC', home: 'LV' } } } } } }),
    ]);
    expect(profile.teamByTeam).toHaveLength(2);
    const su = profile.teamByTeam.find(b => b.pickMode === 'STRAIGHT')!;
    const ats = profile.teamByTeam.find(b => b.pickMode === 'ATS')!;
    const kcSu = su.teams.find(t => t.team === 'KC')!;
    expect(kcSu).toEqual({ team: 'KC', wins: 2, losses: 0, pushes: 0, accuracy: 100 });
    expect(ats.teams).toEqual([{ team: 'KC', wins: 0, losses: 1, pushes: 0, accuracy: 0 }]);
  });

  it('survivor SURVIVED/STRUCK map to W/L; margin sign maps to W/L/PUSH', () => {
    const profile = buildPublicProfile('u1', 'Alice', 'PLAYER', [
      {
        ...pickemPool(), poolType: 'NFL_SURVIVOR', pickMode: undefined,
        entry: { weeklyResults: { 1: { survived: true, strike: false, game: { gameId: 'g1', pick: 'KC', result: 'SURVIVED' } }, 2: { survived: false, strike: true, game: { gameId: 'g2', pick: 'NYJ', result: 'STRUCK' } } } },
      },
      {
        ...pickemPool(), poolId: 'p3', poolType: 'NFL_MARGIN', pickMode: undefined,
        entry: { weeklyResults: { 1: { net: 7, game: { gameId: 'g4', pick: 'SF', net: 7 } } } },
      },
    ]);
    const surv = profile.teamByTeam.find(b => b.poolType === 'NFL_SURVIVOR')!;
    expect(surv.teams.find(t => t.team === 'KC')!.wins).toBe(1);
    expect(surv.teams.find(t => t.team === 'NYJ')!.losses).toBe(1);
    const margin = profile.teamByTeam.find(b => b.poolType === 'NFL_MARGIN')!;
    expect(margin.teams).toEqual([{ team: 'SF', wins: 1, losses: 0, pushes: 0, accuracy: 100 }]);
  });
});

describe('buildPublicProfile — pick history', () => {
  it('rows carry matchup + result but no pool identity; newest first', () => {
    const profile = buildPublicProfile('u1', 'Alice', 'PLAYER', [pickemPool()]);
    expect(profile.pickHistory).toHaveLength(3);
    expect(profile.pickHistory[0]).toMatchObject({ season: '2026', week: 1, awayAbbr: 'BUF', homeAbbr: 'KC', pick: 'KC', result: 'W' });
    for (const row of profile.pickHistory) {
      expect(Object.keys(row)).not.toContain('poolId');
      expect(Object.keys(row)).not.toContain('poolName');
    }
  });

  it('caps at PICK_HISTORY_CAP (200)', () => {
    const games: Record<string, any> = {};
    for (let i = 0; i < 250; i++) games[`g${i}`] = { pick: 'KC', result: 'W', away: 'A', home: 'KC' };
    const profile = buildPublicProfile('u1', 'Alice', 'PLAYER', [
      pickemPool({ entry: { weeklyResults: { 1: { correct: 250, total: 250, points: 250, games } } } }),
    ]);
    expect(profile.pickHistory).toHaveLength(200);
  });
});

describe('buildPublicProfile — yearly + profit', () => {
  it('profitNet stays null for a season with no recorded payouts; fees still count overall', () => {
    const profile = buildPublicProfile('u1', 'Alice', 'PLAYER', [
      pickemPool({ finalized: true }), // finalized, payouts NOT recorded
    ]);
    expect(profile.yearly[0].profitNet).toBeNull();
    expect(profile.profit).toEqual({ won: 0, feesOwed: 25, net: -25, poolsPendingPayouts: 1, feesEstimated: false });
  });

  it('recorded payouts make the season profit real; best finish = min rank', () => {
    const profile = buildPublicProfile('u1', 'Alice', 'PLAYER', [
      pickemPool({ finalized: true, payoutsRecorded: true, awardsWon: 100, finalRank: { rank: 3, totalEntries: 10 } }),
      pickemPool({ poolId: 'p2', finalized: true, payoutsRecorded: true, awardsWon: 0, feeOwed: 20, finalRank: { rank: 1, totalEntries: 8 } }),
    ]);
    expect(profile.yearly[0].profitNet).toBe(55); // 100 - 25 - 20
    expect(profile.yearly[0].bestFinish).toEqual({ rank: 1, totalEntries: 8 });
    expect(profile.profit!.poolsPendingPayouts).toBe(0);
  });

  it('estimated backfilled fees flag the profit disclosure', () => {
    const profile = buildPublicProfile('u1', 'Alice', 'PLAYER', [pickemPool({ feeEstimated: true })]);
    expect(profile.profit!.feesEstimated).toBe(true);
  });

  it('experts carry no money figures', () => {
    const profile = buildPublicProfile('expert_vegas', 'Vegas', 'EXPERT', [pickemPool()]);
    expect(profile.subjectKind).toBe('EXPERT');
    expect(profile.profit).toBeNull();
  });
});
