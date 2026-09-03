import { OverlayRoot } from './ui/OverlayRoot';
import React, { useState, useMemo, useEffect } from 'react';
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
  ChevronUp,
  Ticket,
  Clock,
  Gift
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
import { dbService } from '../services/dbService';
import { Header } from './Header';
import { Footer } from './Footer';
import { getTeamLogo } from '../constants';
import { isSuperAdmin } from '../utils/auth';
import { Loader } from 'lucide-react';
import { useToast } from './ui/Toast';
import { Badge, Button } from './ui';

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
    const toast = useToast();
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
            { name: 'Squares', value: squares, color: '#C9A867' },
            { name: 'Props', value: props, color: '#8C6D33' },
            { name: 'MM Brackets', value: bracket, color: '#24507F' },
            { name: 'Playoffs', value: playoff, color: '#1A3B62' }
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
            <div className="min-h-screen bg-page text-[color:var(--text)] flex items-center justify-center p-4">
                <div className="text-center">
                    <p className="mb-4 text-muted font-display font-bold uppercase text-xs tracking-[0.08em]">Please sign in to access the dashboard.</p>
                    <Button variant="primary" onClick={onOpenAuth}>Sign In</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-page text-[color:var(--text)] font-body selection:bg-gold-500 selection:text-navy-950">
            <Header
                user={user}
                isManager={true}
                onOpenAuth={onOpenAuth}
                onLogout={onLogout}
                onCreatePool={onCreatePool}
            />

            <main className="max-w-7xl mx-auto p-4 md:p-8 mt-6">
                <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-6 border-b border-line pb-8">
                    <div>
                        <h2 className="text-3xl font-display font-extrabold uppercase leading-[0.9] text-[color:var(--text)] flex items-center gap-3">
                            <LayoutDashboard className="text-gold-600 dark:text-gold-400" /> League Empire Manager
                        </h2>
                        <p className="text-muted text-sm mt-1 font-body">Configure, audit, and coordinate your complete pool portfolio.</p>
                    </div>
                    <button
                        onClick={isSuperAdmin(user) ? onCreatePool : undefined}
                        disabled={!isSuperAdmin(user)}
                        className={`px-6 py-3.5 rounded-md font-display font-bold text-xs uppercase tracking-[0.08em] flex items-center gap-2 transition duration-150 ${isSuperAdmin(user)
                            ? "bg-brandred-600 hover:bg-brandred-500 text-white shadow-red-cta hover:-translate-y-px"
                            : "bg-surface text-faint border border-line cursor-not-allowed opacity-80"
                            }`}
                        title={isSuperAdmin(user) ? "Create a new pool" : "Pool creation is coming soon"}
                    >
                        <Plus size={16} /> Create New Pool
                    </button>
                </div>

                {connectionError && (
                    <div className="bg-brandred-600/10 border border-brandred-600 text-brandred-600 p-4 rounded-2xl mb-6 flex items-center gap-3 animate-pulse text-xs font-bold">
                        <Zap className="text-brandred-600" />
                        <div>
                            <p className="font-display font-bold uppercase tracking-[0.05em]">Platform Sync Interrupted</p>
                            <p className="text-muted text-xs mt-0.5 font-body">{connectionError}. Re-establishing connections.</p>
                        </div>
                    </div>
                )}

                {/* --- COLLAPSIBLE LEAGUE EMPIRE MANAGER STATS & CHARTING --- */}
                {!isLoading && pools.length > 0 && (
                    <div className="bg-card border border-line rounded-3xl p-5 mb-8 shadow-card">
                        <button
                            onClick={() => setIsEmpireStatsExpanded(!isEmpireStatsExpanded)}
                            className="w-full flex justify-between items-center text-xs font-display font-bold uppercase text-muted hover:text-[color:var(--text)] transition-colors"
                        >
                            <span className="flex items-center gap-2 tracking-[0.16em]">
                                <TrendingUp size={14} className="text-gold-600 dark:text-gold-400" /> Managed Empire Statistics
                            </span>
                            {isEmpireStatsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>

                        {isEmpireStatsExpanded && (
                            <div className="mt-6 space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
                                {/* Statistics Grid */}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    {[
                                        { title: 'Total Collected Buy-Ins', value: `$${empireStats.collected.toLocaleString()}`, icon: DollarSign, color: 'text-[#0F7B4A]' },
                                        { title: 'Outstanding Dues', value: `$${empireStats.outstanding.toLocaleString()}`, icon: AlertTriangle, color: 'text-[#B4530A]' },
                                        { title: 'Total Registrations', value: `${empireStats.totalEntries} Players`, icon: Users, color: 'text-navy-700 dark:text-[#9FB0CC]' },
                                        { title: 'Potential Prize Pools', value: `$${empireStats.totalPot.toLocaleString()}`, icon: Trophy, color: 'text-gold-700 dark:text-gold-400' }
                                    ].map((stat, i) => (
                                        <div key={i} className="bg-surface border border-line p-4 rounded-2xl flex items-center gap-4">
                                            <div className={`p-2.5 bg-card border border-line rounded-xl ${stat.color}`}>
                                                <stat.icon size={16} />
                                            </div>
                                            <div>
                                                <span className="text-[8px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-1">{stat.title}</span>
                                                <span className="text-base font-display font-bold text-[color:var(--text)] block leading-none num">{stat.value}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Recharts Visualizations */}
                                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                                    {/* BarChart: Collected vs Outstanding */}
                                    <div className="lg:col-span-3 bg-surface border border-line p-5 rounded-2xl h-64 flex flex-col justify-between">
                                        <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-4">Revenue Breakdown by Pool</span>
                                        <div className="flex-1 w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={revenueChartData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                                                    <XAxis dataKey="name" stroke="#7C8698" fontSize={8} fontWeight="bold" />
                                                    <YAxis stroke="#7C8698" fontSize={8} fontWeight="bold" />
                                                    <Tooltip contentStyle={{ backgroundColor: '#0E1C34', borderColor: 'rgba(230,206,150,0.16)', borderRadius: '12px', fontSize: '9px' }} />
                                                    <Bar dataKey="Collected" fill="#0F7B4A" radius={[3, 3, 0, 0]} />
                                                    <Bar dataKey="Outstanding" fill="#B4530A" radius={[3, 3, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>

                                    {/* PieChart: Pool Type Split */}
                                    <div className="lg:col-span-2 bg-surface border border-line p-5 rounded-2xl h-64 flex flex-col justify-between">
                                        <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-2">Portfolio split</span>
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
                                                            <Tooltip contentStyle={{ backgroundColor: '#0E1C34', borderColor: 'rgba(230,206,150,0.16)', borderRadius: '12px', fontSize: '9px' }} />
                                                        </PieChart>
                                                    </ResponsiveContainer>
                                                    <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                                                        <span className="text-xl font-display font-bold text-[color:var(--text)] num leading-none">{pools.length}</span>
                                                        <span className="text-[7px] font-display font-bold text-muted uppercase tracking-[0.08em] mt-0.5">Active</span>
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[8px] font-display font-bold uppercase tracking-[0.08em] mt-2">
                                                    {poolTypePopularityData.map((e, idx) => (
                                                        <div key={idx} className="flex items-center gap-1" style={{ color: e.color }}>
                                                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: e.color }}></span>
                                                            {e.name} (<span className="num">{e.value}</span>)
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-faint font-bold text-xs text-center py-20 font-body">No active pools in portfolio.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* My Bundles & Credits (read-only entitlement transparency) */}
                <MyBundlesCard user={user} />

                {isLoading ? (
                    <div className="text-center py-20">
                        <Loader className="animate-spin inline-block mb-4 text-gold-500" size={48} />
                        <p className="text-muted font-body font-medium">Loading your pools...</p>
                    </div>
                ) : pools.length === 0 ? (
                    <div className="text-center py-20 bg-card rounded-xl border border-line border-dashed">
                        <Globe size={48} className="mx-auto text-faint mb-4" />
                        <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">No Pools Yet</h3>
                        <p className="text-muted font-body font-medium mb-6">Get started by creating your first Game Day Squares pool!</p>
                        <button
                            onClick={isSuperAdmin(user) ? onCreatePool : undefined}
                            disabled={!isSuperAdmin(user)}
                            className={`px-6 py-2 rounded-md font-display font-bold uppercase tracking-[0.05em] transition-colors ${isSuperAdmin(user)
                                ? "bg-navy-800 hover:bg-navy-700 text-white"
                                : "bg-surface text-faint border border-line cursor-not-allowed opacity-80"
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
                                    className="w-full bg-page border-[1.5px] border-line rounded-md py-3 px-4 pl-10 text-[color:var(--text)] outline-none focus:border-navy-600 focus:bg-surface transition-colors text-xs font-body font-semibold placeholder:text-faint"
                                />
                                <Search className="absolute left-3 top-3.5 text-faint" size={16} />
                            </div>

                            {/* Pool Type Filter */}
                            <div className="bg-card border border-line rounded-2xl p-4 shadow-card">
                                <h3 className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-3 flex items-center gap-2">
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
                                            className={`w-full text-left px-3 py-2.5 rounded-md text-xs font-display font-bold uppercase tracking-[0.08em] transition flex justify-between items-center ${filterType === type.id
                                                ? 'bg-gold-500/10 border-l-4 border-gold-500 text-[color:var(--text)] shadow-sm'
                                                : 'text-muted hover:text-[color:var(--text)] hover:bg-surface'
                                                }`}
                                        >
                                            <span>{type.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Sport Filter */}
                            <div className="bg-card border border-line rounded-2xl p-4 shadow-card">
                                <h3 className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-3 flex items-center gap-2">
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
                                            className={`w-full text-left px-3 py-2.5 rounded-md text-xs font-display font-bold uppercase tracking-[0.08em] transition flex justify-between items-center ${!sport.active
                                                ? 'opacity-30 cursor-not-allowed text-faint'
                                                : selectedLeague === sport.id
                                                    ? 'bg-gold-500/10 border-l-4 border-gold-500 text-[color:var(--text)]'
                                                    : 'text-muted hover:text-[color:var(--text)] hover:bg-surface'
                                                }`}
                                        >
                                            <span>{sport.label}</span>
                                            {!sport.active && <span className="text-[8px] uppercase font-display font-bold bg-surface px-1.5 py-0.5 rounded text-faint border border-line">Soon</span>}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Status Filters */}
                            <div className="bg-card border border-line rounded-2xl p-4 shadow-card">
                                <h3 className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-3 flex items-center gap-2">
                                    <Filter size={12} /> Pool Status
                                </h3>
                                <div className="space-y-2">
                                    {[
                                        { id: 'all', label: 'All Pools', count: pools.length },
                                        { id: 'open', label: 'Open for Entry', count: pools.filter(p => p.type === 'BRACKET' ? (p.status === 'OPEN' || p.status === 'DRAFT') : !(p as GameState).isLocked).length },
                                        { id: 'live', label: 'Live Now', count: pools.filter(p => p.type === 'SQUARES' && (p as GameState).scores?.gameStatus === 'in').length },
                                        { id: 'final', label: 'Completed', count: pools.filter(p => p.type === 'BRACKET' ? p.status === 'COMPLETED' : p.type === 'SQUARES' && (p as GameState).scores?.gameStatus === 'post').length },
                                    ].map((stat) => (
                                        <label key={stat.id} className="flex items-center justify-between cursor-pointer group p-2 rounded hover:bg-surface transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${filterStatus === stat.id ? 'border-gold-600 bg-gold-600' : 'border-line bg-transparent'}`}>
                                                    {filterStatus === stat.id && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                                </div>
                                                <input type="radio" name="status" className="hidden" checked={filterStatus === stat.id} onChange={() => setFilterStatus(stat.id as any)} />
                                                <span className={`text-xs font-display font-bold uppercase tracking-[0.08em] ${filterStatus === stat.id ? 'text-[color:var(--text)]' : 'text-muted group-hover:text-[color:var(--text)]'}`}>{stat.label}</span>
                                            </div>
                                            <span className="text-[9px] font-display font-bold bg-surface text-muted px-2 py-0.5 rounded-full num">{stat.count}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Price Filter */}
                            <div className="bg-card border border-line rounded-2xl p-4 shadow-card">
                                <h3 className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-3 flex items-center gap-2">
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
                                            className={`text-[9px] px-3 py-1.5 rounded-md border font-display font-bold uppercase tracking-[0.08em] num transition ${filterPrice === price.id ? 'bg-gold-500/15 border-gold-500 text-gold-700 dark:text-gold-400' : 'bg-surface border-line text-muted hover:border-navy-600'}`}
                                        >
                                            {price.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Toggles */}
                            <div className="bg-card border border-line rounded-2xl p-4 shadow-card">
                                <label className="flex items-center justify-between cursor-pointer group">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1.5 rounded-xl transition-colors ${filterCharity ? 'bg-gold-foil text-navy-950' : 'bg-surface text-faint'}`}><Heart size={16} className={filterCharity ? "fill-navy-950" : ""} /></div>
                                        <span className={`text-xs font-display font-bold uppercase tracking-[0.08em] ${filterCharity ? 'text-[color:var(--text)]' : 'text-muted group-hover:text-[color:var(--text)]'}`}>Charity Only</span>
                                    </div>
                                    <div className={`w-10 h-5 rounded-full relative transition-colors ${filterCharity ? 'bg-navy-800 dark:bg-gold-600' : 'bg-line'}`} onClick={() => setFilterCharity(!filterCharity)}>
                                        <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform duration-150 ${filterCharity ? 'translate-x-5' : 'translate-x-0'}`} />
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
                                    className={`px-4 py-2.5 rounded-md font-display font-bold text-xs uppercase tracking-[0.08em] transition flex items-center gap-2 ${archiveTab === 'active' ? 'bg-navy-800 text-white' : 'bg-surface border border-line text-muted hover:bg-card hover:text-[color:var(--text)]'}`}
                                >
                                    <Globe size={14} /> Active Pools
                                </button>
                                <button
                                    onClick={() => setArchiveTab('archived')}
                                    className={`px-4 py-2.5 rounded-md font-display font-bold text-xs uppercase tracking-[0.08em] transition flex items-center gap-2 ${archiveTab === 'archived' ? 'bg-gold-foil text-navy-950' : 'bg-surface border border-line text-muted hover:bg-card hover:text-[color:var(--text)]'}`}
                                >
                                    <Archive size={14} /> Archived
                                </button>
                            </div>

                            {/* Sort Options */}
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] num">{filteredPools.length} pool{filteredPools.length !== 1 ? 's' : ''} found</span>
                                <div className="flex items-center gap-2">
                                    <ArrowUpDown size={14} className="text-faint" />
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value as any)}
                                        className="bg-page border-[1.5px] border-line text-[color:var(--text)] text-xs font-body font-bold rounded-md px-3 py-2 outline-none focus:border-navy-600 cursor-pointer transition-colors"
                                    >
                                        <option value="date">Sort by Date</option>
                                        <option value="name">Sort by Name</option>
                                        <option value="price">Sort by Price</option>
                                        <option value="fill">Sort by Fill %</option>
                                    </select>
                                </div>
                            </div>

                            {filteredPools.length === 0 ? (
                                <div className="col-span-1 md:col-span-2 py-20 text-center text-faint border border-line border-dashed rounded-3xl bg-surface">
                                    <p className="mb-2 font-display font-bold text-xs uppercase tracking-[0.08em] text-muted">
                                        {archiveTab === 'archived' ? 'No archived pools found.' : 'No active pools matches filtration.'}
                                    </p>
                                    {archiveTab === 'active' && (
                                        <button onClick={() => { setSearchTerm(''); setFilterStatus('all'); setFilterPrice('all'); setFilterCharity(false); setSelectedLeague('all'); }} className="text-gold-700 dark:text-gold-400 hover:text-gold-600 dark:hover:text-gold-300 font-display font-bold text-[10px] uppercase tracking-[0.08em] hover:underline mt-2">Clear all filters</button>
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
                                            <div key={pool.id} className="group bg-card border border-line hover:border-gold-500 rounded-3xl p-5 transition duration-150 hover:-translate-y-1 shadow-card hover:shadow-card-hover relative overflow-hidden flex flex-col justify-between">
                                                {charityEnabled && (
                                                    <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                                                        <Heart size={100} className="fill-gold-500 text-gold-500" />
                                                    </div>
                                                )}

                                                <div className="cursor-pointer flex-1" onClick={() => window.location.href = `/admin/${pool.id}`}>
                                                    <div className="flex justify-between items-start mb-4 relative z-10">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-12 h-12 rounded-xl bg-surface border border-line flex items-center justify-center text-sm font-display font-bold text-navy-700 dark:text-[#9FB0CC] group-hover:scale-105 transition-transform uppercase">
                                                                {pool.name.substring(0, 2)}
                                                            </div>
                                                            <div>
                                                                <h3 className="text-sm font-display font-bold text-[color:var(--text)] group-hover:text-gold-700 dark:group-hover:text-gold-400 transition-colors line-clamp-1 flex items-center gap-2 uppercase tracking-wide">
                                                                    {pool.name}
                                                                    {!(pool.type === 'BRACKET' ? pool.isListedPublic : pool.isPublic) && <Lock size={12} className="text-gold-600 dark:text-gold-400" />}
                                                                </h3>
                                                                <div className="flex items-center gap-2 text-[10px] text-muted font-display font-bold uppercase mt-0.5">
                                                                    <span>{isBracket ? 'Bracket Pool' : pool.type === 'PROPS' ? 'Side Hustle' : pool.type === 'NFL_PLAYOFFS' ? 'Playoff Challenge' : 'Squares Pool'}</span>
                                                                    {charityEnabled && <span className="text-gold-700 dark:text-gold-400 flex items-center gap-1 font-display font-bold">• <Heart size={10} className="fill-gold-500 text-gold-500" /> Charity</span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <span className="block text-base font-display font-bold text-gold-700 dark:text-gold-400 num leading-none">${cost}</span>
                                                            <span className="text-[8px] text-muted uppercase font-display font-bold tracking-[0.08em] mt-1 block">{isBracket ? 'Entry Fee' : 'Per Entry'}</span>
                                                        </div>
                                                    </div>

                                                    <div className="bg-surface rounded-2xl p-3.5 border border-line mb-4 relative z-10">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="flex items-center gap-2">
                                                                {awayLogo && <img src={awayLogo} alt="" className="w-6 h-6 object-contain opacity-80" />}
                                                                <span className="text-xs font-display font-bold text-[color:var(--text)] uppercase">{awayTeam}</span>
                                                            </div>
                                                            <span className="text-[9px] text-faint font-display font-bold uppercase">VS</span>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-display font-bold text-[color:var(--text)] uppercase">{homeTeam}</span>
                                                                {homeLogo && <img src={homeLogo} alt="" className="w-6 h-6 object-contain opacity-80" />}
                                                            </div>
                                                        </div>
                                                        <div className="text-center mt-2 pt-2 border-t border-line">
                                                            <span className="text-[9px] uppercase font-display font-bold text-muted tracking-[0.08em] num">
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
                                                                <div className="w-20 h-1.5 bg-line rounded-full overflow-hidden">
                                                                    <div className="h-full bg-gold-foil rounded-full transition" style={{ width: `${pct}%` }}></div>
                                                                </div>
                                                            )}
                                                            <span className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] num">{(isBracket || pool.type === 'PROPS' || pool.type === 'NFL_PLAYOFFS') ? `${filled} Entries` : `${100 - filled} Left`}</span>
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

                                                <div className="grid grid-cols-12 gap-2 relative z-20 pt-4 border-t border-line mt-auto">
                                                    <button onClick={(e) => { e.stopPropagation(); window.location.href = `/admin/${pool.id}`; }} className="col-span-4 bg-navy-800 hover:bg-navy-700 text-white py-2 rounded-md font-display font-bold text-[10px] uppercase tracking-[0.08em] transition-colors">Manage</button>
                                                    <button onClick={(e) => { e.stopPropagation(); window.location.href = `/pool/${pool.id}`; }} className="col-span-3 bg-surface hover:bg-card text-muted hover:text-[color:var(--text)] py-2 rounded-md font-display font-bold text-[10px] uppercase tracking-[0.08em] transition-colors border border-line">View</button>
                                                    {onDuplicatePool && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onDuplicatePool(pool.id); }}
                                                            className="col-span-2 bg-surface hover:bg-card text-muted hover:text-[color:var(--text)] rounded-md flex items-center justify-center transition border border-line"
                                                            title="Duplicate Pool"
                                                        >
                                                            <Copy size={13} />
                                                        </button>
                                                    )}
                                                    {onArchivePool && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onArchivePool(pool.id, archiveTab !== 'archived'); }}
                                                            className={`col-span-2 rounded-md flex items-center justify-center transition border ${archiveTab === 'archived'
                                                                ? 'bg-[#0F7B4A]/10 hover:bg-[#0F7B4A]/20 text-[#0F7B4A] border-[#0F7B4A]/20'
                                                                : 'bg-gold-500/10 hover:bg-gold-500/20 text-gold-700 dark:text-gold-400 border-gold-500/30'
                                                                }`}
                                                            title={archiveTab === 'archived' ? 'Restore Pool' : 'Archive Pool'}
                                                        >
                                                            {archiveTab === 'archived' ? <RotateCcw size={13} /> : <Archive size={13} />}
                                                        </button>
                                                    )}
                                                    <button onClick={(e) => { e.stopPropagation(); setDeleteModal({ isOpen: true, poolId: pool.id, poolName: pool.name }); }} className="col-span-1 bg-brandred-600/10 hover:bg-brandred-600/20 text-brandred-600 border border-brandred-600/20 hover:border-brandred-600/50 rounded-md flex items-center justify-center transition px-1"><Trash2 size={13} /></button>
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
                <OverlayRoot id="manager-delete-pool" label="Delete pool" onEscape={() => { setDeleteModal({ isOpen: false, poolId: '', poolName: '' }); setDeleteConfirmText(''); }} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-card border border-line p-6 rounded-3xl shadow-panel max-w-md w-full relative">
                        <button onClick={() => { setDeleteModal({ isOpen: false, poolId: '', poolName: '' }); setDeleteConfirmText(''); }} className="absolute top-4 right-4 text-muted hover:text-[color:var(--text)]">
                            <X size={20} />
                        </button>

                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-2xl bg-brandred-600/15 flex items-center justify-center text-brandred-600">
                                <AlertTriangle size={24} />
                            </div>
                            <div>
                                <h3 className="text-lg font-display font-bold text-[color:var(--text)] uppercase tracking-[0.05em]">Delete Pool</h3>
                                <p className="text-xs text-muted uppercase font-display font-bold mt-0.5">This action cannot be undone</p>
                            </div>
                        </div>

                        <div className="bg-surface rounded-2xl p-4 mb-4 border border-line">
                            <p className="text-xs text-muted font-body font-bold mb-3 leading-normal">
                                To confirm deletion, please type the pool name:
                            </p>
                            <p className="text-xs font-body bg-page px-3 py-2 rounded-md border border-line text-gold-700 dark:text-gold-400 mb-3 font-bold select-none text-center">
                                {deleteModal.poolName}
                            </p>
                            <input
                                type="text"
                                value={deleteConfirmText}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                placeholder="Type pool name here..."
                                className="w-full bg-page border-[1.5px] border-line rounded-md px-4 py-3 text-xs font-body text-[color:var(--text)] placeholder:text-faint outline-none focus:border-brandred-500 transition-colors"
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => { setDeleteModal({ isOpen: false, poolId: '', poolName: '' }); setDeleteConfirmText(''); }}
                                className="flex-1 py-3 bg-surface border border-line text-muted hover:text-[color:var(--text)] rounded-md text-xs font-display font-bold uppercase tracking-[0.08em] transition-colors"
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
                                        toast.error("Pool name does not match.");
                                    }
                                }}
                                disabled={deleteConfirmText !== deleteModal.poolName}
                                className="flex-1 py-3 bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white rounded-md text-xs font-display font-bold uppercase tracking-[0.08em] transition shadow-red-cta"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </OverlayRoot>
            )}
            <Footer />
        </div>
    );
};

