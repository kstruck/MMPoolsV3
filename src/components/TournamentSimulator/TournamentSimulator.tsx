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
import { getFirestore, collection, addDoc, getDocs, updateDoc, setDoc, doc } from 'firebase/firestore';
import { BracketBuilder } from '../BracketBuilder/BracketBuilder';
import { calculateScore } from '../BracketPoolDashboard/bracketScoring';
import {
    generateTournament2025,
    revealRound,
    getChampionshipTotal,
    TEAMS,
    GAMES_PER_ROUND,
} from '../../utils/testing/data/tournament2025';
import { generateEntries, generateControlEntries } from '../../utils/testing/data/testEntryGenerator';
import type { Tournament, BracketEntry, BracketPool } from '../../types';
import {
    Play, RotateCcw, Trophy, Users, ChevronRight, Check,
    Zap, Crown, ArrowUp, ArrowDown, Minus, Loader, AlertTriangle
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

export const TournamentSimulator: React.FC = () => {
    // Phase state
    const [phase, setPhase] = useState<SimPhase>('SETUP');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Pool / Tournament state
    const [poolId, setPoolId] = useState<string | null>(null);
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



    // ─── PHASE 1: SETUP ──────────────────────────────────────────

    const handleSetup = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const db = getFirestore();

            // 1. Generate tournament (all games SCHEDULED)
            const newTournament = generateTournament2025();
            setTournament(newTournament);

            // 2. Write tournament to Firestore
            await setDoc(doc(db, 'tournaments', 'mens-2025-sim'), newTournament);

            // 3. Create pool document
            const poolData = {
                type: 'BRACKET',
                name: '🏀 Tournament Simulator Pool',
                slug: `sim-${Date.now()}`,
                slugLower: `sim-${Date.now()}`,
                isListedPublic: false,
                status: 'PUBLISHED',
                lockAt: Date.now() + 86400000,
                settings: POOL_SETTINGS,
                managerUid: 'simulator',
                seasonYear: 2025,
                gender: 'mens',
                tournamentId: 'mens-2025-sim',
                createdAt: Date.now(),
                participantCount: 0,
                entryCount: 0,
            };

            const poolRef = await addDoc(collection(db, 'pools'), poolData);
            const newPoolId = poolRef.id;
            setPoolId(newPoolId);

            // 4. Generate entries (50 random + 3 controls)
            const randomEntries = generateEntries(50, {
                chalkBias: 0.65,
                seed: 42,
                includePerfectBracket: true,
            });
            const controlEntries = generateControlEntries();
            const allEntries = [...randomEntries, ...controlEntries];

            // 5. Write entries to Firestore
            // NOTE: getCorrectPicks() uses slot-prefixed keys (slot-R1-E1).
            // But BracketBuilder uses game.id keys (R1-E1).
            // The scoring engine (calculateScore) iterates tournament.slots and 
            // looks up entry.picks[slot.id], so picks MUST be keyed by slot.id.
            // The test data generator already uses slot-prefixed keys via getCorrectPicks(), so they're correct.
            for (const entry of allEntries) {
                const entryData: Omit<BracketEntry, 'id'> = {
                    poolId: newPoolId,
                    ownerUid: `sim-${entry.userName.replace(/\s/g, '-')}`,
                    name: `${entry.userName}'s Bracket`,
                    picks: entry.picks, // Already keyed by slot.id from getCorrectPicks
                    tieBreakerPrediction: entry.tiebreakerPrediction,
                    status: 'SUBMITTED',
                    paidStatus: 'PAID',
                    score: 0,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };
                await addDoc(collection(db, 'pools', newPoolId, 'entries'), entryData);
            }

            setEntryCount(allEntries.length);
            setPhase('BRACKET');
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error('[Simulator] Setup failed:', e);
            setError(`Setup failed: ${errMsg}`);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // ─── PHASE 2: FILL BRACKET ──────────────────────────────────

    const handlePick = useCallback((slotId: string, teamId: string) => {
        // BracketBuilder calls onPick(game.id, teamId). We store as game.id here,
        // then convert to slot-prefixed keys when submitting.
        setUserPicks(prev => ({ ...prev, [slotId]: teamId }));
    }, []);

    const userPickCount = Object.keys(userPicks).length;
    const totalPicks = 63; // 32 + 16 + 8 + 4 + 2 + 1

    const handleSubmitBracket = useCallback(async () => {
        if (!poolId || !tournament) return;

        const tiebreaker = parseInt(tieBreakerInput, 10);
        if (isNaN(tiebreaker) || tiebreaker < 0) {
            setError('Please enter a valid tiebreaker prediction (total championship score).');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const db = getFirestore();

            // Convert game.id picks → slot.id picks for scoring compatibility
            const slotPicks: Record<string, string> = {};
            for (const [gameId, teamId] of Object.entries(userPicks)) {
                slotPicks[`slot-${gameId}`] = teamId;
            }

            const entryData: Omit<BracketEntry, 'id'> = {
                poolId,
                ownerUid: 'simulator-user',
                name: "Your Bracket",
                picks: slotPicks,
                tieBreakerPrediction: tiebreaker,
                status: 'SUBMITTED',
                paidStatus: 'PAID',
                score: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const entryRef = await addDoc(collection(db, 'pools', poolId, 'entries'), entryData);
            setUserEntryId(entryRef.id);
            setEntryCount(prev => prev + 1);
            setPhase('SIMULATION');
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error('[Simulator] Submit failed:', e);
            setError(`Submit failed: ${errMsg}`);
        } finally {
            setIsLoading(false);
        }
    }, [poolId, tournament, userPicks, tieBreakerInput]);

    const handleSkipBracket = useCallback(() => {
        setPhase('SIMULATION');
    }, []);

    // ─── PHASE 3: SIMULATION ────────────────────────────────────

    const handleSimulateRound = useCallback(async () => {
        if (!poolId || !tournament) return;

        const nextRound = currentRound + 1;
        if (nextRound > 6) return;

        setIsLoading(true);
        setError(null);

        try {
            const db = getFirestore();

            // 1. Reveal round results
            const updatedTournament = revealRound(tournament, nextRound);
            setTournament(updatedTournament);

            // 2. Update tournament in Firestore
            await setDoc(doc(db, 'tournaments', 'mens-2025-sim'), updatedTournament);

            // 3. Read all entries and recalculate scores
            const entriesSnap = await getDocs(collection(db, 'pools', poolId, 'entries'));
            const previousLeaderboard = [...leaderboard];
            const previousRankMap = new Map(previousLeaderboard.map((e, i) => [e.id, i + 1]));

            const newLeaderboard: LeaderboardEntry[] = [];

            for (const entryDoc of entriesSnap.docs) {
                const entry = { id: entryDoc.id, ...entryDoc.data() } as BracketEntry;
                const scoringResult = calculateScore(entry, updatedTournament, POOL_SETTINGS);

                // Update score in Firestore
                await updateDoc(entryDoc.ref, {
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
            console.error('[Simulator] Round simulation failed:', e);
            setError(`Round ${nextRound} failed: ${errMsg}`);
        } finally {
            setIsLoading(false);
        }
    }, [poolId, tournament, currentRound, leaderboard, userEntryId]);

    // ─── RESET ──────────────────────────────────────────────────

    const handleReset = useCallback(() => {
        setPhase('SETUP');
        setPoolId(null);
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

    // ─── RENDER ─────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            {/* Header */}
            <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-20">
                <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Trophy className="w-6 h-6 text-amber-400" />
                        <h1 className="text-xl font-bold tracking-tight">Tournament Simulator</h1>
                        <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                            2025 NCAA Men's
                        </span>
                    </div>
                    {phase !== 'SETUP' && (
                        <button
                            onClick={handleReset}
                            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
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
                                        flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium flex-1 transition-all
                                        ${isCurrent ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : ''}
                                        ${isComplete ? 'bg-emerald-500/10 text-emerald-400' : ''}
                                        ${!isCurrent && !isComplete ? 'text-slate-600' : ''}
                                    `}>
                                        {isComplete ? (
                                            <Check className="w-3.5 h-3.5" />
                                        ) : (
                                            <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">
                                                {i + 1}
                                            </span>
                                        )}
                                        {PHASE_LABELS[p]}
                                        {p === 'SIMULATION' && currentRound > 0 && isCurrent && (
                                            <span className="text-[10px] opacity-70">R{currentRound}/6</span>
                                        )}
                                    </div>
                                    {i < 3 && <ChevronRight className="w-3 h-3 text-slate-700 mx-1 flex-shrink-0" />}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </header>

            {/* Error Banner */}
            {error && (
                <div className="max-w-7xl mx-auto px-4 mt-4">
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2 text-red-300 text-sm">
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
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── SUB-COMPONENTS ─────────────────────────────────────────────

const SetupPhase: React.FC<{
    onSetup: () => void;
    isLoading: boolean;
}> = ({ onSetup, isLoading }) => (
    <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-8 max-w-lg">
            <div className="space-y-3">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/20">
                    <Trophy className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight">Tournament Simulator</h2>
                <p className="text-slate-400 text-sm leading-relaxed">
                    Experience a full NCAA bracket pool tournament lifecycle using real 2025 data.
                    Generate 50+ opponents, fill your bracket, and watch the leaderboard unfold round by round.
                </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">What happens:</h3>
                <ul className="text-sm text-slate-400 space-y-2 text-left">
                    <li className="flex items-start gap-2">
                        <span className="text-indigo-400 font-mono text-xs mt-0.5">01</span>
                        Create a test pool with CLASSIC scoring (10/20/40/80/160/320)
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-indigo-400 font-mono text-xs mt-0.5">02</span>
                        Generate 50 random entries + PerfectBracket + 3 control entries
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-indigo-400 font-mono text-xs mt-0.5">03</span>
                        Fill your own bracket using the interactive bracket builder
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-indigo-400 font-mono text-xs mt-0.5">04</span>
                        Simulate each round and watch the leaderboard update
                    </li>
                </ul>
            </div>

            <button
                onClick={onSetup}
                disabled={isLoading}
                className="px-8 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl font-semibold text-white 
                    hover:from-indigo-400 hover:to-purple-500 transition-all shadow-lg shadow-indigo-500/20 
                    disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
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
            </button>
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
    isLoading: boolean;
}> = ({ tournament, picks, onPick, pickCount, totalPicks, tieBreakerInput, onTieBreakerChange, onSubmit, onSkip, isLoading }) => (
    <div className="space-y-4">
        {/* Progress bar */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
                <div className="text-sm font-medium text-slate-300">
                    Picks: <span className="text-indigo-400 font-bold">{pickCount}</span> / {totalPicks}
                </div>
                <div className="flex-1 max-w-xs bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300"
                        style={{ width: `${(pickCount / totalPicks) * 100}%` }}
                    />
                </div>
                {pickCount === totalPicks && (
                    <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> All picks made!
                    </span>
                )}
            </div>

            <div className="flex items-center gap-3">
                {/* Tiebreaker */}
                <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500">Tiebreaker (total score):</label>
                    <input
                        type="number"
                        value={tieBreakerInput}
                        onChange={(e) => onTieBreakerChange(e.target.value)}
                        placeholder="e.g. 145"
                        className="w-20 bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    />
                </div>

                <button
                    onClick={onSkip}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-3 py-1.5"
                >
                    Skip →
                </button>

                <button
                    onClick={onSubmit}
                    disabled={isLoading || pickCount === 0}
                    className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed
                        rounded-lg text-sm font-medium text-white transition-colors flex items-center gap-1.5"
                >
                    {isLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Submit Bracket
                </button>
            </div>
        </div>

        {/* Bracket Builder */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 overflow-x-auto">
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
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 flex items-center justify-between">
            <div>
                <h2 className="text-lg font-bold">
                    {canSimulate ? (
                        <>Next: <span className="text-indigo-300">{ROUND_LABELS[nextRound]}</span></>
                    ) : (
                        <span className="text-emerald-400">Tournament Complete!</span>
                    )}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                    {canSimulate
                        ? `${GAMES_PER_ROUND[nextRound]} game${GAMES_PER_ROUND[nextRound] > 1 ? 's' : ''} to decide`
                        : 'All 63 games have been played'}
                </p>
            </div>

            {canSimulate && (
                <button
                    onClick={onSimulate}
                    disabled={isLoading}
                    className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl font-semibold text-white
                        hover:from-amber-400 hover:to-orange-400 transition-all shadow-lg shadow-amber-500/20
                        disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    {isLoading ? (
                        <>
                            <Loader className="w-5 h-5 animate-spin" />
                            Simulating...
                        </>
                    ) : (
                        <>
                            <Play className="w-5 h-5" />
                            Simulate {ROUND_LABELS[nextRound]}
                        </>
                    )}
                </button>
            )}
        </div>
    );
};

const RoundResultCard: React.FC<{ result: RoundResult }> = ({ result }) => (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm">
                <span className="text-amber-400">Round {result.round}</span>
                <span className="text-slate-500 ml-2">{result.label}</span>
            </h3>
            <span className="text-xs text-slate-500">{result.gamesDecided} games decided</span>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
            <div>
                <div className="text-lg font-bold text-white">{result.topScore}</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Leader Score</div>
            </div>
            <div>
                <div className="text-lg font-bold text-orange-400">{result.upsets.length}</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Upsets</div>
            </div>
            <div>
                <div className="text-sm font-medium text-emerald-400 truncate">{result.topMover}</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Top Mover</div>
            </div>
        </div>

        {result.upsets.length > 0 && (
            <div className="text-xs text-slate-400 border-t border-slate-800 pt-2 space-y-0.5">
                {result.upsets.map((u, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-orange-400" />
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
    <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-xl p-8 text-center space-y-4">
        <Crown className="w-12 h-12 text-amber-400 mx-auto" />
        <div>
            <h2 className="text-2xl font-bold text-amber-300">{winner.name}</h2>
            <p className="text-slate-400 text-sm mt-1">Tournament Champion</p>
        </div>
        <div className="flex justify-center gap-8">
            <div>
                <div className="text-3xl font-bold text-white">{winner.score}</div>
                <div className="text-xs text-slate-500 uppercase">Total Score</div>
            </div>
            <div>
                <div className="text-3xl font-bold text-emerald-400">{winner.correctPicks}</div>
                <div className="text-xs text-slate-500 uppercase">Correct Picks</div>
            </div>
            <div>
                <div className="text-3xl font-bold text-indigo-400">{winner.tieBreakerPrediction}</div>
                <div className="text-xs text-slate-500 uppercase">Tiebreaker ({champTotal} actual)</div>
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
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-300">Control Entry Validation</h3>
            {checks.map((check, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                        {check.passed ? (
                            <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                            <AlertTriangle className="w-4 h-4 text-red-400" />
                        )}
                        <span className={check.passed ? 'text-slate-300' : 'text-red-300'}>{check.label}</span>
                    </div>
                    <span className="text-xs text-slate-500">{check.detail}</span>
                </div>
            ))}
        </div>
    );
};

const LeaderboardSidebar = ({
    leaderboard,
    currentRound,
    entryCount,
}: {
    leaderboard: LeaderboardEntry[];
    currentRound: number;
    entryCount: number;
}) => {
    const avgScore = leaderboard.length > 0
        ? Math.round(leaderboard.reduce((s, e) => s + e.score, 0) / leaderboard.length)
        : 0;
    const eliminated = leaderboard.filter(e => e.maxPossible < (leaderboard[0]?.score || 0)).length;

    return (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden sticky top-32">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-900/80">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-sm flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-400" />
                        Leaderboard
                    </h3>
                    {currentRound > 0 && (
                        <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                            After R{currentRound}
                        </span>
                    )}
                </div>
                {currentRound > 0 && (
                    <div className="flex gap-4 text-[10px] text-slate-500">
                        <span>Entries: <span className="text-slate-300">{entryCount}</span></span>
                        <span>Avg: <span className="text-slate-300">{avgScore}</span></span>
                        <span>Eliminated: <span className="text-red-400">{eliminated}</span></span>
                    </div>
                )}
            </div>

            {/* Entries */}
            {leaderboard.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-600">
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
                                    px-4 py-2 flex items-center gap-3 text-sm border-b border-slate-800/50 transition-all
                                    ${entry.isUser ? 'bg-indigo-500/10 border-l-2 border-l-indigo-400' : ''}
                                    ${rank <= 3 ? 'bg-amber-500/5' : ''}
                                    ${isEliminated ? 'opacity-40' : ''}
                                `}
                            >
                                {/* Rank */}
                                <div className={`w-6 text-center font-mono text-xs font-bold ${rank === 1 ? 'text-amber-400' : rank === 2 ? 'text-slate-300' : rank === 3 ? 'text-orange-400' : 'text-slate-600'
                                    }`}>
                                    {rank}
                                </div>

                                {/* Rank change indicator */}
                                <div className="w-4">
                                    {rankChange > 0 && <ArrowUp className="w-3 h-3 text-emerald-400" />}
                                    {rankChange < 0 && <ArrowDown className="w-3 h-3 text-red-400" />}
                                    {rankChange === 0 && entry.previousRank > 0 && <Minus className="w-3 h-3 text-slate-700" />}
                                </div>

                                {/* Name */}
                                <div className="flex-1 min-w-0">
                                    <div className={`text-xs font-medium truncate ${entry.isUser ? 'text-indigo-300' : 'text-slate-300'}`}>
                                        {entry.name}
                                        {entry.isUser && <span className="text-[10px] ml-1 text-indigo-400">◄ YOU</span>}
                                    </div>
                                    {entry.isControl && (
                                        <span className="text-[9px] text-purple-400 bg-purple-400/10 px-1 rounded">CTRL</span>
                                    )}
                                </div>

                                {/* Score */}
                                <div className="text-right">
                                    <div className="text-xs font-bold text-white">{entry.score}</div>
                                    <div className="text-[9px] text-slate-600">{entry.correctPicks} picks</div>
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
