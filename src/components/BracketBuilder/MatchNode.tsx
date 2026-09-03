import React, { useContext } from 'react';
import type { Game } from '../../types';
import { getTeamLogo } from '../../constants';
import { Check, X } from 'lucide-react';
import { TeamDataContext } from './teamDataContext';

/** Extract numeric seed from team ID like "E1-Duke" → 1, "W16-FAMU" → 16 */
function extractSeedFromId(teamId?: string): number | undefined {
    if (!teamId) return undefined;
    const m = teamId.match(/^[A-Z]+?(\d+)-/);
    return m ? parseInt(m[1], 10) : undefined;
}

interface MatchNodeProps {
    game?: Game;
    picks: Record<string, string>;
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
    isChampionship?: boolean;
    homeTeamIdOverride?: string;
    awayTeamIdOverride?: string;
    dynamicParticipants?: boolean;
    eliminatedTeamIds?: Set<string>;
    comparisonPicks?: Record<string, string>;
}

export const MatchNode: React.FC<MatchNodeProps> = ({ game, picks, onPick, readOnly, isChampionship, homeTeamIdOverride, awayTeamIdOverride, dynamicParticipants, eliminatedTeamIds, comparisonPicks }) => {
    const teamCtx = useContext(TeamDataContext);
    // If no game yet (e.g. waiting for previous round), show placeholder
    if (!game) {
        return (
            <div className={`flex flex-col border border-line bg-card rounded overflow-hidden w-40 opacity-50 ${isChampionship ? 'scale-110' : ''}`}>
                <div className="h-8 border-b border-line" />
                <div className="h-8" />
            </div>
        );
    }

    // Use overrides if provided. 
    // If dynamicParticipants is true, we ONLY use overrides/picks and do NOT fallback to game data.
    // This prevents showing "TBD" or pre-filled teams in later rounds before they are known.
    const displayHomeId = dynamicParticipants ? homeTeamIdOverride : (homeTeamIdOverride ?? game.homeTeamId);
    const displayAwayId = dynamicParticipants ? awayTeamIdOverride : (awayTeamIdOverride ?? game.awayTeamId);

    const pickedTeamId = picks[game.id];
    const isHomePicked = pickedTeamId === displayHomeId;
    const isAwayPicked = pickedTeamId === displayAwayId;

    const isFinal = game.status === 'FINAL';
    const isHomeWinner = isFinal && game.winnerTeamId === displayHomeId;
    const isAwayWinner = isFinal && game.winnerTeamId === displayAwayId;

    const getPickStatus = (teamId?: string) => {
        if (!teamId || !pickedTeamId || teamId !== pickedTeamId) return null;
        if (!isFinal) return null;
        return game.winnerTeamId === teamId ? 'correct' : 'incorrect';
    };

    const diffStatus = (comparisonPicks && game && pickedTeamId) ? (pickedTeamId === comparisonPicks[game.id] ? 'same' : 'diff') : null;

    // Make nodes slightly narrower if we are in comparison mode to fit two brackets better
    const nodeWidth = comparisonPicks ? 'w-32 sm:w-36' : 'w-40';

    return (
        <div className={`flex flex-col border border-line bg-card rounded overflow-hidden ${nodeWidth} shadow-sm transition ${isChampionship ? 'scale-110 border-gold-500/60 shadow-[0_2px_8px_rgba(140,109,51,0.2)]' : 'hover:border-gold-500/50'} ${diffStatus ? 'z-10' : ''}`}>
            <TeamSlot
                teamId={displayHomeId}
                seed={extractSeedFromId(displayHomeId) ?? teamCtx[displayHomeId ?? '']?.seed}
                isPicked={isHomePicked}
                pickStatus={getPickStatus(displayHomeId)}
                isWinner={isHomeWinner}
                logoUrl={displayHomeId ? getTeamLogo(displayHomeId, 'ncaa') : null}
                onClick={() => !readOnly && displayHomeId && onPick(game.id, displayHomeId)}
                disabled={readOnly || !displayHomeId}
                isEliminated={displayHomeId ? eliminatedTeamIds?.has(displayHomeId) : false}
                diffStatus={isHomePicked ? diffStatus : null}
            />
            <div className="border-t border-line relative"></div>
            <TeamSlot
                teamId={displayAwayId}
                seed={extractSeedFromId(displayAwayId) ?? teamCtx[displayAwayId ?? '']?.seed}
                isPicked={isAwayPicked}
                pickStatus={getPickStatus(displayAwayId)}
                isWinner={isAwayWinner}
                logoUrl={displayAwayId ? getTeamLogo(displayAwayId, 'ncaa') : null}
                onClick={() => !readOnly && displayAwayId && onPick(game.id, displayAwayId)}
                disabled={readOnly || !displayAwayId}
                isEliminated={displayAwayId ? eliminatedTeamIds?.has(displayAwayId) : false}
                diffStatus={isAwayPicked ? diffStatus : null}
            />
        </div>
    );
};

