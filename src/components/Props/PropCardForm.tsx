import React, { useState, useEffect } from 'react';
import type { GameState, PropCard } from '../../types';
import { dbService } from '../../services/dbService';
import { Check, Lock, Trophy, Plus, Eye } from 'lucide-react';

interface PropCardFormProps {
    gameState: GameState;
    currentUser: any;
    userCard?: PropCard | null; // Legacy single card (deprecated)
}

export const PropCardForm: React.FC<PropCardFormProps> = ({ gameState, currentUser }) => {
    const [answers, setAnswers] = useState<Record<string, number>>({});
    const [tiebreaker, setTiebreaker] = useState('');
    const [cardName, setCardName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userCards, setUserCards] = useState<PropCard[]>([]);
    const [viewingCardId, setViewingCardId] = useState<string | null>(null);
    const [showNewCardForm, setShowNewCardForm] = useState(false);

    const questions = gameState.props?.questions || [];
    const cost = gameState.props?.cost || 5;
    const maxCards = gameState.props?.maxCards || 1;

    // Subscribe to user's cards
    useEffect(() => {
        if (!gameState.id || !currentUser?.uid) return;

        const unsub = dbService.subscribeToAllPropCards(gameState.id, (cards) => {
            const myCards = cards.filter((c: any) => c.userId === currentUser.uid);
            setUserCards(myCards);

            // Auto-show new card form if no cards yet
            if (myCards.length === 0) {
                setShowNewCardForm(true);
            }
        });
        return () => unsub();
    }, [gameState.id, currentUser?.uid]);

    const canBuyMoreCards = userCards.length < maxCards;
    const viewingCard = viewingCardId ? userCards.find(c => (c as any).id === viewingCardId) : null;

    const handleSubmit = async () => {
        if (!currentUser) return;
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
            const name = cardName.trim() || `Card #${userCards.length + 1}`;
            await dbService.purchasePropCard(gameState.id, answers, Number(tiebreaker), currentUser.name || currentUser.email, name);
            // Reset form
            setAnswers({});
            setTiebreaker('');
            setCardName('');
            setShowNewCardForm(false);
        } catch (e: any) {
            setError(e.message || "Failed to submit card.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSelect = (qId: string, optIdx: number) => {
        if (viewingCardId) return; // Viewing existing card, can't edit
        setAnswers(prev => ({ ...prev, [qId]: optIdx }));
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
            {userCards.length > 0 && (
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 mb-4">
                    <h3 className="text-white font-bold mb-3 flex items-center gap-2">
                        <Trophy size={16} className="text-amber-400" /> Your Cards ({userCards.length}/{maxCards})
                    </h3>
                    <div className="space-y-2">
                        {userCards.map((card, idx) => {
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
                                    <Eye size={16} className={isViewing ? 'text-indigo-400' : 'text-slate-500'} />
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
                    <button
                        onClick={() => setViewingCardId(null)}
                        className="mt-2 text-xs text-indigo-400 hover:text-indigo-300"
                    >
                        Close View
                    </button>
                </div>
            )}

            {/* New Card Form - Card Naming */}
            {showNewCardForm && !viewingCardId && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl mb-6">
                    <h3 className="text-emerald-400 font-bold text-lg mb-2">New Card</h3>
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

                    {error && (
                        <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded-xl text-rose-400 text-center">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || gameState.isLocked}
                        className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl text-lg shadow-lg shadow-indigo-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? 'Submitting...' : gameState.isLocked ? (
                            <><Lock size={20} /> Picks Locked</>
                        ) : (
                            <>Purchase Card (${cost})</>
                        )}
                    </button>

                    {userCards.length > 0 && (
                        <button
                            onClick={() => setShowNewCardForm(false)}
                            className="w-full py-2 text-slate-400 hover:text-slate-300"
                        >
                            Cancel
                        </button>
                    )}
                </>
            )}

            {/* Locked Message */}
            {!showNewCardForm && !viewingCardId && userCards.length > 0 && (
                <div className="text-center p-6 text-slate-500">
                    <Lock size={24} className="mx-auto mb-2" />
                    <p>Picks locked. Good luck!</p>
                </div>
            )}
        </div>
    );
};
