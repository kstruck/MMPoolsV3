import React, { useState, useMemo, useEffect } from 'react';
import type { Tournament, BracketRegion } from '../../types';
import { MatchNode } from './MatchNode';
import { RegionTabs } from './RegionTabs';
import { ESPNBracket } from './ESPNBracket';
import { TeamDataContext } from './teamDataContext';
import { ChevronRight, ChevronLeft, Trophy, Star, Dices, Wand2, LayoutGrid, List } from 'lucide-react';
import { useToast } from '../ui/Toast';

interface BracketBuilderProps {
    tournament: Tournament;
    picks: Record<string, string>; // slotId -> teamId
    onPick: (slotId: string, teamId: string) => void;
    readOnly?: boolean;
    viewMode?: 'tabs' | 'full';
    comparisonPicks?: Record<string, string>;
    // Optional entry stats for the ESPNBracket header banner
    entryName?: string;
    entryScore?: number;
    maxPossibleScore?: number;
    rank?: number;
    totalEntries?: number;
}

type ViewType = 'espn' | 'tabs';

export const BracketBuilder: React.FC<BracketBuilderProps> = ({ tournament, picks, onPick, readOnly, viewMode = 'tabs', comparisonPicks, entryName, entryScore, maxPossibleScore, rank, totalEntries }) => {
    const toast = useToast();
    const [activeRegion, setActiveRegion] = useState<BracketRegion | 'FF'>('East');
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    // Mobile → Regions, Desktop → Full bracket
    const [view, setView] = useState<ViewType>(() => window.innerWidth < 768 ? 'tabs' : 'espn');

    useEffect(() => {
        const handleResize = () => {
            const mobile = window.innerWidth < 768;
            setIsMobile(mobile);
            if (mobile) setView('tabs'); // Force regions on mobile
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

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

    const totalGames = Object.keys(tournament.games).length;
    const totalPicks = Object.keys(picks).length;

    // If caller explicitly requests the legacy full view
    if (viewMode === 'full') {
        return (
            <FullBracketView
                tournament={tournament}
                picks={picks}
                onPick={onPick}
                readOnly={readOnly}
                eliminatedTeamIds={eliminatedTeamIds}
                comparisonPicks={comparisonPicks}
                entryName={entryName}
                entryScore={entryScore}
                maxPossibleScore={maxPossibleScore}
                rank={rank}
                totalEntries={totalEntries}
            />
        );
    }

    const handleQuickPick = async (strategy: 'favorites' | 'random' | 'smart') => {
        if (readOnly) return;

        if (strategy !== 'smart' && Object.keys(picks).length > 0) {
            const ok = await toast.confirm({
                title: 'Overwrite picks?',
                message: `This will overwrite your current picks with ${strategy} picks. Are you sure?`,
                confirmLabel: 'Overwrite',
                danger: true
            });
            if (!ok) return;
        }

        const newPicks: Record<string, string> = strategy === 'smart' ? { ...picks } : {};

        const pickWinner = (teamA: string | undefined, teamB: string | undefined): string | undefined => {
            if (!teamA) return teamB;
            if (!teamB) return teamA;
            if (strategy === 'random') {
                return Math.random() > 0.5 ? teamA : teamB;
            }
            const matchA = teamA.match(/[A-Z]?(\d+)-/);
            const matchB = teamB.match(/[A-Z]?(\d+)-/);
            const seedA = matchA ? parseInt(matchA[1], 10) : 8;
            const seedB = matchB ? parseInt(matchB[1], 10) : 8;

            if (strategy === 'smart') {
                const weightA = 17 - seedA;
                const weightB = 17 - seedB;
                const total = weightA + weightB;
                return Math.random() * total < weightA ? teamA : teamB;
            }

            return seedA <= seedB ? teamA : teamB;
        };

        const order = ['East', 'West', 'South', 'Midwest'];
        const regChamps: Record<string, string | undefined> = {};

        order.forEach(region => {
            const getGames = (round: number) => Object.values(tournament.games).filter(g => g.region === region && g.round === round).sort((a, b) => a.id.localeCompare(b.id));
            const r1 = getGames(1);
            const r2 = getGames(2);
            const r3 = getGames(3);
            const r4 = getGames(4);

            r1.forEach(g => {
                if (!newPicks[g.id]) newPicks[g.id] = pickWinner(g.homeTeamId, g.awayTeamId)!;
            });
            r2.forEach((g, i) => {
                if (!r1[i * 2] || !r1[i * 2 + 1]) return;
                const home = newPicks[r1[i * 2].id];
                const away = newPicks[r1[i * 2 + 1].id];
                if (!newPicks[g.id]) newPicks[g.id] = pickWinner(home, away)!;
            });
            r3.forEach((g, i) => {
                if (!r2[i * 2] || !r2[i * 2 + 1]) return;
                const home = newPicks[r2[i * 2].id];
                const away = newPicks[r2[i * 2 + 1].id];
                if (!newPicks[g.id]) newPicks[g.id] = pickWinner(home, away)!;
            });
            r4.forEach((g, i) => {
                if (!r3[i * 2] || !r3[i * 2 + 1]) return;
                const home = newPicks[r3[i * 2].id];
                const away = newPicks[r3[i * 2 + 1].id];
                if (!newPicks[g.id]) newPicks[g.id] = pickWinner(home, away)!;
                regChamps[region] = newPicks[g.id];
            });
        });

        const ff = Object.values(tournament.games).filter(g => g.round === 5).sort((a, b) => a.id.localeCompare(b.id));
        const f4Game1 = ff.find(g => g.id === 'R5-1') || ff[0];
        const f4Game2 = ff.find(g => g.id === 'R5-2') || ff[1];

        if (f4Game1 && !newPicks[f4Game1.id]) newPicks[f4Game1.id] = pickWinner(regChamps['East'], regChamps['West'])!;
        if (f4Game2 && !newPicks[f4Game2.id]) newPicks[f4Game2.id] = pickWinner(regChamps['South'], regChamps['Midwest'])!;

        const champ = Object.values(tournament.games).find(g => g.round === 6);
        if (champ && f4Game1 && f4Game2 && !newPicks[champ.id]) {
            newPicks[champ.id] = pickWinner(newPicks[f4Game1.id], newPicks[f4Game2.id])!;
        }

        Object.entries(newPicks).forEach(([slot, team]) => {
            if (picks[slot] !== team && team !== undefined) {
                onPick(slot, team);
            }
        });
    };

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
        <div className="flex flex-col h-full w-full">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 pt-3 pb-2">
                <div className="flex justify-between items-center gap-3">
                    {/* Left: Quick pick tools */}
                    {!readOnly && (
                        <div className="flex items-center gap-1 bg-slate-800/50 p-1 rounded-lg border border-slate-700">
                            <button
                                onClick={() => handleQuickPick('favorites')}
                                className="px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors flex items-center gap-1"
                                title="Fill bracket with top seeds"
                            >
                                <Star size={12} className="text-amber-400" /> <span className="hidden sm:inline">Favorites</span>
                            </button>
                            <button
                                onClick={() => handleQuickPick('random')}
                                className="px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors flex items-center gap-1"
                                title="Fill bracket randomly"
                            >
                                <Dices size={12} className="text-indigo-400" /> <span className="hidden sm:inline">Random</span>
                            </button>
                            <button
                                onClick={() => handleQuickPick('smart')}
                                className="px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors flex items-center gap-1"
                                title="Finish remaining games"
                            >
                                <Wand2 size={12} className="text-emerald-400" /> <span className="hidden sm:inline">Finish</span>
                            </button>
                        </div>
                    )}

                    {/* Center: Progress */}
                    <div className="text-xs text-slate-400 font-mono whitespace-nowrap hidden sm:block">
                        {totalPicks} / {totalGames} picks
                    </div>

                    {/* Right: View toggle — always visible; Regions default/recommended on mobile */}
                    <div className="flex items-center gap-1 bg-slate-800/50 p-1 rounded-lg border border-slate-700">
                        <button
                            onClick={() => setView('tabs')}
                            title="Region-by-Region (recommended for mobile)"
                            className={`px-2 sm:px-3 py-1.5 rounded text-[10px] font-semibold flex items-center gap-1 transition-colors ${view === 'tabs' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                        >
                            <List size={11} /> Regions
                        </button>
                        <button
                            onClick={() => setView('espn')}
                            title="Full Bracket (ESPN-style, best on desktop)"
                            className={`px-2 sm:px-3 py-1.5 rounded text-[10px] font-semibold flex items-center gap-1 transition-colors ${view === 'espn' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                        >
                            <LayoutGrid size={11} /> Full
                        </button>
                    </div>
                </div>

                {/* Mobile context banner — tells users which mode they're in */}
                {isMobile && view === 'tabs' && (
                    <div className="mt-2 px-3 py-1.5 bg-indigo-950/70 border border-indigo-700/40 rounded-lg text-[10px] text-indigo-300 flex items-center gap-1.5">
                        <span>📱</span>
                        <span><strong>Region mode</strong> — pick one region at a time. Great for phones! Tap <strong>Full</strong> if you prefer the complete bracket view.</span>
                    </div>
                )}
                {isMobile && view === 'espn' && (
                    <div className="mt-2 px-3 py-1.5 bg-amber-950/70 border border-amber-700/40 rounded-lg text-[10px] text-amber-300 flex items-center gap-1.5">
                        <span>🖥️</span>
                        <span>Full bracket is best on a <strong>desktop or tablet</strong>. Tap <strong>Regions</strong> for easier phone picking.</span>
                    </div>
                )}

                {/* Region tabs — only shown in tabs view */}
                {view === 'tabs' && (
                    <div className="mt-2">
                        <RegionTabs
                            activeRegion={activeRegion}
                            onRegionChange={setActiveRegion}
                            completionStatus={completionStatus}
                        />
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                {view === 'espn' ? (
                    <ESPNBracket
                        tournament={tournament}
                        picks={picks}
                        onPick={onPick}
                        readOnly={readOnly}
                        eliminatedTeamIds={eliminatedTeamIds}
                        comparisonPicks={comparisonPicks}
                        entryName={entryName}
                        entryScore={entryScore}
                        maxPossibleScore={maxPossibleScore}
                        rank={rank}
                        totalEntries={totalEntries}
                    />
                ) : (
                    <TeamDataContext.Provider value={tournament.importedTeams ?? {}}>
                    <div className="p-4">
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
                    </TeamDataContext.Provider>
                )}
            </div>

            {/* Footer Navigation — only in tabs view */}
            {!readOnly && view === 'tabs' && (
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

// --- Sub-components (kept for Regions tab view) ---

const FullBracketView: React.FC<BracketBuilderProps & { eliminatedTeamIds: Set<string> }> = ({ tournament, picks, onPick, readOnly, eliminatedTeamIds, comparisonPicks, entryName, entryScore, maxPossibleScore, rank, totalEntries }) => {
    return (
        <ESPNBracket
            tournament={tournament}
            picks={picks}
            onPick={onPick}
            readOnly={readOnly}
            eliminatedTeamIds={eliminatedTeamIds}
            comparisonPicks={comparisonPicks}
            entryName={entryName}
            entryScore={entryScore}
            maxPossibleScore={maxPossibleScore}
            rank={rank}
            totalEntries={totalEntries}
        />
    );
};

const RegionBracket: React.FC<{ regionName: string; align?: 'left' | 'right'; eliminatedTeamIds: Set<string> } & BracketBuilderProps> = ({ regionName, align = 'left', tournament, picks, onPick, readOnly, eliminatedTeamIds, comparisonPicks }) => {
    const getGames = (round: number) => {
        return Object.values(tournament.games)
            .filter(g => g.region === regionName && g.round === round)
            .sort((a, b) => a.id.localeCompare(b.id));
    };

    const r1Games = getGames(1);
    const r2Games = getGames(2);
    const r3Games = getGames(3);
    const r4Games = getGames(4);

    const containerClasses = `flex gap-2 sm:gap-4 justify-center scale-[0.65] sm:scale-75 md:scale-90 xl:scale-75 2xl:scale-100 origin-top ${align === 'right' ? 'flex-row-reverse' : ''}`;

    return (
        <div className={containerClasses}>
            <div className="flex flex-col justify-around gap-1 py-4">
                {Array.from({ length: 8 }).map((_, i) => (
                    <MatchNode key={`r1-${i}`} game={r1Games[i]} picks={picks} onPick={onPick} readOnly={readOnly} eliminatedTeamIds={eliminatedTeamIds} comparisonPicks={comparisonPicks} />
                ))}
            </div>

            <div className="flex flex-col justify-around gap-2 py-8">
                {Array.from({ length: 4 }).map((_, i) => {
                    const homeFeeder = r1Games[i * 2];
                    const awayFeeder = r1Games[i * 2 + 1];
                    const homeId = picks[homeFeeder?.id];
                    const awayId = picks[awayFeeder?.id];
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

            <div className="flex flex-col justify-around gap-2 py-16">
                {Array.from({ length: 2 }).map((_, i) => {
                    const homeFeeder = r2Games[i * 2];
                    const awayFeeder = r2Games[i * 2 + 1];
                    const homeId = picks[homeFeeder?.id];
                    const awayId = picks[awayFeeder?.id];
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

            <div className="flex flex-col justify-center py-20">
                {(() => {
                    const homeFeeder = r3Games[0];
                    const awayFeeder = r3Games[1];
                    const homeId = picks[homeFeeder?.id];
                    const awayId = picks[awayFeeder?.id];
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
    const ffGames = Object.values(tournament.games).filter(g => g.round === 5);
    const champGame = Object.values(tournament.games).find(g => g.round === 6);

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

    const champHome = picks[f4Game1?.id];
    const champAway = picks[f4Game2?.id];

    return (
        <div className="flex flex-col items-center justify-center h-full gap-8 min-h-[400px]">
            <h3 className="text-2xl font-bold text-amber-500 tracking-widest uppercase mb-4">Final Four</h3>

            <div className="flex gap-8 items-center">
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
