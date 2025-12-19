
import { BracketEntry, Tournament, BracketPool } from "./types";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

// Standard rounds in a 64-team bracket
// 64 -> 32 -> 16 -> 8 -> 4 -> 2 -> 1
// Rounds: 1, 2, 3, 4, 5, 6
const ROUND_VALUES_CLASSIC = [10, 20, 40, 80, 160, 320]; // ESPN Standard (10 * 2^(r-1))
// Some pools use 1, 2, 4, 8, 16, 32. We'll support configuring the base unit.

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface ScoringResult {
    score: number;
    maxPossibleScore: number; // Potential remaining points
    correctPicks: number;
}

// ----------------------------------------------------------------------------
// Scoring Logic
// ----------------------------------------------------------------------------

export function calculateScore(
    entry: BracketEntry,
    tournament: Tournament,
    settings: BracketPool['settings']
): ScoringResult {
    let totalScore = 0;
    let maxPossible = 0;
    let correctPicks = 0;

    const scoringSystem = settings.scoringSystem;
    const customRules = settings.customScoring || [10, 20, 40, 80, 160, 320];

    // Iterate through all slots in the tournament
    // We assume the tournament object has a map of slots like "R1-W1", "R2-W1", etc.
    // However, in our type definition, we have `games` and `slots`.
    // The `bracketEntries.ts` logic suggests `picks` is a map of `slotId -> teamId`.

    const allSlots = Object.values(tournament.slots);

    for (const slot of allSlots) {
        const pickedTeamId = entry.picks[slot.id];
        if (!pickedTeamId) continue; // No pick for this slot (shouldn't happen if full)

        const game = tournament.games[slot.gameId];
        if (!game) continue;

        // Determine Round Index (0-based for scoring array)
        // Round 1 (64) = Index 0
        // Round 6 (Champs) = Index 5
        // First Four (Round 0) usually disregarded or handled separately.
        const roundIndex = game.round - 1;

        if (roundIndex < 0 || roundIndex >= 6) continue; // Skip First Four or invalid rounds

        // Calculate Points Value for this Round
        let pointsValue = 0;
        if (scoringSystem === 'CLASSIC') {
            pointsValue = ROUND_VALUES_CLASSIC[roundIndex];
        } else if (scoringSystem === 'CUSTOM') {
            pointsValue = customRules[roundIndex] || 0;
        } else if (scoringSystem === 'FIBONACCI') {
            // 1, 2, 3, 5, 8, 13 ... maybe scaled?
            const fib = [1, 2, 3, 5, 8, 13];
            pointsValue = fib[roundIndex] * 10;
        }

        // Check if Game is Final
        if (game.status === 'FINAL') {
            if (game.winnerTeamId === pickedTeamId) {
                totalScore += pointsValue;
                correctPicks++;
                maxPossible += pointsValue; // You got it, so it's part of max possible
            } else {
                // You lost this pick, 0 points added to total, 0 to max possible
            }
        } else {
            // Game NOT Final.
            // Is the picked team still alive?
            // A team is alive if it hasn't lost in a previous round OR this round (if in progress).
            // Actually, simplified: If the picked team is still in the tournament or HAS NOT BEEN ELIMINATED.

            if (isTeamAlive(pickedTeamId, tournament, game.round)) {
                maxPossible += pointsValue;
            }
        }
    }

    return {
        score: totalScore,
        maxPossibleScore: maxPossible,
        correctPicks
    };
}

/**
 * Checks if a team is still eligible to win a game in a specific round.
 * A team is "alive" for a future slot if it hasn't lost any game *leading up to* that slot.
 * 
 * NOTE: This is complex because we need to know the path.
 * SIMPLIFIED: Iterate all games the team has played. If they lost any, they are out.
 * If they haven't lost, they are alive.
 */
function isTeamAlive(teamId: string, tournament: Tournament, targetRound: number): boolean {
    // Check all FINAL games where this team played.
    // If they played and were NOT the winner, they are dead.
    const allGames = Object.values(tournament.games);

    for (const game of allGames) {
        if (game.status === 'FINAL') {
            // If team played in this game
            if (game.homeTeamId === teamId || game.awayTeamId === teamId) {
                if (game.winnerTeamId !== teamId) {
                    return false; // They lost a game
                }
            }
        }
    }
    return true;
}

// ----------------------------------------------------------------------------
// Tiebreaker Logic
// ----------------------------------------------------------------------------

export function calculateTiebreakerDiff(entry: BracketEntry, tournament: Tournament): number | null {
    // Usually total points in championship game
    // Find Championship Game
    // Usually the last game or Round 6
    const championshipGame = Object.values(tournament.games).find(g => g.round === 6);

    if (!championshipGame || championshipGame.status !== 'FINAL') {
        return null; // Not ready
    }

    const actualTotal = championshipGame.homeScore + championshipGame.awayScore;
    const predictedTotal = entry.tieBreakerPrediction || 0;

    return Math.abs(actualTotal - predictedTotal);
}
