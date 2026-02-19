import React, { useMemo } from 'react';
import type { Tournament, Game } from '../../types';
import { MatchNode } from './MatchNode';
import { Trophy } from 'lucide-react';

interface ConferenceBracketBuilderProps {
    tournament: Tournament;
    picks: Record<string, string>;
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
}

/**
 * ConferenceBracketBuilder renders a 4-round single-elimination conference
 * tournament bracket (e.g., Big East: 11 teams, byes for seeds 1-5).
 *
 * Structure:
 *   Round 1 (play-in): 3 games — seeds #9v#8, #10v#7, #11v#6
 *   Round 2 (QF):      4 games — R1 winners face seeds #5,#4,#3,#2
 *   Semis:             2 games — QF winners face seeds #1 + SF bracket
 *   Final:             1 game  — Championship
 */
export const ConferenceBracketBuilder: React.FC<ConferenceBracketBuilderProps> = ({
    tournament,
    picks,
    onPick,
    readOnly
}) => {
    const games = tournament.games;

    // Group games by round
    const gamesByRound = useMemo(() => {
        const byRound: Record<number, typeof games[string][]> = {};
        Object.values(games).forEach(g => {
            const r = g.round;
            if (!byRound[r]) byRound[r] = [];
            byRound[r].push(g);
        });
        // Sort each round's games by game id for stable ordering
        Object.keys(byRound).forEach(r => {
            byRound[Number(r)].sort((a, b) => a.id.localeCompare(b.id));
        });
        return byRound;
    }, [games]);

    // Eliminated team IDs
    const eliminatedTeamIds = useMemo(() => {
        const elim = new Set<string>();
        Object.values(games).forEach(g => {
            if (g.status === 'FINAL' && g.winnerTeamId) {
                const loserId = g.winnerTeamId === g.homeTeamId ? g.awayTeamId : g.homeTeamId;
                if (loserId) elim.add(loserId);
            }
        });
        return elim;
    }, [games]);

    const r1 = gamesByRound[1] || []; // 3 play-in games
    const r2 = gamesByRound[2] || []; // 4 QF games
    const r3 = gamesByRound[3] || []; // 2 SF games
    const r4 = gamesByRound[4] || []; // 1 final

    const totalPicks = Object.keys(picks).length;
    const requiredPicks = Object.keys(games).length;

    // Helper to resolve a pick from a previous round game
    const resolveWinner = (sourceGameId?: string): string | undefined => {
        if (!sourceGameId) return undefined;
        return picks[sourceGameId];
    };

    return (
        <div className="flex flex-col w-full">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 pt-4 px-4 pb-3">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Trophy className="text-amber-500" size={20} />
                        {tournament.conferenceName || 'Conference'} Championship
                    </h2>
                    <div className="text-sm text-slate-400 font-mono">
                        {totalPicks} / {requiredPicks} picks
                    </div>
                </div>
            </div>

            {/* Bracket Layout */}
            <div className="p-4 overflow-x-auto">
                <div className="flex gap-6 items-start min-w-fit mx-auto justify-center">

                    {/* Round 1: Play-In (3 games) */}
                    <RoundColumn
                        label="First Round"
                        sublabel="Play-In"
                        games={r1}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                        eliminatedTeamIds={eliminatedTeamIds}
                        verticalSpacing="gap-8"
                    />

                    {/* Round 2: Quarterfinals (4 games) — R1 winners vs bye seeds */}
                    <RoundColumn
                        label="Quarterfinals"
                        games={r2}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                        eliminatedTeamIds={eliminatedTeamIds}
                        verticalSpacing="gap-6"
                        feeders={[
                            // For each QF game, one team is a bye (already set on game) and one comes from R1
                            ...(r2.map((g, i) => {
                                // Work out which R1 game feeds this QF slot
                                const r1Feeder = r1[i]; // heuristic: ordered by id
                                return {
                                    gameId: g.id,
                                    homeOverride: r1Feeder ? resolveWinner(r1Feeder.id) : undefined,
                                    // awayOverride stays undefined → falls back to game data (bye seed)
                                };
                            }))
                        ]}
                    />

                    {/* Round 3: Semifinals (2 games) */}
                    <RoundColumn
                        label="Semifinals"
                        games={r3}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                        eliminatedTeamIds={eliminatedTeamIds}
                        verticalSpacing="gap-16"
                        feeders={[
                            // standard bracket: SF1 = Winner(1v8) vs Winner(4v5); SF2 = Winner(2v7) vs Winner(3v6)
                            // r2[0]=1seed, r2[1]=2seed, r2[2]=3seed, r2[3]=4seed
                            // So SF1 uses r2[0] & r2[3]. SF2 uses r2[1] & r2[2].
                            {
                                gameId: r3[0]?.id,
                                homeOverride: resolveWinner(r2[0]?.id),
                                awayOverride: resolveWinner(r2[3]?.id),
                            },
                            {
                                gameId: r3[1]?.id,
                                homeOverride: resolveWinner(r2[1]?.id),
                                awayOverride: resolveWinner(r2[2]?.id),
                            }
                        ]}
                    />

                    {/* Round 4: Championship Final */}
                    <div className="flex flex-col items-center justify-center gap-4 py-24">
                        <p className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-2">Championship</p>
                        <Trophy className="text-amber-400 animate-pulse mb-2" size={28} />
                        {r4[0] && (
                            <MatchNode
                                game={r4[0]}
                                picks={picks}
                                onPick={onPick}
                                readOnly={readOnly}
                                isChampionship
                                homeTeamIdOverride={resolveWinner(r3[0]?.id)}
                                awayTeamIdOverride={resolveWinner(r3[1]?.id)}
                                dynamicParticipants
                                eliminatedTeamIds={eliminatedTeamIds}
                            />
                        )}
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-2">Champion</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Helper sub-component: RoundColumn
// ─────────────────────────────────────────────────────────
interface FeederInfo {
    gameId: string;
    homeOverride?: string;
    awayOverride?: string;
}

interface RoundColumnProps {
    label: string;
    sublabel?: string;
    games: Game[];
    picks: Record<string, string>;
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
    eliminatedTeamIds: Set<string>;
    verticalSpacing?: string;
    feeders?: FeederInfo[];
}

const RoundColumn: React.FC<RoundColumnProps> = ({
    label,
    sublabel,
    games,
    picks,
    onPick,
    readOnly,
    eliminatedTeamIds,
    verticalSpacing = 'gap-6',
    feeders,
}) => {
    return (
        <div className="flex flex-col items-center">
            {/* Round label */}
            <div className="mb-4 text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-indigo-400">{label}</p>
                {sublabel && <p className="text-[10px] text-slate-500">{sublabel}</p>}
            </div>

            <div className={`flex flex-col justify-around ${verticalSpacing} py-2`}>
                {games.map((g: Game) => {
                    const feeder = feeders?.find(f => f.gameId === g.id);
                    const hasDynamicParticipants = Boolean(feeder?.homeOverride !== undefined || feeder?.awayOverride !== undefined);
                    return (
                        <MatchNode
                            key={g.id}
                            game={g}
                            picks={picks}
                            onPick={onPick}
                            readOnly={readOnly}
                            eliminatedTeamIds={eliminatedTeamIds}
                            homeTeamIdOverride={feeder?.homeOverride}
                            awayTeamIdOverride={feeder?.awayOverride}
                            dynamicParticipants={hasDynamicParticipants}
                        />
                    );
                })}
            </div>
        </div>
    );
};
