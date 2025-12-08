import React from 'react';
import { Logo } from './Logo';
import type { User } from '../types';
import { LayoutGrid, Shield, LogOut } from 'lucide-react';

interface HeaderProps {
    user: User | null;
    onOpenAuth: () => void;
    onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ user, onOpenAuth, onLogout }) => (
    <header className="bg-slate-800/90 border-b border-slate-700 backdrop-blur-md sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.location.hash = '#'}>
                <Logo />
            </div>
            <div className="flex items-center gap-4 flex-wrap justify-center">
                <button onClick={() => window.location.hash = '#browse'} className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-white transition-colors mr-2">
                    <LayoutGrid size={16} /> Public Grids
                </button>
                {user ? (
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-slate-300 hidden sm:inline">Hi, {user.name}</span>
                        {user.email === 'kstruck@gmail.com' && (
                            <button onClick={() => window.location.hash = '#super-admin'} className="text-xs bg-fuchsia-600 hover:bg-fuchsia-500 px-3 py-1.5 rounded text-white transition-colors flex items-center gap-1 font-bold">
                                <Shield size={12} /> Super Admin
                            </button>
                        )}
                        <button onClick={() => window.location.hash = '#admin'} className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-white transition-colors">My Pools</button>
                        <button onClick={onLogout} className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 px-3 py-1.5 rounded transition-colors"><LogOut size={14} /></button>
                    </div>
                ) : (
                    <div className="flex gap-2">
                        <button onClick={onOpenAuth} className="text-xs font-bold text-slate-300 hover:text-white px-3 py-1.5 transition-colors">Sign In</button>
                        <button onClick={onOpenAuth} className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-white transition-colors">Register</button>
                    </div>
                )}
            </div>
        </div>
    </header>
);
