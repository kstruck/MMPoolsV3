import React, { useMemo } from 'react';
import type { GameState, Winner } from '../types';
import { calculateQuarterlyPayouts } from '../utils/payouts';
import { Heart, Trophy } from 'lucide-react';

interface PayoutSummaryCardProps {
    gameState: GameState;
    winners: Winner[];
    mode?: 'squares' | 'props';
    totalEntries?: number;
}

export const PayoutSummaryCard: React.FC<PayoutSummaryCardProps> = ({ gameState, winners, mode = 'squares', totalEntries = 0 }) => {
    const quarterlyPayouts = useMemo(() => calculateQuarterlyPayouts(gameState, winners), [gameState, winners]);

    const totalPot = mode === 'props'
        ? (totalEntries * (gameState.props?.cost || 0))
        : (gameState.squares?.filter(s => s && s.owner).length || 0) * gameState.costPerSquare;

    const charityAmount = gameState.charity?.enabled
        ? Math.floor(totalPot * (gameState.charity.percentage / 100))
        : 0;

    const netPot = totalPot - charityAmount;

    return (
        <div className="bg-black rounded-xl border border-slate-800 shadow-xl flex flex-col overflow-hidden h-full">
            <div className="flex border-b border-slate-800 bg-slate-900 px-6 py-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Payout Structure</h3>
            </div>

            <div className="p-6 flex-1 flex flex-col justify-center">
                <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                    <div className="space-y-3">
                        {/* Total Collected */}
                        <div className="flex justify-between items-center text-sm border-b border-slate-800 pb-2">
                            <span className="text-slate-400">Total Pot</span>
                            <span className="text-white font-mono font-bold">
                                ${(totalPot).toLocaleString()}
                            </span>
                        </div>

                        {/* Charity Deduction Line */}
                        {gameState.charity?.enabled && (
                            <div className="flex justify-between items-center text-sm border-b border-slate-800 pb-2 text-rose-300">
                                <span className="flex items-center gap-1"><Heart size={12} /> Less Donation ({gameState.charity.percentage}%)</span>
                                <span className="font-mono font-bold">
                                    -${charityAmount.toLocaleString()}
                                </span>
                            </div>
                        )}

                        {/* Net Prize Pot */}
                        <div className="flex justify-between items-center text-sm border-b border-slate-700 pb-2 mb-2">
                            <span className="text-white font-bold">Net Prize Pool</span>
                            <span className="text-emerald-400 font-mono font-bold text-lg">
                                ${netPot.toLocaleString()}
                            </span>
                        </div>
                    </div>

                    {mode === 'props' ? (
                        <div className="mt-4 bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                            <Trophy className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                            <p className="text-sm text-slate-300 font-medium">Winner Takes All / Manager Discretion</p>
                            <p className="text-[10px] text-slate-500 mt-1">Check "Rules" tab for details.</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {quarterlyPayouts
                                .filter(card => {
                                    // Hybrid Strategy: Only show Half and Final cards in summary if desired?
                                    // App.tsx logic:
                                    if (gameState.ruleVariations.scoreChangePayout && gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid') {
                                        return card.period === 'half' || card.period === 'final';
                                    }
                                    // Equal Split: Hide all fixed period cards (all are event based)
                                    if (gameState.ruleVariations.scoreChangePayout && gameState.ruleVariations.scoreChangePayoutStrategy === 'equal_split') {
                                        return false;
                                    }
                                    return true;
                                })
                                .map((card) => {
                                    const percent = gameState.payouts ? gameState.payouts[card.period as keyof typeof gameState.payouts] : 0;
                                    // Check handling from App.tsx
                                    if (!percent && !gameState.ruleVariations?.scoreChangePayout) return null;

                                    return (
                                        <div key={card.period} className="flex justify-between items-center text-sm">
                                            <span className="text-slate-400 font-bold">{card.label}
                                                <span className="text-slate-600 font-normal ml-1">
                                                    {gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid'
                                                        ? `(${(gameState.ruleVariations.scoreChangeHybridWeights as any)?.[card.period === 'half' ? 'halftime' : 'final'] || 0}%)`
                                                        : `(${percent}%)`}
                                                </span>
                                            </span>
                                            <div className="flex flex-col items-end">
                                                <span className="text-white font-mono font-bold">
                                                    ${(card.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                                                </span>
                                                {card.rolloverAdded > 0 && <span className="text-[10px] text-emerald-500 font-bold">Includes Rollover</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
