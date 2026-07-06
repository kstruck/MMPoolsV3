import { logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../firebase';
import { dbService } from '../services/dbService';
import { simulatePoolGame, fillGridWithBlanks } from '../utils/simulationUtils';
import { AuditLogViewer } from './AuditLogViewer';
import type { GameState, Pool, Winner, Square } from '../types';
import { Play, Settings, Users, Activity, Trophy } from 'lucide-react';

interface SimulationDashboardProps {
    pools: Pool[];
    onClose: () => void;
}

export const SimulationDashboard: React.FC<SimulationDashboardProps> = ({ pools, onClose }) => {
    const [selectedPoolId, setSelectedPoolId] = useState<string>('');
    const [selectedPool, setSelectedPool] = useState<GameState | null>(null);
    const [blanksToLeave, setBlanksToLeave] = useState(5);
    const [simStatus, setSimStatus] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [winners, setWinners] = useState<Winner[]>([]);

    // Filter for Football squares pools only. This dashboard drives the squares
    // engine (simulatePoolGame + fillGridWithBlanks) and reads `.squares`, which
    // only SQUARES pools have. Previously filtered `!== 'BRACKET'`, which let
    // PROPS/PICKEM/SURVIVOR/MARGIN pools through and crashed the whole app via
    // the global ErrorBoundary on `.squares.filter` (undefined).
    const validPools = pools.filter(p => p.type === 'SQUARES');

    useEffect(() => {
        if (selectedPoolId) {
            const pool = pools.find(p => p.id === selectedPoolId) as GameState;
            setSelectedPool(pool || null);

            // Subscribe to Winners
            const q = query(collection(db, 'pools', selectedPoolId, 'winners'));
            const unsub = onSnapshot(q, (snap) => {
                const wins = snap.docs.map(d => d.data() as Winner);
                setWinners(wins);
            });
            return () => unsub();
        } else {
            setSelectedPool(null);
            setWinners([]);
        }
    }, [selectedPoolId, pools]);

    const handleAction = async (actionName: string, actionFn: () => Promise<any>) => {
        setIsLoading(true);
        setSimStatus(`Running: ${actionName}...`);
        try {
            const res = await actionFn();
            setSimStatus(res || `Success: ${actionName}`);
        } catch (e: any) {
            logger.error(e);
            setSimStatus(`Error: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleRule = async (rule: string, value: boolean) => {
        if (!selectedPool) return;
        const updates: any = {};
        if (rule === 'scoreChangePayout') updates['ruleVariations.scoreChangePayout'] = value;
        if (rule === 'rollover') updates['ruleVariations.quarterlyRollover'] = value;
        if (rule === 'reverseWinners') updates['ruleVariations.reverseWinners'] = value;

        await handleAction(`Toggle ${rule}`, () => dbService.updatePool(selectedPool.id, updates));
    };

    const runSimStep = async (step: string) => {
        if (!selectedPool) return;

        // Construct next state based on current
        const scores = selectedPool.scores || { current: { home: 0, away: 0 } };
        let nextState: any = { ...scores };

        // Helper to parse scores
        const h = scores.current?.home || 0;
        const a = scores.current?.away || 0;

        switch (step) {
            case 'START':
                nextState = { gameStatus: 'in', period: 1, clock: '15:00', current: { home: 0, away: 0 } };
                break;
            case 'HOME+7':
                nextState.current = { home: h + 7, away: a };
                nextState.clock = '10:00';
                break;
            case 'AWAY+7':
                nextState.current = { home: h, away: a + 7 };
                nextState.clock = '9:00';
                break;
            case 'HOME+3':
                nextState.current = { home: h + 3, away: a };
                break;
            case 'AWAY+3':
                nextState.current = { home: h, away: a + 3 };
                break;
            case 'HOME+2':
                nextState.current = { home: h + 2, away: a };
                break;
            case 'AWAY+2':
                nextState.current = { home: h, away: a + 2 };
                break;
            case 'END_Q1':
                nextState.period = 2;
                nextState.q1 = { ...nextState.current };
                nextState.clock = '15:00';
                break;
            case 'END_HALF':
                nextState.period = 3;
                nextState.half = { ...nextState.current };
                nextState.clock = '15:00';
                break;
            case 'END_Q3':
                nextState.period = 4;
                nextState.q3 = { ...nextState.current };
                nextState.clock = '15:00';
                break;
            case 'FINAL':
                nextState.gameStatus = 'post';
                nextState.final = { ...nextState.current };
                nextState.clock = '0:00';
                break;
            case 'RESET':
                nextState = { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre', startTime: new Date().toISOString() };
                break;
        }

        await handleAction(`Sim: ${step}`, () => simulatePoolGame(selectedPool.id, nextState));
    };

    if (!selectedPoolId) {
        return (
            <div className="fixed inset-0 bg-page z-50 overflow-auto p-8">
                <div className="max-w-4xl mx-auto">
                    <div className="flex justify-between items-center mb-8">
                        <h1 className="text-3xl font-display font-extrabold uppercase leading-none text-[color:var(--text)] flex items-center gap-3">
                            <Activity className="text-gold-600 dark:text-gold-400" /> Simulation Dashboard <span className="text-xs font-display font-bold bg-card border border-line text-gold-700 dark:text-gold-400 px-2 py-0.5 rounded-full num">v2.1</span>
                        </h1>
                        <button onClick={onClose} className="text-muted hover:text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150">Close</button>
                    </div>

                    <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                        <h2 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-4">Select a Pool to Simulate</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {validPools.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => setSelectedPoolId(p.id)}
                                    className="p-4 bg-surface hover:bg-card border border-line hover:border-gold-500/40 rounded-lg text-left transition-all duration-150 group"
                                >
                                    <div className="font-display font-bold uppercase text-[color:var(--text)] group-hover:text-gold-700 dark:group-hover:text-gold-400">{p.name}</div>
                                    <div className="text-xs text-faint font-mono mt-1">{p.id}</div>
                                    <div className="text-xs text-muted font-body mt-2 num">
                                        {((p as GameState).squares ?? []).filter((s: Square) => s.owner).length}/100 Filled • {(p as GameState).isLocked ? 'LOCKED' : 'OPEN'}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-page z-50 overflow-auto flex flex-col">
            {/* Header */}
            <div className="bg-surface border-b border-line p-4 sticky top-0 z-10 shadow-panel">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSelectedPoolId('')} className="text-gold-700 dark:text-gold-400 hover:text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors duration-150">← Back</button>
                        <h1 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                            Simulating: <span className="text-gold-700 dark:text-gold-400">{selectedPool?.name}</span>
                        </h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-xs font-mono text-muted">
                            {simStatus && <span className="bg-card border border-line px-2 py-1 rounded text-gold-700 dark:text-gold-400 animate-pulse">{simStatus}</span>}
                        </div>
                        <button onClick={onClose} className="text-muted hover:text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150">Exit Dashboard</button>
                    </div>
                </div>
            </div>

            <div className="flex-1 p-6 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* LEFT COL: Config & Grid */}
                <div className="space-y-6">
                    {/* Rules */}
                    <div className="bg-card border border-line rounded-xl p-5 shadow-card">
                        <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.12em] mb-4 flex items-center gap-2"><Settings size={16} /> Rules Config</h3>
                        <div className="space-y-3">
                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-surface rounded">
                                <span className="text-[color:var(--text)] font-body font-medium">Every Score Pays</span>
                                <input
                                    type="checkbox"
                                    checked={selectedPool?.ruleVariations?.scoreChangePayout || false}
                                    onChange={(e) => toggleRule('scoreChangePayout', e.target.checked)}
                                    className="w-5 h-5 accent-gold-500 rounded"
                                />
                            </label>
                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-surface rounded">
                                <span className="text-[color:var(--text)] font-body font-medium">Rollover (Unclaimed Wins)</span>
                                <input
                                    type="checkbox"
                                    checked={selectedPool?.ruleVariations?.quarterlyRollover || false}
                                    onChange={(e) => toggleRule('rollover', e.target.checked)}
                                    className="w-5 h-5 accent-gold-500 rounded"
                                />
                            </label>
                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-surface rounded">
                                <span className="text-[color:var(--text)] font-body font-medium">Reverse Winners</span>
                                <input
                                    type="checkbox"
                                    checked={selectedPool?.ruleVariations?.reverseWinners || false}
                                    onChange={(e) => toggleRule('reverseWinners', e.target.checked)}
                                    className="w-5 h-5 accent-gold-500 rounded"
                                />
                            </label>
                            <div className="flex items-center justify-between p-2 mt-2 bg-surface rounded pointer-events-none opacity-50">
                                <span className="text-muted font-body text-sm">Current Numbers</span>
                                <span className="text-xs font-mono text-faint num">
                                    {selectedPool?.numberSets === 4 ? 'Quarterly' : 'Single Set'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Grid Filler */}
                    <div className="bg-card border border-line rounded-xl p-5 shadow-card">
                        <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.12em] mb-4 flex items-center gap-2"><Users size={16} /> Grid Population</h3>
                        <div className="space-y-4">
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-[color:var(--text)] font-body">Leave Empty Squares</span>
                                    <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">{blanksToLeave}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="50"
                                    value={blanksToLeave}
                                    onChange={(e) => setBlanksToLeave(parseInt(e.target.value))}
                                    className="w-full h-2 bg-line rounded-lg appearance-none cursor-pointer accent-gold-500"
                                />
                            </div>
                            <button
                                onClick={() => handleAction(`Filling Grid (leave ${blanksToLeave})`, () => fillGridWithBlanks(selectedPoolId, blanksToLeave))}
                                disabled={isLoading}
                                className="w-full bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] py-2 rounded-lg transition-all duration-150 hover:-translate-y-px shadow-red-cta flex items-center justify-center gap-2"
                            >
                                <Users size={18} /> Fill Grid
                            </button>
                            <div className="text-center text-xs text-faint font-body mt-2 num">
                                Current Fill: {(selectedPool?.squares ?? []).filter(s => s.owner).length}/100
                            </div>
                        </div>
                    </div>
                </div>

                {/* MIDDLE COL: Scenario Runner */}
                <div className="bg-card border border-line rounded-xl p-6 shadow-card flex flex-col">
                    <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.12em] mb-4 flex items-center gap-2"><Play size={16} /> Game Scenario Runner</h3>

                    <div className="flex-1 space-y-4">
                        {/* Status Display */}
                        <div className="bg-navy-950 rounded-xl p-4 border border-[rgba(230,206,150,0.16)] text-center mb-6">
                            <div className="text-xs font-display font-bold text-[#9FB0CC] uppercase tracking-[0.16em] mb-1">Game Status</div>
                            <div className="text-2xl font-display font-bold uppercase text-[#EDF1F8] mb-2 num">
                                {selectedPool?.scores?.gameStatus === 'pre' ? 'PRE-GAME' :
                                    selectedPool?.scores?.gameStatus === 'post' ? 'FINAL' :
                                        `Q${selectedPool?.scores?.period || '-'} • ${selectedPool?.scores?.clock || '--'}`}
                            </div>
                            <div className="flex justify-center items-center gap-8 text-xl font-display font-bold num">
                                <div className="text-gold-400">HOME {selectedPool?.scores?.current?.home || 0}</div>
                                <div className="text-[#9FB0CC]">vs</div>
                                <div className="text-brandred-500">AWAY {selectedPool?.scores?.current?.away || 0}</div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => runSimStep('START')} className="bg-brandred-600 hover:bg-brandred-500 p-3 rounded font-display font-bold uppercase tracking-[0.05em] text-white transition-all duration-150 hover:-translate-y-px shadow-red-cta">Start Game</button>
                            <button onClick={() => runSimStep('RESET')} className="border-[1.5px] border-navy-800 text-navy-800 hover:bg-navy-800 hover:text-white dark:border-[color:var(--line)] dark:text-[color:var(--text)] dark:hover:bg-white/10 dark:hover:text-white p-3 rounded font-display font-bold uppercase tracking-[0.05em] transition-all duration-150">Reset</button>

                            <div className="col-span-2 text-xs text-faint font-display font-bold uppercase tracking-[0.08em] mt-2">Score Events</div>
                            <button onClick={() => runSimStep('HOME+7')} className="w-full bg-surface hover:bg-card border border-navy-600/40 text-navy-700 dark:text-gold-400 p-2 rounded font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 num">Home TD (+7)</button>
                            <button onClick={() => runSimStep('AWAY+7')} className="w-full bg-surface hover:bg-card border border-brandred-600/40 text-brandred-600 p-2 rounded font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 num">Away TD (+7)</button>
                            <button onClick={() => runSimStep('HOME+3')} className="w-full bg-surface hover:bg-card border border-navy-600/40 text-navy-700 dark:text-gold-400 p-2 rounded font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 num">Home FG (+3)</button>
                            <button onClick={() => runSimStep('AWAY+3')} className="w-full bg-surface hover:bg-card border border-brandred-600/40 text-brandred-600 p-2 rounded font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 num">Away FG (+3)</button>
                            <button onClick={() => runSimStep('HOME+2')} className="w-full bg-surface hover:bg-card border border-navy-600/40 text-navy-700 dark:text-gold-400 p-2 rounded font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 num">Home 2-Pt (+2)</button>
                            <button onClick={() => runSimStep('AWAY+2')} className="w-full bg-surface hover:bg-card border border-brandred-600/40 text-brandred-600 p-2 rounded font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 num">Away 2-Pt (+2)</button>

                            <div className="col-span-2 text-xs text-faint font-display font-bold uppercase tracking-[0.08em] mt-2">Progresion</div>
                            <button onClick={() => runSimStep('END_Q1')} className="bg-navy-800 hover:bg-navy-700 p-2 rounded font-display font-bold uppercase tracking-[0.05em] text-white transition-all duration-150">End Q1</button>
                            <button onClick={() => runSimStep('END_HALF')} className="bg-navy-800 hover:bg-navy-700 p-2 rounded font-display font-bold uppercase tracking-[0.05em] text-white transition-all duration-150">End Half</button>
                            <button onClick={() => runSimStep('END_Q3')} className="bg-navy-800 hover:bg-navy-700 p-2 rounded font-display font-bold uppercase tracking-[0.05em] text-white transition-all duration-150">End Q3</button>
                            <button onClick={() => runSimStep('FINAL')} className="bg-gold-foil text-navy-900 hover:brightness-105 p-2 rounded font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 col-span-2">End Game (Final)</button>
                        </div>
                    </div>
                </div>

                {/* RIGHT COL: Audit Log */}
                <div className="flex flex-col h-[600px] lg:h-auto">
                    <AuditLogViewer poolId={selectedPoolId} />

                    {/* Mini Winners Table */}
                    <div className="mt-4 bg-card border border-line rounded-xl p-4 shadow-card flex-1 flex flex-col min-h-[200px]">
                        <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.12em] mb-2 flex items-center gap-2"><Trophy size={16} /> Calculated Winners</h3>
                        <div className="overflow-y-auto flex-1 text-xs space-y-2">
                            {winners.length === 0 && <div className="text-faint font-body italic p-2 text-center">No winners computed yet.</div>}
                            {winners.map((w, i) => (
                                <div key={i} className="bg-surface p-2 rounded border border-line flex justify-between items-center hover:border-gold-500/40 transition-colors duration-150">
                                    <div>
                                        <div className="font-display font-bold uppercase text-gold-700 dark:text-gold-400">{w.owner}</div>
                                        <div className="text-[10px] text-muted font-body num">{w.description || w.period} • {w.homeDigit}-{w.awayDigit}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-display font-bold text-gold-700 dark:text-gold-400 num">${w.amount}</div>
                                        {w.isReverse && <div className="text-[10px] font-body text-navy-600 dark:text-[#9FB0CC]">Reverse</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};
