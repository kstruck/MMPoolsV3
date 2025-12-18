
import React from 'react';
import type { BracketEntry } from '../../types';
import { Trophy, Medal, AlertCircle } from 'lucide-react';


interface StandingsTableProps {
    entries: BracketEntry[];
    maxScore: number; // Potential max score
}

export const StandingsTable: React.FC<StandingsTableProps> = ({ entries, maxScore }) => {
    const sorted = [...entries].sort((a, b) => (b.score || 0) - (a.score || 0));

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
                {sorted.map((entry, idx) => {
                    const rank = idx + 1;
                    const isChampion = rank === 1;
                    const isTop3 = rank <= 3;

                    return (
                        <div key={entry.id} className={`grid grid-cols-12 gap-4 p-4 items-center hover:bg-white/5 transition-colors ${entry.ownerUid === 'me' ? 'bg-indigo-900/20 border-l-2 border-indigo-500' : ''}`}>
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
                                {maxScore} {/* TODO: Calculate actual max possible for this entry */}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
