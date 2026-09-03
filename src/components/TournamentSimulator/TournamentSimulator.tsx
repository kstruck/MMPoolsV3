import { OverlayRoot } from '../ui/OverlayRoot';
import { logger } from '../../utils/logger';
/**
 * Interactive Tournament Simulator
 * 
 * A dedicated admin page for visually walking through an entire bracket pool
 * tournament lifecycle using real 2025 NCAA data.
 * 
 * Phases:
 *   1. Setup — Create pool, generate 50+ entries
 *   2. Fill Your Bracket — Embedded BracketBuilder for manual picks
 *   3. Simulation — Round-by-round with "Simulate Next Round" button
 *   4. Results — Final standings, winner, control entry validation
 */

import React, { useState, useCallback } from 'react';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { dbService } from '../../services/dbService';
import { BracketBuilder } from '../BracketBuilder/BracketBuilder';
import { Header } from '../Header';
import { Footer } from '../Footer';
import { useToast } from '../ui/Toast';
import { Button } from '../ui';
import { calculateScore } from '../BracketPoolDashboard/bracketScoring';
import {
    generateTournament2025,
    revealRound,
    getChampionshipTotal,
    getNextGameId,
    TEAMS,
    GAMES_PER_ROUND,
} from '../../utils/testing/data/tournament2025';
import {
    loadTournament2025,
    loadTournamentAtRound,
    clearTournament,
} from '../../utils/testing/tournamentTestUtils';
import { generateEntries, generateControlEntries } from '../../utils/testing/data/testEntryGenerator';
import type { Tournament, BracketEntry, BracketPool, User } from '../../types';
import {
    Play, RotateCcw, Trophy, Users, ChevronRight, Check,
    Zap, Crown, ArrowUp, ArrowDown, Minus, Loader, AlertTriangle,
    Shuffle, Trash2, X, Download
} from 'lucide-react';

// ─── TYPES ──────────────────────────────────────────────────────

type SimPhase = 'SETUP' | 'BRACKET' | 'SIMULATION' | 'RESULTS';

interface LeaderboardEntry {
    id: string;
    name: string;
    score: number;
    maxPossible: number;
    correctPicks: number;
    tieBreakerPrediction: number;
    previousRank: number;
    isUser: boolean;
    isControl: boolean;
}

interface RoundResult {
    round: number;
    label: string;
    gamesDecided: number;
    upsets: string[];
    topMover: string;
    topScore: number;
}

const ROUND_LABELS: Record<number, string> = {
    1: 'Round of 64',
    2: 'Round of 32',
    3: 'Sweet 16',
    4: 'Elite 8',
    5: 'Final Four',
    6: 'Championship',
};

const PHASE_LABELS: Record<SimPhase, string> = {
    'SETUP': 'Setup',
    'BRACKET': 'Fill Bracket',
    'SIMULATION': 'Simulation',
    'RESULTS': 'Results',
};

// Constant pool settings — defined at module scope for referential stability
const POOL_SETTINGS: BracketPool['settings'] = {
    maxEntriesTotal: -1,
    maxEntriesPerUser: 1,
    entryFee: 20,
    paymentInstructions: 'Venmo @test',
    scoringSystem: 'CLASSIC',
    tieBreakers: { closestAbsolute: true, closestUnder: false },
    payouts: {
        places: [{ rank: 1, percentage: 70 }, { rank: 2, percentage: 20 }, { rank: 3, percentage: 10 }],
        bonuses: [],
    },
};

// ─── MAIN COMPONENT ──────────────────────────────────────────────

