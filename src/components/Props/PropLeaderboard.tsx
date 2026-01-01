import React, { useMemo, useState, useEffect } from 'react';
import type { GameState, PropCard } from '../../types';
import { Trophy, Medal } from 'lucide-react';
import { dbService } from '../../services/dbService';

interface PropLeaderboardProps {
    gameState: GameState;
    currentUser: any;
    cards?: PropCard[];
}

interface LeaderboardEntry extends PropCard {
    id: string; // Ensure ID is present
    calculatedScore: number;
    correctCount: number;
}

export const PropLeaderboard: React.FC<PropLeaderboardProps> = ({ gameState, currentUser, cards }) => {
    const questions = gameState.props?.questions || [];
    const totalPossiblePoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);

    // Internal state for fallback fetching
    const [internalCards, setInternalCards] = useState<PropCard[]>([]);

    useEffect(() => {
        // Only fetch if cards prop is not provided
        if (cards) return;

        const unsub = dbService.subscribeToAllPropCards(gameState.id, (data) => {
            setInternalCards(data);
        });
        return () => unsub();
    }, [gameState.id, cards]);

    const effectiveCards = cards || internalCards;

    const sortedCards = useMemo(() => {
        // Calculate scores from questions
        const enriched: LeaderboardEntry[] = effectiveCards.map((card: any) => {
            let calculatedScore = 0;
            let correctCount = 0;
            questions.forEach(q => {
                if (q.correctOption !== undefined && card.answers?.[q.id] === q.correctOption) {
                    calculatedScore += (q.points || 1);
                    correctCount++;
                }
            });
            return { ...card, calculatedScore, correctCount, id: card.id || card.userId };
        });

        // Sort by score DESC, then tiebreaker
        return enriched.sort((a, b) => {
            if (b.calculatedScore !== a.calculatedScore) return b.calculatedScore - a.calculatedScore;
            return (a.tiebreakerVal || 0) - (b.tiebreakerVal || 0);
        });
    }, [effectiveCards, questions]);

    const getRankIcon = (index: number) => {
        if (index === 0) return <Trophy className="text-amber-400" size={20} />;
        if (index === 1) return <Medal className="text-slate-300" size={20} />;
        if (index === 2) return <Medal className="text-amber-600" size={20} />;
        return <span className="font-mono text-slate-500 font-bold">#{index + 1}</span>;
    };

    const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

    const toggleExpand = (id: string | undefined) => {
        if (!id) return;
        setExpandedCardId(prev => prev === id ? null : id);
    };

    return (
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-lg animate-in fade-in slide-in-from-bottom-4 delay-100">
            <div className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                <h3 className="font-bold text-white flex items-center gap-2">
                    <Trophy size={18} className="text-indigo-400" /> Leaderboard
                </h3>
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">{sortedCards.length} Entries</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-900/50 text-slate-400 uppercase font-bold text-xs">
                        <tr>
                            <th className="p-4 w-12 text-center">Rank</th>
                            <th className="p-4">Player</th>
                            <th className="p-4 text-center">Score</th>
                            <th className="p-4 text-center">Correct</th>
                            <th className="p-4 text-center">TB</th>
                            <th className="p-4 w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {sortedCards.map((card, idx) => {
                            const isMe = currentUser && card.userId === currentUser.id;
                            const isExpanded = expandedCardId === card.id;

                            return (
                                <React.Fragment key={card.id || card.userId}>
                                    <tr
                                        onClick={() => toggleExpand(card.id)}
                                        className={`${isMe ? 'bg-indigo-500/10' : 'hover:bg-slate-800/50'} transition-colors cursor-pointer group`}
                                    >
                                        <td className="p-4 text-center flex justify-center">
                                            {getRankIcon(idx)}
                                        </td>
                                        <td className="p-4">
                                            <div className="font-bold text-white flex items-center gap-2">
                                                {card.userName || 'Anonymous'}
                                                {isMe && <span className="bg-indigo-500 text-white text-[10px] px-1.5 py-0.5 rounded uppercase">You</span>}
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="font-mono text-emerald-400 font-bold text-lg">{card.calculatedScore}</span>
                                            <span className="text-slate-600 text-xs ml-1">/{totalPossiblePoints}</span>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="font-mono text-indigo-400">{card.correctCount}</span>
                                            <span className="text-slate-600 text-xs ml-1">/{questions.length}</span>
                                        </td>
                                        <td className="p-4 text-center font-mono text-slate-400">
                                            {card.tiebreakerVal || '-'}
                                        </td>
                                        <td className="p-4 text-center text-slate-500 group-hover:text-white transition-colors">
                                            {/* Use a simple character or icon if lucide not imported yet, but I'll add import in next step if needed or just use text for now to be safe, wait I see icons in file. Need ChevronDown. */}
                                            {isExpanded ? '▼' : '▶'}
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={6} className="bg-slate-950/50 p-0 shadow-inner">
                                                <div className="p-6 border-b border-slate-800 animate-in fade-in zoom-in-95 duration-200">
                                                    {!gameState.isLocked ? (
                                                        <div className="text-center py-8 text-slate-500 italic flex flex-col items-center justify-center gap-2">
                                                            <div className="bg-slate-900 p-3 rounded-full mb-2">
                                                                <span className="text-2xl">🔒</span>
                                                            </div>
                                                            <p>Picks hidden until pool locks.</p>
                                                            <p className="text-xs">Check back after the deadline!</p>
                                                        </div>
                                                    ) : (
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                            {questions.map((q, qIdx) => {
                                                                const answerIdx = card.answers[q.id];
                                                                const answerText = q.options[answerIdx] || 'No Pick';
                                                                const isCorrect = q.correctOption !== undefined && q.correctOption === answerIdx;
                                                                const isWrong = q.correctOption !== undefined && q.correctOption !== answerIdx;

                                                                return (
                                                                    <div key={q.id} className={`p-3 rounded-lg border flex justify-between items-start gap-3 ${isCorrect ? 'bg-emerald-500/10 border-emerald-500/30' :
                                                                            isWrong ? 'bg-rose-500/5 border-rose-500/20' :
                                                                                'bg-slate-900 border-slate-800'
                                                                        }`}>
                                                                        <div>
                                                                            <div className="text-xs text-slate-500 mb-1 line-clamp-1">{qIdx + 1}. {q.text}</div>
                                                                            <div className={`font-bold ${isCorrect ? 'text-emerald-400' : isWrong ? 'text-rose-400' : 'text-slate-300'}`}>
                                                                                {answerText}
                                                                            </div>
                                                                        </div>
                                                                        {isCorrect && <span className="text-emerald-500 text-lg">✓</span>}
                                                                        {isWrong && <span className="text-rose-500 text-lg">✗</span>}
                                                                    </div>
                                                                );
                                                            })}
                                                            <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex justify-between items-center">
                                                                <span className="text-indigo-300 font-bold">Tiebreaker</span>
                                                                <span className="text-white font-mono font-bold text-lg">{card.tiebreakerVal}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        {sortedCards.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-8 text-center text-slate-500">
                                    No players have joined yet. Be the first!
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

