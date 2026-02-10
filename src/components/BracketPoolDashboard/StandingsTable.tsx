
import React, { useRef, useEffect, useState } from 'react';
import type { BracketEntry, BracketPool, Tournament } from '../../types';
import { Trophy, Medal, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { calculateEntryMaxScore, getEliminatedTeams } from '../../utils/bracketScoring';

interface StandingsTableProps {
    entries: BracketEntry[];
    pool: BracketPool;
    tournament: Tournament;
    currentUserId?: string; // For highlighting user's own entries
}

export const StandingsTable: React.FC<StandingsTableProps> = ({ entries, pool, tournament, currentUserId }) => {
    // Pre-calculate eliminated teams once
    const eliminatedTeams = React.useMemo(() => getEliminatedTeams(tournament), [tournament]);

    // Calculate derived stats for sorting
    const entriesWithStats = React.useMemo(() => {
        return entries.map(entry => {
            const max = calculateEntryMaxScore(entry, tournament, pool.settings, eliminatedTeams);
            // Default 0 for score/max if undefined
            return { ...entry, score: entry.score || 0, max: max || 0 };
        }).sort((a, b) => {
            // Sort by current score desc
            if (b.score !== a.score) return b.score - a.score;
            // Tiebreaker: Max possible desc
            return b.max - a.max;
        });
    }, [entries, tournament, pool.settings, eliminatedTeams]);

    // Track previous ranks to show changes
    const prevRanksRef = useRef<Record<string, number>>({});
    const [rankChanges, setRankChanges] = useState<Record<string, number>>({});

    useEffect(() => {
        const newRanks: Record<string, number> = {};
        entriesWithStats.forEach((entry, idx) => {
            newRanks[entry.id] = idx + 1;
        });

        const changes: Record<string, number> = {};
        let hasChanges = false;

        entriesWithStats.forEach((entry, idx) => {
            const currentRank = idx + 1;
            const prevRank = prevRanksRef.current[entry.id];
            if (prevRank && prevRank !== currentRank) {
                changes[entry.id] = prevRank - currentRank; // Positive = moved up (e.g. 5 -> 3 = +2)
                hasChanges = true;
            }
        });

        if (hasChanges) {
            // Use setTimeout to avoid synchronous state update warning
            setTimeout(() => {
                setRankChanges(changes);
                // Clear indicators after 10 seconds
                setTimeout(() => setRankChanges({}), 10000);
            }, 0);
        }

        // Update ref for next render *after* calculating changes
        prevRanksRef.current = newRanks;
    }, [entriesWithStats]); // Only run when sorted list changes


    if (entries.length === 0) {
        return (
            <div className="p-8 text-center text-slate-500 italic flex flex-col items-center gap-2">
                <AlertCircle size={32} />
                No entries submitted yet.
            </div>
        );
    }

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 p-4 bg-slate-950 border-b border-slate-800 font-bold text-slate-400 text-sm uppercase tracking-wider">
                <div className="col-span-2 md:col-span-1 text-center">Rank</div>
                <div className="col-span-6 md:col-span-7">Entry Name</div>
                <div className="col-span-2 text-right">Points</div>
                <div className="col-span-2 text-right hidden md:block">Max Possible</div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-slate-800">
                {entriesWithStats.map((entry, idx) => {
                    const rank = idx + 1;
                    const isChampion = rank === 1;
                    const isTop3 = rank <= 3;
                    const change = rankChanges[entry.id];

                    return (
                        <div key={entry.id} className={`grid grid-cols-12 gap-4 p-4 items-center hover:bg-white/5 transition-colors ${currentUserId && entry.ownerUid === currentUserId ? 'bg-indigo-900/20 border-l-2 border-indigo-500' : ''}`}>
                            <div className="col-span-2 md:col-span-1 flex flex-col items-center justify-center">
                                <div className="flex items-center gap-1">
                                    {isChampion ? <Trophy size={20} className="text-amber-400" /> :
                                        isTop3 ? <Medal size={20} className={rank === 2 ? 'text-slate-300' : 'text-amber-700'} /> :
                                            <span className="font-mono text-slate-500 font-bold">#{rank}</span>}
                                </div>
                                {change !== undefined && change !== 0 && (
                                    <div className={`text-[10px] font-bold flex items-center ${change > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {change > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                                        {Math.abs(change)}
                                    </div>
                                )}
                            </div>
                            <div className="col-span-6 md:col-span-7">
                                <div className="font-bold text-white truncate flex items-center gap-2">
                                    {entry.name}
                                    {change !== undefined && change !== 0 && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${change > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                                            {change > 0 ? 'Rank Up' : 'Rank Down'}
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-slate-500 truncate hidden sm:block">ID: {entry.id.substring(0, 8)}</div>
                            </div>
                            <div className="col-span-2 text-right font-mono font-bold text-lg text-emerald-400">
                                {entry.score}
                            </div>
                            <div className="col-span-2 text-right font-mono text-slate-500 hidden md:block">
                                {entry.max}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
