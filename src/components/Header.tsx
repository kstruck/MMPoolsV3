import React, { useState } from 'react';
import { Logo } from './Logo';
import type { User } from '../types';
import { LayoutGrid, Shield, LogOut, User as UserIcon, Trophy, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { authService } from '../services/authService';
import { isSuperAdmin, canCreatePool } from '../utils/auth';
import { logger } from '../utils/logger';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
    user: User | null;
    isManager?: boolean;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ user, isManager = false, onOpenAuth, onLogout, onCreatePool }) => {
    const navigate = useNavigate();
    const [isResending, setIsResending] = useState(false);
    const [resendStatus, setResendStatus] = useState<'idle' | 'sent' | 'error'>('idle');

    const handleResend = async () => {
        setIsResending(true);
        setResendStatus('idle');
        try {
            await authService.resendVerification();
            setResendStatus('sent');
            setTimeout(() => setResendStatus('idle'), 5000); // Reset after 5s
        } catch (error) {
            console.error(error);
            setResendStatus('error');
        } finally {
            setIsResending(false);
        }
    };

    logger.log('Header Rendered. User:', user, 'Role:', user?.role);
    return (
        <>
            {user && !user.emailVerified && user.provider === 'password' && (
                <div className="bg-amber-500 text-white text-xs font-bold text-center py-1 flex justify-center items-center gap-2">
                    <span>Please verify your email address to access all features. Check your inbox.</span>
                    {resendStatus === 'sent' ? (
                        <span className="flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded text-white">
                            <CheckCircle size={12} /> Sent!
                        </span>
                    ) : resendStatus === 'error' ? (
                        <span className="flex items-center gap-1 bg-red-600/50 px-2 py-0.5 rounded text-white">
                            <AlertCircle size={12} /> Error
                        </span>
                    ) : (
                        <button
                            onClick={handleResend}
                            disabled={isResending}
                            className="underline hover:text-amber-100 flex items-center gap-1 disabled:opacity-50"
                        >
                            {isResending ? <RefreshCw size={12} className="animate-spin" /> : 'Resend Email'}
                        </button>
                    )}
                </div>
            )}
            <header className="bg-slate-950 border-b border-slate-700 backdrop-blur-md sticky top-0 z-50 shadow-lg transition-colors duration-300">
                <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
                        <Logo height="h-20" />
                    </div>
                    <div className="flex items-center gap-4 flex-wrap justify-center">
                        {!user ? (
                            <>
                                <button onClick={() => navigate('/features')} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors mr-2">
                                    Features
                                </button>
                                <button onClick={() => navigate('/how-it-works')} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors mr-2">
                                    How it Works
                                </button>
                                <button onClick={() => navigate('/articles/bracket-pool-guide')} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors mr-2">
                                    Bracket Guide
                                </button>
                                <button onClick={() => navigate('/browse')} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors mr-2">
                                    Public Pools
                                </button>
                                <button onClick={() => navigate('/scoreboard')} className="flex items-center gap-1 text-sm font-bold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors mr-2">
                                    <Trophy size={14} /> Live Scores
                                </button>
                                <div className="flex gap-2">
                                    <button onClick={onOpenAuth} className="text-xs font-bold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white px-3 py-1.5 transition-colors">Sign In / Register</button>
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center gap-4">
                                <button onClick={() => navigate('/how-it-works')} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors">
                                    How it Works
                                </button>
                                <button onClick={() => navigate('/articles/bracket-pool-guide')} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors">
                                    Bracket Guide
                                </button>
                                <button onClick={() => navigate('/browse')} className="flex items-center text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors">
                                    Public Pools
                                </button>
                                <button onClick={() => navigate('/scoreboard')} className="flex items-center gap-1 text-sm font-bold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors">
                                    <Trophy size={14} /> Live Scores
                                </button>

                                <button
                                    onClick={() => navigate('/participant')}
                                    className="text-xs bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded text-white transition-colors flex items-center gap-1"
                                    title="Pools you have joined as a participant"
                                >
                                    <LayoutGrid size={14} /> My Entries
                                </button>

                                {(isManager || canCreatePool(user)) && (
                                    <button
                                        onClick={() => navigate('/participant')}
                                        className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded text-white transition-colors flex items-center gap-1"
                                        title="Pools you created and control"
                                    >
                                        <LayoutGrid size={14} /> Manage My Pools
                                    </button>
                                )}

                                <button
                                    onClick={isSuperAdmin(user) ? onCreatePool : undefined}
                                    disabled={!isSuperAdmin(user)}
                                    className={`text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1 font-bold ${isSuperAdmin(user)
                                        ? "bg-orange-500 hover:bg-orange-600 text-white"
                                        : "bg-slate-700 text-slate-400 cursor-not-allowed opacity-70"
                                        }`}
                                    title={isSuperAdmin(user) ? "Create a new pool" : "Pool creation is coming soon"}
                                >
                                    <LayoutGrid size={14} /> {(isManager || canCreatePool(user)) ? "Create a New Pool" : "Create your own pool"}
                                </button>

                                {isSuperAdmin(user) && (
                                    <button onClick={() => navigate('/super-admin')} className="text-xs bg-fuchsia-600 hover:bg-fuchsia-500 px-3 py-1.5 rounded text-white transition-colors flex items-center gap-1 font-bold">
                                        <Shield size={12} /> SuperAdmin Dashboard
                                    </button>
                                )}

                                <button onClick={() => navigate('/profile')} className="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded transition-colors flex items-center gap-1 font-bold">
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
