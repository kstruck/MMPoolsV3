import React, { useState } from 'react';
import { Logo } from './Logo';
import type { User } from '../types';
import {
    LayoutGrid, Shield, LogOut, User as UserIcon, Trophy, RefreshCw, CheckCircle, AlertCircle,
    BarChart3, Menu, X, ClipboardList, Compass, Users, BookOpen, Tag as TagIcon, Sparkles,
    Moon, Sun, Plus,
} from 'lucide-react';
import { authService } from '../services/authService';
import { isSuperAdmin, canCreatePool, canAccessPoolCreation } from '../utils/auth';
import { logger } from '../utils/logger';
import { useNavigate, useLocation } from 'react-router';
import { ThemeToggle } from './ui/ThemeToggle';
import { useTheme } from '../contexts/ThemeContext';
// PLAN-HELP-SYSTEM T2 / K3: the Help button sits in the right cluster next to
// the theme toggle, in BOTH branches of this header — a signed-out reader on
// the wizard or a public pool needs it as much as a signed-in one.
import { HelpHeaderButton } from './help/HelpHeaderButton';
import { NavMenu, NavMenuItem, NavMenuAction, NavMenuSeparator } from './ui/NavMenu';
import { cn } from './ui/cn';

/*
 * 2026-08-27 grouped-nav redesign — members reported the bar as "too busy".
 *
 * It was: a signed-in commissioner saw THIRTEEN top-level controls (How it
 * Works, Public Pools, Pricing, Live Scores, My Entries, Manage My Pools,
 * Create a New Pool, SuperAdmin, theme, help, My Stats, name, log out), which
 * wrapped onto a second row on any laptop. Thirteen equally-weighted controls
 * is not a menu, it is a wall: nothing is primary, so everything has to be
 * read.
 *
 * It is now SIX, in three bands that map to three questions:
 *   1. "where is my stuff"  -> My Pools           (a disclosure once you also run pools)
 *   2. "what is happening"  -> Live Scores        (flat, gold, time-critical)
 *   3. "what else is there" -> Explore            (disclosure: browse / how it works / pricing)
 *   + the one primary action (Create a New Pool), Help, and the account menu.
 *
 * Three rules held the redesign together:
 *
 * - GROUP, DO NOT RENAME. Every destination keeps the exact label it had.
 *   `src/help/glossary.ts` tells readers a page is "Reached from Manage My
 *   Pools in the header", and the Help system's own topics name these
 *   controls; a tidier label would have silently falsified all of it. Nothing
 *   was removed either — every route reachable before is still reachable.
 *   `/features` GAINED a door: it was signed-out-only before, and once
 *   Explore existed there was room to end that asymmetry.
 *
 * - ONE PRIMARY ACTION STAYS VISIBLE. Create a New Pool is the only red
 *   control and never moves behind a disclosure. Hiding the money-making
 *   action to win a slot is how nav cleanups quietly cost conversions.
 *
 * - A DISCLOSURE MUST EARN ITS CLICK. A menu holding one item is pure cost, so
 *   "My Pools" renders as a FLAT LINK for a member who only plays, and becomes
 *   a disclosure only once they also run pools and it has two real
 *   destinations. Same for the Explore group, which never has fewer than three.
 *
 * Mobile keeps the single hamburger from the 2026-08-23 pass, but the drawer is
 * now sectioned rather than an undifferentiated pile of buttons. It stays FLAT
 * — labelled sections, no nested accordions — because an IA this shallow does
 * not justify making a phone user open two things to reach one page.
 */

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
}> = ({ to, active, onClick, children, className }) => (
    // A real <a> (a11y audit: every header item was a <button> — no URL
    // preview, no middle-click/open-in-new-tab). Plain left-click stays SPA
    // navigation via onClick; modified clicks fall through to the browser.
    // min-h keeps the touch target at the 24px floor (measured 23px before).
    <a
        href={to}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onClick();
        }}
        className={cn(
            'relative flex items-center gap-1 min-h-[24px] font-display font-semibold uppercase text-[14px] tracking-[0.06em] pb-0.5 transition-colors',
            active ? 'text-white' : 'text-white/70 hover:text-white',
            'after:absolute after:left-0 after:right-0 after:-bottom-0.5 after:h-[2px] after:rounded-full after:bg-gold-500',
            active ? 'after:opacity-100' : 'after:opacity-0 hover:after:opacity-40',
            'after:transition-opacity',
            className
        )}
    >
        {children}
    </a>
);

