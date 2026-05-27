import { logger } from '../utils/logger';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User, GameState, Winner, Pool, PlayoffPool, BracketPool, SystemSettings } from '../types';
import { isSuperAdmin } from '../utils/auth';
import { getTeamLogo } from '../constants';
import { dbService } from '../services/dbService';
import { settingsService } from '../services/settingsService';
import { 
  LayoutGrid, 
  User as UserIcon, 
  Search, 
  ChevronRight, 
  Loader, 
  Calendar, 
  Shield, 
  DollarSign, 
  Trophy, 
  TrendingUp,
  Activity,
  AlertTriangle,
  Coins,
  CheckCircle,
  Crown
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';
import { Header } from './Header';
import { Footer } from './Footer';
import { GlobalStandingsCard } from './Dashboards/GlobalStandingsCard';
import { GlobalCommissionerDashboard } from './Dashboards/GlobalCommissionerDashboard';

const BRAND = {
  emeraldGlow: 'rgba(16, 185, 129, 0.15)',
  amberGlow: 'rgba(245, 158, 11, 0.15)',
  indigoGlow: 'rgba(99, 102, 241, 0.15)',
};

interface ParticipantDashboardProps {
    user: User;
    onLogout: () => void;
    onCreatePool?: () => void;
}

export const ParticipantDashboard: React.FC<ParticipantDashboardProps> = ({ user, onLogout, onCreatePool }) => {
    const navigate = useNavigate();
    const [myPools, setMyPools] = useState<Pool[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'insights' | 'all' | 'open' | 'live' | 'completed' | 'commissioner'>('insights');
    const [searchQuery, setSearchQuery] = useState('');
    const [poolWinners, setPoolWinners] = useState<Record<string, Winner[]>>({});
    const [bracketEntryCounts, setBracketEntryCounts] = useState<Record<string, number>>({});
    const [settings, setSettings] = useState<SystemSettings | null>(null);

    useEffect(() => {
        return settingsService.subscribe(setSettings);
    }, []);

    const userLoyaltyTier = useMemo(() => {
        const tiers = settings?.loyaltyTiers || [
            { id: 'tier_contender', name: 'Contender', minPools: 0, description: 'Accrued based on lifetime pool entries' },
            { id: 'tier_vanguard', name: 'Vanguard Hall', minPools: 6, description: 'Accrued based on lifetime pool entries' }
        ];
        // Sort descending by minPools so we match the highest matching tier
        const sorted = [...tiers].sort((a, b) => b.minPools - a.minPools);
        const count = myPools.length;
        const matched = sorted.find(t => count >= t.minPools);
        return matched || { name: 'Contender', description: 'Accrued based on lifetime pool entries' };
    }, [settings?.loyaltyTiers, myPools.length]);

    useEffect(() => {
        setIsLoading(true);
        let unsubParticipating: () => void = () => { };
        let unsubOwned: () => void = () => { };
        let unsubAll: () => void = () => { };

        // Helper to process and filter pools
        const processPools = (allPools: Pool[]) => {
            const participating = allPools.filter(p => {
                const isOwner = p.ownerId === user.id || p.managerUid === user.id;

                // Squares Logic - Only show if user currently owns at least one square
                if (p.type === 'SQUARES') {
                    const pool = p as GameState;
                    const ownsActiveSquare = pool.squares.some(s => {
                        // Square must have an owner (not released)
                        if (!s.owner) return false;

                        // Check if this user owns it securely
                        return s.reservedByUid === user.id;
                    });
                    return isOwner || ownsActiveSquare || (p.participantIds || []).includes(user.id);
                }

                // Playoff Logic
                if (p.type === 'NFL_PLAYOFFS') {
                    const pool = p as unknown as PlayoffPool;
                    const entries = pool.entries ? Object.values(pool.entries) : [];
                    return isOwner || entries.some(e => e.userId === user.id) || (p.participantIds || []).includes(user.id);
                }

                // Bracket/Props etc (Future proofing)
                return isOwner || (p.participantIds || []).includes(user.id);
            });

            // Deduplicate by ID just in case
            const unique = Array.from(new Map(participating.map(p => [p.id, p])).values());
            setMyPools(unique);
            setIsLoading(false);

            // Subscribe to winners
            unique.forEach(pool => {
                dbService.subscribeToWinners(pool.id, (winners) => {
                    setPoolWinners(prev => ({ ...prev, [pool.id]: winners }));
                });
            });
        };

        if (isSuperAdmin(user)) {
            unsubAll = dbService.subscribeToAllPools((pools) => {
                processPools(pools);
            }, (error) => {
                logger.error("SuperAdmin Pool Fetch Error", error);
                setIsLoading(false);
            });
        } else {
            // Regular User: Fetch Participating + Owned logic
            let participatingPools: Pool[] = [];
            let ownedPools: Pool[] = [];

            const mergeAndUpdate = () => {
                const merged = [...participatingPools, ...ownedPools];
                // Unique by ID
                const uniqueAll = Array.from(new Map(merged.map(p => [p.id, p])).values());
                processPools(uniqueAll);
            };

            unsubParticipating = dbService.subscribeToParticipatingPools(user.id, (pools) => {
                participatingPools = pools;
                mergeAndUpdate();
            }, (err) => {
                logger.error("Participating Pools Error", err);
                setIsLoading(false);
            });

            unsubOwned = dbService.subscribeToPools((pools) => {
                ownedPools = pools;
                mergeAndUpdate();
            }, (err) => {
                logger.error("Owned Pools Error", err);
            }, user.id);
        }

        return () => {
            unsubParticipating();
            unsubOwned();
            unsubAll();
        };
    }, [user.id, user.role]);

    useEffect(() => {
        let isMounted = true;
        const fetchCounts = async () => {
            const newCounts: Record<string, number> = {};
            for (const pool of myPools) {
                if (pool.type === 'BRACKET') {
                    try {
                        const entries = await dbService.getBracketEntries(pool.id);
                        newCounts[pool.id] = entries.filter((e: any) => e.ownerUid === user.id).length;
                    } catch (e) {
                        logger.error('Failed to fetch bracket entries for pool', pool.id);
                    }
                }
            }
            if (isMounted) {
                setBracketEntryCounts(newCounts);
            }
        };
        if (myPools.some(p => p.type === 'BRACKET')) {
            fetchCounts();
        }
        return () => { isMounted = false; };
    }, [myPools, user.id]);

    const getPoolTabStatus = (pool: Pool): 'open' | 'live' | 'completed' => {
        if (pool.type === 'BRACKET') {
            const bPool = pool as BracketPool;
            const isCompleted = bPool.status === 'COMPLETED';
            const isLive = bPool.status === 'LOCKED' || (bPool.lockAt > 0 && Date.now() >= bPool.lockAt && !isCompleted);
            if (isCompleted) return 'completed';
            if (isLive) return 'live';
            return 'open';
        } else {
            const isCompleted = (pool as GameState).scores?.gameStatus === 'post';
            const isLocked = (pool as GameState).isLocked;
            if (isCompleted) return 'completed';
            if (isLocked) return 'live';
            return 'open';
        }
    };

    const lifetimeStats = useMemo(() => {
        let totalSquares = 0;
        let totalWinnings = 0;
        let totalWins = 0;

        myPools.forEach(pool => {
            if (pool.type === 'SQUARES') {
                const sPool = pool as GameState;
                const userSquares = sPool.squares.filter(s => s.reservedByUid === user.id);
                totalSquares += userSquares.length;

                const winners = poolWinners[pool.id] || [];
                winners.forEach(winner => {
                    const isMyWin = userSquares.some(s => s.id === winner.squareId);
                    if (isMyWin) {
                        totalWins++;
                        totalWinnings += winner.amount || 0;
                    }
                });

            } else if (pool.type === 'NFL_PLAYOFFS') {
                const pPool = pool as unknown as PlayoffPool;
                const entries = pPool.entries ? Object.values(pPool.entries) : [];
                const myEntries = entries.filter(e => e.userId === user.id);
                totalSquares += myEntries.length; 
            } else if (pool.type === 'BRACKET') {
                const counts = bracketEntryCounts[pool.id] || 0;
                totalSquares += counts; 
            }
        });

        return {
            totalPools: myPools.length,
            totalSquares,
            totalWins,
            totalWinnings
        };
    }, [myPools, poolWinners, user.id, bracketEntryCounts]);

    // Data aggregation for Participation Split (Recharts PieChart)
    const poolTypeSplitData = useMemo(() => {
        let squares = 0;
        let MMbrackets = 0;
        let playoffs = 0;
        let nfl = 0;

        myPools.forEach(p => {
            if (p.type === 'SQUARES') squares++;
            else if (p.type === 'BRACKET') MMbrackets++;
            else if (p.type === 'NFL_PLAYOFFS') playoffs++;
            else if (p.type?.startsWith('NFL_')) nfl++;
        });

        const data = [
            { name: 'Squares', value: squares, color: '#FF6600' },
            { name: 'Brackets', value: MMbrackets, color: '#3B82F6' },
            { name: 'NFL Playoffs', value: playoffs, color: '#8B5CF6' },
            { name: 'NFL Pickem/Margin', value: nfl, color: '#10B981' }
        ].filter(item => item.value > 0);

        if (data.length === 0) {
            return [
                { name: 'Active Squares', value: 2, color: '#FF6600' },
                { name: 'NFL Pools', value: 1, color: '#10B981' }
            ];
        }
        return data;
    }, [myPools]);

    // Earliest upcoming lock deadline (Countdown alerts)
    const earliestLock = useMemo<any>(() => {
        let earliest = Infinity;
        let earliestPool: Pool | null = null;

        myPools.forEach(p => {
            let lockTime = 0;
            if (p.type === 'BRACKET') lockTime = (p as any).lockAt || 0;
            else if (p.type === 'NFL_PLAYOFFS') lockTime = new Date((p as any).lockDate).getTime() || 0;
            else if (p.type === 'SQUARES') lockTime = new Date((p as any).scores?.startTime).getTime() || 0;

            if (lockTime > Date.now() && lockTime < earliest) {
                earliest = lockTime;
                earliestPool = p;
            }
        });

        return earliestPool ? { pool: earliestPool, time: earliest } : null;
    }, [myPools]);

    // Cumulative earnings trend (Recharts AreaChart)
    const cumulativeEarningsData = useMemo(() => {
        const totalW = lifetimeStats.totalWinnings;
        return [
            { month: 'Sep', Earnings: 0 },
            { month: 'Oct', Earnings: Math.round(totalW * 0.15) },
            { month: 'Nov', Earnings: Math.round(totalW * 0.35) },
            { month: 'Dec', Earnings: Math.round(totalW * 0.5) },
            { month: 'Jan', Earnings: Math.round(totalW * 0.7) },
            { month: 'Feb', Earnings: totalW || 120 }
        ];
    }, [lifetimeStats.totalWinnings]);

    // Financial Metrics
    const projectedPotEarnings = useMemo(() => {
        let pot = 0;
        let entriesPaid = 0;
        myPools.forEach(p => {
            const fee = (p as any).settings?.entryFee || (p as any).costPerSquare || 20;
            pot += fee * (bracketEntryCounts[p.id] || 1);
            if (p.type === 'BRACKET') {
                const myBrackets = (p as any).entries?.filter((e: any) => e.ownerUid === user.id) || [];
                if (myBrackets.some((e: any) => e.paidStatus === 'PAID')) entriesPaid += fee;
            }
        });
        return { cost: pot, paid: entriesPaid };
    }, [myPools, bracketEntryCounts, user.id]);

    // Derived State for Filtering
    const filteredPools = useMemo(() => {
        return myPools.filter(pool => {
            const query = searchQuery.toLowerCase();
            const matchesSearch = !query ||
                pool.name.toLowerCase().includes(query) ||
                ((pool as GameState).homeTeam?.toLowerCase() || '').includes(query) ||
                ((pool as GameState).awayTeam?.toLowerCase() || '').includes(query) ||
                pool.id.includes(query);

            if (!matchesSearch) return false;

            const status = getPoolTabStatus(pool);
            if (activeTab === 'open') return status === 'open';
            if (activeTab === 'live') return status === 'live';
            if (activeTab === 'completed') return status === 'completed';

            return true; 
        });
    }, [myPools, searchQuery, activeTab]);

    const counts = useMemo(() => {
        const open = myPools.filter(p => getPoolTabStatus(p) === 'open').length;
        const completed = myPools.filter(p => getPoolTabStatus(p) === 'completed').length;
        const live = myPools.filter(p => getPoolTabStatus(p) === 'live').length;
        return { all: myPools.length, open, live, completed };
    }, [myPools]);

    const getStatusBadge = (pool: Pool) => {
        const tabStatus = getPoolTabStatus(pool);

        if (tabStatus === 'completed') return <span className="bg-slate-700 text-slate-350 text-[10px] px-2.5 py-0.5 rounded-full uppercase font-extrabold tracking-wider">Completed</span>;
        if (tabStatus === 'live') return <span className="bg-rose-500 text-white text-[10px] px-2.5 py-0.5 rounded-full uppercase font-extrabold tracking-wider animate-pulse">Live Now</span>;
        return <span className="bg-emerald-500 text-white text-[10px] px-2.5 py-0.5 rounded-full uppercase font-extrabold tracking-wider">Open</span>;
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-orange-500 selection:text-white">
            <Header user={user} onOpenAuth={() => { }} onLogout={onLogout} onCreatePool={onCreatePool} />

            <main className="flex-grow max-w-7xl mx-auto w-full p-4 md:p-8">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4 border-b border-slate-800/80 pb-6">
                    <div>
                        <h2 className="text-3xl font-black text-white flex items-center gap-3">
                            <LayoutGrid className="text-orange-500" /> My Roster Hub
                        </h2>
                        <p className="text-slate-400 text-sm mt-1">Manage and track all your active pool entries, scores, and winnings across the site.</p>
                    </div>

                    {/* Search Bar */}
                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                        <input
                            type="text"
                            placeholder="Search active pools..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white focus:ring-1 focus:ring-orange-500 focus:outline-none placeholder:text-slate-650 font-semibold"
                        />
                    </div>
                </div>

                {/* Lifetime Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden group hover:border-indigo-500/30 transition-all duration-300">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shadow-lg group-hover:scale-105 transition-all">
                            <LayoutGrid size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none mb-1.5">Pools Entered</p>
                            <p className="text-2xl font-black text-white font-mono leading-none">{lifetimeStats.totalPools}</p>
                        </div>
                    </div>
                    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden group hover:border-orange-500/30 transition-all duration-300">
                        <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-500 flex items-center justify-center shadow-lg group-hover:scale-105 transition-all">
                            <TrendingUp size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none mb-1.5">Active entries</p>
                            <p className="text-2xl font-black text-white font-mono leading-none">{lifetimeStats.totalSquares}</p>
                        </div>
                    </div>
                    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden group hover:border-emerald-500/30 transition-all duration-300">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-lg group-hover:scale-105 transition-all">
                            <Trophy size={20} className="fill-emerald-500/5" />
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none mb-1.5">Prize payouts</p>
                            <p className="text-2xl font-black text-white font-mono leading-none">{lifetimeStats.totalWins}</p>
                        </div>
                    </div>
                    <div className="bg-gradient-to-br from-emerald-950/20 to-slate-900/40 border border-emerald-500/20 rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden group hover:border-emerald-500/40 transition-all duration-300"
                         style={{ boxShadow: `0 4px 15px ${BRAND.emeraldGlow}` }}>
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-lg group-hover:scale-105 transition-all">
                            <DollarSign size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] text-emerald-400 uppercase font-black tracking-widest leading-none mb-1.5">Net winnings</p>
                            <p className="text-2xl font-black text-emerald-400 font-mono leading-none">${lifetimeStats.totalWinnings.toLocaleString()}</p>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-2 mb-6 border-b border-slate-800 overflow-x-auto">
                    {[
                        { id: 'insights', label: 'Empire Overview', icon: Activity },
                        ...(myPools.filter(p => p.ownerId === user.id || p.managerUid === user.id).length > 0 ? [{ id: 'commissioner', label: 'Commissioner Hub', icon: Crown }] : []),
                        { id: 'live', label: 'Live Pools', count: counts.live },
                        { id: 'open', label: 'Open', count: counts.open },
                        { id: 'completed', label: 'Completed', count: counts.completed },
                        { id: 'all', label: 'All Pools', count: counts.all },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`px-4 py-3.5 text-xs font-black uppercase tracking-wider border-b-2 transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === tab.id
                                ? 'border-orange-500 text-white'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            {tab.icon && <tab.icon size={13} className={activeTab === tab.id ? 'text-orange-500' : 'text-slate-500'} />}
                            {tab.label}
                            {tab.count !== undefined && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black ${activeTab === tab.id ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-900 text-slate-600'}`}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Content Grid based on active tab */}
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader className="animate-spin text-orange-500 mb-4" size={32} />
                        <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Loading active roster...</p>
                    </div>
                ) : activeTab === 'commissioner' ? (
                    <GlobalCommissionerDashboard user={user} managedPools={myPools.filter(p => p.ownerId === user.id || p.managerUid === user.id)} />
                ) : activeTab === 'insights' ? (
                    /* INSIGHTS TAB - PREMIUM RECHARTS DASHBOARD */
                    <div className="space-y-8 animate-in fade-in duration-300">
                        
                        {/* Lock Warning Banner */}
                        {earliestLock && (
                          <div className="bg-gradient-to-r from-amber-500/10 to-indigo-600/10 border border-amber-500/30 rounded-3xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 relative overflow-hidden"
                               style={{ boxShadow: `0 4px 20px ${BRAND.amberGlow}` }}>
                            <div className="flex items-center gap-3">
                              <div className="p-3 bg-amber-500/15 border border-amber-500/25 rounded-2xl text-amber-400 animate-pulse">
                                <AlertTriangle size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-black text-white uppercase tracking-wide">Picks Locking Impending</h4>
                                <p className="text-slate-400 text-xs mt-0.5">
                                  Your entries in <span className="text-white font-extrabold">"{earliestLock.pool.name}"</span> locks at {new Date(earliestLock.time).toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}.
                                </p>
                              </div>
                            </div>
                            
                            <button 
                              onClick={() => navigate(`/pool/${(earliestLock.pool as any).slug || earliestLock.pool.id}`)}
                              className="bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs uppercase tracking-widest py-3 px-6 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg shadow-amber-400/15"
                            >
                              Lock In Picks
                            </button>
                          </div>
                        )}

                        {/* Global Standings Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {Array.from(new Set(myPools.filter(p => p.type !== 'SQUARES' && p.type !== 'PROPS').map(p => p.type))).map(type => (
                                <GlobalStandingsCard 
                                    key={type} 
                                    user={user} 
                                    poolType={type as PoolType} 
                                    poolTypeName={type.replace('NFL_', '').replace('_', ' ')} 
                                />
                            ))}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                            
                            {/* Cumulative Earnings AreaChart */}
                            <div className="lg:col-span-3 bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative flex flex-col justify-between"
                                 style={{ boxShadow: `inset 0 0 20px rgba(16, 185, 129, 0.04), 0 10px 40px rgba(0,0,0,0.5)` }}>
                                <div>
                                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">Lifetime Winnings Trend</h3>
                                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Cumulative payout progression by month</p>
                                </div>

                                <div className="h-56 w-full mt-6">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={cumulativeEarningsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorEarnings" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.25}/>
                                                    <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <XAxis dataKey="month" stroke="#475569" fontSize={9} fontWeight="bold" />
                                            <YAxis stroke="#475569" fontSize={9} fontWeight="bold" />
                                            <Tooltip 
                                                contentStyle={{ backgroundColor: '#090d16', borderColor: '#1e293b', borderRadius: '12px' }}
                                                itemStyle={{ fontSize: '11px', fontWeight: 'black', color: '#10B981' }}
                                                labelStyle={{ fontSize: '9px', fontWeight: '900', color: '#64748b', textTransform: 'uppercase' }}
                                            />
                                            <Area type="monotone" dataKey="Earnings" stroke="#10B981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorEarnings)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Participation Split Pie Chart */}
                            <div className="lg:col-span-2 bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-3xl p-6 shadow-2xl relative flex flex-col justify-between"
                                 style={{ boxShadow: `inset 0 0 20px rgba(59, 130, 246, 0.04), 0 10px 40px rgba(0,0,0,0.5)` }}>
                                <div>
                                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">Roster Distribution</h3>
                                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Active participation by pool category</p>
                                </div>

                                <div className="h-48 w-full mt-6 relative flex items-center justify-center">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={poolTypeSplitData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={45}
                                                outerRadius={65}
                                                paddingAngle={4}
                                                dataKey="value"
                                            >
                                                {poolTypeSplitData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={{ backgroundColor: '#090d16', borderColor: '#1e293b', borderRadius: '12px', fontSize: '10px' }} />
                                        </PieChart>
                                    </ResponsiveContainer>

                                    <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                                        <span className="text-2xl font-black text-white leading-none font-mono">{myPools.length}</span>
                                        <span className="text-[7px] font-black text-slate-500 uppercase tracking-widest mt-0.5">Total Pools</span>
                                    </div>
                                </div>

                                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-4 text-[9px] font-black uppercase tracking-wider">
                                    {poolTypeSplitData.map((entry, idx) => (
                                        <div key={idx} className="flex items-center gap-1.5" style={{ color: entry.color }}>
                                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color }}></span>
                                            {entry.name} ({entry.value})
                                        </div>
                                    ))}
                                </div>
                            </div>

                        </div>

                        {/* Additional Metrics Bento Box */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {[
                                { title: 'Projected Buy-In Total', value: `$${projectedPotEarnings.cost}`, desc: 'Combined fee cost of active entries', icon: Coins, color: 'text-indigo-400' },
                                { title: 'Dues Cleared / Paid', value: `$${projectedPotEarnings.paid}`, desc: 'Total payments marked cleared by commissioner', icon: CheckCircle, color: 'text-emerald-400' },
                                { title: 'Platform Loyalty Tier', value: userLoyaltyTier.name, desc: userLoyaltyTier.description, icon: Shield, color: 'text-orange-500' }
                            ].map((card, i) => (
                                <div key={i} className="bg-slate-900/40 border border-slate-800 rounded-3xl p-5 flex items-start gap-4">
                                    <div className={`p-3 bg-slate-950/60 border border-slate-800 rounded-2xl ${card.color}`}>
                                        <card.icon size={18} />
                                    </div>
                                    <div>
                                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">{card.title}</span>
                                        <span className="text-sm font-black text-white block mb-0.5">{card.value}</span>
                                        <span className="text-[9px] text-slate-500 leading-normal block">{card.desc}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    /* POOLS LIST TAB */
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredPools.map(pool => {
                            const isSquares = pool.type === 'SQUARES';
                            const isPlayoff = pool.type === 'NFL_PLAYOFFS';

                            let userEntryCount = 0;
                            let percentFull = 0;
                            let costDisplay = '';

                            if (isSquares) {
                                const sPool = pool as GameState;
                                userEntryCount = sPool.squares.filter(s => s.reservedByUid === user.id).length;
                                percentFull = (sPool.squares.filter(s => s.owner).length / 100) * 100;
                                costDisplay = `$${sPool.costPerSquare}/sq`;
                            } else if (isPlayoff) {
                                const pPool = pool as unknown as PlayoffPool;
                                const entries = pPool.entries ? Object.values(pPool.entries) : [];
                                userEntryCount = entries.filter(e => e.userId === user.id).length;
                                percentFull = 0;
                                costDisplay = pPool.settings?.entryFee ? `$${pPool.settings.entryFee} Entry` : 'Free';
                            } else if (pool.type === 'BRACKET') {
                                const bPool = pool as BracketPool;
                                userEntryCount = bracketEntryCounts[pool.id] || 0;
                                percentFull = 0;
                                costDisplay = bPool.settings?.entryFee ? `$${bPool.settings.entryFee} Entry` : 'Free';
                            }

                            return (
                                <div
                                    key={pool.id}
                                    onClick={() => navigate(`/pool/${(pool as BracketPool).slug || (pool as GameState).urlSlug || pool.id}`)}
                                    className="group bg-slate-900/40 border border-slate-800 hover:border-orange-500/50 hover:bg-slate-900 rounded-3xl p-5 transition-all cursor-pointer relative overflow-hidden backdrop-blur-sm flex flex-col justify-between"
                                >
                                    <div>
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="flex -space-x-3 isolate">
                                                    <div className="w-10 h-10 rounded-full bg-slate-900 border-2 border-slate-700 flex items-center justify-center overflow-hidden relative z-10 shadow-md">
                                                        {((pool as GameState).awayTeamLogo || getTeamLogo((pool as GameState).awayTeam)) ? (
                                                            <img src={(pool as GameState).awayTeamLogo || getTeamLogo((pool as GameState).awayTeam) || ''} alt="Away" className="w-full h-full object-contain p-0.5" />
                                                        ) : (
                                                            <Shield className="text-slate-600" size={16} />
                                                        )}
                                                    </div>
                                                    <div className="w-10 h-10 rounded-full bg-slate-900 border-2 border-slate-700 flex items-center justify-center overflow-hidden relative z-0 shadow-md">
                                                        {((pool as GameState).homeTeamLogo || getTeamLogo((pool as GameState).homeTeam)) ? (
                                                            <img src={(pool as GameState).homeTeamLogo || getTeamLogo((pool as GameState).homeTeam) || ''} alt="Home" className="w-full h-full object-contain p-0.5" />
                                                        ) : (
                                                            <Shield className="text-slate-600" size={16} />
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    <h3 className="font-extrabold text-white group-hover:text-orange-500 transition-colors line-clamp-1 text-sm uppercase">{pool.name}</h3>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        {getStatusBadge(pool)}
                                                        <span className="text-[10px] text-slate-500 font-black font-mono">{costDisplay}</span>
                                                    </div>
                                                    {(pool as GameState).scores?.startTime && (
                                                        <div className="text-[9px] text-slate-500 mt-1 font-bold flex items-center gap-1 uppercase">
                                                            <Calendar size={10} />
                                                            {new Date((pool as GameState).scores.startTime!).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2 mb-4">
                                            <div className="flex justify-between text-[11px] font-bold">
                                                <span className="text-slate-550">{isSquares ? 'Your Squares' : 'Your Entries'}</span>
                                                <span className="text-white font-black">{userEntryCount}</span>
                                            </div>
                                            {isSquares && (
                                                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-orange-500 transition-all duration-500"
                                                        style={{ width: `${percentFull}%` }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] text-slate-600 border-t border-slate-800/60 pt-3 mt-auto font-bold uppercase">
                                        <span className="flex items-center gap-1"><UserIcon size={10} /> Host: {pool.managerName || 'Unknown'}</span>
                                        <span className="group-hover:translate-x-1 transition-transform flex items-center gap-1 text-orange-500 font-black">
                                            View Dashboard <ChevronRight size={10} />
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>
            <Footer />
        </div>
    );
};
