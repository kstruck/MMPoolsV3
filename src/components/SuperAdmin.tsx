import React, { useState, useEffect } from 'react';
import { dbService } from '../services/dbService';
import type { GameState, User } from '../types';
import { Trash2, Shield, Activity } from 'lucide-react';

export const SuperAdmin: React.FC = () => {
    const [pools, setPools] = useState<GameState[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = dbService.subscribeToPools(setPools);
        dbService.getAllUsers().then(setUsers).finally(() => setLoading(false));
        return () => unsub();
    }, []);

    const handleDelete = async (id: string) => {
        if (confirm('Create: Super Delete?')) {
            await dbService.deletePool(id);
        }
    };

    if (loading) return <div className="text-white p-8">Loading Admin Data...</div>;

    return (
        <div className="max-w-7xl mx-auto p-6">
            <h1 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
                <Shield className="text-emerald-500" /> Super Admin Dashboard
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                    <h3 className="text-slate-400 text-sm font-bold uppercase mb-2">Total Pools</h3>
                    <p className="text-4xl font-bold text-white">{pools.length}</p>
                </div>
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                    <h3 className="text-slate-400 text-sm font-bold uppercase mb-2">Total Users</h3>
                    <p className="text-4xl font-bold text-white">{users.length}</p>
                </div>
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                    <h3 className="text-slate-400 text-sm font-bold uppercase mb-2">System Status</h3>
                    <p className="text-xl font-bold text-emerald-400 flex items-center gap-2"><Activity /> Operational</p>
                </div>
            </div>

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
                                        <button onClick={() => handleDelete(pool.id)} className="text-rose-400 hover:text-rose-300"><Trash2 size={18} /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8">
                <div className="p-4 border-b border-slate-700 bg-slate-900/50">
                    <h2 className="text-xl font-bold text-white">Registered Users</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="text-xs text-slate-400 uppercase bg-slate-900">
                            <tr>
                                <th className="p-4">Name</th>
                                <th className="p-4">Email</th>
                                <th className="p-4">ID</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700">
                            {users.map(u => (
                                <tr key={u.id}>
                                    <td className="p-4 text-white">{u.name}</td>
                                    <td className="p-4 text-slate-400">{u.email}</td>
                                    <td className="p-4 text-slate-500 font-mono text-xs">{u.id}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
