import React, { useState, useMemo, useCallback } from 'react';
import type { BracketEntry, Tournament, BracketPool } from '../../types';
import { calculateWhatIfScore, getRoundLabel } from './bracketScoring';
import { FlaskConical, RotateCcw, Trophy } from 'lucide-react';
import { YouPill } from '../ui';

interface WhatIfSimulatorProps {
    entries: BracketEntry[];
    tournament: Tournament;
    pool: BracketPool;
    currentUserId?: string;
}

export const WhatIfSimulator: React.FC<WhatIfSimulatorProps> = ({ entries, tournament, pool, currentUserId }) => {
    const [hypotheticals, setHypotheticals] = useState<Record<string, string>>({});

    // Get undecided games grouped by round
    const undecidedByRound = useMemo(() => {
        const games = Object.values(tournament.games)
            .filter(g => g.status !== 'FINAL' && g.homeTeamId && g.awayTeamId)
            .sort((a, b) => a.round - b.round);

        const grouped = new Map<number, typeof games>();
        for (const g of games) {
            if (!grouped.has(g.round)) grouped.set(g.round, []);
            grouped.get(g.round)!.push(g);
        }
        return grouped;
    }, [tournament]);

    const maxRound = useMemo(() => {
        return Object.values(tournament.games).reduce((max, g) => Math.max(max, g.round), 0) || 6;
    }, [tournament]);

    // Calculate simulated standings
    const standings = useMemo(() => {
        return entries
            .map(e => {
                const result = calculateWhatIfScore(e, tournament, pool.settings, hypotheticals);
                return {
                    entry: e,
                    score: result.score,
                    maxPossible: result.maxPossibleScore,
                    isCurrentUser: e.ownerUid === currentUserId,
                };
            })
            .sort((a, b) => b.score - a.score);
    }, [entries, tournament, pool.settings, hypotheticals, currentUserId]);

    const toggleWinner = useCallback((gameId: string, teamId: string) => {
        setHypotheticals(prev => {
            const next = { ...prev };
            if (next[gameId] === teamId) {
                delete next[gameId];
            } else {
                next[gameId] = teamId;
            }
            return next;
        });
    }, []);

    const resetAll = useCallback(() => setHypotheticals({}), []);

    const hypotheticalCount = Object.keys(hypotheticals).length;

    return (
        <div className="space-y-6">
            {/* Header + Reset */}
            <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <FlaskConical size={20} className="text-gold-500" />
                        <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)]">What-If Simulator</h3>
                    </div>
                    {hypotheticalCount > 0 && (
                        <button
                            onClick={resetAll}
                            className="text-xs text-muted hover:text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] flex items-center gap-1 px-3 py-1.5 border border-line rounded-lg hover:border-gold-500 transition-colors duration-150"
                        >
                            <RotateCcw size={12} /> Reset ({hypotheticalCount})
                        </button>
                    )}
                </div>
                <p className="text-muted font-body text-sm">Click a team to simulate them winning. Standings update live below.</p>
            </div>

            {/* Game Toggles by Round */}
            {Array.from(undecidedByRound.entries()).map(([round, games]) => (
                <div key={round} className="bg-card border border-line rounded-xl p-6 shadow-card">
                    <h4 className="text-sm font-display font-bold uppercase tracking-[0.08em] text-muted mb-3">{getRoundLabel(round - 1, maxRound, tournament.tournamentType === 'conference')}</h4>
                    <div className="space-y-2">
                        {games.map(game => {
                            const homeSelected = hypotheticals[game.id] === game.homeTeamId;
                            const awaySelected = hypotheticals[game.id] === game.awayTeamId;

                            return (
                                <div key={game.id} className="flex items-center gap-2">
                                    <button
                                        onClick={() => toggleWinner(game.id, game.homeTeamId)}
                                        className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-bold border transition duration-150 ${homeSelected
                                            ? 'bg-gold-400 border-gold-500 text-navy-900'
                                            : 'bg-surface border-line text-[color:var(--text)] hover:border-gold-500'
                                            }`}
                                    >
                                        {homeSelected && <Trophy size={12} className="inline mr-1.5 -mt-0.5" />}
                                        {game.homeTeamId}
                                    </button>
                                    <span className="text-faint text-xs font-display font-bold uppercase">vs</span>
                                    <button
                                        onClick={() => toggleWinner(game.id, game.awayTeamId)}
                                        className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-bold border transition duration-150 ${awaySelected
                                            ? 'bg-gold-400 border-gold-500 text-navy-900'
                                            : 'bg-surface border-line text-[color:var(--text)] hover:border-gold-500'
                                            }`}
                                    >
                                        {awaySelected && <Trophy size={12} className="inline mr-1.5 -mt-0.5" />}
                                        {game.awayTeamId}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* No undecided games */}
            {undecidedByRound.size === 0 && (
                <div className="bg-card border border-line rounded-xl p-6 text-center text-faint shadow-card">
                    <Trophy size={32} className="mx-auto mb-2 opacity-20" />
                    <p className="text-sm">All games have been decided. The tournament is complete!</p>
                </div>
            )}

            {/* Simulated Standings */}
            <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                <h4 className="text-sm font-display font-bold uppercase tracking-[0.08em] text-muted mb-3">
                    {hypotheticalCount > 0 ? 'Projected Standings' : 'Current Standings'}
                </h4>
                <div className="space-y-1">
                    {standings.map((s, i) => (
                        <div
                            key={s.entry.id}
                            className={`flex items-center justify-between p-2.5 rounded-lg text-sm font-body ${s.isCurrentUser
                                ? 'bg-brandred-600/[0.07] border border-brandred-600/30'
                                : i % 2 === 0 ? 'bg-surface' : ''
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-faint num text-xs w-6 text-right">#{i + 1}</span>
                                <span className={s.isCurrentUser ? 'text-[color:var(--text)] font-bold' : 'text-[color:var(--text)]'}>{s.entry.name}</span>
                                {s.isCurrentUser && <YouPill />}
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-xs text-faint num">Max: {s.maxPossible}</span>
                                <span className="num font-display font-bold text-[color:var(--text)]">{s.score}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
