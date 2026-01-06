import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from 'firebase-admin';
import { PlayoffPool, PlayoffEntry } from './types';

const db = admin.firestore();

/**
 * Submit picks for a user (Rankings 1-14 + Tiebreaker)
 */
export const submitPlayoffPicks = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { poolId, rankings, tiebreaker, entryId } = request.data;
    const uid = request.auth.uid;

    if (!poolId || !rankings) {
        throw new HttpsError('invalid-argument', 'Missing poolId or rankings.');
    } // tiebreaker can be 0

    // Validate 14 teams
    const teamIds = Object.keys(rankings);
    const ranks = Object.values(rankings) as number[];

    if (teamIds.length !== 14) {
        throw new HttpsError('invalid-argument', 'Must rank exactly 14 teams.');
    }

    // Validate ranks are 1-14 unique
    const uniqueRanks = new Set(ranks);
    if (uniqueRanks.size !== 14 || Math.min(...ranks) !== 1 || Math.max(...ranks) !== 14) {
        throw new HttpsError('invalid-argument', 'Rankings must be unique 1 to 14.');
    }

    const poolRef = db.collection('pools').doc(poolId);

    try {
        await db.runTransaction(async (transaction) => {
            const poolDoc = await transaction.get(poolRef);
            if (!poolDoc.exists) {
                throw new HttpsError('not-found', 'Pool not found.');
            }

            const pool = poolDoc.data() as PlayoffPool;

            if (pool.isLocked) { // Check lock date too?
                if (pool.lockDate && Date.now() > pool.lockDate) {
                    throw new HttpsError('failed-precondition', 'Pool is locked.');
                }
                if (pool.isLocked) {
                    throw new HttpsError('failed-precondition', 'Pool is manually locked.');
                }
            }

            // Determine Entry ID (New or overwrite)
            // If entryId provided, verify it belongs to user (if enforcing ownership)
            // Or just generate new one if null
            // For now, simpler: if entryId provided, use it. If not, generate new unique ID.

            let finalEntryId = entryId;
            if (!finalEntryId) {
                finalEntryId = `${uid}_${Date.now()}`;
            }

            // Construct Entry
            const entry: PlayoffEntry = {
                id: finalEntryId, // Added ID to entry object for easier localized ref
                userId: uid,
                userName: request.auth!.token.name || request.auth!.token.email || 'Anonymous',
                rankings,
                tiebreaker: Number(tiebreaker) || 0,
                totalScore: 0,
                submittedAt: Date.now()
            };

            // Update specific map key using dot notation to avoid overwriting other entries
            transaction.update(poolRef, {
                [`entries.${finalEntryId}`]: entry
            });
        });

        return { success: true };
    } catch (error) {
        console.error("Error submitting picks:", error);
        throw new HttpsError('internal', 'Failed to submit picks.');
    }
});

/**
 * Calculate scores for a specific pool or all playoff pools.
 * Multipliers: Wild Card (10x), Divisional (12x), Conf (15x), SB (20x)
 */
export const calculatePlayoffScores = onCall(async (request) => {
    // Admin only? For now allow any auth for testing, or restrict.
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be logged in.');
    }

    // Ideally check super admin or pool owner
    const poolId = request.data.poolId;

    if (!poolId) {
        throw new HttpsError('invalid-argument', 'poolId required for now.');
    }

    const poolRef = db.collection('pools').doc(poolId);
    const poolDoc = await poolRef.get();

    if (!poolDoc.exists) {
        throw new HttpsError('not-found', 'Pool not found');
    }

    const pool = poolDoc.data() as PlayoffPool;

    // Scoring Logic
    // Access results: pool.results.WILD_CARD = ['KC', 'BUF']

    // Use customized multipliers if available, otherwise fallback to defaults (Legacy support: 10, 12, 15, 20)
    const settings = pool.settings?.scoring?.roundMultipliers;
    const MULTIPLIERS = {
        'WILD_CARD': settings?.WILD_CARD ?? 10,
        'DIVISIONAL': settings?.DIVISIONAL ?? 12,
        'CONF_CHAMP': settings?.CONF_CHAMP ?? 15,
        'SUPER_BOWL': settings?.SUPER_BOWL ?? 20
    };

    const winnersWC = pool.results.WILD_CARD || [];
    const winnersDiv = pool.results.DIVISIONAL || [];
    const winnersConf = pool.results.CONF_CHAMP || [];
    const winnersSB = pool.results.SUPER_BOWL || [];

    const updates: Record<string, PlayoffEntry> = {};
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
            updates[userId] = { ...entry, totalScore: score };
            changesCount++;
        }
    }

    if (changesCount > 0) {
        // Batch updates? Map is nested, simplest is to read-modify-write the whole entries map or strict dot notation
        // If map is huge, we hit limits. 
        // For now, construct the writes.
        const writeObj: any = {};
        for (const [uid, ent] of Object.entries(updates)) {
            writeObj[`entries.${uid}`] = ent;
        }
        await poolRef.update(writeObj);
    }

    return { success: true, updated: changesCount };
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

    // 1. Save to Global Doc
    await db.collection('system').doc('playoff_results').set({ results, updatedAt: Date.now() });

    // 2. Query all Playoff Pools
    const poolsSnap = await db.collection('pools').where('type', '==', 'playoff').get();

    let totalUpdated = 0;
    const batch = db.batch();

    // Process each pool
    // Note: If > 500 pools, we need multiple batches. For now assuming < 500.
    for (const poolDoc of poolsSnap.docs) {
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
        let poolChanged = false;

        // Recalculate all entries
        for (const [userId, entry] of Object.entries(pool.entries || {})) {
            let score = 0;
            for (const teamId of winnersWC) score += (entry.rankings[teamId] || 0) * MULTIPLIERS.WILD_CARD;
            for (const teamId of winnersDiv) score += (entry.rankings[teamId] || 0) * MULTIPLIERS.DIVISIONAL;
            for (const teamId of winnersConf) score += (entry.rankings[teamId] || 0) * MULTIPLIERS.CONF_CHAMP;
            for (const teamId of winnersSB) score += (entry.rankings[teamId] || 0) * MULTIPLIERS.SUPER_BOWL;

            if (entry.totalScore !== score) {
                updates[userId] = { ...entry, totalScore: score };
                poolChanged = true;
            }
        }

        // Add to batch if changed or if we need to sync results
        // Always sync results to pool doc so frontend sees them
        const poolUpdate: any = { results };

        // Merge entry updates
        for (const [uid, ent] of Object.entries(updates)) {
            poolUpdate[`entries.${uid}`] = ent;
        }

        batch.update(poolDoc.ref, poolUpdate);
        totalUpdated++;
    }

    await batch.commit();

    return { success: true, poolsUpdated: totalUpdated };
});
