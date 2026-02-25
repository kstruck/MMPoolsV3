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
    viewMode?: 'tabs' | 'full';
    comparisonPicks?: Record<string, string>;
}

export const BracketBuilder: React.FC<BracketBuilderProps> = ({ tournament, picks, onPick, readOnly, viewMode = 'tabs', comparisonPicks }) => {
    const [activeRegion, setActiveRegion] = useState<BracketRegion | 'FF'>('East');

    // Calculate completion status for tabs - moved up to avoid conditional hook call
    const completionStatus = useMemo(() => {
        // ... (status calc same as before) ...
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

    // Calculate eliminated teams globally
    const eliminatedTeamIds = useMemo(() => {
        const eliminated = new Set<string>();
        Object.values(tournament.games).forEach(game => {
            if (game.status === 'FINAL' && game.winnerTeamId) {
                const loserId = game.winnerTeamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
                if (loserId) eliminated.add(loserId);
            }
        });
        return eliminated;
    }, [tournament]);

    if (viewMode === 'full') {
        return (
            <FullBracketView
                tournament={tournament}
                picks={picks}
                onPick={onPick}
                readOnly={readOnly}
                eliminatedTeamIds={eliminatedTeamIds}
                comparisonPicks={comparisonPicks}
            />
        );
    }

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
                        eliminatedTeamIds={eliminatedTeamIds}
                        comparisonPicks={comparisonPicks}
                    />
                ) : (
                    <RegionBracket
                        regionName={activeRegion}
                        tournament={tournament}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                        eliminatedTeamIds={eliminatedTeamIds}
                        comparisonPicks={comparisonPicks}
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

const FullBracketView: React.FC<BracketBuilderProps & { eliminatedTeamIds: Set<string> }> = ({ tournament, picks, onPick, readOnly, eliminatedTeamIds, comparisonPicks }) => {
    // Zoom/Pan could be added here later. For now, we'll do a CSS transform scale to fit.
    return (
        <div id="bracket-printable-area" className="w-full h-full overflow-auto bg-slate-950 p-4">
            <div className="bracket-container w-fit mx-auto flex justify-center gap-4 lg:gap-8 xl:gap-16">

                {/* LEFT SIDE: East & West */}
                <div className="flex flex-col gap-12 lg:gap-16">
                    <div>
                        <h3 className="text-indigo-400 font-bold uppercase tracking-widest mb-4 text-center">East Region</h3>
                        <RegionBracket regionName="East" tournament={tournament} picks={picks} onPick={onPick} readOnly={readOnly} align="left" eliminatedTeamIds={eliminatedTeamIds} comparisonPicks={comparisonPicks} />
                    </div>
                    <div>
                        <h3 className="text-indigo-400 font-bold uppercase tracking-widest mb-4 text-center">West Region</h3>
                        <RegionBracket regionName="West" tournament={tournament} picks={picks} onPick={onPick} readOnly={readOnly} align="left" eliminatedTeamIds={eliminatedTeamIds} comparisonPicks={comparisonPicks} />
                    </div>
                </div>

                {/* CENTER: Final Four */}
                <div className="flex flex-col justify-center sticky top-0 self-center z-10">
                    <FinalFourBracket tournament={tournament} picks={picks} onPick={onPick} readOnly={readOnly} eliminatedTeamIds={eliminatedTeamIds} comparisonPicks={comparisonPicks} />
                </div>

                {/* RIGHT SIDE: South & Midwest - ALIGN RIGHT */}
                <div className="flex flex-col gap-12 lg:gap-16">
                    <div>
                        <h3 className="text-indigo-400 font-bold uppercase tracking-widest mb-4 text-center">South Region</h3>
                        <RegionBracket regionName="South" tournament={tournament} picks={picks} onPick={onPick} readOnly={readOnly} align="right" eliminatedTeamIds={eliminatedTeamIds} comparisonPicks={comparisonPicks} />
                    </div>
                    <div>
                        <h3 className="text-indigo-400 font-bold uppercase tracking-widest mb-4 text-center">Midwest Region</h3>
                        <RegionBracket regionName="Midwest" tournament={tournament} picks={picks} onPick={onPick} readOnly={readOnly} align="right" eliminatedTeamIds={eliminatedTeamIds} comparisonPicks={comparisonPicks} />
                    </div>
                </div>
            </div>
        </div>
    );
};

const RegionBracket: React.FC<{ regionName: string; align?: 'left' | 'right'; eliminatedTeamIds: Set<string> } & BracketBuilderProps> = ({ regionName, align = 'left', tournament, picks, onPick, readOnly, eliminatedTeamIds, comparisonPicks }) => {
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

    // Dynamic classes based on alignment
    // Use scale-75 or scale-x to shrink nicely without horizontal scrolling out of bounds on standard sizes
    const containerClasses = `flex gap-2 sm:gap-4 justify-center scale-[0.65] sm:scale-75 md:scale-90 xl:scale-75 2xl:scale-100 origin-top ${align === 'right' ? 'flex-row-reverse' : ''}`;

    return (
        <div className={containerClasses}>
            {/* Round 1 Column */}
            <div className="flex flex-col justify-around gap-1 py-4">
                {Array.from({ length: 8 }).map((_, i) => (
                    <MatchNode key={`r1-${i}`} game={r1Games[i]} picks={picks} onPick={onPick} readOnly={readOnly} eliminatedTeamIds={eliminatedTeamIds} comparisonPicks={comparisonPicks} />
                ))}
            </div>

            {/* Round 2 Column */}
            <div className="flex flex-col justify-around gap-2 py-8">
                {Array.from({ length: 4 }).map((_, i) => {
                    const homeFeeder = r1Games[i * 2];
                    const awayFeeder = r1Games[i * 2 + 1];
                    const homeId = picks[homeFeeder.id];
                    const awayId = picks[awayFeeder.id];
                    return (
                        <MatchNode
                            key={`r2-${i}`}
                            game={r2Games[i]}
                            picks={picks}
                            onPick={onPick}
                            readOnly={readOnly}
                            homeTeamIdOverride={homeId}
                            awayTeamIdOverride={awayId}
                            dynamicParticipants
                            comparisonPicks={comparisonPicks}
                        />
                    );
                })}
            </div>

            {/* Round 3 (Sweet 16) Column */}
            <div className="flex flex-col justify-around gap-2 py-16">
                {Array.from({ length: 2 }).map((_, i) => {
                    const homeFeeder = r2Games[i * 2];
                    const awayFeeder = r2Games[i * 2 + 1];
                    const homeId = picks[homeFeeder.id];
                    const awayId = picks[awayFeeder.id];
                    return (
                        <MatchNode
                            key={`r3-${i}`}
                            game={r3Games[i]}
                            picks={picks}
                            onPick={onPick}
                            readOnly={readOnly}
                            homeTeamIdOverride={homeId}
                            awayTeamIdOverride={awayId}
                            dynamicParticipants
                            comparisonPicks={comparisonPicks}
                        />
                    );
                })}
            </div>

            {/* Round 4 (Elite 8) Column */}
            <div className="flex flex-col justify-center py-20">
                {(() => {
                    const homeFeeder = r3Games[0];
                    const awayFeeder = r3Games[1];
                    const homeId = picks[homeFeeder.id];
                    const awayId = picks[awayFeeder.id];
                    return (
                        <MatchNode
                            key="r4"
                            game={r4Games[0]}
                            picks={picks}
                            onPick={onPick}
                            readOnly={readOnly}
                            homeTeamIdOverride={homeId}
                            awayTeamIdOverride={awayId}
                            dynamicParticipants
                            comparisonPicks={comparisonPicks}
                        />
                    );
                })()}
                <div className="mt-4 text-center text-xs text-slate-500 uppercase tracking-widest font-bold">Region<br />Champion</div>
            </div>
        </div>
    );
};

const FinalFourBracket: React.FC<BracketBuilderProps & { eliminatedTeamIds: Set<string> }> = ({ tournament, picks, onPick, readOnly, eliminatedTeamIds, comparisonPicks }) => {
    const ffGames = Object.values(tournament.games).filter(g => g.round === 5); // 2 games
    const champGame = Object.values(tournament.games).find(g => g.round === 6); // 1 game

    // Helper to find regional champions
    // East -> R4-E1, West -> R4-W1, South -> R4-S1, Midwest -> R4-M1
    const getRegChamp = (region: string) => {
        const game = Object.values(tournament.games).find(g => g.region === region && g.round === 4);
        return game ? picks[game.id] : undefined;
    };

    const eastChamp = getRegChamp('East');
    const westChamp = getRegChamp('West');
    const southChamp = getRegChamp('South');
    const midwestChamp = getRegChamp('Midwest');

    const f4Game1 = ffGames.find(g => g.id === 'R5-1') || ffGames[0];
    const f4Game2 = ffGames.find(g => g.id === 'R5-2') || ffGames[1];

    // Championship feeders
    const champHome = picks[f4Game1?.id];
    const champAway = picks[f4Game2?.id];

    return (
        <div className="flex flex-col items-center justify-center h-full gap-8 min-h-[400px]">
            <h3 className="text-2xl font-bold text-amber-500 tracking-widest uppercase mb-4">Final Four</h3>

            <div className="flex gap-8 items-center">
                {/* Semifinal 1 (East vs West) */}
                <div className="flex flex-col items-center gap-2">
                    <div className="text-xs text-slate-400">East vs West</div>
                    <MatchNode
                        game={f4Game1}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                        homeTeamIdOverride={eastChamp}
                        awayTeamIdOverride={westChamp}
                        dynamicParticipants
                        eliminatedTeamIds={eliminatedTeamIds}
                        comparisonPicks={comparisonPicks}
                    />
                </div>

                {/* Championship */}
                <div className="flex flex-col items-center transform scale-125 z-10">
                    <div className="text-amber-400 font-bold mb-2 text-lg">NATIONAL CHAMPIONSHIP</div>
                    <Trophy className="w-8 h-8 text-amber-500 mb-4 animate-pulse" />
                    <MatchNode
                        game={champGame}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                        isChampionship
                        homeTeamIdOverride={champHome}
                        awayTeamIdOverride={champAway}
                        dynamicParticipants
                        eliminatedTeamIds={eliminatedTeamIds}
                        comparisonPicks={comparisonPicks}
                    />
                </div>

                {/* Semifinal 2 (South vs Midwest) */}
                <div className="flex flex-col items-center gap-2">
                    <div className="text-xs text-slate-400">South vs Midwest</div>
                    <MatchNode
                        game={f4Game2}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                        homeTeamIdOverride={southChamp}
                        awayTeamIdOverride={midwestChamp}
                        dynamicParticipants
                        eliminatedTeamIds={eliminatedTeamIds}
                        comparisonPicks={comparisonPicks}
                    />
                </div>
            </div>
        </div>
    );
};
