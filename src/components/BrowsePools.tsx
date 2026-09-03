
import React, { useState, useMemo } from 'react';
import { Search, Trophy, Heart, DollarSign, Activity, Lock, Unlock } from 'lucide-react';
import type { GameState, User, BracketPool, Pool, PlayoffPool, PropsPool, Square } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';
import { getTeamLogo } from '../constants';
import { getPoolTypeName } from '../utils/poolUtils';
import { Badge } from './ui';
import { isPubliclyListed } from '../utils/publicListing';

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

            if (!isPubliclyListed(p)) return false;

            // Canceled pools never show in public discovery
            if ((p as any).status === 'CANCELED') return false;

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
                    // Open = OPEN status (Bracket) or Not Locked (Squares)
                    if (isBracket && (p as BracketPool).status !== 'OPEN') return false;
                    if (isSquares && (p as GameState).isLocked) return false;
                } else if (filterStatus === 'live') {
                    // Live = LIVE status (Bracket) or In-Progress (Squares)
                    if (isBracket) {
                        if ((p as BracketPool).status !== 'LIVE' && (p as BracketPool).status !== 'LOCKED') return false;
                    } else {
                        const s = p as GameState;
                        const isLive = s.isLocked && s.scores?.gameStatus === 'in';
                        if (!isLive) return false;
                    }
                } else if (filterStatus === 'closed') {
                    // Closed = COMPLETED status (Bracket) or Post-game (Squares)
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
        <div className="min-h-screen bg-page text-[color:var(--text)] font-body">
            <Header user={user} onOpenAuth={onOpenAuth} onLogout={onLogout} onCreatePool={onCreatePool} />

            <main className="max-w-7xl mx-auto p-4 md:p-8 mt-6">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row justify-between items-end mb-10 gap-6 border-b border-line pb-8">
                    <div>
                        <h2 className="font-display font-extrabold uppercase text-4xl md:text-5xl leading-[0.9] text-[color:var(--text)] mb-2">Public Pools</h2>
                        <p className="text-muted max-w-xl font-body">
                            Join public pools — NFL survivor, pick'em, squares, March Madness brackets, and more.
                        </p>
                    </div>
                </div>

                {/* Filters Row */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <div className="space-y-6">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-3 text-faint" size={18} aria-hidden="true" />
                            <input
                                type="text"
                                aria-label="Search pools by name or team"
                                placeholder="Search pools, teams..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-page border-[1.5px] border-line rounded-md py-2.5 pl-10 pr-4 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint focus:outline-none focus:border-navy-600 focus:bg-surface transition-colors"
                            />
                        </div>

                        {/* Pool Type Filter */}
                        <div className="bg-card border border-line rounded-xl p-4 shadow-card">
                            <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-3 flex items-center gap-2">
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
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition duration-150 flex justify-between items-center ${filterType === type.id
                                            ? 'bg-navy-800 text-white'
                                            : 'text-muted hover:bg-surface hover:text-[color:var(--text)]'
                                            }`}
                                    >
                                        <span>{type.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Status Filter */}
                        <div className="bg-card border border-line rounded-xl p-4 shadow-card">
                            <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-3 flex items-center gap-2">
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
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition duration-150 flex items-center gap-2 ${filterStatus === status.id
                                            ? 'bg-navy-800 text-white'
                                            : 'text-muted hover:bg-surface hover:text-[color:var(--text)]'
                                            }`}
                                    >
                                        {status.icon}
                                        <span>{status.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Sport Filter */}
                        <div className="bg-card border border-line rounded-xl p-4 shadow-card">
                            <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-3 flex items-center gap-2">
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
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition duration-150 flex justify-between items-center ${!sport.active
                                            ? 'opacity-40 cursor-not-allowed text-faint hover:bg-transparent'
                                            : selectedLeague === sport.id
                                                ? 'bg-navy-800 text-white'
                                                : 'text-muted hover:bg-surface hover:text-[color:var(--text)]'
                                            }`}
                                    >
                                        <span>{sport.label}</span>
                                        {!sport.active && <span className="text-[10px] uppercase font-display font-bold tracking-[0.08em] bg-surface border border-line text-faint px-1.5 py-0.5 rounded">Soon</span>}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Price Filter */}
                        <div className="bg-card border border-line rounded-xl p-4 shadow-card">
                            <h3 className="text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-3 flex items-center gap-2">
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
                                        className={`text-xs px-3 py-1.5 rounded-lg border font-display font-bold uppercase tracking-[0.05em] num transition duration-150 ${filterPrice === price.id ? 'bg-gold-500/15 border-gold-500 text-gold-700 dark:text-gold-400' : 'bg-surface border-line text-muted hover:border-navy-600'}`}
                                    >
                                        {price.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Toggles */}
                        <div className="bg-card border border-line rounded-xl p-4 shadow-card">
                            <label className="flex items-center justify-between cursor-pointer group">
                                <div className="flex items-center gap-3">
                                    <div className={`p-1.5 rounded-lg transition-colors ${filterCharity ? 'bg-gold-foil text-navy-950' : 'bg-surface text-faint'}`}><Heart size={16} className={filterCharity ? "fill-navy-950" : ""} /></div>
                                    <span className={`text-sm font-display font-bold uppercase tracking-[0.05em] ${filterCharity ? 'text-[color:var(--text)]' : 'text-muted group-hover:text-[color:var(--text)]'}`}>Charity Pools Only</span>
                                </div>
                                <div className={`w-10 h-5 rounded-full relative transition-colors ${filterCharity ? 'bg-navy-800 dark:bg-gold-600' : 'bg-line'}`} onClick={() => setFilterCharity(!filterCharity)}>
                                    <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform duration-150 ${filterCharity ? 'translate-x-5' : 'translate-x-0'}`} />
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
                                    isLocked = bp.status === 'LOCKED' || bp.status === 'LIVE' || bp.status === 'COMPLETED';
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
                                        onClick={() => window.location.href = `/pool/${pool.id}`}
                                        className="group bg-card border border-line hover:border-gold-500 rounded-2xl p-5 cursor-pointer transition duration-150 hover:-translate-y-1 shadow-card hover:shadow-card-hover relative overflow-hidden flex flex-col"
                                    >
                                        {charityEnabled && (
                                            <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                                                <Heart size={100} className="fill-gold-500 text-gold-500" />
                                            </div>
                                        )}

                                        <div className="flex justify-between items-start mb-4 relative z-10">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-12 h-12 rounded-full border flex items-center justify-center text-lg font-display font-bold group-hover:scale-105 transition-transform ${isBracket ? 'bg-gold-500/15 border-gold-500/40 text-gold-700 dark:text-gold-400' : 'bg-surface border-line text-navy-700 dark:text-[#9FB0CC]'}`}>
                                                    {isBracket ? <Trophy size={20} /> : pool.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-display font-bold uppercase leading-tight text-[color:var(--text)] group-hover:text-gold-700 dark:group-hover:text-gold-400 transition-colors line-clamp-1 flex items-center gap-2">
                                                        {pool.name}
                                                    </h3>
                                                    <div className="flex items-center gap-2 text-xs text-muted font-body font-medium">
                                                        {isBracket ? <span className="text-gold-700 dark:text-gold-400">March Madness Bracket</span> : <span>{getPoolTypeName(pool as GameState)}</span>}
                                                        {charityEnabled && <span className="text-gold-700 dark:text-gold-400 flex items-center gap-1">• <Heart size={10} className="fill-gold-500 text-gold-500" /> Charity</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="block text-xl font-display font-bold text-gold-700 dark:text-gold-400 num">${cost}</span>
                                                <span className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em]">{isBracket ? 'Entry Fee' : 'Per Square'}</span>
                                            </div>
                                        </div>

                                        {/* Matchup */}
                                        <div className="bg-surface rounded-lg p-3 border border-line mb-4 flex items-center justify-between relative z-10">
                                            <div className="flex items-center gap-2">
                                                {awayLogo && <img src={awayLogo} alt={`${awayTeam} logo`} loading="lazy" width={24} height={24} className="w-6 h-6 object-contain opacity-80" />}
                                                <span className="text-sm font-display font-bold uppercase text-[color:var(--text)]">{awayTeam}</span>
                                            </div>
                                            <span className="text-xs text-faint font-display font-bold uppercase">VS</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-display font-bold uppercase text-[color:var(--text)]">{homeTeam}</span>
                                                {homeLogo && <img src={homeLogo} alt={`${homeTeam} logo`} loading="lazy" width={24} height={24} className="w-6 h-6 object-contain opacity-80" />}
                                            </div>
                                        </div>

                                        {/* Progress & Meta */}
                                        <div className="flex items-center justify-between text-xs font-body font-medium text-muted relative z-10">
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-20 h-1.5 bg-line rounded-full overflow-hidden">
                                                        <div className="h-full w-full origin-left bg-gold-foil rounded-full transition-transform duration-300" style={{ transform: `scaleX(${Number(pct) / 100})` }}></div>
                                                    </div>
                                                    <span className="num">{(isBracket || pool.type === 'PROPS' || pool.type === 'NFL_PLAYOFFS') ? `${filled} Entries` : `${100 - filled} Left`}</span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {!isLocked ? (
                                                    <Badge status="open" />
                                                ) : (
                                                    <Badge status="locked" />
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
