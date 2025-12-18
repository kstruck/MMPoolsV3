
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
    if (!game) return <div className="p-2 opacity-50">TBD</div>;

    // Resolve teams from previous games if necessary, or from Game object directly if Round 1

    return (
        <div className={`flex flex-col border border-slate-700 bg-slate-900 rounded overflow-hidden w-48 ${isChampionship ? 'scale-125 border-amber-500/50' : ''}`}>
            <TeamSlot teamId={game.homeTeamId} seed={undefined} picked={picks[game.id] === game.homeTeamId} onClick={() => !readOnly && onPick(game.id, game.homeTeamId)} />
            <div className="border-t border-slate-800"></div>
            <TeamSlot teamId={game.awayTeamId} seed={undefined} picked={picks[game.id] === game.awayTeamId} onClick={() => !readOnly && onPick(game.id, game.awayTeamId)} />
        </div>
    );
};

const TeamSlot: React.FC<{ teamId?: string, seed?: number, picked?: boolean, onClick: () => void }> = ({ teamId, seed, picked, onClick }) => {
    return (
        <div
            onClick={onClick}
            className={`px-3 py-2 flex items-center justify-between cursor-pointer transition-colors ${picked ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}`}
        >
            <div className="flex items-center gap-2 truncate">
                <span className="text-xs font-mono text-slate-500 w-4">{seed}</span>
                <span className={`font-bold text-sm truncate ${!teamId ? 'italic text-slate-600' : ''}`}>{teamId || 'TBD'}</span>
            </div>
        </div>
    );
};
