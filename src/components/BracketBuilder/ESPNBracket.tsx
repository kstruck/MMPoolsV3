/**
 * ESPNBracket.tsx — Full ESPN-style NCAA bracket with correct alignment.
 *
 * Alignment math (per region, 8 games per side):
 *   GAME_H  = 58px   (height of each matchup card)
 *   STEP_R1 = 66px   (top-to-top distance between R1 cards; 58 + 8px gap)
 *
 *   For round r (1..4):
 *     step(r)        = STEP_R1 × 2^(r-1)
 *     paddingTop(r)  = (step(r) - STEP_R1) / 2
 *     gap(r)         = step(r) - GAME_H
 *
 *   This guarantees each card in round r is vertically centered
 *   between its two feeder cards in round r-1.
 *
 * Layout:
 *   [EAST left→right] | [Final Four] | [WEST right→left]
 *   [SOUTH left→right]               [MIDWEST right→left]
 */

import React, { useMemo, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { TeamDataContext } from './teamDataContext';
import type { Tournament, Game } from '../../types';

import { getTeamLogo } from '../../constants';
import { Trophy, Check, X, Link, Printer } from 'lucide-react';

// ─── Constants ─────────────────────────────────────────────────────────────

const GAME_H = 68;   // px — height of each matchup card
const STEP_R1 = 78;  // px — top-to-top step between R1 cards (68 + 10px gap)
const COL_W = 172;   // px — width of each bracket column card
const COL_GAP = 10;  // px — gap between columns

/** Column configs for a left-to-right 8-team region (R1→R4) */
const COLS_LTR = [1, 2, 3, 4].map(r => ({
    round: r,
    paddingTop: (STEP_R1 * Math.pow(2, r - 1) - STEP_R1) / 2,
    gap: STEP_R1 * Math.pow(2, r - 1) - GAME_H,
    label: ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8'][r - 1],
}));

// Total height for one region stack = 8 games × step
const REGION_H = 8 * STEP_R1;

// TeamDataContext is now in teamDataContext.ts (shared with MatchNode)


// ─── Types ─────────────────────────────────────────────────────────────────

interface ESPNBracketProps {
    tournament: Tournament;
    picks: Record<string, string>;
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
    eliminatedTeamIds?: Set<string>;
    comparisonPicks?: Record<string, string>;
    // Optional entry stats for the header banner
    entryName?: string;
    entryScore?: number;
    maxPossibleScore?: number;
    rank?: number;
    totalEntries?: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
// homeTeamId is the full display name ("Duke Blue Devils"); seeds come from importedTeams.

// ─── Team Row ──────────────────────────────────────────────────────────────

interface TeamRowProps {
    teamId?: string;
    isPicked: boolean;
    pickStatus?: 'correct' | 'incorrect' | null;
    isWinner?: boolean;
    isEliminated?: boolean;
    onClick: () => void;
    disabled: boolean;
}

const TeamRow: React.FC<TeamRowProps> = ({
    teamId, isPicked, pickStatus, isWinner, isEliminated, onClick, disabled
}) => {
    const teamData = useContext(TeamDataContext);
    const team = teamId ? teamData[teamId] : null;
    const name = team?.name ?? teamId ?? 'TBD';
    const seed = team?.seed;
    const record = (team?.wins != null && team?.losses != null)
        ? `${team.wins}-${team.losses}` : null;
    const logo = teamId ? getTeamLogo(teamId, 'ncaa') : null;

    // ── Visual state derivation ──────────────────────────────────────────
    const isCorrectPick = pickStatus === 'correct';
    const isWrongPick   = pickStatus === 'incorrect';
    // A team that lost and was NOT this slot's pick
    const isEliminatedUnpicked = isEliminated && !isPicked;

    let bg = 'hover:bg-slate-800/80 text-slate-300';
    if (isCorrectPick)    bg = 'bg-emerald-500/25 text-emerald-100';
    else if (isWrongPick) bg = 'bg-red-500/20 text-red-300';
    else if (isPicked)    bg = 'bg-amber-500/20 text-amber-100';  // pending pick
    else if (isWinner)    bg = 'bg-emerald-500/10 text-slate-200'; // actual winner, not picked
    else if (isEliminatedUnpicked) bg = 'text-slate-600';

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                w-full flex items-center h-[34px] px-1.5 gap-1.5 text-left transition-all relative
                ${bg}
                ${disabled ? 'cursor-default' : 'cursor-pointer'}
                ${isEliminatedUnpicked ? 'opacity-35' : ''}
            `}
        >
            {/* Seed number */}
            <span className={`
                text-[11px] font-black w-[20px] text-center flex-shrink-0 leading-none
                ${seed != null
                    ? isCorrectPick ? 'text-emerald-300'
                    : isWrongPick   ? 'text-red-400'
                    : isPicked      ? 'text-amber-300'
                    : 'text-slate-500'
                    : 'invisible'
                }
            `}>
                {seed != null ? seed : ''}
            </span>

            {/* Logo */}
            {logo ? (
                <img
                    src={logo}
                    alt=""
                    className={`w-[14px] h-[14px] object-contain flex-shrink-0 ${
                        isEliminatedUnpicked ? 'grayscale opacity-50' :
                        isWrongPick          ? 'grayscale opacity-60' : ''
                    }`}
                    crossOrigin="anonymous"
                />
            ) : (
                <span className="w-[14px] h-[14px] flex-shrink-0" />
            )}

            {/* Team name */}
            <span className={`
                text-[11px] font-semibold truncate flex-1 tracking-tight leading-none
                ${!teamId ? 'italic opacity-30' : ''}
                ${isEliminatedUnpicked ? 'line-through decoration-red-600/80 decoration-[1.5px]' : ''}
                ${isWrongPick          ? 'line-through decoration-red-500 decoration-[1.5px]' : ''}
            `}>
                {teamId ? name : 'TBD'}
            </span>

            {/* Win-loss record */}
            {record && !isEliminatedUnpicked && !isWrongPick && (
                <span className={`text-[9px] flex-shrink-0 leading-none ${
                    isPicked ? 'text-amber-300/70' : 'text-slate-600'
                }`}>
                    {record}
                </span>
            )}

            {/* Status icon badges */}
            {isCorrectPick && (
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                </span>
            )}
            {isWrongPick && (
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-red-500/80 flex items-center justify-center">
                    <X className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                </span>
            )}
            {isWinner && !isPicked && !pickStatus && (
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-emerald-600/50 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-emerald-200" strokeWidth={3} />
                </span>
            )}
            {isPicked && !pickStatus && !isEliminated && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            )}

            {/* Left accent bar */}
            {isCorrectPick && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-emerald-400" />}
            {isWrongPick   && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-red-500" />}
            {isPicked && !pickStatus && !isEliminated && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-400" />}
            {isWinner && !isPicked && !pickStatus && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-emerald-600" />}
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
}

const MatchupCard: React.FC<MatchupCardProps> = ({
    game, homeTeamId, awayTeamId, picks, onPick, readOnly, eliminatedTeamIds
}) => {
    const style: React.CSSProperties = {
        width: COL_W,
        height: GAME_H,
        minHeight: GAME_H,
        maxHeight: GAME_H,
    };

    if (!game) {
        return (
            <div
                className="border border-slate-800/50 rounded-sm bg-slate-900/20 flex flex-col overflow-hidden opacity-30 flex-shrink-0"
                style={style}
            >
                <div style={{ height: 28 }} />
                <div className="border-t border-slate-800/50 mx-2" />
                <div style={{ height: 28 }} />
            </div>
        );
    }

    const picked = picks[game.id];
    const isFinal = game.status === 'FINAL';
    const isInProgress = game.status === 'IN_PROGRESS';
    const isHomeWinner = isFinal && game.winnerTeamId === homeTeamId;
    const isAwayWinner = isFinal && game.winnerTeamId === awayTeamId;

    const getPickStatus = (tid?: string): 'correct' | 'incorrect' | null => {
        if (!tid || !picked || tid !== picked || !isFinal) return null;
        return game.winnerTeamId === tid ? 'correct' : 'incorrect';
    };

    // Did the user pick the winner correctly?
    const isCorrectGame = isFinal && picked && game.winnerTeamId === picked;
    // Did the user pick the loser?
    const isWrongGame   = isFinal && picked && game.winnerTeamId && game.winnerTeamId !== picked;

    // Card border: green glow = correct pick, red tint = wrong pick, subtle pulse if live
    let cardBorder = 'border-slate-700/70 hover:border-slate-600/80';
    if (isCorrectGame) cardBorder = 'border-emerald-500/80 shadow-emerald-500/20 shadow-md';
    else if (isWrongGame) cardBorder = 'border-red-500/40';
    else if (isInProgress) cardBorder = 'border-amber-500/50';

    return (
        <div
            className={`flex flex-col border rounded-sm bg-[#111b2e] overflow-hidden flex-shrink-0 transition-all relative ${cardBorder}`}
            style={style}
        >
            {/* Green glow overlay for correct picks */}
            {isCorrectGame && (
                <div className="absolute inset-0 pointer-events-none rounded-sm"
                    style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.03) 100%)' }}
                />
            )}

            {/* FINAL / LIVE badge — sits in divider space */}
            {isFinal && (
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10">
                    <span className="text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700/50">
                        FINAL
                    </span>
                </div>
            )}
            {isInProgress && (
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10">
                    <span className="text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse">
                        LIVE
                    </span>
                </div>
            )}

            <TeamRow
                teamId={homeTeamId}
                isPicked={picked === homeTeamId}
                pickStatus={getPickStatus(homeTeamId)}
                isWinner={isHomeWinner}
                isEliminated={homeTeamId ? eliminatedTeamIds?.has(homeTeamId) : false}
                onClick={() => !readOnly && homeTeamId && onPick(game.id, homeTeamId)}
                disabled={!!(readOnly || !homeTeamId)}
            />
            <div className={`border-t mx-2 flex-shrink-0 ${
                isCorrectGame ? 'border-emerald-500/30' :
                isWrongGame   ? 'border-red-500/20' :
                                'border-slate-700/40'
            }`} />
            <TeamRow
                teamId={awayTeamId}
                isPicked={picked === awayTeamId}
                pickStatus={getPickStatus(awayTeamId)}
                isWinner={isAwayWinner}
                isEliminated={awayTeamId ? eliminatedTeamIds?.has(awayTeamId) : false}
                onClick={() => !readOnly && awayTeamId && onPick(game.id, awayTeamId)}
                disabled={!!(readOnly || !awayTeamId)}
            />
        </div>
    );
};

