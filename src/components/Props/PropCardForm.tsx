import React, { useState, useEffect } from 'react';
import type { GameState, PropCard, PropsPool } from '../../types';
import { dbService } from '../../services/dbService';
import { Check, Lock, Trophy, Plus, Eye, Edit2, Save, Loader } from 'lucide-react';

interface PropCardFormProps {
    gameState?: GameState;
    currentUser: any;
    userCard?: PropCard | null;
    poolId?: string;
    config?: PropsPool['props'];
    isLocked?: boolean;
    userCards?: PropCard[];
}

export const PropCardForm: React.FC<PropCardFormProps> = ({ gameState, currentUser, poolId, config, isLocked, userCards }) => {
    const effectivePoolId = poolId || gameState?.id;
    const effectiveConfig = config || gameState?.props;
    const effectiveIsLocked = isLocked ?? gameState?.isLocked ?? false;

    if (!effectivePoolId || !effectiveConfig) return null;
    const [answers, setAnswers] = useState<Record<string, number>>({});
    const [tiebreaker, setTiebreaker] = useState('');
    const [cardName, setCardName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fetchedCards, setFetchedCards] = useState<PropCard[]>([]);
    const [viewingCardId, setViewingCardId] = useState<string | null>(null);
    const [editingCardId, setEditingCardId] = useState<string | null>(null); // NEW: editing mode
    const [showNewCardForm, setShowNewCardForm] = useState(false);

    // Guest State
    const [guestName, setGuestName] = useState('');
    const [guestEmail, setGuestEmail] = useState('');

    const activeCards = userCards || fetchedCards;
    const [isConfirming, setIsConfirming] = useState(false);
    const [liabilityAccepted, setLiabilityAccepted] = useState(false);

    const questions = effectiveConfig?.questions || [];
    const cost = effectiveConfig?.cost || 5;
    const maxCards = effectiveConfig?.maxCards || 1;

    // Subscribe to cards if not provided via props
    useEffect(() => {
        if (userCards) return;
        if (!effectivePoolId || !currentUser?.id) return;

        const unsub = dbService.subscribeToAllPropCards(effectivePoolId, (cards) => {
            const myCards = cards.filter((c: any) => c.userId === currentUser.id);
            setFetchedCards(myCards);

            // Auto-show new card form if no cards yet
            if (myCards.length === 0) {
                setShowNewCardForm(true);
            }
        });
        return () => unsub();
    }, [effectivePoolId, currentUser?.id]);

    const canBuyMoreCards = activeCards.length < maxCards;
    const viewingCard = viewingCardId ? activeCards.find(c => (c as any).id === viewingCardId) : null;

    useEffect(() => {
        if (userCards && userCards.length === 0) {
            setShowNewCardForm(true);
        }
    }, [userCards]);

    const handleInitPurchase = () => {
        // if (!currentUser) return; // Allow guests
        setError(null);

        if (Object.keys(answers).length < questions.length) {
            setError("Please answer all questions.");
            return;
        }

        if (!tiebreaker) {
            setError("Please enter a tiebreaker.");
            return;
        }

        if (!currentUser) {
            if (!guestName.trim()) {
                setError("Guest Name is required.");
                return;
            }
            if (!guestEmail.trim() || !guestEmail.includes('@')) {
                setError("Valid Guest Email is required.");
                return;
            }
        }

        setLiabilityAccepted(false); // Reset checkbox
        setIsConfirming(true);
    };

    const handleFinalizePurchase = async () => {
        // if (!currentUser) return; // Allow guests
        setIsSubmitting(true);
        setError(null);

        try {
            const name = cardName.trim() || `Card #${activeCards.length + 1}`;
            // If guest, use guest data
            const finalUserName = currentUser ? (currentUser.name || currentUser.email) : guestName;
            const finalEmail = currentUser ? undefined : guestEmail;

            await dbService.purchasePropCard(effectivePoolId, answers, Number(tiebreaker), finalUserName, name, finalEmail);
            // Reset form

            setAnswers({});
            setTiebreaker('');
            setCardName('');
            setShowNewCardForm(false);
            setIsConfirming(false);
        } catch (e: any) {
            setError(e.message || "Failed to submit card.");
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
        if (!editingCardId) return;
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
            await dbService.updatePropCard(effectivePoolId, editingCardId, answers, Number(tiebreaker), cardName || undefined);
            // Reset edit state
            setEditingCardId(null);
            setViewingCardId(null);
            setAnswers({});
            setTiebreaker('');
            setCardName('');
        } catch (e: any) {
            setError(e.message || "Failed to save changes.");
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

    return (
        <div className="max-w-2xl mx-auto p-4 space-y-6">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-white flex items-center justify-center gap-2">
                    <Trophy className="text-amber-400" />
                    Side Hustle Props
                </h2>
                <p className="text-slate-400">Entry Fee: <span className="text-emerald-400 font-bold">${cost}</span> per card</p>
            </div>

            {/* Existing Cards */}
            {activeCards.length > 0 && (
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 mb-4">
                    <h3 className="text-white font-bold mb-3 flex items-center gap-2">
                        <Trophy size={16} className="text-amber-400" /> Your Cards ({activeCards.length}/{maxCards})
                    </h3>
                    <div className="space-y-2">
                        {activeCards.map((card, idx) => {
                            const { score, correctCount } = getCardScore(card);
                            const isViewing = (card as any).id === viewingCardId;
                            return (
                                <div
                                    key={(card as any).id || idx}
                                    className={`p-3 rounded-lg flex items-center justify-between cursor-pointer transition-all ${isViewing ? 'bg-indigo-500/20 border border-indigo-500' : 'bg-slate-900 hover:bg-slate-800'
                                        }`}
                                    onClick={() => setViewingCardId(isViewing ? null : (card as any).id)}
                                >
                                    <div>
                                        <div className="text-white font-medium">{card.cardName || `Card #${idx + 1}`}</div>
                                        <div className="text-xs text-slate-500">
                                            Score: <span className="text-emerald-400">{score}/{getTotalPoints()}</span> •
                                            Correct: <span className="text-indigo-400">{correctCount}/{questions.length}</span> •
                                            TB: {card.tiebreakerVal}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!effectiveIsLocked && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleStartEdit(card as any);
                                                }}
                                                className="p-2 text-indigo-400 hover:text-indigo-300 hover:bg-slate-800 rounded-full"
                                                title="Edit Picks"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                        )}
                                        <Eye size={16} className={isViewing ? 'text-indigo-400' : 'text-slate-500'} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {canBuyMoreCards && !showNewCardForm && (
                        <button
                            onClick={() => { setViewingCardId(null); setShowNewCardForm(true); setAnswers({}); setTiebreaker(''); }}
                            className="mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold flex items-center justify-center gap-2"
                        >
                            <Plus size={16} /> Buy Another Card (${cost})
                        </button>
                    )}
                </div>
            )}

            {/* Viewing Card Banner */}
            {viewingCard && (
                <div className="bg-indigo-500/10 border border-indigo-500/30 p-4 rounded-xl mb-6 text-center">
                    <h3 className="text-indigo-400 font-bold text-lg">Viewing: {viewingCard.cardName || 'Your Card'}</h3>
                    <p className="text-slate-300">
                        Score: <span className="text-white font-bold text-2xl mx-2">{getCardScore(viewingCard).score} / {getTotalPoints()} pts</span>
                    </p>
                    <div className="flex justify-center gap-2 mt-2">
                        {!effectiveIsLocked && (
                            <button
                                onClick={() => handleStartEdit(viewingCard as any)}
                                className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/50 px-3 py-1 rounded-full flex items-center gap-1"
                            >
                                <Edit2 size={12} /> Edit Picks
                            </button>
                        )}
                        <button
                            onClick={() => setViewingCardId(null)}
                            className="text-xs text-slate-400 hover:text-slate-300 px-3 py-1"
                        >
                            Close View
                        </button>
                    </div>
                </div>
            )}

            {/* New Card Form - Card Naming */}
            {showNewCardForm && !viewingCardId && (
                <div className={`p-4 rounded-xl mb-6 ${editingCardId ? 'bg-indigo-500/10 border border-indigo-500/30' : 'bg-emerald-500/10 border border-emerald-500/30'}`}>
                    <h3 className={`${editingCardId ? 'text-indigo-400' : 'text-emerald-400'} font-bold text-lg mb-2`}>
                        {editingCardId ? 'Edit Card' : 'New Card'}
                    </h3>
                    <input
                        type="text"
                        placeholder={`Card name (e.g. "${currentUser?.name || 'My'}'s Lucky Pick")`}
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-white px-3 py-2 rounded"
                    />
                </div>
            )}

            {/* Questions - Show if creating new card OR viewing existing */}
            {(showNewCardForm || viewingCardId) && (
                <div className="space-y-6">
                    {questions.map((q, idx) => (
                        <div key={q.id} className="bg-slate-800/50 p-5 rounded-xl border border-slate-700">
                            <div className="flex items-start justify-between mb-4">
                                <h4 className="text-white font-medium text-lg">{idx + 1}. {q.text}</h4>
                                <span className="text-amber-400 text-xs font-bold bg-amber-500/10 px-2 py-1 rounded">{q.points || 1} pts</span>
                            </div>
                            <div className={`grid gap-3 ${q.options.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
                                {q.options.map((opt, optIdx) => {
                                    const isSelected = displayAnswers[q.id] === optIdx;
                                    const isCorrect = q.correctOption === optIdx;
                                    const showResult = viewingCardId && q.correctOption !== undefined;

                                    let borderClass = 'border-slate-600 hover:border-slate-500';
                                    let bgClass = 'bg-slate-900';

                                    if (isSelected) {
                                        borderClass = 'border-indigo-500 ring-1 ring-indigo-500';
                                        bgClass = 'bg-indigo-500/20';
                                    }

                                    if (showResult) {
                                        if (isCorrect) {
                                            borderClass = 'border-emerald-500';
                                            bgClass = 'bg-emerald-500/20';
                                        } else if (isSelected && !isCorrect) {
                                            borderClass = 'border-rose-500';
                                            bgClass = 'bg-rose-500/10 opacity-75';
                                        }
                                    }

                                    return (
                                        <button
                                            key={optIdx}
                                            disabled={!!viewingCardId}
                                            onClick={() => handleSelect(q.id, optIdx)}
                                            className={`p-4 rounded-lg border text-left transition-all relative ${borderClass} ${bgClass} ${viewingCardId ? 'cursor-default' : ''}`}
                                        >
                                            <span className={`font-medium ${isSelected ? 'text-white' : 'text-slate-400'}`}>{opt}</span>
                                            {showResult && isCorrect && (
                                                <div className="absolute top-2 right-2 text-emerald-400 bg-emerald-900/50 rounded-full p-0.5">
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
                    <div className="bg-slate-800/50 p-5 rounded-xl border border-slate-700">
                        <h4 className="text-white font-medium text-lg mb-2">Tiebreaker</h4>
                        <p className="text-slate-400 text-sm mb-3">Total points scored in the game (both teams combined).</p>
                        <input
                            type="number"
                            placeholder="e.g. 45"
                            className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-lg text-lg font-bold"
                            value={tiebreaker}
                            onChange={e => setTiebreaker(e.target.value)}
                        />
                    </div>

                    {/* Guest Fields (if not logged in) */}
                    {!currentUser && (
                        <div className="bg-slate-800/50 p-5 rounded-xl border border-slate-700">
                            <h4 className="text-white font-medium text-lg mb-2 flex items-center gap-2">
                                Guest Info <span className="text-xs font-normal text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">Required</span>
                            </h4>
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-400 font-bold uppercase">Name</label>
                                    <input
                                        type="text"
                                        placeholder="Enter your name"
                                        className="w-full bg-slate-900 border border-slate-700 text-white px-3 py-2 rounded-lg"
                                        value={guestName}
                                        onChange={e => setGuestName(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-400 font-bold uppercase">Email</label>
                                    <input
                                        type="email"
                                        placeholder="Enter your email (for verification)"
                                        className="w-full bg-slate-900 border border-slate-700 text-white px-3 py-2 rounded-lg"
                                        value={guestEmail}
                                        onChange={e => setGuestEmail(e.target.value)}
                                    />
                                    <p className="text-[10px] text-slate-500">
                                        We use this to verify your entry if you win. {` `}
                                        <button onClick={() => window.location.hash = '#auth'} className="text-indigo-400 hover:text-white underline">Sign In</button> to track your history.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded-xl text-rose-400 text-center">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={editingCardId ? handleSaveEdit : handleInitPurchase}
                        disabled={isSubmitting || effectiveIsLocked}
                        className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl text-lg shadow-lg shadow-indigo-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? (editingCardId ? 'Saving...' : 'Submitting...') : effectiveIsLocked ? (
                            <><Lock size={20} /> Picks Locked</>
                        ) : editingCardId ? (
                            <><Save size={20} /> Save Changes</>
                        ) : (
                            <><Plus size={20} /> Purchase Card (${cost})</>
                        )}
                    </button>

                    {(activeCards.length > 0 || editingCardId) && (
                        <button
                            onClick={() => {
                                setShowNewCardForm(false);
                                setEditingCardId(null);
                                setAnswers({});
                                setTiebreaker('');
                                setCardName('');
                            }}
                            className="w-full py-2 text-slate-400 hover:text-slate-300"
                        >
                            Cancel
                        </button>
                    )}
                </>
            )}

            {/* Locked / Max Reached Message */}
            {!showNewCardForm && !viewingCardId && activeCards.length > 0 && (
                <div className="text-center p-6 text-slate-500">
                    {effectiveIsLocked ? (
                        <>
                            <Lock size={24} className="mx-auto mb-2" />
                            <p>Picks locked. Good luck!</p>
                        </>
                    ) : !canBuyMoreCards ? (
                        <>
                            <Trophy size={24} className="mx-auto mb-2 text-slate-600" />
                            <p>Maximum entries reached ({maxCards}/{maxCards}).</p>
                        </>
                    ) : null}
                </div>
            )}

            {/* Confirmation Modal */}
            {isConfirming && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-slate-800 border border-slate-600 p-6 rounded-xl shadow-2xl max-w-sm w-full">
                        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                            {isSubmitting ? <Loader className="animate-spin text-emerald-400" /> : <Check className="text-emerald-400" />}
                            Confirm Prop Card Submission
                        </h3>

                        <div className="bg-slate-900 rounded-lg p-4 mb-4 space-y-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-400">Player:</span>
                                <span className="text-white font-bold">{currentUser ? (currentUser.name || currentUser.email) : `${guestName} (Guest)`}</span>
                            </div>
                            <div className="border-t border-slate-700 pt-3 flex justify-between text-lg">
                                <span className="text-slate-300 font-bold">Total Due:</span>
                                <span className="text-emerald-400 font-mono font-bold">${cost}</span>
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
                                        className="peer h-5 w-5 cursor-pointer appearance-none rounded border border-slate-500 bg-slate-900 transition-all checked:border-emerald-500 checked:bg-emerald-500 hover:border-emerald-400"
                                    />
                                    <Check size={14} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors">
                                    By checking this box and selecting Purchase Prop Card, I acknowledge and agree that MarchMeleePools does not administer, hold, or distribute prizes. Any prizes are provided solely by the Pool Manager/Organizer. Any questions, disputes, or claims related to prizes or pool outcomes must be resolved directly between the user and the Pool Manager/Organizer.
                                </p>
                            </label>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setIsConfirming(false)}
                                disabled={isSubmitting}
                                className="flex-1 py-3 text-slate-400 hover:bg-slate-700 rounded-lg font-bold transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleFinalizePurchase}
                                disabled={!liabilityAccepted || isSubmitting}
                                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg font-bold shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all"
                            >
                                {isSubmitting ? 'Submitting...' : 'Submit Prop Card'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};
