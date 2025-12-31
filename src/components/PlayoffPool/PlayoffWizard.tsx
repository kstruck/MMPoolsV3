import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Trophy, DollarSign, Calendar, Check } from 'lucide-react';
import { authService } from '../../services/authService';
import { dbService } from '../../services/dbService';
import type { PlayoffPool, PlayoffTeam } from '../../types';

// Mock of 14 teams for the current season (2024-25 Example)
const PLAYOFF_TEAMS_MOCK: PlayoffTeam[] = [
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
    { id: 'GB', name: 'Green Bay Packers', conference: 'NFC', seed: 7, eliminated: false },
];

interface PlayoffWizardProps {
    user?: any; // Accept user prop to satisfy App.tsx
    onComplete: (poolId: string) => void;
    onCancel: () => void;
}

export const PlayoffWizard: React.FC<PlayoffWizardProps> = ({ user: propUser, onComplete, onCancel }) => {
    const [step, setStep] = useState(1);
    const [poolName, setPoolName] = useState('');
    const [entryFee, setEntryFee] = useState(20);
    const [isCreating, setIsCreating] = useState(false);

    const handleCreate = async () => {
        setIsCreating(true);
        // Use prop user (if authoritative) or current auth user
        const user = propUser || authService.getCurrentUser();
        if (!user) return;

        try {
            const newPool: PlayoffPool = {
                id: crypto.randomUUID(),
                type: 'NFL_PLAYOFFS',
                league: 'NFL',
                name: poolName,
                ownerId: user.id,
                urlSlug: undefined, // Or generate one?
                season: '2024',
                createdAt: Date.now(),
                entryFee,
                payouts: { q1: 0, half: 0, q3: 0, final: 100 },
                teams: PLAYOFF_TEAMS_MOCK,
                entries: {},
                results: {},
                isLocked: false,
                lockDate: new Date('2025-01-11T13:00:00-05:00').getTime()
            };

            // Cleaner to let backend handle ID, but dbService.createPool assumes client-gen or backend-gen?
            // dbService calls cloud function 'createPool'. 
            // The cloud function usually overwrites ID if needed or uses it.
            // Let's rely on dbService.

            const poolId = await dbService.createPool(newPool); // This needs dbService update to accept ANY pool type
            onComplete(poolId);
        } catch (e) {
            console.error(e);
            alert("Failed to create pool");
            setIsCreating(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-slate-800 rounded-2xl p-8 border border-slate-700 shadow-2xl">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="mx-auto w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4">
                        <Trophy size={32} className="text-emerald-400" />
                    </div>
                    <h2 className="text-2xl font-bold">New Playoff Pool</h2>
                    <p className="text-slate-400 text-sm">Rank 14 Teams. Score points. Win.</p>
                </div>

                {/* Steps */}
                {step === 1 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div>
                            <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Pool Name</label>
                            <input
                                type="text"
                                autoFocus
                                value={poolName}
                                onChange={e => setPoolName(e.target.value)}
                                placeholder="e.g. Kevin's Playoff Challenge"
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-emerald-500 outline-none"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Entry Fee ($)</label>
                                <div className="relative">
                                    <DollarSign size={16} className="absolute left-3 top-3.5 text-slate-500" />
                                    <input
                                        type="number"
                                        value={entryFee}
                                        onChange={e => setEntryFee(Number(e.target.value))}
                                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 pl-9 text-white focus:border-emerald-500 outline-none"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Season</label>
                                <div className="relative">
                                    <Calendar size={16} className="absolute left-3 top-3.5 text-slate-500" />
                                    <input
                                        type="text"
                                        value="2024-25"
                                        disabled
                                        className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-3 pl-9 text-slate-400 cursor-not-allowed"
                                    />
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => setStep(2)}
                            disabled={!poolName}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            Next Step <ArrowRight size={18} />
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700 space-y-3">
                            <div className="flex justify-between">
                                <span className="text-slate-400">Name</span>
                                <span className="font-bold">{poolName}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400">Entry Fee</span>
                                <span className="font-bold text-emerald-400">${entryFee}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400">Teams</span>
                                <span className="font-bold">14 NFL Teams</span>
                            </div>
                        </div>

                        <div className="text-xs text-slate-500 text-center">
                            By creating this pool, you agree to the terms of service.
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setStep(1)}
                                className="px-4 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold transition-colors"
                            >
                                <ArrowLeft size={18} />
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={isCreating}
                                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
                            >
                                {isCreating ? 'Creating...' : 'Launch Pool'} <Check size={18} />
                            </button>
                        </div>
                    </div>
                )}

                <button onClick={onCancel} className="mt-8 text-slate-500 text-sm hover:text-white transition-colors w-full text-center">
                    Cancel & Return
                </button>
            </div>
        </div>
    );
};
