
import React, { useState, useMemo } from 'react';
import { Search, Trophy, Heart, DollarSign, Activity, Lock, Unlock } from 'lucide-react';
import type { GameState, User, BracketPool, Pool, PlayoffPool, PropsPool, Square } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';
import { getTeamLogo } from '../constants';
import { getPoolTypeName } from '../utils/poolUtils';

interface BrowsePoolsProps {
    user: User | null;
    pools: Pool[];
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

export const BrowsePools: React.FC<BrowsePoolsProps> = ({ user, pools, onOpenAuth, onLogout, onCreatePool }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedLeague, setSelectedLeague] = useState<string>('all');
    const [filterCharity, setFilterCharity] = useState(false);
    const [filterType, setFilterType] = useState<'all' | 'squares' | 'props' | 'bracket' | 'playoff'>('all');
    const [filterPrice, setFilterPrice] = useState<'all' | 'low' | 'mid' | 'high'>('all'); // low < 10, mid 10-50, high > 50
    const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'live' | 'closed'>('open');

    // Filter Logic
    const filteredPools = useMemo(() => {
        return pools.filter(p => {
            // Common fields
            const name = p.name || '';
            const isBracket = p.type === 'BRACKET';
            const isProps = p.type === 'PROPS';
            const isSquares = !p.type || p.type === 'SQUARES';
            const isPlayoff = p.type === 'NFL_PLAYOFFS';

            const isPublic = isBracket ? (p as BracketPool).isListedPublic : (isPlayoff ? true : (isProps ? (p as PropsPool).isPublic : (p as GameState).isPublic));

            if (!isPublic) return false;

            // Type Filter
            if (filterType !== 'all') {
                if (filterType === 'squares' && !isSquares) return false;
                if (filterType === 'props' && !isProps) return false;
                if (filterType === 'bracket' && !isBracket) return false;
                if (filterType === 'playoff' && !isPlayoff) return false;
            }

            // Search Match
            const searchLower = searchTerm.toLowerCase();
            const contactEmail = (p as any).contactEmail || ''; // Bracket pool might not have contactEmail in same place yet
            const matchesSearch =
                name.toLowerCase().includes(searchLower) ||
                (isSquares && (p as GameState).homeTeam.toLowerCase().includes(searchLower)) ||
                (isSquares && (p as GameState).awayTeam.toLowerCase().includes(searchLower)) ||
                contactEmail.toLowerCase().includes(searchLower);

            if (!matchesSearch) return false;

            // Charity Filter
            if (filterCharity && (isBracket || !(p as GameState).charity?.enabled)) return false;

            // Price Filter
            if (filterPrice !== 'all') {
                let cost = 0;
                if (isBracket) cost = (p as any).settings?.entryFee || 0;
                else if (isSquares) cost = (p as GameState).costPerSquare || 0;
                else if (isPlayoff) cost = (p as PlayoffPool).settings?.entryFee || 0;

                if (filterPrice === 'low' && cost >= 20) return false;
                if (filterPrice === 'mid' && (cost < 20 || cost > 50)) return false;
                if (filterPrice === 'high' && cost <= 50) return false;
            }

            // Status Filter
            if (filterStatus !== 'all') {
                if (filterStatus === 'open') {
                    // Open = Not Locked (Squares) or Published (Bracket)
                    if (isBracket && (p as BracketPool).status !== 'PUBLISHED') return false;
                    if (isSquares && (p as GameState).isLocked) return false;
                } else if (filterStatus === 'live') {
                    // Live = Locked + In Progress
                    if (isBracket) {
                        if ((p as BracketPool).status !== 'LOCKED') return false;
                    } else {
                        const s = p as GameState;
                        const isLive = s.isLocked && s.scores?.gameStatus === 'in';
                        if (!isLive) return false;
                    }
                } else if (filterStatus === 'closed') {
                    // Closed = Complete
                    if (isBracket) {
                        if ((p as BracketPool).status !== 'COMPLETED') return false;
                    } else {
                        const s = p as GameState;
                        const isClosed = s.scores?.gameStatus === 'post';
                        if (!isClosed) return false;
                    }
                }
            }

            // League Filter
            if (selectedLeague !== 'all') {
                if (isBracket && selectedLeague !== 'ncaa_bb') return false;
                if (isSquares) {
                    const poolLeague = (p as GameState).league || 'nfl';
                    if (selectedLeague === 'nfl' && poolLeague !== 'nfl') return false;
                    if (selectedLeague === 'college' && poolLeague !== 'college') return false;
                    if (selectedLeague === 'ncaa_bb') return false; // Squares aren't usually NCAA BB
                }
            }
            if (p.type === 'PROPS') {
                // Props pools don't strictly have leagues but treating as NFL for now or All
                // If specifically filtering for props, show it.
                if (selectedLeague === 'props') return true;
                // If filtering for nfl, maybe show? For now let's strict check
                if (selectedLeague !== 'all' && selectedLeague !== 'nfl') return false;
            } else if (selectedLeague === 'props') {
                return false; // Non-Props pools
            }

            return true;
        });
    }, [pools, searchTerm, selectedLeague, filterCharity, filterPrice, filterStatus, filterType]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
            <Header user={user} onOpenAuth={onOpenAuth} onLogout={onLogout} onCreatePool={onCreatePool} />

            <main className="max-w-7xl mx-auto p-4 md:p-8 mt-6">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row justify-between items-end mb-10 gap-6 border-b border-slate-800 pb-8">
                    <div>
                        <h2 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Public Pools</h2>
                        <p className="text-slate-400 max-w-xl">
                            Join active Super Bowl squares pools and March Madness brackets.
                        </p>
                    </div>
                </div>

                {/* Filters Row */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <div className="space-y-6">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-3 text-slate-500" size={18} />
                            <input
                                type="text"
                                placeholder="Search pools, teams..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-900/50 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                            />
                        </div>

                        {/* Pool Type Filter */}
                        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <Trophy size={14} /> Pool Type
                            </h3>
                            <div className="flex flex-col gap-2">
                                {[
                                    { id: 'all', label: 'All Types' },
                                    { id: 'squares', label: 'Squares' },
                                    { id: 'props', label: 'Side Hustle' },
                                    { id: 'bracket', label: 'NCAA Brackets' },
                                    { id: 'playoff', label: 'Playoff Brackets' },
                                ].map((type) => (
                                    <button
                                        key={type.id}
                                        onClick={() => setFilterType(type.id as any)}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex justify-between items-center ${filterType === type.id
                                            ? 'bg-indigo-600 text-white'
                                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                            }`}
                                    >
                                        <span>{type.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Status Filter */}
                        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <Activity size={14} /> Game Status
                            </h3>
                            <div className="flex flex-col gap-2">
                                {[
                                    { id: 'all', label: 'All', icon: null },
                                    { id: 'open', label: 'Open', icon: <Unlock size={14} /> },
                                    { id: 'live', label: 'Live Now', icon: <Activity size={14} /> },
                                    { id: 'closed', label: 'Closed', icon: <Lock size={14} /> },
                                ].map((status) => (
                                    <button
                                        key={status.id}
                                        onClick={() => setFilterStatus(status.id as any)}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${filterStatus === status.id
                                            ? 'bg-indigo-600 text-white'
                                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                            }`}
                                    >
                                        {status.icon}
                                        <span>{status.label}</span>
                                    </button>
                                ))}
                            </div>
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
                                    { id: 'props', label: 'Side Hustle', active: true },
                                    { id: 'ncaa_bb', label: 'NCAA Basketball', active: true },
                                    { id: 'nba', label: 'NBA', active: false },
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

                    {/* Results */}
                    <div className="lg:col-span-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                    const bp = pool as BracketPool;
                                    filled = bp.entryCount || 0;
                                    const max = bp.settings.maxEntriesTotal === -1 ? 100 : bp.settings.maxEntriesTotal; // Mock 100 if unlimited for progress
                                    pct = bp.settings.maxEntriesTotal === -1 ? 0 : Math.round((filled / max) * 100);
                                    homeTeam = 'Tournament';
                                    awayTeam = 'Bracket';
                                    cost = bp.settings.entryFee;
                                    isLocked = bp.status !== 'DRAFT' && bp.status !== 'PUBLISHED';
                                } else if (pool.type === 'NFL_PLAYOFFS') {
                                    const pp = pool as PlayoffPool;
                                    filled = Object.keys(pp.entries || {}).length;
                                    pct = 50; // Arbitrary for now
                                    homeTeam = 'NFL';
                                    awayTeam = 'Playoffs';
                                    cost = pp.settings?.entryFee || 0;
                                    isLocked = pp.isLocked;
                                } else if (pool.type === 'PROPS') {
                                    const pp = pool as PropsPool;
                                    filled = pp.entryCount || 0;
                                    pct = 20; // Arbitrary
                                    homeTeam = 'Props';
                                    awayTeam = 'Pool';
                                    cost = pp.props?.cost || 0;
                                    isLocked = !!pp.isLocked; // Need to ensure it exists
                                    charityEnabled = false;
                                } else {
                                    // Fallback or squares if type is undefined (legacy)
                                    const sp = pool as GameState;
                                    filled = sp.squares?.filter((s: Square) => s.owner).length || 0;
                                    pct = Math.round((filled / 100) * 100);
                                    homeTeam = sp.homeTeam || 'Home';
                                    awayTeam = sp.awayTeam || 'Away';
                                    homeLogo = sp.homeTeamLogo || getTeamLogo(sp.homeTeam || '');
                                    awayLogo = sp.awayTeamLogo || getTeamLogo(sp.awayTeam || '');
                                    cost = sp.costPerSquare || 0;
                                    isLocked = sp.isLocked;
                                    charityEnabled = !!sp.charity?.enabled;
                                }

