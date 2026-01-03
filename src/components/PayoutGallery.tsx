import React, { useMemo } from 'react';
import type { GameState, Winner } from '../types';
import { calculateQuarterlyPayouts } from '../utils/payouts';
import { getLastDigit } from '../services/gameLogic';
import { Zap, Check } from 'lucide-react';

interface PayoutGalleryProps {
    gameState: GameState;
    winners: Winner[];
    isManager: boolean;
    onUpdatePaidStatus: (label: string, isPaid: boolean) => void;
}

export const PayoutGallery: React.FC<PayoutGalleryProps> = ({ gameState, winners, isManager, onUpdatePaidStatus }) => {
    const quarterlyPayouts = useMemo(() => calculateQuarterlyPayouts(gameState, winners), [gameState, winners]);

    // Condition to show (from App.tsx)
    if (gameState.ruleVariations.scoreChangePayout && gameState.ruleVariations.scoreChangePayoutStrategy === 'equal_split') {
        return null;
    }

    return (
        <div className="max-w-[1400px] mx-auto px-4 mb-10 w-full">
            <div className="flex flex-wrap justify-center gap-6">
                {quarterlyPayouts
                    .filter(card => {
                        if (gameState.ruleVariations.scoreChangePayout && gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid') {
                            return card.period === 'half' || card.period === 'final';
                        }
                        return true;
                    })
                    .map((card, idx) => {
                        return (
                            <div key={idx} className="bg-black border border-slate-800 rounded-xl p-6 text-center shadow-lg relative overflow-hidden group w-full md:w-[320px]">
                                <div className={`absolute top-0 w-full h-1 opacity-20 group-hover:opacity-50 transition-opacity ${card.isLocked ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
                                <h4 className="text-slate-400 font-bold text-sm uppercase mb-4">{card.label}</h4>
                                <div className="flex justify-center gap-4 text-white font-bold text-2xl mb-2 items-center">
                                    <span>{card.home}</span> <span className="text-slate-600">-</span> <span>{card.away}</span>
                                </div>

                                {/* Winning Digits Display */}
                                <div className="flex justify-center gap-6 mb-4 bg-slate-900/50 py-1.5 rounded border border-slate-800/50">
                                    <div className="flex flex-col items-center">
                                        <span className="text-[9px] text-rose-400/80 uppercase font-bold tracking-wider">Home Digit</span>
                                        <span className="font-mono text-lg font-bold text-white leading-none mt-0.5">{card.home !== undefined ? getLastDigit(card.home) : '-'}</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-[9px] text-indigo-400/80 uppercase font-bold tracking-wider">Away Digit</span>
                                        <span className="font-mono text-lg font-bold text-white leading-none mt-0.5">{card.away !== undefined ? getLastDigit(card.away) : '-'}</span>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 mb-6 font-medium">This Quarter: {card.qPointsHome} - {card.qPointsAway}</p>
                                <div className="mb-4">
                                    <p className="text-xs text-slate-400 uppercase font-bold mb-1">In the money:</p>
                                    {card.isRollover ? (
                                        <p className="text-emerald-400 font-bold text-lg italic flex items-center justify-center gap-1"><Zap size={16} fill="currentColor" /> Rollover</p>
                                    ) : (
                                        <p className="text-white font-bold text-lg">{card.winnerName}</p>
                                    )}
                                    {card.reverseWinnerName && (
                                        <div className="mt-1 flex flex-col items-center">
                                            <span className="text-[10px] text-slate-500">AND (Reverse)</span>
                                            <span className="text-indigo-300 font-bold text-sm">{card.reverseWinnerName}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-col items-center mb-4">
                                    {card.isRollover ? (
                                        <div className="text-slate-500 font-mono font-bold text-sm uppercase">Accumulating...</div>
                                    ) : (
                                        <>
                                            <div className="text-2xl font-bold font-mono text-emerald-400">${(card.amount || 0).toLocaleString()}</div>
                                            {card.rolloverAdded > 0 && <span className="text-[10px] text-emerald-500 font-bold">(Includes ${card.rolloverAdded} Rollover)</span>}
                                        </>
                                    )}
                                </div>

                                {/* Payout Status Control */}
                                {card.winnerName && card.winnerName !== 'Unsold' && (
                                    <div className="mb-4">
                                        {card.isPaid ? (
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                                                    <Check size={10} strokeWidth={4} /> Paid
                                                </span>
                                                {isManager && (
                                                    <button
                                                        onClick={() => onUpdatePaidStatus(card.label.toLowerCase(), false)}
                                                        className="text-slate-500 hover:text-white text-[10px] underline"
                                                    >Undo</button>
                                                )}
                                            </div>
                                        ) : (
                                            isManager && (
                                                <button
                                                    onClick={() => onUpdatePaidStatus(card.label.toLowerCase(), true)}
                                                    className="border border-slate-700 hover:bg-emerald-500/10 hover:border-emerald-500 hover:text-emerald-400 text-slate-400 px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors"
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
