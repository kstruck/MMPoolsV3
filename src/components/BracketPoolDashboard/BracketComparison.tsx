import React, { useState, useMemo } from 'react';
import type { BracketEntry, Tournament } from '../../types';
import { BracketBuilder } from '../BracketBuilder/BracketBuilder';
import { ConferenceBracketBuilder } from '../BracketBuilder/ConferenceBracketBuilder';
import { StatsHeader } from '../BracketBuilder/ESPNBracket';
import { Users, Info } from 'lucide-react';

interface BracketComparisonProps {
    tournament: Tournament;
    allEntries: BracketEntry[];
    initialEntry1Id?: string;
    initialEntry2Id?: string;
    hideSelectors?: boolean;
    isConference?: boolean;
}

export const BracketComparison: React.FC<BracketComparisonProps> = ({ tournament, allEntries, initialEntry1Id, initialEntry2Id, hideSelectors, isConference }) => {
    // Filter valid entries — check for status or that they have ANY picks at all
    const validEntries = allEntries.filter(e => e.status === 'SUBMITTED' || Object.keys(e.picks || {}).length > 0);

    const [entry1Id, setEntry1Id] = useState<string>(
        initialEntry1Id && validEntries.find(e => e.id === initialEntry1Id)
            ? initialEntry1Id
            : validEntries[0]?.id || ''
    );

    const [entry2Id, setEntry2Id] = useState<string>(
        initialEntry2Id && validEntries.find(e => e.id === initialEntry2Id)
            ? initialEntry2Id
            : validEntries.find(e => e.id !== entry1Id)?.id || ''
    );

    const entry1 = validEntries.find(e => e.id === entry1Id);
    const entry2 = validEntries.find(e => e.id === entry2Id);

    // Determine championship round dynamically
    const maxRound = useMemo(() =>
        Object.values(tournament.games).reduce((max, g) => Math.max(max, g.round), 0) || 6
        , [tournament]);

    // Calculate differences
    const comparisonStats = useMemo(() => {
        if (!entry1 || !entry2) return null;

        let matchCount = 0;
        let totalPicks = 0;
        let champDiff = false;

        Object.keys(tournament.games).forEach(gameId => {
            const p1 = entry1.picks[gameId];
            const p2 = entry2.picks[gameId];

            if (p1 && p1 !== 'TBD' && p2 && p2 !== 'TBD') {
                totalPicks++;
                if (p1 === p2) {
                    matchCount++;
                }
            }

            // Check if it's the championship game (dynamic max round)
            const game = tournament.games[gameId];
            if (game && game.round === maxRound && p1 !== p2) {
                champDiff = true;
            }
        });

        return {
            matchCount,
            totalPicks,
            champDiff
        };
    }, [entry1, entry2, tournament, maxRound]);

    // Total entries count for PCT calculation in StatsHeader
    const totalEntries = validEntries.length;

    // Compute rank for an entry (by score descending; 1-indexed)
    const getRank = (entry: BracketEntry) => {
        const sorted = [...validEntries].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const idx = sorted.findIndex(e => e.id === entry.id);
        return idx >= 0 ? idx + 1 : undefined;
    };

    // Compute pick counts for an entry
    const getPickCount = (entry: BracketEntry) =>
        Object.values(entry.picks || {}).filter(v => v && v !== 'TBD').length;

    const totalGames = Object.keys(tournament.games).length;

    if (validEntries.length < 2) {
        return (
            <div className="bg-slate-800 rounded-xl p-8 text-center text-slate-400 border border-slate-700">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <h3 className="text-xl font-bold text-white mb-2">Not enough brackets to compare</h3>
                <p>Wait for more entries to be submitted before comparing picks.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Header / Selectors */}
            {!hideSelectors && (
                <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 md:p-6 shadow-xl">
                    <div className="flex gap-2 items-center mb-6 text-slate-300">
                        <Info className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-lg font-bold text-white">Compare Brackets</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                        {/* Entry 1 Selector */}
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-bold text-slate-400">First Bracket (Green = Match)</label>
                            <select
                                value={entry1Id}
                                onChange={(e) => setEntry1Id(e.target.value)}
                                className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 font-medium"
                            >
                                {validEntries.map(entry => (
                                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Entry 2 Selector */}
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-bold text-slate-400">Second Bracket (Red = Difference)</label>
                            <select
                                value={entry2Id}
                                onChange={(e) => setEntry2Id(e.target.value)}
                                className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-rose-500 font-medium"
                            >
                                {validEntries.map(entry => (
                                    <option key={entry.id} value={entry.id} disabled={entry.id === entry1Id}>
                                        {entry.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Summary */}
            {comparisonStats && (
                <div className="mt-2 p-4 bg-slate-900/50 rounded-lg border border-slate-700/50 flex flex-col md:flex-row gap-4 justify-between items-center text-sm">
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-xl font-bold text-white">{comparisonStats.matchCount}</span>
                        <span className="text-slate-400">/ {comparisonStats.totalPicks} matching picks</span>
                        <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold bg-slate-800 text-slate-300">
                            {Math.round((comparisonStats.matchCount / Math.max(1, comparisonStats.totalPicks)) * 100)}% Similarity
                        </span>
                    </div>
                    {comparisonStats.champDiff && (
                        <div className="text-rose-400 font-semibold px-3 py-1 bg-rose-500/10 rounded border border-rose-500/20">
                            ⚠ Different Champion Picks
                        </div>
                    )}
                    {!comparisonStats.champDiff && (
                        <div className="text-emerald-400 font-semibold px-3 py-1 bg-emerald-500/10 rounded border border-emerald-500/20">
                            ✓ Same Champion Pick
                        </div>
                    )}
                </div>
            )}

            {/* Brackets Side-by-Side */}
            {entry1 && entry2 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                    {/* Entry 1 */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col min-w-0 overflow-hidden">
                        <div className="bg-slate-900/80 p-3 border-b border-slate-700 text-center font-bold truncate">
                            {entry1.name}
                        </div>
                        {/* Stats Header for Entry 1 */}
                        <StatsHeader
                            tournament={tournament}
                            picks={entry1.picks}
                            entryName={entry1.name}
                            entryScore={entry1.score ?? 0}
                            maxPossibleScore={entry1.maxPossibleScore}
                            rank={getRank(entry1)}
                            totalEntries={totalEntries}
                            pickCount={getPickCount(entry1)}
                            totalPicks={totalGames}
                        />
                        <div className="relative">
                            {isConference ? (
                                <ConferenceBracketBuilder
                                    tournament={tournament}
                                    picks={entry1.picks}
                                    onPick={() => { }}
                                    readOnly
                                />
                            ) : (
                                <BracketBuilder
                                    tournament={tournament}
                                    picks={entry1.picks}
                                    onPick={() => { }}
                                    readOnly
                                    viewMode="tabs"
                                    comparisonPicks={entry2.picks}
                                />
                            )}
                        </div>
                    </div>

                    {/* Entry 2 */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col min-w-0 overflow-hidden">
                        <div className="bg-slate-900/80 p-3 border-b border-slate-700 text-center font-bold truncate">
                            {entry2.name}
                        </div>
                        {/* Stats Header for Entry 2 */}
                        <StatsHeader
                            tournament={tournament}
                            picks={entry2.picks}
                            entryName={entry2.name}
                            entryScore={entry2.score ?? 0}
                            maxPossibleScore={entry2.maxPossibleScore}
                            rank={getRank(entry2)}
                            totalEntries={totalEntries}
                            pickCount={getPickCount(entry2)}
                            totalPicks={totalGames}
                        />
                        <div className="relative">
                            {isConference ? (
                                <ConferenceBracketBuilder
                                    tournament={tournament}
                                    picks={entry2.picks}
                                    onPick={() => { }}
                                    readOnly
                                />
                            ) : (
                                <BracketBuilder
                                    tournament={tournament}
                                    picks={entry2.picks}
                                    onPick={() => { }}
                                    readOnly
                                    viewMode="tabs"
                                    comparisonPicks={entry1.picks}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )
            }
        </div >
    );
};
