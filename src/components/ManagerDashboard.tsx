import React, { useState, useMemo } from 'react';
import { Search, Filter, Heart, DollarSign, Trophy, Plus, Zap, Globe, Lock, Trash2, LayoutDashboard, Archive, RotateCcw, Copy } from 'lucide-react';
import type { GameState, Pool } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';
import { getTeamLogo } from '../constants';
import { Loader } from 'lucide-react';

interface ManagerDashboardProps {
    user: any; // Using any for User type for simplicity as imports might vary, strictly it's User
    pools: Pool[];
    isLoading: boolean;
    connectionError: string | null;
    onCreatePool: () => void;
    onDeletePool: (id: string) => void;
    onArchivePool?: (id: string, archive: boolean) => void;
    onDuplicatePool?: (id: string) => void;
    onOpenAuth: () => void;
    onLogout: () => void;
}

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({
    user,
    pools,
    isLoading,
    connectionError,
    onCreatePool,
    onDeletePool,
    onArchivePool,
    onDuplicatePool,
    onOpenAuth,
    onLogout
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [archiveTab, setArchiveTab] = useState<'active' | 'archived'>('active');
    const [filterCharity, setFilterCharity] = useState(false);
    const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'locked' | 'live' | 'final'>('all');
    const [filterPrice, setFilterPrice] = useState<'all' | 'low' | 'mid' | 'high'>('all'); // low < 10, mid 10-50, high > 50
    const [selectedLeague, setSelectedLeague] = useState<string>('all');

    // Filter Logic
    const filteredPools = useMemo(() => {
        return pools.filter(p => {
            // Archive Tab Filter
            const poolStatus = (p as GameState).status || 'active';
            if (archiveTab === 'active' && poolStatus === 'archived') return false;
            if (archiveTab === 'archived' && poolStatus !== 'archived') return false;

            // Search Match
            const searchLower = searchTerm.toLowerCase();
            const isBracket = p.type === 'BRACKET';
            const matchesSearch =
                p.name.toLowerCase().includes(searchLower) ||
                (!isBracket && (p as GameState).homeTeam.toLowerCase().includes(searchLower)) ||
                (!isBracket && (p as GameState).awayTeam.toLowerCase().includes(searchLower));

            if (!matchesSearch) return false;

            // Charity Filter
            if (filterCharity && (isBracket || !(p as GameState).charity?.enabled)) return false;

            // Status Filter
            if (filterStatus !== 'all') {
                let isClosed = false;
                let isLive = false;
                let isLocked = false;

                if (isBracket) {
                    const bp = p as any; // BracketPool
                    isClosed = bp.status === 'COMPLETED';
                    isLocked = bp.status === 'LOCKED' || bp.status === 'COMPLETED';
                    // isLive not really applicable or checked via dates
                } else {
                    const sp = p as GameState;
                    isClosed = sp.scores.gameStatus === 'post';
                    isLive = sp.scores.gameStatus === 'in';
                    isLocked = sp.isLocked;
                }

                if (filterStatus === 'open' && isLocked) return false;
                if (filterStatus === 'locked' && (!isLocked || isLive || isClosed)) return false;
                if (filterStatus === 'live' && !isLive) return false;
                if (filterStatus === 'final' && !isClosed) return false;
            }

            // Price Filter
            if (filterPrice !== 'all') {
                const cost = isBracket ? (p as any).settings?.entryFee : (p as GameState).costPerSquare;
                if (filterPrice === 'low' && cost >= 20) return false;
                if (filterPrice === 'mid' && (cost < 20 || cost > 50)) return false;
                if (filterPrice === 'high' && cost <= 50) return false;
            }

            // League Filter
            if (selectedLeague !== 'all') {
                if (selectedLeague === 'brackets') {
                    if (!isBracket) return false;
                } else {
                    if (isBracket) return false;
                    const poolLeague = (p as any).league || 'nfl';
                    const isCollege = poolLeague === 'college' || poolLeague === 'ncaa';
                    const isNfl = poolLeague === 'nfl';

                    if (selectedLeague === 'nfl' && !isNfl) return false;
                    if (selectedLeague === 'college' && !isCollege) return false;
                }
            }

            return true;
        });
    }, [pools, searchTerm, filterCharity, filterStatus, filterPrice, selectedLeague, archiveTab]);

    if (!user) {
        return (
            <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
                <div className="text-center">
                    <p className="mb-4 text-slate-400">Please sign in to access the dashboard.</p>
                    <button onClick={onOpenAuth} className="bg-indigo-600 px-4 py-2 rounded-lg text-white font-bold">Sign In</button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
            <Header
                user={user}
                isManager={true}
                onOpenAuth={onOpenAuth}
                onLogout={onLogout}
                onCreatePool={onCreatePool}
            />

            <main className="max-w-7xl mx-auto p-4 md:p-8 mt-6">
                <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-6 border-b border-slate-800 pb-8">
                    <div>
                        <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                            <LayoutDashboard className="text-indigo-500" /> Manage My Pools
                        </h2>
                        <p className="text-slate-400 mt-2">Create, edit, and manage your Game Day Squares pools.</p>
                    </div>
                    <button onClick={onCreatePool} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all hover:scale-105">
                        <Plus size={20} /> Create New Pool
                    </button>
                </div>

                {connectionError && (
                    <div className="bg-rose-500/10 border border-rose-500 text-rose-400 p-4 rounded mb-6 flex items-center gap-3 animate-pulse">
                        <Zap className="text-rose-500" />
                        <div>
                            <p className="font-bold">Connection Fail</p>
                            <p className="text-sm">{connectionError}. Check your configuration.</p>
                        </div>
                    </div>
                )}

                {isLoading ? (
                    <div className="text-center py-20">
                        <Loader className="animate-spin inline-block mb-4 text-indigo-500" size={48} />
                        <p className="text-slate-400 font-medium">Loading your pools...</p>
                    </div>
                ) : pools.length === 0 ? (
                    <div className="text-center py-20 bg-slate-800/50 rounded-xl border border-slate-700 border-dashed">
                        <Globe size={48} className="mx-auto text-slate-600 mb-4" />
                        <h3 className="text-xl font-bold text-white mb-2">No Pools Yet</h3>
                        <p className="text-slate-400 font-medium mb-6">Get started by creating your first Game Day Squares pool!</p>
                        <button onClick={onCreatePool} className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded-lg font-bold transition-colors">
                            Create Pool
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                        {/* Sidebar Filters */}
                        <div className="space-y-6">
                            {/* Search */}
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search your pools..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 px-4 pl-10 text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                                />
                                <Search className="absolute left-3 top-3.5 text-slate-500" size={18} />
                            </div>

                            {/* Sport Filter */}
                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <Trophy size={14} /> Sport / League
                                </h3>
                                <div className="flex flex-col gap-2">
                                    {[
                                        { id: 'all', label: 'All Sports', active: true },
                                        { id: 'nfl', label: 'NFL Football', active: true },
                                        { id: 'college', label: 'NCAA Football', active: true },
                                        { id: 'brackets', label: 'March Madness', active: true },
                                        { id: 'nba', label: 'NBA', active: false },
                                        { id: 'ncaa_bb', label: 'NCAA Basketball', active: false },
                                    ].map((sport) => (
                                        <button
                                            key={sport.id}
                                            onClick={() => sport.active && setSelectedLeague(sport.id)}
                                            disabled={!sport.active}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex justify-between items-center ${!sport.active
                                                ? 'opacity-40 cursor-not-allowed text-slate-500 hover:bg-transparent'
                                                : selectedLeague === sport.id
                                                    ? 'bg-indigo-600 text-white'
                                                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                                }`}
                                        >
                                            <span>{sport.label}</span>
                                            {!sport.active && <span className="text-[10px] uppercase font-bold bg-slate-800 px-1.5 py-0.5 rounded">Soon</span>}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Status Filters */}
                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <Filter size={14} /> Pool Status
                                </h3>
                                <div className="space-y-2">
                                    {[
                                        { id: 'all', label: 'All Pools', count: pools.length },
                                        { id: 'open', label: 'Open for Entry', count: pools.filter(p => p.type === 'BRACKET' ? p.status === 'PUBLISHED' : !(p as GameState).isLocked).length },
                                        { id: 'live', label: 'Live Now', count: pools.filter(p => p.type !== 'BRACKET' && (p as GameState).scores.gameStatus === 'in').length },
                                        { id: 'final', label: 'Completed', count: pools.filter(p => p.type === 'BRACKET' ? p.status === 'COMPLETED' : (p as GameState).scores.gameStatus === 'post').length },
                                    ].map((stat) => (
                                        <label key={stat.id} className="flex items-center justify-between cursor-pointer group p-2 rounded hover:bg-slate-800 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${filterStatus === stat.id ? 'border-indigo-500 bg-indigo-500' : 'border-slate-600 bg-transparent'}`}>
                                                    {filterStatus === stat.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                                </div>
                                                <input type="radio" name="status" className="hidden" checked={filterStatus === stat.id} onChange={() => setFilterStatus(stat.id as any)} />
                                                <span className={`text-sm font-medium ${filterStatus === stat.id ? 'text-white' : 'text-slate-400 group-hover:text-slate-300'}`}>{stat.label}</span>
                                            </div>
                                            <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">{stat.count}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Price Filter */}
                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <DollarSign size={14} /> Entry Cost
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { id: 'all', label: 'Any' },
                                        { id: 'low', label: '< $20' },
                                        { id: 'mid', label: '$20 - $50' },
                                        { id: 'high', label: '$50+' },
                                    ].map((price) => (
                                        <button
                                            key={price.id}
                                            onClick={() => setFilterPrice(price.id as any)}
                                            className={`text-xs px-3 py-1.5 rounded-lg border font-bold transition-all ${filterPrice === price.id ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                        >
                                            {price.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Toggles */}
                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                                <label className="flex items-center justify-between cursor-pointer group">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1.5 rounded-lg transition-colors ${filterCharity ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-500'}`}><Heart size={16} className={filterCharity ? "fill-white" : ""} /></div>
                                        <span className={`text-sm font-medium ${filterCharity ? 'text-white' : 'text-slate-400 group-hover:text-slate-300'}`}>Charity Pools Only</span>
                                    </div>
                                    <div className={`w-10 h-5 rounded-full relative transition-colors ${filterCharity ? 'bg-rose-500' : 'bg-slate-700'}`} onClick={() => setFilterCharity(!filterCharity)}>
                                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${filterCharity ? 'left-6' : 'left-1'}`} />
                                    </div>
                                </label>
                            </div>
                        </div>

                        {/* Grid Results */}
                        <div className="lg:col-span-3">
                            {/* Active/Archived Tabs */}
                            <div className="flex gap-2 mb-6">
                                <button
                                    onClick={() => setArchiveTab('active')}
                                    className={`px-4 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2 ${archiveTab === 'active' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                                >
                                    <Globe size={16} /> Active
                                </button>
                                <button
                                    onClick={() => setArchiveTab('archived')}
                                    className={`px-4 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2 ${archiveTab === 'archived' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                                >
                                    <Archive size={16} /> Archived
                                </button>
                            </div>

                            {filteredPools.length === 0 ? (
                                <div className="col-span-1 md:col-span-2 py-20 text-center text-slate-500 border border-slate-800 border-dashed rounded-xl bg-slate-900/30">
                                    <p className="mb-2 font-medium text-slate-400">
                                        {archiveTab === 'archived' ? 'No archived pools.' : 'No pools match your filters.'}
                                    </p>
                                    {archiveTab === 'active' && (
                                        <button onClick={() => { setSearchTerm(''); setFilterStatus('all'); setFilterPrice('all'); setFilterCharity(false); setSelectedLeague('all'); }} className="text-indigo-400 hover:text-indigo-300 underline text-sm">Clear all filters</button>
                                    )}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {filteredPools.map(pool => {
                                        const isBracket = pool.type === 'BRACKET';
                                        let filled = 0;
                                        let pct = 0;
                                        let homeLogo = null;
                                        let awayLogo = null;
                                        let homeTeam = '';
                                        let awayTeam = '';
                                        let cost = 0;
                                        let isLocked = false;
                                        let charityEnabled = false;

                                        if (isBracket) {
                                            const bp = pool as any; // BracketPool
                                            filled = bp.entryCount || 0;
                                            const max = bp.settings.maxEntriesTotal === -1 ? 100 : bp.settings.maxEntriesTotal; // Mock 100 if unlimited for progress
                                            pct = bp.settings.maxEntriesTotal === -1 ? 0 : Math.round((filled / max) * 100);
                                            homeTeam = 'Tournament';
                                            awayTeam = 'Bracket';
                                            cost = bp.settings.entryFee;
                                            isLocked = bp.status !== 'DRAFT' && bp.status !== 'PUBLISHED';
                                        } else {
                                            const sp = pool as GameState;
                                            filled = sp.squares.filter(s => s.owner).length;
                                            pct = Math.round((filled / 100) * 100);
                                            homeTeam = sp.homeTeam;
                                            awayTeam = sp.awayTeam;
                                            homeLogo = sp.homeTeamLogo || getTeamLogo(sp.homeTeam);
                                            awayLogo = sp.awayTeamLogo || getTeamLogo(sp.awayTeam);
                                            cost = sp.costPerSquare;
                                            isLocked = sp.isLocked;
                                            charityEnabled = !!sp.charity?.enabled;
                                        }

                                        return (
                                            <div key={pool.id} className="group bg-slate-900/50 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-800 rounded-xl p-5 transition-all relative overflow-hidden flex flex-col">
                                                {charityEnabled && (
                                                    <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                                                        <Heart size={100} className="fill-rose-500 text-rose-500" />
                                                    </div>
                                                )}

                                                {/* CLICKABLE AREA FOR MANAGE */}
                                                <div className="cursor-pointer flex-1" onClick={() => window.location.hash = `#admin/${pool.id}`}>
                                                    <div className="flex justify-between items-start mb-4 relative z-10">
                                                        <div className="flex items-center gap-3">
                                                            {/* Initial Icon */}
                                                            <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-lg font-bold text-indigo-400 group-hover:scale-105 transition-transform">
                                                                {pool.name.substring(0, 2).toUpperCase()}
                                                            </div>
                                                            <div>
                                                                <h3 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors line-clamp-1 flex items-center gap-2">
                                                                    {pool.name}
                                                                    {!(isBracket ? (pool as any).isListedPublic : (pool as GameState).isPublic) && <Lock size={12} className="text-amber-500" />}
                                                                </h3>
                                                                <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                                                                    <span>{isBracket ? 'Bracket Pool' : 'Squares Pool'}</span>
                                                                    {charityEnabled && <span className="text-rose-400 flex items-center gap-1">• <Heart size={10} className="fill-rose-400" /> Charity</span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <span className="block text-xl font-bold text-emerald-400 font-mono">${cost}</span>
                                                            <span className="text-[10px] text-slate-500 uppercase font-bold">{isBracket ? 'Entry Fee' : 'Per Square'}</span>
                                                        </div>
                                                    </div>

                                                    {/* Matchup */}
                                                    <div className="bg-black/30 rounded-lg p-3 border border-slate-800/50 mb-4 relative z-10">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="flex items-center gap-2">
                                                                {awayLogo && <img src={awayLogo} className="w-6 h-6 object-contain opacity-80" />}
                                                                <span className="text-sm font-bold text-slate-300">{awayTeam}</span>
                                                            </div>
                                                            <span className="text-xs text-slate-600 font-bold uppercase">VS</span>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-bold text-slate-300">{homeTeam}</span>
                                                                {homeLogo && <img src={homeLogo} className="w-6 h-6 object-contain opacity-80" />}
                                                            </div>
                                                        </div>
                                                        <div className="text-center">
                                                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                                                                {isBracket ? (
                                                                    (pool as any).lockAt ? new Date((pool as any).lockAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date TBD'
                                                                ) : (
                                                                    (pool as GameState).scores.startTime ? new Date((pool as GameState).scores.startTime!).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date TBD'
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Progress & Meta */}
                                                    <div className="flex items-center justify-between text-xs font-medium text-slate-400 relative z-10 mb-6">
                                                        <div className="flex items-center gap-4">
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                                                                </div>
                                                                <span>{isBracket ? `${filled} Entries` : `${100 - filled} Left`}</span>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2">
                                                            {!isLocked ? (
                                                                <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Open</span>
                                                            ) : (
                                                                <span className="text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">Locked</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* ACTION BUTTONS */}
                                                <div className="grid grid-cols-12 gap-2 relative z-20 pt-4 border-t border-slate-800/50">
                                                    <button onClick={(e) => { e.stopPropagation(); window.location.hash = `#admin/${pool.id}`; }} className="col-span-4 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg font-bold text-xs transition-colors shadow-lg shadow-indigo-500/20">Manage</button>
                                                    <button onClick={(e) => { e.stopPropagation(); window.location.hash = `#pool/${pool.id}`; }} className="col-span-3 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white py-2 rounded-lg font-bold text-xs transition-colors border border-slate-700">View</button>
                                                    {onDuplicatePool && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onDuplicatePool(pool.id); }}
                                                            className="col-span-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg flex items-center justify-center transition-all border border-slate-700"
                                                            title="Duplicate Pool"
                                                        >
                                                            <Copy size={14} />
                                                        </button>
                                                    )}
                                                    {onArchivePool && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onArchivePool(pool.id, archiveTab !== 'archived'); }}
                                                            className={`col-span-2 rounded-lg flex items-center justify-center transition-all border ${archiveTab === 'archived'
                                                                    ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20'
                                                                    : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/20'
                                                                }`}
                                                            title={archiveTab === 'archived' ? 'Restore Pool' : 'Archive Pool'}
                                                        >
                                                            {archiveTab === 'archived' ? <RotateCcw size={14} /> : <Archive size={14} />}
                                                        </button>
                                                    )}
                                                    <button onClick={(e) => { e.stopPropagation(); onDeletePool(pool.id); }} className="col-span-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 hover:border-rose-500/50 rounded-lg flex items-center justify-center transition-all"><Trash2 size={14} /></button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </main>
            <Footer />
        </div>
    );
};
