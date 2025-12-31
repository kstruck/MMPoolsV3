import React, { useState, useEffect } from 'react';
import type { GameState, PropCard } from '../../types';
import { dbService } from '../../services/dbService';
import { Check, Lock, Trophy } from 'lucide-react';

interface PropCardFormProps {
    gameState: GameState;
    currentUser: any;
    userCard?: PropCard | null; // Existing card if purchased
}

export const PropCardForm: React.FC<PropCardFormProps> = ({ gameState, currentUser, userCard }) => {
    const [answers, setAnswers] = useState<Record<string, number>>({});
    const [tiebreaker, setTiebreaker] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const questions = gameState.props?.questions || [];
    const cost = gameState.props?.cost || 5;

    useEffect(() => {
        if (userCard) {
            setAnswers(userCard.answers);
            setTiebreaker(userCard.tiebreakerVal?.toString() || '');
        }
    }, [userCard]);

    const handleSubmit = async () => {
        if (!currentUser) return;
        setIsSubmitting(true);
        setError(null);

        // Validate all answered?
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
            await dbService.purchasePropCard(gameState.id, answers, Number(tiebreaker), currentUser.name || currentUser.email);
            // Refresh handled by parent or snapshot
        } catch (e: any) {
            setError(e.message || "Failed to submit card.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSelect = (qId: string, optIdx: number) => {
        if (userCard) return; // Locked if already bought
        setAnswers(prev => ({ ...prev, [qId]: optIdx }));
    };

    // Calculate score if viewing existing card
    const getScore = () => {
        if (!userCard) return 0;
        let score = 0;
        questions.forEach(q => {
            if (q.correctOption !== undefined && userCard.answers[q.id] === q.correctOption) {
                score++;
            }
        });
        return score;
    };

    return (
        <div className="max-w-2xl mx-auto p-4 space-y-6">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-white flex items-center justify-center gap-2">
                    <Trophy className="text-amber-400" />
                    Side Hustle Props
                </h2>
                <p className="text-slate-400">Entry Fee: <span className="text-emerald-400 font-bold">${cost}</span></p>
            </div>

            {userCard && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl mb-6 text-center">
                    <h3 className="text-emerald-400 font-bold text-lg">Card Purchased!</h3>
                    <p className="text-slate-300">Live Score: <span className="text-white font-bold text-2xl ml-2">{getScore()} / {questions.length}</span></p>
                </div>
            )}

            <div className="space-y-6">
                {questions.map((q, idx) => (
                    <div key={q.id} className="bg-slate-800/50 p-5 rounded-xl border border-slate-700">
                        <h4 className="text-white font-medium text-lg mb-4">{idx + 1}. {q.text}</h4>
                        <div className="grid grid-cols-2 gap-3">
                            {q.options.map((opt, optIdx) => {
                                const isSelected = answers[q.id] === optIdx;
                                const isCorrect = q.correctOption === optIdx;
                                const showResult = userCard && q.correctOption !== undefined;

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
                                        disabled={!!userCard}
                                        onClick={() => handleSelect(q.id, optIdx)}
                                        className={`p-4 rounded-lg border text-left transition-all relative ${borderClass} ${bgClass}`}
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

            {/* Tiebreaker */}
            <div className="bg-slate-800/50 p-5 rounded-xl border border-slate-700">
                <h4 className="text-white font-medium text-lg mb-2">Tiebreaker</h4>
                <p className="text-slate-400 text-sm mb-4">Total points scored in the game (both teams combined).</p>
                <input
                    type="number"
                    placeholder="e.g. 45"
                    disabled={!!userCard}
                    value={tiebreaker}
                    onChange={e => setTiebreaker(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-indigo-500 outline-none"
                />
            </div>

            {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-sm text-center">
                    {error}
                </div>
            )}

            {!userCard ? (
                <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all 
                ${isSubmitting ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white'}
            `}
                >
                    {isSubmitting ? 'Processing...' : `Submit Picks • Pay $${cost}`}
                </button>
            ) : (
                <div className="text-center p-4 text-slate-400 text-sm">
                    <Lock size={16} className="inline mr-2" />
                    Picks locked. Good luck!
                </div>
            )}
        </div>
    );
};
