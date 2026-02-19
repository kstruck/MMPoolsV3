
import { describe, it, expect } from 'vitest';
import { calculateScore } from '../src/components/BracketPoolDashboard/bracketScoring';
import { createMockEntry, TEST_POOL_SETTINGS } from './test-utils';
import { Tournament, Game, TournamentSlot } from '../src/types';

// Helper to create a Big East 2026 structure (4 rounds, 10 games)
function createBigEastTournament(): Tournament {
    const games: Record<string, Game> = {};
    const slots: Record<string, TournamentSlot> = {};

    const startTime = new Date().toISOString();

    const createGame = (id: string, round: number, homeId: string, awayId: string): Game => ({
        id,
        startTime,
        status: 'SCHEDULED',
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeScore: 0,
        awayScore: 0,
        round,
        region: 'Conference'
    });

    // --- ROUND 1 (3 games) ---
    games['R1-CONF-1'] = createGame('R1-CONF-1', 1, 'SEED_8', 'SEED_9');
    games['R1-CONF-2'] = createGame('R1-CONF-2', 1, 'SEED_7', 'SEED_10');
    games['R1-CONF-3'] = createGame('R1-CONF-3', 1, 'SEED_6', 'SEED_11');

    // --- ROUND 2 (4 games) ---
    games['R2-CONF-1'] = createGame('R2-CONF-1', 2, 'SEED_1', 'R1-CONF-3'); // 1 v 8/9
    games['R2-CONF-2'] = createGame('R2-CONF-2', 2, 'SEED_2', 'R1-CONF-2');
    games['R2-CONF-3'] = createGame('R2-CONF-3', 2, 'SEED_3', 'R1-CONF-1');
    games['R2-CONF-4'] = createGame('R2-CONF-4', 2, 'SEED_4', 'SEED_5'); // 4 v 5

    // --- ROUND 3 (2 games) ---
    games['R3-CONF-1'] = createGame('R3-CONF-1', 3, 'R2-CONF-1', 'R2-CONF-2'); // 1/8/9 vs 4/5? No bracket logic depends on slots
    games['R3-CONF-2'] = createGame('R3-CONF-2', 3, 'R2-CONF-3', 'R2-CONF-4');

    // --- ROUND 4 (1 game) ---
    games['R4-CONF-1'] = createGame('R4-CONF-1', 4, 'R3-CONF-1', 'R3-CONF-2');

    // --- SLOTS ---
    // R1
    slots['R1-CONF-1'] = { id: 'R1-CONF-1', gameId: 'R1-CONF-1', nextSlotId: 'R2-CONF-3' };
    slots['R1-CONF-2'] = { id: 'R1-CONF-2', gameId: 'R1-CONF-2', nextSlotId: 'R2-CONF-2' };
    slots['R1-CONF-3'] = { id: 'R1-CONF-3', gameId: 'R1-CONF-3', nextSlotId: 'R2-CONF-1' };

    // QF (R2)
    slots['R2-CONF-1'] = { id: 'R2-CONF-1', gameId: 'R2-CONF-1', nextSlotId: 'R3-CONF-1' };
    slots['R2-CONF-2'] = { id: 'R2-CONF-2', gameId: 'R2-CONF-2', nextSlotId: 'R3-CONF-1' };
    slots['R2-CONF-3'] = { id: 'R2-CONF-3', gameId: 'R2-CONF-3', nextSlotId: 'R3-CONF-2' };
    slots['R2-CONF-4'] = { id: 'R2-CONF-4', gameId: 'R2-CONF-4', nextSlotId: 'R3-CONF-2' };

    // SF (R3)
    slots['R3-CONF-1'] = { id: 'R3-CONF-1', gameId: 'R3-CONF-1', nextSlotId: 'R4-CONF-1' };
    slots['R3-CONF-2'] = { id: 'R3-CONF-2', gameId: 'R3-CONF-2', nextSlotId: 'R4-CONF-1' };

    // Final (R4)
    slots['R4-CONF-1'] = { id: 'R4-CONF-1', gameId: 'R4-CONF-1', nextSlotId: null };

    return {
        id: 'bigeast-2026',
        seasonYear: 2026,
        gender: 'mens',
        isFinalized: false,
        tournamentType: 'conference',
        conferenceName: 'Big East',
        games,
        slots
    };
}

