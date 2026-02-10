
import { describe, it, expect } from 'vitest';
import { calculateScore } from '../src/components/BracketPoolDashboard/bracketScoring';
import { createMockTournament, createMockEntry, TEST_POOL_SETTINGS } from './test-utils';
import { BracketPool } from '../src/types';

describe('Bracket Scoring Engine', () => {
    it('should calculate correct score for a single correct Round 1 pick (Classic)', () => {
        const tournament = createMockTournament();

        // Setup Game R1_G1
        tournament.games['R1_G1'].homeTeamId = 'Team A';
        tournament.games['R1_G1'].awayTeamId = 'Team B';
        tournament.games['R1_G1'].status = 'FINAL';
        tournament.games['R1_G1'].winnerTeamId = 'Team A';

        // Setup Entry
        const entry = createMockEntry('entry-1', {
            'R1_G1': 'Team A'
        });

        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // Classic R1 = 10 points
        expect(result.score).toBe(10);
        expect(result.correctPicks).toBe(1);
    });

    it('should calculate 0 points for incorrect pick', () => {
        const tournament = createMockTournament();

        tournament.games['R1_G1'].status = 'FINAL';
        tournament.games['R1_G1'].winnerTeamId = 'Team A';

        const entry = createMockEntry('entry-1', {
            'R1_G1': 'Team B' // Picked loser
        });

        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        expect(result.score).toBe(0);
        expect(result.correctPicks).toBe(0);
    });

    it('should accumulate points across multiple rounds (Classic)', () => {
        const tournament = createMockTournament();

        // R1 Win
        tournament.games['R1_G1'].winnerTeamId = 'Team A';
        tournament.games['R1_G1'].status = 'FINAL';

        // R2 Win
        tournament.games['R2_G1'].winnerTeamId = 'Team A';
        tournament.games['R2_G1'].status = 'FINAL';

        const entry = createMockEntry('entry-1', {
            'R1_G1': 'Team A',
            'R2_G1': 'Team A'
        });

        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // 10 (R1) + 20 (R2) = 30
        expect(result.score).toBe(30);
        expect(result.roundBreakdown[0].points).toBe(10); // R1
        expect(result.roundBreakdown[1].points).toBe(20); // R2
    });

    it('should support Fibonacci scoring', () => {
        const tournament = createMockTournament();

        // R1 Win
        tournament.games['R1_G1'].winnerTeamId = 'Team A';
        tournament.games['R1_G1'].status = 'FINAL';

        // R2 Win
        tournament.games['R2_G1'].winnerTeamId = 'Team A';
        tournament.games['R2_G1'].status = 'FINAL';

        const entry = createMockEntry('entry-1', {
            'R1_G1': 'Team A',
            'R2_G1': 'Team A'
        });

        const fibSettings: BracketPool['settings'] = {
            ...TEST_POOL_SETTINGS,
            scoringSystem: 'FIBONACCI' // 10, 20, 30, 50, 80, 130
        };

        const result = calculateScore(entry, tournament, fibSettings);

        // 10 (R1) + 20 (R2 mock is index 1, so wait...)
        // bracketScoring.ts: ROUND_VALUES_FIBONACCI = [10, 20, 30, 50, 80, 130];
        // Round 1 is index 0 -> 10
        // Round 2 is index 1 -> 20
        // Expected: 30

        expect(result.score).toBe(30);
    });

    it('should support Custom scoring', () => {
        const tournament = createMockTournament();

        // R1 Win
        tournament.games['R1_G1'].winnerTeamId = 'Team A';
        tournament.games['R1_G1'].status = 'FINAL';

        const entry = createMockEntry('entry-1', {
            'R1_G1': 'Team A'
        });

        const customSettings: BracketPool['settings'] = {
            ...TEST_POOL_SETTINGS,
            scoringSystem: 'CUSTOM',
            customScoring: [1, 2, 3, 4, 5, 6]
        };

        const result = calculateScore(entry, tournament, customSettings);
        expect(result.score).toBe(1);
    });

    it('should calculate Max Possible Score correctly', () => {
        const tournament = createMockTournament();

        // Game 1 is FINAL, User picked CORRECT -> Points secured
        tournament.games['R1_G1'].status = 'FINAL';
        tournament.games['R1_G1'].winnerTeamId = 'Team A';
        tournament.games['R1_G1'].homeTeamId = 'Team A';
        tournament.games['R1_G1'].awayTeamId = 'Team B';

        // Game 2 is SCHEDULED (Not Started) -> Points possible if team is alive
        tournament.games['R1_G2'].status = 'SCHEDULED';
        tournament.games['R1_G2'].homeTeamId = 'Team C';
        tournament.games['R1_G2'].awayTeamId = 'Team D';

        const entry = createMockEntry('entry-1', {
            'R1_G1': 'Team A', // Correct (+10 secured)
            'R1_G2': 'Team C'  // Alive (+10 possible)
        });

        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // Score: 10
        // Max Possible: 10 (achieved) + 10 (potential) = 20
        expect(result.score).toBe(10);
        expect(result.maxPossibleScore).toBe(20);
    });

    it('should NOT count potential points for eliminated teams', () => {
        const tournament = createMockTournament();

        // User picks Team A to win the whole thing (R6_G1)

        // But Team A loses in R1
        tournament.games['R1_G1'].status = 'FINAL';
        tournament.games['R1_G1'].homeTeamId = 'Team A';
        tournament.games['R1_G1'].winnerTeamId = 'Team B'; // Team B beats A

        const entry = createMockEntry('entry-1', {
            'R1_G1': 'Team A', // Wrong (0 pts)
            'R6_G1': 'Team A'  // Picked Team A to win championship (impossible now)
        });

        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // Score: 0
        // Max Possible: 0 (Team A is dead, so R6 pick is dead)
        expect(result.score).toBe(0);
        expect(result.maxPossibleScore).toBe(0);
    });
});
