import type { Tournament, BracketEntry, BracketPool } from '../types';

export const SCORING_Multipliers = {
    CLASSIC: [10, 20, 40, 80, 160, 320],
    ESPN: [10, 20, 40, 80, 160, 320],
    FIBONACCI: [10, 20, 30, 50, 80, 130],
};

/**
 * Returns a Set of Team IDs that have been eliminated from the tournament.
 * A team is eliminated if it played in a game and LOST.
 */
export const getEliminatedTeams = (tournament: Tournament): Set<string> => {
    const eliminated = new Set<string>();

    Object.values(tournament.games).forEach(game => {
        if (game.status === 'FINAL' && game.winnerTeamId) {
            // The loser is eliminated
            if (game.homeTeamId === game.winnerTeamId) {
                eliminated.add(game.awayTeamId);
            } else if (game.awayTeamId === game.winnerTeamId) {
                eliminated.add(game.homeTeamId);
            }
        }
    });

    return eliminated;
};

export function extractSeedFromTeamId(teamId: string | undefined | null): number | null {
    if (!teamId) return null;
    // Expected format: "E1-Duke" or "S10-NorthCarolina"
    const match = teamId.match(/^[A-Za-z]+(\d+)-/);
    if (match) return parseInt(match[1], 10);
    return null;
}

export function getSeedForTeam(teamId: string | undefined | null, tournament: Tournament): number | null {
    if (!teamId) return null;
    const seed = tournament.importedTeams?.[teamId]?.seed;
    if (typeof seed === 'number' && seed > 0) return seed;
    return extractSeedFromTeamId(teamId);
}

/**
 * Calculates current score + potential remaining points.
 */
export const calculateEntryMaxScore = (
    entry: BracketEntry,
    tournament: Tournament,
    settings: BracketPool['settings'],
    eliminatedTeams?: Set<string> // Optimization: pass if already calculated
): number => {
    const system = settings.scoringSystem;
    let multipliers = SCORING_Multipliers.CLASSIC;

    if (system === 'FIBONACCI') multipliers = SCORING_Multipliers.FIBONACCI;
    if (system === 'CUSTOM' && settings.customScoring && settings.customScoring.length > 0) {
        multipliers = settings.customScoring;
    }

    if (!eliminatedTeams) {
        eliminatedTeams = getEliminatedTeams(tournament);
    }

    const upsetBonusEnabled = settings.upsetBonus?.enabled ?? false;
    const upsetMultiplier = settings.upsetBonus?.multiplier ?? 1;

    let maxScore = 0;

    Object.entries(entry.picks).forEach(([slotId, pickedTeamId]) => {
        const slot = tournament.slots[slotId];
        if (!slot) return;

        const game = tournament.games[slot.gameId];
        if (!game) return;

        const roundIndex = game.round - 1;
        if (roundIndex < 0 || roundIndex >= multipliers.length) return;

        const points = multipliers[roundIndex];

        // Case 1: Game Final
        if (game.status === 'FINAL') {
            if (game.winnerTeamId === pickedTeamId) {
                maxScore += points; // Won

                if (upsetBonusEnabled) {
                    const winnerSeed = getSeedForTeam(game.winnerTeamId, tournament);
                    const loserId = game.homeTeamId === game.winnerTeamId ? game.awayTeamId : game.homeTeamId;
                    const loserSeed = getSeedForTeam(loserId, tournament);

                    if (winnerSeed && loserSeed && winnerSeed > loserSeed) {
                        maxScore += (winnerSeed - loserSeed) * upsetMultiplier;
                    }
                }
            }
            // Else lost -> 0
        }
        // Case 2: Game Pending/Active
        else {
            // Check if team is still alive
            if (!eliminatedTeams.has(pickedTeamId)) {
                maxScore += points; // Potential

                if (upsetBonusEnabled) {
                    const pickSeed = getSeedForTeam(pickedTeamId, tournament);
                    if (pickSeed) {
                        const opponentId = game.homeTeamId === pickedTeamId ? game.awayTeamId : (game.awayTeamId === pickedTeamId ? game.homeTeamId : null);
                        if (opponentId && !eliminatedTeams!.has(opponentId)) {
                            const oppSeed = getSeedForTeam(opponentId, tournament);
                            if (oppSeed && pickSeed > oppSeed) {
                                maxScore += (pickSeed - oppSeed) * upsetMultiplier;
                            }
                        } else if (!opponentId && pickSeed > 1) {
                            maxScore += (pickSeed - 1) * upsetMultiplier;
                        }
                    }
                }
            }
            // Else eliminated -> 0
        }
    });

    return maxScore;
};

/**
 * Calculates the total number of correct picks for an entry.
 */
export const calculateCorrectPicks = (entry: BracketEntry, tournament: Tournament): number => {
    let correct = 0;
    if (!entry.picks) return 0;

    Object.entries(entry.picks).forEach(([slotId, pickedTeamId]) => {
        const slot = tournament.slots[slotId];
        if (!slot) return;

        const game = tournament.games[slot.gameId];
        if (!game || game.status !== 'FINAL') return;

        if (game.winnerTeamId === pickedTeamId) {
            correct++;
        }
    });
    return correct;
};
