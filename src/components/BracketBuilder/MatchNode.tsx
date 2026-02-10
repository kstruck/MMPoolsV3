import React from 'react';
import type { Game } from '../../types';

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

    return (
        <div className={`flex flex-col border border-slate-700 bg-slate-900 rounded overflow-hidden w-40 shadow-sm transition-all ${isChampionship ? 'scale-110 border-amber-500/50 shadow-amber-900/20' : 'hover:border-slate-600'}`}>
            <TeamSlot
                teamId={game.homeTeamId}
                seed={undefined} // TODO: Resolve seed from Team ID or Game object
                isPicked={isHomePicked}
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
    onClick: () => void;
    disabled?: boolean;
}

const TeamSlot: React.FC<TeamSlotProps> = ({ teamId, seed, isPicked, onClick, disabled }) => {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                w-full px-3 h-9 flex items-center justify-between transition-colors text-left
                ${isPicked
                    ? 'bg-amber-600/90 text-white'
                    : 'hover:bg-slate-800 text-slate-300'
                }
                ${disabled ? 'cursor-default' : 'cursor-pointer'}
            `}
        >
            <div className="flex items-center gap-2 w-full overflow-hidden">
                {seed && <span className="text-[10px] font-mono opacity-60 w-3">{seed}</span>}
                <span className={`text-xs font-bold truncate tracking-tight ${!teamId ? 'italic opacity-40' : ''}`}>
                    {teamId || 'TBD'}
                </span>
            </div>
            {isPicked && <div className="w-1.5 h-1.5 rounded-full bg-white ml-1 shadow-sm" />}
        </button>
    );
};
