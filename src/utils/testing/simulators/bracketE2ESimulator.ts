/**
 * E2E Bracket Pool Simulator
 * 
 * Full lifecycle orchestrator: creates a pool with 2025 NCAA tournament data,
 * generates 50+ entries, progresses round-by-round, scores entries at each checkpoint,
 * and validates the entire flow before marking the pool COMPLETED.
 * 
 * This is the "nuclear option" test — if it passes, the bracket pool is production-ready.
 */

import { getFirestore, collection, addDoc, getDocs, setDoc, doc, updateDoc } from 'firebase/firestore';
import { dbService } from '../../../services/dbService';
import type { BracketPool, BracketEntry } from '../../../types';
import { calculateScore } from '../../../components/BracketPoolDashboard/bracketScoring';
import {
    generateTournament2025,
    revealRound,
    getChampionshipTotal,
    GAMES_PER_ROUND,
    TOTAL_GAMES,
} from '../data/tournament2025';
import { generateEntries, generateControlEntries } from '../data/testEntryGenerator';

// ─── TYPES ───────────────────────────────────────────────────────

export interface E2EStep {
    label: string;
    status: 'success' | 'failed' | 'skipped';
    detail: string;
    round?: number;
    data?: Record<string, unknown>;
}

export interface RoundCheckpoint {
    round: number;
    roundLabel: string;
    gamesDecided: number;
    totalGamesDecided: number;
    leaderboard: {
        rank: number;
        name: string;
        score: number;
        maxPossible: number;
        correctPicks: number;
    }[];
    topScore: number;
    avgScore: number;
    eliminatedEntries: number; // entries that can no longer win
}

export interface E2EResult {
    poolId: string;
    steps: E2EStep[];
    checkpoints: RoundCheckpoint[];
    finalWinner: string;
    finalTopScore: number;
    totalEntries: number;
    scoringSystem: string;
}

