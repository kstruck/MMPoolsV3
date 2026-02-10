import { describe, it, expect } from 'vitest';
import { calculateScore } from '../src/components/BracketPoolDashboard/bracketScoring';
import { createMockTournament, createMockEntry, TEST_POOL_SETTINGS } from './test-utils';
import { Tournament } from '../src/types';

describe('Synthetic Scenario Generator', () => {

    // Helper to generate random outcomes
    const setRandomOutcomes = (tournament: Tournament) => {
        Object.values(tournament.games).forEach(game => {
            const isWinnerHome = Math.random() > 0.5;
            game.status = 'FINAL';
            // Set home/away teams if TBD (mock default)
            // Ideally we'd assign real IDs but for checking invariants, consistency is key
            if (game.homeTeamId === 'TBD') game.homeTeamId = `Team_H_${game.id}`;
            if (game.awayTeamId === 'TBD') game.awayTeamId = `Team_A_${game.id}`;

            game.winnerTeamId = isWinnerHome ? game.homeTeamId : game.awayTeamId;
            tournament.games[game.id] = game;
        });
    };

    // Helper to generate random picks
    const generateRandomPicks = (tournament: Tournament): Record<string, string> => {
        const picks: Record<string, string> = {};
        Object.values(tournament.games).forEach(game => {
            // Pick either home or away (even if TBD, we just need a string ID)
            // Note: In a real bracket, you pick winners of previous games.
            // For scoring engine, it just matches `pickedTeamId` vs `winnerTeamId`.
            // So we can pick "Team_H_R1_G1" or "Team_A_R1_G1".
            // If TBD, we generate IDs consistent with setRandomOutcomes.
            const homeId = game.homeTeamId === 'TBD' ? `Team_H_${game.id}` : game.homeTeamId;
            const awayId = game.awayTeamId === 'TBD' ? `Team_A_${game.id}` : game.awayTeamId;
            picks[game.id] = Math.random() > 0.5 ? homeId : awayId;
        });
        return picks;
    };

    it('Scenario 1: Perfect Bracket', () => {
        const tournament = createMockTournament();
        setRandomOutcomes(tournament); // Set winners

        // User picks winners exactly
        const perfectPicks: Record<string, string> = {};
        Object.values(tournament.games).forEach(game => {
            perfectPicks[game.id] = game.winnerTeamId!;
        });

        const entry = createMockEntry('perfect-entry', perfectPicks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // Calculate expected max score for Classic
        // R1 (32 games * 10) = 320
        // R2 (16 games * 20) = 320
        // R3 (8 games * 40) = 320
        // R4 (4 games * 80) = 320
        // R5 (2 games * 160) = 320
        // R6 (1 game * 320) = 320
        // Total = 1920
        expect(result.score).toBe(1920);
        expect(result.correctPicks).toBe(63);
    });

    it('Scenario 2: All Wrong Bracket', () => {
        const tournament = createMockTournament();
        setRandomOutcomes(tournament);

        // User picks loser for every game
        const wrongPicks: Record<string, string> = {};
        Object.values(tournament.games).forEach(game => {
            wrongPicks[game.id] = (game.winnerTeamId === game.homeTeamId) ? game.awayTeamId : game.homeTeamId;
        });

        const entry = createMockEntry('worst-entry', wrongPicks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        expect(result.score).toBe(0);
        expect(result.correctPicks).toBe(0);
    });

    it('Scenario 3: Max Possible Score Invariant', () => {
        const tournament = createMockTournament();
        // Partially complete tournament
        // Only Round 1 is FINAL
        Object.values(tournament.games).forEach(game => {
            if (game.round === 1) {
                game.status = 'FINAL';
                game.homeTeamId = `Team_H_${game.id}`;
                game.awayTeamId = `Team_A_${game.id}`;
                game.winnerTeamId = game.homeTeamId; // Home always wins R1
            } else {
                game.status = 'SCHEDULED';
                // Future games don't have teams yet in this mock, but 'isTeamAlive' checks finalized games.
                // If a game is scheduled, any pick is potentially alive unless eliminated in a previous round.
                // In our mock, if R1 is done, teams not winning R1 are eliminated.
                // But `isTeamAlive` creates a graph? No, `isTeamAlive` iterates FINAL games.
                // So if R1 is final, and I picked a team that lost R1, `isTeamAlive` says false.
                // If I picked a winner of R1, `isTeamAlive` says true.
            }
        });

        // Create picks
        // For future rounds, we can use our helper to generate random picks for everything else

        // Merge R1 specific logic with random picks for others

        // Ensure R1 picks override random ones if we want specific logic there, 
        // but 'picks' object will contain R1 keys already. 'randomPicks' has ALL keys.
        // So let's just use generateRandomPicks for everything and override R1?
        // Or deeper: user picks for R1 games matter for "Score".
        // User picks for R2+ matter for "Max Possible".

        // Let's simplify: Use generateRandomPicks for base, then override R1 to be mixed.
        const mergedPicks = { ...generateRandomPicks(tournament) };

        // Override R1 to ensure some wins/losses
        Object.values(tournament.games).filter(g => g.round === 1).forEach((game, index) => {
            // First half correct, second half wrong
            mergedPicks[game.id] = (index % 2 === 0) ? game.homeTeamId : game.awayTeamId;
        });

        const entry = createMockEntry('invariant-entry', mergedPicks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // Invariant: Score + Remaining Potential = Max Possible
        // Wait, `maxPossibleScore` in `ScoringResult` IS the sum of locked points + potential points.
        // So `maxPossibleScore` >= `score`.
        expect(result.maxPossibleScore).toBeGreaterThanOrEqual(result.score);

        // Also: score can never be negative
        expect(result.score).toBeGreaterThanOrEqual(0);
    });
});
