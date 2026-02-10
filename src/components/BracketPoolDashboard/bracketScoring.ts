/**
 * Client-side bracket scoring engine.
 * Port of functions/src/scoring.ts for use in What-If Simulator,
 * Pick History, and Who to Root For calculations.
 */

import type { BracketEntry, Tournament, BracketPool, Game } from '../../types';

// Standard round point values
const ROUND_VALUES_CLASSIC = [10, 20, 40, 80, 160, 320];
const ROUND_VALUES_FIBONACCI = [10, 20, 30, 50, 80, 130];

export interface ScoringResult {
    score: number;
    maxPossibleScore: number;
    correctPicks: number;
    /** Per-round breakdown: { round: number, correct: number, possible: number, points: number } */
    roundBreakdown: RoundBreakdown[];
}

export interface RoundBreakdown {
    round: number; // 1-6
    label: string; // "R64", "R32", etc.
    correct: number;
    possible: number; // total games decided in this round
    points: number;
    maxPoints: number;
}

const ROUND_LABELS = ['R64', 'R32', 'S16', 'E8', 'F4', 'Champ'];

export function getPointsForRound(
    roundIndex: number,
    settings: BracketPool['settings']
): number {
    const { scoringSystem, customScoring } = settings;
    if (scoringSystem === 'CLASSIC' || scoringSystem === 'ESPN') {
        return ROUND_VALUES_CLASSIC[roundIndex] || 0;
    } else if (scoringSystem === 'FIBONACCI') {
        return ROUND_VALUES_FIBONACCI[roundIndex] || 0;
    } else if (scoringSystem === 'CUSTOM') {
        return (customScoring || ROUND_VALUES_CLASSIC)[roundIndex] || 0;
    }
    return 0;
}

export function isTeamAlive(teamId: string, tournament: Tournament): boolean {
    const allGames = Object.values(tournament.games);
    for (const game of allGames) {
        if (game.status === 'FINAL') {
            if (game.homeTeamId === teamId || game.awayTeamId === teamId) {
                if (game.winnerTeamId !== teamId) {
                    return false;
                }
            }
        }
    }
    return true;
}

export function calculateScore(
    entry: BracketEntry,
    tournament: Tournament,
    settings: BracketPool['settings']
): ScoringResult {
    let totalScore = 0;
    let maxPossible = 0;
    let correctPicks = 0;
    const roundMap = new Map<number, { correct: number; possible: number; points: number; maxPoints: number }>();

    // Init rounds
    for (let r = 1; r <= 6; r++) {
        roundMap.set(r, { correct: 0, possible: 0, points: 0, maxPoints: 0 });
    }

    const allSlots = Object.values(tournament.slots);

    for (const slot of allSlots) {
        const pickedTeamId = entry.picks[slot.id];
        if (!pickedTeamId) continue;

        const game = tournament.games[slot.gameId];
        if (!game) continue;

        const roundIndex = game.round - 1;
        if (roundIndex < 0 || roundIndex >= 6) continue;

        const pointsValue = getPointsForRound(roundIndex, settings);
        const rd = roundMap.get(game.round)!;

        if (game.status === 'FINAL') {
            rd.possible++;
            if (game.winnerTeamId === pickedTeamId) {
                totalScore += pointsValue;
                correctPicks++;
                maxPossible += pointsValue;
                rd.correct++;
                rd.points += pointsValue;
                rd.maxPoints += pointsValue;
            }
        } else {
            if (isTeamAlive(pickedTeamId, tournament)) {
                maxPossible += pointsValue;
                rd.maxPoints += pointsValue;
            }
        }
    }

    const roundBreakdown: RoundBreakdown[] = [];
    for (let r = 1; r <= 6; r++) {
        const rd = roundMap.get(r)!;
        roundBreakdown.push({
            round: r,
            label: ROUND_LABELS[r - 1],
            ...rd,
        });
    }

    return { score: totalScore, maxPossibleScore: maxPossible, correctPicks, roundBreakdown };
}

/**
 * Simulate a "what-if" scenario: given hypothetical winners for undecided games,
 * calculate the resulting score for an entry.
 */
export function calculateWhatIfScore(
    entry: BracketEntry,
    tournament: Tournament,
    settings: BracketPool['settings'],
    hypotheticalWinners: Record<string, string> // gameId -> hypothetical winnerId
): ScoringResult {
    // Create a virtual tournament with hypothetical outcomes merged
    const virtualGames: Record<string, Game> = {};
    for (const [id, game] of Object.entries(tournament.games)) {
        if (game.status !== 'FINAL' && hypotheticalWinners[id]) {
            virtualGames[id] = { ...game, status: 'FINAL', winnerTeamId: hypotheticalWinners[id] };
        } else {
            virtualGames[id] = game;
        }
    }
    const virtualTournament: Tournament = { ...tournament, games: virtualGames };
    return calculateScore(entry, virtualTournament, settings);
}

/**
 * For "Who to Root For": calculate how each outcome of a game affects the user's rank.
 */
export interface RootForResult {
    game: Game;
    homeWinImpact: { score: number; rank: number; rankChange: number };
    awayWinImpact: { score: number; rank: number; rankChange: number };
}

export function calculateRootForResults(
    userEntry: BracketEntry,
    allEntries: BracketEntry[],
    tournament: Tournament,
    settings: BracketPool['settings']
): RootForResult[] {
    const results: RootForResult[] = [];

    // Find games that are not yet final
    const undecidedGames = Object.values(tournament.games).filter(g => g.status !== 'FINAL');

    // Current standings
    const currentScores = allEntries.map(e => ({
        id: e.id,
        score: calculateScore(e, tournament, settings).score,
    }));
    const currentRank = getRank(userEntry.id, currentScores);

    for (const game of undecidedGames) {
        if (!game.homeTeamId || !game.awayTeamId) continue;

        // Sim: home wins
        const homeResults = allEntries.map(e => ({
            id: e.id,
            score: calculateWhatIfScore(e, tournament, settings, { [game.id]: game.homeTeamId }).score,
        }));
        const homeRank = getRank(userEntry.id, homeResults);
        const homeUserScore = homeResults.find(r => r.id === userEntry.id)?.score || 0;

        // Sim: away wins
        const awayResults = allEntries.map(e => ({
            id: e.id,
            score: calculateWhatIfScore(e, tournament, settings, { [game.id]: game.awayTeamId }).score,
        }));
        const awayRank = getRank(userEntry.id, awayResults);
        const awayUserScore = awayResults.find(r => r.id === userEntry.id)?.score || 0;

        results.push({
            game,
            homeWinImpact: { score: homeUserScore, rank: homeRank, rankChange: currentRank - homeRank },
            awayWinImpact: { score: awayUserScore, rank: awayRank, rankChange: currentRank - awayRank },
        });
    }

    // Sort: biggest impact first
    results.sort((a, b) => {
        const aMax = Math.max(Math.abs(a.homeWinImpact.rankChange), Math.abs(a.awayWinImpact.rankChange));
        const bMax = Math.max(Math.abs(b.homeWinImpact.rankChange), Math.abs(b.awayWinImpact.rankChange));
        return bMax - aMax;
    });

    return results;
}

function getRank(entryId: string, scores: { id: string; score: number }[]): number {
    const sorted = [...scores].sort((a, b) => b.score - a.score);
    return sorted.findIndex(s => s.id === entryId) + 1;
}
