/**
 * ESPNBracket.tsx
 *
 * Full ESPN-style NCAA Tournament bracket UI.
 *
 * Layout:
 *   [EAST left→right] [Final Four] [WEST right→left]
 *   [SOUTH left→right]             [MIDWEST right→left]
 *
 * Click a team → pick them. They cascade forward to next rounds.
 */

import React, { useMemo } from 'react';
import type { Tournament, Game } from '../../types';
import { getTeamLogo } from '../../constants';
import { Trophy, Check, X } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ESPNBracketProps {
    tournament: Tournament;
    picks: Record<string, string>;
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
    eliminatedTeamIds?: Set<string>;
    comparisonPicks?: Record<string, string>;
}

interface TeamSlot {
    teamId?: string;
    seed?: number;
    isPicked: boolean;
    pickStatus?: 'correct' | 'incorrect' | null;
    isWinner?: boolean;
    isEliminated?: boolean;
    onClick: () => void;
    disabled: boolean;
}

// ─── Seed Extraction ───────────────────────────────────────────────────────

/** Extracts seed from team ID like "E1-OhioState" → 1, "W16-TCU" → 16 */
function extractSeed(teamId?: string): number | undefined {
    if (!teamId) return undefined;
    const m = teamId.match(/^[A-Z]+(\d+)-/);
    return m ? parseInt(m[1], 10) : undefined;
}

/** Extracts display name from team ID like "E5-Duke Blue Devils" → "Duke Blue Devils" */
function extractName(teamId?: string): string {
    if (!teamId) return 'TBD';
    const idx = teamId.indexOf('-');
    if (idx === -1) return teamId;
    return teamId.slice(idx + 1).replace(/-/g, ' ');
}

// ─── Region Color Accents ──────────────────────────────────────────────────

const REGION_COLORS: Record<string, string> = {
    East:    '#3b82f6', // blue
    West:    '#f97316', // orange
    South:   '#22c55e', // green
    Midwest: '#a855f7', // purple
};

// ─── Individual Team Slot ──────────────────────────────────────────────────

