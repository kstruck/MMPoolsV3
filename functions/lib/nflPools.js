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
exports.scoreNFLWeek = exports.executeSurvivorRebuy = exports.submitNFLPicks = exports.joinNFLPool = exports.createNFLPool = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const audit_1 = require("./audit");
const billing_1 = require("./billing");
const poolOps_1 = require("./poolOps");
const nflScoringEngine_1 = require("./nflScoringEngine");
/**
 * Creates an NFL pool (Pick'em, Survivor, or Margin).
 */
exports.createNFLPool = (0, https_1.onCall)(async (request) => {
    try {
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be logged in.');
        }
        const uid = request.auth.uid;
        const db = admin.firestore();
        // deep clean raw data
        const data = JSON.parse(JSON.stringify(request.data || {}));
        const { type, name, season } = data;
        if (!type || !['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'].includes(type)) {
            throw new https_1.HttpsError('invalid-argument', 'Invalid or missing pool type.');
        }
        if (!name || !season) {
            throw new https_1.HttpsError('invalid-argument', 'Missing required fields: name, season.');
        }
        const poolRef = db.collection('pools').doc();
        const poolId = poolRef.id;
        const now = Date.now();
        const newPool = Object.assign(Object.assign({}, data), { id: poolId, createdByUid: uid, ownerId: uid, managerUid: uid, createdAt: now, updatedAt: now, status: 'OPEN', isLocked: false, participantIds: [uid] });
        const userRef = db.collection('users').doc(uid);
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new https_1.HttpsError('not-found', 'User profile not found.');
            }
            const userData = userDoc.data();
            const currentRole = (userData === null || userData === void 0 ? void 0 : userData.role) || 'PARTICIPANT';
            // 1. Write the pool document
            transaction.set(poolRef, newPool);
            // 2. Upgrade role to POOL_MANAGER if they are a standard participant
            if (currentRole === 'PARTICIPANT') {
                transaction.update(userRef, { role: 'POOL_MANAGER' });
            }
            // 3. Write Manager Index mapping
            transaction.set(userRef.collection('managedPools').doc(poolId), {
                poolId,
                createdAt: now,
                name: newPool.name,
                type: newPool.type
            });
            // 4. Write User Participation mapping
            transaction.set(userRef.collection('participations').doc(poolId), {
                poolId,
                joinedAt: now,
                name: newPool.name,
                type: newPool.type,
                role: 'MANAGER'
            });
        });
        // Log creation to audit trail
        await (0, audit_1.writeAuditEvent)({
            poolId: poolId,
            type: 'POOL_CREATED',
            message: `NFL Pool "${name}" (${type}) created by manager ${uid}`,
            severity: 'INFO',
            actor: { uid, role: 'ADMIN', label: 'Host' },
            payload: { name, type, season }
        });
        return { success: true, poolId };
    }
    catch (error) {
        console.error("createNFLPool Failure:", error);
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError('internal', `Failed to create pool: ${error.message || 'Unknown error'}`, error);
    }
});
/**
 * Join an NFL Pool using a shared invite link.
 */
exports.joinNFLPool = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const uid = request.auth.uid;
    const db = admin.firestore();
    const { poolId } = request.data;
    if (!poolId) {
        throw new https_1.HttpsError('invalid-argument', 'poolId is required.');
    }
    const poolRef = db.collection('pools').doc(poolId);
    const userRef = db.collection('users').doc(uid);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new https_1.HttpsError('not-found', `Pool ${poolId} not found.`);
    }
    const pool = poolSnap.data();
    await db.runTransaction(async (transaction) => {
        var _a, _b;
        const poolDoc = await transaction.get(poolRef);
        const poolData = poolDoc.data();
        if (!poolData)
            throw new https_1.HttpsError('not-found', 'Pool data not found');
        const participantIds = poolData.participantIds || [];
        if (participantIds.includes(uid)) {
            return; // Already joined
        }
        const billingStatus = (_b = (_a = poolData.billing) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : 'free';
        if (billingStatus === 'free' && participantIds.length >= 10) {
            throw new https_1.HttpsError('failed-precondition', 'This pool is on the Free Plan and has reached the limit of 10 participants. The pool manager must upgrade to premium to allow more participants to join.');
        }
        // 1. Add participant to pool collection
        transaction.update(poolRef, {
            participantIds: admin.firestore.FieldValue.arrayUnion(uid)
        });
        // 2. Add participation to user profile
        transaction.set(userRef.collection('participations').doc(poolId), {
            poolId,
            joinedAt: Date.now(),
            name: poolData.name,
            type: poolData.type,
            role: 'PARTICIPANT'
        });
    });
    await (0, audit_1.writeAuditEvent)({
        poolId,
        type: 'POOL_STATUS_CHANGED',
        message: `User ${uid} joined NFL Pool "${pool.name}"`,
        severity: 'INFO',
        actor: { uid, role: 'USER', label: 'Participant' }
    });
    return { success: true };
});
/**
 * Securely submits picks for an NFL Pool with strict server-side kickoff lock checks.
 */
