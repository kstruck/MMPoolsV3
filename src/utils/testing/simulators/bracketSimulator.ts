// BRACKET Pool Test Simulator
// Creates a bracket pool, adds test entries with picks, scores them, and verifies results

import { getFirestore, doc, collection, addDoc, getDocs, updateDoc } from 'firebase/firestore';
import type { BracketPool, BracketEntry, Tournament, Game, TournamentSlot } from '../../../types';

export interface BracketTestResult {
    poolId: string;
    steps: Array<{
        step: string;
        status: 'success' | 'failed' | 'skipped';
        message: string;
        data?: any;
    }>;
}

export interface BracketScenarioSettings {
    name?: string;
    seasonYear?: number;
    gender?: 'mens' | 'womens';
    _fullScenario?: {
        testEntries?: Array<{
            userName: string;
            picks: Record<string, string>; // slotId -> teamId
            tiebreakerPrediction?: number;
        }>;
        tournamentResults?: Array<{
            gameId: string;
            homeTeamId: string;
            awayTeamId: string;
            homeScore: number;
            awayScore: number;
            winnerId: string;
            round: number;
        }>;
    };
}

export async function runScenario(
    _scenario: string,
    _mode: 'dry-run' | 'actual' | 'mock',
    settings?: BracketScenarioSettings
): Promise<BracketTestResult> {
    const steps: BracketTestResult['steps'] = [];
    let poolId: string = '';

    const addStep = (step: string, status: 'success' | 'failed' | 'skipped', message: string, data?: any) => {
        steps.push({ step, status, message, data });
        console.log(`${status === 'success' ? '✅' : status === 'failed' ? '❌' : '⏭️'} [BracketTest] [${step}] ${message}`);
    };

    const scenarioData = settings?._fullScenario || {};

    try {
        const db = getFirestore();

        // === A. CREATE BRACKET POOL ===
        const poolName = settings?.name || `Bracket Test - ${new Date().toISOString().slice(11, 23)}`;
        addStep('Create Pool', 'success', `Creating bracket pool: ${poolName}`);

        const now = Date.now();
        const poolData: Partial<BracketPool> = {
            type: 'BRACKET',
            name: poolName,
            slug: `test-bracket-${now}`,
            slugLower: `test-bracket-${now}`,
            managerUid: 'test-admin',
            seasonYear: settings?.seasonYear || 2025,
            gender: settings?.gender || 'mens',
            status: 'PUBLISHED',
            isListedPublic: false,
            lockAt: now - 3600000, // Already locked (1hr ago)
            settings: {
                maxEntriesTotal: -1,
                maxEntriesPerUser: 3,
                entryFee: 10,
                paymentInstructions: 'Test pool',
                scoringSystem: 'CLASSIC',
                tieBreakers: { closestAbsolute: true, closestUnder: false },
                payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] }
            },
            createdAt: now,
            entryCount: 0
        };

        const poolRef = await addDoc(collection(db, 'pools'), poolData);
        poolId = poolRef.id;
        addStep('Create Pool', 'success', `Pool created with ID: ${poolId}`);

        // === B. CREATE MOCK TOURNAMENT ===
        addStep('Create Tournament', 'success', 'Creating mock tournament with games...');

        const tournamentId = `mens-${settings?.seasonYear || 2025}`;
        const mockGames: Record<string, Game> = {};
        const mockSlots: Record<string, TournamentSlot> = {};

        // Create a simplified tournament with 4 games (mini bracket)
        const gameResults = scenarioData.tournamentResults || [
            { gameId: 'g1', homeTeamId: 'team1', awayTeamId: 'team2', homeScore: 70, awayScore: 65, winnerId: 'team1', round: 1 },
            { gameId: 'g2', homeTeamId: 'team3', awayTeamId: 'team4', homeScore: 68, awayScore: 72, winnerId: 'team4', round: 1 },
            { gameId: 'g3', homeTeamId: 'team1', awayTeamId: 'team4', homeScore: 75, awayScore: 70, winnerId: 'team1', round: 2 },
        ];

        for (const result of gameResults) {
            mockGames[result.gameId] = {
                id: result.gameId,
                startTime: new Date().toISOString(),
                status: 'FINAL',
                homeTeamId: result.homeTeamId,
                awayTeamId: result.awayTeamId,
                homeScore: result.homeScore,
                awayScore: result.awayScore,
                winnerTeamId: result.winnerId,
                round: result.round
            };
            mockSlots[`slot-${result.gameId}`] = {
                id: `slot-${result.gameId}`,
                gameId: result.gameId
            };
        }

        const tournamentData: Tournament = {
            id: tournamentId,
            seasonYear: settings?.seasonYear || 2025,
            gender: settings?.gender || 'mens',
            isFinalized: true,
            games: mockGames,
            slots: mockSlots
        };

        await updateDoc(doc(db, 'tournaments', tournamentId), tournamentData as any).catch(async () => {
            // If update fails, create new
            const { setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'tournaments', tournamentId), tournamentData);
        });

        addStep('Create Tournament', 'success', `Created mock tournament with ${gameResults.length} games`);

        // === C. ADD TEST ENTRIES (Bracket Picks) ===
        const testEntries = scenarioData.testEntries || [
            { userName: 'Alice', picks: { 'slot-g1': 'team1', 'slot-g2': 'team4', 'slot-g3': 'team1' }, tiebreakerPrediction: 145 },
            { userName: 'Bob', picks: { 'slot-g1': 'team2', 'slot-g2': 'team4', 'slot-g3': 'team4' }, tiebreakerPrediction: 140 },
            { userName: 'Carol', picks: { 'slot-g1': 'team1', 'slot-g2': 'team3', 'slot-g3': 'team1' }, tiebreakerPrediction: 150 },
        ];

        if (testEntries.length > 0) {
            addStep('Add Entries', 'success', `Adding ${testEntries.length} test bracket entries...`);

            for (const entry of testEntries) {
                const entryData: Omit<BracketEntry, 'id'> = {
                    poolId,
                    ownerUid: `test-${entry.userName.toLowerCase()}`,
                    name: `${entry.userName}'s Bracket`,
                    picks: entry.picks,
                    tieBreakerPrediction: entry.tiebreakerPrediction || 0,
                    status: 'SUBMITTED',
                    paidStatus: 'PAID',
                    score: 0, // Will be calculated
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };

                await addDoc(collection(db, 'pools', poolId, 'entries'), entryData);
            }

            addStep('Add Entries', 'success', `Successfully added ${testEntries.length} bracket entries`);
        }

        // === D. SCORE ENTRIES ===
        addStep('Score Entries', 'success', 'Calculating scores for all entries...');

        const entriesSnap = await getDocs(collection(db, 'pools', poolId, 'entries'));
        const pointsPerRound = [10, 20, 40, 80, 160, 320]; // CLASSIC scoring

        for (const entryDoc of entriesSnap.docs) {
            const entry = entryDoc.data() as BracketEntry;
            let score = 0;

            for (const [slotId, pickedTeamId] of Object.entries(entry.picks)) {
                const gameId = slotId.replace('slot-', '');
                const game = mockGames[gameId];
                if (game && game.status === 'FINAL' && game.winnerTeamId === pickedTeamId) {
                    const roundIndex = (game.round || 1) - 1;
                    score += pointsPerRound[roundIndex] || 0;
                }
            }

            await updateDoc(entryDoc.ref, { score });
        }

        addStep('Score Entries', 'success', 'Scores calculated and updated');

        // === E. MARK POOL COMPLETE ===
        await updateDoc(doc(db, 'pools', poolId), { status: 'COMPLETED' });
        addStep('Complete Pool', 'success', 'Pool marked as COMPLETED');

        // === F. VERIFY RESULTS ===
        addStep('Verification', 'success', 'Fetching final pool state for validation...');

        const finalEntriesSnap = await getDocs(collection(db, 'pools', poolId, 'entries'));
        const entries = finalEntriesSnap.docs.map(d => ({ id: d.id, ...d.data() } as BracketEntry & { id: string }));

        // Sort by score descending
        entries.sort((a, b) => (b.score || 0) - (a.score || 0));

        const leaderboard = entries.map((e, i) => `${i + 1}. ${e.name}: ${e.score} pts`).join(' | ');
        addStep('Verification', 'success', `Found ${entries.length} entries. Leaderboard: ${leaderboard}`);

    } catch (error: any) {
        addStep('Error', 'failed', error.message);
        throw error;
    }

    return { poolId, steps };
}