// ---------------------------------------------------------------------------
// My Bundles & Credits — read-only transparency card (PLAN Phase 4 #15).
// ---------------------------------------------------------------------------

interface BundleView {
    id: string;
    productKind?: 'CREDIT_BUNDLE' | 'UNLIMITED_PASS';
    source?: 'PURCHASE' | 'ADMIN_GRANT' | 'REFERRAL' | 'MIGRATION';
    productSnapshot?: { name?: string; price?: number; poolType?: string; maxPlayersPerPool?: number };
    creditsTotal?: number;
    creditsUsed?: number;
    termEndsAt?: number;
    status?: 'active' | 'revoked' | 'exhausted' | 'expired';
    revokedReason?: string;
    createdAt?: number;
}

const SOURCE_LABEL: Record<string, string> = {
    PURCHASE: 'Purchased',
    ADMIN_GRANT: 'Granted',
    REFERRAL: 'Referral reward',
    MIGRATION: 'Migrated',
};

const STATUS_STYLE: Record<string, string> = {
    active: 'bg-[#E4F5EC] border-[#BEE7D0] text-[#0F7B4A]',
    exhausted: 'bg-[#FBEEDD] border-[#F2D6B0] text-[#B4530A]',
    revoked: 'bg-brandred-600/10 border-brandred-600/40 text-brandred-600',
    expired: 'bg-surface border-line text-faint',
};