exports.submitNFLPicks = (0, https_1.onCall)(async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const uid = request.auth.uid;
    const db = admin.firestore();
    // deep clean input
    const data = JSON.parse(JSON.stringify(request.data || {}));
    const { poolId, week, picks, confidence, tiebreakerPrediction } = data;
    if (!poolId || !week || !picks) {
        throw new https_1.HttpsError('invalid-argument', 'Missing poolId, week, or picks.');
    }
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Pool not found.');
    }
    const pool = poolSnap.data();
    const billingCheck = (0, billing_1.checkBillingAccess)(pool.billing);
    if (!billingCheck.allowed) {
        throw new https_1.HttpsError("failed-precondition", billingCheck.reason || "Pool is locked due to billing.");
    }
    const type = pool.type;
    const now = Date.now();
    // 1. Fetch weekly games from firestore to validate lock-deadlines
    const gamesSnap = await db.collection('nfl_games')
        .where('season', '==', pool.season)
        .where('seasonType', '==', Number(pool.seasonType || 2))
        .where('week', '==', week)
        .get();
    const games = gamesSnap.docs.map(doc => doc.data());
    if (games.length === 0) {
        throw new https_1.HttpsError('not-found', `No NFL games found for week ${week}.`);
    }
    // 1.5 Global Spread Validation
    // Ensure that all games for the current week have their spreads locked before accepting any picks.
    const allSpreadsLocked = games.every(g => { var _a; return ((_a = g.spread) === null || _a === void 0 ? void 0 : _a.locked) === true; });
    if (!allSpreadsLocked) {
        throw new https_1.HttpsError('failed-precondition', 'SPREADS_NOT_LOCKED: Picks cannot be submitted until all game spreads for the week are finalized and locked.');
    }
    // 2. Determine lock context
    const lockBufferMs = ((_b = (_a = pool.settings) === null || _a === void 0 ? void 0 : _a.lockBufferMinutes) !== null && _b !== void 0 ? _b : 5) * 60 * 1000;
    // Check if first game of the week has kicked off
    const earliestGameTime = Math.min(...games.map(g => g.startTime));
    const weekLocked = now >= (earliestGameTime - lockBufferMs);
    // Write variables inside transactions
    const entryRef = poolRef.collection('entries').doc(uid);
    await db.runTransaction(async (transaction) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const entrySnap = await transaction.get(entryRef);
        const existingEntry = entrySnap.exists ? entrySnap.data() : null;
        // --- LOCK CHECKS & POOL SPECIFIC VALIDATIONS ---
        if (type === 'NFL_PICKEM') {
            const settings = pool.settings;
            const weeklyLockMode = settings.confidenceMode || settings.lockMode === 'WEEKLY';
            if (weeklyLockMode) {
                if (weekLocked) {
                    throw new https_1.HttpsError('failed-precondition', 'WEEK_LOCKED: All picks in weekly lock pools are locked.');
                }
                // Validate unique confidence set if enabled
                if (settings.confidenceMode) {
                    const confResult = (0, nflScoringEngine_1.validateConfidenceValues)(picks, confidence || {}, games);
                    if (!confResult.valid) {
                        throw new https_1.HttpsError('invalid-argument', (_a = confResult.error) !== null && _a !== void 0 ? _a : 'Invalid confidence values.');
                    }
                }
            }
            else {
                // PER_GAME lock checks
                for (const [gameId, pickedTeam] of Object.entries(picks)) {
                    const game = games.find(g => g.id === gameId);
                    if (!game)
                        throw new https_1.HttpsError('invalid-argument', `Game ${gameId} not found.`);
                    const isGameLocked = now >= (game.startTime - lockBufferMs);
                    const oldPick = (_b = existingEntry === null || existingEntry === void 0 ? void 0 : existingEntry.picks) === null || _b === void 0 ? void 0 : _b[gameId];
                    if (isGameLocked && oldPick !== pickedTeam) {
                        throw new https_1.HttpsError('failed-precondition', `GAME_LOCKED: Pick for game ${gameId} is locked.`);
                    }
                }
            }
            // Update Pick'em Entry
            const pickemEntry = {
                id: uid,
                poolId,
                ownerUid: uid,
                userName: ((_c = request.auth) === null || _c === void 0 ? void 0 : _c.token.name) || 'Participant',
                picks: Object.assign(Object.assign({}, ((existingEntry === null || existingEntry === void 0 ? void 0 : existingEntry.picks) || {})), picks),
                confidence: settings.confidenceMode ? confidence : undefined,
                weeklyTiebreakers: Object.assign(Object.assign({}, ((existingEntry === null || existingEntry === void 0 ? void 0 : existingEntry.weeklyTiebreakers) || {})), (tiebreakerPrediction !== undefined ? { [week]: tiebreakerPrediction } : {})),
                totalScore: (_d = existingEntry === null || existingEntry === void 0 ? void 0 : existingEntry.totalScore) !== null && _d !== void 0 ? _d : 0,
                submittedAt: now,
                paidStatus: (_e = existingEntry === null || existingEntry === void 0 ? void 0 : existingEntry.paidStatus) !== null && _e !== void 0 ? _e : 'UNPAID'
            };
            transaction.set(entryRef, pickemEntry, { merge: true });
        }
        else if (type === 'NFL_SURVIVOR') {
            const survivorEntry = existingEntry || {
                id: uid,
                poolId,
                ownerUid: uid,
                userName: ((_f = request.auth) === null || _f === void 0 ? void 0 : _f.token.name) || 'Participant',
                status: 'ALIVE',
                strikesUsed: 0,
                rebuysUsed: 0,
                usedTeams: [],
                picks: {},
                exemptWeeks: [],
                submittedAt: now,
                paidStatus: 'UNPAID'
            };
            if (survivorEntry.status === 'ELIMINATED') {
                throw new https_1.HttpsError('failed-precondition', 'ELIMINATED: Eliminated players cannot submit picks.');
            }
            const teamPicked = picks[week]; // Keyed by week index e.g. week 1
            if (!teamPicked) {
                throw new https_1.HttpsError('invalid-argument', 'Missing Survivor team selection.');
            }
            // Check single-pick reuse
            if (survivorEntry.usedTeams.includes(teamPicked)) {
                throw new https_1.HttpsError('invalid-argument', `TEAM_ALREADY_USED: You have already picked the ${teamPicked} this season.`);
            }
            // Validate team is playing and not on bye
            const game = games.find(g => g.homeTeam.abbreviation === teamPicked || g.awayTeam.abbreviation === teamPicked);
            if (!game) {
                throw new https_1.HttpsError('invalid-argument', `TEAM_NOT_PLAYING: The ${teamPicked} are not playing in week ${week}.`);
            }
            const isWeeklyLock = ((_g = pool.settings) === null || _g === void 0 ? void 0 : _g.lockMode) === 'WEEKLY';
            if (isWeeklyLock && weekLocked) {
                throw new https_1.HttpsError('failed-precondition', 'WEEK_LOCKED: Survivor pools lock at the kickoff of the first game.');
            }
            const isGameLocked = now >= (game.startTime - lockBufferMs);
            const oldPick = (_h = survivorEntry.picks) === null || _h === void 0 ? void 0 : _h[week];
            if (!isWeeklyLock && isGameLocked && oldPick !== teamPicked) {
                throw new https_1.HttpsError('failed-precondition', `GAME_LOCKED: The game for ${teamPicked} has already locked.`);
            }
            // Update used teams and selections
            const oldUsed = survivorEntry.usedTeams.filter(t => t !== survivorEntry.picks[week]);
            survivorEntry.picks[week] = teamPicked;
            survivorEntry.usedTeams = [...new Set([...oldUsed, teamPicked])];
            survivorEntry.submittedAt = now;
            transaction.set(entryRef, survivorEntry, { merge: true });
        }
        else if (type === 'NFL_MARGIN') {
            const marginEntry = existingEntry || {
                id: uid,
                poolId,
                ownerUid: uid,
                userName: ((_j = request.auth) === null || _j === void 0 ? void 0 : _j.token.name) || 'Participant',
                picks: {},
                usedTeams: [],
                weeklyScores: {},
                seasonTotal: 0,
                negativeBurden: 0,
                positiveWeeks: 0,
                bestWeek: 0,
                submittedAt: now,
                paidStatus: 'UNPAID'
            };
            const teamPicked = picks[week];
            if (!teamPicked) {
                throw new https_1.HttpsError('invalid-argument', 'Missing Margin team selection.');
            }
            // Check single-pick reuse
            if (marginEntry.usedTeams.includes(teamPicked)) {
                throw new https_1.HttpsError('invalid-argument', `TEAM_ALREADY_USED: You have already picked the ${teamPicked} this season.`);
            }
            // Validate team playing
            const game = games.find(g => g.homeTeam.abbreviation === teamPicked || g.awayTeam.abbreviation === teamPicked);
            if (!game) {
                throw new https_1.HttpsError('invalid-argument', `TEAM_NOT_PLAYING: The ${teamPicked} are not playing in week ${week}.`);
            }
            const isWeeklyLock = ((_k = pool.settings) === null || _k === void 0 ? void 0 : _k.lockMode) === 'WEEKLY';
            if (isWeeklyLock && weekLocked) {
                throw new https_1.HttpsError('failed-precondition', 'WEEK_LOCKED: Margin pools lock at the kickoff of the first game.');
            }
            const isGameLocked = now >= (game.startTime - lockBufferMs);
            const oldPick = (_l = marginEntry.picks) === null || _l === void 0 ? void 0 : _l[week];
            if (!isWeeklyLock && isGameLocked && oldPick !== teamPicked) {
                throw new https_1.HttpsError('failed-precondition', `GAME_LOCKED: The game for ${teamPicked} has already locked.`);
            }
            const oldUsed = marginEntry.usedTeams.filter(t => t !== marginEntry.picks[week]);
            marginEntry.picks[week] = teamPicked;
            marginEntry.usedTeams = [...new Set([...oldUsed, teamPicked])];
            marginEntry.submittedAt = now;
            transaction.set(entryRef, marginEntry, { merge: true });
        }
    });
    return { success: true };
});
/**
 * Triggers a Survivor rebuy/buy-back for an eliminated participant.
 */
