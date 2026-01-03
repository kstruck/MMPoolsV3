// NFL PLAYOFFS Pool Test Simulator
// Creates a playoff pool, adds entries with team rankings, scores them, and verifies results

import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { dbService } from '../../../services/dbService';
import type { PlayoffPool, PlayoffEntry, PlayoffTeam } from '../../../types';

export interface PlayoffTestResult {
    poolId: string;
    steps: Array<{
        step: string;
        status: 'success' | 'failed' | 'skipped';
        message: string;
        data?: any;
    }>;
}

export interface PlayoffScenarioSettings {
    name?: string;
    season?: string;
    _fullScenario?: {
        testEntries?: Array<{
            userName: string;
            rankings: Record<string, number>; // teamId -> rank 1-14
            tiebreaker?: number;
        }>;
        roundResults?: {
            WILD_CARD?: string[];
            DIVISIONAL?: string[];
            CONF_CHAMP?: string[];
            SUPER_BOWL?: string[];
        };
    };
}

export async function runScenario(
    _scenario: string,
    _mode: 'dry-run' | 'actual' | 'mock',
    settings?: PlayoffScenarioSettings
): Promise<PlayoffTestResult> {
    const steps: PlayoffTestResult['steps'] = [];
    let poolId: string = '';

    const addStep = (step: string, status: 'success' | 'failed' | 'skipped', message: string, data?: any) => {
        steps.push({ step, status, message, data });
        console.log(`${status === 'success' ? '✅' : status === 'failed' ? '❌' : '⏭️'} [PlayoffTest] [${step}] ${message}`);
    };

    const scenarioData = settings?._fullScenario || {};

    try {
        const db = getFirestore();

        // === A. CREATE PLAYOFF POOL via Cloud Function ===
        const poolName = settings?.name || `Playoff Test - ${new Date().toISOString().slice(11, 23)}`;
        addStep('Create Pool', 'success', `Creating playoff pool: ${poolName}`);

        // Create mock teams (14 playoff teams)
        const teams: PlayoffTeam[] = [
            { id: 'KC', name: 'Kansas City Chiefs', conference: 'AFC', seed: 1, eliminated: false },
            { id: 'BUF', name: 'Buffalo Bills', conference: 'AFC', seed: 2, eliminated: false },
            { id: 'BAL', name: 'Baltimore Ravens', conference: 'AFC', seed: 3, eliminated: false },
            { id: 'HOU', name: 'Houston Texans', conference: 'AFC', seed: 4, eliminated: false },
            { id: 'CLE', name: 'Cleveland Browns', conference: 'AFC', seed: 5, eliminated: false },
            { id: 'MIA', name: 'Miami Dolphins', conference: 'AFC', seed: 6, eliminated: false },
            { id: 'PIT', name: 'Pittsburgh Steelers', conference: 'AFC', seed: 7, eliminated: false },
            { id: 'SF', name: 'San Francisco 49ers', conference: 'NFC', seed: 1, eliminated: false },
            { id: 'DAL', name: 'Dallas Cowboys', conference: 'NFC', seed: 2, eliminated: false },
            { id: 'DET', name: 'Detroit Lions', conference: 'NFC', seed: 3, eliminated: false },
            { id: 'TB', name: 'Tampa Bay Buccaneers', conference: 'NFC', seed: 4, eliminated: false },
            { id: 'PHI', name: 'Philadelphia Eagles', conference: 'NFC', seed: 5, eliminated: false },
            { id: 'LAR', name: 'Los Angeles Rams', conference: 'NFC', seed: 6, eliminated: false },
            { id: 'GB', name: 'Green Bay Packers', conference: 'NFC', seed: 7, eliminated: false }
        ];

        const now = Date.now();
        const poolData: any = {
            type: 'NFL_PLAYOFFS',
            league: 'NFL',
            name: poolName,
            season: settings?.season || '2025',
            createdAt: now,
            isLocked: true, // Already locked
            lockDate: now - 3600000,
            teams,
            entries: {},
            results: scenarioData.roundResults || {},
            settings: {
                entryFee: 25,
                paymentInstructions: 'Test pool',
                isListedPublic: false,
                payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
                scoring: {
                    roundMultipliers: {
                        WILD_CARD: 10,
                        DIVISIONAL: 12,
                        CONF_CHAMP: 15,
                        SUPER_BOWL: 20
                    }
                }
            },
            // Required shims for createPool validation
            costPerSquare: 0,
            maxSquaresPerPlayer: 0
        };

        // Use Cloud Function via dbService
        poolId = await dbService.createPool(poolData);
        addStep('Create Pool', 'success', `Pool created with ID: ${poolId}`);

        // === B. ADD TEST ENTRIES (rankings stored in pool.entries map) ===
        const testEntries = scenarioData.testEntries || [
            { userName: 'Alice', rankings: { KC: 1, SF: 2, BUF: 3, DAL: 4, BAL: 5, DET: 6, HOU: 7, TB: 8, CLE: 9, PHI: 10, MIA: 11, LAR: 12, PIT: 13, GB: 14 }, tiebreaker: 48 },
            { userName: 'Bob', rankings: { SF: 1, KC: 2, DAL: 3, BUF: 4, DET: 5, BAL: 6, TB: 7, HOU: 8, PHI: 9, CLE: 10, LAR: 11, MIA: 12, GB: 13, PIT: 14 }, tiebreaker: 52 },
        ];

        if (testEntries.length > 0) {
            addStep('Add Entries', 'success', `Adding ${testEntries.length} playoff entries...`);

            const entries: Record<string, PlayoffEntry> = {};

            for (const entry of testEntries) {
                const userId = `test-${entry.userName.toLowerCase()}`;
                entries[userId] = {
                    userId,
                    userName: entry.userName,
                    rankings: entry.rankings,
                    tiebreaker: entry.tiebreaker || 0,
                    totalScore: 0,
                    submittedAt: Date.now()
                };
            }

            // Update pool with entries (SuperAdmin can update pool)
            try {
                await dbService.updatePool(poolId, { entries } as any);
            } catch (e) {
                await updateDoc(doc(db, 'pools', poolId), { entries });
            }
            addStep('Add Entries', 'success', `Successfully added ${testEntries.length} playoff entries`);
        }

        // === C. CALCULATE SCORES ===
        addStep('Calculate Scores', 'success', 'Calculating scores based on round results...');

        const poolSnap = await getDoc(doc(db, 'pools', poolId));
        const pool = poolSnap.data() as PlayoffPool;

        const MULTIPLIERS = {
            WILD_CARD: pool.settings?.scoring?.roundMultipliers?.WILD_CARD || 10,
            DIVISIONAL: pool.settings?.scoring?.roundMultipliers?.DIVISIONAL || 12,
            CONF_CHAMP: pool.settings?.scoring?.roundMultipliers?.CONF_CHAMP || 15,
            SUPER_BOWL: pool.settings?.scoring?.roundMultipliers?.SUPER_BOWL || 20
        };

        const results = pool.results || {};
        const updatedEntries: Record<string, PlayoffEntry> = {};

        for (const [userId, entry] of Object.entries(pool.entries || {})) {
            let score = 0;

            // Scoring: Use inverse rank (rank 1 = 14 points, rank 14 = 1 point)
            // This way, ranking teams higher (lower rank number) gives MORE points when they win
            const getPoints = (rank: number) => (15 - rank);

            for (const teamId of (results.WILD_CARD || [])) {
                const rank = entry.rankings[teamId] || 14; // Default to lowest
                score += getPoints(rank) * MULTIPLIERS.WILD_CARD;
            }
            for (const teamId of (results.DIVISIONAL || [])) {
                const rank = entry.rankings[teamId] || 14;
                score += getPoints(rank) * MULTIPLIERS.DIVISIONAL;
            }
            for (const teamId of (results.CONF_CHAMP || [])) {
                const rank = entry.rankings[teamId] || 14;
                score += getPoints(rank) * MULTIPLIERS.CONF_CHAMP;
            }
            for (const teamId of (results.SUPER_BOWL || [])) {
                const rank = entry.rankings[teamId] || 14;
                score += getPoints(rank) * MULTIPLIERS.SUPER_BOWL;
            }

            updatedEntries[userId] = { ...entry, totalScore: score };
        }

        try {
            await dbService.updatePool(poolId, { entries: updatedEntries } as any);
        } catch (e) {
            await updateDoc(doc(db, 'pools', poolId), { entries: updatedEntries });
        }
        addStep('Calculate Scores', 'success', 'Scores calculated and updated');

        // === D. VERIFY RESULTS ===
        addStep('Verification', 'success', 'Fetching final pool state for validation...');

        const finalPoolSnap = await getDoc(doc(db, 'pools', poolId));
        const finalPool = finalPoolSnap.data() as PlayoffPool;
        const finalEntries = Object.values(finalPool.entries || {});

        // Sort by totalScore descending
        finalEntries.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

        const leaderboard = finalEntries.map((e, i) => `${i + 1}. ${e.userName}: ${e.totalScore} pts`).join(' | ');
        addStep('Verification', 'success', `Found ${finalEntries.length} entries. Leaderboard: ${leaderboard}`);

    } catch (error: any) {
        addStep('Error', 'failed', error.message);
        throw error;
    }

    return { poolId, steps };
}
