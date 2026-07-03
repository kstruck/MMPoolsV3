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
            <div className="bg-surface border border-line rounded-xl p-6">
                <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">Grid Rules</h3>
                <p className="text-muted text-sm mb-6">Set the pricing and limitations for your players.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-card p-4 rounded-lg border border-line">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-2">Cost Per Square</label>
                        <div className="flex items-center gap-3">
                            <div className="bg-gold-500/20 p-3 rounded-lg text-gold-700 dark:text-gold-400">
                                <DollarSign size={24} />
                            </div>
                            <input
                                type="number"
                                value={gameState.costPerSquare}
                                onChange={(e) => updateConfig({ costPerSquare: parseInt(e.target.value) || 0 })}
                                className="num bg-transparent border-b border-line text-2xl font-bold text-gold-700 dark:text-gold-400 w-full outline-none focus:border-navy-600 py-1"
                            />
                        </div>
                    </div>
                    <div className="bg-card p-4 rounded-lg border border-line">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-2">Max Squares / Player</label>
                        <div className="flex items-center gap-3">
                            <div className="bg-navy-600/20 p-3 rounded-lg text-navy-600 dark:text-navy-500">
                                <Shield size={24} />
                            </div>
                            <input
                                type="number"
                                value={gameState.maxSquaresPerPlayer}
                                onChange={(e) => updateConfig({ maxSquaresPerPlayer: parseInt(e.target.value) || 0 })}
                                className="num bg-transparent border-b border-line text-2xl font-bold text-[color:var(--text)] w-full outline-none focus:border-navy-600 py-1"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Number Sets</label>
                        <select
                            value={gameState.numberSets}
                            onChange={(e) => updateConfig({ numberSets: parseInt(e.target.value) || 1 })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] cursor-pointer transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                        >
                            <option value="1">Single Set (Same numbers all game)</option>
                            <option value="4">4 Sets (New numbers every quarter)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Show "Paid" Status</label>
                        <select
                            value={gameState.showPaid ? 'Yes' : 'No'}
                            onChange={(e) => updateConfig({ showPaid: e.target.value === 'Yes' })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] cursor-pointer transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                        >
                            <option>Yes</option>
                            <option>No</option>
                        </select>
                    </div>
                </div>

                <div className="mt-6 p-3.5 bg-navy-600/10 border border-navy-600/20 text-muted text-xs rounded-xl flex gap-2 items-start animate-in fade-in duration-300">
                    <Sparkles size={16} className="text-gold-700 dark:text-gold-400 shrink-0 mt-0.5" />
                    <div>
                        <strong className="text-[color:var(--text)] block mb-0.5">Start Small, Upgrade Later!</strong>
                        Not sure how many players will join? Choose a lower estimate to minimize upfront costs. You can instantly upgrade with one click later for only the pro-rated difference!
                    </div>
                </div>
            </div>
        </div>
    );
};
