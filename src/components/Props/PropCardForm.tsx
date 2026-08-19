
import { OverlayRoot } from '../ui/OverlayRoot';
import React, { useState, useEffect } from 'react';
import type { GameState, PropCard, PropsPool, User } from '../../types';
import { dbService } from '../../services/dbService';
import { Check, Lock, Trophy, Plus, Eye, Edit2, Save, Loader } from 'lucide-react';
import { Button } from '../ui';

interface PropCardFormProps {
    gameState?: GameState;
    currentUser: User | null;
    userCard?: PropCard | null;
    poolId?: string;
    config?: PropsPool['props'];
    isLocked?: boolean;
    userCards?: PropCard[];
    onOpenAuth?: () => void;
}

export const PropCardForm: React.FC<PropCardFormProps> = ({ gameState, currentUser, poolId, config, isLocked, userCards, onOpenAuth }) => {
    const effectivePoolId = poolId || gameState?.id;
    const effectiveConfig = config || gameState?.props;
    const effectiveIsLocked = isLocked ?? gameState?.isLocked ?? false;

    // Early return moved to bottom to satisfy Rules of Hooks
    // if (!effectivePoolId || !effectiveConfig) return null;
    const [answers, setAnswers] = useState<Record<string, number>>({});
    const [tiebreaker, setTiebreaker] = useState('');
    const [cardName, setCardName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fetchedCards, setFetchedCards] = useState<PropCard[]>([]);
    const [allPoolCards, setAllPoolCards] = useState<PropCard[]>([]);
    const [viewingCardId, setViewingCardId] = useState<string | null>(null);
    const [editingCardId, setEditingCardId] = useState<string | null>(null); // NEW: editing mode
    // Auto-show new card form when no userCards provided (will hide once cards are fetched)
    const [showNewCardForm, setShowNewCardForm] = useState((!userCards || userCards.length === 0) && !effectiveIsLocked);

    const activeCards = userCards || fetchedCards;
    const [isConfirming, setIsConfirming] = useState(false);
    const [liabilityAccepted, setLiabilityAccepted] = useState(false);

    const questions = effectiveConfig?.questions || [];
    const cost = effectiveConfig?.cost || 5;
    const maxCards = effectiveConfig?.maxCards || 1;

    // Subscribe to cards if not provided via props
    useEffect(() => {
        // if (userCards) return; // REMOVED: Always fetch to get global stats
        if (!effectivePoolId || !currentUser?.id) return; // Use id (uid) for subscription filter

        const unsub = dbService.subscribeToPropCards(effectivePoolId, (cards) => {
            setAllPoolCards(cards); // Store all cards for stats

            if (!userCards) {
                const myCards = cards.filter((c) => c.userId === currentUser.id);
                setFetchedCards(myCards);

                // Auto-show new card form if no cards yet and not locked
                if (myCards.length === 0 && !effectiveIsLocked) {
                    setShowNewCardForm(true);
                }
            }
        });
        return () => unsub();
    }, [effectivePoolId, currentUser?.id, userCards, effectiveIsLocked]);

    const canBuyMoreCards = activeCards.length < maxCards;
    const viewingCard = viewingCardId ? activeCards.find(c => c.id === viewingCardId) : null;

    useEffect(() => {
        if (userCards && userCards.length === 0 && !effectiveIsLocked) {
            setShowNewCardForm(true);
        }
    }, [userCards, effectiveIsLocked]);

    // Force close form if locked
    useEffect(() => {
        if (effectiveIsLocked) {
            setShowNewCardForm(false);
            setEditingCardId(null);
        }
    }, [effectiveIsLocked]);

    const handleInitPurchase = () => {
        if (!currentUser) return;
        setError(null);

        if (Object.keys(answers).length < questions.length) {
            setError("Please answer all questions.");
            return;
        }

        if (!tiebreaker) {
            setError("Please enter a tiebreaker.");
            return;
        }

        setLiabilityAccepted(false); // Reset checkbox
        setIsConfirming(true);
    };

    const handleFinalizePurchase = async () => {
        if (!currentUser || !effectivePoolId) return;
        setIsSubmitting(true);
        setError(null);

        try {
            const name = cardName.trim() || `Card #${activeCards.length + 1} `;

            await dbService.purchasePropCard(effectivePoolId, answers, Number(tiebreaker), currentUser.name || currentUser.email, name);
            // Reset form

            setAnswers({});
            setTiebreaker('');
            setCardName('');
            setShowNewCardForm(false);
            setIsConfirming(false);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to submit card.");
            setIsConfirming(false); // Close modal on error to show error message
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSelect = (qId: string, optIdx: number) => {
        // Allow selection when creating new OR editing existing
        if (viewingCardId && !editingCardId) return;
        setAnswers(prev => ({ ...prev, [qId]: optIdx }));
    };

    // Start editing an existing card
    const handleStartEdit = (card: PropCard & { id: string }) => {
        if (effectiveIsLocked) return;
        setEditingCardId(card.id);
        setViewingCardId(null); // Ensure we are NOT in viewing mode, but in editing mode
        setAnswers(card.answers || {});
        setTiebreaker(card.tiebreakerVal?.toString() || '');
        setCardName(card.cardName || '');
        setShowNewCardForm(true); // Show the form for editing
    };

    // Save edits to existing card
    const handleSaveEdit = async () => {
        if (!editingCardId || !effectivePoolId) return;
        setIsSubmitting(true);
        setError(null);

        if (Object.keys(answers).length < questions.length) {
            setError("Please answer all questions.");
            setIsSubmitting(false);
            return;
        }

        if (!tiebreaker) {
            setError("Please enter a tiebreaker.");
            setIsSubmitting(false);
            return;
        }

        try {
            await dbService.updatePropCard(effectivePoolId, editingCardId, {
                answers,
                tiebreakerVal: Number(tiebreaker),
                cardName: cardName || undefined
            });
            // Reset edit state
            setEditingCardId(null);
            setViewingCardId(null);
            setAnswers({});
            setTiebreaker('');
            setCardName('');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to save changes.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Calculate score for a card
    const getCardScore = (card: PropCard) => {
        let score = 0;
        let correctCount = 0;
        questions.forEach(q => {
            if (q.correctOption !== undefined && card.answers?.[q.id] === q.correctOption) {
                score += (q.points || 1);
                correctCount++;
            }
        });
        return { score, correctCount };
    };

    const getTotalPoints = () => questions.reduce((sum, q) => sum + (q.points || 1), 0);
    const displayAnswers = viewingCard ? viewingCard.answers : answers;

    if (!effectivePoolId || !effectiveConfig) return null;

    return (
        <div className="max-w-2xl mx-auto p-4 space-y-6 font-body">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-display font-bold uppercase text-[color:var(--text)] flex items-center justify-center gap-2">
                    <Trophy className="text-gold-500" />
                    Side Hustle Props
                </h2>
                <p className="text-muted">Entry Fee: <span className="text-gold-600 dark:text-gold-400 font-bold num">${cost}</span> per card</p>
            </div>

            {/* Existing Cards */}
            {activeCards.length > 0 && (
                <div className="bg-card p-4 rounded-xl border border-line shadow-card mb-4">
                    <h3 className="text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] mb-3 flex items-center gap-2">
                        <Trophy size={16} className="text-gold-500" /> Your Cards ({activeCards.length}/{maxCards})
                    </h3>
                    <div className="space-y-2">
                        {activeCards.map((card, idx) => {
                            const { score, correctCount } = getCardScore(card);
                            const isViewing = card.id === viewingCardId;
                            return (
                                <div
                                    key={card.id || idx}
                                    className={`p-3 rounded-lg flex items-center justify-between cursor-pointer transition-all duration-150 ${isViewing ? 'bg-navy-800/10 border border-navy-700 dark:border-gold-500' : 'bg-surface border border-line hover:border-navy-600'}`}
                                    onClick={() => setViewingCardId(isViewing ? null : card.id || null)}
                                >
                                    <div>
                                        <div className="text-[color:var(--text)] font-medium">{card.cardName || `Card #${idx + 1} `}</div>
                                        <div className="text-xs text-muted num">
                                            Score: <span className="text-gold-600 dark:text-gold-400">{score}/{getTotalPoints()}</span> •
                                            Correct: <span className="text-[color:var(--text)]">{correctCount}/{questions.length}</span> •
                                            TB: {card.tiebreakerVal}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!effectiveIsLocked && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (card.id) handleStartEdit(card as PropCard & { id: string });
                                                }}
                                                className="p-2 text-navy-700 dark:text-gold-400 hover:bg-page rounded-full transition-colors duration-150"
                                                title="Edit Picks"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                        )}
                                        <Eye size={16} className={isViewing ? 'text-navy-700 dark:text-gold-400' : 'text-faint'} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {canBuyMoreCards && !showNewCardForm && !effectiveIsLocked && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { setViewingCardId(null); setShowNewCardForm(true); setAnswers({}); setTiebreaker(''); }}
                            className="mt-3 w-full"
                        >
                            <Plus size={16} /> Buy Another Card (${cost})
                        </Button>
                    )}
                </div>
            )}

            {/* Viewing Card Banner */}
            {viewingCard && (
                <div className="bg-navy-600/10 border border-navy-600/30 dark:border-gold-500/40 p-4 rounded-xl mb-6 text-center">
                    <h3 className="text-navy-800 dark:text-gold-400 font-display font-bold uppercase tracking-[0.05em] text-lg">Viewing: {viewingCard.cardName || 'Your Card'}</h3>
                    <p className="text-[color:var(--text)]">
                        Score: <span className="font-display font-bold text-2xl mx-2 num">{getCardScore(viewingCard).score} / {getTotalPoints()} pts</span>
                    </p>
                    <div className="flex justify-center gap-2 mt-2">
                        {!effectiveIsLocked && (
                            <button
                                onClick={() => viewingCard && viewingCard.id && handleStartEdit(viewingCard as PropCard & { id: string })}
                                className="text-xs text-navy-800 dark:text-gold-400 hover:opacity-80 border border-navy-600/50 dark:border-gold-500/50 px-3 py-1 rounded-full flex items-center gap-1 font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150"
                            >
                                <Edit2 size={12} /> Edit Picks
                            </button>
                        )}
                        <button
                            onClick={() => setViewingCardId(null)}
                            className="text-xs text-muted hover:text-[color:var(--text)] px-3 py-1 font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150"
                        >
                            Close View
                        </button>
                    </div>
                </div>
            )}

            {/* New Card Form - Card Naming */}
            {showNewCardForm && !viewingCardId && (
                <div className={`p-4 rounded-xl mb-6 ${editingCardId ? 'bg-navy-600/10 border border-navy-600/30 dark:border-gold-500/40' : 'bg-gold-500/10 border border-gold-500/30'}`}>
                    <h3 className={`${editingCardId ? 'text-navy-800 dark:text-gold-400' : 'text-gold-700 dark:text-gold-400'} font-display font-bold uppercase tracking-[0.05em] text-lg mb-2`}>
                        {editingCardId ? 'Edit Card' : 'New Card'}
                    </h3>
                    <input
                        type="text"
                        placeholder={`Card name(e.g. "${currentUser?.name || 'My'}'s Lucky Pick")`}
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        className="w-full bg-page border-[1.5px] border-line text-[color:var(--text)] placeholder:text-faint px-3 py-2 rounded-md focus:border-navy-600 outline-none"
                    />
                </div>
            )}

            {/* Questions - Show if creating new card OR viewing existing */}
            {(showNewCardForm || viewingCardId) && (
                <div className="space-y-6">
                    {questions.map((q, idx) => (
                        <div key={q.id} className="bg-card p-5 rounded-xl border border-line shadow-card">
                            <div className="flex items-start justify-between mb-4">
                                <h4 className="text-[color:var(--text)] font-medium text-lg">{idx + 1}. {q.text}</h4>
                                <span className="text-gold-700 dark:text-gold-400 text-xs font-display font-bold uppercase tracking-[0.05em] num bg-gold-500/10 border border-gold-500/25 px-2 py-1 rounded">{q.points || 1} pts</span>
                            </div>
                            <div className={`grid gap-3 ${q.options.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
                                {q.options.map((opt, optIdx) => {
                                    const isSelected = displayAnswers[q.id] === optIdx;
                                    const isCorrect = q.correctOption === optIdx;
                                    const showResult = viewingCardId && q.correctOption !== undefined;

                                    let borderClass = 'border-line hover:border-navy-600';
                                    let bgClass = 'bg-surface';
                                    let textClass = 'text-muted';

                                    if (isSelected) {
                                        borderClass = 'border-navy-800 ring-1 ring-navy-800 dark:border-gold-500 dark:ring-gold-500';
                                        bgClass = 'bg-navy-800';
                                        textClass = 'text-white';
                                    }

                                    if (showResult) {
                                        if (isCorrect) {
                                            borderClass = 'border-[#0F7B4A]';
                                            bgClass = 'bg-[#E4F5EC]';
                                            textClass = 'text-[#0F7B4A]';
                                        } else if (isSelected && !isCorrect) {
                                            borderClass = 'border-brandred-500';
                                            bgClass = 'bg-brandred-600/10 opacity-75';
                                            textClass = 'text-brandred-600';
                                        }
                                    }

                                    return (
                                        <button
                                            key={optIdx}
                                            disabled={!!viewingCardId}
                                            onClick={() => handleSelect(q.id, optIdx)}
                                            className={`p-4 rounded-lg border text-left transition-all duration-150 relative ${borderClass} ${bgClass} ${viewingCardId ? 'cursor-default' : ''}`}
                                        >
                                            <span className={`font-medium ${textClass}`}>{opt}</span>
                                            {showResult && isCorrect && (
                                                <div className="absolute top-2 right-2 text-[#0F7B4A] bg-[#BEE7D0] rounded-full p-0.5">
                                                    <Check size={12} />
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Tiebreaker - Only for new cards */}
            {showNewCardForm && !viewingCardId && (
                <>
                    <div className="bg-card p-5 rounded-xl border border-line shadow-card">
                        <h4 className="text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] text-lg mb-2">Tiebreaker</h4>
                        <p className="text-muted text-sm mb-3">Total points scored in the game (both teams combined).</p>
                        <input
                            type="number"
                            placeholder="e.g. 45"
                            className="w-full bg-page border-[1.5px] border-line text-[color:var(--text)] placeholder:text-faint px-4 py-3 rounded-md text-lg font-bold num focus:border-navy-600 outline-none"
                            value={tiebreaker}
                            onChange={e => setTiebreaker(e.target.value)}
                        />
                    </div>

                    {/* Login Required (if not logged in) */}
                    {!currentUser && (
                        <div className="bg-card p-6 rounded-xl border border-line shadow-card text-center">
                            <Lock className="w-12 h-12 text-gold-500 mx-auto mb-4" />
                            <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Login Required</h3>
                            <p className="text-muted mb-6">
                                You must be signed in to submit your picks for this pool.
                            </p>
                            <Button onClick={() => onOpenAuth?.()} className="px-8">
                                Sign In / Register
                            </Button>
                        </div>
                    )}

                    {error && (
                        <div className="bg-brandred-600/10 border border-brandred-600/30 p-4 rounded-xl text-brandred-600 text-center">
                            {error}
                        </div>
                    )}

                    <Button
                        size="lg"
                        onClick={editingCardId ? handleSaveEdit : handleInitPurchase}
                        disabled={isSubmitting || effectiveIsLocked}
                        className="w-full rounded-xl text-lg"
                    >
                        {isSubmitting ? (editingCardId ? 'Saving...' : 'Submitting...') : effectiveIsLocked ? (
                            <><Lock size={20} /> Picks Locked</>
                        ) : editingCardId ? (
                            <><Save size={20} /> Save Changes</>
                        ) : (
                            <><Plus size={20} /> Purchase Card (${cost})</>
                        )}
                    </Button>

                    {(activeCards.length > 0 || editingCardId) && (
                        <button
                            onClick={() => {
                                setShowNewCardForm(false);
                                setEditingCardId(null);
                                setAnswers({});
                                setTiebreaker('');
                                setCardName('');
                            }}
                            className="w-full py-2 text-muted hover:text-[color:var(--text)] transition-colors duration-150"
                        >
                            Cancel
                        </button>
                    )}
                </>
            )}

            {/* Locked / Max Reached Message */}
            {!showNewCardForm && !viewingCardId && (
                <div className="text-center p-6 text-muted">
                    {effectiveIsLocked ? (
                        <>
                            <Lock size={24} className="mx-auto mb-2 text-brandred-500" />
                            <p className="text-brandred-600 font-display font-bold uppercase tracking-[0.05em] mb-6">Picks locked</p>

                            {/* STATS DISPLAY */}
                            <div className="text-left space-y-6 animate-in fade-in">
                                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] text-center mb-6 flex items-center justify-center gap-2">
                                    <Trophy size={20} className="text-gold-500" />
                                    Pool Statistics
                                </h3>
                                <div className="text-center text-xs text-muted mb-4 num">
                                    Based on {allPoolCards.length} entries
                                </div>
                                {questions.map((q, qIdx) => {
                                    // Count answers
                                    const counts = new Array(q.options.length).fill(0);
                                    allPoolCards.forEach(c => {
                                        const ans = c.answers[q.id];
                                        if (ans !== undefined && ans >= 0 && ans < counts.length) {
                                            counts[ans]++;
                                        }
                                    });

                                    return (
                                        <div key={q.id} className="bg-card p-4 rounded-xl border border-line shadow-card">
                                            <h4 className="text-[color:var(--text)] font-medium mb-3 flex items-start gap-2">
                                                <span className="text-faint font-bold num">{qIdx + 1}.</span>
                                                {q.text}
                                            </h4>
                                            <div className="space-y-3">
                                                {q.options.map((opt, optIdx) => {
                                                    const count = counts[optIdx];
                                                    const pct = allPoolCards.length > 0 ? Math.round((count / allPoolCards.length) * 100) : 0;
                                                    const isCorrect = q.correctOption === optIdx;

                                                    return (
                                                        <div key={optIdx} className="relative">
                                                            <div className="flex justify-between text-xs mb-1 text-muted font-medium">
                                                                <div className="flex items-center gap-2">
                                                                    <span className={isCorrect ? 'text-[#0F7B4A] font-bold' : ''}>
                                                                        {opt}
                                                                    </span>
                                                                    {isCorrect && <Check size={12} className="text-[#0F7B4A]" />}
                                                                </div>
                                                                <span className="num">{pct}% ({count})</span>
                                                            </div>
                                                            <div className="h-2 bg-line rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full rounded-full ${isCorrect ? 'bg-[#0F7B4A]' : 'bg-navy-600 dark:bg-gold-500'}`}
                                                                    style={{ width: `${pct}%`, opacity: count === 0 ? 0 : 1 }}
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </>
                    ) : !canBuyMoreCards ? (
                        <>
                            <Trophy size={24} className="mx-auto mb-2 text-faint" />
                            <p className="num">Maximum entries reached ({maxCards}/{maxCards}).</p>
                        </>
                    ) : null}
                </div>
            )}

            {/* Confirmation Modal */}
            {isConfirming && (
                <OverlayRoot id="props-confirm-submission" label="Confirm prop card submission" onEscape={() => { if (!isSubmitting) setIsConfirming(false); }} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-card border border-line p-6 rounded-xl shadow-panel max-w-sm w-full">
                        <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                            {isSubmitting ? <Loader className="animate-spin text-gold-500" /> : <Check className="text-[#0F7B4A]" />}
                            Confirm Prop Card Submission
                        </h3>

                        <div className="bg-surface border border-line rounded-lg p-4 mb-4 space-y-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted">Player:</span>
                                <span className="text-[color:var(--text)] font-bold">{currentUser?.name || currentUser?.email || 'Unknown User'}</span>
                            </div>
                            <div className="border-t border-line pt-3 flex justify-between text-lg">
                                <span className="text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em]">Total Due:</span>
                                <span className="text-gold-600 dark:text-gold-400 num font-display font-bold">${cost}</span>
                            </div>
                        </div>

                        {/* LIABILITY DISCLAIMER */}
                        <div className="mb-6">
                            <label className="flex items-start gap-3 cursor-pointer group">
                                <div className="relative flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={liabilityAccepted}
                                        onChange={(e) => setLiabilityAccepted(e.target.checked)}
                                        className="peer h-5 w-5 cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-line bg-page transition-all checked:border-navy-800 checked:bg-navy-800 hover:border-navy-600"
                                    />
                                    <Check size={14} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
                                </div>
                                <p className="text-xs text-muted leading-relaxed group-hover:text-[color:var(--text)] transition-colors">
                                    By checking this box and selecting Purchase Prop Card, I acknowledge and agree that MarchMeleePools does not administer, hold, or distribute prizes. Any prizes are provided solely by the Pool Manager/Organizer. Any questions, disputes, or claims related to prizes or pool outcomes must be resolved directly between the user and the Pool Manager/Organizer.
                                </p>
                            </label>
                        </div>

                        <div className="flex gap-3">
                            <Button
                                variant="ghost"
                                onClick={() => setIsConfirming(false)}
                                disabled={isSubmitting}
                                className="flex-1"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleFinalizePurchase}
                                disabled={!liabilityAccepted || isSubmitting}
                                className="flex-1"
                            >
                                {isSubmitting ? 'Submitting...' : 'Submit Prop Card'}
                            </Button>
                        </div>
                    </div>
                </OverlayRoot>
            )}

        </div>
    );
};