// ─── Bracket Column ────────────────────────────────────────────────────────

interface BracketColumnProps {
    games: (Game | undefined)[];
    round: number;
    label: string;
    gap: number;
    picks: Record<string, string>;
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
    eliminatedTeamIds?: Set<string>;
    /** For rounds > 1: participant IDs derived from previous picks */
    overrideHome: (string | undefined)[];
    overrideAway: (string | undefined)[];
}

const BracketColumn: React.FC<BracketColumnProps> = ({
    games, label, gap, picks, onPick, readOnly, eliminatedTeamIds,
    overrideHome, overrideAway
}) => (
    <div className="flex flex-col flex-shrink-0" style={{ width: COL_W, gap }}>
        {games.map((game, i) => {
            const homeId = overrideHome[i] ?? game?.homeTeamId;
            const awayId = overrideAway[i] ?? game?.awayTeamId;
            return (
                <MatchupCard
                    key={game?.id ?? `ph-${label}-${i}`}
                    game={game}
                    homeTeamId={homeId}
                    awayTeamId={awayId}
                    picks={picks}
                    onPick={onPick}
                    readOnly={readOnly}
                    eliminatedTeamIds={eliminatedTeamIds}
                />
            );
        })}
    </div>
);

// ─── Region Panel ──────────────────────────────────────────────────────────

