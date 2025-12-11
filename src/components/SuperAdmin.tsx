import React, { useState, useEffect } from 'react';
import { dbService } from '../services/dbService';
import type { GameState, User } from '../types';
import { Trash2, Shield, Activity } from 'lucide-react';

export const SuperAdmin: React.FC = () => {
    const [pools, setPools] = useState<GameState[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [usersLoading, setUsersLoading] = useState(true);

    // User Edit State
    const [editingUser, setEditingUser] = useState<User | null>(null);
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

    const generateRandomScore = (currentHome: number, currentAway: number) => {
        const scores = [0, 3, 7];
        const addHome = scores[Math.floor(Math.random() * scores.length)];
        const addAway = scores[Math.floor(Math.random() * scores.length)];
        return { home: currentHome + addHome, away: currentAway + addAway };
    };

    const handleRunSimulation = async (pool: GameState) => {
        if (!confirm(`Run full simulation for ${pool.name}? This will fill empty squares and overwrite scores.`)) return;

        // 1. Fill Grid with Random Users
        const fakeUsers = ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank", "Grace", "Heidi", "Ivan", "Judy", "Mallory", "Niaj"];
        const newSquares = pool.squares.map(s => {
            if (s.owner) return s;
            const randomUser = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];
            return { ...s, owner: randomUser, isPaid: true, playerDetails: { email: `${randomUser.toLowerCase()}@example.com` } };
        });

        // 2. Generate Axis Numbers if missing
        const newAxis = pool.axisNumbers || {
            home: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5),
            away: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5)
        };

        // 3. Reset and Lock
        await dbService.updatePool(pool.id, {
            squares: newSquares,
            axisNumbers: newAxis,
            isLocked: true,
            lockGrid: true,
            scores: { current: { home: 0, away: 0 }, q1: null, half: null, q3: null, final: null }
        });

        // 4. Simulate Game Flow
        const q1 = generateRandomScore(0, 0);
        const half = generateRandomScore(q1.home, q1.away);
        const q3 = generateRandomScore(half.home, half.away);
        const final = generateRandomScore(q3.home, q3.away);

        const sequence = [
            { delay: 2000, updates: { scores: { ...pool.scores, current: q1, q1: q1 } }, msg: "End of Q1" },
            { delay: 5000, updates: { scores: { ...pool.scores, current: half, q1: q1, half: half } }, msg: "Halftime" },
            { delay: 8000, updates: { scores: { ...pool.scores, current: q3, q1: q1, half: half, q3: q3 } }, msg: "End of Q3" },
            { delay: 11000, updates: { scores: { ...pool.scores, current: final, q1: q1, half: half, q3: q3, final: final } }, msg: "Final" }
        ];

        sequence.forEach(step => {
            setTimeout(() => {
                dbService.updatePool(pool.id, step.updates); // Note: Should ideally merge deep, but we constructed full object
            }, step.delay);
        });

        alert("Simulation started! Watch the pool update over the next 12 seconds.");
    };

    return (
        <div className="max-w-7xl mx-auto p-6 relative">
            <h1 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
                <Shield className="text-emerald-500" /> Super Admin Dashboard
            </h1>

            {/* STATS CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                    <h3 className="text-slate-400 text-sm font-bold uppercase mb-2">Total Pools</h3>
                    <p className="text-4xl font-bold text-white">{pools.length}</p>
                </div>
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                    <h3 className="text-slate-400 text-sm font-bold uppercase mb-2">Total Users</h3>
                    <p className="text-4xl font-bold text-white">{usersLoading ? '...' : users.length}</p>
                </div>
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                    <h3 className="text-slate-400 text-sm font-bold uppercase mb-2">System Status</h3>
                    <p className="text-xl font-bold text-emerald-400 flex items-center gap-2"><Activity /> Operational</p>
                </div>
            </div>

            {/* POOLS TABLE */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8">
                <div className="p-4 border-b border-slate-700 bg-slate-900/50">
                    <h2 className="text-xl font-bold text-white">All Pools</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="text-xs text-slate-400 uppercase bg-slate-900">
                            <tr>
                                <th className="p-4">Pool Name</th>
                                <th className="p-4">Owner ID</th>
                                <th className="p-4">Squares</th>
                                <th className="p-4">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700">
                            {pools.map(pool => (
                                <tr key={pool.id} className="hover:bg-slate-700/50">
                                    <td className="p-4 text-white font-bold">{pool.name}</td>
                                    <td className="p-4 text-slate-400 font-mono text-xs">{pool.ownerId || 'Anonymous'}</td>
                                    <td className="p-4 text-slate-300">{pool.squares.filter(s => s.owner).length}/100</td>
                                    <td className="p-4 flex gap-2">
                                        <button onClick={() => window.location.hash = `#admin/${pool.id}`} className="text-indigo-400 hover:text-indigo-300 mr-2 font-bold text-xs uppercase border border-indigo-500/30 px-2 py-1 rounded">Manage</button>
                                        <button onClick={() => handleRunSimulation(pool)} className="text-fuchsia-400 hover:text-fuchsia-300 mr-2 font-bold text-xs uppercase border border-fuchsia-500/30 px-2 py-1 rounded">Run Sim</button>
                                        <button onClick={() => handleDeletePool(pool.id)} className="text-rose-400 hover:text-rose-300"><Trash2 size={18} /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* USERS TABLE */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8">
                <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white">Registered Users</h2>
                    <button onClick={fetchUsers} className="text-xs text-indigo-400 hover:text-white">Refresh</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="text-xs text-slate-400 uppercase bg-slate-900">
                            <tr>
                                <th className="p-4">Name</th>
                                <th className="p-4">Email</th>
                                <th className="p-4">Method</th>
                                <th className="p-4">ID</th>
                                <th className="p-4">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700">
                            {users.map(u => (
                                <tr key={u.id} className="hover:bg-slate-700/50">
                                    <td className="p-4 text-white font-medium">{u.name}</td>
                                    <td className="p-4 text-slate-400">{u.email}</td>
                                    <td className="p-4">
                                        <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded ${u.registrationMethod === 'google' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                            {u.registrationMethod || 'Unknown'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-slate-500 font-mono text-xs max-w-[100px] truncate" title={u.id}>{u.id}</td>
                                    <td className="p-4 flex gap-2">
                                        <button onClick={() => handleEditUser(u)} className="text-indigo-400 hover:text-indigo-300 text-xs font-bold border border-indigo-500/30 px-2 py-1 rounded">Edit</button>
                                        <button onClick={() => handleDeleteUser(u)} className="text-rose-400 hover:text-rose-300"><Trash2 size={18} /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* EDIT USER MODAL */}
            {editingUser && (
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
            )}
        </div>
    );
};