// Round labels for display
const ROUND_LABELS = ['', 'Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];

// ─── MAIN SIMULATOR ──────────────────────────────────────────────

export async function runE2EBracketSimulation(config: {
    entryCount?: number;
    scoringSystem?: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
    customScoring?: number[];
    chalkBias?: number;
    seed?: number;
    includePerfectBracket?: boolean;
    includeControlEntries?: boolean;
}): Promise<E2EResult> {
    const {
        entryCount = 50,
        scoringSystem = 'CLASSIC',
        customScoring,
        chalkBias = 0.65,
        seed = 42,
        includePerfectBracket = true,
        includeControlEntries = true,
    } = config;

    const steps: E2EStep[] = [];
    const checkpoints: RoundCheckpoint[] = [];
    let poolId = '';

    // Use getFirestore() inline to match the working bracketSimulator pattern
    const db = getFirestore();

    const addStep = (label: string, status: E2EStep['status'], detail: string, round?: number, data?: Record<string, unknown>) => {
        steps.push({ label, status, detail, round, data });
    };

    try {
        // ═══════════════════════════════════════════════════════════════
        // STEP 1: CREATE BRACKET POOL
        // ═══════════════════════════════════════════════════════════════
        const now = Date.now();
        const poolData: Partial<BracketPool> & { type: 'BRACKET'; costPerSquare: number; maxSquaresPerPlayer: number } = {
            name: `E2E Full Tournament Test (${scoringSystem})`,
            type: 'BRACKET',
            slug: `e2e-bracket-test-${now}`,
            slugLower: `e2e-bracket-test-${now}`,
            isListedPublic: false,
            lockAt: now - 3600000, // Already locked
            status: 'PUBLISHED', // CF overrides to DRAFT — we'll update after
            seasonYear: 2025,
            gender: 'mens',
            tournamentId: 'mens-2025',
            settings: {
                maxEntriesTotal: -1,
                maxEntriesPerUser: -1,
                entryFee: 25,
                paymentInstructions: 'E2E Test Pool — No payment needed',
                scoringSystem,
                customScoring: scoringSystem === 'CUSTOM' ? customScoring : undefined,
                tieBreakers: { closestAbsolute: true, closestUnder: false },
                payouts: {
                    places: [
                        { rank: 1, percentage: 70 },
                        { rank: 2, percentage: 20 },
                        { rank: 3, percentage: 10 },
                    ],
                    bonuses: [],
                },
            },
            createdAt: now,
            entryCount: 0,
            managerUid: 'test-admin-e2e',
            // Required shims for createPool validation
            costPerSquare: 0,
            maxSquaresPerPlayer: 0,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        poolId = await dbService.createPool(poolData as any);
        addStep('Create Pool', 'success', `Pool created: ${poolId} (${scoringSystem} scoring)`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 2: CREATE TOURNAMENT (all games SCHEDULED initially)
        // ═══════════════════════════════════════════════════════════════
        let tournament = generateTournament2025();

        // SuperAdmin can write tournaments (Firestore rules allow this)
        try {
            await setDoc(doc(db, 'tournaments', 'mens-2025'), tournament);
            addStep('Create Tournament', 'success', `Tournament created: ${TOTAL_GAMES} games across 6 rounds (all SCHEDULED)`);
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error('[E2E] Tournament creation failed:', errMsg);
            addStep('Create Tournament', 'skipped', `Could not create tournament: ${errMsg}`);
            // Don't throw — continue anyway (tournament may already exist from prior run)
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 3: GENERATE AND SUBMIT ENTRIES
        // ═══════════════════════════════════════════════════════════════
        const randomEntries = generateEntries(entryCount, { chalkBias, seed, includePerfectBracket });
        const controlEntries = includeControlEntries ? generateControlEntries() : [];
        const allEntries = [...randomEntries, ...controlEntries];

        addStep('Generate Entries', 'success', `Generated ${allEntries.length} entries (${entryCount} random + ${controlEntries.length} control + ${includePerfectBracket ? 1 : 0} perfect)`);

        const entriesCollection = collection(db, 'pools', poolId, 'entries');
        let submittedCount = 0;
        let entryErrors = 0;

        for (const entry of allEntries) {
            try {
                const entryData: Partial<BracketEntry> = {
                    poolId,
                    ownerUid: `test-user-${entry.userName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                    name: `${entry.userName}'s Bracket`,
                    picks: entry.picks,
                    tieBreakerPrediction: entry.tiebreakerPrediction,
                    status: 'SUBMITTED',
                    paidStatus: 'PAID',
                    score: 0,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };
                await addDoc(entriesCollection, entryData);
                submittedCount++;
            } catch (e: unknown) {
                entryErrors++;
                const errMsg = e instanceof Error ? e.message : String(e);
                console.error(`[E2E] Entry creation failed for ${entry.userName}:`, errMsg);
                // Only log first 3 errors to avoid spam
                if (entryErrors <= 3) {
                    addStep('Entry Error', 'failed', `Failed to create entry for ${entry.userName}: ${errMsg}`);
                }
            }
        }

        if (entryErrors > 3) {
            addStep('Entry Errors', 'failed', `${entryErrors} total entry creation failures (showing first 3)`);
        }

        addStep('Submit Entries', submittedCount > 0 ? 'success' : 'failed',
            `Submitted ${submittedCount}/${allEntries.length} entries to pool ${poolId}`);

        // Update entry count on pool
        try {
            await updateDoc(doc(db, 'pools', poolId), {
                entryCount: submittedCount,
                participantCount: submittedCount,
            });
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error('[E2E] Entry count update failed:', errMsg);
            // Non-critical
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 4: ROUND-BY-ROUND PROGRESSION
        // ═══════════════════════════════════════════════════════════════
        let previousTopScore = 0;
        let previousMaxPossible = Infinity;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const poolSettings = (poolData as any).settings!;

        for (let round = 1; round <= 6; round++) {
            const roundLabel = ROUND_LABELS[round];
            const gamesInRound = GAMES_PER_ROUND[round] || 0;

            // 4a. Reveal round results
            tournament = revealRound(tournament, round);

            // Update tournament in Firestore
            try {
                await setDoc(doc(db, 'tournaments', 'mens-2025'), tournament);
            } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                console.error(`[E2E] Round ${round} tournament update failed:`, errMsg);
                addStep(`Round ${round} Tournament`, 'failed', errMsg, round);
                continue;
            }

            addStep(`Round ${round} Reveal`, 'success', `${roundLabel}: Revealed ${gamesInRound} game results`, round);

            // 4b. Recalculate ALL entry scores
            const entriesSnap = await getDocs(collection(db, 'pools', poolId, 'entries'));
            const leaderboard: RoundCheckpoint['leaderboard'] = [];

            for (const entryDoc of entriesSnap.docs) {
                const entry = entryDoc.data() as BracketEntry;

                const scoringResult = calculateScore(entry, tournament, poolSettings);

                // Debug: log PerfectBracket's scoring details in final round
                if (round === 6 && entry.name?.includes('PerfectBracket')) {
                    const pickCount = entry.picks ? Object.keys(entry.picks).length : 0;
                    const slotCount = tournament.slots ? Object.keys(tournament.slots).length : 0;
                    console.log(`[E2E DEBUG] PerfectBracket: score=${scoringResult.score}, correct=${scoringResult.correctPicks}, maxPossible=${scoringResult.maxPossibleScore}, pickCount=${pickCount}, slotCount=${slotCount}`);
                    console.log(`[E2E DEBUG] PerfectBracket roundBreakdown:`, JSON.stringify(scoringResult.roundBreakdown));
                }

                try {
                    await updateDoc(entryDoc.ref, {
                        score: scoringResult.score,
                        maxPossibleScore: scoringResult.maxPossibleScore,
                    });
                } catch {
                    // Continue even if one update fails
                }

                leaderboard.push({
                    rank: 0, // will be set after sorting
                    name: entry.name,
                    score: scoringResult.score,
                    maxPossible: scoringResult.maxPossibleScore,
                    correctPicks: scoringResult.correctPicks,
                });
            }

            // Sort and assign ranks
            leaderboard.sort((a, b) => b.score - a.score || a.maxPossible - b.maxPossible);
            leaderboard.forEach((e, i) => { e.rank = i + 1; });

            const topScore = leaderboard[0]?.score || 0;
            const avgScore = leaderboard.length > 0
                ? Math.round(leaderboard.reduce((s, e) => s + e.score, 0) / leaderboard.length)
                : 0;
            const topMaxPossible = leaderboard[0]?.maxPossible || 0;
            const eliminatedEntries = leaderboard.filter(e => e.maxPossible < topScore).length;

            // Calculate total games decided
            let totalGamesDecided = 0;
            for (let r = 1; r <= round; r++) {
                totalGamesDecided += GAMES_PER_ROUND[r] || 0;
            }

            const checkpoint: RoundCheckpoint = {
                round,
                roundLabel,
                gamesDecided: gamesInRound,
                totalGamesDecided,
                leaderboard: leaderboard.slice(0, 10), // Top 10 for logging
                topScore,
                avgScore,
                eliminatedEntries,
            };
            checkpoints.push(checkpoint);

            // 4c. Checkpoint assertions
            // Scores should be non-decreasing
            if (topScore < previousTopScore) {
                addStep(`Round ${round} Assert`, 'failed',
                    `Top score decreased! ${previousTopScore} → ${topScore}`, round);
            }
            // Max possible should be non-increasing (or same)
            if (topMaxPossible > previousMaxPossible) {
                addStep(`Round ${round} Assert`, 'failed',
                    `Max possible increased! ${previousMaxPossible} → ${topMaxPossible}`, round);
            }

            previousTopScore = topScore;
            previousMaxPossible = topMaxPossible;

            // Log checkpoint summary
            const top3 = leaderboard.slice(0, 3).map(e => `${e.name}:${e.score}`).join(', ');
            addStep(`Round ${round} Checkpoint`, 'success',
                `${roundLabel} | Top: ${topScore} | Avg: ${avgScore} | Eliminated: ${eliminatedEntries}/${leaderboard.length} | Top 3: ${top3}`,
                round, { topScore, avgScore, eliminatedEntries, totalGamesDecided });
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 5: MARK POOL COMPLETED
        // ═══════════════════════════════════════════════════════════════
        try {
            await updateDoc(doc(db, 'pools', poolId), { status: 'COMPLETED' });
            addStep('Complete Pool', 'success', 'Pool status updated to COMPLETED');
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error('[E2E] Pool COMPLETED update failed:', errMsg);
            addStep('Complete Pool', 'failed', errMsg);
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 6: DETERMINE WINNER (with tiebreaker)
        // ═══════════════════════════════════════════════════════════════
        const finalEntriesSnap = await getDocs(collection(db, 'pools', poolId, 'entries'));
        const finalEntries = finalEntriesSnap.docs.map(d => {
            const data = d.data() as BracketEntry;
            return { ...data, id: d.id };
        });

        // Debug: log PerfectBracket's score from Firestore vs others
        const perfectFromFS = finalEntries.find(e => e.name?.includes('PerfectBracket'));
        const reboundFromFS = finalEntries.find(e => e.name?.includes('Rebound King'));
        console.log(`[E2E DEBUG] FROM FIRESTORE: PerfectBracket score=${perfectFromFS?.score}, Rebound King score=${reboundFromFS?.score}`);
        console.log(`[E2E DEBUG] Top 5 raw scores:`, finalEntries.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5).map(e => `${e.name}:${e.score}`));

        // Sort by score desc, then tiebreaker proximity
        const champTotal = getChampionshipTotal(); // 128 (Florida 65 + Houston 63)
        finalEntries.sort((a, b) => {
            const scoreDiff = (b.score || 0) - (a.score || 0);
            if (scoreDiff !== 0) return scoreDiff;
            const aDiff = Math.abs((a.tieBreakerPrediction || 0) - champTotal);
            const bDiff = Math.abs((b.tieBreakerPrediction || 0) - champTotal);
            return aDiff - bDiff;
        });

        const winner = finalEntries[0];
        const finalWinner = winner?.name || 'No winner';
        const finalTopScore = winner?.score || 0;

        addStep('Winner', 'success',
            `🏆 Winner: ${finalWinner} with ${finalTopScore} points | Tiebreaker: ${winner?.tieBreakerPrediction || 0} (actual: ${champTotal})`);

        // Final leaderboard (top 10)
        const finalLeaderboard = finalEntries.slice(0, 10)
            .map((e, i) => `${i + 1}. ${e.name}: ${e.score} pts (TB: ${e.tieBreakerPrediction})`)
            .join('\n');
        addStep('Final Standings', 'success', `Top 10:\n${finalLeaderboard}`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 7: CONTROL ENTRY VALIDATION
        // ═══════════════════════════════════════════════════════════════
        if (includeControlEntries) {
            const allChalk = finalEntries.find(e => e.name === "AllChalk's Bracket");
            const allUpset = finalEntries.find(e => e.name === "AllUpset's Bracket");

            if (allChalk && allUpset) {
                if (allChalk.score > allUpset.score) {
                    addStep('Control Validation', 'success',
                        `AllChalk (${allChalk.score}) > AllUpset (${allUpset.score}) ✓`);
                } else {
                    addStep('Control Validation', 'failed',
                        `Expected AllChalk > AllUpset but got ${allChalk.score} vs ${allUpset.score}`);
                }
            }

            if (includePerfectBracket) {
                const perfect = finalEntries.find(e => e.name === "PerfectBracket's Bracket");
                if (perfect && perfect.score >= finalTopScore) {
                    addStep('Perfect Bracket', 'success',
                        `PerfectBracket achieved maximum score: ${perfect.score}`);
                } else if (perfect) {
                    // This shouldn't happen — perfect bracket should always have max score
                    addStep('Perfect Bracket', 'failed',
                        `PerfectBracket score (${perfect.score}) != top score (${finalTopScore})`);
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // RETURN RESULTS
        // ═══════════════════════════════════════════════════════════════
        return {
            poolId,
            steps,
            checkpoints,
            finalWinner,
            finalTopScore,
            totalEntries: submittedCount,
            scoringSystem,
        };

    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('[E2E] Fatal error:', errMsg, error);
        addStep('Fatal Error', 'failed', errMsg);
        return {
            poolId,
            steps,
            checkpoints,
            finalWinner: 'ERROR',
            finalTopScore: 0,
            totalEntries: 0,
            scoringSystem,
        };
    }
}
