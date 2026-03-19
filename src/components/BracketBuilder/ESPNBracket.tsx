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

import React, { useMemo, useCallback, createContext, useContext } from 'react';
import type { Tournament, Game, Team } from '../../types';
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

// ─── Team Data Context (avoids threading importedTeams through every prop) ────────────
const TeamDataContext = createContext<Record<string, Team>>({});

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
    // teamId IS the display name (e.g. "Duke Blue Devils") — look up extra data
    const team = teamId ? teamData[teamId] : null;
    const name = team?.name ?? teamId ?? 'TBD';
    const seed = team?.seed;
    const record = (team?.wins != null && team?.losses != null)
        ? `${team.wins}-${team.losses}` : null;
    const logo = teamId ? getTeamLogo(teamId, 'ncaa') : null;

    // Background / text color
    let bg = 'hover:bg-slate-800 text-slate-300';
    if (isPicked) {
        if (pickStatus === 'incorrect') bg = 'bg-red-500/20 text-red-200';
        else bg = 'bg-amber-600/90 text-white';
    } else if (isWinner) {
        bg = 'bg-emerald-500/10 text-slate-200';
    }

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                w-full flex items-center h-[34px] px-1.5 gap-1.5 text-left transition-colors relative
                ${bg}
                ${disabled ? 'cursor-default' : 'cursor-pointer'}
                ${isEliminated && !isPicked ? 'opacity-40' : ''}
            `}
        >
            {/* Seed number — from importedTeams */}
            <span className={`
                text-[11px] font-black w-[20px] text-center flex-shrink-0 leading-none
                ${seed ? (isPicked ? 'text-amber-200' : 'text-slate-400') : 'invisible'}
            `}>
                {seed ?? 0}
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

            {/* Team name */}
            <span className={`
                text-[11px] font-semibold truncate flex-1 tracking-tight leading-none
                ${!teamId ? 'italic opacity-30' : ''}
                ${isEliminated && !isPicked ? 'line-through decoration-red-500/50' : ''}
            `}>
                {teamId ? name : 'TBD'}
            </span>

            {/* Win-loss record */}
            {record && (
                <span className={`text-[9px] flex-shrink-0 leading-none ${
                    isPicked ? 'text-amber-200/80' : 'text-slate-600'
                }`}>
                    {record}
                </span>
            )}

            {/* Status icons */}
            {pickStatus === 'correct' && <Check className="w-3 h-3 text-white flex-shrink-0" />}
            {pickStatus === 'incorrect' && <X className="w-3 h-3 text-red-400 flex-shrink-0" />}
            {isWinner && !pickStatus && !isPicked && <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
            {isPicked && !pickStatus && !isEliminated && <span className="w-1.5 h-1.5 rounded-full bg-white/80 flex-shrink-0" />}

            {/* Left accent bar */}
            {isPicked && !pickStatus && (
                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-amber-400" />
            )}
            {pickStatus === 'correct' && (
                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-emerald-400" />
            )}
            {pickStatus === 'incorrect' && (
                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-red-500" />
            )}
            {isWinner && !isPicked && (
                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-emerald-500" />
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
    const isHomeWinner = isFinal && game.winnerTeamId === homeTeamId;
    const isAwayWinner = isFinal && game.winnerTeamId === awayTeamId;

    const getPickStatus = (tid?: string): 'correct' | 'incorrect' | null => {
        if (!tid || !picked || tid !== picked || !isFinal) return null;
        return game.winnerTeamId === tid ? 'correct' : 'incorrect';
    };

    return (
        <div
            className="flex flex-col border border-slate-700/70 rounded-sm bg-[#111b2e] overflow-hidden shadow-sm hover:border-slate-600/80 transition-colors flex-shrink-0"
            style={style}
        >
            <TeamRow
                teamId={homeTeamId}
                isPicked={picked === homeTeamId}
                pickStatus={getPickStatus(homeTeamId)}
                isWinner={isHomeWinner}
                isEliminated={homeTeamId ? eliminatedTeamIds?.has(homeTeamId) : false}
                onClick={() => !readOnly && homeTeamId && onPick(game.id, homeTeamId)}
                disabled={!!(readOnly || !homeTeamId)}
            />
            <div className="border-t border-slate-700/40 mx-2 flex-shrink-0" />
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
    const totalGames = Object.keys(tournament.games).length;
    const totalPicks = Object.keys(picks).length;
    const pct = totalGames > 0 ? Math.round((totalPicks / totalGames) * 100) : 0;

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
            <div className="my-4 flex flex-col items-center">
                <div className="w-px h-4 bg-amber-600/30" />
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

            {/* Trophy */}
            <div className="mt-4 flex flex-col items-center gap-1">
                <Trophy className="w-5 h-5 text-amber-500/70" />
                <div className="text-[9px] text-slate-600">{pct}% picks</div>
            </div>

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

const ProgressRing: React.FC<{ value: number; max: number; size?: number }> = ({ value, max, size = 64 }) => {
    const r = (size - 8) / 2;
    const circ = 2 * Math.PI * r;
    const pct = max > 0 ? Math.min(value / max, 1) : 0;
    const dash = pct * circ;
    return (
        <svg width={size} height={size} className="-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={6} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f97316" strokeWidth={6}
                strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.5s ease' }}
            />
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
    // Find championship pick
    const champGame = Object.values(tournament.games).find(g => g.round === 6);
    const champPick = champGame ? picks[champGame.id] : undefined;
    // teamId IS the display name, so champPick is already the display name
    const teamData = useContext(TeamDataContext);
    const champName = champPick ? (teamData[champPick]?.name ?? champPick) : 'No pick';
    const champLogo = champPick ? getTeamLogo(champPick, 'ncaa') : null;

    // Calculated max (simple: 63 games × average points)
    const maxPts = maxPossibleScore ?? 192; // R1=10, R2=20, R3=40, R4=80, R5=160, R6=320
    const pct = totalEntries && rank ? Math.round(((totalEntries - rank) / totalEntries) * 100) : null;

    const copyLink = useCallback(() => {
        navigator.clipboard.writeText(window.location.href)
            .then(() => alert('Link copied!'))
            .catch(() => {});
    }, []);

    const printBracket = useCallback(() => window.print(), []);

    return (
        <div className="bg-[#0e1929] border-b border-slate-800 px-4 py-3">
            <div className="max-w-screen-xl mx-auto flex flex-wrap items-center gap-4">

                {/* Champion pick */}
                <div className="flex items-center gap-3 min-w-[160px]">
                    {champLogo ? (
                        <img src={champLogo} alt={champName} className="w-12 h-12 object-contain" crossOrigin="anonymous" />
                    ) : (
                        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                            <Trophy className="w-6 h-6 text-amber-500" />
                        </div>
                    )}
                    <div>
                        {entryName && <div className="text-[11px] text-slate-500 leading-none mb-0.5">{entryName}</div>}
                        <div className="text-xs font-bold text-white">{champPick ? champName : 'No Champion Picked'}</div>
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">Champion Pick</div>
                    </div>
                </div>

                {/* Divider */}
                <div className="w-px h-10 bg-slate-800 hidden sm:block" />

                {/* Rank / PCT / Pts */}
                <div className="flex items-center gap-5">
                    <div className="text-center">
                        <div className="text-lg font-black text-white leading-none">{rank ?? '--'}</div>
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">Rank</div>
                    </div>
                    <div className="text-center">
                        <div className="text-lg font-black text-white leading-none">{pct !== null ? `${pct}%` : '--'}</div>
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">PCT</div>
                    </div>
                    <div className="text-center">
                        <div className="text-lg font-black text-amber-400 leading-none">{entryScore}</div>
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">PTS</div>
                    </div>
                </div>

                {/* Picks progress bar */}
                <div className="flex-1 hidden md:block">
                    <div className="flex items-center justify-between text-[9px] text-slate-500 mb-1">
                        <span>{pickCount}/{totalPicks} Picks Made</span>
                        <span>{totalPicks > 0 ? Math.round((pickCount / totalPicks) * 100) : 0}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-amber-500 transition-all duration-500 rounded-full"
                            style={{ width: `${totalPicks > 0 ? (pickCount / totalPicks) * 100 : 0}%` }}
                        />
                    </div>
                </div>

                {/* Progress ring */}
                <div className="flex items-center gap-2 hidden lg:flex">
                    <div className="relative">
                        <ProgressRing value={entryScore} max={maxPts} size={60} />
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <div className="text-[10px] font-bold text-white leading-none">{entryScore}</div>
                            <div className="text-[7px] text-slate-500 leading-none">{maxPts} MAX</div>
                        </div>
                    </div>
                    <div className="text-[9px] text-slate-500 space-y-0.5">
                        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Points Gained</div>
                        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-700 inline-block" />Points Unplayed</div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-auto">
                    <button
                        onClick={copyLink}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-700 rounded text-[11px] font-medium text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
                    >
                        <Link className="w-3 h-3" /> Copy Link
                    </button>
                    <button
                        onClick={printBracket}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 rounded text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                        <Printer className="w-3 h-3" /> Print Bracket
                    </button>
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

            {/* Bracket canvas — scrollable horizontally, full size for readability */}
            <div className="w-full overflow-x-auto">
                <div className="py-4 px-2 w-fit min-w-max">
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
                </div>
            </div>
        </div>
        </TeamDataContext.Provider>
    );
};
