import { describe, it, expect } from 'vitest';
import { calculateEntryMaxScore, getEliminatedTeams } from '../src/utils/bracketScoring';
import { calculateEntryScore } from '../functions/src/bracketScoring';
import type { BracketEntry, BracketPool, Tournament } from '../src/types';

describe('Bracket Scoring Edge Cases', () => {

    // Helper functions to mock tournament data
    const createMockTournament = (): Tournament => ({
        id: 'mens-2024',
        seasonYear: 2024,
        tournamentType: 'ncaa',
        gender: 'mens',
        status: 'ACTIVE',
        isFinalized: false,
        lockAt: 0,
        games: {
            'game1': { id: 'game1', round: 1, status: 'FINAL', homeTeamId: 'team1', awayTeamId: 'team2', homeScore: 10, awayScore: 5, winnerTeamId: 'team1', startTime: '' },
            'game2': { id: 'game2', round: 1, status: 'FINAL', homeTeamId: 'team3', awayTeamId: 'team4', homeScore: 5, awayScore: 10, winnerTeamId: 'team4', startTime: '' },
            'game3': { id: 'game3', round: 2, status: 'IN_PROGRESS', homeTeamId: 'team1', awayTeamId: 'team4', homeScore: 0, awayScore: 0, startTime: '' },
        },
        slots: {
            'slot1': { id: 'slot1', gameId: 'game1' },
            'slot2': { id: 'slot2', gameId: 'game2' },
            'slot3': { id: 'slot3', gameId: 'game3' }
        }
    });

    const createMockSettings = (system: 'CLASSIC' | 'FIBONACCI' | 'CUSTOM' = 'CLASSIC', customScoring?: number[]): BracketPool['settings'] => ({
        maxEntriesTotal: -1,
        maxEntriesPerUser: -1,
        entryFee: 0,
        paymentInstructions: '',
        scoringSystem: system,
        customScoring: customScoring,
        tieBreakers: { closestAbsolute: true, closestUnder: false },
        payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] }
    });

    describe('Eliminated Teams Logic', () => {
        it('identifies losers as eliminated', () => {
            const tournament = createMockTournament();
            const eliminated = getEliminatedTeams(tournament);
            expect(eliminated.has('team2')).toBe(true); // Lost game1
            expect(eliminated.has('team3')).toBe(true); // Lost game2
            expect(eliminated.has('team1')).toBe(false); // Won game1
            expect(eliminated.has('team4')).toBe(false); // Won game2
        });

        it('ignores IN_PROGRESS games for elimination', () => {
            const tournament = createMockTournament();
            const eliminated = getEliminatedTeams(tournament);
            expect(eliminated.has('team1')).toBe(false); // In progress in game3
        });
    });

    describe('Calculate Entry Score (Current Score)', () => {
        it('calculates standard classic scoring correctly', () => {
            const tournament = createMockTournament();
            const settings = createMockSettings('CLASSIC');
            const entry: BracketEntry = {
                id: '1', poolId: 'pool1', ownerUid: 'user', name: 'user', picks: {
                    'slot1': 'team1', // Correct (Round 1 -> 10 pts)
                    'slot2': 'team3', // Incorrect (Picked loser)
                },
                score: 0,
                status: 'SUBMITTED',
                paidStatus: 'PAID',
                createdAt: 0,
                updatedAt: 0,
            };

            // Calculate backend current score
            const score = calculateEntryScore(entry, tournament as unknown as import('../functions/src/types').Tournament, settings);
            expect(score).toBe(10); // 10 points for R1 correct pick
        });

        it('calculates custom scoring length correctly', () => {
            const tournament = createMockTournament();
            const settings = createMockSettings('CUSTOM', [5, 15, 30, 60, 100, 200]);
            const entry: BracketEntry = {
                id: '1', poolId: 'pool1', ownerUid: 'user', name: 'user', picks: {
                    'slot1': 'team1', // Correct Round 1
                },
                score: 0,
                status: 'SUBMITTED',
                paidStatus: 'PAID',
                createdAt: 0,
                updatedAt: 0,
            };

            const score = calculateEntryScore(entry, tournament as unknown as import('../functions/src/types').Tournament, settings);
            expect(score).toBe(5); // 5 points based on custom array index 0
        });

        it('safely ignores out of bound rounds in array', () => {
            const tournament = createMockTournament();
            // Modify game to simulate Round 7 (should not exist but testing array limits)
            tournament.games['game1'].round = 7;
            const settings = createMockSettings('CLASSIC'); // Array has 6 elements (0-5)
            const entry: BracketEntry = {
                id: '1', poolId: 'pool1', ownerUid: 'user', name: 'user', picks: { 'slot1': 'team1' },
                score: 0, status: 'SUBMITTED', paidStatus: 'PAID', createdAt: 0, updatedAt: 0
            };

            const score = calculateEntryScore(entry, tournament as unknown as import('../functions/src/types').Tournament, settings);
            expect(score).toBe(0); // Safely ignores without exception
        });
    });

    describe('Calculate Max Possible Score (Frontend tiebreaker auxiliary)', () => {
        it('grants points if game is final and picked correctly', () => {
            const tournament = createMockTournament();
            const settings = createMockSettings('CLASSIC');
            const entry: BracketEntry = {
                id: '1', poolId: 'pool1', ownerUid: 'user', name: 'user', picks: {
                    'slot1': 'team1', // Correct, game1 is final -> +10
                }, score: 0, status: 'SUBMITTED', paidStatus: 'PAID', createdAt: 0, updatedAt: 0
            };

            const max = calculateEntryMaxScore(entry, tournament, settings);
            expect(max).toBe(10);
        });

        it('grants 0 points if game is final and picked incorrectly', () => {
            const tournament = createMockTournament();
            const settings = createMockSettings('CLASSIC');
            const entry: BracketEntry = {
                id: '1', poolId: 'pool1', ownerUid: 'user', name: 'user', picks: {
                    'slot1': 'team2', // Incorrect, game1 is final
                }, score: 0, status: 'SUBMITTED', paidStatus: 'PAID', createdAt: 0, updatedAt: 0
            };

            const max = calculateEntryMaxScore(entry, tournament, settings);
            expect(max).toBe(0);
        });

        it('grants potential points if game is pending and team is ALIVE', () => {
            const tournament = createMockTournament();
            const settings = createMockSettings('CLASSIC');
            const entry: BracketEntry = {
                id: '1', poolId: 'pool1', ownerUid: 'user', name: 'user', picks: {
                    'slot3': 'team1', // R2 game IN_PROGRESS. team1 is ALIVE
                }, score: 0, status: 'SUBMITTED', paidStatus: 'PAID', createdAt: 0, updatedAt: 0
            };

            const max = calculateEntryMaxScore(entry, tournament, settings);
            expect(max).toBe(20); // 20 pts for round 2
        });

        it('grants 0 potential points if game is pending but picked team is ELIMINATED', () => {
            const tournament = createMockTournament();
            const settings = createMockSettings('CLASSIC');
            const entry: BracketEntry = {
                id: '1', poolId: 'pool1', ownerUid: 'user', name: 'user', picks: {
                    'slot3': 'team2', // R2 game IN_PROGRESS, but team2 lost game1 and is ELIMINATED
                }, score: 0, status: 'SUBMITTED', paidStatus: 'PAID', createdAt: 0, updatedAt: 0
            };

            const max = calculateEntryMaxScore(entry, tournament, settings);
            expect(max).toBe(0); // Eliminated team gets 0 potential points
        });
    });
});
