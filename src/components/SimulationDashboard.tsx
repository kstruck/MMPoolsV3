
import React, { useState, useEffect } from 'react';
import { dbService } from '../services/dbService';
import { simulatePoolGame, fillGridWithBlanks } from '../utils/simulationUtils';
import { AuditLogViewer } from './AuditLogViewer';
import type { GameState, Pool } from '../types';
import { Play, Settings, Users, Activity } from 'lucide-react';

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

    // Filter for Football squares pools only
    const validPools = pools.filter(p => p.type !== 'BRACKET');

    useEffect(() => {
        if (selectedPoolId) {
            const pool = pools.find(p => p.id === selectedPoolId) as GameState;
            setSelectedPool(pool || null);
        } else {
            setSelectedPool(null);
        }
    }, [selectedPoolId, pools]);

    const handleAction = async (actionName: string, actionFn: () => Promise<any>) => {
        setIsLoading(true);
        setSimStatus(`Running: ${actionName}...`);
        try {
            const res = await actionFn();
            setSimStatus(res || `Success: ${actionName}`);
        } catch (e: any) {
            console.error(e);
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
            case 'AWAY+3':
                nextState.current = { home: h, away: a + 3 };
                nextState.clock = '8:00';
                break;
            case 'HOME+3':
                nextState.current = { home: h + 3, away: a };
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
            <div className="fixed inset-0 bg-slate-950 z-50 overflow-auto p-8">
                <div className="max-w-4xl mx-auto">
                    <div className="flex justify-between items-center mb-8">
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <Activity className="text-emerald-500" /> Simulation Dashboard
                        </h1>
                        <button onClick={onClose} className="text-slate-400 hover:text-white font-bold">Close</button>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <h2 className="text-xl font-bold text-white mb-4">Select a Pool to Simulate</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {validPools.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => setSelectedPoolId(p.id)}
                                    className="p-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-left transition-colors group"
                                >
                                    <div className="font-bold text-white group-hover:text-emerald-400">{p.name}</div>
                                    <div className="text-xs text-slate-500 font-mono mt-1">{p.id}</div>
                                    <div className="text-xs text-slate-400 mt-2">
                                        {(p as GameState).squares.filter(s => s.owner).length}/100 Filled • {(p as GameState).isLocked ? 'LOCKED' : 'OPEN'}
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
        <div className="fixed inset-0 bg-slate-950 z-50 overflow-auto flex flex-col">
            {/* Header */}
            <div className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-10 shadow-lg">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSelectedPoolId('')} className="text-indigo-400 hover:text-white font-bold text-sm">← Back</button>
                        <h1 className="text-xl font-bold text-white flex items-center gap-2">
                            Simulating: <span className="text-emerald-400">{selectedPool?.name}</span>
                        </h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-xs font-mono text-slate-400">
                            {simStatus && <span className="bg-slate-800 px-2 py-1 rounded text-amber-400 animate-pulse">{simStatus}</span>}
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-white font-bold">Exit Dashboard</button>
                    </div>
                </div>
            </div>

            <div className="flex-1 p-6 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* LEFT COL: Config & Grid */}
                <div className="space-y-6">
                    {/* Rules */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                        <h3 className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2"><Settings size={16} /> Rules Config</h3>
                        <div className="space-y-3">
                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-800 rounded">
                                <span className="text-white font-medium">Every Score Pays</span>
                                <input
                                    type="checkbox"
                                    checked={selectedPool?.ruleVariations?.scoreChangePayout || false}
                                    onChange={(e) => toggleRule('scoreChangePayout', e.target.checked)}
                                    className="w-5 h-5 accent-emerald-500 rounded"
                                />
                            </label>
                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-800 rounded">
                                <span className="text-white font-medium">Rollover (Unclaimed Wins)</span>
                                <input
                                    type="checkbox"
                                    checked={selectedPool?.ruleVariations?.quarterlyRollover || false}
                                    onChange={(e) => toggleRule('rollover', e.target.checked)}
                                    className="w-5 h-5 accent-emerald-500 rounded"
                                />
                            </label>
                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-800 rounded">
                                <span className="text-white font-medium">Reverse Winners</span>
                                <input
                                    type="checkbox"
                                    checked={selectedPool?.ruleVariations?.reverseWinners || false}
                                    onChange={(e) => toggleRule('reverseWinners', e.target.checked)}
                                    className="w-5 h-5 accent-emerald-500 rounded"
                                />
                            </label>
                            <div className="flex items-center justify-between p-2 mt-2 bg-slate-800/50 rounded pointer-events-none opacity-50">
                                <span className="text-slate-400 text-sm">Current Numbers</span>
                                <span className="text-xs font-mono text-slate-500">
                                    {selectedPool?.numberSets === 4 ? 'Quarterly' : 'Single Set'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Grid Filler */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                        <h3 className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2"><Users size={16} /> Grid Population</h3>
                        <div className="space-y-4">
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-white">Leave Empty Squares</span>
                                    <span className="font-bold text-emerald-400">{blanksToLeave}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="50"
                                    value={blanksToLeave}
                                    onChange={(e) => setBlanksToLeave(parseInt(e.target.value))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                            <button
                                onClick={() => handleAction(`Filling Grid (leave ${blanksToLeave})`, () => fillGridWithBlanks(selectedPoolId, blanksToLeave))}
                                disabled={isLoading}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                <Users size={18} /> Fill Grid
                            </button>
                            <div className="text-center text-xs text-slate-500 mt-2">
                                Current Fill: {selectedPool?.squares.filter(s => s.owner).length}/100
                            </div>
                        </div>
                    </div>
                </div>

                {/* MIDDLE COL: Scenario Runner */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
                    <h3 className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2"><Play size={16} /> Game Scenario Runner</h3>

                    <div className="flex-1 space-y-4">
                        {/* Status Display */}
                        <div className="bg-black/40 rounded-xl p-4 border border-slate-700 font-mono text-center mb-6">
                            <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">Game Status</div>
                            <div className="text-2xl font-bold text-white mb-2">
                                {selectedPool?.scores?.gameStatus === 'pre' ? 'PRE-GAME' :
                                    selectedPool?.scores?.gameStatus === 'post' ? 'FINAL' :
                                        `Q${selectedPool?.scores?.period || '-'} • ${selectedPool?.scores?.clock || '--'}`}
                            </div>
                            <div className="flex justify-center items-center gap-8 text-xl font-bold">
                                <div className="text-indigo-400">HOME {selectedPool?.scores?.current?.home || 0}</div>
                                <div className="text-slate-600">vs</div>
                                <div className="text-rose-400">AWAY {selectedPool?.scores?.current?.away || 0}</div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => runSimStep('START')} className="bg-emerald-600 hover:bg-emerald-500 p-3 rounded font-bold text-white">Start Game</button>
                            <button onClick={() => runSimStep('RESET')} className="bg-slate-700 hover:bg-slate-600 p-3 rounded font-bold text-slate-300">Reset</button>

                            <div className="col-span-2 text-xs text-slate-500 font-bold uppercase mt-2">Score Events</div>
                            <button onClick={() => runSimStep('HOME+7')} className="bg-slate-800 hover:bg-slate-700 border border-indigo-500/30 text-indigo-400 p-2 rounded font-bold">Home TD (+7)</button>
                            <button onClick={() => runSimStep('AWAY+3')} className="bg-slate-800 hover:bg-slate-700 border border-rose-500/30 text-rose-400 p-2 rounded font-bold">Away FG (+3)</button>
                            <button onClick={() => runSimStep('HOME+3')} className="bg-slate-800 hover:bg-slate-700 border border-indigo-500/30 text-indigo-400 p-2 rounded font-bold">Home FG (+3)</button>

                            <div className="col-span-2 text-xs text-slate-500 font-bold uppercase mt-2">Progresion</div>
                            <button onClick={() => runSimStep('END_Q1')} className="bg-slate-700 hover:bg-slate-600 p-2 rounded font-bold text-white">End Q1</button>
                            <button onClick={() => runSimStep('END_HALF')} className="bg-slate-700 hover:bg-slate-600 p-2 rounded font-bold text-white">End Half</button>
                            <button onClick={() => runSimStep('END_Q3')} className="bg-slate-700 hover:bg-slate-600 p-2 rounded font-bold text-white">End Q3</button>
                            <button onClick={() => runSimStep('FINAL')} className="bg-amber-600 hover:bg-amber-500 p-2 rounded font-bold text-white col-span-2">End Game (Final)</button>
                        </div>
                    </div>
                </div>

                {/* RIGHT COL: Audit Log */}
                <div className="flex flex-col h-[600px] lg:h-auto">
                    <AuditLogViewer poolId={selectedPoolId} />

                    {/* Mini Winners Table */}
                    <div className="mt-4 bg-slate-900 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col min-h-[200px]">
                        <h3 className="text-sm font-bold text-slate-400 uppercase mb-2 flex items-center gap-2"><Trophy size={16} /> Calculated Winners</h3>
                        <div className="overflow-y-auto flex-1 text-xs">
                            {/* Placeholder: ideally we fetch winners subcollection, but for now we rely on Audit Logs to confirm success */}
                            <div className="text-slate-500 italic p-2">Check Audit Log for 'WINNER_COMPUTED' events.</div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

import { Trophy } from 'lucide-react';
