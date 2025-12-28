import React, { useState, useEffect } from 'react';
import { dbService } from '../services/dbService';
import { settingsService } from '../services/settingsService';
import { SimulationDashboard } from './SimulationDashboard';
import type { GameState, Pool, User, SystemSettings } from '../types';
import { Trash2, Shield, Activity, Heart, Users, Settings, ToggleLeft, ToggleRight, PlayCircle, Search, ArrowDown } from 'lucide-react';


export const SuperAdmin: React.FC = () => {
    // --- STATE ---
    const [pools, setPools] = useState<Pool[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [systemLogs, setSystemLogs] = useState<any[]>([]);

    // UI State
    const [activeTab, setActiveTab] = useState<'overview' | 'pools' | 'users' | 'referrals' | 'settings' | 'system'>('overview');
    const [searchTerm, setSearchTerm] = useState('');
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [showSimDashboard, setShowSimDashboard] = useState(false);
    const [sportFilter, setSportFilter] = useState<string>('ALL');

    // Edit/View State
    const [viewingPool, setViewingPool] = useState<Pool | null>(null);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [viewingUser, setViewingUser] = useState<User | null>(null);
    const [editName, setEditName] = useState('');
    const [editEmail, setEditEmail] = useState('');

    const fetchUsers = () => {
        dbService.getAllUsers()
            .then(setUsers)
            .catch(err => console.error("Failed to load users", err));
    };

    // --- EFFECTS ---
    useEffect(() => {
        const unsubPools = dbService.subscribeToAllPools(setPools);
        const unsubSettings = settingsService.subscribe(setSettings);
        fetchUsers();

        // Load System Logs if on system tab
        if (activeTab === 'system') {
            if (dbService.getSystemLogs) {
                dbService.getSystemLogs().then(setSystemLogs).catch(console.error);
            }
        }

        return () => {
            unsubPools();
            unsubSettings();
        };
    }, [activeTab]);

    const handleDeletePool = async (id: string) => {
        if (confirm('Create: Super Delete Pool?')) {
            await dbService.deletePool(id);
        }
    };

    const handleDeleteUser = async (user: User) => {
        if (confirm(`Are you sure you want to delete user ${user.name}? This only removes their database record, their login may still work.`)) {
            await dbService.deleteUser(user.id);
            fetchUsers();
        }
    };

    const handleEditUser = (user: User) => {
        setEditingUser(user);
        setEditName(user.name);
        setEditEmail(user.email);
    };

    const handleViewUser = (user: User) => {
        setViewingUser(user);
    };

    const saveUserChanges = async () => {
        if (!editingUser) return;
        try {
            await dbService.updateUser(editingUser.id, { name: editName, email: editEmail });
            setEditingUser(null);
            fetchUsers();
        } catch (error) {
            alert('Failed to update user');
        }
    };



    // Pool Edit/View State
    // Pool Edit/View State

    const handleRunSim = async (pool: GameState) => {
        const confirmSim = confirm(`Run simulation for ${pool.name}? This will advance the game state.`);
        if (!confirmSim) return;

        try {
            const { simulatePoolGame } = await import('../utils/simulationUtils');
            const scores = {
                ...pool.scores,
                current: pool.scores.current || { home: 0, away: 0 }
            };

            // State Machine Logic
            // We construct the "Next" ESPN-like score object
            let nextState: any = { ...scores };
            let actionDescription = "";

            if (!pool.isLocked) {
                // Special case: Lock is a pool property, not score.
                // We can just update it locally or via existing updatePool
                await dbService.updatePool(pool.id, {
                    isLocked: true,
                    lockGrid: true,
                    'scores.gameStatus': 'pre',
                    'scores.startTime': new Date().toISOString()
                } as any);
                alert('Sim: Pool Locked. Open Sim again to start Game.');
                return;
            }

            if (scores.gameStatus === 'pre') {
                // Start Game -> Q1 0-0
                nextState.gameStatus = 'in';
                nextState.period = 1;
                nextState.clock = '15:00';
                nextState.current = { home: 0, away: 0 };
                actionDescription = "Start Game (Q1 0-0)";
            } else if (scores.gameStatus === 'in') {
                const p = scores.period || 1;
                const h = scores.current?.home || 0;
                const a = scores.current?.away || 0;

                if (p === 1) {
                    if (h === 0 && a === 0) {
                        nextState.current = { home: 7, away: 0 };
                        nextState.clock = '10:00';
                        actionDescription = "Score Change: Home 7, Away 0";
                    } else if (h === 7 && a === 0) {
                        nextState.current = { home: 7, away: 3 };
                        nextState.clock = '5:00';
                        actionDescription = "Score Change: Home 7, Away 3";
                    } else {
                        // End Q1
                        nextState.period = 2;
                        nextState.clock = '15:00';
                        nextState.q1 = { home: 7, away: 3 }; // Delta/Cumulative same for Q1
                        nextState.current = { home: 7, away: 3 };
                        actionDescription = "End Q1";
                    }
                } else if (p === 2) {
                    if (h === 7 && a === 3) {
                        nextState.current = { home: 14, away: 3 };
                        nextState.clock = '10:00';
                        actionDescription = "Score Change: Home 14, Away 3";
                    } else if (h === 14 && a === 3) {
                        nextState.current = { home: 14, away: 10 };
                        nextState.clock = '2:00';
                        actionDescription = "Score Change: Home 14, Away 10";
                    } else {
                        // End Half
                        nextState.period = 3;
                        nextState.clock = '15:00';
                        nextState.half = { home: 14, away: 10 };
                        nextState.current = { home: 14, away: 10 };
                        actionDescription = "End Halftime";
                    }
                } else if (p === 3) {
                    if (h === 14) {
                        nextState.current = { home: 21, away: 10 };
                        nextState.clock = '8:00';
                        actionDescription = "Score Change: Home 21, Away 10";
                    } else if (a === 10) {
                        nextState.current = { home: 21, away: 17 };
                        nextState.clock = '4:00';
                        actionDescription = "Score Change: Home 21, Away 17";
                    } else {
                        // End Q3
                        nextState.period = 4;
                        nextState.clock = '15:00';
                        nextState.q3 = { home: 21, away: 17 };
                        nextState.current = { home: 21, away: 17 };
                        actionDescription = "End Q3";
                    }
                } else if (p === 4) {
                    if (h === 21) {
                        nextState.current = { home: 24, away: 17 };
                        nextState.clock = '5:00';
                        actionDescription = "Score Change: Home 24, Away 17";
                    } else if (a === 17) {
                        nextState.current = { home: 24, away: 20 };
                        nextState.clock = '1:00';
                        actionDescription = "Score Change: Home 24, Away 20";
                    } else {
                        // Final
                        nextState.gameStatus = 'post';
                        nextState.clock = '0:00';
                        nextState.final = { home: 24, away: 20 };
                        nextState.apiTotal = { home: 24, away: 20 }; // For ESPN compat
                        nextState.current = { home: 24, away: 20 };
                        actionDescription = "Game Final";
                    }
                }
            } else if (scores.gameStatus === 'post') {
                // Reset
                if (confirm('Reset Pool to Pre-Game?')) {
                    await dbService.updatePool(pool.id, {
                        isLocked: false,
                        lockGrid: false,
                        scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' },
                        axisNumbers: null,
                        quarterlyNumbers: null
                    } as any);
                    alert('Pool Reset');
                    return;
                }
                return;
            }

            if (actionDescription) {
                // Call Cloud Function
                await simulatePoolGame(pool.id, nextState);
                alert(`Simulated: ${actionDescription}`);
            }

        } catch (e: any) {
            console.error(e);
            alert('Sim Failed: ' + e.message);
        }
    };

    // Tab state


    // Group pools by sport/league (using existing league field from setup wizard)
    const getLeagueDisplayName = (league: string | undefined) => {
        switch (league) {
            case 'nfl': return 'NFL Football';
            case 'college': return 'NCAA Football';
            case 'ncaa': return 'NCAA Football';
            default: return 'Other';
        }
    };

    const filteredPools = pools.filter(p => {
        let matchesSport = true;
        if (sportFilter !== 'ALL') {
            let sport = 'Other';
            if (p.type === 'BRACKET') {
                sport = 'March Madness';
            } else {
                sport = getLeagueDisplayName(p.league);
            }
            if (sport !== sportFilter) matchesSport = false;
        }

        if (!searchTerm) return matchesSport;
        const lowSearch = searchTerm.toLowerCase();
        return matchesSport && (p.name.toLowerCase().includes(lowSearch) ||
            p.id.toLowerCase().includes(lowSearch) ||
            ((p as any).ownerId || '').toLowerCase().includes(lowSearch));
    });

    const poolsBySport = filteredPools.reduce((acc, pool) => {
        let sport = 'Other';
        if (pool.type === 'BRACKET') {
            sport = 'March Madness';
        } else {
            sport = getLeagueDisplayName(pool.league);
        }

        if (!acc[sport]) acc[sport] = [];
        acc[sport].push(pool);
        return acc;
    }, {} as Record<string, Pool[]>);

    const tabs = [
        { id: 'overview', label: 'Overview', icon: <Activity size={16} /> },
        { id: 'pools', label: `Pools (${filteredPools.length})`, icon: <Shield size={16} /> },
        { id: 'users', label: `Users (${users.length})`, icon: <Users size={16} /> },
        { id: 'referrals', label: 'Referrals', icon: <Users size={16} /> },
        { id: 'system', label: 'System Status', icon: <Activity size={16} /> },
    ] as const;

    // Helper: Compute referrals locally
    const getComputedReferrals = (userId: string) => {
        return users.filter(u => u.referredBy === userId).length;
    };

    return (
        <div className="max-w-7xl mx-auto p-4 md:p-6 relative text-slate-100">
            <h1 className="text-3xl font-bold mb-6 flex items-center gap-3">
                <Shield className="text-emerald-500" /> Super Admin Dashboard
            </h1>

            {/* TAB NAVIGATION */}
            <div className="flex gap-2 mb-6 border-b border-slate-700 pb-2 overflow-x-auto">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-t-lg font-bold text-sm transition-colors whitespace-nowrap ${activeTab === tab.id
                            ? 'bg-slate-800 text-white border-b-2 border-indigo-500'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                            }`}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* ============ OVERVIEW TAB ============ */}
            {/* ============ OVERVIEW TAB ============ */}
            {activeTab === 'overview' && (
                <div className="space-y-8">
                    {/* STATS CARDS */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <button onClick={() => setActiveTab('pools')} className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg text-left hover:border-indigo-500 transition-colors">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-3 bg-indigo-500/20 rounded-lg text-indigo-400"><Shield size={24} /></div>
                                <span className="text-xs font-bold text-slate-500 uppercase">Total Pools</span>
                            </div>
                            <p className="text-4xl font-black text-white mb-1">{pools.length}</p>
                            <p className="text-sm text-slate-400">across all sports</p>
                        </button>

                        <button onClick={() => setActiveTab('users')} className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg text-left hover:border-emerald-500 transition-colors">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-3 bg-emerald-500/20 rounded-lg text-emerald-400"><Users size={24} /></div>
                                <span className="text-xs font-bold text-slate-500 uppercase">Total Users</span>
                            </div>
                            <p className="text-4xl font-black text-white mb-1">{users.length}</p>
                            <p className="text-sm text-slate-400">registered accounts</p>
                        </button>

                        <button onClick={() => setActiveTab('system')} className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg text-left hover:border-amber-500 transition-colors">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-3 bg-amber-500/20 rounded-lg text-amber-400"><Activity size={24} /></div>
                                <span className="text-xs font-bold text-slate-500 uppercase">System Status</span>
                            </div>
                            {/* Show number of active/live pools for a quick stat */}
                            <p className="text-4xl font-black text-white mb-1">
                                {pools.filter(p => !('isLocked' in p) ? false : !(p as GameState).isLocked && (p as GameState).scores?.gameStatus !== 'post').length}
                            </p>
                            <p className="text-sm text-slate-400">active pools</p>
                        </button>

                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h4 className="font-bold text-white">Maintenance Mode</h4>
                                    <p className="text-sm text-slate-400">Disable all write actions for users.</p>
                                </div>
                                <button
                                    onClick={() => settingsService.update({ maintenanceMode: !settings?.maintenanceMode })}
                                    className={`transition-colors ${settings?.maintenanceMode ? 'text-amber-400' : 'text-slate-500'}`}
                                >
                                    {settings?.maintenanceMode ? <ToggleRight size={40} className="fill-amber-500/20" /> : <ToggleLeft size={40} />}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Quick Stats by Sport */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                        <h2 className="text-lg font-bold mb-4">Pools by Sport</h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {Object.entries(poolsBySport).map(([sport, sportPools]) => (
                                <button
                                    key={sport}
                                    onClick={() => { setActiveTab('pools'); setSportFilter(sport); }}
                                    className="bg-slate-900/50 p-4 rounded-lg text-center hover:bg-slate-700 transition-colors"
                                >
                                    <p className="text-2xl font-bold text-white">{sportPools.length}</p>
                                    <p className="text-xs text-slate-400 uppercase font-bold">{sport}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Recent Top Referrers */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-bold">Top Referrers</h2>
                            <button onClick={() => setActiveTab('referrals')} className="text-xs text-indigo-400 hover:text-indigo-300 font-bold">View All</button>
                        </div>
                        <div className="space-y-2">
                            {[...users]
                                .map(u => ({ ...u, _computedCount: getComputedReferrals(u.id) }))
                                .filter(u => u._computedCount > 0)
                                .sort((a, b) => b._computedCount - a._computedCount)
                                .slice(0, 5)
                                .map((u, i) => (
                                    <div key={u.id} className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg">
                                        <span className={`text-lg font-bold ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-orange-500' : 'text-slate-500'}`}>#{i + 1}</span>
                                        <button onClick={() => handleViewUser(u)} className="font-bold text-white hover:text-indigo-400">{u.name}</button>
                                        <span className="text-slate-500 text-sm flex-1">{u.email}</span>
                                        <span className="text-indigo-400 font-bold">{u._computedCount} referrals</span>
                                    </div>
                                ))}
                            {users.every(u => getComputedReferrals(u.id) === 0) && (
                                <p className="text-slate-500 text-center py-4">No referrals yet</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ============ POOLS TAB ============ */}
            {
                activeTab === 'pools' && (
                    <div className="space-y-8">
                        {/* SEARCH BAR */}
                        <div className="flex gap-4">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                <input
                                    type="text"
                                    placeholder="Search pools by name, ID, or owner..."
                                    className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-indigo-500"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* SPORT FILTERS */}
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                            <button
                                onClick={() => setSportFilter('ALL')}
                                className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${sportFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                            >
                                ALL SPORTS
                            </button>
                            {Object.keys(poolsBySport).sort().map(sport => (
                                <button
                                    key={sport}
                                    onClick={() => setSportFilter(sport)}
                                    className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${sportFilter === sport ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                                >
                                    {sport.toUpperCase()}
                                </button>
                            ))}
                        </div>

                        {Object.entries(poolsBySport)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([sport, sportPools]) => (
                                <div key={sport} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl">
                                    <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
                                        <h2 className="text-xl font-bold flex items-center gap-2">
                                            🏆 {sport}
                                            <span className="text-sm font-normal text-slate-400">({sportPools.length} pools)</span>
                                        </h2>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left">
                                            <thead className="text-xs text-slate-400 uppercase bg-slate-900/80">
                                                <tr>
                                                    <th className="p-4 font-bold tracking-wider">Pool Name</th>
                                                    <th className="p-4 font-bold tracking-wider">Created</th>
                                                    <th className="p-4 font-bold tracking-wider">Matchup</th>
                                                    <th className="p-4 font-bold tracking-wider">Game Time</th>
                                                    <th className="p-4 font-bold tracking-wider">Owner</th>
                                                    <th className="p-4 font-bold tracking-wider">Filled</th>
                                                    <th className="p-4 font-bold tracking-wider">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-700/50">
                                                {[...sportPools].sort((a, b) => {
                                                    const timeA = typeof a.createdAt === 'number' ? a.createdAt : a.createdAt?.seconds || 0;
                                                    const timeB = typeof b.createdAt === 'number' ? b.createdAt : b.createdAt?.seconds || 0;
                                                    return timeB - timeA;
                                                }).map(pool => {
                                                    const isBracket = pool.type === 'BRACKET';
                                                    // Normalize data access
                                                    const createdAt = typeof pool.createdAt === 'number' ? new Date(pool.createdAt).toLocaleDateString() : (pool.createdAt?.seconds ? new Date(pool.createdAt.seconds * 1000).toLocaleDateString() : 'N/A');
                                                    const matchUp = isBracket ? 'Tournament Bracket' : `${(pool as GameState).awayTeam} @ ${(pool as GameState).homeTeam}`;
                                                    const ownerId = isBracket ? (pool as any).managerUid : (pool as any).ownerId;
                                                    const contact = users.find(u => u.id === ownerId)?.email || (isBracket ? 'N/A' : (pool as GameState).contactEmail);

                                                    let filledPct = 0;
                                                    if (isBracket) {
                                                        const bp = pool as any;
                                                        const max = bp.settings.maxEntriesTotal === -1 ? 100 : bp.settings.maxEntriesTotal;
                                                        filledPct = bp.settings.maxEntriesTotal === -1 ? 0 : Math.round(((bp.entryCount || 0) / max) * 100);
                                                    } else {
                                                        const sp = pool as GameState;
                                                        filledPct = sp.squares.filter(s => s.owner).length;
                                                    }

                                                    return (
                                                        <tr key={pool.id} className="hover:bg-slate-700/30 transition-colors">
                                                            <td className="p-4">
                                                                <button
                                                                    onClick={() => setViewingPool(pool as GameState)} // Type assertion or update setViewingPool type
                                                                    className="font-bold text-white hover:text-indigo-400 hover:underline flex items-center gap-2 text-left"
                                                                >
                                                                    {pool.name}
                                                                    {!isBracket && (pool as GameState).charity?.enabled && (
                                                                        <div title="Charity Pool">
                                                                            <Heart size={12} className="text-rose-500 fill-rose-500" />
                                                                        </div>
                                                                    )}
                                                                </button>
                                                                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{pool.id}</div>
                                                            </td>
                                                            <td className="p-4 text-slate-400 text-sm">
                                                                {createdAt}
                                                            </td>
                                                            <td className="p-4 font-bold text-sm">{matchUp}</td>
                                                            <td className="p-4 text-xs text-slate-400 font-mono">
                                                                {isBracket ? (
                                                                    (pool as any).lockAt ? new Date((pool as any).lockAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'TBD'
                                                                ) : (
                                                                    (pool as GameState).scores.startTime ? new Date((pool as GameState).scores.startTime!).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'TBD'
                                                                )}
                                                            </td>
                                                            <td className="p-4 text-slate-400 text-sm max-w-[150px] truncate" title={contact}>{contact}</td>
                                                            <td className="p-4">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                                                                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${filledPct}%` }}></div>
                                                                    </div>
                                                                    <span className="text-xs text-slate-500">{filledPct}%</span>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 flex gap-2">
                                                                <a href={`#admin/${pool.id}`} className="text-indigo-400 hover:text-indigo-300 text-xs font-bold border border-indigo-500/30 px-2 py-1 rounded">Manage</a>
                                                                {!isBracket && (
                                                                    <button onClick={() => handleRunSim(pool as GameState)} className="text-emerald-400 hover:text-emerald-300 text-xs font-bold border border-emerald-500/30 px-2 py-1 rounded">Sim</button>
                                                                )}
                                                                <button onClick={() => handleDeletePool(pool.id)} className="text-rose-400 hover:text-rose-300 transition-colors"><Trash2 size={16} /></button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            {/* Close for loop and tbody */}
                                        </table>
                                    </div>
                                </div>
                            ))}
                    </div>
                )
            }

            {/* ============ USERS TAB ============ */}
            {
                activeTab === 'users' && (
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl">
                        <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
                            <h2 className="text-xl font-bold">Registered Users</h2>
                            <div className="flex gap-2">
                                <button
                                    onClick={async () => {
                                        if (confirm('Force sync all users from Auth to DB?')) {
                                            try {
                                                const res = await dbService.syncAllUsers();
                                                alert(`Synced ${res.count} users.`);
                                                fetchUsers();
                                            } catch (e) {
                                                alert('Sync failed');
                                            }
                                        }
                                    }}
                                    className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded transition-colors flex items-center gap-1 font-bold"
                                >
                                    Force Sync
                                </button>
                                {/* Admin Actions */}
                                <button
                                    onClick={async () => {
                                        if (confirm("Recalculate GLOBAL PRIZE STATS? This will scan all locked pools and reset the total prize counter.")) {
                                            try {
                                                const res = await dbService.recalculateGlobalStats();
                                                alert(res.message + " Total: $" + res.totalPrizes);
                                            } catch (e) {
                                                alert("Error: " + e);
                                            }
                                        }
                                    }}
                                    className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded transition-colors flex items-center gap-1 font-bold"
                                >
                                    <Activity size={12} /> Recalculate Stats
                                </button>
                                <button
                                    onClick={fetchUsers}
                                    className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded transition-colors flex items-center gap-1"
                                >
                                    <Activity size={12} /> Refresh List
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="text-xs text-slate-400 uppercase bg-slate-900/80">
                                    <tr>
                                        <th className="p-4 tracking-wider">Name</th>
                                        <th className="p-4 tracking-wider">Email</th>
                                        <th className="p-4 tracking-wider">Role</th>
                                        <th className="p-4 tracking-wider">Method</th>
                                        <th className="p-4 tracking-wider">Referrals</th>
                                        <th className="p-4 tracking-wider">ID</th>
                                        <th className="p-4 tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {users.map(u => (
                                        <tr key={u.id} className="hover:bg-slate-700/30 transition-colors">
                                            <td className="p-4 font-medium">
                                                <button onClick={() => handleViewUser(u)} className="hover:text-indigo-400 hover:underline font-bold text-left">{u.name}</button>
                                            </td>
                                            <td className="p-4 text-slate-400">{u.email}</td>
                                            <td className="p-4">
                                                <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded border ${u.role === 'SUPER_ADMIN' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : u.role === 'POOL_MANAGER' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                                                    {u.role || 'USER'}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded border ${u.registrationMethod === 'google' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                                                    {u.registrationMethod || 'EMAIL'}
                                                </span>
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className="text-indigo-400 font-bold">{u.referralCount || 0}</span>
                                            </td>
                                            <td className="p-4 text-slate-500 font-mono text-xs max-w-[100px] truncate" title={u.id}>{u.id}</td>
                                            <td className="p-4 flex gap-2">
                                                <button onClick={() => handleEditUser(u)} className="text-indigo-400 hover:text-indigo-300 text-xs font-bold border border-indigo-500/30 px-2 py-1 rounded">Edit</button>
                                                <button onClick={() => handleDeleteUser(u)} className="text-rose-400 hover:text-rose-300 transition-colors"><Trash2 size={16} /></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            }

            {/* ============ REFERRALS TAB ============ */}
            {activeTab === 'referrals' && (
                <div className="bg-slate-800 rounded-xl border border-indigo-500/30 overflow-hidden shadow-xl">
                    <div className="p-4 border-b border-slate-700 bg-indigo-900/20 flex justify-between items-center">
                        <h2 className="text-xl font-bold flex items-center gap-2"><Users className="text-indigo-400" size={20} /> Referral Dashboard</h2>
                        <span className="text-xs font-mono text-slate-500">Top Referrers & Referral Chain</span>
                    </div>

                    {/* Referral Stats Row */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border-b border-slate-700/50">
                        <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                            <p className="text-3xl font-bold text-indigo-400">{users.reduce((sum, u) => sum + (getComputedReferrals(u.id) || 0), 0)}</p>
                            <p className="text-xs text-slate-500 uppercase font-bold">Total Referrals</p>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                            <p className="text-3xl font-bold text-emerald-400">{users.filter(u => u.referredBy).length}</p>
                            <p className="text-xs text-slate-500 uppercase font-bold">Referred Users</p>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                            <p className="text-3xl font-bold text-amber-400">
                                {new Set(users.filter(u => u.referredBy).map(u => u.referredBy)).size}
                            </p>
                            <p className="text-xs text-slate-500 uppercase font-bold">Active Referrers</p>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                            <p className="text-3xl font-bold text-white">{users.length > 0 ? ((users.filter(u => u.referredBy).length / users.length) * 100).toFixed(1) : 0}%</p>
                            <p className="text-xs text-slate-500 uppercase font-bold">Referral Rate</p>
                        </div>
                    </div>

                    {/* Top Referrers Leaderboard */}
                    <div className="p-4">
                        <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">🏆 Top Referrers</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                            {[...users]
                                .map(u => ({ ...u, _computedCount: getComputedReferrals(u.id) }))
                                .filter(u => u._computedCount > 0)
                                .sort((a, b) => b._computedCount - a._computedCount)
                                .slice(0, 3)
                                .map((u, i) => (
                                    <div key={u.id} className={`p-4 rounded-xl border ${i === 0 ? 'bg-amber-500/10 border-amber-500/30' : i === 1 ? 'bg-slate-500/10 border-slate-400/30' : 'bg-orange-500/10 border-orange-600/30'}`}>
                                        <div className="flex items-center gap-3">
                                            <div className={`text-2xl font-black ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : 'text-orange-500'}`}>#{i + 1}</div>
                                            <div className="flex-1 min-w-0">
                                                <button onClick={() => handleViewUser(u)} className="font-bold text-white truncate hover:text-indigo-400">{u.name}</button>
                                                <p className="text-xs text-slate-400 truncate">{u.email}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-2xl font-bold text-indigo-400">{u._computedCount}</p>
                                                <p className="text-[10px] text-slate-500 uppercase">referrals</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            {users.every(u => getComputedReferrals(u.id) === 0) && (
                                <div className="col-span-3 text-center py-8 text-slate-500">No referrals yet</div>
                            )}
                        </div>

                        {/* Full Referral Table */}
                        <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">All Users Referral Data</h3>
                        <div className="overflow-x-auto rounded-lg border border-slate-700">
                            <table className="w-full text-left text-sm">
                                <thead className="text-xs text-slate-400 uppercase bg-slate-900/80">
                                    <tr>
                                        <th className="p-3 font-bold">User</th>
                                        <th className="p-3 font-bold">Referral Code</th>
                                        <th className="p-3 font-bold text-center">Referrals Made</th>
                                        <th className="p-3 font-bold">Referred By</th>
                                        <th className="p-3 font-bold">Joined</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {[...users]
                                        .map(u => ({ ...u, _computedCount: getComputedReferrals(u.id) }))
                                        .sort((a, b) => b._computedCount - a._computedCount)
                                        .map(u => {
                                            const referrer = u.referredBy ? users.find(ref => ref.id === u.referredBy) : null;
                                            return (
                                                <tr key={u.id} className="hover:bg-slate-700/30">
                                                    <td className="p-3">
                                                        <button onClick={() => handleViewUser(u)} className="font-bold text-white hover:text-indigo-400">{u.name}</button>
                                                        <p className="text-xs text-slate-500">{u.email}</p>
                                                    </td>
                                                    <td className="p-3">
                                                        <code className="text-xs bg-slate-900 px-2 py-1 rounded text-indigo-400 font-mono">{u.referralCode || u.id.slice(0, 8)}</code>
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={`font-bold ${u._computedCount > 0 ? 'text-indigo-400' : 'text-slate-500'}`}>{u._computedCount}</span>
                                                    </td>
                                                    <td className="p-3">
                                                        {referrer ? (
                                                            <span className="text-emerald-400 text-xs">{referrer.name}</span>
                                                        ) : u.referredBy ? (
                                                            <span className="text-slate-500 text-xs font-mono">{u.referredBy.slice(0, 8)}...</span>
                                                        ) : (
                                                            <span className="text-slate-600 text-xs">—</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-xs text-slate-500">
                                                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'system' && (
                <div className="space-y-6">
                    {/* SYSTEM STATS CARDS */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <p className="text-xs text-slate-500 font-bold uppercase mb-1">Active Pools</p>
                            <p className="text-3xl font-black text-white">
                                {pools.filter(p => !('isLocked' in p) ? false : !(p as GameState).isLocked && (p as GameState).scores?.gameStatus !== 'post').length}
                            </p>
                        </div>
                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <p className="text-xs text-slate-500 font-bold uppercase mb-1">Live Games</p>
                            <p className="text-3xl font-black text-emerald-400">
                                {pools.filter(p => (p as GameState).scores?.gameStatus === 'in').length}
                            </p>
                        </div>
                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <p className="text-xs text-slate-500 font-bold uppercase mb-1">Finished</p>
                            <p className="text-3xl font-black text-slate-400">
                                {pools.filter(p => (p as GameState).scores?.gameStatus === 'post').length}
                            </p>
                        </div>
                    </div>

                    {/* EXECUTION LOGS */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                        <div className="p-4 border-b border-slate-700 bg-slate-900/40 flex flex-col gap-4">
                            <div className="flex justify-between items-center">
                                <h3 className="font-bold text-white flex items-center gap-2">
                                    <Activity size={18} className="text-slate-400" />
                                    System Logs
                                </h3>
                                <div className="flex gap-2">
                                    {/* Email Export Button */}
                                    <button
                                        onClick={() => {
                                            // 1. Collect Users
                                            const allEmails = new Map<string, string>(); // email -> name
                                            users.forEach(u => allEmails.set(u.email.toLowerCase(), u.name));

                                            // 2. Scan Pools for Guests
                                            pools.forEach((p: any) => {
                                                if (p.squares) {
                                                    p.squares.forEach((s: any) => {
                                                        if (s.playerDetails?.email) {
                                                            const e = s.playerDetails.email.toLowerCase();
                                                            if (!allEmails.has(e)) {
                                                                allEmails.set(e, s.owner || 'Guest');
                                                            }
                                                        }
                                                    });
                                                }
                                            });

                                            // 3. Generate CSV
                                            const headers = ['Name', 'Email'];
                                            const rows = Array.from(allEmails.entries()).map(([email, name]) => `"${name}","${email}"`);
                                            const csvContent = [headers.join(','), ...rows].join('\n');

                                            // 4. Download
                                            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                                            const url = URL.createObjectURL(blob);
                                            const link = document.createElement('a');
                                            link.setAttribute('href', url);
                                            link.setAttribute('download', `mmp_emails_${new Date().toISOString().slice(0, 10)}.csv`);
                                            link.style.visibility = 'hidden';
                                            document.body.appendChild(link);
                                            link.click();
                                            document.body.removeChild(link);
                                        }}
                                        className="text-xs bg-emerald-600 hover:bg-emerald-500 px-3 py-1 rounded text-white transition-colors font-bold flex items-center gap-1"
                                    >
                                        <ArrowDown size={12} /> Export Emails
                                    </button>

                                    <button
                                        onClick={async () => {
                                            if (confirm('Run Retroactive Score Fix? This will scan all active pools and repair missing score events.')) {
                                                try {
                                                    if (dbService.fixPoolScores) {
                                                        await dbService.fixPoolScores();
                                                        alert('Fix Complete.');
                                                    }
                                                } catch (e) { alert('Fix Failed'); }
                                            }
                                        }}
                                        className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded text-white transition-colors font-bold"
                                    >
                                        Fix Scoring
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (dbService.getSystemLogs) {
                                                dbService.getSystemLogs().then(setSystemLogs).catch(console.error);
                                            }
                                        }}
                                        className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white transition-colors"
                                    >
                                        Refresh
                                    </button>
                                </div>
                            </div>

                            {/* Filters */}
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Filter logs..."
                                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder:text-slate-600 w-full max-w-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                                    onChange={(e) => {
                                        const term = e.target.value.toLowerCase();
                                        const rows = document.querySelectorAll('.log-row');
                                        rows.forEach((row: any) => {
                                            const text = row.innerText.toLowerCase();
                                            row.style.display = text.includes(term) ? '' : 'none';
                                        });
                                    }}
                                />
                            </div>
                        </div>

                        <div className="overflow-x-auto max-h-[600px]">
                            <table className="w-full text-left text-sm">
                                <thead className="text-xs text-slate-500 uppercase bg-slate-900 sticky top-0">
                                    <tr>
                                        <th className="p-3 font-bold">Time</th>
                                        <th className="p-3 font-bold">Status</th>
                                        <th className="p-3 font-bold">Tag</th>
                                        <th className="p-3 font-bold">Details</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {systemLogs.length === 0 ? (
                                        <tr><td colSpan={3} className="p-8 text-center text-slate-500">No logs found</td></tr>
                                    ) : (
                                        systemLogs.map((log, i) => (
                                            <tr key={i} className={`log-row hover:bg-slate-700/20 font-mono text-xs ${log.status === 'error' ? 'bg-rose-900/10' : log.status === 'partial' ? 'bg-amber-900/10' : ''}`}>
                                                <td className="p-3 text-slate-400 whitespace-nowrap">
                                                    {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : new Date(log.timestamp).toLocaleString()}
                                                </td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-0.5 rounded ${log.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                                                        log.status === 'partial' ? 'bg-amber-500/10 text-amber-400' :
                                                            'bg-rose-500/10 text-rose-400'
                                                        }`}>
                                                        {log.status?.toUpperCase() || 'UNKNOWN'}
                                                    </span>
                                                </td>
                                                <td className="p-3">
                                                    {(() => {
                                                        const type = log.type || 'UNKNOWN';
                                                        let label = type;
                                                        let colorClass = 'bg-slate-700 text-slate-300';

                                                        if (type === 'ESPN_FETCH_SUCCESS') { label = 'ESPN Update'; colorClass = 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'; }
                                                        else if (type === 'ESPN_FETCH_FAIL') { label = 'ESPN Error'; colorClass = 'bg-rose-500/20 text-rose-300 border border-rose-500/30'; }
                                                        else if (type === 'SYNC_GAME_STATUS') { label = 'System Sync'; colorClass = 'bg-slate-600/30 text-slate-300 border border-slate-600/50'; }
                                                        else if (type === 'POOL_SYNC_ERROR') { label = 'Pool Error'; colorClass = 'bg-amber-500/20 text-amber-300 border border-amber-500/30'; }
                                                        else if (type === 'SIMULATION') { label = 'Sim Run'; colorClass = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'; }

                                                        return <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${colorClass}`}>{label}</span>;
                                                    })()}
                                                </td>
                                                <td className="p-3 text-slate-300">
                                                    <div className="flex flex-col gap-1">
                                                        {log.message && <span className="font-bold text-white mb-1 block">{log.message}</span>}
                                                        {log.details && <span className="font-mono text-[10px] text-slate-500">{JSON.stringify(log.details)}</span>}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'settings' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400"><Settings size={24} /></div>
                            <h3 className="text-xl font-bold text-white">Feature Flags</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <div>
                                    <h4 className="font-bold text-white">Enable Bracket Pools</h4>
                                    <p className="text-sm text-slate-400">Allow managers to create bracket pools.</p>
                                </div>
                                <button
                                    onClick={() => settingsService.update({ enableBracketPools: !settings?.enableBracketPools })}
                                    className={`transition-colors ${settings?.enableBracketPools ? 'text-emerald-400' : 'text-slate-500'}`}
                                >
                                    {settings?.enableBracketPools ? <ToggleRight size={40} className="fill-emerald-500/20" /> : <ToggleLeft size={40} />}
                                </button>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <div>
                                    <h4 className="font-bold text-white">Maintenance Mode</h4>
                                    <p className="text-sm text-slate-400">Disable all write actions for users.</p>
                                </div>
                                <button
                                    onClick={() => settingsService.update({ maintenanceMode: !settings?.maintenanceMode })}
                                    className={`transition-colors ${settings?.maintenanceMode ? 'text-amber-400' : 'text-slate-500'}`}
                                >
                                    {settings?.maintenanceMode ? <ToggleRight size={40} className="fill-amber-500/20" /> : <ToggleLeft size={40} />}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 bg-pink-500/20 rounded-lg text-pink-400"><PlayCircle size={24} /></div>
                            <h3 className="text-xl font-bold text-white">Simulation Tools</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <h4 className="font-bold text-white mb-2">Tournament Data</h4>
                                <div className="flex flex-col gap-2">
                                    <button
                                        onClick={async () => {
                                            if (!confirm("Overwrite 'tournaments/2025' with test data? This will RESET all current brackets.")) return;
                                            try {
                                                const { seedTestTournament } = await import('../utils/simulationUtils');
                                                await seedTestTournament(2025);
                                                alert("Tournament seeded successfully.");
                                            } catch (e: any) {
                                                alert("Error: " + e.message);
                                            }
                                        }}
                                        className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded font-bold text-sm transition-colors text-left"
                                    >
                                        1. Seed Test Tournament (Teams & R64)
                                    </button>
                                </div>
                            </div>

                            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                <h4 className="font-bold text-white mb-2">Advance Tournament</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={async () => {
                                            if (!confirm("Simulate scores for current round?")) return;
                                            try {
                                                const { simulateRound } = await import('../utils/simulationUtils');
                                                const res = await simulateRound(2025);
                                                alert(res);
                                            } catch (e: any) {
                                                console.error(e);
                                                alert("Error: " + e.message);
                                            }
                                        }}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded font-bold text-sm transition-colors"
                                    >
                                        Simulate Round
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (!confirm("RESET tournament scores?")) return;
                                            try {
                                                const { resetTournament } = await import('../utils/simulationUtils');
                                                await resetTournament(2025);
                                                alert("Tournament reset.");
                                            } catch (e: any) {
                                                alert("Error: " + e.message);
                                            }
                                        }}
                                        className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded font-bold text-sm transition-colors"
                                    >
                                        Reset Scores
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )
            }
            {
                activeTab === 'referrals' && (
                    <div className="bg-slate-800 rounded-xl border border-indigo-500/30 overflow-hidden shadow-xl">
                        <div className="p-4 border-b border-slate-700 bg-indigo-900/20 flex justify-between items-center">
                            <h2 className="text-xl font-bold flex items-center gap-2"><Users className="text-indigo-400" size={20} /> Referral Dashboard</h2>
                            <span className="text-xs font-mono text-slate-500">Top Referrers & Referral Chain</span>
                        </div>

                        {/* Referral Stats Row */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border-b border-slate-700/50">
                            <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                                <p className="text-3xl font-bold text-indigo-400">{users.reduce((sum, u) => sum + (u.referralCount || 0), 0)}</p>
                                <p className="text-xs text-slate-500 uppercase font-bold">Total Referrals</p>
                            </div>
                            <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                                <p className="text-3xl font-bold text-emerald-400">{users.filter(u => u.referredBy).length}</p>
                                <p className="text-xs text-slate-500 uppercase font-bold">Referred Users</p>
                            </div>
                            <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                                <p className="text-3xl font-bold text-amber-400">{users.filter(u => (u.referralCount || 0) > 0).length}</p>
                                <p className="text-xs text-slate-500 uppercase font-bold">Active Referrers</p>
                            </div>
                            <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                                <p className="text-3xl font-bold text-white">{users.length > 0 ? ((users.filter(u => u.referredBy).length / users.length) * 100).toFixed(1) : 0}%</p>
                                <p className="text-xs text-slate-500 uppercase font-bold">Referral Rate</p>
                            </div>
                        </div>

                        {/* Top Referrers Leaderboard */}
                        <div className="p-4">
                            <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">🏆 Top Referrers</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                                {[...users]
                                    .filter(u => (u.referralCount || 0) > 0)
                                    .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
                                    .slice(0, 3)
                                    .map((u, i) => (
                                        <div key={u.id} className={`p-4 rounded-xl border ${i === 0 ? 'bg-amber-500/10 border-amber-500/30' : i === 1 ? 'bg-slate-500/10 border-slate-400/30' : 'bg-orange-500/10 border-orange-600/30'}`}>
                                            <div className="flex items-center gap-3">
                                                <div className={`text-2xl font-black ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : 'text-orange-500'}`}>#{i + 1}</div>
                                                <div className="flex-1 min-w-0">
                                                    <button onClick={() => handleViewUser(u)} className="font-bold text-white truncate hover:text-indigo-400">{u.name}</button>
                                                    <p className="text-xs text-slate-400 truncate">{u.email}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-2xl font-bold text-indigo-400">{u.referralCount || 0}</p>
                                                    <p className="text-[10px] text-slate-500 uppercase">referrals</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                {users.filter(u => (u.referralCount || 0) > 0).length === 0 && (
                                    <div className="col-span-3 text-center py-8 text-slate-500">No referrals yet</div>
                                )}
                            </div>

                            {/* Full Referral Table */}
                            <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">All Users Referral Data</h3>
                            <div className="overflow-x-auto rounded-lg border border-slate-700">
                                <table className="w-full text-left text-sm">
                                    <thead className="text-xs text-slate-400 uppercase bg-slate-900/80">
                                        <tr>
                                            <th className="p-3 font-bold">User</th>
                                            <th className="p-3 font-bold">Referral Code</th>
                                            <th className="p-3 font-bold text-center">Referrals Made</th>
                                            <th className="p-3 font-bold">Referred By</th>
                                            <th className="p-3 font-bold">Joined</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/50">
                                        {[...users]
                                            .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
                                            .map(u => {
                                                const referrer = u.referredBy ? users.find(ref => ref.id === u.referredBy) : null;
                                                return (
                                                    <tr key={u.id} className="hover:bg-slate-700/30">
                                                        <td className="p-3">
                                                            <button onClick={() => handleViewUser(u)} className="font-bold text-white hover:text-indigo-400">{u.name}</button>
                                                            <p className="text-xs text-slate-500">{u.email}</p>
                                                        </td>
                                                        <td className="p-3">
                                                            <code className="text-xs bg-slate-900 px-2 py-1 rounded text-indigo-400 font-mono">{u.referralCode || u.id.slice(0, 8)}</code>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <span className={`font-bold ${(u.referralCount || 0) > 0 ? 'text-indigo-400' : 'text-slate-500'}`}>{u.referralCount || 0}</span>
                                                        </td>
                                                        <td className="p-3">
                                                            {referrer ? (
                                                                <span className="text-emerald-400 text-xs">{referrer.name}</span>
                                                            ) : u.referredBy ? (
                                                                <span className="text-slate-500 text-xs font-mono">{u.referredBy.slice(0, 8)}...</span>
                                                            ) : (
                                                                <span className="text-slate-600 text-xs">—</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-xs text-slate-500">
                                                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* POOL DETAILS MODAL */}
            {
                viewingPool && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl flex flex-col">
                            <div className="p-6 border-b border-slate-700 flex justify-between items-start bg-slate-950/50 rounded-t-2xl">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                                        {viewingPool.name}
                                        {viewingPool.type !== 'BRACKET' && (viewingPool as GameState).charity?.enabled && <Heart size={20} className="text-rose-500 fill-rose-500" />}
                                    </h2>
                                    <p className="text-slate-400 text-sm">
                                        ID: <span className="font-mono text-slate-500">{viewingPool.id}</span>
                                    </p>
                                </div>
                                <button onClick={() => setViewingPool(null)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-colors">
                                    <span className="sr-only">Close</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>

                            <div className="p-6 space-y-6">
                                {/* Meta Data */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                                        <h4 className="text-slate-400 text-xs font-bold uppercase mb-1">Created At</h4>
                                        <p className="font-medium text-white">
                                            {typeof viewingPool.createdAt === 'number'
                                                ? new Date(viewingPool.createdAt).toLocaleString()
                                                : (viewingPool.createdAt?.seconds
                                                    ? new Date(viewingPool.createdAt.seconds * 1000).toLocaleString()
                                                    : <span className="italic text-slate-500">Unknown Date</span>)}
                                        </p>
                                    </div>
                                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                                        <h4 className="text-slate-400 text-xs font-bold uppercase mb-1">Owner</h4>
                                        <p className="font-medium text-white">
                                            {users.find(u => u.id === (viewingPool.type === 'BRACKET' ? (viewingPool as any).managerUid : (viewingPool as any).ownerId))?.name || 'Unknown User'}
                                        </p>
                                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                                            {viewingPool.type === 'BRACKET' ? (viewingPool as any).managerUid : (viewingPool as any).ownerId}
                                        </p>
                                    </div>
                                </div>

                                {/* Status */}
                                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                                    <h4 className="text-slate-400 text-xs font-bold uppercase mb-2">Pool Status</h4>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                        <div>
                                            <div className="text-xs text-slate-500">State</div>
                                            <div className="text-white font-bold">
                                                {viewingPool.type === 'BRACKET'
                                                    ? (viewingPool as any).status
                                                    : ((viewingPool as GameState).isLocked ? "LOCKED" : "OPEN")}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-slate-500">Filled</div>
                                            <div className="text-white font-bold">
                                                {viewingPool.type === 'BRACKET'
                                                    ? `${(viewingPool as any).entryCount || 0} Entries`
                                                    : `${(viewingPool as GameState).squares.filter(s => s.owner).length} / 100`}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-slate-500">Price</div>
                                            <div className="text-white font-bold">
                                                ${viewingPool.type === 'BRACKET' ? (viewingPool as any).settings.entryFee : (viewingPool as GameState).costPerSquare}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-slate-500">Total Pot</div>
                                            <div className="text-emerald-400 font-bold font-mono">
                                                ${viewingPool.type === 'BRACKET'
                                                    ? ((viewingPool as any).entryCount || 0) * (viewingPool as any).settings.entryFee
                                                    : (viewingPool as GameState).squares.filter(s => s.owner).length * (viewingPool as GameState).costPerSquare}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Charity Info */}
                                {viewingPool.type !== 'BRACKET' && (viewingPool as GameState).charity?.enabled && (
                                    <div className="bg-rose-900/10 p-4 rounded-xl border border-rose-500/20">
                                        <h4 className="text-rose-400 text-xs font-bold uppercase mb-2 flex items-center gap-1"><Heart size={12} fill="currentColor" /> Fundraising for Charity</h4>
                                        <p className="text-white font-bold">{(viewingPool as GameState).charity?.name}</p>
                                        <a href={(viewingPool as GameState).charity?.url} target="_blank" rel="noreferrer" className="text-rose-400 text-sm hover:underline truncate block">{(viewingPool as GameState).charity?.url}</a>
                                        <p className="text-xs text-rose-300/70 mt-2">Donating {(viewingPool as GameState).charity?.percentage}% of the pot</p>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex gap-3 pt-4 border-t border-slate-700">
                                    <button onClick={() => window.location.hash = `#admin/${viewingPool.id}`} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/20">
                                        Manage Settings
                                    </button>
                                    <a href={`#pool/${viewingPool.id}`} target="_blank" className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-bold transition-all text-center flex items-center justify-center gap-2">
                                        View Live Grid
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* EDIT USER MODAL (Existing logic preserved, just styling tweaks if needed) */}
            {
                editingUser && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-slate-800 p-6 rounded-xl border border-slate-600 w-full max-w-md shadow-2xl">
                            <h3 className="text-xl font-bold text-white mb-4">Edit User</h3>
                            <div className="space-y-4 mb-6">
                                <div>
                                    <label className="block text-xs uppercase text-slate-400 font-bold mb-1">Name</label>
                                    <input value={editName} onChange={e => setEditName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
                                </div>
                                <div>
                                    <label className="block text-xs uppercase text-slate-400 font-bold mb-1">Email</label>
                                    <input value={editEmail} onChange={e => setEditEmail(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
                                </div>
                            </div>
                            <div className="flex justify-end gap-3">
                                <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white font-bold text-sm">Cancel</button>
                                <button onClick={saveUserChanges} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded font-bold text-sm">Save Changes</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* VIEW USER MODAL (Existing logic preserved) */}
            {
                viewingUser && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
                            <div className="p-6 border-b border-slate-700 flex justify-between items-start bg-slate-950/50 rounded-t-2xl">
                                <div>
                                    <h2 className="text-3xl font-bold text-white mb-1">{viewingUser.name}</h2>
                                    <p className="text-slate-400 flex items-center gap-2 text-sm">
                                        <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300 border border-slate-700">ID: {viewingUser.id}</span>
                                        <span className="text-slate-500">•</span>
                                        <span>{viewingUser.email}</span>
                                    </p>
                                </div>
                                <button onClick={() => setViewingUser(null)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-colors">
                                    <span className="sr-only">Close</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>

                            <div className="p-6">
                                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                    <Activity size={20} className="text-indigo-400" /> Pools Managed by {viewingUser.name.split(' ')[0]}
                                </h3>

                                {pools.filter(p => {
                                    const owner = p.type === 'BRACKET' ? (p as any).managerUid : (p as any).ownerId;
                                    return owner === viewingUser.id;
                                }).length === 0 ? (
                                    <div className="p-8 text-center bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                                        <p className="text-slate-500 font-medium">No pools found for this user.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {pools.filter(p => {
                                            const owner = p.type === 'BRACKET' ? (p as any).managerUid : (p as any).ownerId;
                                            return owner === viewingUser.id;
                                        }).map(pool => {
                                            const isBracket = pool.type === 'BRACKET';
                                            return (
                                                <div key={pool.id} className="bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-indigo-500/50 transition-colors group">
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div>
                                                            <h4 className="font-bold text-white text-lg group-hover:text-indigo-400 transition-colors">{pool.name}</h4>
                                                            <p className="text-xs text-slate-400 uppercase font-bold mt-1">
                                                                {isBracket ? 'Tournament Bracket' : `${(pool as GameState).awayTeam} vs ${(pool as GameState).homeTeam}`}
                                                            </p>
                                                        </div>
                                                        {!isBracket && (pool as GameState).charity?.enabled && <Heart size={16} className="text-rose-500 fill-rose-500" />}
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-2 text-sm text-slate-400 mb-4 bg-slate-900/50 p-3 rounded-lg">
                                                        {isBracket ? (
                                                            <>
                                                                <div>Entries: <span className="text-white font-mono">{(pool as any).entryCount || 0}</span></div>
                                                                <div>Status: <span className={(pool as any).status === 'LOCKED' ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>{(pool as any).status || 'OPEN'}</span></div>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <div>Squares: <span className="text-white font-mono">{(pool as GameState).squares.filter(s => s.owner).length}/100</span></div>
                                                                <div>Status: <span className={(pool as GameState).isLocked ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>{(pool as GameState).isLocked ? 'LOCKED' : 'OPEN'}</span></div>
                                                            </>
                                                        )}
                                                    </div>

                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => {
                                                                window.location.hash = `#admin/${pool.id}`;
                                                                setViewingUser(null);
                                                            }}
                                                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded font-bold text-sm transition-colors text-center"
                                                        >
                                                            Manage Pool
                                                        </button>
                                                        <a
                                                            href={`#pool/${pool.id}`}
                                                            target="_blank"
                                                            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded font-bold text-sm transition-colors text-center"
                                                        >
                                                            {isBracket ? 'View Bracket' : 'View Grid'}
                                                        </a>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {
                showSimDashboard && (
                    <SimulationDashboard pools={pools} onClose={() => setShowSimDashboard(false)} />
                )
            }
        </div >
    );
};

