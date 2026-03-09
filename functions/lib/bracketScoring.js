"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeTournamentPayouts = exports.scoreBracketEntries = exports.scoreTournamentEntries = exports.calculateEntryScore = exports.calculateEntryMaxScore = exports.getEliminatedTeams = void 0;
exports.extractSeedFromTeamId = extractSeedFromTeamId;
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const https_1 = require("firebase-functions/v2/https");
// Scoring Constants
const SCORING_Multipliers = {
    CLASSIC: [10, 20, 40, 80, 160, 320], // Standard X10 for readable int scores
    ESPN: [10, 20, 40, 80, 160, 320], // Same as Classic usually
    FIBONACCI: [10, 20, 30, 50, 80, 130],
};
/**
 * Returns a Set of Team IDs that have been eliminated from the tournament.
 */
const getEliminatedTeams = (tournament) => {
    const eliminated = new Set();
    Object.values(tournament.games).forEach(game => {
        if (game.status === 'FINAL' && game.winnerTeamId) {
            if (game.homeTeamId === game.winnerTeamId) {
                eliminated.add(game.awayTeamId);
            }
            else if (game.awayTeamId === game.winnerTeamId) {
                eliminated.add(game.homeTeamId);
            }
        }
    });
    return eliminated;
};
exports.getEliminatedTeams = getEliminatedTeams;
function extractSeedFromTeamId(teamId) {
    if (!teamId)
        return null;
    // Expected format: "E1-Duke" or "S10-NorthCarolina"
    const match = teamId.match(/^[A-Za-z]+(\d+)-/);
    if (match)
        return parseInt(match[1], 10);
    return null;
}
/**
 * Calculates current score + potential remaining points.
 */
const calculateEntryMaxScore = (entry, tournament, settings, eliminatedTeams) => {
    var _a, _b, _c, _d;
    const system = settings.scoringSystem;
    let multipliers = SCORING_Multipliers.CLASSIC;
    if (system === 'FIBONACCI')
        multipliers = SCORING_Multipliers.FIBONACCI;
    if (system === 'CUSTOM' && settings.customScoring && settings.customScoring.length > 0) {
        multipliers = settings.customScoring;
    }
    if (!eliminatedTeams) {
        eliminatedTeams = (0, exports.getEliminatedTeams)(tournament);
    }
    const upsetBonusEnabled = (_b = (_a = settings.upsetBonus) === null || _a === void 0 ? void 0 : _a.enabled) !== null && _b !== void 0 ? _b : false;
    const upsetMultiplier = (_d = (_c = settings.upsetBonus) === null || _c === void 0 ? void 0 : _c.multiplier) !== null && _d !== void 0 ? _d : 1;
    let maxScore = 0;
    Object.entries(entry.picks).forEach(([slotId, pickedTeamId]) => {
        const slot = tournament.slots[slotId];
        if (!slot)
            return;
        const game = tournament.games[slot.gameId];
        if (!game)
            return;
        const roundIndex = game.round - 1;
        if (roundIndex < 0 || roundIndex >= multipliers.length)
            return;
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
        }
        else {
            if (!eliminatedTeams.has(pickedTeamId)) {
                maxScore += points;
                if (upsetBonusEnabled) {
                    const pickSeed = extractSeedFromTeamId(pickedTeamId);
                    if (pickSeed) {
                        const opponentId = game.homeTeamId === pickedTeamId ? game.awayTeamId : (game.awayTeamId === pickedTeamId ? game.homeTeamId : null);
                        if (opponentId && !eliminatedTeams.has(opponentId)) {
                            const oppSeed = extractSeedFromTeamId(opponentId);
                            if (oppSeed && pickSeed > oppSeed) {
                                maxScore += (pickSeed - oppSeed) * upsetMultiplier;
                            }
                        }
                        else if (!opponentId && pickSeed > 1) {
                            maxScore += (pickSeed - 1) * upsetMultiplier;
                        }
                    }
                }
            }
        }
    });
    return maxScore;
};
exports.calculateEntryMaxScore = calculateEntryMaxScore;
/**
 * Calculates score for a single entry
 */
