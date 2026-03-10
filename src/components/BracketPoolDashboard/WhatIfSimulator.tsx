import React, { useState, useMemo, useCallback } from 'react';
import type { BracketEntry, Tournament, BracketPool } from '../../types';
import { calculateWhatIfScore, getRoundLabel } from './bracketScoring';
import { FlaskConical, RotateCcw, Trophy } from 'lucide-react';

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
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <FlaskConical size={20} className="text-violet-400" />
                        <h3 className="text-xl font-bold text-white">What-If Simulator</h3>
                    </div>
                    {hypotheticalCount > 0 && (
                        <button
                            onClick={resetAll}
                            className="text-xs text-slate-400 hover:text-white font-bold flex items-center gap-1 px-3 py-1.5 border border-slate-700 rounded-lg hover:border-slate-600 transition-colors"
                        >
                            <RotateCcw size={12} /> Reset ({hypotheticalCount})
                        </button>
                    )}
                </div>
                <p className="text-slate-400 text-sm">Click a team to simulate them winning. Standings update live below.</p>
            </div>

            {/* Game Toggles by Round */}
            {Array.from(undecidedByRound.entries()).map(([round, games]) => (
                <div key={round} className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h4 className="text-sm font-bold text-slate-300 mb-3">{getRoundLabel(round - 1, maxRound, tournament.tournamentType === 'conference')}</h4>
                    <div className="space-y-2">
                        {games.map(game => {
                            const homeSelected = hypotheticals[game.id] === game.homeTeamId;
                            const awaySelected = hypotheticals[game.id] === game.awayTeamId;

                            return (
                                <div key={game.id} className="flex items-center gap-2">
                                    <button
                                        onClick={() => toggleWinner(game.id, game.homeTeamId)}
                                        className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-bold border transition-all ${homeSelected
                                            ? 'bg-emerald-900/40 border-emerald-600 text-emerald-300'
                                            : 'bg-slate-950 border-slate-800 text-white hover:border-slate-600'
                                            }`}
                                    >
                                        {homeSelected && <Trophy size={12} className="inline mr-1.5 -mt-0.5" />}
                                        {game.homeTeamId}
                                    </button>
                                    <span className="text-slate-600 text-xs font-bold">vs</span>
                                    <button
                                        onClick={() => toggleWinner(game.id, game.awayTeamId)}
                                        className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-bold border transition-all ${awaySelected
                                            ? 'bg-emerald-900/40 border-emerald-600 text-emerald-300'
                                            : 'bg-slate-950 border-slate-800 text-white hover:border-slate-600'
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
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-500">
                    <Trophy size={32} className="mx-auto mb-2 opacity-20" />
                    <p className="text-sm">All games have been decided. The tournament is complete!</p>
                </div>
            )}

            {/* Simulated Standings */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h4 className="text-sm font-bold text-white mb-3">
                    {hypotheticalCount > 0 ? 'Projected Standings' : 'Current Standings'}
                </h4>
                <div className="space-y-1">
                    {standings.map((s, i) => (
                        <div
                            key={s.entry.id}
                            className={`flex items-center justify-between p-2.5 rounded-lg text-sm ${s.isCurrentUser
                                ? 'bg-indigo-900/30 border border-indigo-700'
                                : i % 2 === 0 ? 'bg-slate-950' : ''
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-slate-500 font-mono text-xs w-6 text-right">#{i + 1}</span>
                                <span className={s.isCurrentUser ? 'text-indigo-300 font-bold' : 'text-white'}>{s.entry.name}</span>
                                {s.isCurrentUser && <span className="text-[10px] text-indigo-400 bg-indigo-900/40 px-1.5 py-0.5 rounded">YOU</span>}
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-xs text-slate-500">Max: {s.maxPossible}</span>
                                <span className="font-mono font-bold text-emerald-400">{s.score}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
