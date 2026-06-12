/**
 * Client-side bracket scoring engine.
 * Port of functions/src/scoring.ts for use in What-If Simulator,
 * Pick History, and Who to Root For calculations.
 */

import type { BracketEntry, Tournament, BracketPool, Game } from '../../types';
import { getSeedForTeam } from '../../utils/bracketScoring';

// Standard round point values
const ROUND_VALUES_CLASSIC = [10, 20, 40, 80, 160, 320];
const ROUND_VALUES_FIBONACCI = [10, 20, 30, 50, 80, 130];

export interface ScoringResult {
    score: number;
    maxPossibleScore: number;
    correctPicks: number;
    upsetBonusPoints?: number;
    upsetCount?: number;
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

const ROUND_LABELS_NCAA = ['R64', 'R32', 'S16', 'E8', 'F4', 'Champ'];
const ROUND_LABELS_CONF: Record<number, string[]> = {
    4: ['Quarterfinals', 'Semi-finals', 'Final', ''],          // 4-round conference (e.g. smaller conf)
    5: ['Round 1', 'Round 2', 'Quarterfinals', 'Semi-finals', 'Final'],     // 5-round conference (e.g. Big 12)
    10: ['Round 1', 'Quarterfinals', 'Semi-finals', 'Final'],         // Fallback
};
const ROUND_LABEL_FALLBACK = (r: number) => `R${r}`;

export function getRoundLabel(roundIndex: number, maxRound: number, isConference?: boolean): string {
    if (!isConference) {
        return ROUND_LABELS_NCAA[roundIndex] || ROUND_LABEL_FALLBACK(roundIndex + 1);
    }
    const confLabels = ROUND_LABELS_CONF[maxRound];
    if (confLabels && confLabels[roundIndex]) return confLabels[roundIndex];
    // Generic fallback for any conference size
    if (roundIndex === maxRound - 1) return 'Champ';
    if (roundIndex === maxRound - 2) return 'SF';
    if (roundIndex === maxRound - 3) return 'QF';
    return `R${roundIndex + 1}`;
}

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

export function extractSeedFromTeamId(teamId: string | undefined | null): number | null {
    if (!teamId) return null;
    // Expected format: "E1-Duke" or "S10-NorthCarolina"
    const match = teamId.match(/^[A-Za-z]+(\d+)-/);
    if (match) return parseInt(match[1], 10);
    return null;
}


export function calculateScore(
    entry: BracketEntry,
    tournament: Tournament,
    settings: BracketPool['settings']
): ScoringResult {
    let totalScore = 0;
    let maxPossible = 0;
    let correctPicks = 0;
    let upsetBonusPoints = 0;
    let upsetCount = 0;
    const roundMap = new Map<number, { correct: number; possible: number; points: number; maxPoints: number }>();

    // Determine the max round from the actual tournament data
    const maxRound = Object.values(tournament.games).reduce((max, g) => Math.max(max, g.round), 0) || 6;

    // Init rounds dynamically
    for (let r = 1; r <= maxRound; r++) {
        roundMap.set(r, { correct: 0, possible: 0, points: 0, maxPoints: 0 });
    }

    const allSlots = Object.values(tournament.slots);
    const upsetBonusEnabled = settings.upsetBonus?.enabled;
    const upsetMultiplier = settings.upsetBonus?.multiplier || 0;

    for (const slot of allSlots) {
        const pickedTeamId = entry.picks[slot.id];
        if (!pickedTeamId) continue;

        const game = tournament.games[slot.gameId];
        if (!game) continue;

        const roundIndex = game.round - 1;
        if (roundIndex < 0 || roundIndex >= maxRound) continue;

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

                // Upset Bonus Logic (Calculated on actual match outcome)
                if (upsetBonusEnabled) {
                    // Lower rank = bigger upset, so winnerSeed > loserSeed
                    const winnerSeed = getSeedForTeam(game.winnerTeamId, tournament);
                    const loserId = game.homeTeamId === game.winnerTeamId ? game.awayTeamId : game.homeTeamId;
                    const loserSeed = getSeedForTeam(loserId, tournament);

                    if (winnerSeed && loserSeed && winnerSeed > loserSeed) {
                        const bonus = (winnerSeed - loserSeed) * upsetMultiplier;
                        upsetBonusPoints += bonus;
                        totalScore += bonus;
                        maxPossible += bonus;
                        upsetCount++;
                        rd.points += bonus;
                        rd.maxPoints += bonus;
                    }
                }
            }
        } else {
            if (isTeamAlive(pickedTeamId, tournament)) {
                maxPossible += pointsValue;
                rd.maxPoints += pointsValue;

                // Max possible upset bonus (Optimistic)
                if (upsetBonusEnabled) {
                    const pickSeed = getSeedForTeam(pickedTeamId, tournament);
                    if (pickSeed) {
                        const opponentId = game.homeTeamId === pickedTeamId ? game.awayTeamId : (game.awayTeamId === pickedTeamId ? game.homeTeamId : null);
                        if (opponentId && isTeamAlive(opponentId, tournament)) {
                            // Known opponent
                            const oppSeed = getSeedForTeam(opponentId, tournament);
                            if (oppSeed && pickSeed > oppSeed) {
                                const bonus = (pickSeed - oppSeed) * upsetMultiplier;
                                maxPossible += bonus;
                                rd.maxPoints += bonus;
                            }
                        } else if (!opponentId && pickSeed > 1) {
                            // Unknown opponent - assume best case upset scenario (playing a 1 seed)
                            const bonus = (pickSeed - 1) * upsetMultiplier;
                            maxPossible += bonus;
                            rd.maxPoints += bonus;
                        }
                    }
                }
            }
        }
    }

    const roundBreakdown: RoundBreakdown[] = [];
    for (let r = 1; r <= maxRound; r++) {
        const rd = roundMap.get(r)!;
        roundBreakdown.push({
            round: r,
            label: getRoundLabel(r - 1, maxRound, tournament.tournamentType === 'conference'),
            ...rd,
        });
    }

    return { score: totalScore, maxPossibleScore: maxPossible, correctPicks, upsetBonusPoints, upsetCount, roundBreakdown };
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
