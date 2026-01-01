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
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {sortedCards.map((card, idx) => {
                            const isMe = currentUser && card.userId === currentUser.id;
                            return (
                                <tr key={card.id || card.userId} className={`${isMe ? 'bg-indigo-500/10' : 'hover:bg-slate-800/50'} transition-colors`}>
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
                                </tr>
                            );
                        })}
                        {sortedCards.length === 0 && (
                            <tr>
                                <td colSpan={5} className="p-8 text-center text-slate-500">
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

