import React from 'react';
import { Sparkles, DollarSign, Users, Trash2, Plus, HelpCircle } from 'lucide-react';
import type { GameState, PropsPool } from '../../types';
import { PropsManager } from '../Props/PropsManager';

import { Switch } from '../ui/Switch';
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
        <div className="space-y-6 animate-in slide-in-from-right duration-200">
            <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-1 flex items-center gap-2">
                            <Sparkles size={20} className="text-gold-700 dark:text-gold-400" /> Side Hustle Props
                        </h3>
                        <p className="text-muted text-sm">Add a bonus prop bet game alongside your squares pool.</p>
                    </div>
                    <Switch
                        checked={sideHustle.enabled}
                        onChange={toggleSideHustle}
                        label="Enable the side hustle"
                    />
                </div>

                {sideHustle.enabled && (
                    <div className="animate-in fade-in slide-in-from-top-2 space-y-6">
                        {/* Basic Settings */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-card p-4 rounded-lg border border-line">
                                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-2">Entry Fee ($)</label>
                                <div className="flex items-center gap-3">
                                    <div className="bg-gold-500/20 p-3 rounded-lg text-gold-700 dark:text-gold-400">
                                        <DollarSign size={24} />
                                    </div>
                                    <input
                                        type="number"
                                        min="0"
                                        value={sideHustle.cost}
                                        onChange={(e) => updateSideHustle({ cost: Number(e.target.value) })}
                                        className="num bg-transparent border-b border-line text-2xl font-bold text-gold-700 dark:text-gold-400 w-full outline-none focus:border-navy-600 py-1"
                                    />
                                </div>
                            </div>

                            <div className="bg-card p-4 rounded-lg border border-line">
                                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-2">Max Cards Per Player</label>
                                <div className="flex items-center gap-3">
                                    <div className="bg-navy-600/20 p-3 rounded-lg text-navy-600 dark:text-navy-500">
                                        <Users size={24} />
                                    </div>
                                    <input
                                        type="number"
                                        min="1"
                                        value={sideHustle.maxCards}
                                        onChange={(e) => updateSideHustle({ maxCards: Number(e.target.value) })}
                                        className="num bg-transparent border-b border-line text-2xl font-bold text-[color:var(--text)] w-full outline-none focus:border-navy-600 py-1"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Payout Structure */}
                        <div className="bg-card p-4 rounded-xl border border-line">
                            <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center justify-between">
                                <span>Payout Structure (Percentages)</span>
                                <span className={`num text-sm font-bold ${payoutTotal === 100 ? 'text-[#0F7B4A]' : 'text-brandred-600'}`}>
                                    Total: {payoutTotal}%
                                </span>
                            </h4>

                            <div className="space-y-3">
                                {sideHustle.payouts?.map((p, idx) => (
                                    <div key={idx} className="flex items-center gap-3">
                                        <div className="num w-8 h-8 rounded-full bg-page flex items-center justify-center font-bold text-muted text-sm">
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
                                                className="num w-full rounded-md border-[1.5px] border-line bg-page px-3 py-2 text-gold-700 dark:text-gold-400 font-bold pr-8 focus:border-navy-600 outline-none transition-colors"
                                            />
                                            <span className="absolute right-3 top-2 text-faint num">%</span>
                                        </div>
                                        <button
                                            onClick={() => {
                                                const newPayouts = sideHustle.payouts?.filter((_, i) => i !== idx);
                                                updateSideHustle({ payouts: newPayouts });
                                            }}
                                            className="p-2 text-faint hover:text-brandred-600 transition-colors"
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
                                    className="w-full py-2 border border-dashed border-line rounded-lg text-muted hover:text-[color:var(--text)] hover:border-navy-600 transition-colors flex items-center justify-center gap-2 text-sm"
                                >
                                    <Plus size={16} /> Add Place
                                </button>
                            </div>
                        </div>

                        {/* Props Questions Manager */}
                        <div className="border-t border-line pt-6">
                            <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                                <HelpCircle size={20} className="text-gold-700 dark:text-gold-400" /> Prop Questions
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
                    <div className="text-center py-8 text-faint">
                        <Sparkles size={48} className="mx-auto mb-4 opacity-30" />
                        <p>Enable Side Hustle to add a bonus prop bet game to your pool.</p>
                        <p className="text-xs mt-2">Players can pick answers to fun prop questions for a chance to win extra prizes!</p>
                    </div>
                )}
            </div>
        </div>
    );
};