export const TournamentSimulator: React.FC<{ user?: User | null }> = ({ user }) => {
    const toast = useToast();
    // Phase state
    const [phase, setPhase] = useState<SimPhase>('SETUP');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Pool / Tournament state
    const [poolId, setPoolId] = useState<string | null>(null);
    // Sim Run trust anchor (PLAN-NFL-SIM-HARNESS Phase 5): every mutation goes
    // through the runId-scoped guarded callables — no raw Firestore writes.
    const [runId, setRunId] = useState<string | null>(null);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [currentRound, setCurrentRound] = useState(0);

    // Entries state
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [entryCount, setEntryCount] = useState(0);
    const [userEntryId, setUserEntryId] = useState<string | null>(null);

    // User bracket picks (using game.id keys for BracketBuilder compatibility)
    const [userPicks, setUserPicks] = useState<Record<string, string>>({});
    const [tieBreakerInput, setTieBreakerInput] = useState<string>('');

    // Round results history
    const [roundResults, setRoundResults] = useState<RoundResult[]>([]);

    // Viewing other entries
    const [viewingEntry, setViewingEntry] = useState<BracketEntry | null>(null);

    const handleEntryClick = useCallback(async (entry: LeaderboardEntry) => {
        if (!poolId) return;
        try {
            const db = getFirestore();
            const entryDoc = await getDoc(doc(db, 'pools', poolId, 'entries', entry.id));
            if (entryDoc.exists()) {
                setViewingEntry({ id: entryDoc.id, ...entryDoc.data() } as BracketEntry);
            }
        } catch (e) {
            logger.error('Failed to load entry:', e);
        }
    }, [poolId]);



    // ─── PHASE 1: SETUP ──────────────────────────────────────────

    const handleSetup = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const functions = getFunctions();
            const newRunId = `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

            // 0. Open the run manifest FIRST — a run that dies mid-setup stays
            // discoverable by the stranded-run sweep (Phase 0.7).
            await httpsCallable(functions, 'simStartRun')({ runId: newRunId, scenarioId: 'tournament-simulator' });
            setRunId(newRunId);

            // 1. Generate tournament (all games SCHEDULED)
            const newTournament = generateTournament2025();
            setTournament(newTournament);

            // 2. Write tournament through the SUPER_ADMIN-audited callable
            await httpsCallable(functions, 'simSetTournament')({ tournamentId: 'mens-2025-sim', tournament: newTournament });

            // 3. Create the pool via the REAL createPool callable, with the
            // simRunId trust anchor (server-stamped for SUPER_ADMIN callers).
            // The old raw addDoc relied on the `sim-*` slug rules backdoor,
            // dropped in Phase 5.
            // Single Date.now() — separate calls could tick between slug and
            // slugLower and break the slugLower-derived-from-slug invariant
            // (qodo review of PR #162 finding 2; bug predates this PR).
            const slug = `sim-${Date.now()}`;
            const poolData = {
                type: 'BRACKET',
                name: '🏀 Tournament Simulator Pool',
                slug,
                slugLower: slug.toLowerCase(),
                isListedPublic: false,
                lockAt: Date.now() + 86400000,
                settings: POOL_SETTINGS,
                seasonYear: 2025,
                gender: 'mens',
                tournamentId: 'mens-2025-sim',
                simRunId: newRunId,
                // Required shims for createPool validation
                costPerSquare: 0,
                maxSquaresPerPlayer: 0,
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const newPoolId = await dbService.createPool(poolData as any);
            setPoolId(newPoolId);

            // createPool launches BRACKET pools as DRAFT; the simulator needs an
            // open pool immediately — patch via the runId-verified harness.
            await httpsCallable(functions, 'simUpdatePool')({
                poolId: newPoolId, runId: newRunId, patch: { status: 'OPEN' },
            });

            // 4. Generate entries (50 random + 3 controls)
            const randomEntries = generateEntries(50, {
                chalkBias: 0.65,
                seed: 42,
                includePerfectBracket: true,
            });
            const controlEntries = generateControlEntries();
            const allEntries = [...randomEntries, ...controlEntries];

            // 5. Write entries through the guarded harness (run-scoped ownerUids;
            // simWriteEntries forces docId = ownerUid).
            // NOTE: getCorrectPicks() uses slot-prefixed keys (slot-R1-E1).
            // But BracketBuilder uses game.id keys (R1-E1).
            // The scoring engine (calculateScore) iterates tournament.slots and
            // looks up entry.picks[slot.id], so picks MUST be keyed by slot.id.
            // The test data generator already uses slot-prefixed keys via getCorrectPicks(), so they're correct.
            const entryDocs = allEntries.map(entry => ({
                poolId: newPoolId,
                ownerUid: `sim-${newRunId}-${entry.userName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                name: `${entry.userName}'s Bracket`,
                picks: entry.picks, // Already keyed by slot.id from getCorrectPicks
                tieBreakerPrediction: entry.tiebreakerPrediction,
                status: 'SUBMITTED',
                paidStatus: 'PAID',
                score: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            }));
            await httpsCallable(functions, 'simWriteEntries')({ poolId: newPoolId, runId: newRunId, entries: entryDocs });

            setEntryCount(allEntries.length);
            setPhase('BRACKET');
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.error('[Simulator] Setup failed:', e);
            setError(`Setup failed: ${errMsg}`);
        } finally {
            setIsLoading(false);
        }
    }, [user?.id]);

    // ─── PHASE 2: FILL BRACKET ──────────────────────────────────

    const handlePick = useCallback((slotId: string, teamId: string) => {
        // BracketBuilder calls onPick(game.id, teamId). We store as game.id here,
        // then convert to slot-prefixed keys when submitting.
        setUserPicks(prev => ({ ...prev, [slotId]: teamId }));
    }, []);

    const userPickCount = Object.keys(userPicks).length;
    const totalPicks = 63; // 32 + 16 + 8 + 4 + 2 + 1

    const handleSubmitBracket = useCallback(async () => {
        if (!poolId || !runId || !tournament) return;

        const tiebreaker = parseInt(tieBreakerInput, 10);
        if (isNaN(tiebreaker) || tiebreaker < 0) {
            setError('Please enter a valid tiebreaker prediction (total championship score).');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Convert game.id picks → slot.id picks for scoring compatibility
            const slotPicks: Record<string, string> = {};
            for (const [gameId, teamId] of Object.entries(userPicks)) {
                slotPicks[`slot-${gameId}`] = teamId;
            }

            // Guarded harness write — docId is forced to the run-scoped ownerUid.
            const userUid = `sim-${runId}-you`;
            const entryData = {
                poolId,
                ownerUid: userUid,
                name: "Your Bracket",
                picks: slotPicks,
                tieBreakerPrediction: tiebreaker,
                status: 'SUBMITTED',
                paidStatus: 'PAID',
                score: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            await httpsCallable(getFunctions(), 'simWriteEntries')({ poolId, runId, entries: [entryData] });
            setUserEntryId(userUid);
            setEntryCount(prev => prev + 1);
            setPhase('SIMULATION');
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.error('[Simulator] Submit failed:', e);
            setError(`Submit failed: ${errMsg}`);
        } finally {
            setIsLoading(false);
        }
    }, [poolId, runId, tournament, userPicks, tieBreakerInput]);

    const handleRandomFill = useCallback((strategy: 'random' | 'chalk' | 'upset' = 'random') => {
        if (!tournament) return;

        const newPicks = { ...userPicks };

        // Helper to pick winner based on strategy
        const pickWinner = (team1Id: string, team2Id: string): string => {
            if (strategy === 'random') {
                return Math.random() > 0.5 ? team1Id : team2Id;
            }

            const team1 = TEAMS.find(t => t.id === team1Id);
            const team2 = TEAMS.find(t => t.id === team2Id);

            if (!team1 || !team2) return Math.random() > 0.5 ? team1Id : team2Id;

            // Chalk: Lower seed number (better rank) has higher chance
            // Upset: Higher seed number (worse rank) has higher chance
            // We'll make it probabilistic but weighted
            const seedDiff = team2.seed - team1.seed; // Positive if team1 is better (lower seed)

            // Base probability for team1 winning
            // If team1 is 1 and team2 is 16, diff is 15.
            let team1Prob = 0.5 + (seedDiff * 0.03); // 1 vs 16 -> 0.95

            if (strategy === 'chalk') {
                team1Prob = Math.min(0.95, Math.max(0.05, team1Prob + 0.2));
            } else if (strategy === 'upset') {
                // Invert the probability bias
                team1Prob = 1 - team1Prob;
            }

            return Math.random() < team1Prob ? team1Id : team2Id;
        };

        // Round 1
        const r1Games = Object.values(tournament.games).filter(g => g.round === 1);
        r1Games.forEach(g => {
            if (!newPicks[g.id]) {
                newPicks[g.id] = pickWinner(g.homeTeamId!, g.awayTeamId!);
            }
        });

        // Rounds 2-6
        for (let r = 2; r <= 6; r++) {
            const nextRoundCandidates: Record<string, string[]> = {};

            // 1. Determine who advanced from previous round picks
            const prevRoundGames = Object.values(tournament.games).filter(g => g.round === r - 1);
            prevRoundGames.forEach(g => {
                const winnerId = newPicks[g.id];
                if (winnerId) {
                    const nextGameId = getNextGameId(g.id, g.round, g.region || '');
                    if (nextGameId) {
                        if (!nextRoundCandidates[nextGameId]) nextRoundCandidates[nextGameId] = [];
                        nextRoundCandidates[nextGameId].push(winnerId);
                    }
                }
            });

            // 2. For each game in this round, if we have candidates, pick one
            const roundGames = Object.values(tournament.games).filter(g => g.round === r);
            roundGames.forEach(g => {
                if (!newPicks[g.id]) {
                    const candidates = nextRoundCandidates[g.id];
                    if (candidates && candidates.length === 2) {
                        newPicks[g.id] = pickWinner(candidates[0], candidates[1]);
                    } else if (candidates && candidates.length === 1) {
                        // Auto-advance if only one candidate (shouldn't happen in valid bracket but safety)
                        newPicks[g.id] = candidates[0];
                    }
                }
            });
        }

        setUserPicks(newPicks);

        // Auto-fill tiebreaker if empty
        if (!tieBreakerInput) {
            // Random score between 120 and 160
            const randomScore = Math.floor(Math.random() * (160 - 120 + 1)) + 120;
            setTieBreakerInput(randomScore.toString());
        }
    }, [tournament, userPicks, tieBreakerInput]);

    const handleClear = useCallback(async () => {
        const ok = await toast.confirm({
            title: 'Clear all picks?',
            message: 'Are you sure you want to clear all picks?',
            danger: true,
        });
        if (ok) {
            setUserPicks({});
        }
    }, [toast]);

    const handleSkipBracket = useCallback(() => {
        setPhase('SIMULATION');
    }, []);

    // ─── PHASE 3: SIMULATION ────────────────────────────────────

    const handleSimulateRound = useCallback(async () => {
        if (!poolId || !runId || !tournament) return;

        const nextRound = currentRound + 1;
        if (nextRound > 6) return;

        setIsLoading(true);
        setError(null);

        try {
            const db = getFirestore();
            const functions = getFunctions();

            // 1. Reveal round results
            const updatedTournament = revealRound(tournament, nextRound);
            setTournament(updatedTournament);

            // 2. Update tournament through the guarded callable
            await httpsCallable(functions, 'simSetTournament')({ tournamentId: 'mens-2025-sim', tournament: updatedTournament });

            // 2b. If this is the first round, lock the pool so brackets become viewable
            if (currentRound === 0 && poolId) {
                await httpsCallable(functions, 'simUpdatePool')({ poolId, runId, patch: { status: 'LOCKED' } });
            }

            // 3. Read all entries and recalculate scores (score patches collected
            // into ONE guarded simWriteEntries call — docIds ARE ownerUids)
            const entriesSnap = await getDocs(collection(db, 'pools', poolId, 'entries'));
            const previousLeaderboard = [...leaderboard];
            const previousRankMap = new Map(previousLeaderboard.map((e, i) => [e.id, i + 1]));

            const newLeaderboard: LeaderboardEntry[] = [];
            const scorePatches: Array<Record<string, unknown>> = [];

            for (const entryDoc of entriesSnap.docs) {
                const entry = { id: entryDoc.id, ...entryDoc.data() } as BracketEntry;
                const scoringResult = calculateScore(entry, updatedTournament, POOL_SETTINGS);

                scorePatches.push({
                    ownerUid: entry.ownerUid,
                    score: scoringResult.score,
                    maxPossibleScore: scoringResult.maxPossibleScore,
                });

                const isUser = entryDoc.id === userEntryId;
                const isControl = ['AllChalk', 'AllUpset', 'HalfRight', 'PerfectBracket'].some(
                    name => entry.name.includes(name)
                );

                newLeaderboard.push({
                    id: entryDoc.id,
                    name: entry.name,
                    score: scoringResult.score,
                    maxPossible: scoringResult.maxPossibleScore,
                    correctPicks: scoringResult.correctPicks,
                    tieBreakerPrediction: entry.tieBreakerPrediction || 0,
                    previousRank: previousRankMap.get(entryDoc.id) || 0,
                    isUser,
                    isControl,
                });
            }

            if (scorePatches.length > 0) {
                await httpsCallable(functions, 'simWriteEntries')({ poolId, runId, entries: scorePatches });
            }

            // Sort: score desc, then tiebreaker proximity
            const champTotal = getChampionshipTotal();
            newLeaderboard.sort((a, b) => {
                const scoreDiff = b.score - a.score;
                if (scoreDiff !== 0) return scoreDiff;
                return Math.abs(a.tieBreakerPrediction - champTotal) - Math.abs(b.tieBreakerPrediction - champTotal);
            });

            setLeaderboard(newLeaderboard);
            setCurrentRound(nextRound);

            // 4. Build round result summary
            const roundGames = Object.values(updatedTournament.games).filter(g => g.round === nextRound && g.status === 'FINAL');
            const upsets = roundGames
                .filter(g => {
                    const home = TEAMS.find(t => t.id === g.homeTeamId);
                    const away = TEAMS.find(t => t.id === g.awayTeamId);
                    if (!home || !away) return false;
                    return g.winnerTeamId === (home.seed > away.seed ? g.homeTeamId : g.awayTeamId);
                })
                .map(g => {
                    const winner = TEAMS.find(t => t.id === g.winnerTeamId);
                    const loser = TEAMS.find(t => t.id === (g.winnerTeamId === g.homeTeamId ? g.awayTeamId : g.homeTeamId));
                    return `#${winner?.seed} ${winner?.name} def. #${loser?.seed} ${loser?.name}`;
                });

            // Find top mover
            let topMoverName = '';
            let biggestJump = 0;
            for (let i = 0; i < newLeaderboard.length; i++) {
                const entry = newLeaderboard[i];
                const prevRank = entry.previousRank || newLeaderboard.length;
                const jump = prevRank - (i + 1);
                if (jump > biggestJump) {
                    biggestJump = jump;
                    topMoverName = `${entry.name} (↑${jump})`;
                }
            }

            setRoundResults(prev => [...prev, {
                round: nextRound,
                label: ROUND_LABELS[nextRound],
                gamesDecided: roundGames.length,
                upsets,
                topMover: topMoverName || 'No movement',
                topScore: newLeaderboard[0]?.score || 0,
            }]);

            // Auto-advance to results after round 6
            if (nextRound === 6) {
                setPhase('RESULTS');
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.error('[Simulator] Round simulation failed:', e);
            setError(`Round ${nextRound} failed: ${errMsg}`);
        } finally {
            setIsLoading(false);
        }
    }, [poolId, runId, tournament, currentRound, leaderboard, userEntryId]);

    // ─── RESET ──────────────────────────────────────────────────

    const handleReset = useCallback(() => {
        setPhase('SETUP');
        setPoolId(null);
        setRunId(null);
        setTournament(null);
        setCurrentRound(0);
        setLeaderboard([]);
        setEntryCount(0);
        setUserEntryId(null);
        setUserPicks({});
        setTieBreakerInput('');
        setRoundResults([]);
        setError(null);
    }, []);

    // ─── QUICK LOAD HANDLERS ────────────────────────────────────

    const handleLoadTournamentOnly = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const loadedTournament = await loadTournament2025('mens-2025');
            setTournament(loadedTournament);
            toast.success('✅ Tournament data loaded successfully to tournaments/mens-2025');
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.error('[Simulator] Load tournament failed:', e);
            setError(`Load failed: ${errMsg}`);
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    const handleLoadRound = useCallback(async (round: number) => {
        setIsLoading(true);
        setError(null);
        try {
            const loadedTournament = await loadTournamentAtRound(round, 'mens-2025');
            setTournament(loadedTournament);
            setCurrentRound(round);
            toast.success(`✅ Tournament loaded at Round ${round} to tournaments/mens-2025`);
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.error('[Simulator] Load round failed:', e);
            setError(`Load failed: ${errMsg}`);
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    const handleClearTournament = useCallback(async () => {
        const ok = await toast.confirm({
            title: 'Clear tournament data?',
            message: 'Clear tournament data from Firestore?',
            danger: true,
        });
        if (!ok) return;
        setIsLoading(true);
        setError(null);
        try {
            await clearTournament('mens-2025');
            setTournament(null);
            setCurrentRound(0);
            toast.success('✅ Tournament data cleared from Firestore');
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            logger.error('[Simulator] Clear tournament failed:', e);
            setError(`Clear failed: ${errMsg}`);
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    // ─── RENDER ─────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-navy-950 text-[#EDF1F8] flex flex-col">
            <Header user={user || null} isManager={true} onOpenAuth={() => { }} onLogout={() => { }} />
            <div className="flex-1">
                {/* Header */}
                <header className="border-b border-[rgba(230,206,150,0.16)] bg-navy-900/70 backdrop-blur-sm sticky top-0 z-20">
                    <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Trophy className="w-6 h-6 text-gold-400" />
                            <h1 className="text-xl font-display font-bold uppercase tracking-[0.03em]">Tournament Simulator</h1>
                            <span className="text-xs bg-gold-500/15 text-gold-300 px-2 py-0.5 rounded-full font-display font-bold uppercase tracking-[0.06em]">
                                2025 NCAA Men's
                            </span>
                        </div>
                        {phase !== 'SETUP' && (
                            <button
                                onClick={handleReset}
                                className="flex items-center gap-1.5 text-xs text-[#9FB0CC] hover:text-white transition-colors duration-150"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Reset
                            </button>
                        )}
                    </div>

                    {/* Phase Stepper */}
                    <div className="max-w-7xl mx-auto px-4 pb-3">
                        <div className="flex gap-1">
                            {(['SETUP', 'BRACKET', 'SIMULATION', 'RESULTS'] as SimPhase[]).map((p, i) => {
                                const phases: SimPhase[] = ['SETUP', 'BRACKET', 'SIMULATION', 'RESULTS'];
                                const currentIdx = phases.indexOf(phase);
                                const isComplete = i < currentIdx;
                                const isCurrent = i === currentIdx;

                                return (
                                    <div key={p} className="flex items-center flex-1">
                                        <div className={`
                                        flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-display font-bold uppercase tracking-[0.06em] flex-1 transition-ui duration-150
                                        ${isCurrent ? 'bg-gold-500/15 text-gold-300 border border-gold-500/30' : ''}
                                        ${isComplete ? 'bg-[#0F7B4A]/15 text-[#3CB371]' : ''}
                                        ${!isCurrent && !isComplete ? 'text-[#5E7096]' : ''}
                                    `}>
                                            {isComplete ? (
                                                <Check className="w-3.5 h-3.5" />
                                            ) : (
                                                <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px] num">
                                                    {i + 1}
                                                </span>
                                            )}
                                            {PHASE_LABELS[p]}
                                            {p === 'SIMULATION' && currentRound > 0 && isCurrent && (
                                                <span className="text-[10px] opacity-70 num">R{currentRound}/6</span>
                                            )}
                                        </div>
                                        {i < 3 && <ChevronRight className="w-3 h-3 text-[#5E7096] mx-1 flex-shrink-0" />}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </header>

                {/* Error Banner */}
                {error && (
                    <div className="max-w-7xl mx-auto px-4 mt-4">
                        <div className="bg-brandred-600/15 border border-brandred-600/40 rounded-lg p-3 flex items-center gap-2 text-brandred-500 text-sm font-body">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            {error}
                        </div>
                    </div>
                )}

                {/* Main Content */}
                <div className="max-w-7xl mx-auto px-4 py-6">
                    {phase === 'SETUP' && (
                        <SetupPhase
                            onSetup={handleSetup}
                            onLoadTournamentOnly={handleLoadTournamentOnly}
                            onLoadRound={handleLoadRound}
                            onClearTournament={handleClearTournament}
                            isLoading={isLoading}
                        />
                    )}

                    {phase === 'BRACKET' && tournament && (
                        <BracketPhase
                            tournament={tournament}
                            picks={userPicks}
                            onPick={handlePick}
                            pickCount={userPickCount}
                            totalPicks={totalPicks}
                            tieBreakerInput={tieBreakerInput}
                            onTieBreakerChange={setTieBreakerInput}
                            onSubmit={handleSubmitBracket}
                            onSkip={handleSkipBracket}
                            onRandomFill={handleRandomFill}
                            onClear={handleClear}
                            isLoading={isLoading}
                        />
                    )}

                    {(phase === 'SIMULATION' || phase === 'RESULTS') && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* LEFT: Main content */}
                            <div className="lg:col-span-2 space-y-4">
                                {phase === 'SIMULATION' && (
                                    <SimulationControls
                                        currentRound={currentRound}
                                        onSimulate={handleSimulateRound}
                                        isLoading={isLoading}
                                    />
                                )}

                                {phase === 'RESULTS' && leaderboard.length > 0 && (
                                    <ResultsBanner
                                        winner={leaderboard[0]}
                                        champTotal={getChampionshipTotal()}
                                    />
                                )}

                                {/* Round Results History */}
                                {roundResults.map(result => (
                                    <RoundResultCard key={result.round} result={result} />
                                ))}

                                {/* Control Entry Validation (Results phase) */}
                                {phase === 'RESULTS' && <ControlValidation leaderboard={leaderboard} />}
                            </div>

                            {/* RIGHT: Leaderboard sidebar */}
                            <div className="lg:col-span-1">
                                <LeaderboardSidebar
                                    leaderboard={leaderboard}
                                    currentRound={currentRound}
                                    entryCount={entryCount}
                                    onEntryClick={handleEntryClick}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Entry View Modal */}
                {viewingEntry && tournament && (
                    <OverlayRoot id="sim-view-entry" label="Entry details" onEscape={() => setViewingEntry(null)} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                        <div className="bg-navy-900 border border-[rgba(230,206,150,0.16)] rounded-2xl w-full max-w-7xl max-h-[95vh] flex flex-col shadow-panel">
                            <div className="flex items-center justify-between p-4 border-b border-[rgba(230,206,150,0.16)]">
                                <div>
                                    <h3 className="font-display font-bold uppercase tracking-[0.03em] text-lg text-white flex items-center gap-2">
                                        {viewingEntry.name}
                                        <span className="text-xs bg-gold-500/15 text-gold-300 px-2 py-0.5 rounded-full font-display font-bold uppercase tracking-[0.06em]">
                                            Score: <span className="num">{viewingEntry.score}</span>
                                        </span>
                                    </h3>
                                    <p className="text-xs text-[#9FB0CC] font-body">Tiebreaker: <span className="num">{viewingEntry.tieBreakerPrediction}</span></p>
                                </div>
                                <button
                                    onClick={() => setViewingEntry(null)}
                                    className="p-2 hover:bg-navy-800 rounded-lg text-[#9FB0CC] hover:text-white transition-colors duration-150"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-auto p-4 bg-navy-950/50">
                                {/* We re-use BracketBuilder in read-only mode */}
                                <BracketBuilder
                                    tournament={tournament}
                                    picks={Object.fromEntries(
                                        Object.entries(viewingEntry.picks).map(([k, v]) => [k.replace('slot-', ''), v])
                                    )}
                                    onPick={() => { }} // Read-only
                                    readOnly={true}
                                    viewMode="full"
                                />
                            </div>
                        </div>
                    </OverlayRoot>
                )}
            </div>
            <Footer />
        </div>
    );
};

// ─── SUB-COMPONENTS ─────────────────────────────────────────────

const SetupPhase: React.FC<{
    onSetup: () => void;
    onLoadTournamentOnly: () => void;
    onLoadRound: (round: number) => void;
    onClearTournament: () => void;
    isLoading: boolean;
}> = ({ onSetup, onLoadTournamentOnly, onLoadRound, onClearTournament, isLoading }) => (
    <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-8 max-w-2xl">
            <div className="space-y-3">
                <div className="w-20 h-20 rounded-2xl bg-gold-foil flex items-center justify-center mx-auto shadow-panel">
                    <Trophy className="w-10 h-10 text-navy-950" />
                </div>
                <h2 className="text-3xl font-display font-extrabold uppercase tracking-[0.02em]">Tournament Simulator</h2>
                <p className="text-[#9FB0CC] text-sm leading-relaxed font-body">
                    Experience a full NCAA bracket pool tournament lifecycle using real 2025 data.
                    Generate 50+ opponents, fill your bracket, and watch the leaderboard unfold round by round.
                </p>
            </div>

            <div className="bg-navy-900/60 border border-[rgba(230,206,150,0.16)] rounded-xl p-6 space-y-4">
                <h3 className="text-sm font-display font-bold text-[#EDF1F8] uppercase tracking-[0.08em]">What happens:</h3>
                <ul className="text-sm text-[#9FB0CC] space-y-2 text-left font-body">
                    <li className="flex items-start gap-2">
                        <span className="text-gold-400 num text-xs mt-0.5">01</span>
                        Create a test pool with CLASSIC scoring (10/20/40/80/160/320)
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-gold-400 num text-xs mt-0.5">02</span>
                        Generate 50 random entries + PerfectBracket + 3 control entries
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-gold-400 num text-xs mt-0.5">03</span>
                        Fill your own bracket using the interactive bracket builder
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-gold-400 num text-xs mt-0.5">04</span>
                        Simulate each round and watch the leaderboard update
                    </li>
                </ul>
            </div>

            <Button
                variant="premium"
                size="lg"
                onClick={onSetup}
                disabled={isLoading}
                className="mx-auto"
            >
                {isLoading ? (
                    <>
                        <Loader className="w-5 h-5 animate-spin" />
                        Creating pool & entries...
                    </>
                ) : (
                    <>
                        <Zap className="w-5 h-5" />
                        Start Simulation
                    </>
                )}
            </Button>

            {/* Quick Load Options */}
            <div className="border-t border-[rgba(230,206,150,0.16)] pt-6">
                <h3 className="text-xs font-display font-bold text-[#9FB0CC] uppercase tracking-[0.08em] mb-4">Quick Test Options</h3>

                <div className="space-y-3">
                    {/* Load Tournament Data Only */}
                    <button
                        onClick={onLoadTournamentOnly}
                        disabled={isLoading}
                        className="w-full px-4 py-2.5 bg-navy-800 hover:bg-navy-700 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] text-white
                            border border-[rgba(230,206,150,0.16)] hover:border-gold-500/50 transition-ui duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        <Download className="w-4 h-4" /> Load Tournament Data Only
                    </button>

                    {/* Load Specific Round */}
                    <div className="bg-navy-900/60 border border-[rgba(230,206,150,0.16)] rounded-xl p-4">
                        <p className="text-xs text-[#9FB0CC] mb-3 font-body">Jump to specific round:</p>
                        <div className="grid grid-cols-6 gap-2">
                            {[1, 2, 3, 4, 5, 6].map(round => (
                                <button
                                    key={round}
                                    onClick={() => onLoadRound(round)}
                                    disabled={isLoading}
                                    className="px-3 py-2 bg-navy-800 hover:bg-gold-500 hover:text-navy-950 rounded-lg text-xs num text-white
                                        border border-[rgba(230,206,150,0.16)] hover:border-gold-400 transition-ui duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    R{round}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Clear Tournament */}
                    <button
                        onClick={onClearTournament}
                        disabled={isLoading}
                        className="w-full px-4 py-2 bg-navy-900 hover:bg-brandred-600/20 rounded-lg text-xs font-display font-bold uppercase tracking-[0.05em] text-[#9FB0CC] hover:text-brandred-500
                            border border-[rgba(230,206,150,0.16)] hover:border-brandred-600/50 transition-ui duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        <Trash2 className="w-4 h-4" /> Clear Tournament Data
                    </button>
                </div>
            </div>
        </div>
    </div>
);

const BracketPhase: React.FC<{
    tournament: Tournament;
    picks: Record<string, string>;
    onPick: (slotId: string, teamId: string) => void;
    pickCount: number;
    totalPicks: number;
    tieBreakerInput: string;
    onTieBreakerChange: (val: string) => void;
    onSubmit: () => void;
    onSkip: () => void;
    onRandomFill: (strategy: 'random' | 'chalk' | 'upset') => void;
    onClear: () => void;
    isLoading: boolean;
}> = ({ tournament, picks, onPick, pickCount, totalPicks, tieBreakerInput, onTieBreakerChange, onSubmit, onSkip, onRandomFill, onClear, isLoading }) => (
    <div className="space-y-4">
        {/* Progress bar */}
        <div className="bg-navy-900/60 border border-[rgba(230,206,150,0.16)] rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
                <div className="text-sm font-medium text-[#9FB0CC] font-body">
                    Picks: <span className="text-gold-400 font-bold num">{pickCount}</span> / <span className="num">{totalPicks}</span>
                </div>
                <div className="flex-1 max-w-xs bg-navy-800 rounded-full h-2 overflow-hidden">
                    <div
                        className="h-full w-full origin-left bg-gold-foil rounded-full transition-transform duration-300 ease-out"
                        style={{ transform: `scaleX(${totalPicks > 0 ? pickCount / totalPicks : 0})` }}
                    />
                </div>
                {pickCount === totalPicks && (
                    <span className="text-xs text-[#3CB371] font-medium flex items-center gap-1 font-body">
                        <Check className="w-3.5 h-3.5" /> All picks made!
                    </span>
                )}
            </div>

            <div className="flex items-center gap-3">
                {/* Tiebreaker */}
                <div className="flex items-center gap-2">
                    <label className="text-xs text-[#9FB0CC] font-body">Tiebreaker (total score):</label>
                    <input
                        type="number"
                        value={tieBreakerInput}
                        onChange={(e) => onTieBreakerChange(e.target.value)}
                        placeholder="e.g. 145"
                        className="w-20 bg-navy-800 border border-[rgba(230,206,150,0.16)] rounded-md px-2 py-1 text-sm text-white num focus:border-gold-500 focus:outline-none"
                    />
                </div>

                <button
                    onClick={onSkip}
                    className="text-xs text-[#9FB0CC] hover:text-white transition-colors duration-150 px-3 py-1.5"
                >
                    Skip →
                </button>

                <div className="h-6 w-px bg-navy-700 mx-2" />

                {/* Random Options */}
                <div className="flex items-center gap-1 bg-navy-800 rounded-lg p-0.5">
                    <button
                        onClick={() => onRandomFill('random')}
                        className="p-1.5 px-2 text-xs font-display font-bold uppercase tracking-[0.05em] text-[#9FB0CC] hover:text-white hover:bg-navy-700 rounded-md transition-colors duration-150 flex items-center gap-1"
                        title="Randomly fill remaining"
                    >
                        <Shuffle className="w-3.5 h-3.5" />
                        Random
                    </button>
                    <div className="h-4 w-px bg-navy-700" />
                    <button
                        onClick={() => onRandomFill('chalk')}
                        className="p-1.5 px-2 text-xs font-display font-bold uppercase tracking-[0.05em] text-[#9FB0CC] hover:text-white hover:bg-navy-700 rounded-md transition-colors duration-150"
                        title="Fill with favorites"
                    >
                        Chalk
                    </button>
                    <div className="h-4 w-px bg-navy-700" />
                    <button
                        onClick={() => onRandomFill('upset')}
                        className="p-1.5 px-2 text-xs font-display font-bold uppercase tracking-[0.05em] text-[#9FB0CC] hover:text-white hover:bg-navy-700 rounded-md transition-colors duration-150"
                        title="Fill with upsets"
                    >
                        Chaos
                    </button>
                </div>

                <div className="h-6 w-px bg-navy-700 mx-2" />

                <button
                    onClick={onClear}
                    className="p-1.5 text-[#9FB0CC] hover:text-brandred-500 hover:bg-brandred-600/10 rounded-md transition-colors duration-150"
                    title="Clear all picks"
                >
                    <Trash2 className="w-4 h-4" />
                </button>

                <div className="h-6 w-px bg-navy-700 mx-2" />

                <Button
                    variant="primary"
                    size="sm"
                    onClick={onSubmit}
                    disabled={isLoading || pickCount === 0}
                >
                    {isLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Submit Bracket
                </Button>
            </div>
        </div>

        {/* Bracket Builder */}
        <div className="bg-navy-900/40 border border-[rgba(230,206,150,0.16)] rounded-xl p-4 overflow-x-auto">
            <BracketBuilder
                tournament={tournament}
                picks={picks}
                onPick={onPick}
            />
        </div>
    </div>
);

const SimulationControls: React.FC<{
    currentRound: number;
    onSimulate: () => void;
    isLoading: boolean;
}> = ({ currentRound, onSimulate, isLoading }) => {
    const nextRound = currentRound + 1;
    const canSimulate = nextRound <= 6;

    return (
        <div className="bg-navy-900/60 border border-[rgba(230,206,150,0.16)] rounded-xl p-6 flex items-center justify-between">
            <div>
                <h2 className="text-lg font-display font-bold uppercase tracking-[0.03em]">
                    {canSimulate ? (
                        <>Next: <span className="text-gold-300">{ROUND_LABELS[nextRound]}</span></>
                    ) : (
                        <span className="text-[#3CB371]">Tournament Complete!</span>
                    )}
                </h2>
                <p className="text-xs text-[#9FB0CC] mt-1 font-body">
                    {canSimulate
                        ? `${GAMES_PER_ROUND[nextRound]} game${GAMES_PER_ROUND[nextRound] > 1 ? 's' : ''} to decide`
                        : 'All 63 games have been played'}
                </p>
            </div>

            {canSimulate && (
                <Button
                    variant="premium"
                    onClick={onSimulate}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        <>
                            <Loader className="w-5 h-5 animate-spin" />
                            Simulating...
                        </>
                    ) : (
                        <>
                            <Play className="w-5 h-5" />
                            {nextRound === 1 ? 'Start Simulation (Round of 64)' : `Simulate ${ROUND_LABELS[nextRound]}`}
                        </>
                    )}
                </Button>
            )}
        </div>
    );
};

const RoundResultCard: React.FC<{ result: RoundResult }> = ({ result }) => (
    <div className="bg-navy-900/40 border border-[rgba(230,206,150,0.16)] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
            <h3 className="font-display font-bold uppercase tracking-[0.05em] text-sm">
                <span className="text-gold-400">Round <span className="num">{result.round}</span></span>
                <span className="text-[#9FB0CC] ml-2">{result.label}</span>
            </h3>
            <span className="text-xs text-[#9FB0CC] font-body"><span className="num">{result.gamesDecided}</span> games decided</span>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
            <div>
                <div className="text-lg font-display font-bold text-white num">{result.topScore}</div>
                <div className="text-[10px] text-[#9FB0CC] uppercase tracking-[0.08em]">Leader Score</div>
            </div>
            <div>
                <div className="text-lg font-display font-bold text-brandred-500 num">{result.upsets.length}</div>
                <div className="text-[10px] text-[#9FB0CC] uppercase tracking-[0.08em]">Upsets</div>
            </div>
            <div>
                <div className="text-sm font-medium text-[#3CB371] truncate font-body">{result.topMover}</div>
                <div className="text-[10px] text-[#9FB0CC] uppercase tracking-[0.08em]">Top Mover</div>
            </div>
        </div>

        {result.upsets.length > 0 && (
            <div className="text-xs text-[#9FB0CC] border-t border-[rgba(230,206,150,0.12)] pt-2 space-y-0.5 font-body">
                {result.upsets.map((u, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-gold-400" />
                        {u}
                    </div>
                ))}
            </div>
        )}
    </div>
);

const ResultsBanner: React.FC<{
    winner: LeaderboardEntry;
    champTotal: number;
}> = ({ winner, champTotal }) => (
    <div className="bg-gold-500/10 border border-gold-500/30 rounded-xl p-8 text-center space-y-4">
        <Crown className="w-12 h-12 text-gold-400 mx-auto" />
        <div>
            <h2 className="text-2xl font-display font-bold uppercase tracking-[0.03em] text-gold-300">{winner.name}</h2>
            <p className="text-[#9FB0CC] text-sm mt-1 font-body">Tournament Champion</p>
        </div>
        <div className="flex justify-center gap-8">
            <div>
                <div className="text-3xl font-display font-bold text-white num">{winner.score}</div>
                <div className="text-xs text-[#9FB0CC] uppercase tracking-[0.08em]">Total Score</div>
            </div>
            <div>
                <div className="text-3xl font-display font-bold text-[#3CB371] num">{winner.correctPicks}</div>
                <div className="text-xs text-[#9FB0CC] uppercase tracking-[0.08em]">Correct Picks</div>
            </div>
            <div>
                <div className="text-3xl font-display font-bold text-gold-400 num">{winner.tieBreakerPrediction}</div>
                <div className="text-xs text-[#9FB0CC] uppercase tracking-[0.08em]">Tiebreaker (<span className="num">{champTotal}</span> actual)</div>
            </div>
        </div>
    </div>
);

const ControlValidation: React.FC<{ leaderboard: LeaderboardEntry[] }> = ({ leaderboard }) => {
    const perfect = leaderboard.find(e => e.name.includes('PerfectBracket'));
    const allChalk = leaderboard.find(e => e.name.includes('AllChalk'));
    const allUpset = leaderboard.find(e => e.name.includes('AllUpset'));
    const halfRight = leaderboard.find(e => e.name.includes('HalfRight'));

    const checks = [
        {
            label: 'PerfectBracket has highest score',
            passed: perfect && perfect === leaderboard[0],
            detail: `Score: ${perfect?.score || 0}`,
        },
        {
            label: 'AllChalk > AllUpset',
            passed: allChalk && allUpset && allChalk.score > allUpset.score,
            detail: `${allChalk?.score || 0} vs ${allUpset?.score || 0}`,
        },
        {
            label: 'AllChalk > HalfRight',
            passed: allChalk && halfRight && allChalk.score > halfRight.score,
            detail: `${allChalk?.score || 0} vs ${halfRight?.score || 0}`,
        },
    ];

    return (
        <div className="bg-navy-900/40 border border-[rgba(230,206,150,0.16)] rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-display font-bold uppercase tracking-[0.05em] text-[#EDF1F8]">Control Entry Validation</h3>
            {checks.map((check, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                        {check.passed ? (
                            <Check className="w-4 h-4 text-[#3CB371]" />
                        ) : (
                            <AlertTriangle className="w-4 h-4 text-brandred-500" />
                        )}
                        <span className={`font-body ${check.passed ? 'text-[#9FB0CC]' : 'text-brandred-500'}`}>{check.label}</span>
                    </div>
                    <span className="text-xs text-[#9FB0CC] num">{check.detail}</span>
                </div>
            ))}
        </div>
    );
};

const LeaderboardSidebar = ({
    leaderboard,
    currentRound,
    entryCount,
    onEntryClick,
}: {
    leaderboard: LeaderboardEntry[];
    currentRound: number;
    entryCount: number;
    onEntryClick: (entry: LeaderboardEntry) => void;
}) => {
    const avgScore = leaderboard.length > 0
        ? Math.round(leaderboard.reduce((s, e) => s + e.score, 0) / leaderboard.length)
        : 0;
    const eliminated = leaderboard.filter(e => e.maxPossible < (leaderboard[0]?.score || 0)).length;

    return (
        <div className="bg-navy-900/60 border border-[rgba(230,206,150,0.16)] rounded-xl overflow-hidden sticky top-32">
            {/* Header */}
            <div className="p-4 border-b border-[rgba(230,206,150,0.16)] bg-navy-900/80">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="font-display font-bold uppercase tracking-[0.05em] text-sm flex items-center gap-2">
                        <Users className="w-4 h-4 text-gold-400" />
                        Leaderboard
                    </h3>
                    {currentRound > 0 && (
                        <span className="text-[10px] bg-navy-800 text-[#9FB0CC] px-2 py-0.5 rounded-full num">
                            After R{currentRound}
                        </span>
                    )}
                </div>
                {currentRound > 0 && (
                    <div className="flex gap-4 text-[10px] text-[#9FB0CC] font-body">
                        <span>Entries: <span className="text-[#EDF1F8] num">{entryCount}</span></span>
                        <span>Avg: <span className="text-[#EDF1F8] num">{avgScore}</span></span>
                        <span>Eliminated: <span className="text-brandred-500 num">{eliminated}</span></span>
                    </div>
                )}
            </div>

            {/* Entries */}
            {leaderboard.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#9FB0CC] font-body">
                    Simulate a round to see the leaderboard
                </div>
            ) : (
                <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                    {leaderboard.map((entry, idx) => {
                        const rank = idx + 1;
                        const rankChange = entry.previousRank > 0 ? entry.previousRank - rank : 0;
                        const isEliminated = entry.maxPossible < (leaderboard[0]?.score || 0);

                        return (
                            <div
                                key={entry.id}
                                className={`
                                    px-4 py-2 flex items-center gap-3 text-sm border-b border-[rgba(230,206,150,0.10)] transition-ui duration-150 cursor-pointer hover:bg-navy-800/50
                                    ${entry.isUser ? 'bg-brandred-600/15 border-l-2 border-l-brandred-500' : ''}
                                    ${rank <= 3 ? 'bg-gold-500/5' : ''}
                                    ${isEliminated ? 'opacity-40 hover:opacity-100' : ''}
                                `}
                                onClick={() => onEntryClick(entry)}
                            >
                                {/* Rank */}
                                <div className={`w-6 text-center num text-xs font-bold ${rank === 1 ? 'text-gold-400' : rank === 2 ? 'text-[#EDF1F8]' : rank === 3 ? 'text-gold-600' : 'text-[#5E7096]'
                                    }`}>
                                    {rank}
                                </div>

                                {/* Rank change indicator */}
                                <div className="w-4">
                                    {rankChange > 0 && <ArrowUp className="w-3 h-3 text-[#3CB371]" />}
                                    {rankChange < 0 && <ArrowDown className="w-3 h-3 text-brandred-500" />}
                                    {rankChange === 0 && entry.previousRank > 0 && <Minus className="w-3 h-3 text-[#5E7096]" />}
                                </div>

                                {/* Name */}
                                <div className="flex-1 min-w-0">
                                    <div className={`text-xs font-medium truncate font-body ${entry.isUser ? 'text-brandred-500 font-bold' : 'text-[#EDF1F8]'}`}>
                                        {entry.name}
                                        {entry.isUser && <span className="text-[10px] ml-1 text-brandred-500 font-display font-bold uppercase tracking-[0.06em]">◄ You</span>}
                                    </div>
                                    {entry.isControl && (
                                        <span className="text-[9px] text-[#8655B5] bg-[#5B2A86]/20 px-1 rounded font-display font-bold uppercase tracking-[0.06em]">CTRL</span>
                                    )}
                                </div>

                                {/* Score */}
                                <div className="text-right">
                                    <div className="text-xs font-bold text-white num">{entry.score}</div>
                                    <div className="text-[9px] text-[#9FB0CC] num">{entry.correctPicks} picks</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TournamentSimulator;
