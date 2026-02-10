import React from 'react';
import type { Tournament } from '../../types';

interface LiveScoreTickerProps {
    tournament: Tournament | null;
}

export const LiveScoreTicker: React.FC<LiveScoreTickerProps> = ({ tournament }) => {
    if (!tournament) return null;

    const liveGames = Object.values(tournament.games).filter(g => g.status === 'IN_PROGRESS');

    if (liveGames.length === 0) return null;

    return (
        <div className="bg-slate-950 border-b border-slate-800 py-2 overflow-x-auto">
            <div className="container mx-auto px-4 flex items-center gap-4 min-w-max">
                <div className="flex items-center gap-2 text-red-500 font-bold text-xs uppercase animate-pulse">
                    <span className="w-2 h-2 bg-red-500 rounded-full" />
                    Live Now
                </div>

                <div className="h-4 w-px bg-slate-800" />

                {liveGames.map(game => (
                    <div key={game.id} className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-xs hover:border-slate-700 transition-colors cursor-default">
                        <div className="flex items-center gap-2 font-bold text-white">
                            <span>{game.homeTeamId}</span>
                            <span className="text-slate-500 font-normal">vs</span>
                            <span>{game.awayTeamId}</span>
                        </div>
                        <div className="bg-slate-950 px-2 py-0.5 rounded text-emerald-400 font-mono font-bold">
                            {game.homeScore} - {game.awayScore}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
