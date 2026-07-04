import React, { useState, useMemo } from 'react';
import type { BracketEntry, Tournament } from '../../types';
import { BracketBuilder } from '../BracketBuilder/BracketBuilder';
import { ConferenceBracketBuilder } from '../BracketBuilder/ConferenceBracketBuilder';
import { StatsHeader } from '../BracketBuilder/ESPNBracket';
import { Users, Info, AlertTriangle, Check } from 'lucide-react';

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
            <div className="bg-card rounded-xl p-8 text-center text-muted border border-line shadow-card">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Not enough brackets to compare</h3>
                <p>Wait for more entries to be submitted before comparing picks.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Header / Selectors */}
            {!hideSelectors && (
                <div className="bg-card rounded-xl border border-line p-4 md:p-6 shadow-card">
                    <div className="flex gap-2 items-center mb-6 text-muted">
                        <Info className="w-5 h-5 text-gold-500" />
                        <h2 className="text-lg font-display font-bold uppercase text-[color:var(--text)]">Compare Brackets</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                        {/* Entry 1 Selector */}
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-display font-bold uppercase tracking-[0.08em] text-muted">First Bracket (Green = Match)</label>
                            <select
                                value={entry1Id}
                                onChange={(e) => setEntry1Id(e.target.value)}
                                className="bg-surface border border-line rounded-lg px-4 py-2.5 text-[color:var(--text)] focus:outline-none focus:border-gold-500 font-body font-medium"
                            >
                                {validEntries.map(entry => (
                                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Entry 2 Selector */}
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-display font-bold uppercase tracking-[0.08em] text-muted">Second Bracket (Red = Difference)</label>
                            <select
                                value={entry2Id}
                                onChange={(e) => setEntry2Id(e.target.value)}
                                className="bg-surface border border-line rounded-lg px-4 py-2.5 text-[color:var(--text)] focus:outline-none focus:border-brandred-500 font-body font-medium"
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
                <div className="mt-2 p-4 bg-surface rounded-lg border border-line flex flex-col md:flex-row gap-4 justify-between items-center text-sm font-body">
                    <div className="flex items-center gap-2">
                        <span className="num font-display text-xl font-bold text-[color:var(--text)]">{comparisonStats.matchCount}</span>
                        <span className="text-muted num">/ {comparisonStats.totalPicks} matching picks</span>
                        <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold num bg-page border border-line text-muted">
                            {Math.round((comparisonStats.matchCount / Math.max(1, comparisonStats.totalPicks)) * 100)}% Similarity
                        </span>
                    </div>
                    {comparisonStats.champDiff && (
                        <div className="text-brandred-600 font-semibold px-3 py-1 bg-brandred-600/10 rounded border border-brandred-600/20 flex items-center gap-1.5">
                            <AlertTriangle size={14} /> Different Champion Picks
                        </div>
                    )}
                    {!comparisonStats.champDiff && (
                        <div className="text-[#0F7B4A] font-semibold px-3 py-1 bg-[#E4F5EC] rounded border border-[#BEE7D0] flex items-center gap-1.5">
                            <Check size={14} /> Same Champion Pick
                        </div>
                    )}
                </div>
            )}

            {/* Brackets Side-by-Side */}
            {entry1 && entry2 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                    {/* Entry 1 */}
                    <div className="bg-card rounded-xl border border-line flex flex-col min-w-0 overflow-hidden shadow-card">
                        <div className="bg-surface p-3 border-b border-line text-center font-display font-bold uppercase text-[color:var(--text)] truncate">
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
                    <div className="bg-card rounded-xl border border-line flex flex-col min-w-0 overflow-hidden shadow-card">
                        <div className="bg-surface p-3 border-b border-line text-center font-display font-bold uppercase text-[color:var(--text)] truncate">
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
