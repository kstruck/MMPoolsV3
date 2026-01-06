import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { PlayoffPool, PlayoffEntry } from "./types";

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// Helper: Normalize team ID or Name for matching
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const TEAM_MAPPING: Record<string, string> = {
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

const getTeamId = (espnTeam: any): string | null => {
    if (!espnTeam) return null;
    const abbrev = espnTeam.team?.abbreviation || '';
    const name = espnTeam.team?.name || ''; // e.g. "Packers"
    const location = espnTeam.team?.location || ''; // e.g. "Green Bay"
    const displayName = espnTeam.team?.displayName || ''; // e.g. "Green Bay Packers"

    if (TEAM_MAPPING[normalize(abbrev)]) return TEAM_MAPPING[normalize(abbrev)];
    if (TEAM_MAPPING[normalize(name)]) return TEAM_MAPPING[normalize(name)];
    if (TEAM_MAPPING[normalize(location)]) return TEAM_MAPPING[normalize(location)];
    if (TEAM_MAPPING[normalize(displayName)]) return TEAM_MAPPING[normalize(displayName)];

    return null;
};

// Extracted Logic to Propagate Results
const saveAndPropagateResults = async (results: any) => {
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

    if (uniqueDocs.size === 0) return 0;

    const batch = db.batch();

    // Process each pool
    for (const poolDoc of uniqueDocs.values()) {
        const pool = poolDoc.data() as PlayoffPool;

        // Define settings locally to reuse calc logic
        const settings = pool.settings?.scoring?.roundMultipliers;
        const MULTIPLIERS = {
            'WILD_CARD': settings?.WILD_CARD ?? 10,
            'DIVISIONAL': settings?.DIVISIONAL ?? 12,
            'CONF_CHAMP': settings?.CONF_CHAMP ?? 15,
            'SUPER_BOWL': settings?.SUPER_BOWL ?? 20
        };

        const winnersWC = results.WILD_CARD || [];
        const winnersDiv = results.DIVISIONAL || [];
        const winnersConf = results.CONF_CHAMP || [];
        const winnersSB = results.SUPER_BOWL || [];

        const updates: Record<string, PlayoffEntry> = {};

        // Recalculate all entries
        for (const [userId, entry] of Object.entries(pool.entries || {})) {
            let score = 0;
            for (const teamId of winnersWC) score += (entry.rankings[teamId] || 0) * MULTIPLIERS.WILD_CARD;
            for (const teamId of winnersDiv) score += (entry.rankings[teamId] || 0) * MULTIPLIERS.DIVISIONAL;
            for (const teamId of winnersConf) score += (entry.rankings[teamId] || 0) * MULTIPLIERS.CONF_CHAMP;
            for (const teamId of winnersSB) score += (entry.rankings[teamId] || 0) * MULTIPLIERS.SUPER_BOWL;

            if (entry.totalScore !== score) {
                updates[userId] = { ...entry, totalScore: score };
            }
        }

        // Always sync results to pool doc so frontend sees them
        const poolUpdate: any = { results };

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

export const submitPlayoffPicks = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
    const { poolId, rankings, tiebreaker, entryId, entryName } = request.data;
    const uid = request.auth.uid;
    const userName = request.auth.token.name || 'Anonymous';

    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();

    if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found');
    const pool = poolSnap.data() as PlayoffPool;

    if (pool.isLocked) throw new HttpsError('failed-precondition', 'Pool is locked');

    // Create Entry Object
    const entryData: PlayoffEntry = {
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
        const maxEntries = pool.settings?.maxEntriesPerUser || 50; // Default to 50 to prevent blocking if setting is missing
        if (userEntries.length >= maxEntries) {
            throw new HttpsError('resource-exhausted', `Max entries reached (${maxEntries})`);
        }
    }

    // Key Logic: use entryId if provided, else generate unique key
    const key = entryId || `${uid}_${Date.now()}`;
    entryData.id = key;

    await poolRef.update({
        [`entries.${key}`]: entryData
    });

    return { success: true, entryId: key };
});

export const calculatePlayoffScores = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');
    const { poolId } = request.data;

    const poolRef = db.collection('pools').doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found');

    // We do nothing here, just acknowledge. Calculation is done via global triggers now.
    // Kept to avoid breaking legacy frontend calls if any exist.
    return { success: true, message: "Use Global Update instead" };
});

