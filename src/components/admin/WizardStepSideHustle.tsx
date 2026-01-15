import React from 'react';
import { Sparkles, DollarSign, Users, Trash2, Plus } from 'lucide-react';
import type { GameState, PropsPool } from '../../types';
import { PropsManager } from '../Props/PropsManager';

interface WizardStepSideHustleProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
}

export const WizardStepSideHustle: React.FC<WizardStepSideHustleProps> = ({ gameState, updateConfig }) => {
    // Default props structure for SQUARES pools
    const sideHustle = gameState.props || {
        enabled: false,
        cost: 10,
        maxCards: 1,
        payouts: [100],
        questions: []
    };

    const toggleSideHustle = (enabled: boolean) => {
        updateConfig({
            props: {
                ...sideHustle,
                enabled
            }
        });
    };

    const updateSideHustle = (updates: Partial<typeof sideHustle>) => {
        updateConfig({
            props: {
                ...sideHustle,
                ...updates
            }
        });
    };

    const payoutTotal = sideHustle.payouts?.reduce((a, b) => a + b, 0) || 0;

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                            <Sparkles size={20} className="text-amber-400" /> Side Hustle Props
                        </h3>
                        <p className="text-slate-400 text-sm">Add a bonus prop bet game alongside your squares pool.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={sideHustle.enabled}
                            onChange={(e) => toggleSideHustle(e.target.checked)}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                    </label>
                </div>

                {sideHustle.enabled && (
                    <div className="animate-in fade-in slide-in-from-top-2 space-y-6">
                        {/* Basic Settings */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                                <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Entry Fee ($)</label>
                                <div className="flex items-center gap-3">
                                    <div className="bg-emerald-500/20 p-3 rounded-lg text-emerald-400">
                                        <DollarSign size={24} />
                                    </div>
                                    <input
                                        type="number"
                                        min="0"
                                        value={sideHustle.cost}
                                        onChange={(e) => updateSideHustle({ cost: Number(e.target.value) })}
                                        className="bg-transparent border-b border-slate-600 text-2xl font-bold text-white w-full outline-none focus:border-emerald-500 py-1"
                                    />
                                </div>
                            </div>

                            <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                                <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Max Cards Per Player</label>
                                <div className="flex items-center gap-3">
                                    <div className="bg-indigo-500/20 p-3 rounded-lg text-indigo-400">
                                        <Users size={24} />
                                    </div>
                                    <input
                                        type="number"
                                        min="1"
                                        value={sideHustle.maxCards}
                                        onChange={(e) => updateSideHustle({ maxCards: Number(e.target.value) })}
                                        className="bg-transparent border-b border-slate-600 text-2xl font-bold text-white w-full outline-none focus:border-indigo-500 py-1"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Payout Structure */}
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                            <h4 className="font-bold text-white mb-4 flex items-center justify-between">
                                <span>Payout Structure (Percentages)</span>
                                <span className={`text-sm ${payoutTotal === 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                    Total: {payoutTotal}%
                                </span>
                            </h4>

                            <div className="space-y-3">
                                {sideHustle.payouts?.map((p, idx) => (
                                    <div key={idx} className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-400 text-sm">
                                            {idx + 1}
                                        </div>
                                        <div className="flex-grow relative">
                                            <input
                                                type="number"
                                                min="0"
                                                max="100"
                                                value={p}
                                                onChange={(e) => {
                                                    const newPayouts = [...(sideHustle.payouts || [])];
                                                    newPayouts[idx] = Number(e.target.value);
                                                    updateSideHustle({ payouts: newPayouts });
                                                }}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white pr-8 focus:border-indigo-500 outline-none"
                                            />
                                            <span className="absolute right-3 top-2 text-slate-500">%</span>
                                        </div>
                                        <button
                                            onClick={() => {
                                                const newPayouts = sideHustle.payouts?.filter((_, i) => i !== idx);
                                                updateSideHustle({ payouts: newPayouts });
                                            }}
                                            className="p-2 text-slate-500 hover:text-rose-400 transition-colors"
                                            disabled={(sideHustle.payouts?.length || 0) <= 1}
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                ))}

                                <button
                                    onClick={() => {
                                        const currentTotal = sideHustle.payouts?.reduce((a, b) => a + b, 0) || 0;
                                        if (currentTotal < 100) {
                                            updateSideHustle({ payouts: [...(sideHustle.payouts || []), 100 - currentTotal] });
                                        }
                                    }}
                                    className="w-full py-2 border border-dashed border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 transition-colors flex items-center justify-center gap-2 text-sm"
                                >
                                    <Plus size={16} /> Add Place
                                </button>
                            </div>
                        </div>

                        {/* Props Questions Manager */}
                        <div className="border-t border-slate-800 pt-6">
                            <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                                <span className="text-lg">❓</span> Prop Questions
                            </h4>
                            <PropsManager
                                gameState={gameState as unknown as PropsPool}
                                updateConfig={updateConfig as any}
                                isWizardMode={true}
                            />
                        </div>
                    </div>
                )}

                {!sideHustle.enabled && (
                    <div className="text-center py-8 text-slate-500">
                        <Sparkles size={48} className="mx-auto mb-4 opacity-30" />
                        <p>Enable Side Hustle to add a bonus prop bet game to your pool.</p>
                        <p className="text-xs mt-2">Players can pick answers to fun prop questions for a chance to win extra prizes!</p>
                    </div>
                )}
            </div>
        </div>
    );
};
