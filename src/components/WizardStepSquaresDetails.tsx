import React from 'react';
import { DollarSign, Shield, Trophy } from 'lucide-react';
import type { GameState } from '../types';

interface WizardStepSquaresDetailsProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    onNext: () => void;
    onBack: () => void;
}

export const WizardStepSquaresDetails: React.FC<WizardStepSquaresDetailsProps> = ({ gameState, updateConfig, onNext, onBack }) => {

    const totalPayout = (gameState.payouts.q1 || 0) + (gameState.payouts.half || 0) + (gameState.payouts.q3 || 0) + (gameState.payouts.final || 0);
    const isValidPayout = totalPayout === 100;

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">

            {/* COST & LIMITS */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <DollarSign className="text-emerald-400" /> Entry Settings
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Cost Per Square</label>
                        <div className="relative">
                            <span className="absolute left-3 top-3 text-slate-500 font-bold">$</span>
                            <input
                                type="number"
                                min="0"
                                value={gameState.costPerSquare}
                                onChange={(e) => updateConfig({ costPerSquare: Number(e.target.value) })}
                                className="w-full bg-slate-950 border border-slate-700 rounded pl-8 pr-4 py-3 text-white font-bold text-lg focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Max Squares Per Player</label>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={gameState.maxSquaresPerPlayer}
                            onChange={(e) => updateConfig({ maxSquaresPerPlayer: Number(e.target.value) })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white font-bold text-lg focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                        <p className="text-xs text-slate-500 mt-1">Set to 100 for unlimited.</p>
                    </div>
                </div>
            </div>

            {/* PAYOUTS */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Trophy className="text-amber-400" /> Payout Structure
                    </h3>
                    <span className={`text-sm font-bold px-3 py-1 rounded ${isValidPayout ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        Total: {totalPayout}%
                    </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                        { key: 'q1', label: '1st Quarter' },
                        { key: 'half', label: 'Halftime' },
                        { key: 'q3', label: '3rd Quarter' },
                        { key: 'final', label: 'Final Score' }
                    ].map((p) => (
                        <div key={p.key}>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">{p.label}</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={(gameState.payouts as any)[p.key]}
                                    onChange={(e) => updateConfig({
                                        payouts: { ...gameState.payouts, [p.key]: Number(e.target.value) }
                                    })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-2 text-white font-bold focus:ring-1 focus:ring-indigo-500 outline-none"
                                />
                                <span className="absolute right-3 top-2 text-slate-600 font-bold">%</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* RULES */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <Shield className="text-indigo-400" /> Advanced Rules
                </h3>
                <div className="space-y-4">
                    <label className="flex items-center justify-between p-3 rounded hover:bg-slate-800 cursor-pointer transition-colors">
                        <div>
                            <span className="block text-white font-bold">Quarterly Rollover</span>
                            <span className="text-xs text-slate-400">If a quarter has no winner (empty square), add prize to next quarter.</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={gameState.ruleVariations?.quarterlyRollover}
                            onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations!, quarterlyRollover: e.target.checked } })}
                            className="w-6 h-6 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                        />
                    </label>

                    <label className="flex items-center justify-between p-3 rounded hover:bg-slate-800 cursor-pointer transition-colors">
                        <div>
                            <span className="block text-white font-bold">Reverse Winners (Loser Pool)</span>
                            <span className="text-xs text-slate-400">Winning numbers are determined by the reverse of the score (e.g. 21 &rarr; 12).</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={gameState.ruleVariations?.reverseWinners}
                            onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations!, reverseWinners: e.target.checked } })}
                            className="w-6 h-6 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                        />
                    </label>
                    <label className="flex items-center justify-between p-3 rounded hover:bg-slate-800 cursor-pointer transition-colors">
                        <div>
                            <span className="block text-white font-bold">Every Score Pays</span>
                            <span className="text-xs text-slate-400">Award a small prize for every score change (touchdown/field goal).</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={gameState.ruleVariations?.scoreChangePayout}
                            onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations!, scoreChangePayout: e.target.checked } })}
                            className="w-6 h-6 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                        />
                    </label>
                </div>
            </div>

            {/* NAVIGATION */}
            <div className="flex justify-between pt-6 border-t border-slate-800">
                <button onClick={onBack} className="text-slate-400 hover:text-white font-bold text-sm">Back</button>
                <button
                    onClick={onNext}
                    disabled={!isValidPayout}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-all hover:scale-105"
                >
                    Next: Branding
                </button>
            </div>
        </div>
    );
};
