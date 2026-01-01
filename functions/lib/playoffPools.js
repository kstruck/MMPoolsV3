"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePlayoffScores = exports.submitPlayoffPicks = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const db = admin.firestore();
/**
 * Submit picks for a user (Rankings 1-14 + Tiebreaker)
 */
exports.submitPlayoffPicks = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const { poolId, rankings, tiebreaker } = request.data;
    const uid = request.auth.uid;
    if (!poolId || !rankings) {
        throw new https_1.HttpsError('invalid-argument', 'Missing poolId or rankings.');
    } // tiebreaker can be 0
    // Validate 14 teams
    const teamIds = Object.keys(rankings);
    const ranks = Object.values(rankings);
    if (teamIds.length !== 14) {
        throw new https_1.HttpsError('invalid-argument', 'Must rank exactly 14 teams.');
    }
    // Validate ranks are 1-14 unique
    const uniqueRanks = new Set(ranks);
    if (uniqueRanks.size !== 14 || Math.min(...ranks) !== 1 || Math.max(...ranks) !== 14) {
        throw new https_1.HttpsError('invalid-argument', 'Rankings must be unique 1 to 14.');
    }
    const poolRef = db.collection('pools').doc(poolId);
    try {
        await db.runTransaction(async (transaction) => {
            const poolDoc = await transaction.get(poolRef);
            if (!poolDoc.exists) {
                throw new https_1.HttpsError('not-found', 'Pool not found.');
            }
            const pool = poolDoc.data();
            if (pool.isLocked) { // Check lock date too?
                if (pool.lockDate && Date.now() > pool.lockDate) {
                    throw new https_1.HttpsError('failed-precondition', 'Pool is locked.');
                }
                if (pool.isLocked) {
                    throw new https_1.HttpsError('failed-precondition', 'Pool is manually locked.');
                }
            }
            // Construct Entry
            const entry = {
                userId: uid,
                userName: request.auth.token.name || request.auth.token.email || 'Anonymous',
                rankings,
                tiebreaker: Number(tiebreaker) || 0,
                totalScore: 0, // Reset score on update? Or keep? Usually 0 until calced.
                submittedAt: Date.now()
            };
            // Update specific map key using dot notation to avoid overwriting other entries
            transaction.update(poolRef, {
                [`entries.${uid}`]: entry
            });
        });
        return { success: true };
    }
    catch (error) {
        console.error("Error submitting picks:", error);
        throw new https_1.HttpsError('internal', 'Failed to submit picks.');
    }
});
/**
 * Calculate scores for a specific pool or all playoff pools.
 * Multipliers: Wild Card (10x), Divisional (12x), Conf (15x), SB (20x)
 */
exports.calculatePlayoffScores = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c, _d, _e, _f;
    // Admin only? For now allow any auth for testing, or restrict.
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in.');
    }
    // Ideally check super admin or pool owner
    const poolId = request.data.poolId;
    if (!poolId) {
        throw new https_1.HttpsError('invalid-argument', 'poolId required for now.');
    }
    const poolRef = db.collection('pools').doc(poolId);
    const poolDoc = await poolRef.get();
    if (!poolDoc.exists) {
        throw new https_1.HttpsError('not-found', 'Pool not found');
    }
    const pool = poolDoc.data();
    // Scoring Logic
    // Access results: pool.results.WILD_CARD = ['KC', 'BUF']
    // Use customized multipliers if available, otherwise fallback to defaults (Legacy support: 10, 12, 15, 20)
    const settings = (_b = (_a = pool.settings) === null || _a === void 0 ? void 0 : _a.scoring) === null || _b === void 0 ? void 0 : _b.roundMultipliers;
    const MULTIPLIERS = {
        'WILD_CARD': (_c = settings === null || settings === void 0 ? void 0 : settings.WILD_CARD) !== null && _c !== void 0 ? _c : 10,
        'DIVISIONAL': (_d = settings === null || settings === void 0 ? void 0 : settings.DIVISIONAL) !== null && _d !== void 0 ? _d : 12,
        'CONF_CHAMP': (_e = settings === null || settings === void 0 ? void 0 : settings.CONF_CHAMP) !== null && _e !== void 0 ? _e : 15,
        'SUPER_BOWL': (_f = settings === null || settings === void 0 ? void 0 : settings.SUPER_BOWL) !== null && _f !== void 0 ? _f : 20
    };
    const winnersWC = pool.results.WILD_CARD || [];
    const winnersDiv = pool.results.DIVISIONAL || [];
    const winnersConf = pool.results.CONF_CHAMP || [];
    const winnersSB = pool.results.SUPER_BOWL || [];
    const updates = {};
    let changesCount = 0;
    for (const [userId, entry] of Object.entries(pool.entries || {})) {
        let score = 0;
        // Calc score
        // For each team in rankings, if they are in winners list, add points
        for (const teamId of winnersWC) {
            const rank = entry.rankings[teamId] || 0;
            score += rank * MULTIPLIERS.WILD_CARD;
        }
        for (const teamId of winnersDiv) {
            const rank = entry.rankings[teamId] || 0;
            score += rank * MULTIPLIERS.DIVISIONAL;
        }
        for (const teamId of winnersConf) {
            const rank = entry.rankings[teamId] || 0;
            score += rank * MULTIPLIERS.CONF_CHAMP;
        }
        for (const teamId of winnersSB) {
            const rank = entry.rankings[teamId] || 0;
            score += rank * MULTIPLIERS.SUPER_BOWL;
        }
        if (entry.totalScore !== score) {
            updates[userId] = Object.assign(Object.assign({}, entry), { totalScore: score });
            changesCount++;
        }
    }
    if (changesCount > 0) {
        // Batch updates? Map is nested, simplest is to read-modify-write the whole entries map or strict dot notation
        // If map is huge, we hit limits. 
        // For now, construct the writes.
        const writeObj = {};
        for (const [uid, ent] of Object.entries(updates)) {
            writeObj[`entries.${uid}`] = ent;
        }
        await poolRef.update(writeObj);
    }
    return { success: true, updated: changesCount };
});
//# sourceMappingURL=playoffPools.js.map