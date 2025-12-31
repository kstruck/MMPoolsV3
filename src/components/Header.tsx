import React from 'react';
import { Logo } from './Logo';
import type { User } from '../types';
import { LayoutGrid, Shield, LogOut, User as UserIcon, Trophy } from 'lucide-react';

interface HeaderProps {
    user: User | null;
    isManager?: boolean;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ user, isManager = false, onOpenAuth, onLogout, onCreatePool }) => {
    console.log('Header Rendered. User:', user, 'Role:', user?.role);
    return (
        <>
            {user && !user.emailVerified && user.provider === 'password' && (
                <div className="bg-amber-500 text-white text-xs font-bold text-center py-1">
                    Please verify your email address to access all features. Check your inbox.
                </div>
            )}
            <header className="bg-white/80 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 backdrop-blur-md sticky top-0 z-50 shadow-sm dark:shadow-lg transition-colors duration-300">
                <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.location.hash = '#'}>
                        <Logo height="h-20" />
                    </div>
                    <div className="flex items-center gap-4 flex-wrap justify-center">
                        {!user ? (
                            <>
                                <button onClick={() => window.location.hash = '#features'} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors mr-2">
                                    Features
                                </button>
                                <button onClick={() => window.location.hash = '#how-it-works'} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors mr-2">
                                    How it Works
                                </button>
                                <button onClick={() => window.location.hash = '#browse'} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors mr-2">
                                    Public Pools
                                </button>
                                <button onClick={() => window.location.hash = '#scoreboard'} className="flex items-center gap-1 text-sm font-bold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors mr-2">
                                    <Trophy size={14} /> Live Scores
                                </button>
                                <div className="flex gap-2">
                                    <button onClick={onOpenAuth} className="text-xs font-bold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white px-3 py-1.5 transition-colors">Sign In / Register</button>
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center gap-4">
                                <button onClick={() => window.location.hash = '#how-it-works'} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors">
                                    How it Works
                                </button>
                                <button onClick={() => window.location.hash = '#browse'} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors">
                                    Public Pools
                                </button>
                                <button onClick={() => window.location.hash = '#scoreboard'} className="flex items-center gap-1 text-sm font-bold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors">
                                    <Trophy size={14} /> Live Scores
                                </button>

                                <button
                                    onClick={() => window.location.hash = '#participant'}
                                    className="text-xs bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded text-white transition-colors flex items-center gap-1"
                                    title="Pools you have joined as a participant"
                                >
                                    <LayoutGrid size={14} /> My Entries
                                </button>

                                {(isManager || user.role === 'POOL_MANAGER' || user.role === 'SUPER_ADMIN') && (
                                    <button
                                        onClick={() => window.location.hash = '#admin'}
                                        className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-white transition-colors flex items-center gap-1"
                                        title="Pools you created and control"
                                    >
                                        <LayoutGrid size={14} /> Manage My Pools
                                    </button>
                                )}

                                <button
                                    onClick={onCreatePool}
                                    className="text-xs bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded text-white transition-colors flex items-center gap-1 font-bold"
                                    title="Create a new pool"
                                >
                                    <LayoutGrid size={14} /> {(isManager || user.role === 'POOL_MANAGER' || user.role === 'SUPER_ADMIN') ? "Create a New Pool" : "Create your own pool"}
                                </button>

                                {user.role === 'SUPER_ADMIN' && (
                                    <button onClick={() => window.location.hash = '#super-admin'} className="text-xs bg-fuchsia-600 hover:bg-fuchsia-500 px-3 py-1.5 rounded text-white transition-colors flex items-center gap-1 font-bold">
                                        <Shield size={12} /> SuperAdmin Dashboard
                                    </button>
                                )}

                                <button onClick={() => window.location.hash = '#profile'} className="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded transition-colors flex items-center gap-1 font-bold">
                                    <UserIcon size={14} /> {user.name.split(' ')[0]} <span className="text-[10px] text-slate-400">({user.role})</span>
                                </button>

                                <button onClick={onLogout} className="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded transition-colors"><LogOut size={14} /></button>
                            </div>
                        )}
                    </div>
                </div>
            </header>
        </>
    );
};