const calculateEntryScore = (entry, tournament, settings) => {
    var _a, _b, _c, _d;
    let score = 0;
    const system = settings.scoringSystem;
    let multipliers = SCORING_Multipliers.CLASSIC;
    if (system === 'FIBONACCI')
        multipliers = SCORING_Multipliers.FIBONACCI;
    if (system === 'CUSTOM' && settings.customScoring && settings.customScoring.length > 0) {
        multipliers = settings.customScoring;
    }
    const upsetBonusEnabled = (_b = (_a = settings.upsetBonus) === null || _a === void 0 ? void 0 : _a.enabled) !== null && _b !== void 0 ? _b : false;
    const upsetMultiplier = (_d = (_c = settings.upsetBonus) === null || _c === void 0 ? void 0 : _c.multiplier) !== null && _d !== void 0 ? _d : 1;
    // Iterate all picks
    Object.entries(entry.picks).forEach(([slotId, pickedTeamId]) => {
        // Find Game for this slot
        const slot = tournament.slots[slotId];
        if (!slot)
            return;
        const game = tournament.games[slot.gameId];
        if (!game || !game.winnerTeamId)
            return;
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
exports.calculateEntryScore = calculateEntryScore;
/**
 * Internal logic to score all entries for a tournament.
 */
const scoreTournamentEntries = async (db, tournamentId) => {
    const tournamentSnap = await db.collection('tournaments').doc(tournamentId).get();
    if (!tournamentSnap.exists)
        throw new Error('Tournament not found');
    const tournament = tournamentSnap.data();
    const eliminatedTeams = (0, exports.getEliminatedTeams)(tournament);
    // Find championship to evaluate tiebreakers if finished
    const games = Object.values(tournament.games);
    const maxRound = games.reduce((max, g) => Math.max(max, g.round), 0);
    const championshipGame = games.find(g => g.round === maxRound);
    let actualTotal = null;
    if ((championshipGame === null || championshipGame === void 0 ? void 0 : championshipGame.status) === 'FINAL') {
        actualTotal = (championshipGame.homeScore || 0) + (championshipGame.awayScore || 0);
    }
    const poolsSnap = await db.collection('pools')
        .where('type', '==', 'BRACKET')
        .get();
    const pools = poolsSnap.docs
        .map(d => {
        const poolData = d.data();
        poolData.id = d.id;
        return poolData;
    })
        .filter(p => p.tournamentId === tournamentId);
    let totalEntriesScored = 0;
    for (const pool of pools) {
        const entriesSnap = await db.collection('pools').doc(pool.id).collection('bracket_entries').get();
        if (entriesSnap.empty)
            continue;
        // 1. Calculate Score & Max for all
        const scoredEntries = entriesSnap.docs.map(doc => {
            const entry = doc.data();
            const newScore = (0, exports.calculateEntryScore)(entry, tournament, pool.settings);
            const newMax = (0, exports.calculateEntryMaxScore)(entry, tournament, pool.settings, eliminatedTeams);
            return {
                docRef: doc.ref,
                entry: Object.assign(Object.assign({}, entry), { score: newScore }),
                max: newMax,
                originalEntry: entry
            };
        });
        // 2. Sort to compute Rank
        scoredEntries.sort((a, b) => {
            var _a;
            // Primary: Current score desc
            if (b.entry.score !== a.entry.score)
                return b.entry.score - a.entry.score;
            // Secondary: Max possible desc
            if (b.max !== a.max)
                return b.max - a.max;
            // Tiebreaker if Championship is finalized
            if (actualTotal !== null && a.entry.tieBreakerPrediction !== undefined && b.entry.tieBreakerPrediction !== undefined) {
                const diffA = a.entry.tieBreakerPrediction - actualTotal;
                const diffB = b.entry.tieBreakerPrediction - actualTotal;
                if ((_a = pool.settings.tieBreakers) === null || _a === void 0 ? void 0 : _a.closestUnder) {
                    const aUnder = diffA <= 0;
                    const bUnder = diffB <= 0;
                    if (aUnder && !bUnder)
                        return -1;
                    if (!aUnder && bUnder)
                        return 1;
                    if (aUnder && bUnder)
                        return Math.abs(diffA) - Math.abs(diffB);
                }
                return Math.abs(diffA) - Math.abs(diffB);
            }
            return 0;
        });
        // 3. Assign Ranks
        let currentRank = 1;
        scoredEntries.forEach((se, idx) => {
            var _a;
            if (idx > 0) {
                const prev = scoredEntries[idx - 1];
                let trulyTied = se.entry.score === prev.entry.score && se.max === prev.max;
                if (trulyTied && actualTotal !== null) {
                    if (se.entry.tieBreakerPrediction !== undefined && prev.entry.tieBreakerPrediction !== undefined) {
                        const diffSe = se.entry.tieBreakerPrediction - actualTotal;
                        const diffPrev = prev.entry.tieBreakerPrediction - actualTotal;
                        if ((_a = pool.settings.tieBreakers) === null || _a === void 0 ? void 0 : _a.closestUnder) {
                            const seUnder = diffSe <= 0;
                            const prevUnder = diffPrev <= 0;
                            if (seUnder !== prevUnder || Math.abs(diffSe) !== Math.abs(diffPrev))
                                trulyTied = false;
                        }
                        else {
                            if (Math.abs(diffSe) !== Math.abs(diffPrev))
                                trulyTied = false;
                        }
                    }
                    else if (se.entry.tieBreakerPrediction !== prev.entry.tieBreakerPrediction) {
                        trulyTied = false;
                    }
                }
                if (!trulyTied)
                    currentRank = idx + 1;
            }
            se.entry.rank = currentRank;
        });
        // 4. Batch Updates
        const updates = scoredEntries.filter(se => se.entry.score !== se.originalEntry.score ||
            se.entry.rank !== se.originalEntry.rank);
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
exports.scoreTournamentEntries = scoreTournamentEntries;
/**
 * Cloud Function to score ALL entries for a given tournament.
 */
exports.scoreBracketEntries = (0, https_1.onCall)(async (request) => {
    // 1. Auth Check (Admin or System)
    if (!request.auth || request.auth.token.role !== 'ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'Admin only.');
    }
    const { tournamentId } = request.data;
    if (!tournamentId)
        throw new https_1.HttpsError('invalid-argument', 'Missing tournamentId');
    const db = admin.firestore();
    try {
        const count = await (0, exports.scoreTournamentEntries)(db, tournamentId);
        logger.info(`Scored ${count} entries for tournament ${tournamentId}.`);
        return { success: true, scored: count };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        logger.error(`Error scoring tournament ${tournamentId}:`, e);
        throw new https_1.HttpsError('internal', msg || 'An unknown error occurred during scoring.');
    }
});
/**
 * Cloud Function to finalize pot distribution and payouts for a completed tournament.
 */
exports.finalizeTournamentPayouts = (0, https_1.onCall)(async (request) => {
    var _a, _b;
    // 1. Auth Check
    if (!request.auth || request.auth.token.role !== 'ADMIN')
        throw new https_1.HttpsError('permission-denied', 'Admin only.');
    const { tournamentId } = request.data;
    if (!tournamentId)
        throw new https_1.HttpsError('invalid-argument', 'Missing tournamentId');
    const db = admin.firestore();
    const tournamentSnap = await db.collection('tournaments').doc(tournamentId).get();
    if (!tournamentSnap.exists)
        throw new https_1.HttpsError('not-found', 'Tournament not found');
    const tournament = tournamentSnap.data();
    if (!tournament.isFinalized) {
        logger.warn(`Admin finalizing payouts for unfinalized tournament: ${tournamentId}`);
    }
    const poolsSnap = await db.collection('pools').where('type', '==', 'BRACKET').get();
    const pools = poolsSnap.docs.filter(p => p.data().tournamentId === tournamentId);
    let payoutCount = 0;
    for (const poolDoc of pools) {
        const pool = Object.assign(poolDoc.data(), { id: poolDoc.id });
        const entryFee = ((_a = pool.settings) === null || _a === void 0 ? void 0 : _a.entryFee) || 0;
        if (entryFee <= 0)
            continue; // Free pool
        const entriesSnap = await db.collection('pools').doc(pool.id).collection('bracket_entries').get();
        if (entriesSnap.empty)
            continue;
        // Count entries that have paidStatus === 'PAID'
        const paidEntries = entriesSnap.docs.map(d => d.data()).filter(e => e.paidStatus === 'PAID');
        const pot = paidEntries.length * entryFee;
        if (pot <= 0)
            continue;
        const eligibleEntries = entriesSnap.docs.map(doc => Object.assign(doc.data(), { _ref: doc.ref }));
        // Group explicitly by rank (so ties are naturally array length > 1)
        const entriesByRank = {};
        eligibleEntries.forEach(entry => {
            if (!entry.rank)
                return;
            if (!entriesByRank[entry.rank])
                entriesByRank[entry.rank] = [];
            entriesByRank[entry.rank].push(entry);
        });
        const payouts = ((_b = pool.settings.payouts) === null || _b === void 0 ? void 0 : _b.places) || [];
        if (payouts.length === 0)
            continue;
        let placeIndex = 0;
        let nextRank = 1;
        const winningsUpdates = [];
        while (placeIndex < payouts.length) {
            const tiedEntries = entriesByRank[nextRank] || [];
            if (tiedEntries.length === 0) {
                nextRank++;
                if (nextRank > eligibleEntries.length)
                    break;
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
            if (count > 0)
                await batch.commit();
        }
    }
    return { success: true, payoutCount };
});
//# sourceMappingURL=bracketScoring.js.map