/* The hamburger names the panel it controls (aria-controls), and the tests
   address the drawer by that same id rather than by a Tailwind class. */
const MOBILE_DRAWER_ID = 'mobile-nav-drawer';

/* Compact chrome action button (header is always navy — no theme flip here) */
const chromeBtn =
    'inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 font-display font-bold uppercase text-[13px] tracking-[0.05em] transition-all duration-150 hover:-translate-y-px';

/* Small gold caption over each mobile drawer section. */
const DrawerSection: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="w-full">
        <div className="px-1 pb-1.5 font-display font-bold uppercase text-[11px] tracking-[0.14em] text-gold-400/70">
            {label}
        </div>
        <div className="flex flex-col gap-0.5">{children}</div>
    </div>
);

/* One row in the mobile drawer. 44px min height — WCAG 2.2 SC 2.5.8 asks for
   24, but a thumb on a phone wants the platform 44. */
const DrawerLink: React.FC<{
    to: string;
    onClick: () => void;
    active?: boolean;
    icon: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}> = ({ to, onClick, active, icon, className, children }) => (
    <a
        href={to}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onClick();
        }}
        className={cn(
            'flex items-center gap-3 min-h-[44px] rounded-[10px] px-3 font-display font-semibold uppercase text-[14px] tracking-[0.05em] transition-colors',
            active ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white',
            className
        )}
    >
        <span className="shrink-0 text-gold-400" aria-hidden="true">{icon}</span>
        {children}
    </a>
);

const DrawerAction: React.FC<{
    onClick: () => void;
    icon: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}> = ({ onClick, icon, className, children }) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            'flex items-center gap-3 min-h-[44px] rounded-[10px] px-3 text-left font-display font-semibold uppercase text-[14px] tracking-[0.05em] text-white/80 transition-colors hover:bg-white/10 hover:text-white',
            className
        )}
    >
        <span className="shrink-0 text-gold-400" aria-hidden="true">{icon}</span>
        {children}
    </button>
);

