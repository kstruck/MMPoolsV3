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
    const quarterlyPayouts = useMemo(() => {
        if (mode === 'props') return [];
        return calculateQuarterlyPayouts(gameState, winners);
    }, [gameState, winners, mode]);

    const totalPot = mode === 'props'
        ? (totalEntries * (gameState.props?.cost || 0))
        : (gameState.squares?.filter(s => s && s.owner).length || 0) * gameState.costPerSquare;

    const charityAmount = gameState.charity?.enabled
        ? Math.floor(totalPot * (gameState.charity.percentage / 100))
        : 0;

    const netPot = totalPot - charityAmount;

    return (
        <div className="bg-card rounded-xl border border-line shadow-card flex flex-col overflow-hidden h-full">
            <div className="flex border-b border-line bg-surface px-6 py-4">
                <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.16em] text-muted">Payout Structure</h3>
            </div>

            <div className="p-6 flex-1 flex flex-col justify-center">
                <div className="animate-in fade-in slide-in-from-left-4 duration-200">
                    <div className="space-y-3">
                        {/* Total Collected */}
                        <div className="flex justify-between items-center text-sm font-body border-b border-line pb-2">
                            <span className="text-muted">Total Pot</span>
                            <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">
                                ${(totalPot).toLocaleString()}
                            </span>
                        </div>

                        {/* Charity Deduction Line */}
                        {gameState.charity?.enabled && (
                            <div className="flex justify-between items-center text-sm font-body border-b border-line pb-2 text-brandred-600 dark:text-brandred-500">
                                <span className="flex items-center gap-1"><Heart size={12} /> Less Donation ({gameState.charity.percentage}%)</span>
                                <span className="font-display font-bold num">
                                    -${charityAmount.toLocaleString()}
                                </span>
                            </div>
                        )}

                        {/* Net Prize Pot */}
                        <div className="flex justify-between items-center text-sm font-body border-b border-line pb-2 mb-2">
                            <span className="text-[color:var(--text)] font-bold">Net Prize Pool</span>
                            <span className="font-display font-bold text-lg text-gold-700 dark:text-gold-400 num">
                                ${netPot.toLocaleString()}
                            </span>
                        </div>
                    </div>

                    {mode === 'props' ? (
                        <div className="space-y-1">
                            {((gameState as any).props?.payouts?.length > 1) ? (
                                (gameState as any).props.payouts.map((percent: number, idx: number) => {
                                    const amount = Math.floor(netPot * (percent / 100));
                                    if (percent === 0) return null;
                                    return (
                                        <div key={idx} className="flex justify-between items-center text-sm font-body">
                                            <span className="text-muted font-bold num">
                                                {idx === 0 ? '1st Place' : idx === 1 ? '2nd Place' : idx === 2 ? '3rd Place' : `${idx + 1}th Place`}
                                                <span className="text-faint font-normal ml-1 num">({percent}%)</span>
                                            </span>
                                            <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">
                                                ${amount.toLocaleString()}
                                            </span>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="mt-4 bg-surface border border-line rounded-lg p-3 text-center">
                                    <Trophy className="w-8 h-8 text-gold-600 dark:text-gold-400 mx-auto mb-2" />
                                    <p className="text-sm font-body text-[color:var(--text)] font-medium">Winner Takes All / Manager Discretion</p>
                                    <p className="text-[10px] font-body text-faint mt-1">Check "Rules" tab for details.</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {quarterlyPayouts
                                .filter(card => {
                                    if (!gameState.ruleVariations) return true;
                                    // Hybrid Strategy: Only show Half and Final cards in summary if desired?
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
                                    // For hybrid strategy, calculate percentage from the actual card amount
                                    let displayPercent = 0;
                                    // Check if hybrid OR if default (missing strategy but scoreChangePayout is true)
                                    const isHybrid = (gameState.ruleVariations?.scoreChangePayout && gameState.ruleVariations?.scoreChangePayoutStrategy === 'hybrid') ||
                                        (gameState.ruleVariations?.scoreChangePayout && !gameState.ruleVariations?.scoreChangePayoutStrategy);

                                    if (isHybrid) {
                                        // Derive percentage from calculated amount
                                        if (netPot > 0 && card.amount > 0) {
                                            displayPercent = Math.round((card.amount / netPot) * 100);
                                        } else {
                                            // Fallback to reading from hybrid weights OR defaults
                                            const weights = gameState.ruleVariations?.scoreChangeHybridWeights;
                                            if (card.period === 'half') displayPercent = weights?.halftime || 20;
                                            if (card.period === 'final') displayPercent = weights?.final || 40;
                                        }
                                    } else {
                                        // Standard quarterly: read from payouts
                                        displayPercent = gameState.payouts ? (gameState.payouts as any)[card.period] : 0;
                                    }

                                    // Check handling from App.tsx
                                    if (!displayPercent && !gameState.ruleVariations?.scoreChangePayout) return null;

                                    return (
                                        <div key={card.period} className="flex justify-between items-center text-sm font-body">
                                            <span className="text-muted font-bold">{card.label}
                                                <span className="text-faint font-normal ml-1 num">
                                                    ({displayPercent}%)
                                                </span>
                                            </span>
                                            <div className="flex flex-col items-end">
                                                <span className="font-display font-bold text-gold-700 dark:text-gold-400 num">
                                                    ${(card.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                                                </span>
                                                {card.rolloverAdded > 0 && <span className="text-[10px] font-body font-bold text-gold-700 dark:text-gold-400">Includes Rollover</span>}
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
