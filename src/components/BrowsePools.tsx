
import React, { useState, useMemo } from 'react';
import { Search, Filter, Heart, DollarSign } from 'lucide-react';
import type { GameState, User } from '../types';
import { Header } from './Header';
import { getTeamLogo } from '../constants';

interface BrowsePoolsProps {
    user: User | null;
    pools: GameState[];
    onOpenAuth: () => void;
    onLogout: () => void;
}

export const BrowsePools: React.FC<BrowsePoolsProps> = ({ user, pools, onOpenAuth, onLogout }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCharity, setFilterCharity] = useState(false);
    const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'locked' | 'live' | 'final'>('all');
    const [filterPrice, setFilterPrice] = useState<'all' | 'low' | 'mid' | 'high'>('all'); // low < 10, mid 10-50, high > 50

    // Filter Logic
    const filteredPools = useMemo(() => {
        return pools.filter(p => {
            if (!p.isPublic) return false;

            // Search Match
            const searchLower = searchTerm.toLowerCase();
            const matchesSearch =
                p.name.toLowerCase().includes(searchLower) ||
                p.homeTeam.toLowerCase().includes(searchLower) ||
                p.awayTeam.toLowerCase().includes(searchLower) ||
                (p.contactEmail || '').toLowerCase().includes(searchLower);

            if (!matchesSearch) return false;

            // Charity Filter
            if (filterCharity && !p.charity?.enabled) return false;

            // Status Filter
            if (filterStatus !== 'all') {
                const isClosed = p.scores.gameStatus === 'post';
                const isLive = p.scores.gameStatus === 'in';
                const isLocked = p.isLocked;

                if (filterStatus === 'open' && isLocked) return false;
                if (filterStatus === 'locked' && (!isLocked || isLive || isClosed)) return false;
                if (filterStatus === 'live' && !isLive) return false;
                if (filterStatus === 'final' && !isClosed) return false;
            }

            // Price Filter
            if (filterPrice !== 'all') {
                const cost = p.costPerSquare;
                if (filterPrice === 'low' && cost >= 20) return false;
                if (filterPrice === 'mid' && (cost < 20 || cost > 50)) return false;
                if (filterPrice === 'high' && cost <= 50) return false;
            }

            return true;
        });
    }, [pools, searchTerm, filterCharity, filterStatus, filterPrice]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
            <Header user={user} onOpenAuth={onOpenAuth} onLogout={onLogout} />

            <main className="max-w-7xl mx-auto p-4 md:p-8 mt-6">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row justify-between items-end mb-10 gap-6 border-b border-slate-800 pb-8">
                    <div>
                        <h2 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Public Grids</h2>
                        <p className="text-slate-400 max-w-xl">
                            Join active Super Bowl squares pools, compete for prizes, and support charities.
                            Find the perfect grid for your budget and team allegiance.
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-lg text-center">
                            <span className="block text-2xl font-bold text-white">{pools.filter(p => p.isPublic).length}</span>
                            <span className="text-xs text-slate-500 font-bold uppercase">Active Pools</span>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-lg text-center">
                            <span className="block text-2xl font-bold text-emerald-400">
                                ${pools.filter(p => p.isPublic).reduce((acc, p) => acc + (p.squares.filter(s => s.owner).length * p.costPerSquare), 0).toLocaleString()}
                            </span>
                            <span className="text-xs text-slate-500 font-bold uppercase">Total Pot</span>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-lg text-center border-l-4 border-l-rose-500">
                            <span className="block text-2xl font-bold text-white">
                                ${pools.filter(p => p.isPublic && p.charity?.enabled).reduce((acc, p) => acc + (p.squares.filter(s => s.owner).length * p.costPerSquare * (p.charity!.percentage / 100)), 0).toLocaleString()}
                            </span>
                            <span className="text-xs text-slate-500 font-bold uppercase flex items-center gap-1 justify-center"><Heart size={10} className="text-rose-500" /> Raised</span>
                        </div>
                    </div>
                </div>

                {/* Filters & Search Row */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Sidebar Filters */}
                    <div className="space-y-6">
                        {/* Search */}
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search teams, pools..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 px-4 pl-10 text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                            />
                            <Search className="absolute left-3 top-3.5 text-slate-500" size={18} />
                        </div>

                        {/* Status Filters */}
                        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <Filter size={14} /> Pool Status
                            </h3>
                            <div className="space-y-2">
                                {[
                                    { id: 'all', label: 'All Pools', count: pools.filter(p => p.isPublic).length },
                                    { id: 'open', label: 'Open for Entry', count: pools.filter(p => p.isPublic && !p.isLocked).length },
                                    { id: 'live', label: 'Live Now', count: pools.filter(p => p.isPublic && p.scores.gameStatus === 'in').length },
                                    { id: 'final', label: 'Completed', count: pools.filter(p => p.isPublic && p.scores.gameStatus === 'post').length },
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredPools.map(pool => {
                                const filled = pool.squares.filter(s => s.owner).length;
                                const pct = Math.round((filled / 100) * 100);
                                const homeLogo = pool.homeTeamLogo || getTeamLogo(pool.homeTeam);
                                const awayLogo = pool.awayTeamLogo || getTeamLogo(pool.awayTeam);

                                return (
                                    <div key={pool.id} onClick={() => window.location.hash = `#pool/${pool.id}`} className="group bg-slate-900/50 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-800 rounded-xl p-5 cursor-pointer transition-all relative overflow-hidden">
                                        {pool.charity?.enabled && (
                                            <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                                                <Heart size={100} className="fill-rose-500 text-rose-500" />
                                            </div>
                                        )}

                                        <div className="flex justify-between items-start mb-4 relative z-10">
                                            <div className="flex items-center gap-3">
                                                {/* Initial Icon */}
                                                <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-lg font-bold text-indigo-400 group-hover:scale-105 transition-transform">
                                                    {pool.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors line-clamp-1">{pool.name}</h3>
                                                    <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                                                        <span>Hosted by {pool.contactEmail ? pool.contactEmail.split('@')[0] : 'Admin'}</span>
                                                        {pool.charity?.enabled && <span className="text-rose-400 flex items-center gap-1">• <Heart size={10} className="fill-rose-400" /> Charity</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="block text-xl font-bold text-emerald-400 font-mono">${pool.costPerSquare}</span>
                                                <span className="text-[10px] text-slate-500 uppercase font-bold">Per Square</span>
                                            </div>
                                        </div>

                                        {/* Matchup */}
                                        <div className="bg-black/30 rounded-lg p-3 border border-slate-800/50 mb-4 flex items-center justify-between relative z-10">
                                            <div className="flex items-center gap-2">
                                                {awayLogo && <img src={awayLogo} className="w-6 h-6 object-contain opacity-80" />}
                                                <span className="text-sm font-bold text-slate-300">{pool.awayTeam}</span>
                                            </div>
                                            <span className="text-xs text-slate-600 font-bold uppercase">VS</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-slate-300">{pool.homeTeam}</span>
                                                {homeLogo && <img src={homeLogo} className="w-6 h-6 object-contain opacity-80" />}
                                            </div>
                                        </div>

                                        {/* Progress & Meta */}
                                        <div className="flex items-center justify-between text-xs font-medium text-slate-400 relative z-10">
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                        <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                                                    </div>
                                                    <span>{100 - filled} Left</span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {!pool.isLocked ? (
                                                    <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Open Entry</span>
                                                ) : (
                                                    <span className="text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">Locked</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                            {filteredPools.length === 0 && (
                                <div className="col-span-1 md:col-span-2 py-20 text-center text-slate-500 border border-slate-800 border-dashed rounded-xl bg-slate-900/30">
                                    <p className="mb-2 font-medium text-slate-400">No pools match your filters.</p>
                                    <button onClick={() => { setSearchTerm(''); setFilterStatus('all'); setFilterPrice('all'); setFilterCharity(false); }} className="text-indigo-400 hover:text-indigo-300 underline text-sm">Clear all filters</button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};