export const updateGlobalPlayoffResults = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required');

    // Check SuperAdmin
    const userSnap = await db.collection('users').doc(request.auth.uid).get();
    if (!userSnap.exists || userSnap.data()?.role !== 'SUPER_ADMIN') {
        throw new HttpsError('permission-denied', 'Super Admin only');
    }

    const { results } = request.data;
    if (!results) throw new HttpsError('invalid-argument', 'Missing results');

    const count = await saveAndPropagateResults(results);
    return { success: true, poolsUpdated: count };
});

// Scheduled Function: Check ESPN Scores
export const checkPlayoffScores = onSchedule("every 30 minutes", async (event) => {
    logger.info("Checking ESPN Playoff Scores...");

    try {
        const resp = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
        if (!resp.ok) return;
        const data = await resp.json();

        // 1. Get Current Global Results
        const docRef = db.collection('system').doc('playoff_results');
        const docSnap = await docRef.get();
        let currentResults = docSnap.exists ? docSnap.data()?.results : {};
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

            if (seasonType !== 3) continue; // Only Postseason

            if (status === 'STATUS_FINAL') {
                const winner = game.competitors.find((c: any) => c.winner === true);
                if (winner) {
                    const teamId = getTeamId(winner);
                    if (teamId) {
                        // Map Week to Round
                        let roundKey = '';
                        if (week === 1) roundKey = 'WILD_CARD';
                        else if (week === 2) roundKey = 'DIVISIONAL';
                        else if (week === 3) roundKey = 'CONF_CHAMP';
                        else if (week === 5) roundKey = 'SUPER_BOWL';

                        if (roundKey) {
                            const currentRoundWinners = currentResults[roundKey] || [];
                            if (!currentRoundWinners.includes(teamId)) {
                                logger.info(`Found new winner: ${teamId} in ${roundKey}`);
                                currentResults[roundKey] = [...currentRoundWinners, teamId];
                                hasUpdates = true;
                            }
                        }
                    } else {
                        logger.warn(`Could not map ESPN team to ID: ${winner.team.displayName}`);
                    }
                }
            }
        }

        // 3. Propagate if updates found
        if (hasUpdates) {
            logger.info("Propagating new playoff results...");
            await saveAndPropagateResults(currentResults);
        } else {
            logger.info("No new playoff results found.");
        }

    } catch (error) {
        logger.error("Error checking playoff scores:", error);
    }
});

import { onDocumentWritten } from "firebase-functions/v2/firestore";

export const onPlayoffConfigUpdate = onDocumentWritten("config/playoffs", async (event) => {
    const after = event.data?.after.data();
    // const before = event.data?.before.data();

    // If no data (deleted) or no changes to teams, skip
    if (!after || !after.teams) return;

    // Simple deep equality check or just always update to be safe
    // If teams array changed, propagate to all Playoff Pools
    const teams = after.teams as any[];

    logger.info("Playoff Config Sync: Detected change in config/playoffs. Syncing to all pools...");

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
export const syncPlayoffPools = onCall(async (request) => {
    // Ensure admin only (optional, but good practice)
    // if (!request.auth?.token.admin) throw new HttpsError('permission-denied', 'Admins only');

    const configSnap = await db.doc("config/playoffs").get();
    if (!configSnap.exists) {
        throw new HttpsError('not-found', 'Global Playoff Config not found');
    }

    const config = configSnap.data();
    if (!config || !config.teams) {
        throw new HttpsError('failed-precondition', 'Global Config missing teams data');
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