exports.executeSurvivorRebuy = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const uid = request.auth.uid;
    const db = admin.firestore();
    const { poolId, week } = request.data;
    if (!poolId || !week) {
        throw new https_1.HttpsError('invalid-argument', 'poolId and week are required.');
    }
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Pool not found.');
    }
    const pool = poolSnap.data();
    if (pool.type !== 'NFL_SURVIVOR') {
        throw new https_1.HttpsError('invalid-argument', 'Rebuys are only applicable to Survivor pools.');
    }
    const settings = pool.settings;
    // 1. Verify Deadline cutoff
    if (week > settings.rebuyDeadlineWeek) {
        throw new https_1.HttpsError('failed-precondition', `PAST_DEADLINE: Rebuys are blocked after week ${settings.rebuyDeadlineWeek}.`);
    }
    const entryRef = poolRef.collection('entries').doc(uid);
    await db.runTransaction(async (transaction) => {
        const entrySnap = await transaction.get(entryRef);
        if (!entrySnap.exists) {
            throw new https_1.HttpsError('not-found', 'Participant entry not found.');
        }
        const entry = entrySnap.data();
        if (entry.status !== 'ELIMINATED') {
            throw new https_1.HttpsError('failed-precondition', 'NOT_ELIMINATED: Player is still alive.');
        }
        // 2. Verify Limit
        if (entry.rebuysUsed >= settings.maxRebuys) {
            throw new https_1.HttpsError('failed-precondition', `MAX_REBUYS_EXCEEDED: You have reached the limit of ${settings.maxRebuys} rebuys.`);
        }
        // 3. Reset strikes, increment rebuysUsed, retain previously used teams
        transaction.update(entryRef, {
            status: 'ALIVE',
            strikesUsed: 0,
            rebuysUsed: entry.rebuysUsed + 1,
            eliminatedWeek: null
        });
    });
    await (0, audit_1.writeAuditEvent)({
        poolId,
        type: 'SURVIVOR_REBUY',
        message: `Participant ${uid} successfully purchased Survivor Rebuy #${week}`,
        severity: 'INFO',
        actor: { uid, role: 'USER', label: 'Participant' },
        payload: { week }
    });
    return { success: true };
});
/**
 * Evaluates and scores an NFL week. Fetches all games, parses scores, evaluates picks,
 * updates standings, and creates automated weekly recap summaries.
 * SuperAdmin or Pool Owner only.
 */