const TeamRow: React.FC<TeamSlot> = ({
    teamId, seed, isPicked, pickStatus, isWinner, isEliminated, onClick, disabled
}) => {
    const name = extractName(teamId);
    const logo = teamId ? getTeamLogo(teamId, 'ncaa') : null;

    let bg = '';
    let textColor = 'text-slate-300';
    if (isPicked) {
        if (pickStatus === 'incorrect') {
            bg = 'bg-red-800/40';
            textColor = 'text-red-200';
        } else if (pickStatus === 'correct') {
            bg = 'bg-emerald-700/40';
            textColor = 'text-emerald-100';
        } else {
            bg = 'bg-[#1e56a0]';
            textColor = 'text-white';
        }
    } else if (isWinner) {
        bg = 'bg-emerald-900/20';
    }

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                w-full flex items-center gap-1 px-1.5 h-[28px] text-left transition-all relative
                ${bg} ${textColor}
                ${!disabled && !isPicked ? 'hover:bg-[#1a3a6a] hover:text-white' : ''}
                ${disabled ? 'cursor-default' : 'cursor-pointer'}
                ${isEliminated && !isPicked ? 'opacity-40' : ''}
            `}
        >
            {/* Seed badge */}
            <span className={`
                text-[9px] font-bold min-w-[14px] text-center leading-none
                ${isPicked ? 'text-blue-200' : 'text-slate-500'}
                ${!teamId ? 'invisible' : ''}
            `}>
                {seed ?? ''}
            </span>

            {/* Logo */}
            {logo ? (
                <img
                    src={logo}
                    alt=""
                    className={`w-[14px] h-[14px] object-contain flex-shrink-0 ${isEliminated && !isPicked ? 'grayscale' : ''}`}
                    crossOrigin="anonymous"
                />
            ) : (
                <span className="w-[14px] h-[14px] flex-shrink-0" />
            )}

            {/* Name */}
            <span className={`
                text-[10px] font-semibold truncate flex-1 tracking-tight
                ${!teamId ? 'italic opacity-30' : ''}
                ${isEliminated && !isPicked ? 'line-through decoration-red-500/50' : ''}
            `}>
                {teamId ? name : 'TBD'}
            </span>

            {/* Status icon */}
            {pickStatus === 'correct' && <Check className="w-3 h-3 text-emerald-300 flex-shrink-0" />}
            {pickStatus === 'incorrect' && <X className="w-3 h-3 text-red-400 flex-shrink-0" />}
            {isWinner && !pickStatus && !isPicked && <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />}

            {/* Left highlight bar for picked */}
            {isPicked && (
                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-blue-400" />
            )}
        </button>
    );
};

// ─── Matchup Card ──────────────────────────────────────────────────────────

interface MatchupCardProps {
    game?: Game;
    homeTeamId?: string;
    awayTeamId?: string;
    picks: Record<string, string>;
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
    eliminatedTeamIds?: Set<string>;
    dynamicParticipants?: boolean;
}

const MatchupCard: React.FC<MatchupCardProps> = ({
    game, homeTeamId, awayTeamId, picks, onPick, readOnly, eliminatedTeamIds, dynamicParticipants
}) => {
    if (!game) {
        return (
            <div className="flex flex-col border border-slate-800/60 rounded-sm bg-slate-900/30 overflow-hidden opacity-40" style={{ width: 148 }}>
                <div className="h-[28px] border-b border-slate-800/60" />
                <div className="h-[28px]" />
            </div>
        );
    }

    const displayHome = dynamicParticipants ? homeTeamId : (homeTeamId ?? game.homeTeamId);
    const displayAway = dynamicParticipants ? awayTeamId : (awayTeamId ?? game.awayTeamId);

    const picked = picks[game.id];
    const isFinal = game.status === 'FINAL';
    const isHomeWinner = isFinal && game.winnerTeamId === displayHome;
    const isAwayWinner = isFinal && game.winnerTeamId === displayAway;

    const getPickStatus = (tid?: string): 'correct' | 'incorrect' | null => {
        if (!tid || !picked || tid !== picked) return null;
        if (!isFinal) return null;
        return game.winnerTeamId === tid ? 'correct' : 'incorrect';
    };

    return (
        <div
            className="flex flex-col border border-slate-700/70 rounded-sm bg-[#111c2b] overflow-hidden shadow-sm transition-all hover:border-slate-600/80"
            style={{ width: 148 }}
        >
            <TeamRow
                teamId={displayHome}
                seed={extractSeed(displayHome)}
                isPicked={picked === displayHome}
                pickStatus={getPickStatus(displayHome)}
                isWinner={isHomeWinner}
                isEliminated={displayHome ? eliminatedTeamIds?.has(displayHome) : false}
                onClick={() => !readOnly && displayHome && onPick(game.id, displayHome)}
                disabled={!!(readOnly || !displayHome)}
            />
            <div className="border-t border-slate-700/50 mx-1" />
            <TeamRow
                teamId={displayAway}
                seed={extractSeed(displayAway)}
                isPicked={picked === displayAway}
                pickStatus={getPickStatus(displayAway)}
                isWinner={isAwayWinner}
                isEliminated={displayAway ? eliminatedTeamIds?.has(displayAway) : false}
                onClick={() => !readOnly && displayAway && onPick(game.id, displayAway)}
                disabled={!!(readOnly || !displayAway)}
            />
        </div>
    );
};

// ─── Bracket Connector Lines ───────────────────────────────────────────────

/**
 * Renders two vertical stacked slots on the bracket, for each pair of R1 games
 * connecting to one R2 game. The connector is a CSS border approach.
 */
const SLOT_HEIGHT = 64; // each matchup card is ~56px + 8px gap

/** A column of matchup cards, spaced correctly so connectors align */
interface BracketColumnProps {
    games: (Game | undefined)[];
    round: number;
    picks: Record<string, string>;
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
    eliminatedTeamIds?: Set<string>;
    // Overrides for dynamic participants
    overrides: (readonly [string | undefined, string | undefined])[];
    dynamicParticipants?: boolean;
    align: 'left' | 'right';
}

const BracketColumn: React.FC<BracketColumnProps> = ({
    games, picks, onPick, readOnly, eliminatedTeamIds, overrides, dynamicParticipants
}) => {
    // Number of "slots" in round 1 = 8 games (base)
    // Each successive round halves the game count and doubles the spacing
    const count = games.length;

    return (
        <div className="flex flex-col" style={{ gap: `${SLOT_HEIGHT * (8 / count) - 56}px` }}>
            {games.map((game, i) => (
                <MatchupCard
                    key={game?.id ?? `placeholder-${i}`}
                    game={game}
                    homeTeamId={overrides[i]?.[0]}
                    awayTeamId={overrides[i]?.[1]}
                    picks={picks}
                    onPick={onPick}
                    readOnly={readOnly}
                    eliminatedTeamIds={eliminatedTeamIds}
                    dynamicParticipants={dynamicParticipants}
                />
            ))}
        </div>
    );
};

// ─── Single Region Bracket (left-to-right or right-to-left) ───────────────

interface RegionProps extends ESPNBracketProps {
    region: string;
    align: 'left' | 'right';
}

const RegionBracket: React.FC<RegionProps> = ({
    region, align, tournament, picks, onPick, readOnly, eliminatedTeamIds
}) => {
    const color = REGION_COLORS[region] ?? '#3b82f6';

    const getGames = (round: number): Game[] =>
        Object.values(tournament.games)
            .filter(g => g.region === region && g.round === round)
            .sort((a, b) => a.id.localeCompare(b.id));

    const r1 = getGames(1); // 8
    const r2 = getGames(2); // 4
    const r3 = getGames(3); // 2
    const r4 = getGames(4); // 1

    // Build dynamic participant overrides
    const r2Overrides: (readonly [string | undefined, string | undefined])[] = r2.map((_, i) => [
        picks[r1[i * 2]?.id],
        picks[r1[i * 2 + 1]?.id],
    ] as const);

    const r3Overrides: (readonly [string | undefined, string | undefined])[] = r3.map((_, i) => [
        picks[r2[i * 2]?.id],
        picks[r2[i * 2 + 1]?.id],
    ] as const);

    const r4Override: (readonly [string | undefined, string | undefined])[] = r4.map(() => [
        picks[r3[0]?.id],
        picks[r3[1]?.id],
    ] as const);

    const noOverrides8: (readonly [string | undefined, string | undefined])[] = r1.map(() => [undefined, undefined] as const);

    // Columns: R1 (8 games), R2 (4), R3 (2), R4 (1)
    const columns = [
        { games: r1, overrides: noOverrides8, dynamic: false },
        { games: r2, overrides: r2Overrides, dynamic: true },
        { games: r3, overrides: r3Overrides, dynamic: true },
        { games: r4, overrides: r4Override, dynamic: true },
    ];

    const roundLabels = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8'];

    // For right-aligned regions, reverse the column order
    const orderedColumns = align === 'right' ? [...columns].reverse() : columns;
    const orderedLabels = align === 'right' ? [...roundLabels].reverse() : roundLabels;

    return (
        <div className="flex flex-col">
            {/* Region label */}
            <div
                className="text-center font-black text-xs tracking-[0.2em] uppercase mb-2 py-1 rounded-sm"
                style={{ color, borderBottom: `2px solid ${color}30`, letterSpacing: '0.15em' }}
            >
                {region}
            </div>

            {/* Round headers */}
            <div className="flex gap-3 mb-1">
                {orderedLabels.map((label, i) => (
                    <div
                        key={i}
                        className="text-center text-[9px] font-semibold text-slate-500 uppercase tracking-widest"
                        style={{ width: 148 }}
                    >
                        {label}
                    </div>
                ))}
            </div>

            {/* Bracket columns */}
            <div className="flex gap-3">
                {orderedColumns.map((col, i) => (
                    <BracketColumn
                        key={i}
                        round={i + 1}
                        games={col.games as (Game | undefined)[]}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                        eliminatedTeamIds={eliminatedTeamIds ?? new Set()}
                        overrides={col.overrides}
                        dynamicParticipants={col.dynamic}
                        align={align}
                    />
                ))}
            </div>
        </div>
    );
};

// ─── Final Four Center ─────────────────────────────────────────────────────

type FinalFourCenterProps = ESPNBracketProps;

const FinalFourCenter: React.FC<FinalFourCenterProps> = ({
    tournament, picks, onPick, readOnly, eliminatedTeamIds
}) => {
    const ffGames = Object.values(tournament.games)
        .filter(g => g.round === 5)
        .sort((a, b) => a.id.localeCompare(b.id));

    const champGame = Object.values(tournament.games).find(g => g.round === 6);

    const getRegChamp = (region: string) => {
        const game = Object.values(tournament.games).find(g => g.region === region && g.round === 4);
        return game ? picks[game.id] : undefined;
    };

    const eastChamp = getRegChamp('East');
    const westChamp = getRegChamp('West');
    const southChamp = getRegChamp('South');
    const midwestChamp = getRegChamp('Midwest');

    const f4Game1 = ffGames.find(g => g.id === 'R5-1') ?? ffGames[0]; // East vs West (South side bracket)
    const f4Game2 = ffGames.find(g => g.id === 'R5-2') ?? ffGames[1]; // South vs Midwest

    const champHome = f4Game1 ? picks[f4Game1.id] : undefined;
    const champAway = f4Game2 ? picks[f4Game2.id] : undefined;

    const totalGames = Object.keys(tournament.games).length;
    const totalPicks = Object.keys(picks).length;
    const pickPct = totalGames > 0 ? Math.round((totalPicks / totalGames) * 100) : 0;

    return (
        <div
            className="flex flex-col items-center justify-center gap-0 min-w-[220px]"
            style={{ paddingTop: 28 }}
        >
            {/* Final Four label */}
            <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest mb-1" style={{ width: 148, textAlign: 'center' }}>
                Final Four
            </div>

            {/* FF Game 1: East champion enters from left */}
            <div className="flex flex-col gap-0 items-center">
                <MatchupCard
                    game={f4Game1}
                    homeTeamId={eastChamp}
                    awayTeamId={southChamp}
                    picks={picks}
                    onPick={onPick}
                    readOnly={readOnly}
                    eliminatedTeamIds={eliminatedTeamIds}
                    dynamicParticipants
                />
                <div className="my-3" />

                {/* Championship */}
                <div className="text-[9px] font-semibold text-amber-400 uppercase tracking-widest mb-1 text-center">
                    National Championship
                </div>
                <div className="relative">
                    <div
                        className="absolute -inset-[2px] rounded bg-gradient-to-b from-amber-500/20 to-amber-600/10 border border-amber-500/30 pointer-events-none"
                    />
                    <MatchupCard
                        game={champGame}
                        homeTeamId={champHome}
                        awayTeamId={champAway}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                        eliminatedTeamIds={eliminatedTeamIds}
                        dynamicParticipants
                    />
                </div>

                {/* Trophy */}
                <div className="mt-3 flex flex-col items-center gap-1">
                    <Trophy className="w-6 h-6 text-amber-500 opacity-80" />
                    <div className="text-[9px] text-slate-500">
                        {pickPct}% complete
                    </div>
                </div>

                <div className="my-3" />

                {/* FF Game 2: South vs Midwest */}
                <MatchupCard
                    game={f4Game2}
                    homeTeamId={westChamp}
                    awayTeamId={midwestChamp}
                    picks={picks}
                    onPick={onPick}
                    readOnly={readOnly}
                    eliminatedTeamIds={eliminatedTeamIds}
                    dynamicParticipants
                />
            </div>
        </div>
    );
};

// ─── Main ESPN Bracket ─────────────────────────────────────────────────────

export const ESPNBracket: React.FC<ESPNBracketProps> = ({
    tournament, picks, onPick, readOnly, eliminatedTeamIds, comparisonPicks
}) => {
    const elims = eliminatedTeamIds ?? new Set<string>();

    // Memoize to avoid re-renders when parent re-renders
    const bracketContent = useMemo(() => (
        <div className="flex gap-4 items-start min-w-fit">
            {/* LEFT PANEL → East (top), South (bottom) */}
            <div className="flex flex-col gap-6">
                <RegionBracket
                    region="East"
                    align="left"
                    tournament={tournament}
                    picks={picks}
                    onPick={onPick}
                    readOnly={readOnly}
                    eliminatedTeamIds={elims}
                    comparisonPicks={comparisonPicks}
                />
                <RegionBracket
                    region="South"
                    align="left"
                    tournament={tournament}
                    picks={picks}
                    onPick={onPick}
                    readOnly={readOnly}
                    eliminatedTeamIds={elims}
                    comparisonPicks={comparisonPicks}
                />
            </div>

            {/* CENTER → Final Four + Championship */}
            <FinalFourCenter
                tournament={tournament}
                picks={picks}
                onPick={onPick}
                readOnly={readOnly}
                eliminatedTeamIds={elims}
                comparisonPicks={comparisonPicks}
            />

            {/* RIGHT PANEL → West (top), Midwest (bottom) */}
            <div className="flex flex-col gap-6">
                <RegionBracket
                    region="West"
                    align="right"
                    tournament={tournament}
                    picks={picks}
                    onPick={onPick}
                    readOnly={readOnly}
                    eliminatedTeamIds={elims}
                    comparisonPicks={comparisonPicks}
                />
                <RegionBracket
                    region="Midwest"
                    align="right"
                    tournament={tournament}
                    picks={picks}
                    onPick={onPick}
                    readOnly={readOnly}
                    eliminatedTeamIds={elims}
                    comparisonPicks={comparisonPicks}
                />
            </div>
        </div>
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ), [tournament, picks, readOnly, elims]);

    return (
        <div
            id="bracket-printable-area"
            className="w-full overflow-x-auto overflow-y-hidden bg-[#0b1421] rounded-lg"
            style={{ minHeight: 600 }}
        >
            <div className="p-4 w-fit mx-auto">
                {bracketContent}
            </div>
        </div>
    );
};
