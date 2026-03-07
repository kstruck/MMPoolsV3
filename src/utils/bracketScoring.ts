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

    let maxScore = 0;

    // Iterate all picks
    // Wait, we need to iterate all ROUNDS/GAMES possible for this entry.
    // An entry picks a team for a specific SLOT.

    // For each configured slot in the tournament:
    // If the user picked a team for this slot:
    //   1. Check if that game is already decided.
    //      - If decided and user won: +Points
    //      - If decided and user lost: +0
    //   2. If game NOT decided:
    //      - Check if user's pick is ELIMINATED.
    //      - If NOT eliminated: +Points (Potential)

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
            }
            // Else lost -> 0
        }
        // Case 2: Game Pending/Active
        else {
            // Check if team is still alive
            if (!eliminatedTeams.has(pickedTeamId)) {
                maxScore += points; // Potential
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
