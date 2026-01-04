import React, { useState } from 'react';
import type { GameState } from '../types';
import { PoolTimer } from './PoolTimer';
import { Lock, Trophy, Zap, HelpCircle, ExternalLink, Check, Copy, Shuffle } from 'lucide-react';

interface StatusCardProps {
    gameState: GameState;
    onOpenRules?: () => void;
    mode?: 'squares' | 'props';
    totalEntries?: number;
}

export const StatusCard: React.FC<StatusCardProps> = ({ gameState, onOpenRules, mode = 'squares', totalEntries = 0 }) => {
    const [statusTab, setStatusTab] = useState<'overview' | 'rules' | 'payment'>('overview');
    const [gPayCopied, setGPayCopied] = useState(false);

    // Helper to calculate winner? Not needed for Overview.
    const squaresRemaining = gameState.squares ? 100 - gameState.squares.filter(s => s && s.owner).length : 0;

    return (
        <div className="bg-black rounded-xl border border-slate-800 shadow-xl flex flex-col overflow-hidden h-full">
            {/* Tabs Header */}
            <div className="flex border-b border-slate-800">
                <button
                    onClick={() => setStatusTab('overview')}
                    className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${statusTab === 'overview' ? 'bg-slate-900 text-white border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-900/50'}`}
                >
                    Overview
                </button>
                <button
                    onClick={() => setStatusTab('rules')}
                    className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${statusTab === 'rules' ? 'bg-slate-900 text-white border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-900/50'}`}
                >
                    Rules
                </button>
                <button
                    onClick={() => setStatusTab('payment')}
                    className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${statusTab === 'payment' ? 'bg-slate-900 text-white border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-400 hover:bg-slate-900/50'}`}
                >
                    Payment
                </button>
            </div>

            {/* Tab Content */}
            <div className="p-6 flex-1 flex flex-col justify-center">

                {statusTab === 'overview' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                        <div>
                            <h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Status:</h3>
                            {(() => {
                                if (!gameState.isLocked) return (
                                    <div className="flex items-center gap-2">
                                        <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span></span>
                                        <div><p className="text-emerald-400 font-bold text-sm leading-none">Open</p><p className="text-slate-500 text-[10px]">{mode === 'props' ? 'Entries are open' : 'Grid is available to choose squares'}</p></div>
                                    </div>
                                );
                                const status = gameState.scores?.gameStatus;
                                const isFinal = status === 'post' || !!gameState.scores?.final;
                                const isLive = status === 'in';
                                if (isFinal) return (
                                    <div className="flex items-center gap-2">
                                        <span className="relative flex h-3 w-3"><span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span></span>
                                        <div><p className="text-blue-500 font-bold text-sm leading-none">Locked - Final</p><p className="text-slate-500 text-[10px]">Game has completed</p></div>
                                    </div>
                                );
                                if (isLive) return (
                                    <div className="flex items-center gap-2">
                                        <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600"></span></span>
                                        <div><p className="text-rose-500 font-bold text-sm leading-none">Locked - Live</p><p className="text-slate-500 text-[10px]">Game has started</p></div>
                                    </div>
                                );
                                return (
                                    <div className="flex items-center gap-2">
                                        <Lock size={14} className="text-amber-500" />
                                        <div><p className="text-amber-500 font-bold text-sm leading-none">Locked - Pending</p><p className="text-slate-500 text-[10px]">Waiting for kickoff</p></div>
                                    </div>
                                );
                            })()}
                        </div>
                        <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Grid Owner:</h3><p className="text-white font-medium">{gameState.contactEmail || 'Admin'}</p></div>
                        {mode === 'props' ? (
                            <>
                                <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Entry Fee:</h3><p className="text-white font-medium text-sm">${gameState.props?.cost || 5} per card</p></div>
                                <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Total Entries:</h3><p className="text-white font-medium text-sm">{totalEntries}</p></div>
                            </>
                        ) : (
                            <>
                                <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Cost Per Square:</h3><p className="text-white font-medium text-sm">${gameState.costPerSquare}</p></div>
                                <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Squares Remaining:</h3><p className="text-white font-medium text-sm">{squaresRemaining}</p></div>
                            </>
                        )}
                    </div>
                )}

                {statusTab === 'rules' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                        {/* Countdown Timer */}
                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-center">
                            <PoolTimer
                                targetDate={gameState.scores.startTime}
                                gameStatus={gameState.scores.gameStatus}
                                isLocked={gameState.isLocked}
                            />
                        </div>

                        <div><h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Limits:</h3><p className="text-white font-medium text-sm">{mode === 'props' ? `Max ${gameState.props?.maxCards || 1} cards per player` : `Max ${gameState.maxSquaresPerPlayer || 'N/A'} squares per player`}</p></div>

                        {mode === 'props' && (
                            <>
                                <div className="bg-slate-900 border border-indigo-500/30 rounded-xl p-3 text-sm">
                                    <h4 className="text-indigo-400 font-bold uppercase text-xs mb-2 flex items-center gap-1">
                                        <Trophy size={12} /> Side Hustle Rules
                                    </h4>
                                    <ul className="text-slate-300 text-xs leading-relaxed space-y-1 list-disc pl-4">
                                        <li>Predictions relate to the upcoming game.</li>
                                        <li>Most points wins the pot (or 1st place).</li>
                                        <li><strong>Tiebreaker:</strong> Closest to Total Game Score.</li>
                                    </ul>
                                </div>

                                <div className="mt-4">
                                    <h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Scoring:</h3>
                                    <p className="text-slate-300 text-xs">Points are awarded for each correct answer. The specific point values are listed on the card entry form.</p>
                                </div>
                            </>
                        )}

                        {mode === 'squares' && (
                            <>
                                {/* Event Payout Rule */}
                                {gameState.ruleVariations?.scoreChangePayout && (
                                    <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-3 text-sm">
                                        <h4 className="text-emerald-400 font-bold uppercase text-xs mb-1 flex items-center gap-1">
                                            <Trophy size={12} /> Every Score Pays Rule
                                        </h4>
                                        <p className="text-slate-300 text-xs leading-relaxed">
                                            This pool pays out whenever the score changes.
                                            {gameState.ruleVariations.scoreChangePayoutStrategy === 'equal_split' ? (
                                                <span> <strong>Equal Split:</strong> The total prize pot is divided equally among all scoring events.</span>
                                            ) : gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid' ? (
                                                <span> <strong>Hybrid Split:</strong> Weighted payouts for Final/Halftime, with the remainder split among all other scores.</span>
                                            ) : (
                                                <span> A fixed amount of <strong>${gameState.scoreChangePayoutAmount}</strong> is deducted from the pot for each score.</span>
                                            )}
                                            <br />
                                            <span className="text-slate-500 italic mt-1 block">
                                                Winning square is determined by the last digits of the NEW score.
                                            </span>
                                        </p>
                                    </div>
                                )}

                                <div>
                                    <h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Active Rules:</h3>
                                    <div className="flex flex-col gap-2 items-start">
                                        <button onClick={() => onOpenRules?.()} disabled={!onOpenRules} className="flex items-center gap-2 group hover:bg-slate-800 p-1.5 rounded-lg -ml-1.5 transition-colors text-left w-full">
                                            {gameState.ruleVariations.quarterlyRollover ? (
                                                <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1">
                                                    <Zap size={12} className="fill-emerald-400" /> Rollover Active
                                                </div>
                                            ) : (
                                                <div className="bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded text-xs font-bold">Standard Payouts</div>
                                            )}
                                            {onOpenRules && <HelpCircle size={16} className="text-slate-500 group-hover:text-indigo-400 transition-colors ml-auto" />}
                                        </button>

                                        {gameState.ruleVariations.reverseWinners && (
                                            <button onClick={() => onOpenRules?.()} disabled={!onOpenRules} className="flex items-center gap-2 group hover:bg-slate-800 p-1.5 rounded-lg -ml-1.5 transition-colors text-left mt-1 w-full">
                                                <div className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1 ml-0.5">
                                                    <Zap size={12} className="fill-indigo-400" /> Reverse Winners Active
                                                </div>
                                                {onOpenRules && <HelpCircle size={16} className="text-slate-500 group-hover:text-indigo-400 transition-colors ml-auto" />}
                                            </button>
                                        )}

                                        {gameState.numberSets === 4 && (
                                            <button onClick={() => onOpenRules?.()} disabled={!onOpenRules} title="New random numbers are generated for every quarter (4 sets total)." className="flex items-center gap-2 group hover:bg-slate-800 p-1.5 rounded-lg -ml-1.5 transition-colors text-left mt-1 w-full">
                                                <div className="bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1 ml-0.5">
                                                    <Shuffle size={12} className="text-blue-400" /> 4 Sets (Quarterly Numbers)
                                                </div>
                                                {onOpenRules && <HelpCircle size={16} className="text-slate-500 group-hover:text-indigo-400 transition-colors ml-auto" />}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {statusTab === 'payment' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300 w-full">
                        {(gameState.paymentHandles?.venmo || gameState.paymentHandles?.googlePay) ? (
                            <div>
                                <h3 className="text-slate-500 font-bold uppercase text-xs mb-2">Payment Options:</h3>
                                <div className="flex flex-col gap-2">
                                    {gameState.paymentHandles?.venmo && (
                                        <a href={`https://venmo.com/u/${gameState.paymentHandles.venmo.replace('@', '')}`} target="_blank" rel="noreferrer" className="bg-[#008CFF] hover:bg-[#0077D9] text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 justify-center transition-colors w-full">
                                            Venmo: {gameState.paymentHandles.venmo} <ExternalLink size={14} />
                                        </a>
                                    )}
                                    {gameState.paymentHandles?.googlePay && (
                                        <div className="bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 justify-center w-full">
                                            <span className="text-slate-400 text-xs uppercase mr-1">GPay:</span> {gameState.paymentHandles.googlePay}
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(gameState.paymentHandles?.googlePay || '');
                                                    setGPayCopied(true);
                                                    setTimeout(() => setGPayCopied(false), 2000);
                                                }}
                                                className="ml-2 bg-slate-700 hover:bg-slate-600 p-1.5 rounded transition-colors"
                                                title="Copy GPay Address"
                                            >
                                                {gPayCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-slate-400 opacity-80" />}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="text-slate-500 text-xs italic">No digital payment methods configured.</div>
                        )}

                        <div className="border-t border-slate-800 pt-3">
                            <h3 className="text-slate-500 font-bold uppercase text-xs mb-1">Instructions:</h3>
                            <p className="text-slate-300 text-sm leading-relaxed max-h-32 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-700">
                                {gameState.paymentInstructions || "No additional instructions."}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
};
