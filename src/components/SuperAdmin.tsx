import React, { useState, useEffect } from 'react';
import { dbService } from '../services/dbService';
import { settingsService } from '../services/settingsService';
import type { GameState, Pool, User, SystemSettings } from '../types';
import { Trash2, Shield, Activity, Heart, Users, Settings, ToggleLeft, ToggleRight, PlayCircle } from 'lucide-react';

export const SuperAdmin: React.FC = () => {
    const [pools, setPools] = useState<Pool[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [usersLoading, setUsersLoading] = useState(true);

    // User Edit State
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [viewingUser, setViewingUser] = useState<User | null>(null);
    const [editName, setEditName] = useState('');
    const [editEmail, setEditEmail] = useState('');

    const fetchUsers = () => {
        setUsersLoading(true);
        dbService.getAllUsers()
            .then(setUsers)
            .catch(err => console.error("Failed to load users", err))
            .finally(() => setUsersLoading(false));
    };

    useEffect(() => {
        // Subscribe to pools - this updates independently
        const unsub = dbService.subscribeToPools(setPools);
        fetchUsers();
        return () => unsub();
    }, []);

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
    const [viewingPool, setViewingPool] = useState<Pool | null>(null);

    const handleRunSim = async (pool: GameState) => {
        const confirmSim = confirm(`Run simulation for ${pool.name}? This will advance the game state.`);
        if (!confirmSim) return;

        try {
            const updates: any = {};
            const scores = { ...pool.scores };

            // Helper to generate digits
            const genDigits = () => {
                const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
                for (let i = nums.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [nums[i], nums[j]] = [nums[j], nums[i]];
                }
                return nums;
            };
            const genAxis = () => ({ home: genDigits(), away: genDigits() });

            // State Machine Logic
            if (!pool.isLocked) {
                // 1. Lock Pool & Init
                updates.isLocked = true;
                updates.lockGrid = true;

                // Init Numbers
                const baseAxis = pool.axisNumbers || genAxis();
                updates.axisNumbers = baseAxis;

                if (pool.numberSets === 4) {
                    updates.quarterlyNumbers = {
                        q1: baseAxis
                    };
                }

                updates['scores.gameStatus'] = 'pre';
                updates['scores.startTime'] = new Date().toISOString();
                alert('Sim: Pool Locked. Open Sim again to start Q1.');
            } else if (scores.gameStatus === 'pre') {
                // 2. Start Game -> Q1 IN
                updates['scores.gameStatus'] = 'in';
                updates['scores.period'] = 1;
                updates['scores.clock'] = '15:00';
                updates['scores.current'] = { home: 0, away: 0 };
                alert('Sim: Game Started (Q1).');
            } else if (scores.gameStatus === 'in') {
                const p = scores.period || 1;

                if (p === 1) {
                    // Q1 -> Q2
                    updates['scores.period'] = 2;
                    updates['scores.clock'] = '15:00';
                    updates['scores.q1'] = { home: 7, away: 3 }; // Sim Score
                    updates['scores.current'] = { home: 7, away: 3 };

                    // 4-Sets Logic
                    if (pool.numberSets === 4) {
                        const q2 = genAxis();
                        updates['quarterlyNumbers.q2'] = q2;
                        updates.axisNumbers = q2; // Update active numbers
                    }
                    alert('Sim: End of Q1.');
                } else if (p === 2) {
                    // Q2 -> Half -> Q3
                    updates['scores.period'] = 3;
                    updates['scores.clock'] = '15:00';
                    updates['scores.half'] = { home: 14, away: 10 };
                    updates['scores.current'] = { home: 14, away: 10 };

                    if (pool.numberSets === 4) {
                        const q3 = genAxis();
                        updates['quarterlyNumbers.q3'] = q3;
                        updates.axisNumbers = q3;
                    }
                    alert('Sim: Halftime Complete.');
                } else if (p === 3) {
                    // Q3 -> Q4
                    updates['scores.period'] = 4;
                    updates['scores.clock'] = '15:00';
                    updates['scores.q3'] = { home: 21, away: 17 };
                    updates['scores.current'] = { home: 21, away: 17 };

                    if (pool.numberSets === 4) {
                        const q4 = genAxis();
                        updates['quarterlyNumbers.q4'] = q4;
                        updates.axisNumbers = q4;
                    }
                    alert('Sim: End of Q3.');
                } else if (p === 4) {
                    // Q4 -> Final
                    updates['scores.gameStatus'] = 'post';
                    updates['scores.period'] = 4;
                    updates['scores.clock'] = '0:00';
                    updates['scores.final'] = { home: 24, away: 20 };
                    updates['scores.current'] = { home: 24, away: 20 };
                    alert('Sim: Game Over.');
                }
            } else if (scores.gameStatus === 'post') {
                // Reset
                updates.isLocked = false;
                updates.lockGrid = false;
                updates.scores = {
                    current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre'
                };
                updates.axisNumbers = null;
                if (pool.numberSets === 4) updates.quarterlyNumbers = null;
                alert('Sim: Reset Complete.');
            }

            if (Object.keys(updates).length > 0) {
                await dbService.updatePool(pool.id, updates);
            }
        } catch (e) {
            console.error(e);
            alert('Sim Failed');
        }
    };

    // Tab state
    const [activeTab, setActiveTab] = useState<'overview' | 'pools' | 'users' | 'referrals' | 'settings'>('overview');
    const [settings, setSettings] = useState<SystemSettings | null>(null);

    useEffect(() => {
        // Placeholder for a general data loading function if needed
        const loadData = async () => {
            // You might fetch other initial data here if loadData is meant to be comprehensive
        };
        loadData();
        // Subscribe to settings
        const unsub = settingsService.subscribe(setSettings);
        return () => unsub();
    }, []);

    // Group pools by sport/league (using existing league field from setup wizard)
    const getLeagueDisplayName = (league: string | undefined) => {
        switch (league) {
            case 'nfl': return 'NFL Football';
            case 'college': return 'NCAA Football';
            case 'ncaa': return 'NCAA Football';
            default: return 'Other';
        }
    };

    const poolsBySport = pools.reduce((acc, pool) => {
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
        { id: 'pools', label: `Pools (${pools.length})`, icon: <Shield size={16} /> },
        { id: 'users', label: `Users (${users.length})`, icon: <Users size={16} /> },
        { id: 'referrals', label: 'Referrals', icon: <Users size={16} /> },
    ] as const;

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
                        onClick={() => setActiveTab(tab.id)}
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
            {activeTab === 'overview' && (
                <>
                    {/* STATS CARDS */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 mb-8">
                        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 backdrop-blur-sm">
                            <h3 className="text-slate-400 text-xs font-bold uppercase mb-2 tracking-wider">Total Pools</h3>
                            <p className="text-4xl font-bold">{pools.length}</p>
                        </div>
                        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 backdrop-blur-sm">
                            <h3 className="text-slate-400 text-xs font-bold uppercase mb-2 tracking-wider">Total Users</h3>
                            <p className="text-4xl font-bold">{usersLoading ? '...' : users.length}</p>
                            <p className="text-xs text-slate-500 mt-1">
                                {users.filter(u => u.registrationMethod === 'google').length} Google / {users.filter(u => u.registrationMethod === 'email').length} Email
                            </p>
                        </div>
                        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 backdrop-blur-sm">
                            <h3 className="text-slate-400 text-xs font-bold uppercase mb-2 tracking-wider">System Status</h3>
                            <p className="text-xl font-bold text-emerald-400 flex items-center gap-2"><Activity size={20} /> Operational</p>
                            <p className="text-xs text-slate-500 mt-1">Firestore Connected</p>
                            <button
                                onClick={async () => {
                                    if (!confirm('Fix all active pool scores from ESPN? This will fetch fresh data and update quarter scores.')) return;
                                    try {
                                        const { getFunctions, httpsCallable } = await import('firebase/functions');
                                        const functions = getFunctions();
                                        const fixScores = httpsCallable(functions, 'fixPoolScores');
                                        const result = await fixScores({}) as any;
                                        console.log('Fix result:', result.data);
                                        alert(`Fixed ${result.data?.pools?.filter((p: any) => p.status === 'fixed').length || 0} pools. Check console for details.`);
                                    } catch (e: any) {
                                        console.error(e);
                                        alert('Fix failed: ' + e.message);
                                    }
                                }}
                                className="mt-3 text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded transition-colors font-bold"
                            >
                                🔧 Fix Pool Scores
                            </button>
                        </div>
                        <div className="bg-slate-800/50 p-6 rounded-xl border border-indigo-500/30 backdrop-blur-sm">
                            <h3 className="text-indigo-400 text-xs font-bold uppercase mb-2 tracking-wider flex items-center gap-2"><Users size={14} /> Referrals</h3>
                            <p className="text-4xl font-bold text-indigo-400">{users.reduce((sum, u) => sum + (u.referralCount || 0), 0)}</p>
                            <p className="text-xs text-slate-500 mt-1">
                                {users.filter(u => u.referredBy).length} referred users
                            </p>
                        </div>
                    </div>

                    {/* Quick Stats by Sport */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 mb-8">
                        <h2 className="text-lg font-bold mb-4">Pools by Sport</h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {Object.entries(poolsBySport).map(([sport, sportPools]) => (
                                <div key={sport} className="bg-slate-900/50 p-4 rounded-lg text-center">
                                    <p className="text-2xl font-bold text-white">{sportPools.length}</p>
                                    <p className="text-xs text-slate-400 uppercase font-bold">{sport}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Recent Activity - Top 5 Users */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                        <h2 className="text-lg font-bold mb-4">Top Referrers</h2>
                        <div className="space-y-2">
                            {[...users]
                                .filter(u => (u.referralCount || 0) > 0)
                                .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
                                .slice(0, 5)
                                .map((u, i) => (
                                    <div key={u.id} className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg">
                                        <span className={`text-lg font-bold ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-orange-500' : 'text-slate-500'}`}>#{i + 1}</span>
                                        <button onClick={() => handleViewUser(u)} className="font-bold text-white hover:text-indigo-400">{u.name}</button>
                                        <span className="text-slate-500 text-sm flex-1">{u.email}</span>
                                        <span className="text-indigo-400 font-bold">{u.referralCount} referrals</span>
                                    </div>
                                ))}
                            {users.filter(u => (u.referralCount || 0) > 0).length === 0 && (
                                <p className="text-slate-500 text-center py-4">No referrals yet</p>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* ============ POOLS TAB ============ */}
            {activeTab === 'pools' && (
                <div className="space-y-8">
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
            )}

            {/* ============ USERS TAB ============ */}
            {activeTab === 'users' && (
                <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl">
                    <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
                        <h2 className="text-xl font-bold">Registered Users</h2>
                        <div className="flex gap-2">
                            <button
                                onClick={async () => {
                                    if (confirm('Force sync all users from Auth to DB?')) {
                                        setUsersLoading(true);
                                        try {
                                            const res = await dbService.syncAllUsers();
                                            alert(`Synced ${res.count} users.`);
                                            fetchUsers();
                                        } catch (e) {
                                            alert('Sync failed');
                                        } finally {
                                            setUsersLoading(false);
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
            )}

            {/* ============ REFERRALS TAB ============ */}
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
            )}
            {activeTab === 'referrals' && (
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
            )}

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
        </div >
    );
};
