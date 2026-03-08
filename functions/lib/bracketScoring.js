"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreBracketEntries = exports.scoreTournamentEntries = exports.calculateEntryScore = void 0;
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
 * Calculates score for a single entry
 */
const calculateEntryScore = (entry, tournament, settings) => {
    let score = 0;
    const system = settings.scoringSystem;
    let multipliers = SCORING_Multipliers.CLASSIC;
    if (system === 'FIBONACCI')
        multipliers = SCORING_Multipliers.FIBONACCI;
    if (system === 'CUSTOM' && settings.customScoring && settings.customScoring.length > 0) {
        multipliers = settings.customScoring;
    }
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
    const poolsSnap = await db.collection('pools')
        .where('type', '==', 'BRACKET')
        // .where('tournamentId', '==', tournamentId) // Index might be missing in dev, so filter manually if needed? 
        // Best to rely on index or 'tournamentId' field being present.
        .get();
    // Clientside filter if index missing (safe for low volume V1)
    const pools = poolsSnap.docs
        .map(d => {
        // Ensure 'id' is set on the pool object for later use
        const poolData = d.data();
        poolData.id = d.id;
        return poolData;
    })
        .filter(p => p.tournamentId === tournamentId);
    let totalEntriesScored = 0;
    // We'll use a Promise.all approach for pools to be faster? 
    // Or sequential to avoid memory spikes. Sequential is safer.
    for (const pool of pools) {
        const entriesSnap = await db.collection('pools').doc(pool.id).collection('bracket_entries').get();
        const updates = [];
        entriesSnap.docs.forEach(entryDoc => {
            const entry = entryDoc.data();
            const newScore = (0, exports.calculateEntryScore)(entry, tournament, pool.settings);
            // Only update if changed (save writes)
            if (entry.score !== newScore) {
                updates.push({ ref: entryDoc.ref, score: newScore });
            }
        });
        if (updates.length > 0) {
            let batch = db.batch(); // Initialize batch
            let batchCount = 0;
            for (const upd of updates) {
                batch.update(upd.ref, { score: upd.score, updatedAt: Date.now() });
                batchCount++;
                if (batchCount >= 400) { // Commit in chunks of 400 to stay under 500 limit
                    await batch.commit();
                    batch = db.batch(); // Re-initialize for next chunk
                    batchCount = 0;
                }
            }
            if (batchCount > 0) { // Commit any remaining operations
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
//# sourceMappingURL=bracketScoring.js.map