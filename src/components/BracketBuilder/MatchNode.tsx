import React from 'react';
import type { Game } from '../../types';
import { getTeamLogo } from '../../constants';
import { Check, X } from 'lucide-react';

interface MatchNodeProps {
    game?: Game;
    picks: Record<string, string>;
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
    isChampionship?: boolean;
}

export const MatchNode: React.FC<MatchNodeProps> = ({ game, picks, onPick, readOnly, isChampionship }) => {
    // If no game yet (e.g. waiting for previous round), show placeholder
    // In a real tournament app, we might show "Winner of X vs Y"
    if (!game) {
        return (
            <div className={`flex flex-col border border-slate-800 bg-slate-900/30 rounded overflow-hidden w-40 opacity-50 ${isChampionship ? 'scale-110' : ''}`}>
                <div className="h-8 border-b border-slate-800" />
                <div className="h-8" />
            </div>
        );
    }

    const pickedTeamId = picks[game.id];
    const isHomePicked = pickedTeamId === game.homeTeamId;
    const isAwayPicked = pickedTeamId === game.awayTeamId;

    const isFinal = game.status === 'FINAL';
    const isHomeWinner = isFinal && game.winnerTeamId === game.homeTeamId;
    const isAwayWinner = isFinal && game.winnerTeamId === game.awayTeamId;

    // Determine status for the picked team (if any)
    const getPickStatus = (teamId?: string) => {
        if (!teamId || !pickedTeamId || teamId !== pickedTeamId) return null;
        if (!isFinal) return null;
        return game.winnerTeamId === teamId ? 'correct' : 'incorrect';
    };

    return (
        <div className={`flex flex-col border border-slate-700 bg-slate-900 rounded overflow-hidden w-40 shadow-sm transition-all ${isChampionship ? 'scale-110 border-amber-500/50 shadow-amber-900/20' : 'hover:border-slate-600'}`}>
            <TeamSlot
                teamId={game.homeTeamId}
                seed={undefined} // TODO: Resolve seed if available
                isPicked={isHomePicked}
                pickStatus={getPickStatus(game.homeTeamId)}
                isWinner={isHomeWinner}
                logoUrl={game.homeTeamId ? getTeamLogo(game.homeTeamId.split('-')[1] || '') : null} // Try to extract name part
                onClick={() => !readOnly && game.homeTeamId && onPick(game.id, game.homeTeamId)}
                disabled={readOnly || !game.homeTeamId}
            />
            <div className="border-t border-slate-800 relative">
                {/* Connector dot could go here */}
            </div>
            <TeamSlot
                teamId={game.awayTeamId}
                seed={undefined}
                isPicked={isAwayPicked}
                pickStatus={getPickStatus(game.awayTeamId)}
                isWinner={isAwayWinner}
                logoUrl={game.awayTeamId ? getTeamLogo(game.awayTeamId.split('-')[1] || '') : null}
                onClick={() => !readOnly && game.awayTeamId && onPick(game.id, game.awayTeamId)}
                disabled={readOnly || !game.awayTeamId}
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
}

const TeamSlot: React.FC<TeamSlotProps> = ({ teamId, seed, isPicked, pickStatus, isWinner, logoUrl, onClick, disabled }) => {
    // Extract team name from ID (e.g., "E1-Duke" -> "Duke")
    // Assuming format RegionSeed-Name or just Name
    let teamName = 'TBD';
    if (teamId) {
        const parts = teamId.split('-');
        teamName = parts.length > 1 ? parts[1] : parts[0];
        // Clean up camelCase if needed, but the data seems to be "Duke", "NorthCarolina" etc.
        // Actually data is "North Carolina" in name field, but ID is "S10-NorthCarolina".
        // Use regex to separate CamelCase? Or just use as is.
        teamName = teamName.replace(/([A-Z])/g, ' $1').trim();
    }

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                w-full px-2 h-9 flex items-center justify-between transition-colors text-left relative overflow-hidden
                ${isPicked
                    ? pickStatus === 'incorrect' ? 'bg-red-500/20 text-red-200' : 'bg-amber-600/90 text-white'
                    : 'hover:bg-slate-800 text-slate-300'
                }
                ${isWinner && !isPicked ? 'bg-emerald-500/10' : ''}
                ${disabled ? 'cursor-default' : 'cursor-pointer'}
            `}
        >
            <div className="flex items-center gap-2 w-full overflow-hidden z-10">
                {logoUrl ? (
                    <img src={logoUrl} alt={teamName} className="w-5 h-5 object-contain" />
                ) : (
                    seed && <span className="text-[10px] font-mono opacity-60 w-3">{seed}</span>
                )}

                <span className={`text-xs font-bold truncate tracking-tight flex-1 ${!teamId ? 'italic opacity-40' : ''}`}>
                    {teamName}
                </span>
            </div>

            {/* Status Icons */}
            <div className="z-10 ml-1">
                {pickStatus === 'correct' && <Check className="w-3.5 h-3.5 text-white" />}
                {pickStatus === 'incorrect' && <X className="w-3.5 h-3.5 text-red-400" />}
                {isPicked && !pickStatus && <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm" />}
            </div>

            {/* Winner highlight bar */}
            {isWinner && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-emerald-500" />
            )}
        </button>
    );
};
