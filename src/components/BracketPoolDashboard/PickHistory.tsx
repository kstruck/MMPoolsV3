import React, { useMemo, useState } from 'react';
import type { BracketEntry, Tournament, BracketPool } from '../../types';
import { calculateScore } from './bracketScoring';
import { TrendingUp, Check, X, ChevronDown } from 'lucide-react';

interface PickHistoryProps {
    entry: BracketEntry;          // default / first entry (kept for backward compat)
    entries?: BracketEntry[];     // all of the user's entries (optional, enables selector)
    tournament: Tournament;
    pool: BracketPool;
}

export const PickHistory: React.FC<PickHistoryProps> = ({ entry, entries, tournament, pool }) => {
    const allEntries = entries && entries.length > 0 ? entries : [entry];
    const [selectedId, setSelectedId] = useState<string>(allEntries[0]?.id ?? '');

    const selectedEntry = allEntries.find(e => e.id === selectedId) ?? allEntries[0];

    const result = useMemo(
        () => calculateScore(selectedEntry, tournament, pool.settings),
        [selectedEntry, tournament, pool.settings]
    );

    // Build cumulative score progression for sparkline
    const cumulativeScores = useMemo(() => {
        return result.roundBreakdown.reduce<number[]>((acc, rd) => {
            const prev = acc.length > 0 ? acc[acc.length - 1] : 0;
            acc.push(prev + rd.points);
            return acc;
        }, []);
    }, [result]);

    const maxCumulative = Math.max(...cumulativeScores, 1);

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <TrendingUp size={20} className="text-emerald-400 flex-shrink-0" />
                <h3 className="text-xl font-bold text-white">Pick History</h3>

                {/* Bracket selector — only shown when the user has multiple entries */}
                {allEntries.length > 1 ? (
                    <div className="ml-auto relative">
                        <select
                            value={selectedId}
                            onChange={e => setSelectedId(e.target.value)}
                            className="appearance-none bg-slate-800 border border-slate-700 rounded-lg
                                       pl-3 pr-8 py-1.5 text-sm text-white font-medium
                                       focus:outline-none focus:border-indigo-500 cursor-pointer"
                        >
                            {allEntries.map(e => (
                                <option key={e.id} value={e.id}>{e.name}</option>
                            ))}
                        </select>
                        <ChevronDown
                            size={14}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                        />
                    </div>
                ) : (
                    <span className="text-xs text-slate-500 ml-auto">Entry: {selectedEntry.name}</span>
                )}
            </div>
            <p className="text-slate-400 text-sm mb-4">Round-by-round performance for your bracket.</p>

            {/* Round Breakdown Cards */}
            <div className="space-y-3 mb-6">
                {result.roundBreakdown.map((rd) => {
                    const hasPicks = rd.correct > 0 || rd.possible > 0;
                    const accuracy = rd.possible > 0 ? Math.round((rd.correct / rd.possible) * 100) : 0;
                    return (
                        <div key={rd.round} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold bg-slate-800 text-slate-300 px-2 py-1 rounded">{rd.label}</span>
                                    {hasPicks && (
                                        <span className="text-xs text-slate-500">
                                            {rd.correct}/{rd.possible} correct
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    {hasPicks && (
                                        <span className={`text-xs font-bold ${accuracy >= 70 ? 'text-emerald-400' : accuracy >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                                            {accuracy}%
                                        </span>
                                    )}
                                    <span className="text-sm font-mono text-emerald-400">+{rd.points}</span>
                                </div>
                            </div>
                            {hasPicks && (
                                <div className="w-full bg-slate-800 rounded-full h-1.5">
                                    <div
                                        className={`h-full rounded-full transition-all ${accuracy >= 70 ? 'bg-emerald-500' : accuracy >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                                        style={{ width: `${accuracy}%` }}
                                    />
                                </div>
                            )}
                            {!hasPicks && (
                                <p className="text-slate-600 text-xs italic">No games decided yet</p>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Score Sparkline */}
            <div className="border-t border-slate-800 pt-4">
                <h4 className="text-sm font-bold text-white mb-3">Score Progression</h4>
                <div className="flex items-end gap-1 h-20">
                    {cumulativeScores.map((score, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div
                                className="w-full bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-t"
                                style={{ height: `${(score / maxCumulative) * 100}%`, minHeight: score > 0 ? 4 : 0 }}
                            />
                            <span className="text-[10px] text-slate-500">{result.roundBreakdown[i].label}</span>
                        </div>
                    ))}
                </div>
                <div className="flex justify-between mt-2">
                    <span className="text-xs text-slate-500">Cumulative Score</span>
                    <span className="text-sm font-mono font-bold text-emerald-400">{result.score} pts</span>
                </div>
            </div>

            {/* Max Possible */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800">
                <span className="text-xs text-slate-500 flex items-center gap-1"><Check size={12} className="text-emerald-400" /> Correct Picks</span>
                <span className="text-sm font-mono text-white">{result.correctPicks}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-slate-500 flex items-center gap-1"><X size={12} className="text-red-400" /> Max Possible</span>
                <span className="text-sm font-mono text-slate-300">{result.maxPossibleScore} pts</span>
            </div>
        </div>
    );
};
