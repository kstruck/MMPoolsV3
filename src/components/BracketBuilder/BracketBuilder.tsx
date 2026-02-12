import React, { useState, useMemo } from 'react';
import type { Tournament, BracketRegion } from '../../types';
import { MatchNode } from './MatchNode';
import { RegionTabs } from './RegionTabs';
import { ChevronRight, ChevronLeft, Trophy } from 'lucide-react';

interface BracketBuilderProps {
    tournament: Tournament;
    picks: Record<string, string>; // slotId -> teamId
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
}

export const BracketBuilder: React.FC<BracketBuilderProps> = ({ tournament, picks, onPick, readOnly }) => {
    const [activeRegion, setActiveRegion] = useState<BracketRegion | 'FF'>('East');

    // Calculate completion status for tabs
    const completionStatus = useMemo(() => {
        const status: Record<BracketRegion | 'FF', { count: number; total: number; complete: boolean }> = {
            East: { count: 0, total: 15, complete: false },
            West: { count: 0, total: 15, complete: false },
            South: { count: 0, total: 15, complete: false },
            Midwest: { count: 0, total: 15, complete: false },
            FF: { count: 0, total: 3, complete: false }
        };

        Object.values(tournament.games).forEach(game => {
            if (picks[game.id]) {
                const region = game.region as BracketRegion;
                // Only count if it's a valid main region
                if (region && status[region]) {
                    status[region].count++;
                } else if (game.region === 'Final Four' || game.region === 'Championship' || game.round >= 5) {
                    status.FF.count++;
                }
            }
        });

        (Object.keys(status) as (BracketRegion | 'FF')[]).forEach(key => {
            status[key].complete = status[key].count === status[key].total;
        });

        return status;
    }, [tournament, picks]);

    const handleNextRegion = () => {
        const order: (BracketRegion | 'FF')[] = ['East', 'West', 'South', 'Midwest', 'FF'];
        const currentIndex = order.indexOf(activeRegion);
        if (currentIndex < order.length - 1) {
            setActiveRegion(order[currentIndex + 1]);
        }
    };

    const handlePrevRegion = () => {
        const order: (BracketRegion | 'FF')[] = ['East', 'West', 'South', 'Midwest', 'FF'];
        const currentIndex = order.indexOf(activeRegion);
        if (currentIndex > 0) {
            setActiveRegion(order[currentIndex - 1]);
        }
    };

    return (
        <div className="flex flex-col h-full w-full max-w-6xl mx-auto">
            {/* Header / Tabs */}
            <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 pt-4 px-4">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        {activeRegion === 'FF' ? <Trophy className="text-amber-500" /> : <span className="text-indigo-400">Region:</span>}
                        {activeRegion === 'FF' ? 'Final Four' : activeRegion}
                    </h2>
                    <div className="text-sm text-slate-400 font-mono">
                        Total Picks: {Object.values(picks).length} / 63
                    </div>
                </div>

                <RegionTabs
                    activeRegion={activeRegion}
                    onRegionChange={setActiveRegion}
                    completionStatus={completionStatus}
                />
            </div>

            {/* Main Content Area - Scrollable if needed, but designed to fit */}
            <div className="flex-1 p-4 overflow-x-auto overflow-y-auto min-h-[600px]">
                {activeRegion === 'FF' ? (
                    <FinalFourBracket
                        tournament={tournament}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                    />
                ) : (
                    <RegionBracket
                        regionName={activeRegion}
                        tournament={tournament}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                    />
                )}
            </div>

            {/* Footer Navigation */}
            {!readOnly && (
                <div className="p-4 border-t border-slate-800 flex justify-between bg-slate-900/50 backdrop-blur">
                    <button
                        onClick={handlePrevRegion}
                        disabled={activeRegion === 'East'}
                        className="px-4 py-2 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 flex items-center gap-2"
                    >
                        <ChevronLeft className="w-4 h-4" /> Previous Region
                    </button>

                    <button
                        onClick={handleNextRegion}
                        disabled={activeRegion === 'FF'}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium flex items-center gap-2 shadow-lg shadow-indigo-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Next Region <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
};

// --- Sub-components ---

const RegionBracket: React.FC<{ regionName: string } & BracketBuilderProps> = ({ regionName, tournament, picks, onPick, readOnly }) => {
    // Helper to get games for this region and round
    const getGames = (round: number) => {
        return Object.values(tournament.games)
            .filter(g => g.region === regionName && g.round === round)
            .sort((a, b) => a.id.localeCompare(b.id)); // Ensure stable order (by slot ID usually)
    };

    const r1Games = getGames(1); // 8 games
    const r2Games = getGames(2); // 4 games
    const r3Games = getGames(3); // 2 games
    const r4Games = getGames(4); // 1 game

    return (
        <div className="flex gap-8 min-w-[800px] justify-center">
            {/* Round 1 Column */}
            <div className="flex flex-col justify-around gap-2 py-4">
                {Array.from({ length: 8 }).map((_, i) => (
                    <MatchNode key={`r1-${i}`} game={r1Games[i]} picks={picks} onPick={onPick} readOnly={readOnly} />
                ))}
            </div>

            {/* Round 2 Column */}
            <div className="flex flex-col justify-around gap-2 py-12">
                {Array.from({ length: 4 }).map((_, i) => (
                    <MatchNode key={`r2-${i}`} game={r2Games[i]} picks={picks} onPick={onPick} readOnly={readOnly} />
                ))}
            </div>

            {/* Round 3 (Sweet 16) Column */}
            <div className="flex flex-col justify-around gap-2 py-24">
                {Array.from({ length: 2 }).map((_, i) => (
                    <MatchNode key={`r3-${i}`} game={r3Games[i]} picks={picks} onPick={onPick} readOnly={readOnly} />
                ))}
            </div>

            {/* Round 4 (Elite 8) Column */}
            <div className="flex flex-col justify-center py-32">
                <MatchNode key="r4" game={r4Games[0]} picks={picks} onPick={onPick} readOnly={readOnly} />
                <div className="mt-4 text-center text-xs text-slate-500 uppercase tracking-widest font-bold">Region<br />Champion</div>
            </div>
        </div>
    );
};

const FinalFourBracket: React.FC<BracketBuilderProps> = ({ tournament, picks, onPick, readOnly }) => {
    const ffGames = Object.values(tournament.games).filter(g => g.round === 5); // 2 games
    const champGame = Object.values(tournament.games).find(g => g.round === 6); // 1 game

    return (
        <div className="flex flex-col items-center justify-center h-full gap-12 min-h-[400px]">
            <h3 className="text-2xl font-bold text-amber-500 tracking-widest uppercase mb-8">Final Four</h3>

            <div className="flex gap-16 items-center">
                {/* Semifinal 1 */}
                <div className="flex flex-col items-center gap-4">
                    <div className="text-sm text-slate-400">Semifinal 1</div>
                    <MatchNode game={ffGames[0]} picks={picks} onPick={onPick} readOnly={readOnly} />
                </div>

                {/* Championship */}
                <div className="flex flex-col items-center transform scale-125 z-10">
                    <div className="text-amber-400 font-bold mb-2 text-lg">NATIONAL CHAMPIONSHIP</div>
                    <Trophy className="w-8 h-8 text-amber-500 mb-4 animate-pulse" />
                    <MatchNode game={champGame} picks={picks} onPick={onPick} readOnly={readOnly} isChampionship />
                </div>

                {/* Semifinal 2 */}
                <div className="flex flex-col items-center gap-4">
                    <div className="text-sm text-slate-400">Semifinal 2</div>
                    <MatchNode game={ffGames[1]} picks={picks} onPick={onPick} readOnly={readOnly} />
                </div>
            </div>
        </div>
    );
};
