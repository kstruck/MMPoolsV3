import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { Download, Trophy, BarChart3, FileText, Table } from 'lucide-react';
import type { BracketEntry, Tournament, BracketPool } from '../../types';
import { calculateScore } from './bracketScoring';

interface ReportsTabProps {
    entries: BracketEntry[];
    tournament: Tournament | null;
    pool: BracketPool;
}

type ReportView = 'breakdown' | 'popularity';

export const ReportsTab: React.FC<ReportsTabProps> = ({ entries, tournament, pool }) => {
    const [view, setView] = useState<ReportView>('breakdown');

    // --------------------------------------------------------------------------------
    // Data Preparation
    // --------------------------------------------------------------------------------

    const maxRound = useMemo(() => {
        if (!tournament) return 0;
        return Object.values(tournament.games).reduce((max, g) => Math.max(max, g.round), 0);
    }, [tournament]);

    const scoringData = useMemo(() => {
        if (!tournament) return [];
        return entries.map(entry => {
            const result = calculateScore(entry, tournament, pool.settings);
            return {
                entry,
                result,
                total: result.score,
                max: result.maxPossibleScore
            };
        }).sort((a, b) => b.total - a.total);
    }, [entries, tournament, pool.settings]);

    const popularityData = useMemo(() => {
        if (!tournament) return null;

        const champCounts: Record<string, number> = {};
        const f4Counts: Record<string, number> = {};

        // Identify slots
        const champSlots = Object.values(tournament.slots).filter(s => {
            const game = tournament.games[s.gameId];
            // Championship Game
            return game && game.round === maxRound;
        });

        const f4Slots = Object.values(tournament.slots).filter(s => {
            const game = tournament.games[s.gameId];
            // For NCAA (6 rounds): winners of Round 4 (Elite 8) advance to Final Four
            // For Conference (e.g. 5 rounds): winners of Round 3 (QF) advance to Semis
            return game && game.round === Math.max(1, maxRound - 2);
        });

        entries.forEach(entry => {
            // Champion Pick
            champSlots.forEach(slot => {
                const teamId = entry.picks[slot.id];
                if (teamId) {
                    champCounts[teamId] = (champCounts[teamId] || 0) + 1;
                }
            });

            // Final Four Picks
            f4Slots.forEach(slot => {
                const teamId = entry.picks[slot.id];
                if (teamId) {
                    f4Counts[teamId] = (f4Counts[teamId] || 0) + 1;
                }
            });
        });

        const toChartData = (counts: Record<string, number>) => {
            return Object.entries(counts)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value);
        };

        return {
            champion: toChartData(champCounts),
            finalFour: toChartData(f4Counts)
        };
    }, [entries, tournament, maxRound]);

    // --------------------------------------------------------------------------------
    // Actions
    // --------------------------------------------------------------------------------

    const handleDownloadCSV = () => {
        if (!tournament) return;

        // Header
        const rounds = Array.from({ length: maxRound }, (_, i) => {
            if (maxRound === 5) {
                if (i === 2) return 'Quarterfinals';
                if (i === 3) return 'Semi-finals';
                if (i === 4) return 'Final';
            } else if (maxRound === 6) {
                if (i === 2) return 'Sweet 16';
                if (i === 3) return 'Elite 8';
                if (i === 4) return 'Final Four';
                if (i === 5) return 'Championship';
            }
            return `Round ${i + 1}`;
        });
        const header = ['Entry Name', 'Owner', 'Total Score', 'Max Possible', ...rounds, 'Champion Pick'];

        // Rows
        const rows = scoringData.map(d => {
            const roundScores = d.result.roundBreakdown.map(r => r.points);

            // Find Champ Pick
            const champSlot = Object.values(tournament.slots).find(s => tournament.games[s.gameId]?.round === maxRound);
            const champPick = champSlot ? d.entry.picks[champSlot.id] : '-';

            return [
                d.entry.name,
                d.entry.ownerUid || 'Unknown',
                d.total,
                d.max,
                ...roundScores,
                champPick
            ].join(',');
        });

        const csvContent = "data:text/csv;charset=utf-8," + [header.join(','), ...rows].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `pool_report_${pool.id}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // --------------------------------------------------------------------------------
    // Render
    // --------------------------------------------------------------------------------

    if (!tournament) {
        return (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center py-12 text-slate-500">
                <BarChart3 size={48} className="mx-auto mb-4 opacity-20" />
                <p>Reports will be available once the tournament bracket is set.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header / Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800 self-start">
                    <button
                        onClick={() => setView('breakdown')}
                        className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors ${view === 'breakdown' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        <Table size={16} /> Scoring Breakdown
                    </button>
                    <button
                        onClick={() => setView('popularity')}
                        className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors ${view === 'popularity' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        <BarChart3 size={16} /> Pick Popularity
                    </button>
                </div>

                <button
                    onClick={handleDownloadCSV}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-bold border border-slate-700 transition-colors flex items-center gap-2"
                >
                    <Download size={16} /> Export CSV
                </button>
            </div>

            {/* Content Views */}
            {view === 'breakdown' && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-950 text-slate-400 font-bold uppercase text-xs border-b border-slate-800">
                                <tr>
                                    <th className="p-4">Entry</th>
                                    <th className="p-4 text-center">Total</th>
                                    <th className="p-4 text-center text-slate-600">Max</th>
                                    {Array.from({ length: maxRound }).map((_, idx) => {
                                        let label = `Round ${idx + 1}`;
                                        if (maxRound === 5) {
                                            if (idx === 2) label = 'Quarterfinals';
                                            if (idx === 3) label = 'Semi-finals';
                                            if (idx === 4) label = 'Final';
                                        } else if (maxRound === 6) {
                                            if (idx === 2) label = 'Sweet 16';
                                            if (idx === 3) label = 'Elite 8';
                                            if (idx === 4) label = 'Final Four';
                                            if (idx === 5) label = 'Championship';
                                        }
                                        return (
                                            <th key={idx} className={`p-4 text-center ${idx === 0 ? 'border-l border-slate-800' : ''}`}>
                                                {label}
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {scoringData.map((data, i) => (
                                    <tr key={data.entry.id} className="hover:bg-slate-800/50 transition-colors">
                                        <td className="p-4 font-bold text-white max-w-[200px] truncate">
                                            {data.entry.name}
                                            <div className="text-[10px] text-slate-500 font-normal">Rank #{i + 1}</div>
                                        </td>
                                        <td className="p-4 text-center font-mono font-bold text-emerald-400">{data.total}</td>
                                        <td className="p-4 text-center font-mono text-slate-500">{data.max}</td>
                                        {data.result.roundBreakdown.map((rd, idx) => (
                                            <td key={idx} className={`p-4 text-center font-mono ${idx === 0 ? 'border-l border-slate-800' : ''} ${rd.points > 0 ? 'text-slate-300' : 'text-slate-700'}`}>
                                                {rd.points}
                                                {rd.possible > 0 && <div className="text-[10px] text-slate-600 font-sans">{rd.correct}/{rd.possible}</div>}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {view === 'popularity' && popularityData && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Champion Picks Chart */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                            <Trophy size={18} className="text-amber-400" /> Champion Picks
                        </h3>
                        <div className="h-[500px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={popularityData.champion} layout="vertical" margin={{ left: 40, right: 40 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                                    <XAxis type="number" hide />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        width={100}
                                        tick={{ fill: '#94a3b8', fontSize: 14 }}
                                        interval={0}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff' }}
                                        cursor={{ fill: '#1e293b', opacity: 0.4 }}
                                    />
                                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                                        {popularityData.champion.map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={index === 0 ? '#10b981' : '#6366f1'} />
                                        ))}
                                        <LabelList dataKey="value" position="right" fill="#94a3b8" fontSize={12} fontWeight="bold" />
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Final Four Picks Chart */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                            <FileText size={18} className="text-indigo-400" /> Final Four Picks
                        </h3>
                        <p className="text-xs text-slate-500 mb-4">
                            {popularityData.finalFour.length} unique teams picked for the Final Four across all entries
                        </p>
                        {/* Scrollable wrapper — chart grows to fit all rows */}
                        <div className="overflow-y-auto max-h-[600px] pr-1">
                            <div style={{ height: Math.max(300, popularityData.finalFour.length * 26 + 40) }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={popularityData.finalFour} layout="vertical" margin={{ left: 0, right: 40, top: 4, bottom: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                                        <XAxis type="number" hide />
                                        <YAxis
                                            dataKey="name"
                                            type="category"
                                            width={140}
                                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                                            interval={0}
                                        />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff' }}
                                            cursor={{ fill: '#1e293b', opacity: 0.4 }}
                                        />
                                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                                            {popularityData.finalFour.map((_, index) => (
                                                <Cell key={`cell-${index}`} fill="#8b5cf6" />
                                            ))}
                                            <LabelList dataKey="value" position="right" fill="#94a3b8" fontSize={11} fontWeight="bold" />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
};
