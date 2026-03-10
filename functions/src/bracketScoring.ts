import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Tournament, BracketPool, BracketEntry } from "./types";


// Scoring Constants
const SCORING_Multipliers = {
    CLASSIC: [10, 20, 40, 80, 160, 320], // Standard X10 for readable int scores
    ESPN: [10, 20, 40, 80, 160, 320],    // Same as Classic usually
    FIBONACCI: [10, 20, 30, 50, 80, 130],
};

/**
 * Returns a Set of Team IDs that have been eliminated from the tournament.
 */
export const getEliminatedTeams = (tournament: Tournament): Set<string> => {
    const eliminated = new Set<string>();
    Object.values(tournament.games).forEach(game => {
        if (game.status === 'FINAL' && game.winnerTeamId) {
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

/**
 * Calculates current score + potential remaining points.
 */
export const calculateEntryMaxScore = (
    entry: BracketEntry,
    tournament: Tournament,
    settings: BracketPool['settings'],
    eliminatedTeams?: Set<string>
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

        if (game.status === 'FINAL') {
            if (game.winnerTeamId === pickedTeamId) {
                maxScore += points;

                if (upsetBonusEnabled) {
                    const winnerSeed = extractSeedFromTeamId(game.winnerTeamId);
                    const loserId = game.homeTeamId === game.winnerTeamId ? game.awayTeamId : game.homeTeamId;
                    const loserSeed = extractSeedFromTeamId(loserId);

                    if (winnerSeed && loserSeed && winnerSeed > loserSeed) {
                        maxScore += (winnerSeed - loserSeed) * upsetMultiplier;
                    }
                }
            }
        } else {
            if (!eliminatedTeams.has(pickedTeamId)) {
                maxScore += points;

                if (upsetBonusEnabled) {
                    const pickSeed = extractSeedFromTeamId(pickedTeamId);
                    if (pickSeed) {
                        const opponentId = game.homeTeamId === pickedTeamId ? game.awayTeamId : (game.awayTeamId === pickedTeamId ? game.homeTeamId : null);
                        if (opponentId && !eliminatedTeams!.has(opponentId)) {
                            const oppSeed = extractSeedFromTeamId(opponentId);
                            if (oppSeed && pickSeed > oppSeed) {
                                maxScore += (pickSeed - oppSeed) * upsetMultiplier;
                            }
                        } else if (!opponentId && pickSeed > 1) {
                            maxScore += (pickSeed - 1) * upsetMultiplier;
                        }
                    }
                }
            }
        }
    });

    return maxScore;
};
/**
 * Calculates score for a single entry
 */
export const calculateEntryScore = (
    entry: BracketEntry,
    tournament: Tournament,
    settings: BracketPool['settings']
): number => {
    let score = 0;
    const system = settings.scoringSystem;
    let multipliers = SCORING_Multipliers.CLASSIC;

    if (system === 'FIBONACCI') multipliers = SCORING_Multipliers.FIBONACCI;
    if (system === 'CUSTOM' && settings.customScoring && settings.customScoring.length > 0) {
        multipliers = settings.customScoring;
    }

    const upsetBonusEnabled = settings.upsetBonus?.enabled ?? false;
    const upsetMultiplier = settings.upsetBonus?.multiplier ?? 1;

    // Iterate all picks
    Object.entries(entry.picks).forEach(([slotId, pickedTeamId]) => {
        // Find Game for this slot
        const slot = tournament.slots[slotId];
        if (!slot) return;

        const game = tournament.games[slot.gameId];
        if (!game || !game.winnerTeamId) return;

        // Check if pick is correct
        if (game.winnerTeamId === pickedTeamId) {
            // Add points based on round
            // Round is 1-6. Array is 0-5.
            const roundIndex = game.round - 1;
            if (roundIndex >= 0 && roundIndex < multipliers.length) {
                score += multipliers[roundIndex];
            }

            if (upsetBonusEnabled) {
                const winnerSeed = extractSeedFromTeamId(game.winnerTeamId);
                const loserId = game.homeTeamId === game.winnerTeamId ? game.awayTeamId : game.homeTeamId;
                const loserSeed = extractSeedFromTeamId(loserId);

                if (winnerSeed && loserSeed && winnerSeed > loserSeed) {
                    score += (winnerSeed - loserSeed) * upsetMultiplier;
                }
            }
        }
    });

    return score;
};

/**
 * Internal logic to score all entries for a tournament.
 */
export const scoreTournamentEntries = async (db: admin.firestore.Firestore, tournamentId: string) => {
    const tournamentSnap = await db.collection('tournaments').doc(tournamentId).get();
    if (!tournamentSnap.exists) throw new Error('Tournament not found');

    const tournament = tournamentSnap.data() as Tournament;
    const eliminatedTeams = getEliminatedTeams(tournament);

    // Find championship to evaluate tiebreakers if finished
    const games = Object.values(tournament.games);
    const maxRound = games.reduce((max, g) => Math.max(max, g.round), 0);
    const championshipGame = games.find(g => g.round === maxRound);

    let actualTotal: number | null = null;
    if (championshipGame?.status === 'FINAL') {
        actualTotal = (championshipGame.homeScore || 0) + (championshipGame.awayScore || 0);
    }

    const poolsSnap = await db.collection('pools')
        .where('type', '==', 'BRACKET')
        .get();

    const pools = poolsSnap.docs
        .map(d => {
            const poolData = d.data() as BracketPool;
            poolData.id = d.id;
            return poolData;
        })
        .filter(p => p.tournamentId === tournamentId);

    let totalEntriesScored = 0;

    for (const pool of pools) {
        const entriesSnap = await db.collection('pools').doc(pool.id).collection('entries').get();
        if (entriesSnap.empty) continue;

        // 1. Calculate Score & Max for all
        const scoredEntries = entriesSnap.docs.map(doc => {
            const entry = doc.data() as BracketEntry;
            const newScore = calculateEntryScore(entry, tournament, pool.settings);
            const newMax = calculateEntryMaxScore(entry, tournament, pool.settings, eliminatedTeams);
            return {
                docRef: doc.ref,
                entry: { ...entry, score: newScore },
                max: newMax,
                originalEntry: entry
            };
        });

        // 2. Sort to compute Rank
        scoredEntries.sort((a, b) => {
            // Primary: Current score desc
            if (b.entry.score !== a.entry.score) return b.entry.score - a.entry.score;

            // Secondary: Max possible desc
            if (b.max !== a.max) return b.max - a.max;

            // Tiebreaker if Championship is finalized
            if (actualTotal !== null && a.entry.tieBreakerPrediction !== undefined && b.entry.tieBreakerPrediction !== undefined) {
                const diffA = a.entry.tieBreakerPrediction - actualTotal;
                const diffB = b.entry.tieBreakerPrediction - actualTotal;

                if (pool.settings.tieBreakers?.closestUnder) {
                    const aUnder = diffA <= 0;
                    const bUnder = diffB <= 0;
                    if (aUnder && !bUnder) return -1;
                    if (!aUnder && bUnder) return 1;
                    if (aUnder && bUnder) return Math.abs(diffA) - Math.abs(diffB);
                }

                return Math.abs(diffA) - Math.abs(diffB);
            }
            return 0;
        });

        // 3. Assign Ranks
        let currentRank = 1;
        scoredEntries.forEach((se, idx) => {
            if (idx > 0) {
                const prev = scoredEntries[idx - 1];
                let trulyTied = se.entry.score === prev.entry.score && se.max === prev.max;
                if (trulyTied && actualTotal !== null) {
                    if (se.entry.tieBreakerPrediction !== undefined && prev.entry.tieBreakerPrediction !== undefined) {
                        const diffSe = se.entry.tieBreakerPrediction - actualTotal;
                        const diffPrev = prev.entry.tieBreakerPrediction - actualTotal;

                        if (pool.settings.tieBreakers?.closestUnder) {
                            const seUnder = diffSe <= 0;
                            const prevUnder = diffPrev <= 0;
                            if (seUnder !== prevUnder || Math.abs(diffSe) !== Math.abs(diffPrev)) trulyTied = false;
                        } else {
                            if (Math.abs(diffSe) !== Math.abs(diffPrev)) trulyTied = false;
                        }
                    } else if (se.entry.tieBreakerPrediction !== prev.entry.tieBreakerPrediction) {
                        trulyTied = false;
                    }
                }

                if (!trulyTied) currentRank = idx + 1;
            }
            se.entry.rank = currentRank;
        });

        // 4. Batch Updates
        const updates = scoredEntries.filter(se =>
            se.entry.score !== se.originalEntry.score ||
            se.entry.rank !== se.originalEntry.rank
        );

        if (updates.length > 0) {
            let batch = db.batch();
            let batchCount = 0;

            for (const upd of updates) {
                batch.update(upd.docRef, {
                    score: upd.entry.score,
                    rank: upd.entry.rank,
                    updatedAt: Date.now()
                });
                batchCount++;
                if (batchCount >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                }
            }
            if (batchCount > 0) {
                await batch.commit();
            }
            totalEntriesScored += updates.length;
        }
    }
    return totalEntriesScored;
};

/**
 * Cloud Function to score ALL entries for a given tournament.
 */
export const scoreBracketEntries = onCall(async (request) => {
    // 1. Auth Check (Admin or System)
    if (!request.auth || request.auth.token.role !== 'ADMIN') {
        throw new HttpsError('permission-denied', 'Admin only.');
    }

    const { tournamentId } = request.data;
    if (!tournamentId) throw new HttpsError('invalid-argument', 'Missing tournamentId');

    const db = admin.firestore();
    try {
        const count = await scoreTournamentEntries(db, tournamentId);
        logger.info(`Scored ${count} entries for tournament ${tournamentId}.`);
        return { success: true, scored: count };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        logger.error(`Error scoring tournament ${tournamentId}:`, e);
        throw new HttpsError('internal', msg || 'An unknown error occurred during scoring.');
    }
});

/**
 * Cloud Function to finalize pot distribution and payouts for a completed tournament.
 */
export const finalizeTournamentPayouts = onCall(async (request) => {
    // 1. Auth Check
    if (!request.auth || request.auth.token.role !== 'ADMIN') throw new HttpsError('permission-denied', 'Admin only.');
    const { tournamentId } = request.data;
    if (!tournamentId) throw new HttpsError('invalid-argument', 'Missing tournamentId');

    const db = admin.firestore();
    const tournamentSnap = await db.collection('tournaments').doc(tournamentId).get();
    if (!tournamentSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
    const tournament = tournamentSnap.data() as Tournament;

    if (!tournament.isFinalized) {
        logger.warn(`Admin finalizing payouts for unfinalized tournament: ${tournamentId}`);
    }

    const poolsSnap = await db.collection('pools').where('type', '==', 'BRACKET').get();
    const pools = poolsSnap.docs.filter(p => (p.data() as BracketPool).tournamentId === tournamentId);

    let payoutCount = 0;

    for (const poolDoc of pools) {
        const pool = Object.assign(poolDoc.data(), { id: poolDoc.id }) as BracketPool;
        const entryFee = pool.settings?.entryFee || 0;
        if (entryFee <= 0) continue; // Free pool

        const entriesSnap = await db.collection('pools').doc(pool.id).collection('entries').get();
        if (entriesSnap.empty) continue;

        // Count entries that have paidStatus === 'PAID'
        const paidEntries = entriesSnap.docs.map(d => d.data() as BracketEntry).filter(e => e.paidStatus === 'PAID');
        const pot = paidEntries.length * entryFee;
        if (pot <= 0) continue;

        const eligibleEntries = entriesSnap.docs.map(doc => Object.assign(doc.data(), { _ref: doc.ref }) as BracketEntry & { _ref: admin.firestore.DocumentReference });

        // Group explicitly by rank (so ties are naturally array length > 1)
        const entriesByRank: Record<number, typeof eligibleEntries> = {};
        eligibleEntries.forEach(entry => {
            if (!entry.rank) return;
            if (!entriesByRank[entry.rank]) entriesByRank[entry.rank] = [];
            entriesByRank[entry.rank].push(entry);
        });

        const payouts = pool.settings.payouts?.places || [];
        if (payouts.length === 0) continue;

        let placeIndex = 0;
        let nextRank = 1;

        const winningsUpdates: { ref: admin.firestore.DocumentReference, amountWon: number }[] = [];

        while (placeIndex < payouts.length) {
            const tiedEntries = entriesByRank[nextRank] || [];
            if (tiedEntries.length === 0) {
                nextRank++;
                if (nextRank > eligibleEntries.length) break;
                continue;
            }

            const numTied = tiedEntries.length;
            let availablePercentage = 0;
            const consumedPlaces = Math.min(numTied, payouts.length - placeIndex);

            for (let i = 0; i < consumedPlaces; i++) {
                availablePercentage += payouts[placeIndex + i].percentage;
            }

            const splitPayout = (pot * (availablePercentage / 100)) / numTied;

            if (splitPayout > 0) {
                for (const entry of tiedEntries) {
                    winningsUpdates.push({ ref: entry._ref, amountWon: splitPayout });
                    payoutCount++;
                }
            }

            placeIndex += consumedPlaces;
            nextRank++;
        }

        // Apply batch updates
        if (winningsUpdates.length > 0) {
            let batch = db.batch();
            let count = 0;
            for (const upd of winningsUpdates) {
                batch.update(upd.ref, { amountWon: upd.amountWon, isWinner: true, updatedAt: Date.now() });
                count++;
                if (count >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    count = 0;
                }
            }
            if (count > 0) await batch.commit();
        }
    }

    return { success: true, payoutCount };
});