                                return (
                                    <div key={pool.id}
                                        onClick={() => window.location.hash = `#pool/${pool.id}`}
                                        className="group bg-slate-900/50 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-800 rounded-xl p-5 cursor-pointer transition-all relative overflow-hidden flex flex-col"
                                    >
                                        {charityEnabled && (
                                            <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                                                <Heart size={100} className="fill-rose-500 text-rose-500" />
                                            </div>
                                        )}

                                        <div className="flex justify-between items-start mb-4 relative z-10">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-12 h-12 rounded-full border flex items-center justify-center text-lg font-bold group-hover:scale-105 transition-transform ${isBracket ? 'bg-amber-900/20 border-amber-500/30 text-amber-500' : 'bg-slate-800 border-slate-700 text-indigo-400'}`}>
                                                    {isBracket ? <Trophy size={20} /> : pool.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors line-clamp-1 flex items-center gap-2">
                                                        {pool.name}
                                                    </h3>
                                                    <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                                                        {isBracket ? <span className="text-amber-500">March Madness Bracket</span> : <span>{getPoolTypeName(pool as GameState)}</span>}
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
                                        <div className="bg-black/30 rounded-lg p-3 border border-slate-800/50 mb-4 flex items-center justify-between relative z-10">
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

                                        {/* Progress & Meta */}
                                        <div className="flex items-center justify-between text-xs font-medium text-slate-400 relative z-10">
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                        <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                                                    </div>
                                                    <span>{(isBracket || pool.type === 'PROPS' || pool.type === 'NFL_PLAYOFFS') ? `${filled} Entries` : `${100 - filled} Left`}</span>
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
                                );
                            })}
                        </div>
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
};