export const Header: React.FC<HeaderProps> = ({ user, isManager = false, onOpenAuth, onLogout, onCreatePool }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { theme, toggleTheme } = useTheme();
    const [isResending, setIsResending] = useState(false);
    const [resendStatus, setResendStatus] = useState<'idle' | 'sent' | 'error'>('idle');
    // Mobile drawer (2026-08-23 redesign). The wrapped 8-button cluster ate half
    // a phone screen and was one of the three stacked menus members complained
    // about; on mobile it now lives behind one hamburger.
    const [menuOpen, setMenuOpen] = useState(false);

    const isActive = (path: string) => location.pathname === path;
    const isAnyActive = (...paths: string[]) => paths.some(isActive);

    // Both "My Entries" and "Manage My Pools" are tabs of ONE page, which is
    // why grouping them under a single trigger is honest rather than cosmetic.
    const canManage = isManager || canCreatePool(user);
    const canCreate = canAccessPoolCreation(user);
    const createLabel = canCreate ? 'Create a New Pool' : 'Pool Creation Coming Soon';

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
            {/* Sticky everywhere, same as before the redesign — the mobile bar
                is one compact row now that the button cluster lives behind the
                hamburger, so keeping it pinned costs ~73px, not half the
                screen. Surfaces with their own sticky strip (the NFL pool tab
                strip) stack theirs BELOW this one with a top offset. Two
                earlier attempts un-stuck this header instead and both
                regressed some other page's only navigation (codex r2 + r3,
                both P2): /pool/:id also serves Bracket/Playoff/Squares
                dashboards that have no replacement strip. */}
            <header className="bg-navy-900 border-b border-[rgba(230,206,150,0.16)] sticky top-0 z-50 shadow-lg">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
                    <a href="/" className="flex items-center gap-3 cursor-pointer" onClick={(e) => {
                        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault(); setMenuOpen(false); navigate('/');
                    }}>
                        <Logo height="h-12" />
                    </a>

                    {/* ---------- DESKTOP: destinations, then actions ----------
                        Two clusters with real space between them, instead of one
                        undifferentiated run of controls. Left = where you can
                        GO, right = what you can DO. `hidden md:flex` — the
                        mobile drawer below renders its own markup, because a
                        disclosure inside a drawer would be a second layer to
                        open on the smallest screen. */}
                    <nav aria-label="Main" className="hidden lg:flex flex-1 items-center gap-4 xl:gap-6">
                        {!user ? (
                            <>
                                <NavMenu
                                    label="How it Works"
                                    active={isAnyActive('/how-it-works', '/features')}
                                >
                                    <NavMenuItem
                                        to="/how-it-works"
                                        active={isActive('/how-it-works')}
                                        onClick={() => navigate('/how-it-works')}
                                        icon={<BookOpen size={15} />}
                                        hint="Run or join a pool, start to finish"
                                    >
                                        How it Works
                                    </NavMenuItem>
                                    <NavMenuItem
                                        to="/features"
                                        active={isActive('/features')}
                                        onClick={() => navigate('/features')}
                                        icon={<Sparkles size={15} />}
                                        hint="Everything the platform does"
                                    >
                                        Features
                                    </NavMenuItem>
                                </NavMenu>
                                <NavLink to="/browse" active={isActive('/browse')} onClick={() => navigate('/browse')}>
                                    Public Pools
                                </NavLink>
                                <NavLink to="/pricing" active={isActive('/pricing')} onClick={() => navigate('/pricing')}>
                                    Pricing
                                </NavLink>
                                <NavLink to="/scoreboard" active={isActive('/scoreboard')} onClick={() => navigate('/scoreboard')} className="text-gold-400 hover:text-gold-300">
                                    <Trophy size={14} /> Live Scores
                                </NavLink>
                            </>
                        ) : (
                            <>
                                {canManage ? (
                                    <NavMenu label="My Pools" active={isActive('/participant')}>
                                        <NavMenuItem
                                            to="/participant?tab=entries"
                                            onClick={() => navigate('/participant?tab=entries')}
                                            icon={<ClipboardList size={15} />}
                                            hint="Pools you have joined as a participant"
                                        >
                                            My Entries
                                        </NavMenuItem>
                                        <NavMenuItem
                                            to="/participant?tab=commissioner"
                                            onClick={() => navigate('/participant?tab=commissioner')}
                                            icon={<Users size={15} />}
                                            hint="Pools you created and control"
                                        >
                                            Manage My Pools
                                        </NavMenuItem>
                                    </NavMenu>
                                ) : (
                                    // One destination is not a menu. A member who
                                    // only plays gets the direct link.
                                    <NavLink
                                        to="/participant?tab=entries"
                                        active={isActive('/participant')}
                                        onClick={() => navigate('/participant?tab=entries')}
                                    >
                                        <LayoutGrid size={14} /> My Entries
                                    </NavLink>
                                )}

                                <NavLink to="/scoreboard" active={isActive('/scoreboard')} onClick={() => navigate('/scoreboard')} className="text-gold-400 hover:text-gold-300">
                                    <Trophy size={14} /> Live Scores
                                </NavLink>

                                <NavMenu label="Explore" active={isAnyActive('/browse', '/how-it-works', '/features', '/pricing')}>
                                    <NavMenuItem
                                        to="/browse"
                                        active={isActive('/browse')}
                                        onClick={() => navigate('/browse')}
                                        icon={<Compass size={15} />}
                                        hint="Find an open pool to join"
                                    >
                                        Public Pools
                                    </NavMenuItem>
                                    <NavMenuItem
                                        to="/how-it-works"
                                        active={isActive('/how-it-works')}
                                        onClick={() => navigate('/how-it-works')}
                                        icon={<BookOpen size={15} />}
                                        hint="Run or join a pool, start to finish"
                                    >
                                        How it Works
                                    </NavMenuItem>
                                    <NavMenuItem
                                        to="/features"
                                        active={isActive('/features')}
                                        onClick={() => navigate('/features')}
                                        icon={<Sparkles size={15} />}
                                        hint="Everything the platform does"
                                    >
                                        Features
                                    </NavMenuItem>
                                    <NavMenuItem
                                        to="/pricing"
                                        active={isActive('/pricing')}
                                        onClick={() => navigate('/pricing')}
                                        icon={<TagIcon size={15} />}
                                        hint="What hosting a pool costs"
                                    >
                                        Pricing
                                    </NavMenuItem>
                                </NavMenu>
                            </>
                        )}
                    </nav>

                    {/* Right cluster: actions, not destinations. */}
                    <div className="hidden lg:flex items-center gap-2">
                        {!user ? (
                            <>
                                <ThemeToggle compact />
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
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={canCreate ? onCreatePool : undefined}
                                    disabled={!canCreate}
                                    className={cn(
                                        chromeBtn,
                                        canCreate
                                            ? 'bg-brandred-600 text-white hover:bg-brandred-500 shadow-[0_6px_16px_rgba(196,52,46,0.28)]'
                                            : 'bg-navy-800 text-white/40 cursor-not-allowed hover:translate-y-0'
                                    )}
                                    title={canCreate ? 'Create a new pool' : 'Pool creation is coming soon'}
                                >
                                    <Plus size={14} /> {createLabel}
                                </button>

                                <HelpHeaderButton />

                                {/* Account. Everything that is about YOU rather
                                    than about pools — stats, profile, theme,
                                    admin, log out — collapses to one trigger
                                    that still shows who is signed in. */}
                                <NavMenu
                                    align="right"
                                    active={isAnyActive('/profile', '/super-admin')}
                                    ariaLabel={`Account menu for ${user.name}`}
                                    triggerClassName="rounded-[8px] border border-white/20 px-3 py-1.5 hover:border-white/40"
                                    label={
                                        <span className="flex items-center gap-1.5">
                                            <UserIcon size={14} aria-hidden="true" />
                                            <span className="max-w-[12ch] truncate">{user.name.split(' ')[0]}</span>
                                        </span>
                                    }
                                >
                                    <div className="px-3 pt-1.5 pb-2">
                                        <div className="font-display font-bold uppercase text-[13px] tracking-[0.05em] text-white">
                                            {user.name}
                                        </div>
                                        <div className="font-body text-[11px] text-white/50">{user.role}</div>
                                    </div>
                                    <NavMenuSeparator />
                                    <NavMenuItem
                                        to={`/profile/${user.id}`}
                                        active={isActive(`/profile/${user.id}`)}
                                        onClick={() => navigate(`/profile/${user.id}`)}
                                        icon={<BarChart3 size={15} />}
                                        hint="My public player profile"
                                    >
                                        My Stats
                                    </NavMenuItem>
                                    <NavMenuItem
                                        to="/profile"
                                        active={isActive('/profile')}
                                        onClick={() => navigate('/profile')}
                                        icon={<UserIcon size={15} />}
                                        hint="Account and notification settings"
                                    >
                                        My Profile
                                    </NavMenuItem>
                                    {isSuperAdmin(user) && (
                                        <>
                                            <NavMenuSeparator />
                                            <NavMenuItem
                                                to="/super-admin"
                                                active={isActive('/super-admin')}
                                                onClick={() => navigate('/super-admin')}
                                                icon={<Shield size={15} />}
                                                className="text-gold-300 hover:text-gold-200"
                                            >
                                                SuperAdmin
                                            </NavMenuItem>
                                        </>
                                    )}
                                    <NavMenuSeparator />
                                    <NavMenuAction
                                        onClick={toggleTheme}
                                        icon={theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                                    >
                                        {theme === 'dark' ? 'Light Theme' : 'Dark Theme'}
                                    </NavMenuAction>
                                    <NavMenuAction onClick={onLogout} icon={<LogOut size={15} />}>
                                        Log Out
                                    </NavMenuAction>
                                </NavMenu>
                            </>
                        )}
                    </div>

                    {/* ---------- MOBILE: one hamburger, one sectioned drawer ---------- */}
                    <button
                        className="lg:hidden ml-auto p-2 text-white/80 hover:text-white"
                        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                        aria-expanded={menuOpen}
                        aria-controls={MOBILE_DRAWER_ID}
                        onClick={() => setMenuOpen(o => !o)}
                    >
                        {menuOpen ? <X size={22} /> : <Menu size={22} />}
                    </button>
                    {menuOpen && (
                        <div
                            id={MOBILE_DRAWER_ID}
                            className="lg:hidden absolute left-0 right-0 top-full max-h-[calc(100vh-73px)] overflow-y-auto bg-navy-900 border-b border-[rgba(230,206,150,0.16)] shadow-lg px-4 py-4 flex flex-col gap-5"
                            onClickCapture={() => setMenuOpen(false)}
                        >
                            {!user ? (
                                <>
                                    <DrawerSection label="Explore">
                                        <DrawerLink to="/browse" active={isActive('/browse')} onClick={() => navigate('/browse')} icon={<Compass size={16} />}>
                                            Public Pools
                                        </DrawerLink>
                                        <DrawerLink to="/scoreboard" active={isActive('/scoreboard')} onClick={() => navigate('/scoreboard')} icon={<Trophy size={16} />} className="text-gold-400">
                                            Live Scores
                                        </DrawerLink>
                                        <DrawerLink to="/how-it-works" active={isActive('/how-it-works')} onClick={() => navigate('/how-it-works')} icon={<BookOpen size={16} />}>
                                            How it Works
                                        </DrawerLink>
                                        <DrawerLink to="/features" active={isActive('/features')} onClick={() => navigate('/features')} icon={<Sparkles size={16} />}>
                                            Features
                                        </DrawerLink>
                                        <DrawerLink to="/pricing" active={isActive('/pricing')} onClick={() => navigate('/pricing')} icon={<TagIcon size={16} />}>
                                            Pricing
                                        </DrawerLink>
                                    </DrawerSection>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={onOpenAuth}
                                            className={cn(chromeBtn, 'flex-1 justify-center border border-white/20 text-white/80 hover:text-white')}
                                        >
                                            Log In
                                        </button>
                                        <button
                                            onClick={onOpenAuth}
                                            className={cn(chromeBtn, 'flex-1 justify-center bg-brandred-600 text-white hover:bg-brandred-500')}
                                        >
                                            Get Started
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <ThemeToggle />
                                        <HelpHeaderButton />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={canCreate ? onCreatePool : undefined}
                                        disabled={!canCreate}
                                        className={cn(
                                            chromeBtn,
                                            'w-full justify-center min-h-[44px]',
                                            canCreate
                                                ? 'bg-brandred-600 text-white hover:bg-brandred-500'
                                                : 'bg-navy-800 text-white/40 cursor-not-allowed hover:translate-y-0'
                                        )}
                                        title={canCreate ? 'Create a new pool' : 'Pool creation is coming soon'}
                                    >
                                        <Plus size={16} /> {createLabel}
                                    </button>

                                    <DrawerSection label="My Pools">
                                        <DrawerLink to="/participant?tab=entries" active={isActive('/participant')} onClick={() => navigate('/participant?tab=entries')} icon={<ClipboardList size={16} />}>
                                            My Entries
                                        </DrawerLink>
                                        {canManage && (
                                            <DrawerLink to="/participant?tab=commissioner" onClick={() => navigate('/participant?tab=commissioner')} icon={<Users size={16} />}>
                                                Manage My Pools
                                            </DrawerLink>
                                        )}
                                    </DrawerSection>

                                    <DrawerSection label="Explore">
                                        <DrawerLink to="/scoreboard" active={isActive('/scoreboard')} onClick={() => navigate('/scoreboard')} icon={<Trophy size={16} />} className="text-gold-400">
                                            Live Scores
                                        </DrawerLink>
                                        <DrawerLink to="/browse" active={isActive('/browse')} onClick={() => navigate('/browse')} icon={<Compass size={16} />}>
                                            Public Pools
                                        </DrawerLink>
                                        <DrawerLink to="/how-it-works" active={isActive('/how-it-works')} onClick={() => navigate('/how-it-works')} icon={<BookOpen size={16} />}>
                                            How it Works
                                        </DrawerLink>
                                        <DrawerLink to="/features" active={isActive('/features')} onClick={() => navigate('/features')} icon={<Sparkles size={16} />}>
                                            Features
                                        </DrawerLink>
                                        <DrawerLink to="/pricing" active={isActive('/pricing')} onClick={() => navigate('/pricing')} icon={<TagIcon size={16} />}>
                                            Pricing
                                        </DrawerLink>
                                    </DrawerSection>

                                    <DrawerSection label={user.name}>
                                        <DrawerLink to={`/profile/${user.id}`} active={isActive(`/profile/${user.id}`)} onClick={() => navigate(`/profile/${user.id}`)} icon={<BarChart3 size={16} />}>
                                            My Stats
                                        </DrawerLink>
                                        <DrawerLink to="/profile" active={isActive('/profile')} onClick={() => navigate('/profile')} icon={<UserIcon size={16} />}>
                                            My Profile
                                        </DrawerLink>
                                        {isSuperAdmin(user) && (
                                            <DrawerLink to="/super-admin" active={isActive('/super-admin')} onClick={() => navigate('/super-admin')} icon={<Shield size={16} />} className="text-gold-300">
                                                SuperAdmin
                                            </DrawerLink>
                                        )}
                                        <DrawerAction onClick={toggleTheme} icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}>
                                            {theme === 'dark' ? 'Light Theme' : 'Dark Theme'}
                                        </DrawerAction>
                                        <DrawerAction onClick={onLogout} icon={<LogOut size={16} />}>
                                            Log Out
                                        </DrawerAction>
                                    </DrawerSection>

                                    <div className="flex items-center gap-2">
                                        <HelpHeaderButton />
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </header>
        </>
    );
};
