import React from 'react';
import { DollarSign, Shield, Sparkles } from 'lucide-react';
import type { GameState } from '../../types';

interface WizardStepRulesProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
}

export const WizardStepRules: React.FC<WizardStepRulesProps> = ({ gameState, updateConfig }) => {
    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2">Grid Rules</h3>
                <p className="text-slate-400 text-sm mb-6">Set the pricing and limitations for your players.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Cost Per Square</label>
                        <div className="flex items-center gap-3">
                            <div className="bg-emerald-500/20 p-3 rounded-lg text-emerald-400">
                                <DollarSign size={24} />
                            </div>
                            <input
                                type="number"
                                value={gameState.costPerSquare}
                                onChange={(e) => updateConfig({ costPerSquare: parseInt(e.target.value) || 0 })}
                                className="bg-transparent border-b border-slate-600 text-2xl font-bold text-white w-full outline-none focus:border-emerald-500 py-1"
                            />
                        </div>
                    </div>
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Max Squares / Player</label>
                        <div className="flex items-center gap-3">
                            <div className="bg-indigo-500/20 p-3 rounded-lg text-indigo-400">
                                <Shield size={24} />
                            </div>
                            <input
                                type="number"
                                value={gameState.maxSquaresPerPlayer}
                                onChange={(e) => updateConfig({ maxSquaresPerPlayer: parseInt(e.target.value) || 0 })}
                                className="bg-transparent border-b border-slate-600 text-2xl font-bold text-white w-full outline-none focus:border-indigo-500 py-1"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Number Sets</label>
                        <select
                            value={gameState.numberSets}
                            onChange={(e) => updateConfig({ numberSets: parseInt(e.target.value) || 1 })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-indigo-500"
                        >
                            <option value="1">Single Set (Same numbers all game)</option>
                            <option value="4">4 Sets (New numbers every quarter)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Show "Paid" Status</label>
                        <select
                            value={gameState.showPaid ? 'Yes' : 'No'}
                            onChange={(e) => updateConfig({ showPaid: e.target.value === 'Yes' })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-indigo-500"
                        >
                            <option>Yes</option>
                            <option>No</option>
                        </select>
                    </div>
                </div>

                <div className="mt-6 p-3.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs rounded-xl flex gap-2 items-start animate-in fade-in duration-300">
                    <Sparkles size={16} className="text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                        <strong className="text-white block mb-0.5">💡 Start Small, Upgrade Later!</strong>
                        Not sure how many players will join? Choose a lower estimate to minimize upfront costs. You can instantly upgrade with one click later for only the pro-rated difference!
                    </div>
                </div>
            </div>
        </div>
    );
};
