import React, { useMemo, useState } from 'react';
import type { BracketEntry, Tournament, BracketPool } from '../../types';
import { calculateRootForResults } from './bracketScoring';
import { Heart, ArrowUp, ArrowDown, Minus, Loader2 } from 'lucide-react';

interface WhoToRootForProps {
    userEntry: BracketEntry;
    allEntries: BracketEntry[];
    tournament: Tournament;
    pool: BracketPool;
}

export const WhoToRootFor: React.FC<WhoToRootForProps> = ({ userEntry, allEntries, tournament, pool }) => {
    const [computing, setComputing] = useState(true);

    const results = useMemo(() => {
        setComputing(true);
        const r = calculateRootForResults(userEntry, allEntries, tournament, pool.settings);
        setComputing(false);
        return r;
    }, [userEntry, allEntries, tournament, pool.settings]);

    const formatRankChange = (change: number) => {
        if (change > 0) return <span className="text-emerald-400 flex items-center gap-0.5"><ArrowUp size={12} /> {change}</span>;
        if (change < 0) return <span className="text-red-400 flex items-center gap-0.5"><ArrowDown size={12} /> {Math.abs(change)}</span>;
        return <span className="text-slate-500 flex items-center gap-0.5"><Minus size={12} /> 0</span>;
    };

    if (computing) {
        return (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="flex items-center gap-2">
                    <Loader2 size={20} className="text-pink-400 animate-spin" />
                    <h3 className="text-xl font-bold text-white">Computing scenarios...</h3>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
                <Heart size={20} className="text-pink-400" />
                <h3 className="text-xl font-bold text-white">Who to Root For</h3>
                <span className="text-xs text-slate-500 ml-auto">Based on: {userEntry.name}</span>
            </div>
            <p className="text-slate-400 text-sm mb-4">See how each upcoming game's outcome affects your standings.</p>

            {results.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-8 italic">No upcoming games to analyze. The tournament may be complete or not yet started.</p>
            ) : (
                <div className="space-y-3">
                    {results.map(r => {
                        const homeBetter = r.homeWinImpact.rankChange > r.awayWinImpact.rankChange;
                        const awayBetter = r.awayWinImpact.rankChange > r.homeWinImpact.rankChange;
                        const neutral = r.homeWinImpact.rankChange === r.awayWinImpact.rankChange;

                        return (
                            <div key={r.game.id} className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                                {/* Game Header */}
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs text-slate-600 font-bold">Round {r.game.round}</span>
                                    {r.game.status === 'IN_PROGRESS' && (
                                        <span className="text-[10px] bg-red-900/40 text-red-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                                            LIVE
                                        </span>
                                    )}
                                </div>

                                {/* Two-column: home win vs away win */}
                                <div className="grid grid-cols-2 gap-3">
                                    {/* Home wins */}
                                    <div className={`p-3 rounded-lg border ${homeBetter && !neutral ? 'border-emerald-800 bg-emerald-950/30' : 'border-slate-800'}`}>
                                        <div className="text-sm font-bold text-white mb-1">{r.game.homeTeamId} wins</div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-slate-500">Your Rank</span>
                                            <span className="text-xs font-mono text-white">#{r.homeWinImpact.rank}</span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-xs text-slate-500">Change</span>
                                            <span className="text-xs font-bold">{formatRankChange(r.homeWinImpact.rankChange)}</span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-xs text-slate-500">Score</span>
                                            <span className="text-xs font-mono text-emerald-400">{r.homeWinImpact.score}</span>
                                        </div>
                                    </div>

                                    {/* Away wins */}
                                    <div className={`p-3 rounded-lg border ${awayBetter && !neutral ? 'border-emerald-800 bg-emerald-950/30' : 'border-slate-800'}`}>
                                        <div className="text-sm font-bold text-white mb-1">{r.game.awayTeamId} wins</div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-slate-500">Your Rank</span>
                                            <span className="text-xs font-mono text-white">#{r.awayWinImpact.rank}</span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-xs text-slate-500">Change</span>
                                            <span className="text-xs font-bold">{formatRankChange(r.awayWinImpact.rankChange)}</span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-xs text-slate-500">Score</span>
                                            <span className="text-xs font-mono text-emerald-400">{r.awayWinImpact.score}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Recommendation */}
                                {!neutral && (
                                    <div className="mt-2 text-xs text-center">
                                        <span className="text-emerald-400 font-bold">Root for {homeBetter ? r.game.homeTeamId : r.game.awayTeamId}</span>
                                        <span className="text-slate-600"> — you move up {Math.abs(homeBetter ? r.homeWinImpact.rankChange : r.awayWinImpact.rankChange)} spot{Math.abs(homeBetter ? r.homeWinImpact.rankChange : r.awayWinImpact.rankChange) !== 1 ? 's' : ''}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
