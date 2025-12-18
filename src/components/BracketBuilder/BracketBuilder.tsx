
import React from 'react';
import type { Tournament } from '../../types';
import { MatchNode } from './MatchNode';

interface BracketBuilderProps {
    tournament: Tournament;
    picks: Record<string, string>; // slotId -> teamId
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
}

export const BracketBuilder: React.FC<BracketBuilderProps> = ({ tournament, picks, onPick, readOnly }) => {
    // We need to render 4 regions + Final Four

    // const regions = ['East', 'West', 'South', 'Midwest']; // Standard NCAA regions

    // Helper to get game by slot ID or structure
    // The tournament structure is complex. We might want to organize by Region -> Round -> Game

    // For V1, let's assume specific regions based on standard bracket layout

    return (
        <div className="overflow-x-auto pb-10">
            <div className="min-w-[1200px] p-4">
                <div className="flex justify-between gap-8">
                    {/* Left Side (East/West) */}
                    <div className="space-y-16">
                        <RegionBracket regionName="East" tournament={tournament} picks={picks} onPick={onPick} readOnly={readOnly} />
                        <RegionBracket regionName="West" tournament={tournament} picks={picks} onPick={onPick} readOnly={readOnly} />
                    </div>

                    {/* Final Four / Championship (Center) */}
                    <div className="flex flex-col justify-center items-center space-y-10 mt-32">
                        <div className="text-xl font-bold text-amber-500 mb-4">Final Four</div>
                        {/* Final Four Games connecting left/right */}
                        <MatchNode
                            game={Object.values(tournament.games).find(g => g.round === 5 && g.region === 'Final Four')} // Simplified lookup
                            picks={picks}
                            onPick={onPick}
                            readOnly={readOnly}
                        />
                        <div className="text-2xl font-bold text-amber-400 my-4">Championship</div>
                        <MatchNode
                            game={Object.values(tournament.games).find(g => g.round === 6)}
                            picks={picks}
                            onPick={onPick}
                            readOnly={readOnly}
                            isChampionship
                        />
                    </div>

                    {/* Right Side (South/Midwest) */}
                    <div className="space-y-16">
                        <RegionBracket regionName="South" tournament={tournament} picks={picks} onPick={onPick} readOnly={readOnly} />
                        <RegionBracket regionName="Midwest" tournament={tournament} picks={picks} onPick={onPick} readOnly={readOnly} />
                    </div>
                </div>
            </div>
        </div>
    );
};

const RegionBracket: React.FC<{ regionName: string } & BracketBuilderProps> = ({ regionName }) => {
    // Filter games for this region
    // Organise by round
    // This requires a stable sort or ID mapping. 
    // Ideally we pass a structured object, but for now we iterate.

    // Rounds 1, 2, 3, 4 (Sweet 16, Elite 8)

    return (
        <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40">
            <h3 className="text-center font-bold text-slate-400 mb-4 uppercase tracking-widest">{regionName}</h3>
            <div className="flex gap-8">
                {/* Round 1 */}
                <div className="space-y-4 flex flex-col justify-around">
                    {/* 8 games */}
                    {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 bg-slate-800/50 w-48 rounded border border-slate-700"></div>)}
                </div>
                {/* Round 2 */}
                <div className="space-y-4 flex flex-col justify-around">
                    {/* 4 games */}
                    {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-slate-800/50 w-48 rounded border border-slate-700"></div>)}
                </div>
                {/* Round 3 (Sweet 16) */}
                <div className="space-y-4 flex flex-col justify-around">
                    {/* 2 games */}
                    {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-16 bg-slate-800/50 w-48 rounded border border-slate-700"></div>)}
                </div>
                {/* Round 4 (Elite 8) */}
                <div className="space-y-4 flex flex-col justify-around">
                    {/* 1 game */}
                    <div className="h-16 bg-slate-800/50 w-48 rounded border border-slate-700"></div>
                </div>
            </div>
        </div>
    );
};
