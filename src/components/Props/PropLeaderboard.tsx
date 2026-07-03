import React, { useMemo, useState, useEffect } from 'react';
import type { GameState, PropCard } from '../../types';
import { Trophy, Lock, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { RankChip, YouPill } from '../ui';

interface PropLeaderboardProps {
    gameState: GameState;
    currentUser: any;
    cards?: PropCard[];
    isManager?: boolean;
    isAdmin?: boolean;
}

interface LeaderboardEntry extends PropCard {
    id: string; // Ensure ID is present
    calculatedScore: number;
    correctCount: number;
}

export const PropLeaderboard: React.FC<PropLeaderboardProps> = ({ gameState, currentUser, cards, isManager, isAdmin }) => {
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
        return <RankChip rank={index + 1} />;
    };

    const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

    const toggleExpand = (id: string | undefined) => {
        if (!id) return;
        setExpandedCardId(prev => prev === id ? null : id);
    };

    return (
        <div className="bg-card rounded-xl border border-line overflow-hidden shadow-card animate-in fade-in slide-in-from-bottom-4 delay-100 font-body">
            <div className="p-4 bg-surface border-b border-line flex justify-between items-center">
                <h3 className="font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                    <Trophy size={18} className="text-gold-500" /> Leaderboard
                </h3>
                <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted num">{sortedCards.length} Entries</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-surface text-muted font-display font-bold uppercase text-[12px] tracking-[0.08em]">
                        <tr>
                            <th className="p-4 w-12 text-center">Rank</th>
                            <th className="p-4">Player</th>
                            <th className="p-4 text-center">Score</th>
                            <th className="p-4 text-center">Correct</th>
                            <th className="p-4 text-center">TB</th>
                            <th className="p-4 w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--line)]">
                        {sortedCards.map((card, idx) => {
                            const isMe = currentUser && card.userId === currentUser.id;
                            const isExpanded = expandedCardId === card.id;

                            return (
                                <React.Fragment key={card.id || card.userId}>
                                    <tr
                                        onClick={() => toggleExpand(card.id)}
                                        className={`${isMe ? 'bg-brandred-600/[0.07]' : 'hover:bg-[color:var(--page)]'} transition-colors cursor-pointer group`}
                                    >
                                        <td className="p-4 text-center flex justify-center">
                                            {getRankIcon(idx)}
                                        </td>
                                        <td className="p-4">
                                            <div className="font-bold text-[color:var(--text)] flex items-center gap-2">
                                                {card.userName || 'Anonymous'}
                                                {isMe && <YouPill />}
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="num font-display text-gold-600 dark:text-gold-400 font-bold text-lg">{card.calculatedScore}</span>
                                            <span className="text-faint text-xs ml-1 num">/{totalPossiblePoints}</span>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="num text-[color:var(--text)]">{card.correctCount}</span>
                                            <span className="text-faint text-xs ml-1 num">/{questions.length}</span>
                                        </td>
                                        <td className="p-4 text-center num text-muted">
                                            {card.tiebreakerVal || '-'}
                                        </td>
                                        <td className="p-4 text-center text-faint group-hover:text-[color:var(--text)] transition-colors">
                                            {isExpanded ? <ChevronDown size={16} className="inline-block" /> : <ChevronRight size={16} className="inline-block" />}
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={6} className="bg-surface p-0 shadow-inner">
                                                <div className="p-6 border-b border-line animate-in fade-in zoom-in-95 duration-200">
                                                    {!gameState.isLocked && !isManager && !isAdmin ? (
                                                        <div className="text-center py-8 text-muted italic flex flex-col items-center justify-center gap-2">
                                                            <div className="bg-page border border-line p-3 rounded-full mb-2 text-muted">
                                                                <Lock size={24} />
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
                                                                    <div key={q.id} className={`p-3 rounded-lg border flex justify-between items-start gap-3 ${isCorrect ? 'bg-[#E4F5EC] border-[#BEE7D0]' :
                                                                        isWrong ? 'bg-brandred-600/[0.06] border-brandred-600/25' :
                                                                            'bg-card border-line'
                                                                        }`}>
                                                                        <div>
                                                                            <div className={`text-xs mb-1 line-clamp-1 num ${isCorrect ? 'text-[#0F7B4A]/70' : 'text-muted'}`}>{qIdx + 1}. {q.text}</div>
                                                                            <div className={`font-bold ${isCorrect ? 'text-[#0F7B4A]' : isWrong ? 'text-brandred-600' : 'text-[color:var(--text)]'}`}>
                                                                                {answerText}
                                                                            </div>
                                                                        </div>
                                                                        {isCorrect && <Check size={18} className="text-[#0F7B4A] shrink-0" />}
                                                                        {isWrong && <X size={18} className="text-brandred-600 shrink-0" />}
                                                                    </div>
                                                                );
                                                            })}
                                                            <div className="p-3 rounded-lg bg-navy-600/10 border border-navy-600/30 dark:border-gold-500/40 flex justify-between items-center">
                                                                <span className="text-navy-800 dark:text-gold-400 font-display font-bold uppercase tracking-[0.05em]">Tiebreaker</span>
                                                                <span className="text-[color:var(--text)] num font-display font-bold text-lg">{card.tiebreakerVal}</span>
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
                                <td colSpan={6} className="p-8 text-center text-muted">
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
