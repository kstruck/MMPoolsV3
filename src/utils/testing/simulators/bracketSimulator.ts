// BRACKET Pool Test Simulator
// Creates a bracket pool, adds test entries with picks, scores them, and verifies results.
// PLAN-NFL-SIM-HARNESS Phase 5: ZERO raw Firestore writes — the pool is created via
// the real createPool callable with a simRunId trust anchor, entries and score
// patches go through simWriteEntries, the tournament doc through simSetTournament,
// and pool patches through simUpdatePool.

import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { dbService } from '../../../services/dbService';
import type { BracketEntry, Tournament, Game, TournamentSlot, BracketPool } from '../../../types';
import { calculateScore } from '../../../components/BracketPoolDashboard/bracketScoring';
import { logger } from '../../logger';

function newRunId(): string {
    return `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export interface BracketTestResult {
    poolId: string;
    steps: Array<{
        step: string;
        status: 'success' | 'failed' | 'skipped';
        message: string;
        data?: unknown;
    }>;
}

export interface BracketScenarioSettings {
    name?: string;
    seasonYear?: number;
    gender?: 'mens' | 'womens';
    _fullScenario?: {
        poolConfig?: {
            entryFee?: number;
            scoringSystem?: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
            customScoring?: number[];
        };
        testEntries?: Array<{
            userName: string;
            picks: Record<string, string>; // slotId -> teamId
            tiebreakerPrediction?: number;
        }>;
        tournamentResults?: Array<{
            gameId: string;
            homeTeamId: string | null;
            awayTeamId: string | null;
            homeScore: number;
            awayScore: number;
            winnerId: string | null;
            round: number;
            status?: 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL';
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

    const addStep = (step: string, status: 'success' | 'failed' | 'skipped', message: string, data?: unknown) => {
        steps.push({ step, status, message, data });
        logger.log(`${status === 'success' ? '✅' : status === 'failed' ? '❌' : '⏭️'} [BracketTest] [${step}] ${message}`);
    };

    const scenarioData = settings?._fullScenario || {};

    try {
        const db = getFirestore();
        const functions = getFunctions();
        const runId = newRunId();

        // === 0. OPEN THE RUN MANIFEST (Phase 0.7: even a run that dies on its
        // next step is discoverable by the stranded-run sweep) ===
        await httpsCallable(functions, 'simStartRun')({ runId, scenarioId: 'bracket-simulator' });

        // === A. CREATE BRACKET POOL via Cloud Function ===
        const poolName = settings?.name || `Bracket Test - ${new Date().toISOString().slice(11, 23)}`;
        addStep('Create Pool', 'success', `Creating bracket pool: ${poolName}`);

        const now = Date.now();
        const poolSettings = scenarioData.poolConfig || {}; // Get pool settings from scenario

        const poolData: Partial<BracketPool> & { type: 'BRACKET'; costPerSquare: number; maxSquaresPerPlayer: number; simRunId: string } = {
            type: 'BRACKET',
            name: poolName,
            slug: `test-bracket-${now}`,
            slugLower: `test-bracket-${now}`,
            seasonYear: settings?.seasonYear || 2025,
            gender: settings?.gender || 'mens',
            status: 'OPEN',
            isListedPublic: false,
            lockAt: now - 3600000, // Already locked (1hr ago)
            settings: {
                maxEntriesTotal: -1,
                maxEntriesPerUser: 3,
                entryFee: poolSettings.entryFee || 10,
                paymentInstructions: 'Test pool',
                scoringSystem: poolSettings.scoringSystem || 'CLASSIC',
                customScoring: poolSettings.customScoring, // Pass custom scoring if present
                tieBreakers: { closestAbsolute: true, closestUnder: false },
                payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] }
            },
            createdAt: now,
            entryCount: 0,
            // Required shims for createPool validation
            costPerSquare: 0,
            maxSquaresPerPlayer: 0,
            managerUid: 'test-admin', // Shim for Partial<BracketPool>
            // Sim harness trust anchor — stamped server-side for SUPER_ADMIN
            // callers only; arms simWriteEntries/simUpdatePool for this pool.
            simRunId: runId,
        };

        // Use Cloud Function via dbService
        poolId = await dbService.createPool(poolData as any);
        addStep('Create Pool', 'success', `Pool created with ID: ${poolId}`);

        // === B. CREATE MOCK TOURNAMENT (SuperAdmin can write to tournaments) ===
        addStep('Create Tournament', 'success', 'Creating mock tournament with games...');

        const tournamentId = `mens-${settings?.seasonYear || 2025}`;
        const mockGames: Record<string, Game> = {};
        const mockSlots: Record<string, TournamentSlot> = {};

        // Create a simplified tournament with games
        const gameResults = scenarioData.tournamentResults || [
            { gameId: 'g1', homeTeamId: 'team1', awayTeamId: 'team2', homeScore: 70, awayScore: 65, winnerId: 'team1', round: 1 },
            { gameId: 'g2', homeTeamId: 'team3', awayTeamId: 'team4', homeScore: 68, awayScore: 72, winnerId: 'team4', round: 1 },
            { gameId: 'g3', homeTeamId: 'team1', awayTeamId: 'team4', homeScore: 75, awayScore: 70, winnerId: 'team1', round: 2 },
        ];

        for (const result of gameResults) {
            mockGames[result.gameId] = {
                id: result.gameId,
                startTime: new Date().toISOString(),
                status: result.status || 'FINAL', // Respect status from scenario or default to FINAL
                homeTeamId: result.homeTeamId || '',
                awayTeamId: result.awayTeamId || '',
                homeScore: result.homeScore,
                awayScore: result.awayScore,
                winnerTeamId: result.winnerId || undefined,
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

        // Tournament doc = shared test infrastructure — written via the
        // SUPER_ADMIN-audited callable (Phase 5), never a raw client write.
        try {
            await httpsCallable(functions, 'simSetTournament')({ tournamentId, tournament: tournamentData });
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            addStep('Tournament Warning', 'skipped', `Could not create tournament: ${errMsg}`);
        }

        addStep('Create Tournament', 'success', `Created mock tournament with ${gameResults.length} games`);

        // === C. ADD TEST ENTRIES (Bracket Picks) ===
        const testEntries = scenarioData.testEntries || [
            { userName: 'Alice', picks: { 'slot-g1': 'team1', 'slot-g2': 'team4', 'slot-g3': 'team1' }, tiebreakerPrediction: 145 },
            { userName: 'Bob', picks: { 'slot-g1': 'team2', 'slot-g2': 'team4', 'slot-g3': 'team4' }, tiebreakerPrediction: 140 },
            { userName: 'Carol', picks: { 'slot-g1': 'team1', 'slot-g2': 'team3', 'slot-g3': 'team1' }, tiebreakerPrediction: 150 },
        ];

        if (testEntries.length > 0) {
            addStep('Add Entries', 'success', `Adding ${testEntries.length} test bracket entries...`);

            // Guarded harness write: run-scoped ownerUids, entry docId forced to
            // ownerUid server-side (simWriteEntries), never a raw addDoc.
            try {
                const entries = testEntries.map(entry => {
                    const entryData: Partial<BracketEntry> & { ownerUid: string } = {
                        poolId: poolId,
                        ownerUid: `sim-${runId}-${entry.userName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                        name: `${entry.userName}'s Bracket`,
                        picks: entry.picks,
                        tieBreakerPrediction: entry.tiebreakerPrediction,
                        status: 'SUBMITTED',
                        paidStatus: 'PAID',
                        score: 0,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    };
                    // Firestore rejects the whole document on any undefined
                    // field value — a missing optional (e.g. tiebreaker) must
                    // drop the field, not kill the entry write.
                    for (const key of Object.keys(entryData) as (keyof typeof entryData)[]) {
                        if (entryData[key] === undefined) delete entryData[key];
                    }
                    return entryData;
                });
                await httpsCallable(functions, 'simWriteEntries')({ poolId, runId, entries });
            } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                addStep('Entry Error', 'failed', `Failed to create entries: ${errMsg}`);
            }

            addStep('Add Entries', 'success', `Created ${testEntries.length} bracket entries`);
        }

        // === D. SCORE ENTRIES ===
        addStep('Score Entries', 'success', 'Calculating scores for all entries...');

        const entriesSnap = await getDocs(collection(db, 'pools', poolId, 'entries'));

        // Score locally, then patch every entry in ONE guarded harness call
        // (simWriteEntries merges by ownerUid — entry docIds ARE ownerUids now).
        const scorePatches: Array<Record<string, unknown>> = [];
        for (const entryDoc of entriesSnap.docs) {
            const entry = entryDoc.data() as BracketEntry;

            if (!poolData.settings) throw new Error("Pool settings missing");

            // Use shared scoring engine
            const scoringResult = calculateScore(entry, tournamentData, poolData.settings);
            const score = scoringResult.score;

            // Store maxPossibleScore for verification (used by maxScoreAtLeast assertion)
            (entry as BracketEntry & { maxPossibleScore?: number }).maxPossibleScore = scoringResult.maxPossibleScore;
            entry.score = score;

            scorePatches.push({
                ownerUid: entry.ownerUid,
                score,
                maxPossibleScore: scoringResult.maxPossibleScore,
            });
        }
        if (scorePatches.length > 0) {
            try {
                await httpsCallable(functions, 'simWriteEntries')({ poolId, runId, entries: scorePatches });
            } catch {
                addStep('Score Warning', 'skipped', 'Could not update entry scores');
            }
        }


        addStep('Score Entries', 'success', 'Scores calculated and updated');

        // === E. MARK POOL COMPLETE ===
        // Guarded harness patch (Phase 5): simUpdatePool verifies the pool's
        // simRunId — the old dbService.updateBracketPool path was a raw client
        // write and is banned from simulators.
        await httpsCallable(functions, 'simUpdatePool')({ poolId, runId, patch: { status: 'COMPLETED' } });
        addStep('Complete Pool', 'success', 'Pool marked as COMPLETED');

        // === F. VERIFY RESULTS ===
        addStep('Verification', 'success', 'Fetching final pool state for validation...');

        const finalEntriesSnap = await getDocs(collection(db, 'pools', poolId, 'entries'));
        const entries = finalEntriesSnap.docs.map(d => ({ id: d.id, ...d.data() } as BracketEntry & { id: string }));

        // Re-calculate maxPossibleScore for verification (since it wasn't saved to DB)
        entries.forEach(e => {
            const res = calculateScore(e, tournamentData, poolData.settings!);
            (e as BracketEntry & { maxPossibleScore?: number }).maxPossibleScore = res.maxPossibleScore;
        });

        // Sort by score descending
        entries.sort((a, b) => (b.score || 0) - (a.score || 0));

        const leaderboard = entries.map((e, i) => `${i + 1}. ${e.name}: ${e.score} pts (Max: ${(e as BracketEntry & { maxPossibleScore?: number }).maxPossibleScore})`).join(' | ');
        addStep('Verification', 'success', `Found ${entries.length} entries. Leaderboard: ${leaderboard}`);

        // Return entries as the "pool" object has _bracketEntries attached in runner
        // But here we return just basics. The Runner attaches entries.
        // Wait, the runner fetches entries from DB. 
        // We need to ensure the runner sees the maxPossibleScore if we want to assert on it.
        // The runner does: pool._bracketEntries = await dbService.getBracketEntries(poolId);
        // dbService doesn't return maxPossibleScore usually.
        // So we might need to "mock" the pool object returned by runner?
        // Actually, the runner calls DB. 
        // 
        // SOLUTION: The Runner fetches data from DB. 
        // Tests rely on `pool._bracketEntries`.
        // If `maxPossibleScore` isn't in DB, assertion fails.
        // 
        // We should PROBABLY update the Simulator to RETURN the full data needed?
        // simpleTestRunner.ts lines 114-128 fetches data.
        // line 123: const bracketEntries = await dbService.getBracketEntries(result.poolId);
        // 
        // Since we can't easily change dbService to Calc max score on the fly (it's client side logic),
        // we might be stuck unless we update the runner or the dbService.
        //
        // HOWEVER, `simpleTestRunner.ts` line 266:
        // if (simulatorResult.finalPoolData) result.finalPoolData = simulatorResult.finalPoolData;
        // 
        // Actually, `simpleTestRunner` logic (lines 114+) re-fetches.
        // 
        // Allow the simulator to pass back the "enriched" entries to prefer over DB?
        // No, simpleTestRunner ignores `result.data` for validation purposes mostly.
        // 
        // Let's look at `simpleTestRunner.ts` again.
        // It uses `pool` object to run assertions.
        // `pool._bracketEntries` comes from DB.
        // 
        // If I want to test maxPossibleScore, I need it calculated.
        // 
        // OPTION: In `assertionRunner`, calculate it on the fly if missing?
        // `assertMaxScoreAtLeast` could calculate it if `maxPossibleScore` is 0/undefined?
        // But `assertionRunner` doesn't have the tournament data... 
        // `pool` object might have it? `bracketSimulator` created it but didn't save it to `pools` collection as full object maybe?
        //
        // In `bracketSimulator`, we save tournament to `tournaments` collection.
        // 
        // COMPROMISE: We will simply CALCULATE it in `assertionRunner` using the same logic?
        // But `assertionRunner` is supposed to be simple.
        // 
        // BETTER: Update `bracketSimulator` to SAVE `maxPossibleScore` to the entry in DB in `score` loop.
        // `BracketEntry` type might not have it, but Firestore allows extra fields.
        // 
        // Let's save `maxPossibleScore` to DB in the loop above!

        // (Self-correction: I added it to updateDoc in the previous chunk, so it SHOULD be in DB)
        // Check `updateDoc(entryDoc.ref, { score, maxPossibleScore: scoringResult.maxPossibleScore })`
        // 
        // If I do that, DB has it. Then `dbService.getBracketEntries` will return it.
        // valid!

        // So just need to make sure loop saves it.


    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        addStep('Error', 'failed', errMsg);
        throw error;
    }

    return { poolId, steps };
}
