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

        // Filter for "Today's" games or Active games
        // Since we import a huge range, we need to locate relevant ones.
        // Rule: 
        // 1. IN_PROGRESS (Always show)
        // 2. FINAL (Show if ended within last 24h? Or just show all FINAL for now if list isn't huge? 
        //    Actually, list will grow to 67 games. We should sort by date.)
        // 3. SCHEDULED (Show if within next 24h?)

        // Simple approach: Sort all by time. Show top 20 closest to now?
        // Or just show IN_PROGRESS and recent/upcoming.

        const now = new Date();
        const startOfDay = new Date(now.setHours(0, 0, 0, 0)).toISOString();
        const endOfDay = new Date(now.setHours(23, 59, 59, 999)).toISOString();

        return games.filter(g => {
            const isLive = g.status === 'IN_PROGRESS';
            // Show games happening today
            const isToday = g.startTime >= startOfDay && g.startTime <= endOfDay;
            return isLive || isToday;
        }).sort((a, b) => {
            // Live first, then by time
            if (a.status === 'IN_PROGRESS' && b.status !== 'IN_PROGRESS') return -1;
            if (b.status === 'IN_PROGRESS' && a.status !== 'IN_PROGRESS') return 1;
            return a.startTime.localeCompare(b.startTime);
        }).map(g => {
            // Hydrate teams
            return {
                ...g,
                homeTeam: teams[g.homeTeamId],
                awayTeam: teams[g.awayTeamId]
            };
        });
    }, [tournament]);

    if (!tournament || activeGames.length === 0) return null;

    return (
        <div className="bg-slate-950 border-y border-slate-800 py-3 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-6 px-4 w-max animate-ticker-slow">
                <div className="flex items-center gap-2 text-emerald-500 font-bold text-xs uppercase animate-pulse border border-emerald-500/30 px-2 py-0.5 rounded-full bg-emerald-500/10 whitespace-nowrap sticky left-0 z-10 hidden md:flex">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                    NCAA Live
                </div>

                {activeGames.map(game => (
                    <div key={game.id} className={`flex items-center gap-4 bg-slate-900/50 border ${game.status === 'IN_PROGRESS' ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-800'} px-4 py-2 rounded-lg min-w-[280px] hover:border-slate-600 transition-colors group relative overflow-hidden`}>
                        {/* Live Indicator Background */}
                        {game.status === 'IN_PROGRESS' && (
                            <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
                        )}

                        <div className="flex-1 space-y-1">
                            {/* Teams */}
                            <div className="flex justify-between items-center text-sm">
                                <span className={`font-bold flex items-center gap-2 ${game.winnerTeamId === game.awayTeamId ? 'text-emerald-400' : 'text-slate-200'}`}>
                                    {game.awayTeam?.logoUrl ? (
                                        <img src={game.awayTeam.logoUrl} alt="" className="w-5 h-5 object-contain" />
                                    ) : null}
                                    {game.awayTeam?.name || 'TBD'}
                                </span>
                                <span className="font-mono font-bold">{game.awayScore}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className={`font-bold flex items-center gap-2 ${game.winnerTeamId === game.homeTeamId ? 'text-emerald-400' : 'text-slate-200'}`}>
                                    {game.homeTeam?.logoUrl ? (
                                        <img src={game.homeTeam.logoUrl} alt="" className="w-5 h-5 object-contain" />
                                    ) : null}
                                    {game.homeTeam?.name || 'TBD'}
                                </span>
                                <span className="font-mono font-bold">{game.homeScore}</span>
                            </div>
                        </div>

                        {/* Status/Info */}
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
                ))}
            </div>
        </div>
    );
};