interface TeamSlotProps {
    teamId?: string;
    seed?: number;
    isPicked: boolean;
    pickStatus?: 'correct' | 'incorrect' | null;
    isWinner?: boolean;
    logoUrl?: string | null;
    onClick: () => void;
    disabled?: boolean;
    isEliminated?: boolean;
    diffStatus?: 'same' | 'diff' | null;
}

const TeamSlot: React.FC<TeamSlotProps> = ({ teamId, seed, isPicked, pickStatus, isWinner, logoUrl, onClick, disabled, isEliminated, diffStatus }) => {
    // Extract team name from ID (e.g., "E1-Duke" -> "Duke")
    // Assuming format RegionSeed-Name or just Name
    let teamName = 'TBD';
    if (teamId) {
        // Try splitting by hyphen if there is one (e.g., S1-Houston -> Houston)
        // If no hyphen, use the whole ID (e.g. KC -> KC)
        const parts = teamId.split('-');
        teamName = parts.length > 1 ? parts.slice(1).join('-') : parts[0];
        // Clean up camelCase if needed
        teamName = teamName.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    }

    const ariaState = [
        seed ? `${seed} seed` : null,
        isPicked ? 'your pick' : null,
        pickStatus === 'correct' ? 'correct' : pickStatus === 'incorrect' ? 'incorrect' : null,
        isWinner ? 'won this game' : null,
        isEliminated ? 'eliminated' : null,
    ].filter(Boolean).join(', ');

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            aria-label={teamId ? `${teamName}${ariaState ? ` — ${ariaState}` : ''}` : 'To be determined'}
            aria-pressed={isPicked}
            className={`
                w-full px-1 sm:px-2 h-9 flex items-center justify-between transition-colors text-left relative overflow-hidden
                ${isPicked
                    ? pickStatus === 'incorrect' ? 'bg-brandred-600/15 text-brandred-500' : 'bg-gold-500 text-navy-900'
                    : 'hover:bg-page text-[color:var(--text)]'
                }
                ${isWinner && !isPicked ? 'bg-[#0F7B4A]/10' : ''}
                ${disabled ? 'cursor-default' : 'cursor-pointer'}
                ${isEliminated ? 'opacity-50 grayscale-[0.5]' : ''}
                ${diffStatus === 'same' ? 'ring-2 ring-[#0F7B4A] relative z-20' : diffStatus === 'diff' ? 'ring-2 ring-brandred-500 relative z-20' : ''}
            `}
        >
            <div className="flex items-center gap-1 sm:gap-2 w-full overflow-hidden z-10">
                {/* Seed badge — always reserve space for alignment */}
                <span className={`text-[11px] font-bold w-5 text-right flex-shrink-0 leading-none num
                    ${isPicked ? 'text-navy-800' : 'text-muted'}
                    ${!seed ? 'opacity-0' : ''}`}
                >
                    {seed ?? '0'}
                </span>

                {logoUrl && (
                    <img
                        src={logoUrl}
                        alt={teamName}
                        className="w-4 h-4 sm:w-5 sm:h-5 object-contain flex-shrink-0"
                        crossOrigin="anonymous"
                    />
                )}

                <span className={`text-[10px] sm:text-xs font-bold truncate tracking-tight flex-1 ${!teamId ? 'italic opacity-40' : ''} ${isEliminated ? 'line-through decoration-brandred-500/50' : ''}`}>
                    {teamName}
                </span>
            </div>

            {/* Status Icons */}
            <div className="z-10 ml-0.5 sm:ml-1 shrink-0">
                {pickStatus === 'correct' && <Check className="w-3.5 h-3.5 text-navy-900" />}
                {pickStatus === 'incorrect' && <X className="w-3.5 h-3.5 text-brandred-500" />}
                {isWinner && !pickStatus && <Check className="w-3.5 h-3.5 text-[#0F7B4A]" />}
                {!isWinner && isEliminated && !pickStatus && <X className="w-3.5 h-3.5 text-brandred-500" />}
                {isPicked && !pickStatus && !isEliminated && !isWinner && <div className="w-1.5 h-1.5 rounded-full bg-navy-900 shadow-sm" />}
            </div>

            {/* Winner highlight bar */}
            {isWinner && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#0F7B4A]" />
            )}
        </button>
    );
};
