"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncPlayoffPools = exports.onPlayoffConfigUpdate = exports.checkPlayoffScores = exports.updateGlobalPlayoffResults = exports.calculatePlayoffScores = exports.managePlayoffEntry = exports.submitPlayoffPicks = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const emailStyles_1 = require("./emailStyles");
// Helper: Normalize team ID or Name for matching
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const TEAM_MAPPING = {
    'kc': 'KC', 'kansascity': 'KC', 'chiefs': 'KC',
    'buf': 'BUF', 'buffalo': 'BUF', 'bills': 'BUF',
    'bal': 'BAL', 'baltimore': 'BAL', 'ravens': 'BAL',
    'hou': 'HOU', 'houston': 'HOU', 'texans': 'HOU',
    'cle': 'CLE', 'cleveland': 'CLE', 'browns': 'CLE',
    'mia': 'MIA', 'miami': 'MIA', 'dolphins': 'MIA',
    'pit': 'PIT', 'pittsburgh': 'PIT', 'steelers': 'PIT',
    'sf': 'SF', 'sanfrancisco': 'SF', '49ers': 'SF',
    'dal': 'DAL', 'dallas': 'DAL', 'cowboys': 'DAL',
    'det': 'DET', 'detroit': 'DET', 'lions': 'DET',
    'tb': 'TB', 'tampabay': 'TB', 'buccaneers': 'TB', 'bucs': 'TB',
    'phi': 'PHI', 'philadelphia': 'PHI', 'eagles': 'PHI',
    'lar': 'LAR', 'losangelesrams': 'LAR', 'rams': 'LAR',
    'gb': 'GB', 'greenbay': 'GB', 'packers': 'GB',
    'cin': 'CIN', 'cincinnati': 'CIN', 'bengals': 'CIN',
    'jax': 'JAX', 'jacksonville': 'JAX', 'jagoars': 'JAX',
    'lac': 'LAC', 'chargers': 'LAC',
    'sea': 'SEA', 'seattle': 'SEA', 'seahawks': 'SEA',
    'min': 'MIN', 'minnesota': 'MIN', 'vikings': 'MIN',
    'no': 'NO', 'neworleans': 'NO', 'saints': 'NO',
    'lv': 'LV', 'lasvegas': 'LV', 'raiders': 'LV',
    'den': 'DEN', 'denver': 'DEN', 'broncos': 'DEN',
    'atl': 'ATL', 'atlanta': 'ATL', 'falcons': 'ATL',
    'car': 'CAR', 'carolina': 'CAR', 'panthers': 'CAR',
    'chi': 'CHI', 'chicago': 'CHI', 'bears': 'CHI',
    'ind': 'IND', 'indianapolis': 'IND', 'colts': 'IND',
    'ten': 'TEN', 'tennessee': 'TEN', 'titans': 'TEN',
    'nyg': 'NYG', 'giants': 'NYG',
    'nyj': 'NYJ', 'jets': 'NYJ',
    'wsh': 'WSH', 'washington': 'WSH', 'commanders': 'WSH',
    'ari': 'ARI', 'arizona': 'ARI', 'cardinals': 'ARI',
    'ne': 'NE', 'newengland': 'NE', 'patriots': 'NE'
};
const getTeamId = (espnTeam) => {
    var _a, _b, _c, _d;
    if (!espnTeam)
        return null;
    const abbrev = ((_a = espnTeam.team) === null || _a === void 0 ? void 0 : _a.abbreviation) || '';
    const name = ((_b = espnTeam.team) === null || _b === void 0 ? void 0 : _b.name) || ''; // e.g. "Packers"
    const location = ((_c = espnTeam.team) === null || _c === void 0 ? void 0 : _c.location) || ''; // e.g. "Green Bay"
    const displayName = ((_d = espnTeam.team) === null || _d === void 0 ? void 0 : _d.displayName) || ''; // e.g. "Green Bay Packers"
    if (TEAM_MAPPING[normalize(abbrev)])
        return TEAM_MAPPING[normalize(abbrev)];
    if (TEAM_MAPPING[normalize(name)])
        return TEAM_MAPPING[normalize(name)];
    if (TEAM_MAPPING[normalize(location)])
        return TEAM_MAPPING[normalize(location)];
    if (TEAM_MAPPING[normalize(displayName)])
        return TEAM_MAPPING[normalize(displayName)];
    return null;
};
// Extracted Logic to Propagate Results
const saveAndPropagateResults = async (results) => {
    var _a, _b, _c, _d, _e, _f;
    const db = admin.firestore();
    // 1. Save to Global Doc
    await db.collection('system').doc('playoff_results').set({ results, updatedAt: Date.now() });
    // 2. Query all Playoff Pools
    const poolsSnap = await db.collection('pools').where('type', '==', 'NFL_PLAYOFFS').get();
    // Also try 'playoff' just in case for legacy pools (backward compatibility)
    const poolsSnapLegacy = await db.collection('pools').where('type', '==', 'playoff').get();
    const allDocs = [...poolsSnap.docs, ...poolsSnapLegacy.docs];
    // Dedupe
    const uniqueDocs = new Map();
    allDocs.forEach(d => uniqueDocs.set(d.id, d));
    if (uniqueDocs.size === 0)
        return 0;
    const batch = db.batch();
    // Process each pool
    for (const poolDoc of uniqueDocs.values()) {
        const pool = poolDoc.data();
        // Define settings locally to reuse calc logic
        const settings = (_b = (_a = pool.settings) === null || _a === void 0 ? void 0 : _a.scoring) === null || _b === void 0 ? void 0 : _b.roundMultipliers;
        const MULTIPLIERS = {
            'WILD_CARD': (_c = settings === null || settings === void 0 ? void 0 : settings.WILD_CARD) !== null && _c !== void 0 ? _c : 10,
            'DIVISIONAL': (_d = settings === null || settings === void 0 ? void 0 : settings.DIVISIONAL) !== null && _d !== void 0 ? _d : 12,
            'CONF_CHAMP': (_e = settings === null || settings === void 0 ? void 0 : settings.CONF_CHAMP) !== null && _e !== void 0 ? _e : 15,
            'SUPER_BOWL': (_f = settings === null || settings === void 0 ? void 0 : settings.SUPER_BOWL) !== null && _f !== void 0 ? _f : 20
        };
        const winnersWC = results.WILD_CARD || [];
        const winnersDiv = results.DIVISIONAL || [];
        const winnersConf = results.CONF_CHAMP || [];
        const winnersSB = results.SUPER_BOWL || [];
        const updates = {};
        // Recalculate all entries
        for (const [userId, entry] of Object.entries(pool.entries || {})) {
            let score = 0;
            for (const teamId of winnersWC)
                score += (entry.rankings[teamId] || 0) * MULTIPLIERS.WILD_CARD;
            for (const teamId of winnersDiv)
                score += (entry.rankings[teamId] || 0) * MULTIPLIERS.DIVISIONAL;
            for (const teamId of winnersConf)
                score += (entry.rankings[teamId] || 0) * MULTIPLIERS.CONF_CHAMP;
            for (const teamId of winnersSB)
                score += (entry.rankings[teamId] || 0) * MULTIPLIERS.SUPER_BOWL;
            if (entry.totalScore !== score) {
                updates[userId] = Object.assign(Object.assign({}, entry), { totalScore: score });
            }
        }
        // Always sync results to pool doc so frontend sees them
        const poolUpdate = { results };
        // Construct dot notation for batch update
        if (Object.keys(updates).length > 0) {
            for (const [uid, ent] of Object.entries(updates)) {
                poolUpdate[`entries.${uid}`] = ent;
            }
        }
        batch.update(poolDoc.ref, poolUpdate);
    }
    await batch.commit();
    return uniqueDocs.size;
};
exports.submitPlayoffPicks = (0, https_1.onCall)(async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    const { poolId, rankings, tiebreaker, entryId, entryName } = request.data;
    const uid = request.auth.uid;
    const userName = request.auth.token.name || 'Anonymous';
    const db = admin.firestore();
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists)
        throw new https_1.HttpsError('not-found', 'Pool not found');
    const pool = poolSnap.data();
    if (pool.isLocked)
        throw new https_1.HttpsError('failed-precondition', 'Pool is locked');
    // Create Entry Object
    const entryData = {
        userId: uid,
        userName,
        entryName: entryName || userName, // Save custom name or fallback
        rankings,
        tiebreaker: Number(tiebreaker) || 0,
        totalScore: 0,
        submittedAt: Date.now()
    };
    // Check Max Entries Limit (if creating new)
    if (!entryId) {
        const userEntries = Object.values(pool.entries || {}).filter(e => e.userId === uid);
        const maxEntries = ((_a = pool.settings) === null || _a === void 0 ? void 0 : _a.maxEntriesPerUser) || 50; // Default to 50 to prevent blocking if setting is missing
        if (userEntries.length >= maxEntries) {
            throw new https_1.HttpsError('resource-exhausted', `Max entries reached (${maxEntries})`);
        }
    }
    // Key Logic: use entryId if provided, else generate unique key
    const key = entryId || `${uid}_${Date.now()}`;
    entryData.id = key;
    await poolRef.update({
        [`entries.${key}`]: entryData,
        participantIds: admin.firestore.FieldValue.arrayUnion(uid)
    });
    // 5. Send Confirmation Email
    try {
        const userEmail = request.auth.token.email;
        if (userEmail) {
            // Construct Pick List
            const pickList = pool.teams
                .map(t => (Object.assign(Object.assign({}, t), { rank: rankings[t.id] || 0 })))
                .sort((a, b) => b.rank - a.rank)
                .map(t => `<li style="margin-bottom: 5px;"><strong>${t.rank} pts:</strong> ${t.name} (${t.seed})</li>`)
                .join('');
            // Body Content (Inner HTML)
            const bodyContent = `
                <p>Hi ${userName},</p>
                <p>Your picks for <strong>${pool.name}</strong> have been saved.</p>
                
                <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; color: #1f2937;">
                    <p style="margin: 0; font-weight: bold;">Entry: <span style="color: #4f46e5;">${entryData.entryName}</span></p>
                    <p style="margin: 5px 0 0 0;">Tiebreaker: <strong>${entryData.tiebreaker}</strong> (Total Points)</p>
                </div>

                <h3 style="color: #334155; font-size: 16px; margin-bottom: 15px;">Your Rankings</h3>
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px;">
                    <ul style="padding-left: 20px; margin: 0; color: #475569; font-size: 14px;">
                        ${pickList}
                    </ul>
                </div>
            `;
            // Render Standard Template
            const poolUrl = `${emailStyles_1.BASE_URL}/#pool/${poolId}`;
            const emailHtml = (0, emailStyles_1.renderEmailHtml)('Entry Confirmed! ✅', bodyContent, poolUrl, 'View Your Entry');
            // Send via Firestore Trigger
            await db.collection('mail').add({
                to: userEmail,
                message: {
                    subject: `Entry Confirmed: ${pool.name}`,
                    html: emailHtml,
                    text: `Your picks for ${pool.name} have been saved. Entry: ${entryData.entryName}. View at ${poolUrl}`
                }
            });
        }
    }
    catch (emailErr) {
        console.error("Failed to send confirmation email:", emailErr);
        // Non-blocking
    }
    return { success: true, entryId: key };
});
exports.managePlayoffEntry = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    const { poolId, entryId, action, value } = request.data; // action: 'togglePaid' | 'delete'
    const uid = request.auth.uid;
    const isAdmin = request.auth.token.role === 'SUPER_ADMIN';
    const db = admin.firestore();
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists)
        throw new https_1.HttpsError('not-found', 'Pool not found');
    const pool = poolSnap.data();
    const isManager = pool.ownerId === uid || isAdmin;
    const entry = (_a = pool.entries) === null || _a === void 0 ? void 0 : _a[entryId];
    if (!entry)
        throw new https_1.HttpsError('not-found', 'Entry not found');
    if (action === 'togglePaid') {
        if (!isManager)
            throw new https_1.HttpsError('permission-denied', 'Only managers can update payment status');
        // Update status
        await poolRef.update({
            [`entries.${entryId}.paid`]: value
        });
        // SEND RECEIPT EMAIL (If paid)
        if (value === true) {
            try {
                // Get user email
                let recipientEmail = '';
                // Try to find email from User collection if not on entry
                if (entry.userId) {
                    const uSnap = await db.collection('users').doc(entry.userId).get();
                    if (uSnap.exists)
                        recipientEmail = (_b = uSnap.data()) === null || _b === void 0 ? void 0 : _b.email;
                }
                if (recipientEmail) {
                    const subject = `Payment Received: ${pool.name}`;
                    const body = `
                        <p>Hi ${entry.userName},</p>
                        <p>Your payment for <strong>${pool.name}</strong> has been received/confirmed by the pool manager.</p>
                        
                        <div style="background-color: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 15px; margin: 20px 0; color: #064e3b;">
                            <p style="margin: 0; font-weight: bold; font-size: 18px;">PAID ✅</p>
                            <p style="margin: 5px 0 0 0;">Entry: ${entry.entryName || entry.userName}</p>
                            ${((_c = pool.settings) === null || _c === void 0 ? void 0 : _c.entryFee) ? `<p style="margin: 5px 0 0 0;">Amount: $${pool.settings.entryFee}</p>` : ''}
                        </div>

                        <p>You are all set! Good luck in the playoffs.</p>
                    `;
                    const html = (0, emailStyles_1.renderEmailHtml)('Payment Receipt', body, `${emailStyles_1.BASE_URL}/#pool/${poolId}`, 'View Pool');
                    await db.collection('mail').add({
                        to: recipientEmail,
                        message: { subject, html }
                    });
                }
            }
            catch (err) {
                console.error("Failed to send receipt email:", err);
                // Non-blocking
            }
        }
        return { success: true, message: `Entry marked as ${value ? 'Paid' : 'Unpaid'}` };
    }
    if (action === 'delete') {
        const isOwner = entry.userId === uid;
        // Owners can delete only if pool is NOT locked
        if (isOwner && !isManager && pool.isLocked) {
            throw new https_1.HttpsError('failed-precondition', 'Cannot delete entry after pool is locked');
        }
        // Managers can delete anytime. Owners can delete before lock.
        if (!isOwner && !isManager) {
            throw new https_1.HttpsError('permission-denied', 'You do not have permission to delete this entry');
        }
        await poolRef.update({
            [`entries.${entryId}`]: admin.firestore.FieldValue.delete()
        });
        return { success: true, message: 'Entry deleted' };
    }
    throw new https_1.HttpsError('invalid-argument', 'Invalid action');
});
exports.calculatePlayoffScores = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    const { poolId } = request.data;
    const db = admin.firestore();
    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists)
        throw new https_1.HttpsError('not-found', 'Pool not found');
    // We do nothing here, just acknowledge. Calculation is done via global triggers now.
    // Kept to avoid breaking legacy frontend calls if any exist.
    return { success: true, message: "Use Global Update instead" };
});
exports.updateGlobalPlayoffResults = (0, https_1.onCall)(async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    // Check SuperAdmin
    const db = admin.firestore();
    const userSnap = await db.collection('users').doc(request.auth.uid).get();
    if (!userSnap.exists || ((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'SUPER_ADMIN') {
        throw new https_1.HttpsError('permission-denied', 'Super Admin only');
    }
    const { results } = request.data;
    if (!results)
        throw new https_1.HttpsError('invalid-argument', 'Missing results');
    const count = await saveAndPropagateResults(results);
    return { success: true, poolsUpdated: count };
});
// Scheduled Function: Check ESPN Scores
exports.checkPlayoffScores = (0, scheduler_1.onSchedule)("every 30 minutes", async (event) => {
    var _a;
    logger.info("Checking ESPN Playoff Scores...");
    try {
        const resp = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
        if (!resp.ok)
            return;
        const data = await resp.json();
        // 1. Get Current Global Results
        const db = admin.firestore();
        const docRef = db.collection('system').doc('playoff_results');
        const docSnap = await docRef.get();
        let currentResults = docSnap.exists ? (_a = docSnap.data()) === null || _a === void 0 ? void 0 : _a.results : {};
        if (!currentResults) {
            currentResults = { WILD_CARD: [], DIVISIONAL: [], CONF_CHAMP: [], SUPER_BOWL: [] };
        }
        let hasUpdates = false;
        // 2. Process Games
        for (const competition of data.events || []) {
            const game = competition.competitions[0];
            const status = game.status.type.name; // STATUS_FINAL
            const week = competition.week.number;
            const seasonType = competition.season.type;
            if (seasonType !== 3)
                continue; // Only Postseason
            if (status === 'STATUS_FINAL') {
                const winner = game.competitors.find((c) => c.winner === true);
                if (winner) {
                    const teamId = getTeamId(winner);
                    if (teamId) {
                        // Map Week to Round
                        let roundKey = '';
                        if (week === 1)
                            roundKey = 'WILD_CARD';
                        else if (week === 2)
                            roundKey = 'DIVISIONAL';
                        else if (week === 3)
                            roundKey = 'CONF_CHAMP';
                        else if (week === 5)
                            roundKey = 'SUPER_BOWL';
                        if (roundKey) {
                            const currentRoundWinners = currentResults[roundKey] || [];
                            if (!currentRoundWinners.includes(teamId)) {
                                logger.info(`Found new winner: ${teamId} in ${roundKey}`);
                                currentResults[roundKey] = [...currentRoundWinners, teamId];
                                hasUpdates = true;
                            }
                        }
                    }
                    else {
                        logger.warn(`Could not map ESPN team to ID: ${winner.team.displayName}`);
                    }
                }
            }
        }
        // 3. Propagate if updates found
        if (hasUpdates) {
            logger.info("Propagating new playoff results...");
            await saveAndPropagateResults(currentResults);
        }
        else {
            logger.info("No new playoff results found.");
        }
    }
    catch (error) {
        logger.error("Error checking playoff scores:", error);
    }
});
const firestore_1 = require("firebase-functions/v2/firestore");
exports.onPlayoffConfigUpdate = (0, firestore_1.onDocumentWritten)("config/playoffs", async (event) => {
    var _a;
    const after = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data();
    // const before = event.data?.before.data();
    // If no data (deleted) or no changes to teams, skip
    if (!after || !after.teams)
        return;
    // Simple deep equality check or just always update to be safe
    // If teams array changed, propagate to all Playoff Pools
    const teams = after.teams;
    logger.info("Playoff Config Sync: Detected change in config/playoffs. Syncing to all pools...");
    const db = admin.firestore();
    const poolsSnap = await db.collection('pools').where('type', '==', 'NFL_PLAYOFFS').get();
    if (poolsSnap.empty) {
        logger.info("Playoff Config Sync: No pools found to update.");
        return;
    }
    const batch = db.batch();
    let count = 0;
    poolsSnap.docs.forEach(doc => {
        batch.update(doc.ref, { teams });
        count++;
    });
    await batch.commit();
    logger.info(`Playoff Config Sync: Updated ${count} pools with new team data.`);
});
/**
 * Callable function to manually force a sync of the global playoff config to all pools.
 * Useful if the trigger fails or for retro-fixing.
 */
exports.syncPlayoffPools = (0, https_1.onCall)(async (request) => {
    // Ensure admin only (optional, but good practice)
    // if (!request.auth?.token.admin) throw new HttpsError('permission-denied', 'Admins only');
    const db = admin.firestore();
    const configSnap = await db.doc("config/playoffs").get();
    if (!configSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Global Playoff Config not found');
    }
    const config = configSnap.data();
    if (!config || !config.teams) {
        throw new https_1.HttpsError('failed-precondition', 'Global Config missing teams data');
    }
    const teams = config.teams;
    const poolsSnap = await db.collection('pools').where('type', '==', 'NFL_PLAYOFFS').get();
    if (poolsSnap.empty) {
        return { success: true, message: "No playoff pools found." };
    }
    const batch = db.batch();
    let count = 0;
    poolsSnap.docs.forEach(doc => {
        batch.update(doc.ref, { teams });
        count++;
    });
    await batch.commit();
    logger.info(`Manual Playoff Sync: Updated ${count} pools.`);
    return { success: true, count, message: `Successfully synced ${count} pools.` };
});
//# sourceMappingURL=playoffPools.js.map