"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onWeeklyRecapCreated = exports.onAIRequest = exports.onWinnerUpdate = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const crypto = __importStar(require("crypto"));
const gemini_1 = require("./gemini");
const audit_1 = require("./audit");
const db = admin.firestore();
// Helper to compute SHA256 of facts for idempotency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const computeFactsHash = (facts) => {
    const stableString = JSON.stringify(facts, Object.keys(facts).sort());
    return crypto.createHash("sha256").update(stableString).digest("hex");
};
// --- WINNER EXPLANATION TRIGGER (Squares only) ---
exports.onWinnerUpdate = (0, firestore_1.onDocumentWritten)({
    document: "pools/{poolId}/winners/{periodId}",
    secrets: [gemini_1.geminiApiKey]
}, async (event) => {
    var _a;
    const periodId = event.params.periodId;
    const poolId = event.params.poolId;
    const winnerData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data();
    if (!winnerData)
        return;
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists)
        return;
    const pool = poolSnap.data();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let axis = pool.axisNumbers;
    if (pool.numberSets === 4 && pool.quarterlyNumbers) {
        const key = periodId.toLowerCase();
        if (pool.quarterlyNumbers[key]) {
            axis = pool.quarterlyNumbers[key];
        }
    }
    const scoreSnap = await poolRef.collection("scores").doc(periodId).get();
    const score = scoreSnap.data();
    const auditSnap = await poolRef.collection("audit")
        .where("severity", "in", ["WARNING", "CRITICAL", "INFO"])
        .orderBy("timestamp", "desc")
        .limit(20)
        .get();
    const relevantAuditLogs = auditSnap.docs.map(d => {
        const data = d.data();
        let millis = Date.now();
        if (typeof data.timestamp === 'number') {
            millis = data.timestamp;
        }
        else if (data.timestamp && typeof data.timestamp.toMillis === 'function') {
            millis = data.timestamp.toMillis();
        }
        return { type: data.type, timestamp: new Date(millis).toISOString(), message: data.message };
    });
    const facts = {
        context: "WINNER_EXPLANATION",
        poolConfig: {
            homeTeam: pool.homeTeam,
            awayTeam: pool.awayTeam,
            costPerSquare: pool.costPerSquare,
            ruleVariations: pool.ruleVariations,
            includeOvertime: pool.includeOvertime
        },
        period: periodId,
        digits: axis,
        finalScore: score,
        winnerRecord: winnerData,
        auditTrail: relevantAuditLogs
    };
    const factsHash = computeFactsHash(facts);
    const artifactsRef = poolRef.collection("ai_artifacts");
    const existingSnap = await artifactsRef
        .where("type", "==", "WINNER_EXPLANATION")
        .where("period", "==", periodId)
        .where("factsHash", "==", factsHash)
        .limit(1)
        .get();
    if (!existingSnap.empty) {
        console.log(`Skipping AI generation for ${periodId}: factsHash match.`);
        return;
    }
    try {
        const aiContent = await (0, gemini_1.generateAIResponse)(gemini_1.COMMISSIONER_SYSTEM_PROMPT, facts);
        const artifact = {
            id: `winner-${periodId}-${factsHash.substring(0, 8)}`,
            type: "WINNER_EXPLANATION",
            period: periodId,
            targetId: periodId,
            content: aiContent,
            factsHash,
            createdAt: Date.now()
        };
        await artifactsRef.doc(artifact.id).set(artifact);
        await (0, audit_1.writeAuditEvent)({
            poolId,
            type: "AI_ARTIFACT_CREATED",
            message: `AI Commissioner explained ${periodId} winner`,
            severity: "INFO",
            actor: { uid: "ai-commissioner", role: "SYSTEM", label: "Gemini" },
            payload: { artifactId: artifact.id, factsHash }
        });
    }
    catch (e) {
        console.error("AI Generation Failed", e);
    }
});
// --- DISPUTE / INSIGHT RESOLUTION TRIGGER ---
exports.onAIRequest = (0, firestore_1.onDocumentCreated)({
    document: "pools/{poolId}/ai_requests/{requestId}",
    secrets: [gemini_1.geminiApiKey]
}, async (event) => {
    var _a, _b, _c, _d, _e, _f, _g;
    const poolId = event.params.poolId;
    const snapshot = event.data;
    if (!snapshot)
        return;
    const requestData = snapshot.data();
    console.log(`[AI-DEBUG] Request ${event.params.requestId}. Status: ${requestData === null || requestData === void 0 ? void 0 : requestData.status}`);
    if (!requestData || requestData.status !== 'PENDING') {
        console.log(`[AI-DEBUG] Skipping. Status is ${requestData === null || requestData === void 0 ? void 0 : requestData.status}`);
        return;
    }
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        await snapshot.ref.update({ status: 'ERROR' });
        return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poolRaw = poolSnap.data();
    const poolType = (_a = poolRaw.type) !== null && _a !== void 0 ? _a : 'SQUARES';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let facts;
    // ── BRACKET POOL: Build rich bracket-aware context ──────────────────────
    if (poolType === 'BRACKET') {
        const bracketPool = poolRaw;
        // Fetch tournament data
        let tournament = null;
        if (bracketPool.tournamentId) {
            const tSnap = await db.collection('tournaments').doc(bracketPool.tournamentId).get();
            if (tSnap.exists)
                tournament = tSnap.data();
        }
        // Fetch all entries ordered by score
        const entriesSnap = await poolRef.collection('entries')
            .orderBy('score', 'desc')
            .limit(60)
            .get();
        const allEntries = entriesSnap.docs.map(d => d.data());
        // Top-20 standings summary
        const standings = allEntries.slice(0, 20).map((e, idx) => {
            var _a;
            return ({
                rank: idx + 1,
                name: e.name,
                score: e.score,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                maxPossibleScore: (_a = e.maxPossibleScore) !== null && _a !== void 0 ? _a : null,
                ownerUid: e.ownerUid,
            });
        });
        // Requesting user's own entries & picks
        const userId = requestData.userId;
        const userEntries = allEntries
            .filter(e => e.ownerUid === userId)
            .map(e => {
            var _a;
            return ({
                name: e.name,
                score: e.score,
                picks: e.picks, // { slotId -> teamId }
                tieBreakerPrediction: (_a = e.tieBreakerPrediction) !== null && _a !== void 0 ? _a : null,
            });
        });
        // Summarise completed & pending games
        let completedGames = [];
        let pendingGames = [];
        // Team seed map for AI context
        const teamSeedMap = {};
        if (tournament) {
            const games = Object.values(tournament.games);
            completedGames = games
                .filter(g => g.status === 'FINAL')
                .map(g => ({ id: g.id, round: g.round, winner: g.winnerTeamId, home: g.homeTeamId, away: g.awayTeamId }));
            pendingGames = games
                .filter(g => g.status !== 'FINAL')
                .map(g => ({ id: g.id, round: g.round, home: g.homeTeamId, away: g.awayTeamId, status: g.status }));
            // Build seed map so AI knows which teams are favorites/upsets
            if (tournament.importedTeams) {
                for (const [teamId, teamData] of Object.entries(tournament.importedTeams)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const seed = teamData.seed;
                    if (seed !== undefined)
                        teamSeedMap[teamId] = seed;
                }
            }
        }
        // Scoring values for Fibonacci or Classic so AI can calculate scenarios
        const scoringSystem = (_c = (_b = bracketPool.settings) === null || _b === void 0 ? void 0 : _b.scoringSystem) !== null && _c !== void 0 ? _c : 'classic';
        const scoringValues = Object.assign({ fibonacci: [1, 2, 3, 5, 8, 13], classic: [1, 2, 4, 8, 16, 32] }, (((_d = bracketPool.settings) === null || _d === void 0 ? void 0 : _d.customScoring) ? { custom: bracketPool.settings.customScoring } : {}));
        // Identify the requesting user's top competitor (highest-ranked entry NOT owned by them)
        const topCompetitor = allEntries.find(e => e.ownerUid !== userId);
        facts = {
            context: "BRACKET_INSIGHT",
            userQuestion: requestData.question,
            poolConfig: {
                name: bracketPool.name,
                scoringSystem,
                scoringValues, // e.g. { fibonacci: [1,2,3,5,8,13] }
                upsetBonus: (_f = (_e = bracketPool.settings) === null || _e === void 0 ? void 0 : _e.upsetBonus) !== null && _f !== void 0 ? _f : null,
                entryFee: (_g = bracketPool.settings) === null || _g === void 0 ? void 0 : _g.entryFee,
                totalEntries: allEntries.length,
                gender: bracketPool.gender,
                seasonYear: bracketPool.seasonYear,
            },
            standings,
            userEntries,
            teamSeeds: teamSeedMap, // { "DUKE": 1, "GONZAGA": 2, ... }
            topCompetitor: topCompetitor ? {
                name: topCompetitor.name,
                score: topCompetitor.score,
                picks: topCompetitor.picks,
            } : null,
            tournament: tournament ? {
                id: tournament.id,
                isFinalized: tournament.isFinalized,
                status: tournament.status,
                completedGamesCount: completedGames.length,
                pendingGamesCount: pendingGames.length,
                completedGames: completedGames.slice(0, 40),
                pendingGames: pendingGames.slice(0, 20),
            } : null,
        };
    }
    else if (poolType.startsWith('NFL_')) {
        // ── NFL POOLS: Context ────────────────────────────────────
        const entriesSnap = await poolRef.collection('entries').limit(60).get();
        const allEntries = entriesSnap.docs.map(d => d.data());
        const gamesSnap = await db.collection('nfl_games')
            .where('season', '==', poolRaw.season)
            .where('seasonType', '==', Number(poolRaw.seasonType || 2))
            .limit(32)
            .get();
        const recentGames = gamesSnap.docs.map(d => d.data());
        facts = {
            context: "NFL_POOL_INSIGHT",
            userQuestion: requestData.question,
            poolConfig: {
                type: poolType,
                name: poolRaw.name,
                season: poolRaw.season,
                settings: poolRaw.settings
            },
            standings: allEntries.slice(0, 20),
            userEntries: allEntries.filter(e => e.ownerUid === requestData.userId),
            recentGames
        };
    }
    else if (poolType === 'PROPS') {
        // ── PROPS POOL: Context ────────────────────────────────────
        const cardsSnap = await poolRef.collection('propCards').get();
        const allCards = cardsSnap.docs.map(d => d.data());
        facts = {
            context: "PROPS_INSIGHT",
            userQuestion: requestData.question,
            poolConfig: {
                name: poolRaw.name,
                props: poolRaw.props
            },
            standings: allCards.sort((a, b) => b.score - a.score).slice(0, 20),
            userCards: allCards.filter(c => c.userId === requestData.userId)
        };
    }
    else {
        // ── SQUARES POOL: Original context ────────────────────────────────────
        const pool = poolRaw;
        const auditSnap = await poolRef.collection("audit").orderBy("timestamp", "desc").limit(50).get();
        const auditTrail = auditSnap.docs.map(d => {
            const data = d.data();
            let millis = Date.now();
            if (typeof data.timestamp === 'number') {
                millis = data.timestamp;
            }
            else if (data.timestamp && typeof data.timestamp.toMillis === 'function') {
                millis = data.timestamp.toMillis();
            }
            return { type: data.type, time: new Date(millis).toISOString(), msg: data.message };
        });
        facts = {
            context: "DISPUTE_RESOLUTION",
            userQuestion: requestData.question,
            poolConfig: {
                homeTeam: pool.homeTeam,
                awayTeam: pool.awayTeam,
                payouts: pool.payouts,
                rules: pool.ruleVariations
            },
            currentScore: pool.scores,
            digits: {
                current: pool.axisNumbers,
                quarterly: pool.quarterlyNumbers || null,
                numberSets: pool.numberSets || 1
            },
            auditTrail
        };
    }
    // Generate AI response
    try {
        const aiContent = await (0, gemini_1.generateAIResponse)(gemini_1.COMMISSIONER_SYSTEM_PROMPT, facts);
        const artifactId = `resp-${event.params.requestId}`;
        const artifact = {
            id: artifactId,
            type: "DISPUTE_RESPONSE",
            targetId: event.params.requestId,
            content: aiContent,
            factsHash: computeFactsHash(facts),
            createdAt: Date.now()
        };
        const batch = db.batch();
        batch.set(poolRef.collection("ai_artifacts").doc(artifactId), artifact);
        batch.update(snapshot.ref, {
            status: 'COMPLETED',
            responseArtifactId: artifactId,
            updatedAt: Date.now()
        });
        await batch.commit();
        await (0, audit_1.writeAuditEvent)({
            poolId,
            type: "AI_ARTIFACT_CREATED",
            message: `AI Commissioner responded: ${requestData.question.substring(0, 40)}...`,
            severity: "INFO",
            actor: { uid: "ai-commissioner", role: "SYSTEM", label: "Gemini" },
            payload: { artifactId: artifact.id, requestId: event.params.requestId }
        });
    }
    catch (e) {
        console.error("AI Request Resolution Failed", e);
        await snapshot.ref.update({ status: 'ERROR' });
    }
});
// --- PROACTIVE WEEKLY RECAP / TRASH TALK TRIGGER ---
exports.onWeeklyRecapCreated = (0, firestore_1.onDocumentCreated)({
    document: "pools/{poolId}/weekly_recaps/{recapId}",
    secrets: [gemini_1.geminiApiKey]
}, async (event) => {
    var _a, _b;
    const poolId = event.params.poolId;
    const recapSnap = event.data;
    if (!recapSnap)
        return;
    const recapData = recapSnap.data();
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists)
        return;
    const poolRaw = poolSnap.data();
    // Ensure AI Commissioner is active for this pool
    if (!((_b = (_a = poolRaw.billing) === null || _a === void 0 ? void 0 : _a.featuresUnlocked) === null || _b === void 0 ? void 0 : _b.aiCommissioner))
        return;
    const facts = {
        context: "WEEKLY_RECAP_TRASH_TALK",
        poolConfig: {
            name: poolRaw.name,
            type: poolRaw.type,
            season: poolRaw.season
        },
        recapData
    };
    const factsHash = computeFactsHash(facts);
    const artifactsRef = poolRef.collection("ai_artifacts");
    const existingSnap = await artifactsRef
        .where("factsHash", "==", factsHash)
        .limit(1)
        .get();
    if (!existingSnap.empty)
        return;
    try {
        const aiContent = await (0, gemini_1.generateAIResponse)(gemini_1.COMMISSIONER_SYSTEM_PROMPT, facts);
        const artifact = {
            id: `recap-${recapData.week}-${factsHash.substring(0, 8)}`,
            type: "WEEKLY_RECAP",
            targetId: recapSnap.id,
            content: aiContent,
            factsHash,
            createdAt: Date.now()
        };
        await artifactsRef.doc(artifact.id).set(artifact);
        await (0, audit_1.writeAuditEvent)({
            poolId,
            type: "AI_ARTIFACT_CREATED",
            message: `AI Commissioner published weekly recap trash talk for week ${recapData.week}`,
            severity: "INFO",
            actor: { uid: "ai-commissioner", role: "SYSTEM", label: "Gemini" },
            payload: { artifactId: artifact.id, factsHash }
        });
    }
    catch (e) {
        console.error("Weekly Recap AI Generation Failed", e);
    }
});
//# sourceMappingURL=aiCommissioner.js.map