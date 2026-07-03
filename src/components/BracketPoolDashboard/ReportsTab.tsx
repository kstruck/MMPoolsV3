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
            <div className="bg-card border border-line rounded-xl p-6 text-center py-12 text-faint shadow-card">
                <BarChart3 size={48} className="mx-auto mb-4 opacity-20" />
                <p>Reports will be available once the tournament bracket is set.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header / Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex bg-card p-1 rounded-lg border border-line self-start">
                    <button
                        onClick={() => setView('breakdown')}
                        className={`px-4 py-2 rounded-md text-sm font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 transition-colors ${view === 'breakdown' ? 'bg-navy-800 text-white shadow-lg' : 'text-muted hover:text-[color:var(--text)]'
                            }`}
                    >
                        <Table size={16} /> Scoring Breakdown
                    </button>
                    <button
                        onClick={() => setView('popularity')}
                        className={`px-4 py-2 rounded-md text-sm font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 transition-colors ${view === 'popularity' ? 'bg-navy-800 text-white shadow-lg' : 'text-muted hover:text-[color:var(--text)]'
                            }`}
                    >
                        <BarChart3 size={16} /> Pick Popularity
                    </button>
                </div>

                <button
                    onClick={handleDownloadCSV}
                    className="px-4 py-2 bg-navy-800 hover:bg-navy-700 text-white rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition-colors flex items-center gap-2"
                >
                    <Download size={16} /> Export CSV
                </button>
            </div>

            {/* Content Views */}
            {view === 'breakdown' && (
                <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left font-body">
                            <thead className="bg-surface text-muted font-display font-bold uppercase text-[12px] tracking-[0.08em] border-b border-line">
                                <tr>
                                    <th className="p-4">Entry</th>
                                    <th className="p-4 text-center">Total</th>
                                    <th className="p-4 text-center text-faint">Max</th>
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
                                            <th key={idx} className={`p-4 text-center ${idx === 0 ? 'border-l border-line' : ''}`}>
                                                {label}
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {scoringData.map((data, i) => (
                                    <tr key={data.entry.id} className="hover:bg-[color:var(--page)] transition-colors">
                                        <td className="p-4 font-bold text-[color:var(--text)] max-w-[200px] truncate">
                                            {data.entry.name}
                                            <div className="text-[10px] text-faint font-normal num">Rank #{i + 1}</div>
                                        </td>
                                        <td className="p-4 text-center num font-display font-bold text-[color:var(--text)]">{data.total}</td>
                                        <td className="p-4 text-center num text-faint">{data.max}</td>
                                        {data.result.roundBreakdown.map((rd, idx) => (
                                            <td key={idx} className={`p-4 text-center num ${idx === 0 ? 'border-l border-line' : ''} ${rd.points > 0 ? 'text-muted' : 'text-faint'}`}>
                                                {rd.points}
                                                {rd.possible > 0 && <div className="text-[10px] text-faint font-body num">{rd.correct}/{rd.possible}</div>}
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
                    <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                        <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] mb-6 flex items-center gap-2">
                            <Trophy size={18} className="text-gold-500" /> Champion Picks
                        </h3>
                        <div className="h-[500px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={popularityData.champion} layout="vertical" margin={{ left: 40, right: 40 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                                    <XAxis type="number" hide />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        width={100}
                                        tick={{ fill: 'var(--muted)', fontSize: 14 }}
                                        interval={0}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)', color: 'var(--text)' }}
                                        cursor={{ fill: 'var(--line)', opacity: 0.4 }}
                                    />
                                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                                        {popularityData.champion.map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={index === 0 ? '#C9A867' : '#24507F'} />
                                        ))}
                                        <LabelList dataKey="value" position="right" fill="var(--muted)" fontSize={12} fontWeight="bold" />
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Final Four Picks Chart */}
                    <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                        <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] mb-1 flex items-center gap-2">
                            <FileText size={18} className="text-gold-500" /> Final Four Picks
                        </h3>
                        <p className="text-xs text-faint mb-4 num">
                            {popularityData.finalFour.length} unique teams picked for the Final Four across all entries
                        </p>
                        {/* Scrollable wrapper — chart grows to fit all rows */}
                        <div className="overflow-y-auto max-h-[600px] pr-1">
                            <div style={{ height: Math.max(300, popularityData.finalFour.length * 26 + 40) }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={popularityData.finalFour} layout="vertical" margin={{ left: 0, right: 40, top: 4, bottom: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                                        <XAxis type="number" hide />
                                        <YAxis
                                            dataKey="name"
                                            type="category"
                                            width={140}
                                            tick={{ fill: 'var(--muted)', fontSize: 11 }}
                                            interval={0}
                                        />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--line)', color: 'var(--text)' }}
                                            cursor={{ fill: 'var(--line)', opacity: 0.4 }}
                                        />
                                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                                            {popularityData.finalFour.map((_, index) => (
                                                <Cell key={`cell-${index}`} fill="#B78F4A" />
                                            ))}
                                            <LabelList dataKey="value" position="right" fill="var(--muted)" fontSize={11} fontWeight="bold" />
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
