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

    const totalPicks = Object.keys(picks).length;
    const requiredPicks = Object.keys(games).length;

    // Helper to resolve a pick from a previous round game
    const resolveWinner = (sourceGameId?: string): string | undefined => {
        if (!sourceGameId) return undefined;
        return picks[sourceGameId];
    };

    const rounds = Object.keys(gamesByRound).map(Number).sort((a, b) => a - b);
    const maxRound = rounds[rounds.length - 1] || 4;

    const getRoundLabel = (r: number, max: number) => {
        if (r === max) return "Championship";
        if (r === max - 1) return "Semifinals";
        if (r === max - 2) return "Quarterfinals";
        if (r === max - 3) return max >= 5 ? "Second Round" : "First Round";
        if (r <= max - 4) return "First Round";
        return `Round ${r}`;
    };

    // Build feeder map for each game
    const feedersByGame = useMemo(() => {
        const feeders: Record<string, string[]> = {};
        Object.values(tournament.slots || {}).forEach(slot => {
            if (slot.nextSlotId) {
                const targetSlot = tournament.slots[slot.nextSlotId];
                const targetGameId = targetSlot ? targetSlot.gameId : slot.nextSlotId;
                if (!feeders[targetGameId]) feeders[targetGameId] = [];
                feeders[targetGameId].push(slot.gameId);
            }
        });
        // Sort feeders so we have a consistent order
        Object.values(feeders).forEach(arr => arr.sort());
        return feeders;
    }, [tournament.slots]);

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

                    {rounds.map(r => {
                        const roundGames = gamesByRound[r];
                        if (!roundGames) return null;

                        // Render final
                        if (r === maxRound) {
                            return (
                                <div key={r} className="flex flex-col items-center justify-center gap-4 py-24">
                                    <p className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-2">Championship</p>
                                    <Trophy className="text-amber-400 animate-pulse mb-2" size={28} />
                                    {roundGames[0] && (
                                        <MatchNode
                                            game={roundGames[0]}
                                            picks={picks}
                                            onPick={onPick}
                                            readOnly={readOnly}
                                            isChampionship
                                            homeTeamIdOverride={resolveWinner(feedersByGame[roundGames[0].id]?.[0])}
                                            awayTeamIdOverride={resolveWinner(feedersByGame[roundGames[0].id]?.[1])}
                                            dynamicParticipants={true}
                                            eliminatedTeamIds={eliminatedTeamIds}
                                        />
                                    )}
                                    <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-2">Champion</p>
                                </div>
                            );
                        }

                        // Render RoundColumn
                        const label = getRoundLabel(r, maxRound);
                        const sublabel = r === 1 && maxRound === 4 ? "Play-In" : undefined;

                        // Decide vertical spacing
                        let spacing = 'gap-6';
                        if (r === maxRound - 1) spacing = 'gap-16'; // SF
                        if (maxRound === 4 && r === 1) spacing = 'gap-8'; // Big East R1
                        if (maxRound >= 5) {
                            if (r === 1) spacing = 'gap-24'; // First Round spacing for Big 12
                            if (r === 2) spacing = 'gap-12'; // Second Round spacing
                            if (r === maxRound - 2) spacing = 'gap-8'; // QF
                        }

                        // Build feeders for this round
                        const columnFeeders = roundGames.map((g) => {
                            const f = feedersByGame[g.id] || [];
                            let homeOverride: string | undefined;
                            let awayOverride: string | undefined;

                            if (f.length === 2) {
                                homeOverride = resolveWinner(f[0]);
                                awayOverride = resolveWinner(f[1]);
                            } else if (f.length === 1) {
                                // Find exactly which slot is empty/placeholder
                                const isHomeEmpty = !g.homeTeamId || g.homeTeamId.startsWith('SEED_');
                                const isAwayEmpty = !g.awayTeamId || g.awayTeamId.startsWith('SEED_');

                                if (isAwayEmpty && !isHomeEmpty) {
                                    awayOverride = resolveWinner(f[0]);
                                } else if (isHomeEmpty && !isAwayEmpty) {
                                    homeOverride = resolveWinner(f[0]);
                                } else {
                                    // If both or neither match the heuristic, default to away (common for bye structures)
                                    awayOverride = resolveWinner(f[0]);
                                }
                            }

                            return {
                                gameId: g.id,
                                homeOverride,
                                awayOverride,
                            };
                        });

                        return (
                            <RoundColumn
                                key={r}
                                label={label}
                                sublabel={sublabel}
                                games={roundGames}
                                picks={picks}
                                onPick={onPick}
                                readOnly={readOnly}
                                eliminatedTeamIds={eliminatedTeamIds}
                                verticalSpacing={spacing}
                                feeders={columnFeeders}
                                roundNumber={r}
                                maxRound={maxRound}
                            />
                        );
                    })}
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
    roundNumber?: number;
    maxRound?: number;
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
    roundNumber,
    maxRound,
}) => {
    // Determine margin-top to stagger Big 12 early rounds so they line up better with subsequent rounds
    let mtClass = "";
    if (maxRound && maxRound >= 5) {
        if (roundNumber === 1) mtClass = "mt-4";
        if (roundNumber === 2) mtClass = "mt-12";
        if (roundNumber === 3) mtClass = "mt-24";
        if (roundNumber === 4) mtClass = "mt-40";
    }

    return (
        <div className={`flex flex-col items-center ${mtClass}`}>
            {/* Round label */}
            <div className="mb-4 text-center h-10">
                <p className="text-xs font-bold uppercase tracking-widest text-indigo-400">{label}</p>
                {sublabel && <p className="text-[10px] text-slate-500">{sublabel}</p>}
            </div>

            <div className={`flex flex-col justify-around ${verticalSpacing} py-2 flex-grow`}>
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
