
import React, { useRef, useEffect, useState } from 'react';
import type { BracketEntry, BracketPool, Tournament } from '../../types';
import { Medal, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { RankChip, YouPill, Badge } from '../ui';
import { calculateEntryMaxScore, getEliminatedTeams } from '../../utils/bracketScoring';
import { dbService, type ScoreSyncStatus } from '../../services/dbService';

// Consider the sync stale if the heartbeat is older than 3 minutes (server writes every minute)
const SYNC_STALE_MS = 3 * 60 * 1000;

const formatRelativeTime = (ms: number): string => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return 'less than a minute';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
};

interface StandingsTableProps {
    entries: BracketEntry[];
    pool: BracketPool;
    tournament: Tournament;
    currentUserId?: string; // For highlighting user's own entries
    userNames?: Record<string, string>; // uid -> display name map
    onEntryClick?: (entry: BracketEntry) => void;
}

export const StandingsTable: React.FC<StandingsTableProps> = ({ entries, pool, tournament, currentUserId, userNames, onEntryClick }) => {
    // Pre-calculate eliminated teams once
    const eliminatedTeams = React.useMemo(() => getEliminatedTeams(tournament), [tournament]);

    // Pre-calculate actual total score for tiebreakers
    const actualTotal = React.useMemo(() => {
        const games = Object.values(tournament.games);
        const maxRound = games.reduce((max, g) => Math.max(max, g.round), 0);
        const championshipGame = games.find(g => g.round === maxRound);
        if (championshipGame?.status === 'FINAL') {
            return (championshipGame.homeScore || 0) + (championshipGame.awayScore || 0);
        }
        return null;
    }, [tournament]);

    // Calculate derived stats for sorting
    const entriesWithStats = React.useMemo(() => {
        return entries.map(entry => {
            const max = calculateEntryMaxScore(entry, tournament, pool.settings, eliminatedTeams);
            // Default 0 for score/max if undefined
            return { ...entry, score: entry.score || 0, max: max || 0 };
        }).sort((a, b) => {
            // Sort by current score desc
            if (b.score !== a.score) return b.score - a.score;

            // Secondary sort: Max possible desc
            if (b.max !== a.max) return b.max - a.max;

            // Apply Tiebreaker if Championship is finalized
            if (actualTotal !== null && a.tieBreakerPrediction !== undefined && b.tieBreakerPrediction !== undefined) {
                const diffA = a.tieBreakerPrediction - actualTotal;
                const diffB = b.tieBreakerPrediction - actualTotal;

                if (pool.settings.tieBreakers?.closestUnder) {
                    const aUnder = diffA <= 0;
                    const bUnder = diffB <= 0;
                    if (aUnder && !bUnder) return -1;
                    if (!aUnder && bUnder) return 1;
                    if (aUnder && bUnder) {
                        return Math.abs(diffA) - Math.abs(diffB);
                    }
                }

                // Fallback / Default: Closest Absolute
                return Math.abs(diffA) - Math.abs(diffB);
            }

            return 0;
        });
    }, [entries, tournament, pool.settings, eliminatedTeams, actualTotal]);

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

    // Score sync freshness: subscribe to the heartbeat doc written by the server sync
    const [syncStatus, setSyncStatus] = useState<ScoreSyncStatus | null>(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const unsub = dbService.subscribeToScoreSyncStatus(setSyncStatus);
        return () => unsub();
    }, []);

    // Tick every 30s so the relative timestamp / staleness check stays current
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);

    const syncDelayed = syncStatus !== null &&
        (syncStatus.status === 'error' || now - syncStatus.lastSyncAt > SYNC_STALE_MS);

    if (entries.length === 0) {
        return (
            <div className="p-8 text-center text-faint italic flex flex-col items-center gap-2">
                <AlertCircle size={32} />
                No entries submitted yet.
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Legend */}
            {currentUserId && (
                <div className="flex justify-end px-2">
                    <div className="flex items-center gap-2 text-xs text-muted font-medium">
                        <div className="w-4 h-4 rounded bg-brandred-600/10 border-l-2 border-brandred-600 flex items-center justify-center"></div>
                        <span>Your Entries</span>
                    </div>
                </div>
            )}

            <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card">
                {/* Horizontal scroll on narrow phones (375px) instead of truncating */}
                <div className="overflow-x-auto">
                    <div className="min-w-[420px]">
                {/* Header */}
                <div className="grid grid-cols-12 gap-4 p-4 bg-surface border-b border-line font-display font-bold text-muted text-[12px] uppercase tracking-[0.08em]">
                    <div className="col-span-2 md:col-span-1 text-center">Rank</div>
                    <div className="col-span-6 md:col-span-7">Entry Name</div>
                    <div className="col-span-2 text-right">Points</div>
                    <div className="col-span-2 text-right hidden md:block">Max Possible</div>
                </div>

                {/* Rows */}
                <div className="divide-y divide-line font-body">
                    {entriesWithStats.map((entry, idx) => {
                        const rank = idx + 1;
                        const isChampion = rank === 1;
                        const isTop3 = rank <= 3;
                        const change = rankChanges[entry.id];

                        return (
                            <div
                                key={entry.id}
                                onClick={() => onEntryClick?.(entry)}
                                className={`grid grid-cols-12 gap-4 p-4 items-center transition-colors ${onEntryClick ? 'cursor-pointer hover:bg-[color:var(--page)]' : ''} ${currentUserId && entry.ownerUid === currentUserId ? 'bg-brandred-600/[0.07] border-l-2 border-brandred-600' : ''}`}
                            >
                                <div className="col-span-2 md:col-span-1 flex flex-col items-center justify-center">
                                    <div className="flex items-center gap-1">
                                        {isChampion ? <RankChip rank={1} /> :
                                            isTop3 ? <Medal size={20} className={rank === 2 ? 'text-muted' : 'text-gold-700'} /> :
                                                <span className="num text-faint font-bold">#{rank}</span>}
                                    </div>
                                    {change !== undefined && change !== 0 && (
                                        <div className={`text-[10px] font-bold num flex items-center ${change > 0 ? 'text-[#0F7B4A]' : 'text-brandred-600'}`}>
                                            {change > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                                            {Math.abs(change)}
                                        </div>
                                    )}
                                </div>
                                <div className="col-span-6 md:col-span-7">
                                    <div className="font-bold text-[color:var(--text)] truncate flex items-center gap-2">
                                        {entry.name}
                                        {currentUserId && entry.ownerUid === currentUserId && <YouPill />}
                                        {pool.settings.entryFee > 0 && (
                                            entry.paidStatus === 'PAID' ? (
                                                <Badge status="paid" className="text-[10px] px-1.5 py-0.5 whitespace-nowrap">PAID</Badge>
                                            ) : (
                                                <Badge status="unpaid" className="text-[10px] px-1.5 py-0.5 whitespace-nowrap">UNPAID</Badge>
                                            )
                                        )}
                                        {change !== undefined && change !== 0 && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${change > 0 ? 'bg-[#0F7B4A]/10 text-[#0F7B4A]' : 'bg-brandred-600/10 text-brandred-600'}`}>
                                                {change > 0 ? 'Rank Up' : 'Rank Down'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-faint truncate hidden sm:block">
                                        {userNames?.[entry.ownerUid] ?? 'Unknown'}
                                    </div>
                                </div>
                                <div className={`col-span-2 text-right num font-display font-bold text-lg ${isChampion ? 'text-gold-600' : 'text-[color:var(--text)]'}`}>
                                    {entry.score}
                                </div>
                                <div className="col-span-2 text-right num text-faint hidden md:block">
                                    {entry.max}
                                </div>
                            </div>
                        );
                    })}
                </div>
                    </div>
                </div>
            </div>

            {/* Score sync freshness stamp */}
            {syncStatus && (
                syncDelayed ? (
                    <div className="flex items-center gap-1.5 px-2 text-xs text-gold-600">
                        <AlertCircle size={12} className="shrink-0" />
                        <span>Score sync delayed — standings may lag</span>
                    </div>
                ) : (
                    <div className="px-2 text-xs text-faint">
                        Scores updated {formatRelativeTime(now - syncStatus.lastSyncAt)} ago
                    </div>
                )
            )}
        </div>
    );
};
