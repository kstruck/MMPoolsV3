import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trophy, PlayCircle, Calendar } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { getTeamLogo } from '../constants';
import type { User } from '../types';

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
    const [activeTab, setActiveTab] = useState<'nfl' | 'college'>('nfl');
    const [games, setGames] = useState<Game[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const fetchScores = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const leaguePath = activeTab === 'college' ? 'college-football' : 'nfl';

            // Calculate date range: Past 7 days to Next 7 days
            const today = new Date();
            const past = new Date(today);
            past.setDate(today.getDate() - 7);
            const future = new Date(today);
            future.setDate(today.getDate() + 7);

            const formatDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
            const dateStr = `${formatDate(past)}-${formatDate(future)}`;

            const url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/scoreboard?dates=${dateStr}&limit=200`;

            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch scores');

            const data = await response.json();
            setGames(data.events || []);
            setLastUpdated(new Date());
        } catch (err: any) {
            setError(err.message || 'Failed to load scores');
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
                <span className="flex items-center gap-1 text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded text-xs font-bold animate-pulse">
                    <PlayCircle size={12} /> LIVE
                </span>
            );
        }
        if (state === 'post') {
            return (
                <span className="flex items-center gap-1 text-slate-400 bg-slate-700 px-2 py-1 rounded text-xs font-bold">
                    <Trophy size={12} /> FINAL
                </span>
            );
        }
        return (
            <span className="flex items-center gap-1 text-amber-400 bg-amber-500/20 px-2 py-1 rounded text-xs font-bold">
                <Calendar size={12} /> {new Date(game.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
        );
    };

    const getGameClock = (game: Game) => {
        const state = game.status.type.state;
        if (state === 'in') {
            const period = game.status.period;
            const clock = game.status.displayClock || '';
            const qLabel = period <= 4 ? `Q${period}` : 'OT';
            return `${qLabel} ${clock}`;
        }
        if (state === 'post') return 'Final';
        return '';
    };

    const renderGameSection = (title: string, gamesList: Game[], icon: React.ReactNode, borderColor: string = 'border-slate-700') => {
        if (gamesList.length === 0) return null;

        return (
            <div className="space-y-4 mb-10">
                <h3 className={`text-xl font-bold text-white flex items-center gap-2 border-b ${borderColor} pb-2`}>
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
                                className={`bg-slate-800/50 border rounded-xl p-4 transition-all ${isLive
                                    ? 'border-emerald-500/50 bg-emerald-500/5'
                                    : 'border-slate-700 hover:border-slate-600'
                                    }`}
                            >
                                {/* Date/Time Row */}
                                <div className="flex justify-between items-center mb-1 text-[10px] text-slate-500 font-mono uppercase">
                                    <span>{new Date(game.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                                    <span>{new Date(game.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>

                                {/* Status Row */}
                                <div className="flex justify-between items-center mb-4">
                                    {getStatusBadge(game)}
                                    <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
                                        {getGameClock(game)}
                                    </span>
                                </div>

                                {/* Teams */}
                                <div className="space-y-3">
                                    {/* Away Team */}
                                    <div className={`flex items-center justify-between ${isFinal && !awayTeam?.winner ? 'opacity-50' : ''}`}>
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={awayTeam?.team.logo || getTeamLogo(awayTeam?.team.displayName || '') || ''}
                                                alt={awayTeam?.team.abbreviation}
                                                className="w-8 h-8 object-contain"
                                                onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-team.png'; }}
                                            />
                                            <div>
                                                <p className="font-bold text-white leading-none">{awayTeam?.team.abbreviation}</p>
                                                <p className="text-[10px] text-slate-500 mt-1">{awayTeam?.team.displayName}</p>
                                            </div>
                                        </div>
                                        <span className={`text-2xl font-bold font-mono ${awayTeam?.winner ? 'text-emerald-400' : 'text-white'}`}>
                                            {awayTeam?.score || '0'}
                                        </span>
                                    </div>

                                    {/* Home Team */}
                                    <div className={`flex items-center justify-between ${isFinal && !homeTeam?.winner ? 'opacity-50' : ''}`}>
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={homeTeam?.team.logo || getTeamLogo(homeTeam?.team.displayName || '') || ''}
                                                alt={homeTeam?.team.abbreviation}
                                                className="w-8 h-8 object-contain"
                                                onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-team.png'; }}
                                            />
                                            <div>
                                                <p className="font-bold text-white leading-none">{homeTeam?.team.abbreviation}</p>
                                                <p className="text-[10px] text-slate-500 mt-1">{homeTeam?.team.displayName}</p>
                                            </div>
                                        </div>
                                        <span className={`text-2xl font-bold font-mono ${homeTeam?.winner ? 'text-emerald-400' : 'text-white'}`}>
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
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
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
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <Trophy className="text-emerald-500" /> Live Scoreboard
                        </h1>
                        <p className="text-slate-400 mt-1">Real-time scores from ESPN</p>
                    </div>

                    <div className="flex items-center gap-4">
                        {lastUpdated && (
                            <span className="text-xs text-slate-500">
                                Updated: {lastUpdated.toLocaleTimeString()}
                            </span>
                        )}
                        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={() => setAutoRefresh(!autoRefresh)}
                                className="accent-indigo-500"
                            />
                            Auto-refresh
                        </label>
                        <button
                            onClick={fetchScores}
                            disabled={loading}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-6">
                    <button
                        onClick={() => setActiveTab('nfl')}
                        className={`px-6 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'nfl' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                    >
                        🏈 NFL
                    </button>
                    <button
                        onClick={() => setActiveTab('college')}
                        className={`px-6 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'college' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                    >
                        🏟️ College Football
                    </button>
                </div>

                {/* Error State */}
                {error && (
                    <div className="bg-rose-500/20 border border-rose-500 text-rose-400 p-4 rounded-lg mb-6">
                        {error}
                    </div>
                )}

                {/* Loading State */}
                {loading && games.length === 0 && (
                    <div className="text-center py-20">
                        <RefreshCw className="animate-spin inline-block mb-4 text-indigo-500" size={48} />
                        <p className="text-slate-400">Loading scores...</p>
                    </div>
                )}

                {/* No Games */}
                {!loading && games.length === 0 && (
                    <div className="text-center py-20 bg-slate-800/50 rounded-xl border border-slate-700">
                        <Calendar size={48} className="mx-auto text-slate-600 mb-4" />
                        <h3 className="text-xl font-bold text-white mb-2">No Games Found</h3>
                        <p className="text-slate-400">No games scheduled for this period.</p>
                    </div>
                )}

                {/* categorized games sections */}
                {!loading && games.length > 0 && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                        {renderGameSection('Live Games', categorizedGames.live, <PlayCircle className="text-emerald-500 animate-pulse" />, 'border-emerald-500/30')}
                        {renderGameSection('Upcoming Games', categorizedGames.upcoming, <Calendar className="text-amber-500" />, 'border-amber-500/30')}
                        {renderGameSection('Completed Games - Recent', categorizedGames.completed, <Trophy className="text-slate-500" />)}
                    </div>
                )}
            </main>

            <Footer />
        </div>
    );
};
