import React, { useState } from 'react';
import { Logo } from './Logo';
import type { User } from '../types';
import { LayoutGrid, Shield, LogOut, User as UserIcon, Trophy, RefreshCw, CheckCircle, AlertCircle, BarChart3, Menu, X } from 'lucide-react';
import { authService } from '../services/authService';
import { isSuperAdmin, canCreatePool, canAccessPoolCreation } from '../utils/auth';
import { logger } from '../utils/logger';
import { useNavigate, useLocation } from 'react-router';
import { ThemeToggle } from './ui/ThemeToggle';
// PLAN-HELP-SYSTEM T2 / K3: the Help button sits in the right cluster next to
// the theme toggle, in BOTH branches of this header — a signed-out reader on
// the wizard or a public pool needs it as much as a signed-in one.
import { HelpHeaderButton } from './help/HelpHeaderButton';
import { cn } from './ui/cn';

interface HeaderProps {
    user: User | null;
    isManager?: boolean;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool?: () => void;
}

/* Nav link on the always-dark navy chrome: Saira 600 uppercase 14px,
   gold underline when active. */
const NavLink: React.FC<{
    to: string;
    active?: boolean;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}> = ({ active, onClick, children, className }) => (
    <button
        onClick={onClick}
        className={cn(
            'relative flex items-center gap-1 font-display font-semibold uppercase text-[14px] tracking-[0.06em] pb-0.5 transition-colors',
            active ? 'text-white' : 'text-white/70 hover:text-white',
            'after:absolute after:left-0 after:right-0 after:-bottom-0.5 after:h-[2px] after:rounded-full after:bg-gold-500',
            active ? 'after:opacity-100' : 'after:opacity-0 hover:after:opacity-40',
            'after:transition-opacity',
            className
        )}
    >
        {children}
    </button>
);

/* Compact chrome action button (header is always navy — no theme flip here) */
const chromeBtn =
    'inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 font-display font-bold uppercase text-[13px] tracking-[0.05em] transition-all duration-150 hover:-translate-y-px';

