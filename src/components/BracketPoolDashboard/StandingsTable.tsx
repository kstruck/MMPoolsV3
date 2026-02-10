
import React from 'react';
import type { BracketEntry, BracketPool, Tournament } from '../../types';
import { Trophy, Medal, AlertCircle } from 'lucide-react';
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
            return { ...entry, max };
        }).sort((a, b) => {
            // Sort by current score desc
            if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
            // Tiebreaker: Max possible desc
            return b.max - a.max;
        });
    }, [entries, tournament, pool.settings, eliminatedTeams]);


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

                    return (
                        <div key={entry.id} className={`grid grid-cols-12 gap-4 p-4 items-center hover:bg-white/5 transition-colors ${currentUserId && entry.ownerUid === currentUserId ? 'bg-indigo-900/20 border-l-2 border-indigo-500' : ''}`}>
                            <div className="col-span-2 md:col-span-1 flex justify-center">
                                {isChampion ? <Trophy size={20} className="text-amber-400" /> :
                                    isTop3 ? <Medal size={20} className={rank === 2 ? 'text-slate-300' : 'text-amber-700'} /> :
                                        <span className="font-mono text-slate-500">#{rank}</span>}
                            </div>
                            <div className="col-span-6 md:col-span-7">
                                <div className="font-bold text-white truncate">{entry.name}</div>
                                <div className="text-xs text-slate-500 truncate hidden sm:block">ID: {entry.id.substring(0, 8)}</div>
                            </div>
                            <div className="col-span-2 text-right font-mono font-bold text-lg text-emerald-400">
                                {entry.score || 0}
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
