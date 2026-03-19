import React, { useMemo } from 'react';
import type { Tournament } from '../../types';
import { Clock, Tv, PlayCircle, Trophy } from 'lucide-react';

interface LiveScoreTickerProps {
    tournament: Tournament | null;
}

export const LiveScoreTicker: React.FC<LiveScoreTickerProps> = ({ tournament }) => {
    const activeGames = useMemo(() => {
        if (!tournament?.importedGames) return [];

        const games = Object.values(tournament.importedGames);
        const teams = tournament.importedTeams || {};

        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(now);
        dayEnd.setHours(23, 59, 59, 999);

        const startOfDay = dayStart.toISOString();
        const endOfDay = dayEnd.toISOString();

        return games.filter(g => {
            const isLive = g.status === 'IN_PROGRESS';
            const isToday = g.startTime >= startOfDay && g.startTime <= endOfDay;
            return isLive || isToday;
        }).sort((a, b) => {
            if (a.status === 'IN_PROGRESS' && b.status !== 'IN_PROGRESS') return -1;
            if (b.status === 'IN_PROGRESS' && a.status !== 'IN_PROGRESS') return 1;
            return a.startTime.localeCompare(b.startTime);
        }).map(g => ({
            ...g,
            homeTeam: teams[g.homeTeamId],
            awayTeam: teams[g.awayTeamId]
        }));
    }, [tournament]);

    if (!tournament || activeGames.length === 0) return null;

    // Duration: 6s per card, min 20s total
    const duration = Math.max(activeGames.length * 6, 20);

    // Game card component (reused twice for seamless loop)
    const GameCard = ({ game, idx }: { game: typeof activeGames[0]; idx: string }) => (
        <div
            key={idx}
            className={`flex items-center gap-4 bg-slate-900/50 border ${
                game.status === 'IN_PROGRESS'
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-slate-800'
            } px-4 py-2 rounded-lg min-w-[280px] transition-colors relative overflow-hidden`}
        >
            {game.status === 'IN_PROGRESS' && (
                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
            )}

            <div className="flex-1 space-y-1">
                <div className="flex justify-between items-center text-sm">
                    <span className={`font-bold flex items-center gap-2 ${
                        game.winnerTeamId === game.awayTeamId ? 'text-emerald-400' : 'text-slate-200'
                    }`}>
                        <img src={game.awayTeam?.logoUrl || '/placeholder-team.png'} alt="" className="w-5 h-5 object-contain" />
                        {game.awayTeam?.name || 'TBD'}
                    </span>
                    <span className="font-mono font-bold">{game.awayScore}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span className={`font-bold flex items-center gap-2 ${
                        game.winnerTeamId === game.homeTeamId ? 'text-emerald-400' : 'text-slate-200'
                    }`}>
                        <img src={game.homeTeam?.logoUrl || '/placeholder-team.png'} alt="" className="w-5 h-5 object-contain" />
                        {game.homeTeam?.name || 'TBD'}
                    </span>
                    <span className="font-mono font-bold">{game.homeScore}</span>
                </div>
            </div>

            <div className="flex flex-col items-end gap-1 text-[10px] text-slate-400 border-l border-slate-800 pl-3 ml-1 min-w-[70px]">
                {game.status === 'IN_PROGRESS' ? (
                    <>
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                            <PlayCircle size={10} /> {game.period ? (game.period <= 2 ? `${game.period}H` : 'OT') : 'LIVE'}
                        </span>
                        <span className="font-mono text-slate-300">{game.clock}</span>
                    </>
                ) : game.status === 'FINAL' ? (
                    <span className="text-slate-500 font-bold flex items-center gap-1">
                        <Trophy size={10} /> FINAL
                    </span>
                ) : (
                    <span className="text-slate-400 flex items-center gap-1">
                        <Clock size={10} /> {new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                )}
                {game.broadcast && (
                    <span className="text-indigo-400 flex items-center gap-1 uppercase tracking-wider">
                        <Tv size={10} /> {game.broadcast}
                    </span>
                )}
            </div>
        </div>
    );

    return (
        <div className="bg-slate-950 border-y border-slate-800 py-3 flex items-center gap-3">
            {/* Badge pinned to left - outside scroll region so it's never clipped */}
            <div className="hidden md:flex items-center gap-2 text-emerald-500 font-bold text-xs uppercase animate-pulse border border-emerald-500/30 px-2 py-0.5 rounded-full bg-emerald-500/10 whitespace-nowrap pl-4 shrink-0">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                NCAA Live
            </div>

            {/* Auto-scrolling ticker */}
            <div className="overflow-hidden flex-1 relative">
                <style>{`
                    @keyframes ticker-scroll {
                        from { transform: translateX(0); }
                        to   { transform: translateX(-50%); }
                    }
                    .ticker-inner {
                        display: flex;
                        gap: 1rem;
                        width: max-content;
                        animation: ticker-scroll ${duration}s linear infinite;
                    }
                    .ticker-inner:hover {
                        animation-play-state: paused;
                    }
                `}</style>
                <div className="ticker-inner">
                    {activeGames.map((game, i) => <GameCard key={`a${i}`} game={game} idx={`a${i}`} />)}
                    {activeGames.map((game, i) => <GameCard key={`b${i}`} game={game} idx={`b${i}`} />)}
                </div>
            </div>
        </div>
    );
};