function daysUntil(ts: number): string {
    const ms = ts - Date.now();
    if (ms <= 0) return 'expired';
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    return days === 1 ? '1 day left' : `${days} days left`;
}

/**
 * Owner-scoped bundles/credits display. Reads via dbService.subscribeToMyBundles.
 * Client reads of `bundles` require the firestore rules Wave 5 adds; until then
 * the listener errors with permission-denied — we swallow it and hide the card
 * (never crash the dashboard). Purely read-only: no grant/redeem here.
 */
export const MyBundlesCard: React.FC<{ user: User | null }> = ({ user }) => {
    const [bundles, setBundles] = useState<BundleView[]>([]);
    const [denied, setDenied] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!user?.id) return;
        setDenied(false);
        setLoaded(false);
        const unsub = dbService.subscribeToMyBundles(
            user.id,
            (list) => {
                setBundles(list as unknown as BundleView[]);
                setLoaded(true);
            },
            (err) => {
                // permission-denied is expected until Wave 5 rules land — hide, don't crash.
                if ((err as { code?: string })?.code === 'permission-denied') setDenied(true);
                setLoaded(true);
            }
        );
        return () => unsub();
    }, [user?.id]);

    // Hide entirely when reads are blocked (rules pending) or the user owns none.
    if (denied) return null;
    if (loaded && bundles.length === 0) return null;
    if (!loaded) return null;

    const sorted = [...bundles].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return (
        <div className="bg-card border border-line rounded-3xl p-5 mb-8 shadow-card">
            <div className="flex items-center gap-2 mb-4">
                <Gift size={16} className="text-gold-600 dark:text-gold-400" />
                <h3 className="text-xs font-display font-bold uppercase tracking-[0.16em] text-muted">My Bundles &amp; Credits</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sorted.map((b) => {
                    const isPass = b.productKind === 'UNLIMITED_PASS';
                    const remaining = Math.max(0, (b.creditsTotal || 0) - (b.creditsUsed || 0));
                    const status = b.status || 'active';
                    const snap = b.productSnapshot || {};
                    return (
                        <div key={b.id} className="bg-surface border border-line rounded-2xl p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="font-display font-bold text-[color:var(--text)] text-sm flex items-center gap-1.5">
                                        {isPass ? <Zap size={14} className="text-navy-700 dark:text-[#9FB0CC]" /> : <Ticket size={14} className="text-gold-600 dark:text-gold-400" />}
                                        <span className="truncate">{snap.name || (isPass ? 'Unlimited Pass' : 'Credit Bundle')}</span>
                                    </div>
                                    <div className="text-[10px] text-faint font-body mt-0.5">
                                        {SOURCE_LABEL[b.source || ''] || b.source || ''}
                                        {typeof snap.price === 'number' && snap.price > 0 && b.source === 'PURCHASE' ? ` · $${snap.price.toFixed(2)}` : ''}
                                    </div>
                                </div>
                                <span className={`shrink-0 px-2 py-0.5 rounded-full font-display font-bold text-[9px] uppercase tracking-[0.05em] border ${STATUS_STYLE[status] || STATUS_STYLE.expired}`}>
                                    {status}
                                </span>
                            </div>

                            {/* Body: credits remaining OR pass expiry */}
                            <div className="mt-3 flex items-baseline gap-2">
                                {isPass ? (
                                    <span className="flex items-center gap-1.5 text-xs font-body text-muted">
                                        <Clock size={12} />
                                        {typeof b.termEndsAt === 'number' ? daysUntil(b.termEndsAt) : 'no term'}
                                    </span>
                                ) : (
                                    <>
                                        <span className="text-2xl font-display font-extrabold num text-[color:var(--text)]">{remaining}</span>
                                        <span className="text-[10px] text-faint font-body uppercase tracking-[0.08em]">of {b.creditsTotal || 0} credits left</span>
                                    </>
                                )}
                            </div>

                            {/* Per-credit constraints (from the product snapshot) */}
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-mono">
                                {snap.poolType && snap.poolType !== 'ALL' && (
                                    <span className="px-1.5 py-0.5 rounded bg-page border border-line text-muted">{snap.poolType}</span>
                                )}
                                {typeof snap.maxPlayersPerPool === 'number' && snap.maxPlayersPerPool < 9999 && (
                                    <span className="px-1.5 py-0.5 rounded bg-page border border-line text-muted">≤ {snap.maxPlayersPerPool} players</span>
                                )}
                                {(!snap.poolType || snap.poolType === 'ALL') && (!snap.maxPlayersPerPool || snap.maxPlayersPerPool >= 9999) && (
                                    <span className="px-1.5 py-0.5 rounded bg-page border border-line text-faint">Any pool</span>
                                )}
                            </div>

                            {/* Revocation notice */}
                            {(status === 'revoked' || status === 'expired') && b.revokedReason && (
                                <div className="mt-2 flex items-start gap-1.5 text-[10px] text-brandred-600 font-body">
                                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                                    <span>{status === 'revoked' ? 'Revoked' : 'Ended'}: {b.revokedReason}</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
