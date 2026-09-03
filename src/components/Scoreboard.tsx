import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trophy, PlayCircle, Calendar, Radio, Clock, Shield, GraduationCap, Volleyball } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { getTeamLogo } from '../constants';
import type { User } from '../types';
import { HelpRoutePublisher } from '../help/publish';

interface Game {
    id: string;
    name: string;
    shortName: string;
    date: string;
    status: {
        type: {
            id: string;
            name: string;
            state: 'pre' | 'in' | 'post';
            completed: boolean;
        };
        period: number;
        displayClock: string;
    };
    week: {
        number: number;
    };
    competitions: Array<{
        competitors: Array<{
            id: string;
            team: {
                id: string;
                name: string;
                abbreviation: string;
                displayName: string;
                logo: string;
            };
            score: string;
            homeAway: 'home' | 'away';
            winner?: boolean;
            curatedRank?: {
                current?: number;
            };
        }>;
    }>;
}

interface ScoreboardProps {
    user: User | null;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({
    user,
    onOpenAuth,
    onLogout,
    onCreatePool
}) => {
    // ponytail: fixed default, not season-aware. A date-driven default (NFL Aug-Feb,
    // basketball Mar-Apr) is the better shape; add it when the off-season lands.
    const [activeTab, setActiveTab] = useState<'nfl' | 'college' | 'basketball'>('nfl');
    const [games, setGames] = useState<Game[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const fetchScores = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            // Calculate date range: Past 7 days to Next 7 days
            const today = new Date();
            const past = new Date(today);
            past.setDate(today.getDate() - 7);
            const future = new Date(today);
            future.setDate(today.getDate() + 7);

            const formatDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
            const dateStr = `${formatDate(past)}-${formatDate(future)}`;

            let url = '';
            if (activeTab === 'basketball') {
                // College Basketball (Mens) - NCAA Tournament (groups=100)
                url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?limit=500&groups=100`;
            } else {
                // Football
                const leaguePath = activeTab === 'college' ? 'college-football' : 'nfl';
                url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/scoreboard?dates=${dateStr}&limit=200`;
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch scores');

            const data: { events: Game[] } = await response.json();
            let fetchedGames = data.events || [];

            // For basketball, always include LIVE games + any game featuring an AP Top 25 team
            if (activeTab === 'basketball') {
                fetchedGames = fetchedGames.filter(game => {
                    // Always show live (in-progress) games regardless of ranking
                    if (game.status.type.state === 'in') return true;
                    // For completed/upcoming, only show if a Top 25 team is involved
                    const competitors = game.competitions?.[0]?.competitors || [];
                    return competitors.some(c =>
                        c.curatedRank?.current && c.curatedRank.current >= 1 && c.curatedRank.current <= 25
                    );
                });
            }

            setGames(fetchedGames);
            setLastUpdated(new Date());
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to load scores');
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    // Initial fetch and tab change
    useEffect(() => {
        fetchScores();
    }, [fetchScores]);

    // Auto-refresh every 30 seconds
    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(fetchScores, 30000);
        return () => clearInterval(interval);
    }, [autoRefresh, fetchScores]);

    // Categorize games by Status
    const categorizedGames = React.useMemo(() => {
        if (!games.length) return { live: [], upcoming: [], completed: [] };

        const live: Game[] = [];
        const upcoming: Game[] = [];
        const completed: Game[] = [];

        games.forEach(game => {
            const state = game.status.type.state;
            if (state === 'in') {
                live.push(game);
            } else if (state === 'pre') {
                upcoming.push(game);
            } else {
                completed.push(game);
            }
        });

        // Sort:
        // Live: Chronological (Earliest Start First) - though for live usually means "started first"
        live.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Upcoming: Chronological (Earliest Start First) - "Upcoming games listed before completed" handled by section order
        upcoming.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Completed: Reverse Chronological (Most Recent First)
        completed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return { live, upcoming, completed };
    }, [games]);

    const getStatusBadge = (game: Game) => {
        const state = game.status.type.state;
        if (state === 'in') {
            return (
                <span className="flex items-center gap-1.5 text-white bg-brandred-600 px-2 py-1 rounded-full text-xs font-display font-bold uppercase tracking-[0.08em]">
                    <span className="size-1.5 rounded-full bg-white animate-live-pulse" aria-hidden="true" /> LIVE
                </span>
            );
        }
        if (state === 'post') {
            return (
                <span className="flex items-center gap-1 text-[#9FB0CC] bg-navy-800 px-2 py-1 rounded text-xs font-display font-bold uppercase tracking-[0.08em]">
                    <Trophy size={12} /> FINAL
                </span>
            );
        }
        return (
            <span className="flex items-center gap-1 text-gold-400 bg-gold-500/10 border border-gold-500/30 px-2 py-1 rounded text-xs font-display font-bold uppercase tracking-[0.08em] num">
                <Calendar size={12} /> {new Date(game.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
        );
    };

    const getGameClock = (game: Game, isBasketball = false) => {
        const state = game.status.type.state;
        if (state === 'in') {
            const period = game.status.period;
            const clock = game.status.displayClock || '';
            if (isBasketball) {
                const halfLabel = period === 1 ? '1st Half' : period === 2 ? '2nd Half' : `OT${period > 3 ? period - 2 : ''}`;
                return `${halfLabel} ${clock}`;
            }
            const qLabel = period <= 4 ? `Q${period}` : 'OT';
            return `${qLabel} ${clock}`;
        }
        if (state === 'post') return 'Final';
        return '';
    };

    const renderLiveSection = (gamesList: Game[]) => {
        const isBasketball = activeTab === 'basketball';

        if (gamesList.length === 0) {
            return (
                <div className="mb-10">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="relative flex items-center justify-center">
                            <span className="w-3 h-3 bg-brandred-600 rounded-full animate-live-pulse absolute" />
                            <span className="w-3 h-3 bg-brandred-600 rounded-full" />
                        </div>
                        <h3 className="text-xl font-display font-bold uppercase text-white tracking-wide">LIVE <span className="text-gold-400">Games</span></h3>
                        <span className="text-xs font-display font-bold uppercase tracking-[0.08em] text-gold-400 bg-gold-500/10 border border-gold-500/30 px-2 py-0.5 rounded-full">NCAA Basketball</span>
                    </div>
                    <div className="bg-navy-900 border border-[rgba(230,206,150,0.16)] rounded-xl p-8 flex flex-col items-center justify-center gap-3 text-center">
                        <Clock size={36} className="text-[#9FB0CC]/50" />
                        <p className="text-[#9FB0CC] font-medium">No live games right now</p>
                        <p className="text-xs text-[#9FB0CC]/60">Scores update automatically when games tip off</p>
                    </div>
                </div>
            );
        }

        return (
            <div className="mb-10">
                {/* Section Header */}
                <div className="flex items-center gap-3 mb-4">
                    <div className="relative flex items-center justify-center">
                        <span className="w-3 h-3 bg-brandred-600 rounded-full animate-ping absolute" />
                        <span className="w-3 h-3 bg-brandred-600 rounded-full" />
                    </div>
                    <h3 className="text-xl font-display font-bold uppercase text-white tracking-wide">LIVE <span className="text-gold-400">Games</span></h3>
                    <span className="text-xs font-display font-bold uppercase tracking-[0.08em] text-white bg-brandred-600 px-2 py-0.5 rounded-full animate-live-pulse num">
                        {gamesList.length} GAME{gamesList.length !== 1 ? 'S' : ''} IN PROGRESS
                    </span>
                </div>

                {/* Live Game Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {gamesList.map(game => {
                        const competition = game.competitions[0];
                        const homeTeam = competition?.competitors.find(c => c.homeAway === 'home');
                        const awayTeam = competition?.competitors.find(c => c.homeAway === 'away');

                        return (
                            <div
                                key={game.id}
                                className="relative bg-navy-900 border border-brandred-600/60 rounded-xl p-4 shadow-lg shadow-brandred-600/10 overflow-hidden"
                            >
                                {/* Glow accent bar */}
                                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-brandred-600 via-brandred-500 to-brandred-600" />

                                {/* Live badge + clock */}
                                <div className="flex justify-between items-center mb-3">
                                    <span className="flex items-center gap-1.5 text-white bg-brandred-600 px-2.5 py-1 rounded-full text-xs font-display font-bold uppercase tracking-[0.08em]">
                                        <Radio size={10} className="animate-live-pulse" /> LIVE
                                    </span>
                                    <span className="text-xs text-[#9FB0CC] font-display font-bold num">
                                        {getGameClock(game, isBasketball)}
                                    </span>
                                </div>

                                {/* Teams & Scores */}
                                <div className="space-y-3">
                                    {/* Away Team */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={awayTeam?.team.logo || '/placeholder-team.png'}
                                                alt={awayTeam?.team.abbreviation || 'TBD'}
                                                loading="lazy"
                                                className="w-9 h-9 object-contain"
                                                onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-team.png'; }}
                                            />
                                            <div>
                                                {awayTeam?.curatedRank?.current && awayTeam.curatedRank.current <= 25 && (
                                                    <p className="text-[9px] text-gold-400 font-bold leading-none mb-0.5 num">#{awayTeam.curatedRank.current}</p>
                                                )}
                                                <p className="font-display font-bold text-white leading-none">{awayTeam?.team.abbreviation}</p>
                                                <p className="text-[10px] text-[#9FB0CC]/70 mt-0.5 max-w-[90px] truncate">{awayTeam?.team.displayName}</p>
                                            </div>
                                        </div>
                                        <span className="text-3xl font-display font-bold text-white num">
                                            {awayTeam?.score || '0'}
                                        </span>
                                    </div>

                                    <div className="border-t border-[rgba(230,206,150,0.16)]" />

                                    {/* Home Team */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={homeTeam?.team.logo || '/placeholder-team.png'}
                                                alt={homeTeam?.team.abbreviation || 'TBD'}
                                                loading="lazy"
                                                className="w-9 h-9 object-contain"
                                                onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-team.png'; }}
                                            />
                                            <div>
                                                {homeTeam?.curatedRank?.current && homeTeam.curatedRank.current <= 25 && (
                                                    <p className="text-[9px] text-gold-400 font-bold leading-none mb-0.5 num">#{homeTeam.curatedRank.current}</p>
                                                )}
                                                <p className="font-display font-bold text-white leading-none">{homeTeam?.team.abbreviation}</p>
                                                <p className="text-[10px] text-[#9FB0CC]/70 mt-0.5 max-w-[90px] truncate">{homeTeam?.team.displayName}</p>
                                            </div>
                                        </div>
                                        <span className="text-3xl font-display font-bold text-white num">
                                            {homeTeam?.score || '0'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderGameSection = (title: string, gamesList: Game[], icon: React.ReactNode, borderColor: string = 'border-[rgba(230,206,150,0.16)]') => {
        if (gamesList.length === 0) return null;

        return (
            <div className="space-y-4 mb-10">
                <h3 className={`text-xl font-display font-bold uppercase text-white flex items-center gap-2 border-b ${borderColor} pb-2`}>
                    {icon} {title}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {gamesList.map(game => {
                        const competition = game.competitions[0];
                        const homeTeam = competition?.competitors.find(c => c.homeAway === 'home');
                        const awayTeam = competition?.competitors.find(c => c.homeAway === 'away');
                        const isLive = game.status.type.state === 'in';
                        const isFinal = game.status.type.state === 'post';

                        return (
                            <div
                                key={game.id}
                                className={`bg-navy-900 border rounded-xl p-4 transition ${isLive
                                    ? 'border-brandred-600/50'
                                    : 'border-[rgba(230,206,150,0.16)] hover:border-[rgba(230,206,150,0.35)]'
                                    }`}
                            >
                                {/* Date/Time Row */}
                                <div className="flex justify-between items-center mb-1 text-[10px] text-[#9FB0CC]/70 num uppercase">
                                    <span>{new Date(game.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                                    <span>{new Date(game.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>

                                {/* Status Row */}
                                <div className="flex justify-between items-center mb-4">
                                    {getStatusBadge(game)}
                                    <span className="text-xs text-[#9FB0CC] font-medium whitespace-nowrap num">
                                        {getGameClock(game)}
                                    </span>
                                </div>

                                {/* Teams */}
                                <div className="space-y-3">
                                    {/* Away Team */}
                                    <div className={`flex items-center justify-between ${isFinal && !awayTeam?.winner ? 'opacity-50' : ''}`}>
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={awayTeam?.team.logo || getTeamLogo(awayTeam?.team.displayName || '') || '/placeholder-team.png'}
                                                alt={awayTeam?.team.abbreviation || 'TBD'}
                                                loading="lazy"
                                                className="w-8 h-8 object-contain"
                                                onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-team.png'; }}
                                            />
                                            <div>
                                                <p className="font-display font-bold text-white leading-none">{awayTeam?.team.abbreviation}</p>
                                                <p className="text-[10px] text-[#9FB0CC]/70 mt-1">{awayTeam?.team.displayName}</p>
                                            </div>
                                        </div>
                                        <span className={`text-2xl font-display font-bold num ${awayTeam?.winner ? 'text-gold-400' : 'text-white'}`}>
                                            {awayTeam?.score || '0'}
                                        </span>
                                    </div>

                                    {/* Home Team */}
                                    <div className={`flex items-center justify-between ${isFinal && !homeTeam?.winner ? 'opacity-50' : ''}`}>
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={homeTeam?.team.logo || getTeamLogo(homeTeam?.team.displayName || '') || '/placeholder-team.png'}
                                                alt={homeTeam?.team.abbreviation || 'TBD'}
                                                loading="lazy"
                                                className="w-8 h-8 object-contain"
                                                onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-team.png'; }}
                                            />
                                            <div>
                                                <p className="font-display font-bold text-white leading-none">{homeTeam?.team.abbreviation}</p>
                                                <p className="text-[10px] text-[#9FB0CC]/70 mt-1">{homeTeam?.team.displayName}</p>
                                            </div>
                                        </div>
                                        <span className={`text-2xl font-display font-bold num ${homeTeam?.winner ? 'text-gold-400' : 'text-white'}`}>
                                            {homeTeam?.score || '0'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-navy-950 text-[#EDF1F8] font-body">
            {/* T2: the sport tab is in memory. Published so the Help panel can
                tell the three scoreboards apart. The page copy is T3. */}
            <HelpRoutePublisher tab={activeTab} />
            <Header
                user={user}
                isManager={false}
                onOpenAuth={onOpenAuth}
                onLogout={onLogout}
                onCreatePool={onCreatePool}
            />

            <main className="max-w-6xl mx-auto p-4 md:p-8 mt-6">
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h1 className="text-3xl font-display font-extrabold uppercase leading-none text-white flex items-center gap-3">
                            <Trophy className="text-gold-500" /> Live Scoreboard
                        </h1>
                        <p className="text-[#9FB0CC] mt-1">Real-time scores from ESPN</p>
                    </div>

                    <div className="flex items-center gap-4">
                        {lastUpdated && (
                            <span className="text-xs text-[#9FB0CC] num">
                                Updated: {lastUpdated.toLocaleTimeString()}
                            </span>
                        )}
                        <label className="flex items-center gap-2 text-sm text-[#9FB0CC] cursor-pointer">
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={() => setAutoRefresh(!autoRefresh)}
                                className="accent-gold-500"
                            />
                            Auto-refresh
                        </label>
                        <button
                            onClick={fetchScores}
                            disabled={loading}
                            className="bg-brandred-600 hover:bg-brandred-500 text-white px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 disabled:opacity-50 transition-colors duration-150 shadow-red-cta"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-6">
                    <button
                        onClick={() => setActiveTab('nfl')}
                        className={`px-6 py-3 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm transition duration-150 flex items-center gap-2 ${activeTab === 'nfl' ? 'bg-gold-foil text-navy-900' : 'bg-navy-900 text-[#9FB0CC] hover:bg-navy-800'}`}
                    >
                        <Shield size={16} /> NFL
                    </button>
                    <button
                        onClick={() => setActiveTab('college')}
                        className={`px-6 py-3 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm transition duration-150 flex items-center gap-2 ${activeTab === 'college' ? 'bg-gold-foil text-navy-900' : 'bg-navy-900 text-[#9FB0CC] hover:bg-navy-800'}`}
                    >
                        <GraduationCap size={16} /> College Football
                    </button>
                    <button
                        onClick={() => setActiveTab('basketball')}
                        className={`px-6 py-3 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm transition duration-150 flex items-center gap-2 ${activeTab === 'basketball' ? 'bg-gold-foil text-navy-900' : 'bg-navy-900 text-[#9FB0CC] hover:bg-navy-800'}`}
                    >
                        <Volleyball size={16} /> NCAA Basketball
                    </button>
                </div>

                {/* Error State */}
                {error && (
                    <div className="bg-navy-900 border border-brandred-600/60 text-brandred-500 p-4 rounded-lg mb-6">
                        {error}
                    </div>
                )}

                {/* Loading State */}
                {loading && games.length === 0 && (
                    <div className="text-center py-20">
                        <RefreshCw className="animate-spin inline-block mb-4 text-gold-500" size={48} />
                        <p className="text-[#9FB0CC]">Loading scores...</p>
                    </div>
                )}

                {/* No Games - only for non-basketball tabs */}
                {!loading && games.length === 0 && activeTab !== 'basketball' && (
                    <div className="text-center py-20 bg-navy-900 rounded-xl border border-[rgba(230,206,150,0.16)]">
                        <Calendar size={48} className="mx-auto text-[#9FB0CC]/50 mb-4" />
                        <h3 className="text-xl font-display font-bold uppercase text-white mb-2">No Games Found</h3>
                        <p className="text-[#9FB0CC]">No games scheduled for this period.</p>
                    </div>
                )}

                {/* categorized games sections */}
                {!loading && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                        {/* Basketball: always show LIVE section first */}
                        {activeTab === 'basketball' && renderLiveSection(categorizedGames.live)}

                        {/* Non-basketball: show live games if any */}
                        {activeTab !== 'basketball' && renderGameSection('Live Games', categorizedGames.live, <PlayCircle className="text-brandred-500 animate-live-pulse" />, 'border-brandred-600/30')}

                        {games.length > 0 && (
                            <>
                                {renderGameSection('Completed Games', categorizedGames.completed, <Trophy className="text-[#9FB0CC]" />)}
                                {renderGameSection('Upcoming Games', categorizedGames.upcoming, <Calendar className="text-gold-500" />, 'border-gold-500/30')}
                            </>
                        )}

                        {!loading && games.length === 0 && activeTab !== 'basketball' && (
                            <div className="text-center py-20 bg-navy-900 rounded-xl border border-[rgba(230,206,150,0.16)]">
                                <Calendar size={48} className="mx-auto text-[#9FB0CC]/50 mb-4" />
                                <h3 className="text-xl font-display font-bold uppercase text-white mb-2">No Games Found</h3>
                                <p className="text-[#9FB0CC]">No games scheduled for this period.</p>
                            </div>
                        )}
                    </div>
                )}
            </main>

            <Footer />
        </div>
    );
};
