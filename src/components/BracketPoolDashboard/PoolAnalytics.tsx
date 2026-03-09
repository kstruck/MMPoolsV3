import React, { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
    PieChart, Pie
} from 'recharts';
import { Trophy, Activity, Users, Map } from 'lucide-react';
import type { BracketEntry, Tournament, BracketRegion } from '../../types';

interface PoolAnalyticsProps {
    entries: BracketEntry[];
    tournament: Tournament;
    isConference?: boolean;
}

export const PoolAnalytics: React.FC<PoolAnalyticsProps> = ({ entries, tournament, isConference }) => {

    const analyticsData = useMemo(() => {
        if (!tournament || entries.length === 0) return null;

        const champCounts: Record<string, number> = {};
        const regionWinnerCounts: Record<string, Record<string, number>> = {};
        const consensusPicks: Record<string, string> = {}; // gameId -> most popular teamId

        // Dynamically determine max round from tournament data
        const maxRound = Object.values(tournament.games).reduce((max, g) => Math.max(max, g.round), 0) || 6;

        // Only build region data for NCAA (non-conference) tournaments
        if (!isConference) {
            const REGIONS: BracketRegion[] = ['East', 'West', 'South', 'Midwest'];
            REGIONS.forEach(r => {
                regionWinnerCounts[r] = {};
            });
        }

        // 1. Calculate Champion and Region Winner distributions
        // Championship game is the max round game
        const champGame = Object.values(tournament.games).find(g => g.round === maxRound);
        // For NCAA: region winners are semi-final round (maxRound - 2 = Elite 8)
        const regionGames = isConference ? [] : Object.values(tournament.games).filter(g => g.round === maxRound - 2);

        entries.forEach(entry => {
            // Champion prep
            if (champGame) {
                const pick = entry.picks[champGame.id];
                if (pick) champCounts[pick] = (champCounts[pick] || 0) + 1;
            }

            // Region prep (NCAA only)
            regionGames.forEach(g => {
                const pick = entry.picks[g.id];
                if (pick && g.region && regionWinnerCounts[g.region]) {
                    regionWinnerCounts[g.region][pick] = (regionWinnerCounts[g.region][pick] || 0) + 1;
                }
            });
        });

        // 2. Calculate consensus picks for every game
        Object.keys(tournament.games).forEach(gameId => {
            const counts: Record<string, number> = {};
            entries.forEach(e => {
                const pick = e.picks[gameId];
                if (pick) counts[pick] = (counts[pick] || 0) + 1;
            });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            if (sorted.length > 0) {
                consensusPicks[gameId] = sorted[0][0];
            }
        });

        // 3. Calculate Contrarian Score per user
        const contrarianData = entries.map(entry => {
            let matchesConsensus = 0;
            let totalPicks = 0;

            Object.keys(entry.picks).forEach(gameId => {
                const pick = entry.picks[gameId];
                if (pick && pick !== 'TBD') {
                    totalPicks++;
                    if (pick === consensusPicks[gameId]) {
                        matchesConsensus++;
                    }
                }
            });

            const contrarianScore = totalPicks > 0 ? 100 - ((matchesConsensus / totalPicks) * 100) : 0;

            return {
                name: entry.name,
                owner: entry.ownerUid,
                contrarianScore: Math.round(contrarianScore)
            };
        }).sort((a, b) => b.contrarianScore - a.contrarianScore).slice(0, 5); // Top 5 contrarians

        // Format data for charts
        const championChart = Object.entries(champCounts)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);

        // Region Pie Charts
        const regionCharts = Object.keys(regionWinnerCounts).map(regionId => {
            const regionName = regionId;
            const data = Object.entries(regionWinnerCounts[regionId])
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value);
            return { regionId, regionName, data };
        }).filter(rc => rc.data.length > 0);

        // 4. Round-by-Round Accuracy (if games have started) — dynamic rounds
        const allRounds = [...new Set(Object.values(tournament.games).map(g => g.round))].sort((a, b) => a - b);
        const roundAccuracy = allRounds.map(round => {
            const gamesInRound = Object.values(tournament.games).filter(g => g.round === round && g.winnerTeamId);
            if (gamesInRound.length === 0) return null;

            let totalCorrect = 0;
            const totalPossible = gamesInRound.length * entries.length;

            entries.forEach(entry => {
                gamesInRound.forEach(g => {
                    if (entry.picks[g.id] === g.winnerTeamId) totalCorrect++;
                });
            });

            return {
                round: `Round ${round}`,
                accuracy: Math.round((totalCorrect / totalPossible) * 100)
            };
        }).filter(Boolean) as { round: string, accuracy: number }[];

        return {
            championChart,
            regionCharts,
            contrarianData,
            roundAccuracy
        };
    }, [tournament, entries, isConference]);

    if (!analyticsData) return null;

    const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#f43f5e', '#6366f1'];

    return (
        <div className="space-y-8">

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Champion Picks Bar Chart */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <Trophy size={18} className="text-amber-400" /> Champion Pick Distribution
                    </h3>
                    {analyticsData.championChart.length > 0 ? (
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={analyticsData.championChart}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                    <YAxis tick={{ fill: '#94a3b8' }} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff' }}
                                        cursor={{ fill: '#1e293b', opacity: 0.4 }}
                                    />
                                    <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]}>
                                        {analyticsData.championChart.map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={index === 0 ? '#10b981' : '#6366f1'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="text-slate-500 text-center py-10 h-[300px] flex items-center justify-center">No champion picks yet</div>
                    )}
                </div>

                {/* Round Accuracy or Placeholder */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl relative overflow-hidden">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2 relative z-10">
                        <Activity size={18} className="text-emerald-400" /> Pool-wide Accuracy per Round
                    </h3>
                    {analyticsData.roundAccuracy.length > 0 ? (
                        <div className="h-[300px] w-full relative z-10">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={analyticsData.roundAccuracy}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                    <XAxis dataKey="round" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                    <YAxis tick={{ fill: '#94a3b8' }} domain={[0, 100]} />
                                    <Tooltip
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        formatter={(val: any) => [`${val}%`, 'Accuracy']}
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff' }}
                                        cursor={{ fill: '#1e293b', opacity: 0.4 }}
                                    />
                                    <Bar dataKey="accuracy" fill="#10b981" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="text-slate-500 text-center py-10 h-[300px] flex items-center justify-center flex-col gap-2 relative z-10">
                            <Activity className="w-8 h-8 opacity-20" />
                            <p>Tournament hasn't started yet.<br />Accuracy charts will appear here.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Region Winner Pies */}
            {analyticsData.regionCharts.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                        <Map size={18} className="text-indigo-400" /> Region Winners (Final Four Picks)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {analyticsData.regionCharts.map((rc) => (
                            <div key={rc.regionId} className="flex flex-col items-center">
                                <h4 className="text-slate-400 font-bold text-sm mb-2">{rc.regionName}</h4>
                                <div className="h-[200px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={rc.data}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={40}
                                                outerRadius={70}
                                                paddingAngle={2}
                                                dataKey="value"
                                            >
                                                {rc.data.map((_, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff' }}
                                                itemStyle={{ color: '#fff' }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Contrarian List */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                    <Users size={18} className="text-rose-400" /> Most Contrarian Brackets
                </h3>
                <p className="text-slate-400 text-sm mb-6">These entries deviate the most from the pool's consensus picks.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {analyticsData.contrarianData.map((c, i) => (
                        <div key={i} className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between">
                            <span className="font-bold text-white truncate mr-4">{c.name}</span>
                            <div className="flex flex-col items-end">
                                <span className="text-rose-400 font-mono text-xl">{c.contrarianScore}%</span>
                                <span className="text-[10px] text-slate-500 uppercase tracking-widest">Contrarian</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

        </div>
    );
};
