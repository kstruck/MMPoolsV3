import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  Heart, 
  DollarSign, 
  Trophy, 
  Plus, 
  Zap, 
  Globe, 
  Lock, 
  Trash2, 
  LayoutDashboard, 
  Archive, 
  RotateCcw, 
  Copy, 
  AlertTriangle, 
  X, 
  ArrowUpDown,
  TrendingUp,
  Users,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  Cell, 
  XAxis, 
  YAxis, 
  Tooltip, 
  PieChart, 
  Pie 
} from 'recharts';
import type { GameState, Pool, User } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';
import { getTeamLogo } from '../constants';
import { isSuperAdmin } from '../utils/auth';
import { Loader } from 'lucide-react';

interface ManagerDashboardProps {
    user: User | null;
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
    const [filterType, setFilterType] = useState<'all' | 'squares' | 'props' | 'bracket' | 'playoff'>('all');
    const [filterPrice, setFilterPrice] = useState<'all' | 'low' | 'mid' | 'high'>('all'); 
    const [selectedLeague, setSelectedLeague] = useState<string>('all');
    const [sortBy, setSortBy] = useState<'name' | 'date' | 'price' | 'fill'>('date');
    const [isEmpireStatsExpanded, setIsEmpireStatsExpanded] = useState(true);

    // Delete confirmation modal state
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; poolId: string; poolName: string }>({ isOpen: false, poolId: '', poolName: '' });
    const [deleteConfirmText, setDeleteConfirmText] = useState('');

    // --- EMPIRE ANALYTICS CALCULATION (Task 5) ---
    const empireStats = useMemo(() => {
        let totalCollected = 0;
        let totalOutstanding = 0;
        let totalEntriesCount = 0;

        pools.forEach(p => {
            let cost = 0;
            let count = 0;
            let paidCount = 0;

            if (p.type === 'SQUARES') {
                const sq = p as any;
                cost = sq.costPerSquare || 20;
                count = sq.squares?.filter((s: any) => s.owner).length || 0;
                paidCount = sq.squares?.filter((s: any) => s.owner && s.paidStatus === 'PAID').length || 0;
            } else {
                const anyP = p as any;
                cost = anyP.settings?.entryFee || anyP.props?.cost || anyP.costPerSquare || 20;
                count = anyP.entryCount || (anyP.entries ? Object.keys(anyP.entries).length : 0);
                paidCount = anyP.entries ? Object.values(anyP.entries).filter((e: any) => e.paidStatus === 'PAID').length : Math.round(count * 0.75);
            }

            totalCollected += paidCount * cost;
            totalOutstanding += Math.max(0, (count - paidCount) * cost);
            totalEntriesCount += count;
        });

        return {
            collected: totalCollected,
            outstanding: totalOutstanding,
            totalEntries: totalEntriesCount,
            totalPot: totalCollected + totalOutstanding
        };
    }, [pools]);

    // Financial collected vs outstanding Recharts data
    const revenueChartData = useMemo(() => {
        return pools.slice(0, 5).map(p => {
            let cost = 0;
            let count = 0;
            let paidCount = 0;

            if (p.type === 'SQUARES') {
                const sq = p as any;
                cost = sq.costPerSquare || 20;
                count = sq.squares?.filter((s: any) => s.owner).length || 0;
                paidCount = sq.squares?.filter((s: any) => s.owner && s.paidStatus === 'PAID').length || 0;
            } else {
                const anyP = p as any;
                cost = anyP.settings?.entryFee || anyP.props?.cost || anyP.costPerSquare || 20;
                count = anyP.entryCount || (anyP.entries ? Object.keys(anyP.entries).length : 0);
                paidCount = anyP.entries ? Object.values(anyP.entries).filter((e: any) => e.paidStatus === 'PAID').length : Math.round(count * 0.75);
            }

            return {
                name: p.name.substring(0, 10),
                Collected: paidCount * cost,
                Outstanding: Math.max(0, (count - paidCount) * cost)
            };
        });
    }, [pools]);

    // Pool Type popularity split
    const poolTypePopularityData = useMemo(() => {
        let squares = 0;
        let props = 0;
        let bracket = 0;
        let playoff = 0;

        pools.forEach(p => {
            if (p.type === 'SQUARES') squares++;
            else if (p.type === 'PROPS') props++;
            else if (p.type === 'BRACKET') bracket++;
            else if (p.type === 'NFL_PLAYOFFS') playoff++;
        });

        return [
            { name: 'Squares', value: squares, color: '#FF6600' },
            { name: 'Props', value: props, color: '#10B981' },
            { name: 'MM Brackets', value: bracket, color: '#3B82F6' },
            { name: 'Playoffs', value: playoff, color: '#8B5CF6' }
        ].filter(item => item.value > 0);
    }, [pools]);

    // Filter Logic
    const filteredPools = useMemo(() => {
        return pools.filter(p => {
            const poolStatus = (p as GameState).status || 'active';
            if (archiveTab === 'active' && poolStatus === 'archived') return false;
            if (archiveTab === 'archived' && poolStatus !== 'archived') return false;

            const searchLower = searchTerm.toLowerCase();
            const isBracket = p.type === 'BRACKET';
            const isProps = p.type === 'PROPS';
            const isPlayoff = p.type === 'NFL_PLAYOFFS';
            const isSquares = !p.type || p.type === 'SQUARES';

            if (filterType !== 'all') {
                if (filterType === 'squares' && !isSquares) return false;
                if (filterType === 'props' && !isProps) return false;
                if (filterType === 'bracket' && !isBracket) return false;
                if (filterType === 'playoff' && !isPlayoff) return false;
            }

            const matchesSearch =
                p.name.toLowerCase().includes(searchLower) ||
                (!isBracket && (p as GameState).homeTeam.toLowerCase().includes(searchLower)) ||
                (!isBracket && (p as GameState).awayTeam.toLowerCase().includes(searchLower));

            if (!matchesSearch) return false;

            if (filterCharity && (isBracket || !(p as GameState).charity?.enabled)) return false;

            if (filterStatus !== 'all') {
                let isClosed = false;
                let isLive = false;
                let isLocked = false;
                let isOpen = false;

                if (p.type === 'BRACKET') {
                    isOpen = p.status === 'OPEN' || p.status === 'DRAFT';
                    isLocked = p.status === 'LOCKED';
                    isLive = p.status === 'LIVE';
                    isClosed = p.status === 'COMPLETED';
                } else if (p.type === 'SQUARES') {
                    isClosed = p.scores?.gameStatus === 'post';
                    isLive = p.scores?.gameStatus === 'in';
                    isLocked = p.isLocked;
                    isOpen = !p.isLocked;
                } else {
                    isClosed = false;
                    isLive = false;
                    isLocked = p.isLocked || false;
                    isOpen = !isLocked;
                }

                if (filterStatus === 'open' && !isOpen) return false;
                if (filterStatus === 'locked' && !isLocked) return false;
                if (filterStatus === 'live' && !isLive) return false;
                if (filterStatus === 'final' && !isClosed) return false;
            }

            if (filterPrice !== 'all') {
                let cost = 0;
                if (p.type === 'BRACKET' || p.type === 'NFL_PLAYOFFS') cost = p.settings?.entryFee || 0;
                else if (p.type === 'SQUARES') cost = p.costPerSquare;
                else if (p.type === 'PROPS') cost = p.props?.cost || 0;

                if (filterPrice === 'low' && cost >= 20) return false;
                if (filterPrice === 'mid' && (cost < 20 || cost > 50)) return false;
                if (filterPrice === 'high' && cost <= 50) return false;
            }

            if (selectedLeague !== 'all') {
                if (selectedLeague === 'brackets') {
                    if (!isBracket) return false;
                } else if (selectedLeague === 'props') {
                    if (p.type !== 'PROPS') return false;
                } else {
                    if (p.type === 'BRACKET' || p.type === 'PROPS') return false;
                    const poolLeague = p.type === 'SQUARES' ? p.league || 'nfl' : p.type === 'NFL_PLAYOFFS' ? p.league || 'nfl' : 'nfl';
                    const isCollege = poolLeague === 'college' || poolLeague === 'ncaa';
                    const isNfl = poolLeague === 'nfl' || poolLeague === 'NFL' || p.type === 'NFL_PLAYOFFS';

                    if (selectedLeague === 'nfl' && !isNfl) return false;
                    if (selectedLeague === 'college' && !isCollege) return false;
                }
            }

            return true;
        }).sort((a, b) => {
            const aIsBracket = a.type === 'BRACKET';
            const bIsBracket = b.type === 'BRACKET';

            if (sortBy === 'name') {
                return a.name.localeCompare(b.name);
            }
            if (sortBy === 'date') {
                const aDate = aIsBracket ? 0 : new Date((a as GameState).scores?.startTime || 0).getTime();
                const bDate = bIsBracket ? 0 : new Date((b as GameState).scores?.startTime || 0).getTime();
                return bDate - aDate;
            }
            if (sortBy === 'price') {
                let aPrice = 0;
                if (a.type === 'BRACKET' || a.type === 'NFL_PLAYOFFS') aPrice = a.settings?.entryFee || 0;
                else if (a.type === 'SQUARES') aPrice = a.costPerSquare;
                else if (a.type === 'PROPS') aPrice = a.props?.cost || 0;

                let bPrice = 0;
                if (b.type === 'BRACKET' || b.type === 'NFL_PLAYOFFS') bPrice = b.settings?.entryFee || 0;
                else if (b.type === 'SQUARES') bPrice = b.costPerSquare;
                else if (b.type === 'PROPS') bPrice = b.props?.cost || 0;

                return bPrice - aPrice;
            }
            if (sortBy === 'fill') {
                const aFill = aIsBracket ? 0 : a.type === 'SQUARES' ? (a as GameState).squares?.filter(s => s.owner).length || 0 : 0;
                const bFill = bIsBracket ? 0 : b.type === 'SQUARES' ? (b as GameState).squares?.filter(s => s.owner).length || 0 : 0;
                return bFill - aFill;
            }
            return 0;
        });
    }, [pools, searchTerm, filterCharity, filterStatus, filterPrice, selectedLeague, archiveTab, sortBy, filterType]);

    if (!user) {
        return (
            <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
                <div className="text-center">
                    <p className="mb-4 text-slate-400 font-bold uppercase text-xs">Please sign in to access the dashboard.</p>
                    <button onClick={onOpenAuth} className="bg-indigo-600 px-6 py-3 rounded-2xl text-white font-extrabold text-xs uppercase tracking-widest shadow-lg">Sign In</button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-orange-500 selection:text-white">
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
                        <h2 className="text-3xl font-black text-white flex items-center gap-3">
                            <LayoutDashboard className="text-indigo-500" /> League Empire Manager
                        </h2>
                        <p className="text-slate-400 text-sm mt-1">Configure, audit, and coordinate your complete pool portfolio.</p>
                    </div>
                    <button
                        onClick={isSuperAdmin(user) ? onCreatePool : undefined}
                        disabled={!isSuperAdmin(user)}
                        className={`px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-2 shadow-lg transition-all ${isSuperAdmin(user)
                            ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20 hover:scale-[1.03]"
                            : "bg-slate-800 text-slate-500 cursor-not-allowed opacity-80"
                            }`}
                        title={isSuperAdmin(user) ? "Create a new pool" : "Pool creation is coming soon"}
                    >
                        <Plus size={16} /> Create New Pool
                    </button>
                </div>

                {connectionError && (
                    <div className="bg-rose-500/10 border border-rose-500 text-rose-450 p-4 rounded-2xl mb-6 flex items-center gap-3 animate-pulse text-xs font-bold">
                        <Zap className="text-rose-500" />
                        <div>
                            <p className="font-extrabold uppercase">Platform Sync Interrupted</p>
                            <p className="text-slate-400 text-xs mt-0.5">{connectionError}. Re-establishing connections.</p>
                        </div>
                    </div>
                )}

                {/* --- COLLAPSIBLE LEAGUE EMPIRE MANAGER STATS & CHARTING --- */}
                {!isLoading && pools.length > 0 && (
                    <div className="bg-slate-900/30 border border-slate-800 rounded-3xl p-5 mb-8 backdrop-blur-md">
                        <button 
                            onClick={() => setIsEmpireStatsExpanded(!isEmpireStatsExpanded)}
                            className="w-full flex justify-between items-center text-xs font-black uppercase text-slate-400 hover:text-white transition-colors"
                        >
                            <span className="flex items-center gap-2 tracking-widest">
                                <TrendingUp size={14} className="text-indigo-500" /> Managed Empire Statistics
                            </span>
                            {isEmpireStatsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>

                        {isEmpireStatsExpanded && (
                            <div className="mt-6 space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
                                {/* Statistics Grid */}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    {[
                                        { title: 'Total Collected Buy-Ins', value: `$${empireStats.collected.toLocaleString()}`, icon: DollarSign, color: 'text-emerald-400' },
                                        { title: 'Outstanding Dues', value: `$${empireStats.outstanding.toLocaleString()}`, icon: AlertTriangle, color: 'text-amber-400' },
                                        { title: 'Total Registrations', value: `${empireStats.totalEntries} Players`, icon: Users, color: 'text-blue-400' },
                                        { title: 'Potential Prize Pools', value: `$${empireStats.totalPot.toLocaleString()}`, icon: Trophy, color: 'text-indigo-400' }
                                    ].map((stat, i) => (
                                        <div key={i} className="bg-slate-950/60 border border-slate-850 p-4 rounded-2xl flex items-center gap-4">
                                            <div className={`p-2.5 bg-slate-900 border border-slate-800 rounded-xl ${stat.color}`}>
                                                <stat.icon size={16} />
                                            </div>
                                            <div>
                                                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-1">{stat.title}</span>
                                                <span className="text-base font-black text-white block leading-none font-mono">{stat.value}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Recharts Visualizations */}
                                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                                    {/* BarChart: Collected vs Outstanding */}
                                    <div className="lg:col-span-3 bg-slate-950/40 border border-slate-850 p-5 rounded-2xl h-64 flex flex-col justify-between">
                                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-4">Revenue Breakdown by Pool</span>
                                        <div className="flex-1 w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={revenueChartData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                                                    <XAxis dataKey="name" stroke="#475569" fontSize={8} fontWeight="bold" />
                                                    <YAxis stroke="#475569" fontSize={8} fontWeight="bold" />
                                                    <Tooltip contentStyle={{ backgroundColor: '#090d16', borderColor: '#1e293b', borderRadius: '12px', fontSize: '9px' }} />
                                                    <Bar dataKey="Collected" fill="#10B981" radius={[3, 3, 0, 0]} />
                                                    <Bar dataKey="Outstanding" fill="#FBBF24" radius={[3, 3, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>

                                    {/* PieChart: Pool Type Split */}
                                    <div className="lg:col-span-2 bg-slate-950/40 border border-slate-850 p-5 rounded-2xl h-64 flex flex-col justify-between">
                                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">Portfolio split</span>
                                        {poolTypePopularityData.length > 0 ? (
                                            <>
                                                <div className="flex-1 w-full relative flex items-center justify-center">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <PieChart>
                                                            <Pie
                                                                data={poolTypePopularityData}
                                                                cx="50%"
                                                                cy="50%"
                                                                innerRadius={36}
                                                                outerRadius={56}
                                                                paddingAngle={3}
                                                                dataKey="value"
                                                            >
                                                                {poolTypePopularityData.map((entry, index) => (
                                                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                                                ))}
                                                            </Pie>
                                                            <Tooltip contentStyle={{ backgroundColor: '#090d16', borderColor: '#1e293b', borderRadius: '12px', fontSize: '9px' }} />
                                                        </PieChart>
                                                    </ResponsiveContainer>
                                                    <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                                                        <span className="text-xl font-black text-white font-mono leading-none">{pools.length}</span>
                                                        <span className="text-[7px] font-bold text-slate-550 uppercase tracking-widest mt-0.5">Active</span>
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[8px] font-black uppercase tracking-wider mt-2">
                                                    {poolTypePopularityData.map((e, idx) => (
                                                        <div key={idx} className="flex items-center gap-1" style={{ color: e.color }}>
                                                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: e.color }}></span>
                                                            {e.name} ({e.value})
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-slate-650 font-bold text-xs text-center py-20">No active pools in portfolio.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
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
                        <button
                            onClick={isSuperAdmin(user) ? onCreatePool : undefined}
                            disabled={!isSuperAdmin(user)}
                            className={`px-6 py-2 rounded-lg font-bold transition-colors ${isSuperAdmin(user)
                                ? "bg-slate-700 hover:bg-slate-600 text-white"
                                : "bg-slate-800 text-slate-500 cursor-not-allowed opacity-80"
                                }`}
                            title={isSuperAdmin(user) ? "Create a pool" : "Pool creation is coming soon"}
                        >
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
                                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 px-4 pl-10 text-white outline-none focus:ring-1 focus:ring-indigo-550 transition-all text-xs font-semibold placeholder:text-slate-600"
                                />
                                <Search className="absolute left-3 top-3.5 text-slate-600" size={16} />
                            </div>

                            {/* Pool Type Filter */}
                            <div className="bg-slate-900/30 border border-slate-850 rounded-2xl p-4">
                                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <Trophy size={12} /> Pool Type
                                </h3>
                                <div className="flex flex-col gap-1.5">
                                    {[
                                        { id: 'all', label: 'All Types' },
                                        { id: 'squares', label: 'Squares' },
                                        { id: 'props', label: 'Side Hustle' },
                                        { id: 'playoff', label: 'Playoff Brackets' },
                                        { id: 'bracket', label: 'NCAA Brackets' },
                                    ].map((type) => (
                                        <button
                                            key={type.id}
                                            onClick={() => setFilterType(type.id as any)}
                                            className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex justify-between items-center ${filterType === type.id
                                                ? 'bg-indigo-600/10 border-l-4 border-indigo-500 text-white shadow-sm'
                                                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900/30'
                                                }`}
                                        >
                                            <span>{type.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Sport Filter */}
                            <div className="bg-slate-900/30 border border-slate-850 rounded-2xl p-4">
                                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <Trophy size={12} /> Sport / League
                                </h3>
                                <div className="flex flex-col gap-1.5">
                                    {[
                                        { id: 'all', label: 'All Sports', active: true },
                                        { id: 'nfl', label: 'NFL Football', active: true },
                                        { id: 'college', label: 'NCAA Football', active: true },
                                        { id: 'brackets', label: 'March Madness', active: true },
                                        { id: 'props', label: 'Side Hustle', active: true },
                                        { id: 'nba', label: 'NBA', active: false },
                                        { id: 'ncaa_bb', label: 'NCAA Basketball', active: false },
                                    ].map((sport) => (
                                        <button
                                            key={sport.id}
                                            onClick={() => sport.active && setSelectedLeague(sport.id)}
                                            disabled={!sport.active}
                                            className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex justify-between items-center ${!sport.active
                                                ? 'opacity-30 cursor-not-allowed text-slate-600'
                                                : selectedLeague === sport.id
                                                    ? 'bg-indigo-600/10 border-l-4 border-indigo-500 text-white'
                                                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900/30'
                                                }`}
                                        >
                                            <span>{sport.label}</span>
                                            {!sport.active && <span className="text-[8px] uppercase font-black bg-slate-900 px-1.5 py-0.5 rounded text-slate-550 border border-slate-800">Soon</span>}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Status Filters */}
                            <div className="bg-slate-900/30 border border-slate-850 rounded-2xl p-4">
                                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <Filter size={12} /> Pool Status
                                </h3>
                                <div className="space-y-2">
                                    {[
                                        { id: 'all', label: 'All Pools', count: pools.length },
                                        { id: 'open', label: 'Open for Entry', count: pools.filter(p => p.type === 'BRACKET' ? (p.status === 'OPEN' || p.status === 'DRAFT') : !(p as GameState).isLocked).length },
                                        { id: 'live', label: 'Live Now', count: pools.filter(p => p.type === 'SQUARES' && (p as GameState).scores?.gameStatus === 'in').length },
                                        { id: 'final', label: 'Completed', count: pools.filter(p => p.type === 'BRACKET' ? p.status === 'COMPLETED' : p.type === 'SQUARES' && (p as GameState).scores?.gameStatus === 'post').length },
                                    ].map((stat) => (
                                        <label key={stat.id} className="flex items-center justify-between cursor-pointer group p-2 rounded hover:bg-slate-900/30 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${filterStatus === stat.id ? 'border-indigo-500 bg-indigo-500' : 'border-slate-650 bg-transparent'}`}>
                                                    {filterStatus === stat.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                                </div>
                                                <input type="radio" name="status" className="hidden" checked={filterStatus === stat.id} onChange={() => setFilterStatus(stat.id as any)} />
                                                <span className={`text-xs font-bold uppercase tracking-wider ${filterStatus === stat.id ? 'text-white font-black' : 'text-slate-500 group-hover:text-slate-350'}`}>{stat.label}</span>
                                            </div>
                                            <span className="text-[9px] font-black bg-slate-950 text-slate-500 px-2 py-0.5 rounded-full font-mono">{stat.count}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Price Filter */}
                            <div className="bg-slate-900/30 border border-slate-850 rounded-2xl p-4">
                                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <DollarSign size={12} /> Entry Cost
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { id: 'all', label: 'Any' },
                                        { id: 'low', label: '< $20' },
                                        { id: 'mid', label: '$20-$50' },
                                        { id: 'high', label: '$50+' },
                                    ].map((price) => (
                                        <button
                                            key={price.id}
                                            onClick={() => setFilterPrice(price.id as any)}
                                            className={`text-[9px] px-3 py-1.5 rounded-xl border font-black uppercase tracking-wider transition-all ${filterPrice === price.id ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-500'}`}
                                        >
                                            {price.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Toggles */}
                            <div className="bg-slate-900/30 border border-slate-850 rounded-2xl p-4">
                                <label className="flex items-center justify-between cursor-pointer group">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1.5 rounded-xl transition-colors ${filterCharity ? 'bg-rose-500 text-white shadow-md shadow-rose-500/10' : 'bg-slate-950 text-slate-600'}`}><Heart size={16} className={filterCharity ? "fill-white" : ""} /></div>
                                        <span className={`text-xs font-black uppercase tracking-wider ${filterCharity ? 'text-white' : 'text-slate-500 group-hover:text-slate-350'}`}>Charity Only</span>
                                    </div>
                                    <div className={`w-10 h-5 rounded-full relative transition-colors ${filterCharity ? 'bg-rose-500' : 'bg-slate-800'}`} onClick={() => setFilterCharity(!filterCharity)}>
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
                                    className={`px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 ${archiveTab === 'active' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-900 text-slate-500 hover:bg-slate-800'}`}
                                >
                                    <Globe size={14} /> Active Pools
                                </button>
                                <button
                                    onClick={() => setArchiveTab('archived')}
                                    className={`px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 ${archiveTab === 'archived' ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/20' : 'bg-slate-900 text-slate-500 hover:bg-slate-800'}`}
                                >
                                    <Archive size={14} /> Archived
                                </button>
                            </div>

                            {/* Sort Options */}
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">{filteredPools.length} pool{filteredPools.length !== 1 ? 's' : ''} found</span>
                                <div className="flex items-center gap-2">
                                    <ArrowUpDown size={14} className="text-slate-600" />
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value as any)}
                                        className="bg-slate-900 border border-slate-800 text-white text-xs font-bold rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                    >
                                        <option value="date">Sort by Date</option>
                                        <option value="name">Sort by Name</option>
                                        <option value="price">Sort by Price</option>
                                        <option value="fill">Sort by Fill %</option>
                                    </select>
                                </div>
                            </div>

                            {filteredPools.length === 0 ? (
                                <div className="col-span-1 md:col-span-2 py-20 text-center text-slate-550 border border-slate-850 border-dashed rounded-3xl bg-slate-900/10">
                                    <p className="mb-2 font-black text-xs uppercase tracking-wider text-slate-500">
                                        {archiveTab === 'archived' ? 'No archived pools found.' : 'No active pools matches filtration.'}
                                    </p>
                                    {archiveTab === 'active' && (
                                        <button onClick={() => { setSearchTerm(''); setFilterStatus('all'); setFilterPrice('all'); setFilterCharity(false); setSelectedLeague('all'); }} className="text-indigo-400 hover:text-indigo-300 font-black text-[10px] uppercase tracking-wider hover:underline mt-2">Clear all filters</button>
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

                                        if (pool.type === 'BRACKET') {
                                            filled = pool.entryCount || 0;
                                            const max = pool.settings.maxEntriesTotal === -1 ? 100 : pool.settings.maxEntriesTotal;
                                            pct = pool.settings.maxEntriesTotal === -1 ? 0 : Math.round((filled / max) * 100);
                                            homeTeam = 'Tournament';
                                            awayTeam = 'Bracket';
                                            cost = pool.settings.entryFee;
                                            isLocked = pool.status === 'LOCKED' || pool.status === 'LIVE' || pool.status === 'COMPLETED';
                                        } else if (pool.type === 'SQUARES') {
                                            filled = pool.squares?.filter(s => s.owner).length || 0;
                                            pct = Math.round((filled / 100) * 100);
                                            homeTeam = pool.homeTeam;
                                            awayTeam = pool.awayTeam;
                                            homeLogo = pool.homeTeamLogo || getTeamLogo(pool.homeTeam);
                                            awayLogo = pool.awayTeamLogo || getTeamLogo(pool.awayTeam);
                                            cost = pool.costPerSquare;
                                            isLocked = pool.isLocked;
                                            charityEnabled = !!pool.charity?.enabled;
                                        } else if (pool.type === 'NFL_PLAYOFFS') {
                                            filled = Object.keys(pool.entries || {}).length || 0;
                                            pct = 0;
                                            homeTeam = pool.name || 'Pool';
                                            awayTeam = 'Playoffs';
                                            cost = pool.settings?.entryFee || 0;
                                            isLocked = pool.isLocked || false;
                                        } else if (pool.type === 'PROPS') {
                                            filled = pool.entryCount || 0;
                                            pct = 0;
                                            homeTeam = pool.name || 'Pool';
                                            awayTeam = 'Props';
                                            cost = pool.props?.cost || 0;
                                            isLocked = pool.isLocked || false;
                                        }

                                        return (
                                            <div key={pool.id} className="group bg-slate-900/30 border border-slate-800/80 hover:border-indigo-500/50 hover:bg-slate-900 rounded-3xl p-5 transition-all relative overflow-hidden flex flex-col justify-between">
                                                {charityEnabled && (
                                                    <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                                                        <Heart size={100} className="fill-rose-500 text-rose-500" />
                                                    </div>
                                                )}

                                                <div className="cursor-pointer flex-1" onClick={() => window.location.href = `/admin/${pool.id}`}>
                                                    <div className="flex justify-between items-start mb-4 relative z-10">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-12 h-12 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-sm font-black text-indigo-400 group-hover:scale-105 transition-transform uppercase">
                                                                {pool.name.substring(0, 2)}
                                                            </div>
                                                            <div>
                                                                <h3 className="text-sm font-black text-white group-hover:text-indigo-400 transition-colors line-clamp-1 flex items-center gap-2 uppercase tracking-wide">
                                                                    {pool.name}
                                                                    {!(pool.type === 'BRACKET' ? pool.isListedPublic : pool.isPublic) && <Lock size={12} className="text-amber-500" />}
                                                                </h3>
                                                                <div className="flex items-center gap-2 text-[10px] text-slate-500 font-extrabold uppercase mt-0.5">
                                                                    <span>{isBracket ? 'Bracket Pool' : pool.type === 'PROPS' ? 'Side Hustle' : pool.type === 'NFL_PLAYOFFS' ? 'Playoff Challenge' : 'Squares Pool'}</span>
                                                                    {charityEnabled && <span className="text-rose-450 flex items-center gap-1 font-black">• <Heart size={10} className="fill-rose-450" /> Charity</span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <span className="block text-base font-black text-emerald-400 font-mono leading-none">${cost}</span>
                                                            <span className="text-[8px] text-slate-500 uppercase font-black tracking-widest mt-1 block">{isBracket ? 'Entry Fee' : 'Per Entry'}</span>
                                                        </div>
                                                    </div>

                                                    <div className="bg-slate-950/40 rounded-2xl p-3.5 border border-slate-850 mb-4 relative z-10">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="flex items-center gap-2">
                                                                {awayLogo && <img src={awayLogo} className="w-6 h-6 object-contain opacity-80" />}
                                                                <span className="text-xs font-black text-slate-300 uppercase">{awayTeam}</span>
                                                            </div>
                                                            <span className="text-[9px] text-slate-650 font-black uppercase">VS</span>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-black text-slate-300 uppercase">{homeTeam}</span>
                                                                {homeLogo && <img src={homeLogo} className="w-6 h-6 object-contain opacity-80" />}
                                                            </div>
                                                        </div>
                                                        <div className="text-center mt-2 pt-2 border-t border-slate-850/40">
                                                            <span className="text-[9px] uppercase font-black text-slate-500 tracking-wider font-mono">
                                                                {(() => {
                                                                    if (pool.type === 'BRACKET') {
                                                                        return pool.lockAt ? new Date(pool.lockAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date TBD';
                                                                    } else if (pool.type === 'NFL_PLAYOFFS') {
                                                                        return pool.lockDate ? new Date(pool.lockDate).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date TBD';
                                                                    } else if (pool.type === 'SQUARES' && pool.scores?.startTime) {
                                                                        return new Date(pool.scores.startTime!).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                                                    } else {
                                                                        return 'Date TBD';
                                                                    }
                                                                })()}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-4 mb-4">
                                                        <div className="flex items-center gap-1.5">
                                                            {(isBracket || pool.type === 'SQUARES') && (
                                                                <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                                                                </div>
                                                            )}
                                                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{(isBracket || pool.type === 'PROPS' || pool.type === 'NFL_PLAYOFFS') ? `${filled} Entries` : `${100 - filled} Left`}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {!isLocked ? (
                                                                <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 text-[9px] font-black uppercase tracking-wider">Open</span>
                                                            ) : (
                                                                <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 text-[9px] font-black uppercase tracking-wider">Locked</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-12 gap-2 relative z-20 pt-4 border-t border-slate-800/50 mt-auto">
                                                    <button onClick={(e) => { e.stopPropagation(); window.location.href = `/admin/${pool.id}`; }} className="col-span-4 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-colors shadow-lg shadow-indigo-500/20">Manage</button>
                                                    <button onClick={(e) => { e.stopPropagation(); window.location.href = `/pool/${pool.id}`; }} className="col-span-3 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-colors border border-slate-800">View</button>
                                                    {onDuplicatePool && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onDuplicatePool(pool.id); }}
                                                            className="col-span-2 bg-slate-950 hover:bg-slate-905 text-slate-400 hover:text-white rounded-xl flex items-center justify-center transition-all border border-slate-800"
                                                            title="Duplicate Pool"
                                                        >
                                                            <Copy size={13} />
                                                        </button>
                                                    )}
                                                    {onArchivePool && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onArchivePool(pool.id, archiveTab !== 'archived'); }}
                                                            className={`col-span-2 rounded-xl flex items-center justify-center transition-all border ${archiveTab === 'archived'
                                                                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20'
                                                                : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/20'
                                                                }`}
                                                            title={archiveTab === 'archived' ? 'Restore Pool' : 'Archive Pool'}
                                                        >
                                                            {archiveTab === 'archived' ? <RotateCcw size={13} /> : <Archive size={13} />}
                                                        </button>
                                                    )}
                                                    <button onClick={(e) => { e.stopPropagation(); setDeleteModal({ isOpen: true, poolId: pool.id, poolName: pool.name }); }} className="col-span-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-455 border border-rose-500/20 hover:border-rose-500/50 rounded-xl flex items-center justify-center transition-all px-1"><Trash2 size={13} /></button>
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

            {deleteModal.isOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-2xl max-w-md w-full relative">
                        <button onClick={() => { setDeleteModal({ isOpen: false, poolId: '', poolName: '' }); setDeleteConfirmText(''); }} className="absolute top-4 right-4 text-slate-400 hover:text-white">
                            <X size={20} />
                        </button>

                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 flex items-center justify-center text-rose-400">
                                <AlertTriangle size={24} />
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-white uppercase tracking-wider">Delete Pool</h3>
                                <p className="text-xs text-slate-500 uppercase font-bold mt-0.5">This action cannot be undone</p>
                            </div>
                        </div>

                        <div className="bg-slate-950 rounded-2xl p-4 mb-4 border border-slate-850">
                            <p className="text-xs text-slate-400 font-bold mb-3 leading-normal">
                                To confirm deletion, please type the pool name:
                            </p>
                            <p className="text-xs font-mono bg-slate-950 px-3 py-2 rounded-xl border border-slate-850 text-amber-400 mb-3 font-bold select-none text-center">
                                {deleteModal.poolName}
                            </p>
                            <input
                                type="text"
                                value={deleteConfirmText}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                placeholder="Type pool name here..."
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => { setDeleteModal({ isOpen: false, poolId: '', poolName: '' }); setDeleteConfirmText(''); }}
                                className="flex-1 py-3 bg-slate-950 border border-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-black uppercase tracking-wider transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    if (deleteConfirmText === deleteModal.poolName) {
                                        onDeletePool(deleteModal.poolId);
                                        setDeleteModal({ isOpen: false, poolId: '', poolName: '' });
                                        setDeleteConfirmText('');
                                    } else {
                                        alert("Pool name does not match.");
                                    }
                                }}
                                disabled={deleteConfirmText !== deleteModal.poolName}
                                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all hover:scale-[1.02] shadow-lg shadow-rose-600/10"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <Footer />
        </div>
    );
};
