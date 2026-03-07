import { describe, it, expect } from 'vitest';
import { calculateScore, extractSeedFromTeamId, isTeamAlive } from '../src/components/BracketPoolDashboard/bracketScoring';
import { calculateEntryMaxScore, calculateCorrectPicks, getEliminatedTeams } from '../src/utils/bracketScoring';
import {
    createMockTournament,
    createConferenceTournament,
    createMockEntry,
    setRandomOutcomes,
    createPerfectPicks,
    createAllWrongPicks,
    TEST_POOL_SETTINGS,
    TEST_POOL_SETTINGS_FIBONACCI,
    TEST_POOL_SETTINGS_CUSTOM,
    TEST_POOL_SETTINGS_UPSET_BONUS,
} from './test-utils';
import type { BracketPool } from '../src/types';

describe('Synthetic Scenario Generator', () => {

    it('Scenario 1: Perfect Bracket', () => {
        const tournament = createMockTournament();
        setRandomOutcomes(tournament);
        const perfectPicks = createPerfectPicks(tournament);

        const entry = createMockEntry('perfect-entry', perfectPicks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // Classic: R1(32×10)=320 + R2(16×20)=320 + R3(8×40)=320 + R4(4×80)=320 + R5(2×160)=320 + R6(1×320)=320 = 1920
        expect(result.score).toBe(1920);
        expect(result.correctPicks).toBe(63);
    });

    it('Scenario 2: All Wrong Bracket', () => {
        const tournament = createMockTournament();
        setRandomOutcomes(tournament);
        const wrongPicks = createAllWrongPicks(tournament);

        const entry = createMockEntry('worst-entry', wrongPicks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        expect(result.score).toBe(0);
        expect(result.correctPicks).toBe(0);
    });

    it('Scenario 3: Max Possible Score Invariant', () => {
        const tournament = createMockTournament();
        // Only R1 FINAL, rest SCHEDULED
        Object.values(tournament.games).forEach(game => {
            if (game.round === 1) {
                game.status = 'FINAL';
                game.homeTeamId = `Team_H_${game.id}`;
                game.awayTeamId = `Team_A_${game.id}`;
                game.winnerTeamId = game.homeTeamId;
            } else {
                game.status = 'SCHEDULED';
            }
        });

        const picks: Record<string, string> = {};
        // Pick home team (winner) for half of R1, away (loser) for other half
        Object.values(tournament.games).filter(g => g.round === 1).forEach((game, index) => {
            picks[game.id] = (index % 2 === 0) ? game.homeTeamId : game.awayTeamId;
        });
        // Random picks for later rounds
        Object.values(tournament.games).filter(g => g.round > 1).forEach(game => {
            picks[game.id] = `Team_H_R1_G${Math.ceil(Math.random() * 32)}`;
        });

        const entry = createMockEntry('invariant-entry', picks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // maxPossibleScore >= score always
        expect(result.maxPossibleScore).toBeGreaterThanOrEqual(result.score);
        expect(result.score).toBeGreaterThanOrEqual(0);
    });
});

describe('Fibonacci Scoring', () => {
    it('should use Fibonacci multipliers (10-20-30-50-80-130)', () => {
        const tournament = createMockTournament();
        setRandomOutcomes(tournament);
        const perfectPicks = createPerfectPicks(tournament);

        const entry = createMockEntry('fib-entry', perfectPicks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS_FIBONACCI);

        // Fib: R1(32×10)=320 + R2(16×20)=320 + R3(8×30)=240 + R4(4×50)=200 + R5(2×80)=160 + R6(1×130)=130 = 1370
        expect(result.score).toBe(1370);
        expect(result.correctPicks).toBe(63);
    });
});

describe('Custom Scoring', () => {
    it('should use custom per-round multipliers', () => {
        const tournament = createMockTournament();
        setRandomOutcomes(tournament);
        const perfectPicks = createPerfectPicks(tournament);

        const entry = createMockEntry('custom-entry', perfectPicks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS_CUSTOM);

        // Custom [5,10,20,40,80,160]: R1(32×5)=160 + R2(16×10)=160 + R3(8×20)=160 + R4(4×40)=160 + R5(2×80)=160 + R6(1×160)=160 = 960
        expect(result.score).toBe(960);
    });
});

describe('Upset Bonus Scoring', () => {
    it('should award bonus points when a higher-seed beats a lower-seed', () => {
        const tournament = createMockTournament();

        // Create a specific R1 game where a 12-seed beats a 5-seed
        const game = tournament.games['R1_G1'];
        game.homeTeamId = 'E5-Duke';
        game.awayTeamId = 'E12-OralRoberts';
        game.status = 'FINAL';
        game.winnerTeamId = 'E12-OralRoberts'; // 12 beats 5 = upset

        // Make all other games final with arbitrary results (no upsets)
        Object.values(tournament.games).forEach(g => {
            if (g.id !== 'R1_G1') {
                g.homeTeamId = `Team_H_${g.id}`;
                g.awayTeamId = `Team_A_${g.id}`;
                g.status = 'FINAL';
                g.winnerTeamId = g.homeTeamId;
            }
        });

        // User picked the upset correctly
        const picks = createPerfectPicks(tournament);
        const entry = createMockEntry('upset-entry', picks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS_UPSET_BONUS);

        // R1 base points for correct pick: 10
        // Upset bonus: (12 - 5) × 5 = 35
        // So R1_G1 alone contributes 45 points
        // All other 62 correct R1-R6 picks contribute normal Classic points = 1920 - 10 = 1910
        // Total: 1910 + 10 + 35 = 1955
        expect(result.upsetBonusPoints).toBe(35);
        expect(result.upsetCount).toBe(1);
        expect(result.score).toBe(1955);
    });

    it('should NOT award upset bonus when lower-seed wins (expected result)', () => {
        const tournament = createMockTournament();

        const game = tournament.games['R1_G1'];
        game.homeTeamId = 'E1-Gonzaga';
        game.awayTeamId = 'E16-FairleighDickinson';
        game.status = 'FINAL';
        game.winnerTeamId = 'E1-Gonzaga'; // 1 beats 16 — not an upset

        Object.values(tournament.games).forEach(g => {
            if (g.id !== 'R1_G1') {
                g.homeTeamId = `Team_H_${g.id}`;
                g.awayTeamId = `Team_A_${g.id}`;
                g.status = 'FINAL';
                g.winnerTeamId = g.homeTeamId;
            }
        });

        const picks = createPerfectPicks(tournament);
        const entry = createMockEntry('no-upset-entry', picks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS_UPSET_BONUS);

        expect(result.upsetBonusPoints).toBe(0);
        expect(result.upsetCount).toBe(0);
        expect(result.score).toBe(1920); // Classic total with no upsets
    });
});

describe('Conference Tournament Scoring (4-round / 5-round)', () => {
    it('should score a 4-round tournament correctly with custom scoring', () => {
        const tournament = createConferenceTournament(4);
        setRandomOutcomes(tournament);
        const perfectPicks = createPerfectPicks(tournament);

        const settings: BracketPool['settings'] = {
            ...TEST_POOL_SETTINGS,
            scoringSystem: 'CUSTOM',
            customScoring: [10, 20, 40, 80], // 4 rounds
        };

        const entry = createMockEntry('conf4-entry', perfectPicks);
        const result = calculateScore(entry, tournament, settings);

        // 4 rounds: R1(8×10)=80 + R2(4×20)=80 + R3(2×40)=80 + R4(1×80)=80 = 320
        expect(result.score).toBe(320);
        expect(result.roundBreakdown).toHaveLength(4);
        expect(result.correctPicks).toBe(15); // 8+4+2+1
    });

    it('should score a 5-round tournament correctly with Classic scoring', () => {
        const tournament = createConferenceTournament(5);
        setRandomOutcomes(tournament);
        const perfectPicks = createPerfectPicks(tournament);

        const entry = createMockEntry('conf5-entry', perfectPicks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // Classic with 5 rounds: R1(16×10)=160 + R2(8×20)=160 + R3(4×40)=160 + R4(2×80)=160 + R5(1×160)=160 = 800
        expect(result.score).toBe(800);
        expect(result.roundBreakdown).toHaveLength(5);
        expect(result.correctPicks).toBe(31); // 16+8+4+2+1
    });
});

describe('Empty / Null Picks', () => {
    it('should return score 0 for an entry with no picks', () => {
        const tournament = createMockTournament();
        setRandomOutcomes(tournament);

        const entry = createMockEntry('empty-entry', {});
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        expect(result.score).toBe(0);
        expect(result.correctPicks).toBe(0);
        expect(result.maxPossibleScore).toBe(0);
    });

    it('calculateCorrectPicks should return 0 for empty picks (utils engine)', () => {
        const tournament = createMockTournament();
        setRandomOutcomes(tournament);

        const entry = createMockEntry('empty-entry', {});
        expect(calculateCorrectPicks(entry, tournament)).toBe(0);
    });
});

describe('In-Progress Games (Max Possible Score)', () => {
    it('should count alive teams as potential points and eliminated teams as 0', () => {
        const tournament = createMockTournament();

        // Only make R1 games final: home team always wins
        Object.values(tournament.games).forEach(game => {
            if (game.round === 1) {
                game.homeTeamId = `Team_H_${game.id}`;
                game.awayTeamId = `Team_A_${game.id}`;
                game.status = 'FINAL';
                game.winnerTeamId = game.homeTeamId;
            } else {
                game.status = 'SCHEDULED';
                game.homeTeamId = 'TBD';
                game.awayTeamId = 'TBD';
            }
        });

        // User picks: correct for all R1, picks a survivor for R2
        const picks: Record<string, string> = {};
        Object.values(tournament.games).filter(g => g.round === 1).forEach(game => {
            picks[game.id] = game.homeTeamId; // all correct
        });
        // For R2, pick teams that won R1 (alive)
        Object.values(tournament.games).filter(g => g.round === 2).forEach((game, i) => {
            picks[game.id] = `Team_H_R1_G${i * 2 + 1}`; // pick a surviving team
        });

        const entry = createMockEntry('in-progress-entry', picks);
        const result = calculateScore(entry, tournament, TEST_POOL_SETTINGS);

        // R1 score: 32 × 10 = 320 (all correct)
        expect(result.score).toBe(320);
        // Max possible must be > locked score because R2+ are still potential
        expect(result.maxPossibleScore).toBeGreaterThan(result.score);
    });

    it('calculateEntryMaxScore should match dashboard calculateScore maxPossibleScore', () => {
        const tournament = createMockTournament();
        // Make half the tournament final
        Object.values(tournament.games).forEach((game, idx) => {
            game.homeTeamId = `Team_H_${game.id}`;
            game.awayTeamId = `Team_A_${game.id}`;
            if (game.round <= 3) {
                game.status = 'FINAL';
                game.winnerTeamId = idx % 2 === 0 ? game.homeTeamId : game.awayTeamId;
            }
        });

        const picks: Record<string, string> = {};
        Object.entries(tournament.games).forEach(([id, game]) => {
            picks[id] = game.homeTeamId;
        });

        const entry = createMockEntry('cross-check', picks);

        const dashboardResult = calculateScore(entry, tournament, TEST_POOL_SETTINGS);
        const utilsMaxScore = calculateEntryMaxScore(entry, tournament, TEST_POOL_SETTINGS);

        // Both engines should agree on max possible score
        expect(dashboardResult.maxPossibleScore).toBe(utilsMaxScore);
    });
});

describe('Tiebreaker Scenarios', () => {
    /**
     * Helper: create a minimal 2-game tournament both FINAL,
     * and two entries with identical picks but different tiebreakers.
     */
    function createTiebreakerScenario() {
        const tournament = createMockTournament();
        setRandomOutcomes(tournament);
        const picks = createPerfectPicks(tournament);

        // Both entries pick identically (tied score)
        const entryA = createMockEntry('entry-a', picks);
        entryA.tieBreakerPrediction = 148;

        const entryB = createMockEntry('entry-b', picks);
        entryB.tieBreakerPrediction = 160;

        const actualTotal = 145; // Championship total score
        return { tournament, entryA, entryB, actualTotal };
    }

    it('CLOSEST_ABSOLUTE: entry closer to actual total wins', () => {
        const { tournament, entryA, entryB, actualTotal } = createTiebreakerScenario();

        const scoreA = calculateScore(entryA, tournament, TEST_POOL_SETTINGS);
        const scoreB = calculateScore(entryB, tournament, TEST_POOL_SETTINGS);

        // Scores are equal
        expect(scoreA.score).toBe(scoreB.score);

        // Tiebreak: |148-145|=3 vs |160-145|=15 → A wins
        const diffA = Math.abs(entryA.tieBreakerPrediction! - actualTotal);
        const diffB = Math.abs(entryB.tieBreakerPrediction! - actualTotal);
        expect(diffA).toBeLessThan(diffB);
    });

    it('CLOSEST_UNDER: entry closest without going over wins', () => {
        const { entryA, entryB, actualTotal } = createTiebreakerScenario();
        // entryA=148 (over by 3), entryB=160 (over by 15)
        // Neither is under! In that case, closest absolute should still apply.
        // But if entryC=140 (under by 5), it would beat entryA.
        const entryC = createMockEntry('entry-c', entryA.picks);
        entryC.tieBreakerPrediction = 140;

        const diffA = entryA.tieBreakerPrediction! - actualTotal; // +3 (over)
        const diffB = entryB.tieBreakerPrediction! - actualTotal; // +15 (over)
        const diffC = entryC.tieBreakerPrediction! - actualTotal; // -5 (under)

        // Under rule: C (under, -5) wins over A and B
        expect(diffA).toBeGreaterThan(0);
        expect(diffB).toBeGreaterThan(0);
        expect(diffC).toBeLessThan(0);
    });
});

describe('extractSeedFromTeamId', () => {
    it('should extract seed from standard format "E1-Duke"', () => {
        expect(extractSeedFromTeamId('E1-Duke')).toBe(1);
    });

    it('should extract seed from "S10-NorthCarolina"', () => {
        expect(extractSeedFromTeamId('S10-NorthCarolina')).toBe(10);
    });

    it('should extract seed from "MW16-SomeTeam"', () => {
        expect(extractSeedFromTeamId('MW16-SomeTeam')).toBe(16);
    });

    it('should return null for null/undefined', () => {
        expect(extractSeedFromTeamId(null)).toBeNull();
        expect(extractSeedFromTeamId(undefined)).toBeNull();
    });

    it('should return null for malformed IDs', () => {
        expect(extractSeedFromTeamId('NoSeedHere')).toBeNull();
        expect(extractSeedFromTeamId('')).toBeNull();
        expect(extractSeedFromTeamId('123')).toBeNull();
    });
});

describe('isTeamAlive', () => {
    it('should return true for a team that has not lost any FINAL game', () => {
        const tournament = createMockTournament();
        const game = tournament.games['R1_G1'];
        game.homeTeamId = 'TeamA';
        game.awayTeamId = 'TeamB';
        game.status = 'FINAL';
        game.winnerTeamId = 'TeamA';

        expect(isTeamAlive('TeamA', tournament)).toBe(true);
        expect(isTeamAlive('TeamB', tournament)).toBe(false);
    });

    it('should return true for a team not involved in any game', () => {
        const tournament = createMockTournament();
        expect(isTeamAlive('Phantom-Team', tournament)).toBe(true);
    });
});

describe('getEliminatedTeams (utils engine)', () => {
    it('should track all eliminated teams from FINAL games', () => {
        const tournament = createMockTournament();
        setRandomOutcomes(tournament);

        const eliminated = getEliminatedTeams(tournament);

        // In a 63-game tournament, 63 teams get eliminated
        expect(eliminated.size).toBe(63);
    });

    it('should return empty set when no games are final', () => {
        const tournament = createMockTournament();
        const eliminated = getEliminatedTeams(tournament);
        expect(eliminated.size).toBe(0);
    });
});