describe('Big East Conference Tournament Scoring', () => {

    it('should have 10 games total', () => {
        const t = createBigEastTournament();
        expect(Object.keys(t.games).length).toBe(10);
    });

    it('should score Round 1 correctly (seeds 6-11)', () => {
        const tournament = createBigEastTournament();

        // R1: 8 beats 9
        tournament.games['R1-CONF-1'].status = 'FINAL';
        tournament.games['R1-CONF-1'].winnerTeamId = 'SEED_8';

        // Entry picks 8
        const entry = createMockEntry('entry-1', {
            'R1-CONF-1': 'SEED_8',
            'R1-CONF-2': 'SEED_7', // whatever
            'R1-CONF-3': 'SEED_6',
            // ... other picks
        });

        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // Classic Scoring: Round 1 = 10 points
        expect(result.score).toBe(10);
    });

    it('should score Round 2 correctly (Quarterfinals)', () => {
        const tournament = createBigEastTournament();

        // R1: 8 wins (advances to play 1)
        tournament.games['R1-CONF-1'].status = 'FINAL';
        tournament.games['R1-CONF-1'].winnerTeamId = 'SEED_8';

        // R2: 1 beats 8
        tournament.games['R2-CONF-1'].homeTeamId = 'SEED_1';
        tournament.games['R2-CONF-1'].awayTeamId = 'SEED_8';
        tournament.games['R2-CONF-1'].status = 'FINAL';
        tournament.games['R2-CONF-1'].winnerTeamId = 'SEED_1';

        // Entry picked 8 in R1 (Correct) and 1 in R2 (Correct)
        const entry = createMockEntry('entry-1', {
            'R1-CONF-1': 'SEED_8',
            'R2-CONF-1': 'SEED_1'
        });

        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // R1 (10) + R2 (20) = 30
        expect(result.score).toBe(30);
    });

    it('should handle byes correctly (User picks Seed 1 in R2 without R1 pick)', () => {
        const tournament = createBigEastTournament();

        // R2: Seed 1 wins immediately (they had a bye in R1)
        tournament.games['R2-CONF-1'].homeTeamId = 'SEED_1';
        tournament.games['R2-CONF-1'].status = 'FINAL';
        tournament.games['R2-CONF-1'].winnerTeamId = 'SEED_1';

        const entry = createMockEntry('entry-bye', {
            'R2-CONF-1': 'SEED_1'
            // no R1 pick for Seed 1 required
        });

        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // Only 20 points for R2 win. No R1 points for a bye team
        expect(result.score).toBe(20);
    });

    it('should score Championship correctly (Round 4)', () => {
        const tournament = createBigEastTournament();

        // Populate a winner path for SEED_1 all the way
        tournament.games['R2-CONF-1'].winnerTeamId = 'SEED_1';
        tournament.games['R2-CONF-1'].status = 'FINAL';

        tournament.games['R3-CONF-1'].winnerTeamId = 'SEED_1';
        tournament.games['R3-CONF-1'].status = 'FINAL';

        tournament.games['R4-CONF-1'].winnerTeamId = 'SEED_1';
        tournament.games['R4-CONF-1'].status = 'FINAL';

        const entry = createMockEntry('entry-champ', {
            'R2-CONF-1': 'SEED_1', // 20
            'R3-CONF-1': 'SEED_1', // 40
            'R4-CONF-1': 'SEED_1'  // 80
        });

        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // 20 + 40 + 80 = 140
        expect(result.score).toBe(140);
    });

    it('should calculate Max Possible Score for a Conference Tournament', () => {
        const tournament = createBigEastTournament();

        // No games played yet
        // 3 R1 games x 10 = 30
        // 4 R2 games x 20 = 80
        // 2 R3 games x 40 = 80
        // 1 R4 game x 80 = 80
        // Total = 30 + 80 + 80 + 80 = 270

        const entry = createMockEntry('entry-max', {
            // R1
            'R1-CONF-1': 'SEED_8',
            'R1-CONF-2': 'SEED_7',
            'R1-CONF-3': 'SEED_6',
            // R2
            'R2-CONF-1': 'SEED_1',
            'R2-CONF-2': 'SEED_2',
            'R2-CONF-3': 'SEED_3',
            'R2-CONF-4': 'SEED_4',
            // R3
            'R3-CONF-1': 'SEED_1',
            'R3-CONF-2': 'SEED_2',
            // R4
            'R4-CONF-1': 'SEED_1'
        });

        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // Before any games played, max score should be the total available points
        expect(result.maxPossibleScore).toBe(270);
    });

});
