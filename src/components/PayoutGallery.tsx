import React, { useMemo } from 'react';
import type { GameState, Winner } from '../types';
import { calculateQuarterlyPayouts } from '../utils/payouts';
import { getLastDigit } from '../services/gameLogic';
import { Zap } from 'lucide-react';
import { Badge } from './ui';

interface PayoutGalleryProps {
    gameState: GameState;
    winners: Winner[];
    isManager: boolean;
    onUpdatePaidStatus: (label: string, isPaid: boolean) => void;
}

export const PayoutGallery: React.FC<PayoutGalleryProps> = ({ gameState, winners, isManager, onUpdatePaidStatus }) => {
    const quarterlyPayouts = useMemo(() => calculateQuarterlyPayouts(gameState, winners), [gameState, winners]);

    return (
        <div className="max-w-[1400px] mx-auto px-4 mb-10 w-full">
            <div className="flex flex-wrap justify-center gap-6">
                {quarterlyPayouts
                    .filter(card => {
                        // For ESP pools (both hybrid and equal_split), only show Halftime and Final milestone cards
                        if (gameState.ruleVariations.scoreChangePayout) {
                            return card.period === 'half' || card.period === 'final';
                        }
                        return true;
                    })
                    .map((card, idx) => {
                        return (
                            <div key={idx} className="bg-card border border-line rounded-xl p-6 text-center shadow-card transition-ui duration-150 fine:hover:-translate-y-1 hover:shadow-card-hover relative overflow-hidden group w-full md:w-[320px]">
                                <div className={`absolute top-0 w-full h-1 opacity-40 group-hover:opacity-80 transition-opacity ${card.isLocked ? 'bg-brandred-600' : 'bg-gold-foil'}`}></div>
                                <h4 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-4">{card.label}</h4>
                                <div className="flex justify-center gap-4 font-display font-bold text-2xl mb-2 items-center text-[color:var(--text)] num">
                                    <span>{card.home}</span> <span className="text-faint">-</span> <span>{card.away}</span>
                                </div>

                                {/* Winning Digits Display */}
                                <div className="flex justify-center gap-6 mb-4 bg-surface py-1.5 rounded border border-line">
                                    <div className="flex flex-col items-center">
                                        <span className="font-display font-bold uppercase text-[9px] tracking-[0.08em] text-brandred-600 dark:text-brandred-500">Home Digit</span>
                                        <span className="font-display font-bold text-lg text-[color:var(--text)] leading-none mt-0.5 num">{card.home !== undefined ? getLastDigit(card.home) : '-'}</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="font-display font-bold uppercase text-[9px] tracking-[0.08em] text-navy-600 dark:text-gold-400">Away Digit</span>
                                        <span className="font-display font-bold text-lg text-[color:var(--text)] leading-none mt-0.5 num">{card.away !== undefined ? getLastDigit(card.away) : '-'}</span>
                                    </div>
                                </div>
                                <p className="text-xs font-body text-muted mb-6 font-medium num">This Quarter: {card.qPointsHome} - {card.qPointsAway}</p>
                                <div className="mb-4">
                                    <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1">In the money:</p>
                                    {card.isRollover ? (
                                        <p className="text-gold-600 dark:text-gold-400 font-bold text-lg italic flex items-center justify-center gap-1"><Zap size={16} fill="currentColor" /> Rollover</p>
                                    ) : (
                                        <p className="font-body font-bold text-lg text-[color:var(--text)]">{card.winnerName}</p>
                                    )}
                                    {card.reverseWinnerName && (
                                        <div className="mt-1 flex flex-col items-center">
                                            <span className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint">AND (Reverse)</span>
                                            <span className="font-body font-bold text-sm text-navy-600 dark:text-gold-400">{card.reverseWinnerName}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-col items-center mb-4">
                                    {card.isRollover ? (
                                        <div className="font-display font-bold uppercase text-sm tracking-[0.05em] text-muted">Accumulating...</div>
                                    ) : (
                                        <>
                                            <div className="font-display font-bold text-2xl text-gold-700 dark:text-gold-400 num">${(card.amount || 0).toLocaleString()}</div>
                                            {card.rolloverAdded > 0 && <span className="text-[10px] font-body font-bold text-gold-700 dark:text-gold-400 num">(Includes ${card.rolloverAdded} Rollover)</span>}
                                        </>
                                    )}
                                </div>

                                {/* Payout Status Control */}
                                {card.winnerName && card.winnerName !== 'Unsold' && (
                                    <div className="mb-4">
                                        {card.isPaid ? (
                                            <div className="flex items-center justify-center gap-2">
                                                <Badge status="paid" className="text-[11px] px-2.5 py-1">
                                                    Paid
                                                </Badge>
                                                {isManager && (
                                                    <button
                                                        onClick={() => onUpdatePaidStatus(card.label.toLowerCase(), false)}
                                                        className="text-muted hover:text-brandred-600 text-[10px] underline transition-colors duration-150"
                                                    >Undo</button>
                                                )}
                                            </div>
                                        ) : (
                                            isManager && (
                                                <button
                                                    onClick={() => onUpdatePaidStatus(card.label.toLowerCase(), true)}
                                                    className="border-[1.5px] border-line hover:bg-[#0F7B4A]/10 hover:border-[#0F7B4A] hover:text-[#0F7B4A] text-muted px-3 py-1 rounded font-display font-bold uppercase tracking-[0.05em] text-[10px] transition-colors duration-150"
                                                >
                                                    Mark Paid
                                                </button>
                                            )
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
            </div>
        </div>
    );
};
