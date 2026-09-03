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
    const [zelleCopied, setZelleCopied] = useState(false);

    // Helper to calculate winner? Not needed for Overview.
    const squaresRemaining = gameState.squares ? 100 - gameState.squares.filter(s => s && s.owner).length : 0;

    return (
        <div className="bg-card rounded-xl border border-line shadow-card flex flex-col overflow-hidden h-full">
            {/* Tabs Header */}
            <div className="flex border-b border-line">
                <button
                    onClick={() => setStatusTab('overview')}
                    className={`flex-1 py-3 text-xs font-display font-bold uppercase tracking-[0.08em] transition-colors ${statusTab === 'overview' ? 'bg-surface text-[color:var(--text)] border-b-2 border-gold-500' : 'text-muted hover:text-[color:var(--text)] hover:bg-surface'}`}
                >
                    Overview
                </button>
                <button
                    onClick={() => setStatusTab('rules')}
                    className={`flex-1 py-3 text-xs font-display font-bold uppercase tracking-[0.08em] transition-colors ${statusTab === 'rules' ? 'bg-surface text-[color:var(--text)] border-b-2 border-gold-500' : 'text-muted hover:text-[color:var(--text)] hover:bg-surface'}`}
                >
                    Rules
                </button>
                <button
                    onClick={() => setStatusTab('payment')}
                    className={`flex-1 py-3 text-xs font-display font-bold uppercase tracking-[0.08em] transition-colors ${statusTab === 'payment' ? 'bg-surface text-[color:var(--text)] border-b-2 border-gold-500' : 'text-muted hover:text-[color:var(--text)] hover:bg-surface'}`}
                >
                    Payment
                </button>
            </div>

            {/* Tab Content */}
            <div className="p-6 flex-1 flex flex-col justify-center">

                {statusTab === 'overview' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-200">
                        <div>
                            <h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-1">Status:</h3>
                            {(() => {
                                if (!gameState.isLocked) return (
                                    <div className="flex items-center gap-2">
                                        <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0F7B4A] opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-[#0F7B4A]"></span></span>
                                        <div><p className="text-[#0F7B4A] font-display font-bold uppercase text-sm leading-none">Open</p><p className="text-faint text-[10px]">{mode === 'props' ? 'Entries are open' : 'Grid is available to choose squares'}</p></div>
                                    </div>
                                );
                                const status = gameState.scores?.gameStatus;
                                const isFinal = status === 'post' || !!gameState.scores?.final;
                                const isLive = status === 'in';
                                if (isFinal) return (
                                    <div className="flex items-center gap-2">
                                        <span className="relative flex h-3 w-3"><span className="relative inline-flex rounded-full h-3 w-3 bg-navy-600"></span></span>
                                        <div><p className="text-navy-600 dark:text-gold-400 font-display font-bold uppercase text-sm leading-none">Locked - Final</p><p className="text-faint text-[10px]">Game has completed</p></div>
                                    </div>
                                );
                                if (isLive) return (
                                    <div className="flex items-center gap-2">
                                        <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brandred-500 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-brandred-600 animate-live-pulse"></span></span>
                                        <div><p className="text-brandred-600 font-display font-bold uppercase text-sm leading-none">Locked - Live</p><p className="text-faint text-[10px]">Game has started</p></div>
                                    </div>
                                );
                                return (
                                    <div className="flex items-center gap-2">
                                        <Lock size={14} className="text-gold-600" />
                                        <div><p className="text-gold-600 font-display font-bold uppercase text-sm leading-none">Locked - Pending</p><p className="text-faint text-[10px]">Waiting for kickoff</p></div>
                                    </div>
                                );
                            })()}
                        </div>
                        <div><h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-1">Grid Owner:</h3><p className="text-[color:var(--text)] font-medium">{gameState.contactEmail || 'Admin'}</p></div>
                        {mode === 'props' ? (
                            <>
                                <div><h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-1">Entry Fee:</h3><p className="text-[color:var(--text)] font-medium text-sm num">${gameState.props?.cost || 5} per card</p></div>
                                <div><h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-1">Total Entries:</h3><p className="text-[color:var(--text)] font-medium text-sm num">{totalEntries}</p></div>
                            </>
                        ) : (
                            <>
                                <div><h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-1">Cost Per Square:</h3><p className="text-[color:var(--text)] font-medium text-sm num">${gameState.costPerSquare}</p></div>
                                <div><h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-1">Squares Remaining:</h3><p className="text-[color:var(--text)] font-medium text-sm num">{squaresRemaining}</p></div>
                            </>
                        )}
                    </div>
                )}

                {statusTab === 'rules' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                        {/* Countdown Timer */}
                        <div className="bg-surface border border-line rounded-lg p-3 text-center">
                            <PoolTimer
                                targetDate={gameState.scores?.startTime}
                                gameStatus={gameState.scores?.gameStatus}
                                isLocked={gameState.isLocked}
                            />
                        </div>

                        <div><h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-1">Limits:</h3><p className="text-[color:var(--text)] font-medium text-sm num">{mode === 'props' ? `Max ${gameState.props?.maxCards || 1} cards per player` : `Max ${gameState.maxSquaresPerPlayer || 'N/A'} squares per player`}</p></div>

                        {mode === 'props' && (
                            <>
                                <div className="bg-surface border border-gold-500/30 rounded-xl p-3 text-sm">
                                    <h4 className="text-gold-600 font-display font-bold uppercase tracking-[0.08em] text-xs mb-2 flex items-center gap-1">
                                        <Trophy size={12} /> Side Hustle Rules
                                    </h4>
                                    <ul className="text-[color:var(--text)] text-xs leading-relaxed space-y-1 list-disc pl-4">
                                        <li>Predictions relate to the upcoming game.</li>
                                        <li>Most points wins the pot (or 1st place).</li>
                                        <li><strong>Tiebreaker:</strong> Closest to Total Game Score.</li>
                                    </ul>
                                </div>

                                <div className="mt-4">
                                    <h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-1">Scoring:</h3>
                                    <p className="text-[color:var(--text)] text-xs">Points are awarded for each correct answer. The specific point values are listed on the card entry form.</p>
                                </div>
                            </>
                        )}

                        {mode === 'squares' && (
                            <>
                                {/* Event Payout Rule */}
                                {gameState.ruleVariations?.scoreChangePayout && (
                                    <div className="bg-surface border border-[#5B2A86]/40 rounded-xl p-3 text-sm">
                                        <h4 className="text-[#5B2A86] dark:text-white font-display font-bold uppercase tracking-[0.08em] text-xs mb-1 flex items-center gap-1">
                                            <Trophy size={12} /> Every Score Pays Rule
                                        </h4>
                                        <p className="text-[color:var(--text)] text-xs leading-relaxed">
                                            This pool pays out whenever the score changes.
                                            {gameState.ruleVariations.scoreChangePayoutStrategy === 'equal_split' ? (
                                                <span> <strong>Equal Split:</strong> The total prize pot is divided equally among all scoring events.</span>
                                            ) : gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid' ? (
                                                <span> <strong>Hybrid Split:</strong> Weighted payouts for Final/Halftime, with the remainder split among all other scores.</span>
                                            ) : (
                                                <span> A fixed amount of <strong>${gameState.scoreChangePayoutAmount}</strong> is deducted from the pot for each score.</span>
                                            )}
                                            <br />
                                            <span className="text-faint italic mt-1 block">
                                                Winning square is determined by the last digits of the NEW score.
                                            </span>
                                        </p>
                                    </div>
                                )}

                                <div>
                                    <h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-1">Active Rules:</h3>
                                    <div className="flex flex-col gap-2 items-start">
                                        <button onClick={() => onOpenRules?.()} disabled={!onOpenRules} className="flex items-center gap-2 group hover:bg-surface p-1.5 rounded-lg -ml-1.5 transition-colors text-left w-full">
                                            {gameState.ruleVariations.quarterlyRollover ? (
                                                <div className="bg-gold-500/10 text-gold-600 border border-gold-500/30 px-2 py-0.5 rounded text-xs font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1">
                                                    <Zap size={12} className="fill-gold-500" /> Rollover Active
                                                </div>
                                            ) : (
                                                <div className="bg-surface text-muted border border-line px-2 py-0.5 rounded text-xs font-display font-bold uppercase tracking-[0.05em]">Standard Payouts</div>
                                            )}
                                            {onOpenRules && <HelpCircle size={16} className="text-faint group-hover:text-gold-600 transition-colors ml-auto" />}
                                        </button>

                                        {gameState.numberSets === 4 && (
                                            <button onClick={() => onOpenRules?.()} disabled={!onOpenRules} title="New random numbers are generated for every quarter (4 sets total)." className="flex items-center gap-2 group hover:bg-surface p-1.5 rounded-lg -ml-1.5 transition-colors text-left mt-1 w-full">
                                                <div className="bg-navy-600/10 text-navy-600 dark:text-gold-400 border border-navy-600/30 px-2 py-0.5 rounded text-xs font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1 ml-0.5">
                                                    <Shuffle size={12} className="text-navy-600 dark:text-gold-400" /> 4 Sets (Quarterly Numbers)
                                                </div>
                                                {onOpenRules && <HelpCircle size={16} className="text-faint group-hover:text-gold-600 transition-colors ml-auto" />}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {statusTab === 'payment' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200 w-full">
                        {(gameState.paymentHandles?.venmo || gameState.paymentHandles?.zelle) ? (
                            <div>
                                <h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-2">Payment Options:</h3>
                                <div className="flex flex-col gap-2">
                                    {gameState.paymentHandles?.venmo && (
                                        <a href={`https://venmo.com/u/${gameState.paymentHandles.venmo.replace('@', '')}`} target="_blank" rel="noreferrer" className="bg-[#008CFF] hover:bg-[#0077D9] text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 justify-center transition-colors w-full">
                                            Venmo: {gameState.paymentHandles.venmo} <ExternalLink size={14} />
                                        </a>
                                    )}
                                    {gameState.paymentHandles?.zelle && (
                                        <div className="bg-surface border border-line text-[color:var(--text)] px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 justify-center w-full">
                                            <span className="text-muted text-xs uppercase mr-1">Zelle:</span> {gameState.paymentHandles.zelle}
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(gameState.paymentHandles?.zelle || '');
                                                    setZelleCopied(true);
                                                    setTimeout(() => setZelleCopied(false), 2000);
                                                }}
                                                className="ml-2 bg-card hover:bg-page border border-line p-1.5 rounded transition-colors"
                                                title="Copy Zelle Info"
                                            >
                                                {zelleCopied ? <Check size={14} className="text-[#0F7B4A]" /> : <Copy size={14} className="text-muted opacity-80" />}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="text-faint text-xs italic">No digital payment methods configured.</div>
                        )}

                        <div className="border-t border-line pt-3">
                            <h3 className="text-muted font-display font-bold uppercase tracking-[0.08em] text-xs mb-1">Instructions:</h3>
                            <p className="text-[color:var(--text)] text-sm leading-relaxed max-h-32 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-700">
                                {gameState.paymentInstructions || "No additional instructions."}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
};
