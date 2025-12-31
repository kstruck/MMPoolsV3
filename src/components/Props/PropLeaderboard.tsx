import React, { useEffect, useState } from 'react';
import { dbService } from '../../services/dbService';
import type { GameState, PropCard } from '../../types';
import { Trophy, Medal } from 'lucide-react';

interface PropLeaderboardProps {
    gameState: GameState;
    currentUser: any;
}

export const PropLeaderboard: React.FC<PropLeaderboardProps> = ({ gameState, currentUser }) => {
    const [cards, setCards] = useState<PropCard[]>([]);

    useEffect(() => {
        const unsub = dbService.subscribeToAllPropCards(gameState.id, (data) => {
            const sorted = data.sort((a, b) => {
                // Sort by Score DESC
                if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
                // Tiebreaker: Closest to actual total (if we knew actual total... but we don't know actual total yet?)
                // Actually, tiebreakerVal is a prediction. We win if closest to Actual.
                // Since we don't have Actual, we can't sort by tiebreaker accuracy yet.
                // Just sort by score for now.
                return 0;
            });
            setCards(sorted);
        });
        return () => unsub();
    }, [gameState.id]);

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
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">{cards.length} Players</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-900/50 text-slate-400 uppercase font-bold text-xs">
                        <tr>
                            <th className="p-4 w-16 text-center">Rank</th>
                            <th className="p-4">Player</th>
                            <th className="p-4 text-center">Score</th>
                            <th className="p-4 text-center">TB</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {cards.map((card, idx) => {
                            const isMe = currentUser && card.userId === currentUser.uid;
                            return (
                                <tr key={card.userId} className={`${isMe ? 'bg-indigo-500/10' : 'hover:bg-slate-800/50'} transition-colors`}>
                                    <td className="p-4 text-center flex justify-center">
                                        {getRankIcon(idx)}
                                    </td>
                                    <td className="p-4">
                                        <div className="font-bold text-white flex items-center gap-2">
                                            {card.userName}
                                            {isMe && <span className="bg-indigo-500 text-white text-[10px] px-1.5 py-0.5 rounded uppercase">You</span>}
                                        </div>
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className="font-mono text-emerald-400 font-bold text-lg">{card.score || 0}</span>
                                        <span className="text-slate-600 text-xs ml-1">/ {gameState.props?.questions.length || 0}</span>
                                    </td>
                                    <td className="p-4 text-center font-mono text-slate-400">
                                        {card.tiebreakerVal}
                                    </td>
                                </tr>
                            );
                        })}
                        {cards.length === 0 && (
                            <tr>
                                <td colSpan={4} className="p-8 text-center text-slate-500">
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
