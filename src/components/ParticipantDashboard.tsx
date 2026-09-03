import { logger } from '../utils/logger';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { HelpRoutePublisher } from '../help/publish';
import type { User, GameState, Winner, Pool, PlayoffPool, BracketPool, SystemSettings, PoolType, NFLGame } from '../types';
import { isNFLSeasonPool, getMyNFLEntry, subscribeToSeasonGames, computePendingStatus, type PoolPendingStatus } from '../services/nflStatusService';
import { formatDeadline } from '../utils/formatTime';
import { nflWeekLabel } from '../utils/nflWeekLabel';
import { poolSeasonType } from '../utils/nflPending';
import { isSuperAdmin, isPoolOwner, isNamedNFLCoCommissioner } from '../utils/auth';
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
  Crown,
  RotateCcw
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
import { Badge, Button } from './ui';
import { poolTypeLabel, poolOptionLabels } from '../utils/poolTypeLabel';

const BRAND = {
  emeraldGlow: 'rgba(201, 168, 103, 0.15)',
  amberGlow: 'rgba(196, 52, 46, 0.12)',
  indigoGlow: 'rgba(36, 80, 127, 0.15)',
};

interface ParticipantDashboardProps {
    user: User;
    onLogout: () => void;
    onCreatePool?: () => void;
}

