import React, { useState } from 'react';
import type { BracketEntry, Tournament, BracketPool } from '../../types';
import { calculateRootForResults, type RootForResult } from './bracketScoring';
import { Heart, ArrowUp, ArrowDown, Minus, Loader2 } from 'lucide-react';
import { Badge } from '../ui';

interface WhoToRootForProps {
    userEntries: BracketEntry[];
    allEntries: BracketEntry[];
    tournament: Tournament;
    pool: BracketPool;
}

export const WhoToRootFor: React.FC<WhoToRootForProps> = ({ userEntries, allEntries, tournament, pool }) => {
    const [computing, setComputing] = useState(true);
    const [selectedEntryId, setSelectedEntryId] = useState<string>(userEntries[0]?.id || '');
    const [results, setResults] = useState<RootForResult[]>([]);

    const selectedEntry = userEntries.find(e => e.id === selectedEntryId) || userEntries[0];

    React.useEffect(() => {
        if (!selectedEntry) return;
        setComputing(true);
        // Small timeout to allow UI to show loading state if calculation is heavy
        const timer = setTimeout(() => {
            const r = calculateRootForResults(selectedEntry, allEntries, tournament, pool.settings);
            setResults(r);
            setComputing(false);
        }, 10);
        return () => clearTimeout(timer);
    }, [selectedEntry, allEntries, tournament, pool.settings]);

    const formatRankChange = (change: number) => {
        if (change > 0) return <span className="text-[#0F7B4A] num flex items-center gap-0.5"><ArrowUp size={12} /> {change}</span>;
        if (change < 0) return <span className="text-brandred-600 num flex items-center gap-0.5"><ArrowDown size={12} /> {Math.abs(change)}</span>;
        return <span className="text-faint num flex items-center gap-0.5"><Minus size={12} /> 0</span>;
    };

    if (computing) {
        return (
            <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                <div className="flex items-center gap-2">
                    <Loader2 size={20} className="text-gold-500 animate-spin" />
                    <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">Computing scenarios...</h3>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-card border border-line rounded-xl p-6 shadow-card">
            <div className="flex items-center gap-2 mb-4">
                <Heart size={20} className="text-gold-500" />
                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">Who to Root For</h3>
                {userEntries.length > 1 ? (
                    <select
                        value={selectedEntryId}
                        onChange={(e) => setSelectedEntryId(e.target.value)}
                        className="ml-auto bg-surface border border-line rounded-md text-sm font-body text-[color:var(--text)] px-3 py-1 focus:ring-1 focus:ring-gold-500"
                    >
                        {userEntries.map(e => (
                            <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                    </select>
                ) : (
                    <span className="text-xs text-faint ml-auto">Based on: {selectedEntry?.name}</span>
                )}
            </div>
            <p className="text-muted font-body text-sm mb-4">See how each upcoming game's outcome affects your standings.</p>

            {results.length === 0 ? (
                <p className="text-faint text-sm text-center py-8 italic">No upcoming games to analyze. The tournament may be complete or not yet started.</p>
            ) : (
                <div className="space-y-3">
                    {results.map(r => {
                        const homeBetter = r.homeWinImpact.rankChange > r.awayWinImpact.rankChange;
                        const awayBetter = r.awayWinImpact.rankChange > r.homeWinImpact.rankChange;
                        const neutral = r.homeWinImpact.rankChange === r.awayWinImpact.rankChange;

                        return (
                            <div key={r.game.id} className="bg-surface border border-line rounded-lg p-4">
                                {/* Game Header */}
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs text-faint font-display font-bold uppercase tracking-[0.08em] num">Round {r.game.round}</span>
                                    {r.game.status === 'IN_PROGRESS' && (
                                        <Badge status="live" className="text-[10px] px-2 py-0.5">LIVE</Badge>
                                    )}
                                </div>

                                {/* Two-column: home win vs away win */}
                                <div className="grid grid-cols-2 gap-3">
                                    {/* Home wins */}
                                    <div className={`p-3 rounded-lg border ${homeBetter && !neutral ? 'border-gold-500/50 bg-gold-500/10' : 'border-line'}`}>
                                        <div className="text-sm font-bold text-[color:var(--text)] mb-1">{r.game.homeTeamId} wins</div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-faint">Your Rank</span>
                                            <span className="text-xs num text-[color:var(--text)]">#{r.homeWinImpact.rank}</span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-xs text-faint">Change</span>
                                            <span className="text-xs font-bold">{formatRankChange(r.homeWinImpact.rankChange)}</span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-xs text-faint">Score</span>
                                            <span className="text-xs num text-[#0F7B4A]">{r.homeWinImpact.score}</span>
                                        </div>
                                    </div>

                                    {/* Away wins */}
                                    <div className={`p-3 rounded-lg border ${awayBetter && !neutral ? 'border-gold-500/50 bg-gold-500/10' : 'border-line'}`}>
                                        <div className="text-sm font-bold text-[color:var(--text)] mb-1">{r.game.awayTeamId} wins</div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-faint">Your Rank</span>
                                            <span className="text-xs num text-[color:var(--text)]">#{r.awayWinImpact.rank}</span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-xs text-faint">Change</span>
                                            <span className="text-xs font-bold">{formatRankChange(r.awayWinImpact.rankChange)}</span>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-xs text-faint">Score</span>
                                            <span className="text-xs num text-[#0F7B4A]">{r.awayWinImpact.score}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Recommendation */}
                                {!neutral && (
                                    <div className="mt-2 text-xs text-center">
                                        <span className="text-gold-600 font-display font-bold uppercase tracking-[0.05em]">Root for {homeBetter ? r.game.homeTeamId : r.game.awayTeamId}</span>
                                        <span className="text-faint"> — you move up {Math.abs(homeBetter ? r.homeWinImpact.rankChange : r.awayWinImpact.rankChange)} spot{Math.abs(homeBetter ? r.homeWinImpact.rankChange : r.awayWinImpact.rankChange) !== 1 ? 's' : ''}</span>
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