export const Header: React.FC<HeaderProps> = ({ user, isManager = false, onOpenAuth, onLogout, onCreatePool }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [isResending, setIsResending] = useState(false);
    const [resendStatus, setResendStatus] = useState<'idle' | 'sent' | 'error'>('idle');
    // Mobile drawer (2026-08-23 redesign). The wrapped 8-button cluster ate half
    // a phone screen and was one of the three stacked menus members complained
    // about; on mobile it now lives behind one hamburger.
    const [menuOpen, setMenuOpen] = useState(false);

    const isActive = (path: string) => location.pathname === path;

    const handleResend = async () => {
        setIsResending(true);
        setResendStatus('idle');
        try {
            await authService.resendVerification();
            setResendStatus('sent');
            setTimeout(() => setResendStatus('idle'), 5000); // Reset after 5s
        } catch (error) {
            logger.error(error);
            setResendStatus('error');
        } finally {
            setIsResending(false);
        }
    };

    logger.log('Header Rendered. User:', user, 'Role:', user?.role);
    return (
        <>
            {user && !user.emailVerified && user.provider === 'password' && (
                <div className="bg-gold-600 text-navy-950 text-xs font-bold text-center py-1 flex justify-center items-center gap-2">
                    <span>Verify your email to secure your account — check your inbox for the link.</span>
                    {resendStatus === 'sent' ? (
                        <span className="flex items-center gap-1 bg-white/30 px-2 py-0.5 rounded-sm">
                            <CheckCircle size={12} /> Sent!
                        </span>
                    ) : resendStatus === 'error' ? (
                        <span className="flex items-center gap-1 bg-brandred-600 px-2 py-0.5 rounded-sm text-white">
                            <AlertCircle size={12} /> Error
                        </span>
                    ) : (
                        <button
                            onClick={handleResend}
                            disabled={isResending}
                            className="underline hover:text-navy-800 flex items-center gap-1 disabled:opacity-50"
                        >
                            {isResending ? <RefreshCw size={12} className="animate-spin" /> : 'Resend Email'}
                        </button>
                    )}
                </div>
            )}
            {/* Sticky on md+ only. On mobile the pool tab strip takes the sticky
                slot instead — two stacked sticky bars would eat the viewport the
                redesign is trying to give back. */}
            <header className="bg-navy-900 border-b border-[rgba(230,206,150,0.16)] relative z-50 shadow-lg md:sticky md:top-0">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => { setMenuOpen(false); navigate('/'); }}>
                        <Logo height="h-12" />
                    </div>
                    {/* Mobile: the whole button cluster collapses behind one
                        hamburger. Same DOM either way — CSS decides whether the
                        cluster is an inline row (md+) or an absolute dropdown
                        panel under the bar (mobile, when open). */}
                    <button
                        className="md:hidden p-2 text-white/80 hover:text-white"
                        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen(o => !o)}
                    >
                        {menuOpen ? <X size={22} /> : <Menu size={22} />}
                    </button>
                    <div
                        className={`${menuOpen ? 'flex' : 'hidden'} md:flex absolute md:static left-0 right-0 top-full bg-navy-900 md:bg-transparent border-b border-[rgba(230,206,150,0.16)] md:border-0 shadow-lg md:shadow-none px-4 py-4 md:p-0 items-center gap-4 md:gap-5 flex-wrap justify-center`}
                        onClickCapture={() => setMenuOpen(false)}
                    >
                        {!user ? (
                            <>
                                <NavLink to="/features" active={isActive('/features')} onClick={() => navigate('/features')}>
                                    Features
                                </NavLink>
                                {/* Item 7 (Kevin, 2026-08-14): "Pool Guides" was a second nav door onto
                                    THIS page (`?view=strategy`); the page's own sub-tabs carry the
                                    Strategy Guide, so one door is enough. */}
                                <NavLink to="/how-it-works" active={isActive('/how-it-works')} onClick={() => navigate('/how-it-works')}>
                                    How it Works
                                </NavLink>
                                <NavLink to="/browse" active={isActive('/browse')} onClick={() => navigate('/browse')}>
                                    Public Pools
                                </NavLink>
                                <NavLink to="/pricing" active={isActive('/pricing')} onClick={() => navigate('/pricing')}>
                                    Pricing
                                </NavLink>
                                <NavLink to="/scoreboard" active={isActive('/scoreboard')} onClick={() => navigate('/scoreboard')} className="text-gold-400 hover:text-gold-300">
                                    <Trophy size={14} /> Live Scores
                                </NavLink>
                                <div className="flex items-center gap-2">
                                    <ThemeToggle />
                                    <HelpHeaderButton />
                                    <button
                                        onClick={onOpenAuth}
                                        className={cn(chromeBtn, 'text-white/80 hover:text-white')}
                                    >
                                        Log In
                                    </button>
                                    <button
                                        onClick={onOpenAuth}
                                        className={cn(chromeBtn, 'bg-brandred-600 text-white hover:bg-brandred-500 shadow-[0_6px_16px_rgba(196,52,46,0.28)]')}
                                    >
                                        Get Started
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center gap-4 flex-wrap justify-center">
                                <NavLink to="/how-it-works" active={isActive('/how-it-works')} onClick={() => navigate('/how-it-works')}>
                                    How it Works
                                </NavLink>
                                <NavLink to="/browse" active={isActive('/browse')} onClick={() => navigate('/browse')}>
                                    Public Pools
                                </NavLink>
                                <NavLink to="/pricing" active={isActive('/pricing')} onClick={() => navigate('/pricing')}>
                                    Pricing
                                </NavLink>
                                <NavLink to="/scoreboard" active={isActive('/scoreboard')} onClick={() => navigate('/scoreboard')} className="text-gold-400 hover:text-gold-300">
                                    <Trophy size={14} /> Live Scores
                                </NavLink>

                                <button
                                    onClick={() => navigate('/participant?tab=entries')}
                                    className={cn(chromeBtn, 'bg-navy-700 text-white hover:bg-navy-600')}
                                    title="Pools you have joined as a participant"
                                >
                                    <LayoutGrid size={14} /> My Entries
                                </button>

                                {(isManager || canCreatePool(user)) && (
                                    <button
                                        onClick={() => navigate('/participant?tab=commissioner')}
                                        className={cn(chromeBtn, 'border-[1.5px] border-white/25 text-white hover:border-gold-500 hover:text-gold-300')}
                                        title="Pools you created and control"
                                    >
                                        <LayoutGrid size={14} /> Manage My Pools
                                    </button>
                                )}

                                <button
                                    onClick={canAccessPoolCreation(user) ? onCreatePool : undefined}
                                    disabled={!canAccessPoolCreation(user)}
                                    className={cn(
                                        chromeBtn,
                                        canAccessPoolCreation(user)
                                            ? 'bg-brandred-600 text-white hover:bg-brandred-500 shadow-[0_6px_16px_rgba(196,52,46,0.28)]'
                                            : 'bg-navy-800 text-white/40 cursor-not-allowed hover:translate-y-0'
                                    )}
                                    title={canAccessPoolCreation(user) ? "Create a new pool" : "Pool creation is coming soon"}
                                >
                                    <LayoutGrid size={14} /> {canAccessPoolCreation(user) ? "Create a New Pool" : "Pool Creation Coming Soon"}
                                </button>

                                {isSuperAdmin(user) && (
                                    <button
                                        onClick={() => navigate('/super-admin')}
                                        className={cn(chromeBtn, 'bg-gold-foil text-navy-900 hover:brightness-105')}
                                    >
                                        <Shield size={12} /> SuperAdmin
                                    </button>
                                )}

                                <ThemeToggle />
                                <HelpHeaderButton />

                                <button
                                    onClick={() => navigate(`/profile/${user.id}`)}
                                    title="My public player profile"
                                    className={cn(chromeBtn, 'border border-white/20 text-white/80 hover:text-white hover:border-white/40')}
                                >
                                    <BarChart3 size={13} /> My Stats
                                </button>

                                <button
                                    onClick={() => navigate('/profile')}
                                    className={cn(chromeBtn, 'border border-white/20 text-white/80 hover:text-white hover:border-white/40')}
                                >
                                    <UserIcon size={14} /> {user.name.split(' ')[0]}{' '}
                                    <span className="text-[10px] text-white/40 normal-case">({user.role})</span>
                                </button>

                                <button
                                    onClick={onLogout}
                                    aria-label="Log out"
                                    className={cn(chromeBtn, 'border border-white/20 text-white/80 hover:text-white hover:border-white/40')}
                                >
                                    <LogOut size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>
        </>
    );
};