const REGION_COLORS: Record<string, string> = {
    East: '#60a5fa',
    West: '#fb923c',
    South: '#4ade80',
    Midwest: '#c084fc',
};

interface RegionPanelProps extends ESPNBracketProps {
    region: string;
    align: 'left' | 'right';
}

const RegionPanel: React.FC<RegionPanelProps> = ({
    region, align, tournament, picks, onPick, readOnly, eliminatedTeamIds
}) => {
    const color = REGION_COLORS[region] ?? '#60a5fa';
    const elims = eliminatedTeamIds ?? new Set<string>();

    const getGames = (round: number): (Game | undefined)[] => {
        const games = Object.values(tournament.games)
            .filter(g => g.region === region && g.round === round)
            .sort((a, b) => a.id.localeCompare(b.id)); // Game IDs encode slot (R1-East-1, R1-East-2…)
        // Pad to expected count
        const expected = 8 / Math.pow(2, round - 1);
        while (games.length < expected) games.push(undefined as unknown as Game);
        return games as (Game | undefined)[];
    };

    const r1 = getGames(1); // 8 games
    const r2 = getGames(2); // 4 games
    const r3 = getGames(3); // 2 games
    const r4 = getGames(4); // 1 game

    // Dynamic participant overrides: winners from previous round picks
    const r1None = r1.map(() => undefined);
    const r2Home = r2.map((_, i) => picks[r1[i * 2]?.id ?? ''] ?? undefined);
    const r2Away = r2.map((_, i) => picks[r1[i * 2 + 1]?.id ?? ''] ?? undefined);
    const r3Home = r3.map((_, i) => picks[r2[i * 2]?.id ?? ''] ?? undefined);
    const r3Away = r3.map((_, i) => picks[r2[i * 2 + 1]?.id ?? ''] ?? undefined);
    const r4Home = [picks[r3[0]?.id ?? ''] ?? undefined];
    const r4Away = [picks[r3[1]?.id ?? ''] ?? undefined];

    const cols = [
        { ...COLS_LTR[0], games: r1, oh: r1None, oa: r1None },
        { ...COLS_LTR[1], games: r2, oh: r2Home, oa: r2Away },
        { ...COLS_LTR[2], games: r3, oh: r3Home, oa: r3Away },
        { ...COLS_LTR[3], games: r4, oh: r4Home, oa: r4Away },
    ];

    const orderedCols = align === 'right' ? [...cols].reverse() : cols;

    return (
        <div className="flex flex-col flex-shrink-0">
            {/* Region name */}
            <div
                className="text-center text-[11px] font-black uppercase tracking-[0.18em] mb-1.5 pb-1"
                style={{ color, borderBottom: `2px solid ${color}25` }}
            >
                {region}
            </div>

            {/* Round labels */}
            <div className="flex mb-1" style={{ gap: COL_GAP }}>
                {orderedCols.map((c, i) => (
                    <div
                        key={i}
                        className="text-center text-[8px] font-bold text-slate-600 uppercase tracking-widest"
                        style={{ width: COL_W, flexShrink: 0 }}
                    >
                        {c.label}
                    </div>
                ))}
            </div>

            {/* Bracket columns */}
            <div className="flex" style={{ gap: COL_GAP, height: REGION_H }}>
                {orderedCols.map((c, i) => (
                    <div
                        key={i}
                        className="flex flex-col flex-shrink-0"
                        style={{ paddingTop: c.paddingTop, width: COL_W }}
                    >
                        <BracketColumn
                            games={c.games as (Game | undefined)[]}
                            round={c.round}
                            label={c.label}
                            gap={c.gap}
                            picks={picks}
                            onPick={onPick}
                            readOnly={readOnly}
                            eliminatedTeamIds={elims}
                            overrideHome={c.oh}
                            overrideAway={c.oa}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── Champion Pick Banner ──────────────────────────────────────────────────

interface ChampionBannerProps {
    picks: Record<string, string>;
    champGameId?: string;
}

const ChampionBanner: React.FC<ChampionBannerProps> = ({ picks, champGameId }) => {
    const teamData = useContext(TeamDataContext);
    const champPick = champGameId ? picks[champGameId] : undefined;
    const champion = champPick ? teamData[champPick] : null;
    const champName = champion?.name ?? champPick ?? null;
    const champLogo = champPick ? getTeamLogo(champPick, 'ncaa') : null;

    if (!champPick) {
        return (
            <div className="mt-3 mb-1 flex flex-col items-center gap-1.5 w-[160px]">
                <div className="w-[2px] h-5 bg-amber-500/20" />
                <div className="rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 px-3 py-2 flex flex-col items-center gap-1 w-full">
                    <Trophy className="w-5 h-5 text-amber-500/50" />
                    <div className="text-[9px] text-amber-400/70 uppercase tracking-widest font-bold text-center">
                        Pick Your Champion
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mt-3 mb-1 flex flex-col items-center gap-1 w-[160px]">
            {/* Connector line */}
            <div className="w-[2px] h-5 bg-amber-500/40" />

            {/* Banner card */}
            <div
                className="relative w-full rounded-xl overflow-hidden border border-amber-500/50 shadow-lg shadow-amber-500/20"
                style={{ background: 'linear-gradient(145deg, #1a2f4a 0%, #0e1929 60%, #1a2f4a 100%)' }}
            >
                {/* Gold accent top bar */}
                <div className="h-[3px] w-full bg-gradient-to-r from-amber-600 via-amber-400 to-amber-600" />

                <div className="flex flex-col items-center px-2 py-3 gap-2">
                    {/* MY CHAMPIONSHIP PICK label */}
                    <div className="text-[8px] font-black text-amber-400 uppercase tracking-[0.2em] text-center leading-none">
                        My Championship Pick
                    </div>

                    {/* Team logo */}
                    <div className="relative">
                        {champLogo ? (
                            <img
                                src={champLogo}
                                alt={champName ?? ''}
                                className="w-12 h-12 object-contain drop-shadow-lg"
                                crossOrigin="anonymous"
                            />
                        ) : (
                            <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
                                <Trophy className="w-6 h-6 text-amber-400" />
                            </div>
                        )}
                        {/* Glow ring */}
                        <div className="absolute inset-0 rounded-full ring-2 ring-amber-400/30 pointer-events-none" />
                    </div>

                    {/* Team name */}
                    <div className="text-[11px] font-black text-white text-center leading-tight tracking-tight line-clamp-2">
                        {champName}
                    </div>
                </div>

                {/* Gold accent bottom bar */}
                <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
            </div>
        </div>
    );
};

// ─── Final Four Center ─────────────────────────────────────────────────────

const FinalFourCenter: React.FC<ESPNBracketProps> = ({
    tournament, picks, onPick, readOnly, eliminatedTeamIds
}) => {
    const ffGames = Object.values(tournament.games)
        .filter(g => g.round === 5)
        .sort((a, b) => a.id.localeCompare(b.id));
    const champGame = Object.values(tournament.games).find(g => g.round === 6);

    const getRegChamp = (region: string) => {
        const g = Object.values(tournament.games).find(g2 => g2.region === region && g2.round === 4);
        return g ? picks[g.id] : undefined;
    };

    const eastChamp    = getRegChamp('East');
    const westChamp    = getRegChamp('West');
    const southChamp   = getRegChamp('South');
    const midwestChamp = getRegChamp('Midwest');

    // South bracket (top): East vs West — but historically depends on bracket year.
    // We'll do: top FF = East vs South (left-side champs), bottom FF = West vs Midwest (right-side)
    // Actually NCAA: East vs West, South vs Midwest for the classic arrangement.
    const ff1 = ffGames[0]; // East vs West (or just first FF game)
    const ff2 = ffGames[1]; // South vs Midwest

    const champHome = ff1 ? picks[ff1.id] : undefined;
    const champAway = ff2 ? picks[ff2.id] : undefined;

    const elims = eliminatedTeamIds ?? new Set<string>();

    // Center the FF panel vertically relative to the total region height (2 regions + gap)
    // Total available height = 2 × REGION_H + label/header space ≈ 1140px
    // FF panel: 2 games + champ + trophy = ~350px
    // We just let flexbox center it

    return (
        <div
            className="flex flex-col items-center justify-center flex-shrink-0"
            style={{ width: 160 }}
        >
            {/* Final Four label */}
            <div className="text-[9px] font-bold text-amber-400 uppercase tracking-[0.18em] mb-2 text-center">
                Final Four
            </div>

            {/* FF Game 1 */}
            <div className="text-[8px] text-slate-600 uppercase tracking-widest mb-1 text-center">
                East vs West
            </div>
            <MatchupCard
                game={ff1}
                homeTeamId={eastChamp}
                awayTeamId={westChamp}
                picks={picks}
                onPick={onPick}
                readOnly={readOnly}
                eliminatedTeamIds={elims}
            />

            {/* Spacer */}
            <div className="my-3 flex flex-col items-center">
                <div className="w-px h-3 bg-amber-600/30" />
            </div>

            {/* Championship */}
            <div className="text-[9px] font-bold text-amber-500 uppercase tracking-[0.12em] mb-1 text-center">
                National Championship
            </div>
            <div className="relative">
                <div className="absolute -inset-[2px] rounded bg-amber-500/5 border border-amber-500/25 pointer-events-none" />
                <MatchupCard
                    game={champGame}
                    homeTeamId={champHome}
                    awayTeamId={champAway}
                    picks={picks}
                    onPick={onPick}
                    readOnly={readOnly}
                    eliminatedTeamIds={elims}
                />
            </div>

            {/* ESPN-Style Champion Pick Banner */}
            <ChampionBanner picks={picks} champGameId={champGame?.id} />

            {/* Spacer */}
            <div className="my-4 flex flex-col items-center">
                <div className="w-px h-4 bg-amber-600/30" />
            </div>

            {/* FF Game 2 */}
            <div className="text-[8px] text-slate-600 uppercase tracking-widest mb-1 text-center">
                South vs Midwest
            </div>
            <MatchupCard
                game={ff2}
                homeTeamId={southChamp}
                awayTeamId={midwestChamp}
                picks={picks}
                onPick={onPick}
                readOnly={readOnly}
                eliminatedTeamIds={elims}
            />
        </div>
    );
};

// ─── ESPN Stats Header ──────────────────────────────────────────────────────




// ─── Donut Chart — 3 segments: earned / unplayed / lost ───────────────────
interface DonutProps { earned: number; unplayed: number; max: number; size?: number; }
const DonutChart: React.FC<DonutProps> = ({ earned, unplayed, max, size = 90 }) => {
    const r = (size - 14) / 2;
    const circ = 2 * Math.PI * r;
    const earnedPct   = max > 0 ? Math.min(earned / max, 1)  : 0;
    const unplayedPct = max > 0 ? Math.min(unplayed / max, 1 - earnedPct) : 0;
    const lostPct     = Math.max(0, 1 - earnedPct - unplayedPct);
    const earnedDash   = circ * earnedPct;
    const unplayedDash = circ * unplayedPct;
    const lostDash     = circ * lostPct;
    const cx = size / 2, cy = size / 2;
    // offsets start at top of circle (rotate back by 25% of circumference)
    const startOffset  = circ * 0.25;
    const unplayedOff  = -(circ * earnedPct)   + startOffset;
    const lostOff      = -(circ * (earnedPct + unplayedPct)) + startOffset;
    return (
        <svg width={size} height={size}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={11} />
            {lostPct > 0.001 && (
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ef4444" strokeWidth={11}
                    strokeDasharray={`${lostDash} ${circ - lostDash}`}
                    strokeDashoffset={lostOff} strokeLinecap="butt" />
            )}
            {unplayedPct > 0.001 && (
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#475569" strokeWidth={11}
                    strokeDasharray={`${unplayedDash} ${circ - unplayedDash}`}
                    strokeDashoffset={unplayedOff} strokeLinecap="butt" />
            )}
            {earnedPct > 0.001 && (
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#22c55e" strokeWidth={11}
                    strokeDasharray={`${earnedDash} ${circ - earnedDash}`}
                    strokeDashoffset={startOffset} strokeLinecap="butt" />
            )}
        </svg>
    );
};

interface StatsHeaderProps {
    tournament: Tournament;
    picks: Record<string, string>;
    entryName?: string;
    entryScore?: number;
    maxPossibleScore?: number;
    rank?: number;
    totalEntries?: number;
    pickCount: number;
    totalPicks: number;
}

const StatsHeader: React.FC<StatsHeaderProps> = ({
    tournament, picks, entryName, entryScore = 0, maxPossibleScore,
    rank, totalEntries, pickCount, totalPicks
}) => {
    const champGame = Object.values(tournament.games).find(g => g.round === 6);
    const champPick = champGame ? picks[champGame.id] : undefined;
    const teamData = useContext(TeamDataContext);
    const champName = champPick ? (teamData[champPick]?.name ?? champPick) : 'No Champion Picked';
    const champLogo = champPick ? getTeamLogo(champPick, 'ncaa') : null;

    // Fibonacci [2,3,5,8,13,21]: 32×2+16×3+8×5+4×8+2×13+1×21 = 231
    const maxPts = maxPossibleScore ?? 231;
    const pct = totalEntries && rank ? Math.round(((totalEntries - rank) / totalEntries) * 100) : null;
    const unplayed = Math.max(0, maxPts - entryScore);

    const copyLink = useCallback(() => {
        navigator.clipboard.writeText(window.location.href)
            .then(() => alert('Link copied!'))
            .catch(() => {});
    }, []);
    const printBracket = useCallback(() => window.print(), []);

    return (
        <div className="bg-[#0d1b2a] border-b-2 border-slate-700/50 px-6 py-5 shadow-xl">
            <div className="max-w-screen-xl mx-auto flex items-center gap-8 flex-wrap">

                {/* Champion logo + entry name */}
                <div className="flex items-center gap-4">
                    <div className="w-[72px] h-[72px] rounded-xl bg-slate-800 flex items-center justify-center ring-2 ring-slate-600 overflow-hidden flex-shrink-0">
                        {champLogo
                            ? <img src={champLogo} alt={champName} className="w-14 h-14 object-contain" crossOrigin="anonymous" />
                            : <Trophy className="w-8 h-8 text-amber-400" />}
                    </div>
                    <div>
                        {entryName && <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">{entryName}</div>}
                        <div className="text-xl font-black text-white leading-tight">{champName}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Champion Pick</div>
                    </div>
                </div>

                <div className="w-px h-14 bg-slate-700 hidden sm:block" />

                {/* RANK / PCT / PTS */}
                <div className="flex items-center gap-8">
                    <div className="text-center">
                        <div className="text-4xl font-black text-white leading-none">{rank ?? '--'}</div>
                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-2">Rank</div>
                    </div>
                    <div className="text-center">
                        <div className="text-4xl font-black text-white leading-none">{pct !== null ? `${pct}%` : '--'}</div>
                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-2">PCT</div>
                    </div>
                    <div className="text-center">
                        <div className="text-4xl font-black text-emerald-400 leading-none">{entryScore}</div>
                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-2">PTS</div>
                    </div>
                </div>

                <div className="w-px h-14 bg-slate-700 hidden lg:block" />

                {/* Donut + legend */}
                <div className="items-center gap-5 hidden lg:flex">
                    <div className="relative">
                        <DonutChart earned={entryScore} unplayed={unplayed} max={maxPts} size={90} />
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <div className="text-[16px] font-black text-white leading-none">{entryScore}</div>
                            <div className="text-[9px] text-slate-400 font-bold leading-none mt-0.5">{maxPts} MAX</div>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-emerald-500" /><span className="text-xs text-slate-300 font-medium">Points Gained</span></div>
                        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-slate-500" /><span className="text-xs text-slate-300 font-medium">Points Unplayed</span></div>
                        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-red-500" /><span className="text-xs text-slate-300 font-medium">Points Lost</span></div>
                    </div>
                </div>

                {/* Picks bar + buttons */}
                <div className="flex flex-col gap-3 ml-auto">
                    <div className="hidden md:block w-48">
                        <div className="flex justify-between text-[11px] text-slate-500 mb-1.5">
                            <span>{pickCount}/{totalPicks} Picks Made</span>
                            <span>{totalPicks > 0 ? Math.round((pickCount / totalPicks) * 100) : 0}%</span>
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                style={{ width: `${totalPicks > 0 ? (pickCount / totalPicks) * 100 : 0}%` }} />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={copyLink}
                            className="flex items-center gap-1.5 px-4 py-2 border border-slate-600 rounded-lg text-[12px] font-semibold text-slate-300 hover:text-white hover:border-slate-400 hover:bg-slate-800 transition-all">
                            <Link className="w-3.5 h-3.5" /> Copy Link
                        </button>
                        <button onClick={printBracket}
                            className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 rounded-lg text-[12px] font-semibold text-slate-300 hover:text-white hover:bg-slate-600 transition-all">
                            <Printer className="w-3.5 h-3.5" /> Print Bracket
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Main ESPN Bracket ─────────────────────────────────────────────────────


export const ESPNBracket: React.FC<ESPNBracketProps> = ({
    tournament, picks, onPick, readOnly, eliminatedTeamIds, comparisonPicks,
    entryName, entryScore, maxPossibleScore, rank, totalEntries,
}) => {
    // Picks progress counts
    const totalGames = Object.keys(tournament.games).length;
    const pickCount = Object.keys(picks).length;

    const regionProps = useMemo(() => ({
        tournament,
        picks,
        onPick,
        readOnly,
        eliminatedTeamIds: eliminatedTeamIds ?? new Set<string>(),
        comparisonPicks,
    }), [tournament, picks, onPick, readOnly, eliminatedTeamIds, comparisonPicks]);

    const importedTeams = tournament.importedTeams ?? {};

    // ── Adaptive zoom: fit the full bracket in the available space ───────────
    // Natural bracket width ≈ 1820px (4×4 region cols × 2 sides + FF center).
    // We scale it down so users never need to scroll horizontally.
    const containerRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const NATURAL_W = 4 * (COL_W + COL_GAP) * 2 + 2 * (COL_W + COL_GAP) + 60; // ~1820px

    useLayoutEffect(() => {
        const recalc = () => {
            const avail = containerRef.current?.clientWidth ?? window.innerWidth;
            setZoom(Math.min(1, Math.max(0.40, avail / NATURAL_W)));
        };
        recalc();
        const ro = new ResizeObserver(recalc);
        if (containerRef.current) ro.observe(containerRef.current);
        return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <TeamDataContext.Provider value={importedTeams}>
        <div id="bracket-printable-area" className="w-full bg-[#0b1421]">
            {/* Stats header — full width */}
            <StatsHeader
                tournament={tournament}
                picks={picks}
                entryName={entryName}
                entryScore={entryScore}
                maxPossibleScore={maxPossibleScore}
                rank={rank}
                totalEntries={totalEntries}
                pickCount={pickCount}
                totalPicks={totalGames}
            />

            {/* Bracket canvas — zoom scales to fit, no horizontal scrollbar */}
            <div ref={containerRef} className="w-full overflow-hidden">
                <div style={{ zoom }} className="py-4 px-2 w-fit min-w-max mx-auto">
                    <div className="flex items-center gap-3">
                        {/* LEFT: East (top) + South (bottom) */}
                        <div className="flex flex-col gap-4">
                            <RegionPanel {...regionProps} region="East" align="left" />
                            <RegionPanel {...regionProps} region="South" align="left" />
                        </div>

                        {/* CENTER: Final Four */}
                        <FinalFourCenter {...regionProps} />

                        {/* RIGHT: West (top) + Midwest (bottom) */}
                        <div className="flex flex-col gap-4">
                            <RegionPanel {...regionProps} region="West" align="right" />
                            <RegionPanel {...regionProps} region="Midwest" align="right" />
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="flex items-center justify-center gap-5 mt-4 pt-3 border-t border-slate-800/50">
                        <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm border border-emerald-500/80 bg-emerald-500/15" />
                            <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Correct Pick</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm border border-red-500/40 bg-red-500/10" />
                            <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Wrong Pick</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm border border-amber-500/50 bg-amber-500/10" />
                            <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Your Pick (Pending)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-3 h-1 bg-red-600/70" style={{ textDecoration: 'line-through' }} />
                            <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Eliminated</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </TeamDataContext.Provider>
    );
};