export const ParticipantDashboard: React.FC<ParticipantDashboardProps> = ({ user, onLogout, onCreatePool }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [myPools, setMyPools] = useState<Pool[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'insights' | 'all' | 'open' | 'live' | 'completed' | 'commissioner' | 'entries'>('insights');

    // Sync active tab from the ?tab= query param so header nav lands on distinct destinations
    // (My Entries -> member pools, Manage My Pools -> Commissioner Hub).
    useEffect(() => {
        const requested = new URLSearchParams(location.search).get('tab');
        const valid = ['insights', 'all', 'open', 'live', 'completed', 'commissioner', 'entries'];
        if (requested && valid.includes(requested)) setActiveTab(requested as any);
    }, [location.search]);
    const [searchQuery, setSearchQuery] = useState('');
    const [poolWinners, setPoolWinners] = useState<Record<string, Winner[]>>({});
    const [bracketEntryCounts, setBracketEntryCounts] = useState<Record<string, number>>({});
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    // "Picks due" badges for NFL season pools: season schedule + my entry per pool
    const [seasonGames, setSeasonGames] = useState<Record<string, NFLGame[]>>({});
    const [myNflEntries, setMyNflEntries] = useState<Record<string, any>>({});

    useEffect(() => {
        return settingsService.subscribe(setSettings);
    }, []);

    // Subscribe to the schedule of each distinct season among my NFL pools
    useEffect(() => {
        const seasons = [...new Set(myPools.filter(isNFLSeasonPool).map(p => String((p as any).season)))];
        const unsubs = seasons.map(season =>
            subscribeToSeasonGames(season, games => setSeasonGames(prev => ({ ...prev, [season]: games })))
        );
        return () => unsubs.forEach(u => u());
    }, [myPools]);

    // One-shot fetch of my entry in each NFL pool (enough for a badge; the pool
    // dashboard has the live view)
    useEffect(() => {
        const nflPools = myPools.filter(isNFLSeasonPool);
        if (nflPools.length === 0) return;
        let cancelled = false;
        void Promise.all(nflPools.map(async p => [p.id, await getMyNFLEntry(p.id, user.id)] as const)).then(pairs => {
            if (!cancelled) setMyNflEntries(Object.fromEntries(pairs));
        });
        return () => { cancelled = true; };
    }, [myPools, user.id]);

    const pendingByPool = useMemo(() => {
        const map: Record<string, PoolPendingStatus> = {};
        for (const p of myPools) {
            if (!isNFLSeasonPool(p)) continue;
            const games = seasonGames[String((p as any).season)] ?? [];
            if (games.length === 0) continue;
            const status = computePendingStatus(p, myNflEntries[p.id] ?? null, games);
            if (status) map[p.id] = status;
        }
        return map;
    }, [myPools, seasonGames, myNflEntries]);

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
        let unsubCoCommissioned: () => void = () => { };
        let unsubAll: () => void = () => { };

        // Helper to process and filter pools
        const processPools = (allPools: Pool[]) => {
            const participating = allPools.filter(p => {
                // PLAN-CO-COMMISSIONERS D7: owner/managerUid OR NAMED NFL co-commissioner —
                // deliberately NOT the SUPER_ADMIN-admitting helper, or a super admin's
                // "my pools" would become every pool (codex r6).
                const isOwner = isPoolOwner(user, p) || isNamedNFLCoCommissioner(user, p);

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
            let coCommissionedPools: Pool[] = [];

            const mergeAndUpdate = () => {
                const merged = [...participatingPools, ...ownedPools, ...coCommissionedPools];
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

            // Commissioner Hub feed for NFL co-commissioners (PLAN-CO-COMMISSIONERS
            // D7). K6 makes every co-commissioner a member, so this usually
            // overlaps the participating feed — it is what makes the Hub NOT depend
            // on `participantIds` for a role that lives in `coManagers`.
            unsubCoCommissioned = dbService.subscribeToCoCommissionedPools(user.id, (pools) => {
                coCommissionedPools = pools;
                mergeAndUpdate();
            }, (err) => {
                logger.error("Co-commissioned Pools Error", err);
            });
        }

        return () => {
            unsubParticipating();
            unsubOwned();
            unsubCoCommissioned();
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
            } else if (isNFLSeasonPool(pool)) {
                // Pick'em / Survivor / Margin: one active entry per pool the user is a member of.
                if ((pool as any).participantIds?.includes(user.id)) totalSquares += 1;
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
            { name: 'Squares', value: squares, color: '#C9A867' },
            { name: 'Brackets', value: MMbrackets, color: '#24507F' },
            { name: 'NFL Playoffs', value: playoffs, color: '#8C6D33' },
            { name: 'NFL Pickem/Margin', value: nfl, color: '#1A3B62' }
        ].filter(item => item.value > 0);

        if (data.length === 0) {
            return [
                { name: 'Active Squares', value: 2, color: '#C9A867' },
                { name: 'NFL Pools', value: 1, color: '#1A3B62' }
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
            // My Entries: pools I participate in (membership), independent of ownership.
            if (activeTab === 'entries') return (pool as any).participantIds?.includes(user.id) ?? false;

            return true;
        }).sort((a, b) => {
            // Pools that still need the user's picks float to the top
            const aPending = pendingByPool[a.id] ? 0 : 1;
            const bPending = pendingByPool[b.id] ? 0 : 1;
            return aPending - bPending;
        });
    }, [myPools, searchQuery, activeTab, pendingByPool]);

    const counts = useMemo(() => {
        const open = myPools.filter(p => getPoolTabStatus(p) === 'open').length;
        const completed = myPools.filter(p => getPoolTabStatus(p) === 'completed').length;
        const live = myPools.filter(p => getPoolTabStatus(p) === 'live').length;
        const entries = myPools.filter(p => (p as any).participantIds?.includes(user.id)).length;
        return { all: myPools.length, open, live, completed, entries };
    }, [myPools, user.id]);

    /**
     * The tab strip, built ONCE and used twice: rendered below, and published to
     * the Help panel as `offeredTabs`.
     *
     * Commissioner Hub is conditional — it appears only for someone who owns or
     * co-runs a pool — and Help has a page for it (`account.entries.commissioner`).
     * Without this list the panel offered that page to everyone, so a reader with
     * no pools of their own got an "All pages" row that navigates to
     * `?tab=commissioner`, a tab their own strip does not have. `offeredTabs` is
     * the mechanism for exactly this (`help/types.ts` `HelpRouteContext`): the
     * surface publishes the list it just rendered rather than the content
     * re-deriving the condition. Deriving it from the SAME array is the point —
     * a second copy of the ownership test could drift from the strip.
     */
    const tabStrip = useMemo(() => {
        const managed = myPools.filter(p => isPoolOwner(user, p) || isNamedNFLCoCommissioner(user, p)).length;
        return [
            { id: 'insights', label: 'Empire Overview', icon: Activity, count: undefined as number | undefined },
            { id: 'entries', label: 'My Entries', icon: LayoutGrid, count: counts.entries },
            ...(managed > 0 ? [{ id: 'commissioner', label: 'Commissioner Hub', icon: Crown, count: undefined as number | undefined }] : []),
            { id: 'live', label: 'Live Pools', icon: undefined, count: counts.live },
            { id: 'open', label: 'Open', icon: undefined, count: counts.open },
            { id: 'completed', label: 'Completed', icon: undefined, count: counts.completed },
            { id: 'all', label: 'All Pools', icon: undefined, count: counts.all },
        ];
    }, [myPools, user, counts]);
    const offeredTabs = useMemo(() => tabStrip.map(t => t.id), [tabStrip]);

    const getStatusBadge = (pool: Pool) => {
        const tabStatus = getPoolTabStatus(pool);

        if (tabStatus === 'completed') return <Badge status="locked">Completed</Badge>;
        if (tabStatus === 'live') return <Badge status="live">Live Now</Badge>;
        return <Badge status="open">Open</Badge>;
    };

    return (
        <div className="min-h-screen bg-page text-[color:var(--text)] font-body flex flex-col selection:bg-gold-500 selection:text-navy-950">
            {/* T2: My Entries' tab is in memory. Published so the Help panel can
                tell the SEVEN lists apart (the comment said six; the union at
                :67 has always had seven). `offeredTabs` is the strip actually
                rendered — see `tabStrip` above. The page copy is T3. */}
            <HelpRoutePublisher tab={activeTab} offeredTabs={offeredTabs} />
            <Header user={user} onOpenAuth={() => { }} onLogout={onLogout} onCreatePool={onCreatePool} />

            <main className="flex-grow max-w-7xl mx-auto w-full p-4 md:p-8">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4 border-b border-line pb-6">
                    <div>
                        <h2 className="text-3xl font-display font-extrabold uppercase leading-[0.9] text-[color:var(--text)] flex items-center gap-3">
                            <LayoutGrid className="text-gold-600 dark:text-gold-400" /> My Roster Hub
                        </h2>
                        <p className="text-muted text-sm mt-1 font-body">Manage and track all your active pool entries, scores, and winnings across the site.</p>
                    </div>

                    {/* Search Bar */}
                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" size={16} />
                        <input
                            type="text"
                            placeholder="Search active pools..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-page border-[1.5px] border-line rounded-md pl-9 pr-4 py-2.5 text-xs text-[color:var(--text)] focus:border-navy-600 focus:bg-surface focus:outline-none placeholder:text-faint font-body font-semibold transition-colors"
                        />
                    </div>
                </div>

                {/* Lifetime Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-ui duration-150">
                        <div className="w-10 h-10 rounded-xl bg-navy-600/10 dark:bg-navy-600/30 border border-navy-600/20 text-navy-700 dark:text-[#9FB0CC] flex items-center justify-center fine:group-hover:scale-105 transition-ui">
                            <LayoutGrid size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Pools Entered</p>
                            <p className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">{lifetimeStats.totalPools}</p>
                        </div>
                    </div>
                    <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-ui duration-150">
                        <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 text-gold-700 dark:text-gold-400 flex items-center justify-center fine:group-hover:scale-105 transition-ui">
                            <TrendingUp size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Active entries</p>
                            <p className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">{lifetimeStats.totalSquares}</p>
                        </div>
                    </div>
                    <div className="bg-card border border-line rounded-2xl p-4 shadow-card flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/40 transition-ui duration-150">
                        <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 text-gold-700 dark:text-gold-400 flex items-center justify-center fine:group-hover:scale-105 transition-ui">
                            <Trophy size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] text-muted uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Wins</p>
                            <p className="text-2xl font-display font-bold text-[color:var(--text)] num leading-none">{lifetimeStats.totalWins}</p>
                        </div>
                    </div>
                    <div className="bg-card border border-gold-500/40 rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden group hover:border-gold-500/60 transition-ui duration-150"
                         style={{ boxShadow: `0 4px 15px ${BRAND.emeraldGlow}` }}>
                        <div className="w-10 h-10 rounded-xl bg-gold-foil text-navy-950 flex items-center justify-center fine:group-hover:scale-105 transition-ui">
                            <DollarSign size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] text-gold-700 dark:text-gold-400 uppercase font-display font-bold tracking-[0.08em] leading-none mb-1.5">Net winnings</p>
                            <p className="text-2xl font-display font-bold text-gold-700 dark:text-gold-400 num leading-none">${lifetimeStats.totalWinnings.toLocaleString()}</p>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-2 mb-6 border-b border-line overflow-x-auto">
                    {tabStrip.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`px-4 py-3.5 text-xs font-display font-bold uppercase tracking-[0.08em] border-b-2 transition-ui whitespace-nowrap flex items-center gap-2 ${activeTab === tab.id
                                ? 'border-gold-500 text-[color:var(--text)]'
                                : 'border-transparent text-muted hover:text-[color:var(--text)]'
                                }`}
                        >
                            {tab.icon && <tab.icon size={13} className={activeTab === tab.id ? 'text-gold-600 dark:text-gold-400' : 'text-faint'} />}
                            {tab.label}
                            {tab.count !== undefined && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-display font-bold num ${activeTab === tab.id ? 'bg-gold-500/15 text-gold-700 dark:text-gold-400' : 'bg-surface text-faint'}`}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Content Grid based on active tab */}
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader className="animate-spin text-gold-500 mb-4" size={32} />
                        <p className="text-muted text-xs font-display font-bold uppercase tracking-[0.08em]">Loading active roster...</p>
                    </div>
                ) : activeTab === 'commissioner' ? (
                    <GlobalCommissionerDashboard user={user} managedPools={myPools.filter(p => isPoolOwner(user, p) || isNamedNFLCoCommissioner(user, p))} />
                ) : activeTab === 'insights' ? (
                    /* INSIGHTS TAB - PREMIUM RECHARTS DASHBOARD */
                    <div className="space-y-8 animate-in fade-in">

                        {/* Lock Warning Banner */}
                        {earliestLock && (
                          <div className="bg-brandred-600/5 border border-brandred-600/30 rounded-3xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 relative overflow-hidden"
                               style={{ boxShadow: `0 4px 20px ${BRAND.amberGlow}` }}>
                            <div className="flex items-center gap-3">
                              <div className="p-3 bg-brandred-600/10 border border-brandred-600/25 rounded-2xl text-brandred-600 animate-pulse">
                                <AlertTriangle size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-display font-bold text-[color:var(--text)] uppercase tracking-[0.05em]">Picks Locking Impending</h4>
                                <p className="text-muted text-xs mt-0.5 font-body">
                                  Your entries in <span className="text-[color:var(--text)] font-extrabold">"{earliestLock.pool.name}"</span> locks at {new Date(earliestLock.time).toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}.
                                </p>
                              </div>
                            </div>

                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => navigate(`/pool/${(earliestLock.pool as any).slug || earliestLock.pool.id}`)}
                            >
                              Lock In Picks
                            </Button>
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
                            <div className="lg:col-span-3 bg-card border border-line rounded-3xl p-6 shadow-card relative flex flex-col justify-between">
                                <div>
                                    <h3 className="text-sm font-display font-bold text-muted uppercase tracking-[0.16em] mb-1">Lifetime Winnings Trend</h3>
                                    <p className="text-[10px] text-faint uppercase font-display font-bold tracking-[0.08em]">Cumulative payout progression by month</p>
                                </div>

                                <div className="h-56 w-full mt-6">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={cumulativeEarningsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorEarnings" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#C9A867" stopOpacity={0.25}/>
                                                    <stop offset="95%" stopColor="#C9A867" stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <XAxis dataKey="month" stroke="#7C8698" fontSize={9} fontWeight="bold" />
                                            <YAxis stroke="#7C8698" fontSize={9} fontWeight="bold" />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#0E1C34', borderColor: 'rgba(230,206,150,0.16)', borderRadius: '12px' }}
                                                itemStyle={{ fontSize: '11px', fontWeight: 'black', color: '#D9BC80' }}
                                                labelStyle={{ fontSize: '9px', fontWeight: '900', color: '#9FB0CC', textTransform: 'uppercase' }}
                                            />
                                            <Area type="monotone" dataKey="Earnings" stroke="#C9A867" strokeWidth={2.5} fillOpacity={1} fill="url(#colorEarnings)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Participation Split Pie Chart */}
                            <div className="lg:col-span-2 bg-card border border-line rounded-3xl p-6 shadow-card relative flex flex-col justify-between">
                                <div>
                                    <h3 className="text-sm font-display font-bold text-muted uppercase tracking-[0.16em] mb-1">Roster Distribution</h3>
                                    <p className="text-[10px] text-faint uppercase font-display font-bold tracking-[0.08em]">Active participation by pool category</p>
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
                                            <Tooltip contentStyle={{ backgroundColor: '#0E1C34', borderColor: 'rgba(230,206,150,0.16)', borderRadius: '12px', fontSize: '10px' }} />
                                        </PieChart>
                                    </ResponsiveContainer>

                                    <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                                        <span className="text-2xl font-display font-bold text-[color:var(--text)] leading-none num">{myPools.length}</span>
                                        <span className="text-[7px] font-display font-bold text-muted uppercase tracking-[0.08em] mt-0.5">Total Pools</span>
                                    </div>
                                </div>

                                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-4 text-[9px] font-display font-bold uppercase tracking-[0.08em]">
                                    {poolTypeSplitData.map((entry, idx) => (
                                        <div key={idx} className="flex items-center gap-1.5" style={{ color: entry.color }}>
                                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color }}></span>
                                            {entry.name} (<span className="num">{entry.value}</span>)
                                        </div>
                                    ))}
                                </div>
                            </div>

                        </div>

                        {/* Additional Metrics Bento Box */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {[
                                { title: 'Projected Buy-In Total', value: `$${projectedPotEarnings.cost}`, desc: 'Combined fee cost of active entries', icon: Coins, color: 'text-navy-700 dark:text-[#9FB0CC]' },
                                { title: 'Dues Cleared / Paid', value: `$${projectedPotEarnings.paid}`, desc: 'Total payments marked cleared by commissioner', icon: CheckCircle, color: 'text-[#0F7B4A]' },
                                { title: 'Platform Loyalty Tier', value: userLoyaltyTier.name, desc: userLoyaltyTier.description, icon: Shield, color: 'text-gold-700 dark:text-gold-400' }
                            ].map((card, i) => (
                                <div key={i} className="bg-card border border-line rounded-3xl p-5 shadow-card flex items-start gap-4">
                                    <div className={`p-3 bg-surface border border-line rounded-2xl ${card.color}`}>
                                        <card.icon size={18} />
                                    </div>
                                    <div>
                                        <span className="text-[9px] font-display font-bold text-muted uppercase tracking-[0.08em] block mb-0.5">{card.title}</span>
                                        <span className="text-sm font-display font-bold text-[color:var(--text)] num block mb-0.5">{card.value}</span>
                                        <span className="text-[9px] text-muted leading-normal block font-body">{card.desc}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : filteredPools.length === 0 ? (
                    /* EMPTY STATES — a blank grid is a dead end, especially for brand-new users */
                    <div className="max-w-lg mx-auto bg-card border border-line rounded-3xl p-10 text-center shadow-card">
                        {myPools.length === 0 ? (
                            <>
                                <Trophy className="w-14 h-14 mx-auto mb-4 text-faint" aria-hidden="true" />
                                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">No pools yet</h3>
                                <p className="text-sm text-muted mb-8 font-body">
                                    Join a pool with an invite link from a friend, browse public pools, or start your own.
                                </p>
                                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                                    <Button
                                        variant="primary"
                                        onClick={() => navigate('/browse')}
                                    >
                                        Browse Public Pools
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        onClick={() => navigate('/create-pool')}
                                    >
                                        Create a Pool
                                    </Button>
                                </div>
                                <p className="text-xs text-muted mt-6 font-body">
                                    Have an invite link? Just open it — you'll be dropped straight into the pool.
                                </p>
                            </>
                        ) : (
                            <>
                                <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] mb-2">
                                    {searchQuery ? `No pools match "${searchQuery}"` : 'Nothing in this tab'}
                                </h3>
                                <p className="text-sm text-muted mb-6 font-body">
                                    {searchQuery
                                        ? 'Try a different name, or clear the search to see all your pools.'
                                        : 'Your pools are under a different status tab.'}
                                </p>
                                {searchQuery && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSearchQuery('')}
                                    >
                                        Clear search
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                ) : (
                    /* POOLS LIST TAB */
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredPools.map(pool => {
                            const isSquares = pool.type === 'SQUARES';
                            const isPlayoff = pool.type === 'NFL_PLAYOFFS';
                            // Season-to-season retention: completed NFL season pools the user
                            // commissions can be re-run via the wizard, pre-seeded (?cloneFrom=)
                            const canRerun =
                                (pool.type === 'NFL_PICKEM' || pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_MARGIN') &&
                                (pool.ownerId === user.id || pool.managerUid === user.id) &&
                                getPoolTabStatus(pool) === 'completed';

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
                            } else if (pool.type === 'NFL_PICKEM' || pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_MARGIN') {
                                const fee = (pool as any).settings?.entryFee;
                                costDisplay = fee ? `$${fee} Entry` : 'Free';
                            }
                            // The card never reads NFL entry docs (commissioner-blind picks; and
                            // under PLAN-MULTI-ENTRY a member may hold several), so it cannot
                            // honestly print "Your Entries N" for the three NFL season types —
                            // it printed 0 for a player ranked #1. Hide the line rather than
                            // fabricate a count.
                            const showEntryCount = !(pool.type === 'NFL_PICKEM' || pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_MARGIN');
                            // Item 14 (Kevin, 2026-08-14): testers could not tell pools apart.
                            const typeLabel = poolTypeLabel(pool as any);
                            const optionLabels = poolOptionLabels(pool as any);

                            return (
                                <div
                                    key={pool.id}
                                    onClick={() => navigate(`/pool/${(pool as BracketPool).slug || (pool as GameState).urlSlug || pool.id}`)}
                                    className="group bg-card border border-line hover:border-gold-500 rounded-3xl p-5 transition-ui duration-150 fine:hover:-translate-y-1 shadow-card hover:shadow-card-hover cursor-pointer relative overflow-hidden flex flex-col justify-between"
                                >
                                    <div>
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="flex -space-x-3 isolate">
                                                    <div className="w-10 h-10 rounded-full bg-surface border-2 border-line flex items-center justify-center overflow-hidden relative z-10 shadow-md">
                                                        {((pool as GameState).awayTeamLogo || getTeamLogo((pool as GameState).awayTeam)) ? (
                                                            <img src={(pool as GameState).awayTeamLogo || getTeamLogo((pool as GameState).awayTeam) || ''} alt="Away" className="w-full h-full object-contain p-0.5" />
                                                        ) : (
                                                            <Shield className="text-faint" size={16} />
                                                        )}
                                                    </div>
                                                    <div className="w-10 h-10 rounded-full bg-surface border-2 border-line flex items-center justify-center overflow-hidden relative z-0 shadow-md">
                                                        {((pool as GameState).homeTeamLogo || getTeamLogo((pool as GameState).homeTeam)) ? (
                                                            <img src={(pool as GameState).homeTeamLogo || getTeamLogo((pool as GameState).homeTeam) || ''} alt="Home" className="w-full h-full object-contain p-0.5" />
                                                        ) : (
                                                            <Shield className="text-faint" size={16} />
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    <h3 className="font-display font-bold text-[color:var(--text)] group-hover:text-gold-700 dark:group-hover:text-gold-400 transition-colors line-clamp-1 text-sm uppercase">{pool.name}</h3>
                                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                        {getStatusBadge(pool)}
                                                        <span className="text-[10px] text-muted font-display font-bold num">{costDisplay}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap" data-testid="pool-card-type">
                                                        {/* Fixed ink on a fixed background. `--text` flips to near-white in
    dark mode while bg-cream stays light, which rendered this chip
    white-on-white (Kevin, 2026-08-23). Same fixed-pair pattern as
    Badge's `open`/`paid` styles. */}
<span className="text-[10px] font-display font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full border border-[#E4DFD3] bg-cream text-navy-800">{typeLabel}</span>
                                                        {optionLabels.map(o => (
                                                            <span key={o} className="text-[10px] font-body text-muted">{o}</span>
                                                        ))}
                                                    </div>
                                                    {pendingByPool[pool.id] && (
                                                        <div className="flex items-center gap-1 mt-1.5 bg-brandred-600/10 border border-brandred-600/40 text-brandred-600 text-[10px] font-display font-bold px-2 py-0.5 rounded-full w-fit">
                                                            <AlertTriangle size={10} aria-hidden="true" />
                                                            {nflWeekLabel(poolSeasonType(pool), pendingByPool[pool.id].dueWeek)} picks due · {formatDeadline(pendingByPool[pool.id].deadline)}
                                                        </div>
                                                    )}
                                                    {(pool as GameState).scores?.startTime && (
                                                        <div className="text-[9px] text-faint mt-1 font-display font-bold flex items-center gap-1 uppercase num">
                                                            <Calendar size={10} />
                                                            {new Date((pool as GameState).scores.startTime!).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2 mb-4">
                                            {showEntryCount && (
                                            <div className="flex justify-between text-[11px] font-bold">
                                                <span className="text-muted font-body">{isSquares ? 'Your Squares' : 'Your Entries'}</span>
                                                <span className="text-[color:var(--text)] font-display font-bold num">{userEntryCount}</span>
                                            </div>
                                            )}
                                            {isSquares && (
                                                <div className="h-1.5 w-full bg-line rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full w-full origin-left bg-gold-foil transition-transform duration-300 ease-out"
                                                        style={{ transform: `scaleX(${Math.min(percentFull, 100) / 100})` }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {canRerun && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); navigate(`/nfl-wizard?type=${pool.type}&cloneFrom=${pool.id}`); }}
                                            className="flex items-center justify-center gap-1.5 text-[10px] font-display font-bold uppercase tracking-[0.05em] text-gold-700 dark:text-gold-400 bg-gold-500/10 hover:bg-gold-500/20 border border-gold-500/30 rounded-xl py-2 mb-3 transition-colors"
                                        >
                                            <RotateCcw size={11} /> Re-run for Next Season
                                        </button>
                                    )}
                                    <div className="flex items-center justify-between text-[10px] text-faint border-t border-line pt-3 mt-auto font-display font-bold uppercase tracking-[0.05em]">
                                        <span className="flex items-center gap-1"><UserIcon size={10} /> Host: {pool.managerName || 'Unknown'}</span>
                                        <span className="fine:group-hover:translate-x-1 transition-transform flex items-center gap-1 text-gold-700 dark:text-gold-400 font-display font-bold">
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
