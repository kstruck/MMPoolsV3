import { describe, it, expect } from 'vitest';
import {
  scorePickemEntry,
  validateConfidenceValues,
  evaluateSurvivorWeek,
  updateSurvivorStatus,
  checkAutoSurviveExemption,
  scoreMarginWeek,
  sortMarginLeaderboard
} from '../functions/src/nflScoringEngine';
import {
  NFLGame,
  NFLPickemPool,
  NFLSurvivorPool,
  NFLMarginPool,
  NFLPickemEntry,
  SurvivorEntry,
  MarginEntry
} from '../functions/src/nflPoolTypes';

describe('NFL Pools Scoring Engine Tests', () => {

  // Mock schedule setup
  const mockGames: NFLGame[] = [
    {
      id: 'espn_g1',
      espnGameId: 'g1',
      week: 1,
      season: '2026',
      seasonType: 2,
      homeTeam: { id: 'KC', name: 'Chiefs', abbreviation: 'KC' },
      awayTeam: { id: 'BAL', name: 'Ravens', abbreviation: 'BAL' },
      scores: { home: 27, away: 20 },
      startTime: 1725580800000,
      status: 'FINAL',
      isMonday: false
    },
    {
      id: 'espn_g2',
      espnGameId: 'g2',
      week: 1,
      season: '2026',
      seasonType: 2,
      homeTeam: { id: 'NYG', name: 'Giants', abbreviation: 'NYG' },
      awayTeam: { id: 'MIN', name: 'Vikings', abbreviation: 'MIN' },
      scores: { home: 6, away: 28 },
      startTime: 1725584400000,
      status: 'FINAL',
      isMonday: false
    },
    {
      id: 'espn_g3',
      espnGameId: 'g3',
      week: 1,
      season: '2026',
      seasonType: 2,
      homeTeam: { id: 'SF', name: '49ers', abbreviation: 'SF' },
      awayTeam: { id: 'NYJ', name: 'Jets', abbreviation: 'NYJ' },
      scores: { home: 32, away: 19 },
      startTime: 1725588000000,
      status: 'FINAL',
      isMonday: true // Monday Night Football
    }
  ];

  describe('Pickem Scoring', () => {
    const mockPool: NFLPickemPool = {
      id: 'pool_pickem',
      type: 'NFL_PICKEM',
      league: 'NFL',
      name: 'Pickem Pool',
      ownerId: 'manager_1',
      managerUid: 'manager_1',
      season: '2026',
      createdAt: Date.now(),
      isLocked: false,
      settings: {
        entryFee: 10,
        paymentInstructions: '',
        isListedPublic: true,
        payouts: { places: [], bonuses: [] },
        confidenceMode: false,
        lockMode: 'PER_GAME',
        lockBufferMinutes: 5,
        payoutMode: 'SEASON',
        pickMode: 'STRAIGHT'
      }
    };

    it('calculates standard Straight Pickem score correctly (1 pt per win)', () => {
      const entry: NFLPickemEntry = {
        id: 'user_1',
        poolId: 'pool_pickem',
        ownerUid: 'user_1',
        userName: 'User 1',
        picks: {
          'espn_g1': 'KC',  // Correct (Chiefs won 27-20) -> +1
          'espn_g2': 'NYG', // Incorrect (Vikings won 28-6) -> 0
          'espn_g3': 'SF'   // Correct (49ers won 32-19) -> +1
        },
        totalScore: 0,
        submittedAt: Date.now(),
        paidStatus: 'PAID'
      };

      const res = scorePickemEntry(entry, mockGames, mockPool);
      expect(res.points).toBe(2);
      expect(res.correctCount).toBe(2);
    });

    it('calculates Confidence Mode Pickem score correctly using weighted points', () => {
      const confidencePool: NFLPickemPool = {
        ...mockPool,
        settings: {
          ...mockPool.settings,
          confidenceMode: true,
          lockMode: 'WEEKLY'
        }
      };

      const entry: NFLPickemEntry = {
        id: 'user_1',
        poolId: 'pool_pickem',
        ownerUid: 'user_1',
        userName: 'User 1',
        picks: {
          'espn_g1': 'KC',  // Correct -> +16 pts
          'espn_g2': 'NYG', // Incorrect -> 0 pts
          'espn_g3': 'SF'   // Correct -> +15 pts
        },
        confidence: {
          'espn_g1': 16,
          'espn_g2': 14,
          'espn_g3': 15
        },
        totalScore: 0,
        submittedAt: Date.now(),
        paidStatus: 'PAID'
      };

      const res = scorePickemEntry(entry, mockGames, confidencePool);
      expect(res.points).toBe(31); // 16 + 15
      expect(res.correctCount).toBe(2);
    });

    it('validates unique confidence values correctly', () => {
      const picks = {
        'espn_g1': 'KC',
        'espn_g2': 'MIN',
        'espn_g3': 'SF'
      };
      const validConfidence = {
        'espn_g1': 16,
        'espn_g2': 15,
        'espn_g3': 14
      };
      const invalidConfidence = {
        'espn_g1': 16,
        'espn_g2': 16, // Duplicate 16!
        'espn_g3': 14
      };

      const validRes = validateConfidenceValues(picks, validConfidence, mockGames);
      expect(validRes.valid).toBe(true);

      const invalidRes = validateConfidenceValues(picks, invalidConfidence, mockGames);
      expect(invalidRes.valid).toBe(false);
      expect(invalidRes.error).toContain('DUPLICATE');
    });
  });

  describe('Survivor Scoring', () => {
    const mockPool: NFLSurvivorPool = {
      id: 'pool_survivor',
      type: 'NFL_SURVIVOR',
      league: 'NFL',
      name: 'Survivor Pool',
      ownerId: 'manager_1',
      managerUid: 'manager_1',
      season: '2026',
      createdAt: Date.now(),
      isLocked: false,
      settings: {
        entryFee: 10,
        paymentInstructions: '',
        isListedPublic: true,
        payouts: { places: [], bonuses: [] },
        maxStrikes: 0, // Sudden death
        maxRebuys: 0,
        rebuyDeadlineWeek: 4,
        rebuyCost: 10,
        pickLosersMode: false,
        autoSurviveExemptionEnabled: true
      }
    };

    it('logs no strikes if team won in standard mode', () => {
      const entry: SurvivorEntry = {
        id: 'user_1',
        poolId: 'pool_survivor',
        ownerUid: 'user_1',
        userName: 'User 1',
        status: 'ALIVE',
        strikesUsed: 0,
        rebuysUsed: 0,
        usedTeams: [],
        picks: { 1: 'KC' }, // Picked Chiefs in week 1
        exemptWeeks: [],
        submittedAt: Date.now(),
        paidStatus: 'PAID'
      };

      const res = evaluateSurvivorWeek(entry, 1, mockGames, mockPool);
      expect(res.survived).toBe(true);
      expect(res.strikeLogged).toBe(false);
    });

    it('logs strike if team lost in standard mode', () => {
      const entry: SurvivorEntry = {
        id: 'user_1',
        poolId: 'pool_survivor',
        ownerUid: 'user_1',
        userName: 'User 1',
        status: 'ALIVE',
        strikesUsed: 0,
        rebuysUsed: 0,
        usedTeams: [],
        picks: { 1: 'NYG' }, // Picked Giants (lost 28-6)
        exemptWeeks: [],
        submittedAt: Date.now(),
        paidStatus: 'PAID'
      };

      const res = evaluateSurvivorWeek(entry, 1, mockGames, mockPool);
      expect(res.survived).toBe(false);
      expect(res.strikeLogged).toBe(true);
    });

    it('logs strike if team won in inverted Pick-Loser mode', () => {
      const loserPool: NFLSurvivorPool = {
        ...mockPool,
        settings: {
          ...mockPool.settings,
          pickLosersMode: true // Objective: pick loser
        }
      };

      const entry: SurvivorEntry = {
        id: 'user_1',
        poolId: 'pool_survivor',
        ownerUid: 'user_1',
        userName: 'User 1',
        status: 'ALIVE',
        strikesUsed: 0,
        rebuysUsed: 0,
        usedTeams: [],
        picks: { 1: 'KC' }, // Chiefs won -> strike!
        exemptWeeks: [],
        submittedAt: Date.now(),
        paidStatus: 'PAID'
      };

      const res = evaluateSurvivorWeek(entry, 1, mockGames, loserPool);
      expect(res.survived).toBe(false);
      expect(res.strikeLogged).toBe(true);
    });

    it('processes auto-survive exemption if zero eligible teams remaining', () => {
      // Every team playing this week was picked in an EARLIER week (1-6), so
      // strictly-prior counting exhausts the week-7 slate and the exemption
      // fires. (PLAN-SURVIVOR-EXEMPTION-RESERVATIONS: eligibility is
      // picks-derived; a submit-time usedTeams array is no longer consulted.)
      const picks = { 1: 'KC', 2: 'NYG', 3: 'SF', 4: 'BAL', 5: 'MIN', 6: 'NYJ' };
      const isExempt = checkAutoSurviveExemption(mockGames, true, { maxTeamUses: 1, picks, week: 7 });
      expect(isExempt).toBe(true);
    });

    it('correctly transitions status to ELIMINATED when strikes limit exceeded', () => {
      const entry: SurvivorEntry = {
        id: 'user_1',
        poolId: 'pool_survivor',
        ownerUid: 'user_1',
        userName: 'User 1',
        status: 'ALIVE',
        strikesUsed: 1, // Exceeds sudden death limit (maxStrikes = 0)
        rebuysUsed: 0,
        usedTeams: [],
        picks: {},
        exemptWeeks: [],
        submittedAt: Date.now(),
        paidStatus: 'PAID'
      };

      const res = updateSurvivorStatus(entry, mockPool);
      expect(res.status).toBe('ELIMINATED');
    });
  });

  describe('Margin Scoring & Standing Cascades', () => {
    it('scores Margin selections correctly based on score differential', () => {
      const scoreKC = scoreMarginWeek('KC', mockGames); // Won 27-20 -> +7
      expect(scoreKC).toBe(7);

      const scoreBAL = scoreMarginWeek('BAL', mockGames); // Lost 20-27 -> -7
      expect(scoreBAL).toBe(-7);
    });

    it('correctly ranks leaderboard using the 5-level cascade tiebreaker', () => {
      const entries: MarginEntry[] = [
        {
          id: 'user_a',
          poolId: 'pool_margin',
          ownerUid: 'user_a',
          userName: 'User A',
          picks: {},
          usedTeams: [],
          weeklyScores: {},
          seasonTotal: 10,
          negativeBurden: 5, // Lower negative burden -> #1
          positiveWeeks: 3,
          bestWeek: 7,
          submittedAt: Date.now(),
          paidStatus: 'PAID'
        },
        {
          id: 'user_b',
          poolId: 'pool_margin',
          ownerUid: 'user_b',
          userName: 'User B',
          picks: {},
          usedTeams: [],
          weeklyScores: {},
          seasonTotal: 10,
          negativeBurden: 15, // Higher burden -> #2
          positiveWeeks: 3,
          bestWeek: 7,
          submittedAt: Date.now(),
          paidStatus: 'PAID'
        },
        {
          id: 'user_c',
          poolId: 'pool_margin',
          ownerUid: 'user_c',
          userName: 'User C',
          picks: {},
          usedTeams: [],
          weeklyScores: {},
          seasonTotal: 5, // Lower seasonTotal -> #3
          negativeBurden: 0,
          positiveWeeks: 1,
          bestWeek: 5,
          submittedAt: Date.now(),
          paidStatus: 'PAID'
        }
      ];

      const sorted = sortMarginLeaderboard(entries);
      expect(sorted[0].id).toBe('user_a');
      expect(sorted[1].id).toBe('user_b');
      expect(sorted[2].id).toBe('user_c');
    });
  });
});
