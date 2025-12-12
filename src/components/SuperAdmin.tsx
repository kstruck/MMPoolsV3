import React, { useState, useEffect } from 'react';
import { dbService } from '../services/dbService';
import type { GameState, User } from '../types';
import { Trash2, Shield, Activity, Heart } from 'lucide-react';

export const SuperAdmin: React.FC = () => {
    const [pools, setPools] = useState<GameState[]>([]);
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
    const [viewingPool, setViewingPool] = useState<GameState | null>(null);

    return (
        <div className="max-w-7xl mx-auto p-4 md:p-6 relative text-slate-100">
            <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
                <Shield className="text-emerald-500" /> Super Admin Dashboard
            </h1>

            {/* STATS CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8">
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
                </div>
            </div>

            {/* POOLS TABLE */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8 shadow-xl">
                <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
                    <h2 className="text-xl font-bold">All Pools</h2>
                    <span className="text-xs font-mono text-slate-500">Sorted by Newest</span>
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
                            {/* Sort by createdAt descending if available */}
                            {[...pools].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(pool => (
                                <tr key={pool.id} className="hover:bg-slate-700/30 transition-colors">
                                    <td className="p-4">
                                        <button
                                            onClick={() => setViewingPool(pool)}
                                            className="font-bold text-white hover:text-indigo-400 hover:underline flex items-center gap-2 text-left"
                                        >
                                            {pool.name}
                                            {pool.charity?.enabled && (
                                                <div title="Charity Pool">
                                                    <Heart size={12} className="text-rose-500 fill-rose-500" />
                                                </div>
                                            )}
                                        </button>
                                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">{pool.id}</div>
                                    </td>
                                    <td className="p-4 text-slate-400 text-xs">
                                        {pool.createdAt?.seconds ? (
                                            <div>
                                                <div className="text-slate-300 font-medium">{new Date(pool.createdAt.seconds * 1000).toLocaleDateString()}</div>
                                                <div className="text-slate-500">{new Date(pool.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                            </div>
                                        ) : (
                                            <span className="text-slate-600 italic">Unknown</span>
                                        )}
                                    </td>
                                    <td className="p-4 text-sm">
                                        <div className="flex flex-col">
                                            <span className="text-white font-bold">{pool.awayTeam}</span>
                                            <span className="text-slate-500 text-xs">vs</span>
                                            <span className="text-white font-bold">{pool.homeTeam}</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        {pool.ownerId ? (
                                            <div>
                                                {users.find(u => u.id === pool.ownerId) ? (
                                                    <button
                                                        onClick={() => {
                                                            const u = users.find(u => u.id === pool.ownerId);
                                                            if (u) setViewingUser(u);
                                                        }}
                                                        className="text-indigo-400 hover:text-white hover:underline font-bold text-sm text-left block"
                                                    >
                                                        {users.find(u => u.id === pool.ownerId)?.name}
                                                    </button>
                                                ) : (
                                                    <span className="text-slate-400 italic text-sm">Unknown User</span>
                                                )}
                                                <div className="text-[10px] text-slate-600 font-mono truncate max-w-[80px]" title={pool.ownerId}>{pool.ownerId}</div>
                                            </div>
                                        ) : <span className="text-slate-500 italic">Anonymous</span>}
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full ${pool.squares.filter(s => s.owner).length === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                                                    style={{ width: `${pool.squares.filter(s => s.owner).length}%` }}
                                                />
                                            </div>
                                            <span className="text-xs font-mono text-slate-400">{pool.squares.filter(s => s.owner).length}%</span>
                                        </div>
                                    </td>
                                    <td className="p-4 flex gap-2">
                                        <button onClick={() => window.location.hash = `#admin/${pool.id}`} className="text-indigo-400 hover:text-indigo-300 mr-2 font-bold text-xs uppercase border border-indigo-500/30 px-2 py-1 rounded">Edit</button>
                                        <button onClick={() => handleDeletePool(pool.id)} className="text-rose-400 hover:text-rose-300 transition-colors"><Trash2 size={16} /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* USERS TABLE */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8 shadow-xl">
                <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
                    <h2 className="text-xl font-bold">Registered Users</h2>
                    <button
                        onClick={fetchUsers}
                        className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded transition-colors flex items-center gap-1"
                    >
                        <Activity size={12} /> Refresh List
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="text-xs text-slate-400 uppercase bg-slate-900/80">
                            <tr>
                                <th className="p-4 tracking-wider">Name</th>
                                <th className="p-4 tracking-wider">Email</th>
                                <th className="p-4 tracking-wider">Method</th>
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

            {/* POOL DETAILS MODAL */}
            {viewingPool && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl flex flex-col">
                        <div className="p-6 border-b border-slate-700 flex justify-between items-start bg-slate-950/50 rounded-t-2xl">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                                    {viewingPool.name}
                                    {viewingPool.charity?.enabled && <Heart size={20} className="text-rose-500 fill-rose-500" />}
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
                                        {viewingPool.createdAt?.seconds
                                            ? new Date(viewingPool.createdAt.seconds * 1000).toLocaleString()
                                            : <span className="italic text-slate-500">Unknown Date</span>}
                                    </p>
                                </div>
                                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                                    <h4 className="text-slate-400 text-xs font-bold uppercase mb-1">Owner</h4>
                                    <p className="font-medium text-white">
                                        {users.find(u => u.id === viewingPool.ownerId)?.name || 'Unknown User'}
                                    </p>
                                    <p className="text-xs text-slate-500 font-mono mt-0.5">{viewingPool.ownerId}</p>
                                </div>
                            </div>

                            {/* Status */}
                            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                                <h4 className="text-slate-400 text-xs font-bold uppercase mb-2">Pool Status</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    <div>
                                        <div className="text-xs text-slate-500">Game State</div>
                                        <div className={viewingPool.isLocked ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
                                            {viewingPool.isLocked ? "LOCKED" : "OPEN"}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-slate-500">Squares details</div>
                                        <div className="text-white font-bold">{viewingPool.squares.filter(s => s.owner).length} / 100 sold</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-slate-500">Price / Square</div>
                                        <div className="text-white font-bold">${viewingPool.costPerSquare}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-slate-500">Total Pot</div>
                                        <div className="text-emerald-400 font-bold font-mono">
                                            ${viewingPool.squares.filter(s => s.owner).length * viewingPool.costPerSquare}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Charity Info */}
                            {viewingPool.charity?.enabled && (
                                <div className="bg-rose-900/10 p-4 rounded-xl border border-rose-500/20">
                                    <h4 className="text-rose-400 text-xs font-bold uppercase mb-2 flex items-center gap-1"><Heart size={12} fill="currentColor" /> Fundraising for Charity</h4>
                                    <p className="text-white font-bold">{viewingPool.charity.name}</p>
                                    <a href={viewingPool.charity.url} target="_blank" rel="noreferrer" className="text-rose-400 text-sm hover:underline truncate block">{viewingPool.charity.url}</a>
                                    <p className="text-xs text-rose-300/70 mt-2">Donating {viewingPool.charity.percentage}% of the pot</p>
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
            )}

            {/* EDIT USER MODAL (Existing logic preserved, just styling tweaks if needed) */}
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

            {/* VIEW USER MODAL (Existing logic preserved) */}
            {viewingUser && (
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

                            {pools.filter(p => p.ownerId === viewingUser.id).length === 0 ? (
                                <div className="p-8 text-center bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                                    <p className="text-slate-500 font-medium">No pools found for this user.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {pools.filter(p => p.ownerId === viewingUser.id).map(pool => (
                                        <div key={pool.id} className="bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-indigo-500/50 transition-colors group">
                                            <div className="flex justify-between items-start mb-3">
                                                <div>
                                                    <h4 className="font-bold text-white text-lg group-hover:text-indigo-400 transition-colors">{pool.name}</h4>
                                                    <p className="text-xs text-slate-400 uppercase font-bold mt-1">{pool.awayTeam} vs {pool.homeTeam}</p>
                                                </div>
                                                {pool.charity?.enabled && <Heart size={16} className="text-rose-500 fill-rose-500" />}
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 text-sm text-slate-400 mb-4 bg-slate-900/50 p-3 rounded-lg">
                                                <div>Squares: <span className="text-white font-mono">{pool.squares.filter(s => s.owner).length}/100</span></div>
                                                <div>Status: <span className={pool.isLocked ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>{pool.isLocked ? 'LOCKED' : 'OPEN'}</span></div>
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
                                                    View Grid
                                                </a>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