exports.scoreNFLWeek = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in.');
    }
    const uid = request.auth.uid;
    const db = admin.firestore();
    const { poolId, week } = request.data;
    if (!poolId || !week) {
        throw new https_1.HttpsError('invalid-argument', 'poolId and week are required.');
    }
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Pool not found.');
    }
    const pool = poolSnap.data();
    // RBAC checks
    let userRole = request.auth.token.role || 'USER';
    try {
        (0, poolOps_1.assertPoolOwnerOrSuperAdmin)(pool, uid, userRole);
    }
    catch (_j) {
        throw new https_1.HttpsError('permission-denied', 'Only pool managers or super admins can trigger scoring.');
    }
    // 1. Retrieve all NFL games for this season and week
    const gamesSnap = await db.collection('nfl_games')
        .where('season', '==', pool.season)
        .where('seasonType', '==', Number(pool.seasonType || 2))
        .where('week', '==', week)
        .get();
    const games = gamesSnap.docs.map(doc => doc.data());
    if (games.length === 0) {
        throw new https_1.HttpsError('failed-precondition', `No games found to score for week ${week}.`);
    }
    // Confirm all games are final
    const activeGamesCount = games.filter(g => g.status !== 'FINAL' && g.status !== 'CANCELLED').length;
    if (activeGamesCount > 0 && userRole !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError('failed-precondition', `ACTIVE_GAMES: Cannot score the week while ${activeGamesCount} games are still active.`);
    }
    // 2. Fetch all entries
    const entriesSnap = await poolRef.collection('entries').get();
    if (entriesSnap.empty) {
        return { success: true, message: 'No entries to score.' };
    }
    const batch = db.batch();
    // Recaps highlighting metrics
    let sharpUser = null;
    let biggestUpset = null;
    let closestTie = null;
    // Track closest MNF game score
    const mnfGame = games.find(g => g.isMonday && g.status === 'FINAL');
    const mnfTotalScore = mnfGame ? (((_b = (_a = mnfGame.scores) === null || _a === void 0 ? void 0 : _a.home) !== null && _b !== void 0 ? _b : 0) + ((_d = (_c = mnfGame.scores) === null || _c === void 0 ? void 0 : _c.away) !== null && _d !== void 0 ? _d : 0)) : null;
    // Survivor tracking
    let aliveCount = 0;
    for (const doc of entriesSnap.docs) {
        const entryRef = doc.ref;
        if (pool.type === 'NFL_PICKEM') {
            const entry = doc.data();
            const { points, correctCount } = (0, nflScoringEngine_1.scorePickemEntry)(entry, games, pool);
            const weeklyPoints = Object.assign(Object.assign({}, (entry.weeklyPoints || {})), { [week]: points });
            const totalScore = Object.values(weeklyPoints).reduce((sum, p) => sum + p, 0);
            batch.update(entryRef, {
                weeklyPoints,
                totalScore
            });
            // Sharp calculation
            if (!sharpUser || points > sharpUser.val) {
                sharpUser = { uid: entry.ownerUid, name: entry.userName, val: points };
            }
            // Tiebreaker
            if (mnfTotalScore !== null) {
                const prediction = (_f = (_e = entry.weeklyTiebreakers) === null || _e === void 0 ? void 0 : _e[week]) !== null && _f !== void 0 ? _f : 0;
                const diff = Math.abs(prediction - mnfTotalScore);
                if (!closestTie || diff < closestTie.diff) {
                    closestTie = { uid: entry.ownerUid, name: entry.userName, diff };
                }
            }
        }
        else if (pool.type === 'NFL_SURVIVOR') {
            const entry = doc.data();
            if (entry.status === 'ELIMINATED')
                continue;
            const autoSurviveEnabled = (_g = pool.settings.autoSurviveExemptionEnabled) !== null && _g !== void 0 ? _g : true;
            const isExempt = (0, nflScoringEngine_1.checkAutoSurviveExemption)(entry.usedTeams, games, autoSurviveEnabled);
            if (isExempt) {
                // Log auto survive
                const exemptWeeks = [...(entry.exemptWeeks || []), week];
                batch.update(entryRef, { exemptWeeks });
                aliveCount++;
            }
            else {
                const { survived, strikeLogged } = (0, nflScoringEngine_1.evaluateSurvivorWeek)(entry, week, games, pool);
                const newStrikes = entry.strikesUsed + (strikeLogged ? 1 : 0);
                let freshEntry = Object.assign(Object.assign({}, entry), { strikesUsed: newStrikes });
                freshEntry = (0, nflScoringEngine_1.updateSurvivorStatus)(freshEntry, pool);
                if (freshEntry.status === 'ELIMINATED') {
                    freshEntry.eliminatedWeek = week;
                }
                else {
                    aliveCount++;
                }
                batch.update(entryRef, {
                    status: freshEntry.status,
                    strikesUsed: freshEntry.strikesUsed,
                    eliminatedWeek: (_h = freshEntry.eliminatedWeek) !== null && _h !== void 0 ? _h : null
                });
                if (strikeLogged) {
                    await (0, audit_1.writeAuditEvent)({
                        poolId,
                        type: 'SURVIVOR_AUTO_STRIKE',
                        message: `Participant ${entry.userName} suffered a strike in week ${week}`,
                        severity: 'WARNING',
                        actor: { uid: 'system', role: 'SYSTEM', label: 'Scoring Engine' },
                        payload: { week }
                    });
                }
            }
        }
        else if (pool.type === 'NFL_MARGIN') {
            const entry = doc.data();
            const pick = entry.picks[week];
            let weekScore = 0;
            if (pick) {
                const res = (0, nflScoringEngine_1.scoreMarginWeek)(pick, games);
                weekScore = res !== null && res !== void 0 ? res : 0;
            }
            else {
                // Auto-Strike / Non-submission in Margin counts as -14 (standard heavy burden penalty)
                weekScore = -14;
            }
            const weeklyScores = Object.assign(Object.assign({}, (entry.weeklyScores || {})), { [week]: weekScore });
            const seasonTotal = Object.values(weeklyScores).reduce((sum, s) => sum + s, 0);
            // Compute negative burden
            const negativeBurden = Object.values(weeklyScores)
                .filter(s => s < 0)
                .reduce((sum, s) => sum + Math.abs(s), 0);
            // Positive weeks count
            const positiveWeeks = Object.values(weeklyScores).filter(s => s > 0).length;
            // Best single week
            const bestWeek = Object.values(weeklyScores).length > 0 ? Math.max(...Object.values(weeklyScores)) : 0;
            batch.update(entryRef, {
                weeklyScores,
                seasonTotal,
                negativeBurden,
                positiveWeeks,
                bestWeek
            });
        }
    }
    // 3. Margin leaderboard sorting
    if (pool.type === 'NFL_MARGIN') {
        const updatedEntriesSnap = await poolRef.collection('entries').get();
        const updatedEntries = updatedEntriesSnap.docs.map(doc => doc.data());
        const ranked = (0, nflScoringEngine_1.sortMarginLeaderboard)(updatedEntries);
        // Write standings back
        for (let index = 0; index < ranked.length; index++) {
            const r = ranked[index];
            const docRef = poolRef.collection('entries').doc(r.ownerUid);
            batch.update(docRef, { rank: index + 1 });
        }
    }
    await batch.commit();
    // 4. Generate automated Weekly Recap
    const recapRef = poolRef.collection('weekly_recaps').doc(`week_${week}`);
    const recapDoc = {
        id: `week_${week}`,
        poolId,
        week,
        sharpOfWeek: sharpUser ? { userId: sharpUser.uid, userName: sharpUser.name, score: sharpUser.val } : undefined,
        closestTiebreaker: closestTie ? { userId: closestTie.uid, userName: closestTie.name, diff: closestTie.diff } : undefined,
        attritionCount: pool.type === 'NFL_SURVIVOR' ? aliveCount : undefined,
        createdAt: Date.now()
    };
    await recapRef.set(recapDoc);
    await (0, audit_1.writeAuditEvent)({
        poolId,
        type: 'SCORE_FINALIZED',
        message: `NFL Pool Scoring concluded for Week ${week}`,
        severity: 'INFO',
        actor: { uid, role: 'ADMIN', label: 'Host' },
        payload: { week }
    });
    return { success: true, message: `Week ${week} scored successfully.` };
});
//# sourceMappingURL=nflPools.js.map