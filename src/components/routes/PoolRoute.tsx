import { OverlayRoot } from '../ui/OverlayRoot';
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Loader, Shield, Edit2, ChevronUp, ChevronDown, Lock, Zap, HelpCircle, ExternalLink, Check, Copy, Heart, DollarSign } from 'lucide-react';

import { Header } from '../Header';
import { Footer } from '../Footer';
import { ShareModal, AuthModal } from '../modals';
import { PoolTimer } from '../PoolTimer';
import { Grid } from '../Grid';
import { AuditLog } from '../AuditLog';
import { AICommissioner } from '../AICommissioner';
import { PaymentSuccessBanner } from '../billing/PaymentSuccessBanner';


import { BracketPoolDashboard } from '../BracketPoolDashboard/BracketPoolDashboard';
import { PropsPoolDashboard } from '../PropsPoolDashboard/PropsPoolDashboard';
import { PlayoffDashboard } from '../PlayoffPool/PlayoffDashboard';
import { NFLPoolDashboard } from '../NFLPoolDashboard/NFLPoolDashboard';


import { dbService } from '../../services/dbService';
import { calculateScenarioWinners, getLastDigit } from '../../services/gameLogic';
import { shareTrackingService } from '../../services/shareTrackingService';
import { getTeamLogo } from '../../constants';
import { calculateQuarterlyPayouts } from '../../utils/payouts';
import { isSuperAdmin, isPoolManager, isNFLPoolCommissioner } from '../../utils/auth';
import { logger } from '../../utils/logger';
import { useToast } from '../ui/Toast';
import { Button, Badge } from '../ui';
import type { User, Pool, GameState, PropsPool, PlayoffPool, Winner, BillingStatus } from '../../types';
import { HelpScopeProvider } from '../../help/scope';
import type { PoolType } from '@shared/poolTypes';

interface PoolRouteProps {
    user: User | null;
    pools: Pool[]; // Changed from pool: Pool | null
    isLoading: boolean;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

export const PoolRoute: React.FC<PoolRouteProps> = ({
    user,
    pools,
    isLoading,
    onOpenAuth,
    onLogout,
    onCreatePool
}) => {
    const navigate = useNavigate();
    const { id } = useParams();
    const toast = useToast();

    // Find pool logic
    // Find pool logic
    // We now subscribe to the pool directly to ensure real-time updates (Issue #FixReservation)
    const [pool, setPool] = useState<Pool | null>(null);
    const [isFetchingPool, setIsFetchingPool] = useState(true);

    useEffect(() => {
        if (!id) return;

        // Optimistically set from global cache if available to prevent flash
        // We do not add pools to default dependency to avoid re-subscribing on every global update
        const cached = pools.find(p => p.id === id || ('slug' in p && p.slug === id) || ('urlSlug' in p && p.urlSlug === id));
        if (cached) {
            setPool(cached);
            setIsFetchingPool(false);
        } else {
            setIsFetchingPool(true);
        }

        const unsubscribe = dbService.subscribeToPool(id, (p) => {
            setPool(p);
            setIsFetchingPool(false);
        });
        return () => unsubscribe();
    }, [id, pools]);

    // State for winners
    const [winners, setWinners] = useState<Winner[]>([]);

    useEffect(() => {
        if (!pool) return;
        // Subscribe to winners subcollection
        const unsubscribe = dbService.subscribeToWinners(pool.id, (data) => {
            setWinners(data);
        });
        return () => unsubscribe();
    }, [pool]);

    // Share click tracking: record when visitor arrives via shared link
    useEffect(() => {
        if (!pool?.id) return;
        const params = new URLSearchParams(window.location.search);
        const utmSource = params.get('utm_source');
        if (!utmSource) return;

        const trackingKey = `share_tracked_${pool.id}`;
        if (sessionStorage.getItem(trackingKey)) return;

        sessionStorage.setItem(trackingKey, '1');
        shareTrackingService.recordClick(pool.id, utmSource);
    }, [pool?.id]);



    // Calculate isManager
    const isManager = useMemo(() => {
        if (!user || !pool) return false;
        return isPoolManager(user, pool);
    }, [user, pool]);

    // PLAN-CO-COMMISSIONERS D3: the ONE place the client widens `isManager` to
    // a named NFL co-commissioner. Used ONLY by the NFL branch below (its Header
    // and NFLPoolDashboard); Bracket/Playoff/Props/Squares keep the strict value.
    const nflIsManager = useMemo(() => isNFLPoolCommissioner(user, pool), [user, pool]);

    // State moved from App.tsx
    const [statusTab, setStatusTab] = useState<'overview' | 'rules' | 'payment'>('overview');
    const [showPoolInfo, setShowPoolInfo] = useState(true);
    const [showAudit, setShowAudit] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareUrl, setShareUrl] = useState('');
    const [showRulesModal, setShowRulesModal] = useState(false);
    const [zelleCopied, setZelleCopied] = useState(false);

    // Auth Modal local state
    const [showAuthModalLocal, setShowAuthModalLocal] = useState(false);
    const [authModeLocal, setAuthModeLocal] = useState<'login' | 'register'>('login');

    const handleLocalAuth = (mode: 'login' | 'register') => {
        setAuthModeLocal(mode);
        setShowAuthModalLocal(true);
    };

    // Password Gate (Local) moved to top
    const [enteredPassword, setEnteredPassword] = useState('');
    const [passwordError, setPasswordError] = useState<string | null>(null);
    /**
     * WHICH POOL was unlocked, not WHETHER one was (codex r9, P1).
     *
     * This route stays MOUNTED across pool navigation — the `key` note on the
     * NFL branch below exists for exactly that reason — so a boolean survived
     * into the next pool, and unlocking one protected pool then opened every
     * other protected pool the user navigated to, gate and all. Storing the id
     * makes the unlock a statement about a specific pool.
     */
    const [unlockedPoolId, setUnlockedPoolId] = useState<string | null>(null);
    const [checkingPassword, setCheckingPassword] = useState(false);

    // Quarterly Payouts (Moved to top)
    const quarterlyPayouts = useMemo(() => {
        if (!pool || pool.type !== 'SQUARES') {
            logger.log('[PoolRoute] Quarterly Payouts: Pool not SQUARES or null', pool?.type);
            return [];
        }
        const res = calculateQuarterlyPayouts(pool as GameState, winners);
        logger.log('[PoolRoute] Quarterly Payouts Calculated:', res.length, 'First:', res[0]?.amount);
        return res;
    }, [pool, winners]);

    if (isLoading || isFetchingPool) return <div className="text-[color:var(--text)] p-10 flex flex-col items-center gap-4"><Loader className="animate-spin text-gold-500" size={48} /><p className="font-body">Loading Pool...</p></div>;

    if (!pool) {
        return (
            <div className="text-[color:var(--text)] p-10 font-body flex flex-col items-center justify-center min-h-[50vh]">
                <h2 className="text-xl font-display font-bold uppercase tracking-[0.05em] mb-4 text-brandred-500">Pool Not Found</h2>
                <div className="bg-card p-6 rounded-xl border border-line max-w-2xl w-full text-sm space-y-2 shadow-card">
                    <p><strong>ID/Slug:</strong> <span className="text-gold-600 num">"{id}"</span></p>
                    <div className="pt-4 flex gap-4">
                        <Button variant="primary" size="sm" onClick={() => navigate('/')}>Go Home</Button>
                        <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>Reload Page</Button>
                    </div>
                </div>
            </div>
        );
    }

    // PLAN-HELP-SYSTEM T1: the help scope for EVERY dispatched pool type,
    // including the inline Squares grid below and the pre-tab landing state.
    // Declared once here rather than per branch, because `pool` is known from
    // this point on and a branch that forgot it would silently show a member
    // the wrong pool type's copy. `nflIsManager` widens to a named NFL
    // co-commissioner and is the value the NFL branch renders with, so the
    // audience follows whichever one applies.
    const withHelp = (node: React.ReactNode) => (
        <HelpScopeProvider
            poolType={pool.type as PoolType}
            audience={isManager || nflIsManager ? 'commissioner' : 'member'}
            // The pool's OWN settings object, by reference — this is what lets
            // a `HelpCopy.template` render the rule this pool is actually
            // playing instead of a sentence widened to cover every value.
            // Not spread into a new object: the publish store would then see a
            // new identity on every render (`PublishedRoute.settings`).
            settings={(pool as { settings?: Record<string, unknown> }).settings}
        >
            {/* G5 — acknowledge a return from checkout. Mounted HERE, in the one
                wrapper every pool-type branch returns through, rather than
                repeated in each of the five branches below. */}
            {/* ⚠️ `key` is load-bearing (codex r1 [P2]). This route stays MOUNTED
                across pool navigation — see the long note on the NFL branch's
                `key` below — so without it the banner's once-per-mount read of
                `payment=success` would persist onto the NEXT pool and announce
                a payment that pool never received. */}
            <PaymentSuccessBanner
                key={pool.id}
                status={(pool as { billing?: { status?: BillingStatus } }).billing?.status}
            />
            {node}
        </HelpScopeProvider>
    );

    const openShare = (poolId: string) => {
        const identifier = (pool.type === 'BRACKET' ? pool.slug : pool.urlSlug) || poolId;
        const url = `${window.location.origin}/pool/${identifier}`;
        setShareUrl(url);
        setShowShareModal(true);
    };

    /**
     * PLAN-AUDIT-AUTH-HARDENING Phase B (audit item 1).
     *
     * This used to be `enteredPassword === squaresPool.gridPassword` — a compare
     * in the BROWSER against a field on a document that is `allow get: if true`,
     * so anyone holding the share link could read the password out of the
     * network tab and never see this box at all. The check now runs in the
     * `verifyPoolAccess` callable against a PBKDF2 record in
     * `pools/{id}/private/access`, which rules close to every client.
     *
     * The callable is the authority in BOTH directions: a throttled or failed
     * call returns false, so the gate fails CLOSED.
     */
    const handlePasswordSubmit = async () => {
        if (checkingPassword) return;
        // An empty box is not worth a round trip, and it would burn one of the
        // caller's ten attempts against the throttle.
        if (!enteredPassword) { setPasswordError('Enter the pool password.'); return; }
        setCheckingPassword(true);
        try {
            const { ok, reason } = await dbService.verifyPoolAccess(gated.id, enteredPassword);
            setUnlockedPoolId(ok ? gated.id : null);
            setPasswordError(ok ? null
                : reason === 'throttled' ? 'Too many attempts. Wait a few minutes and try again.'
                : reason === 'error' ? 'Could not check the password right now. Try again.'
                : 'Incorrect password.');
        } finally {
            setCheckingPassword(false);
        }
    };

    /**
     * Whether the gate renders. `hasPoolPassword` is the non-secret marker the
     * server sets; `gridPassword` is the legacy plaintext, still present on pools
     * the migration sweep has not reached — reading it here keeps those pools
     * gated during the rollout without the value being trusted for anything.
     *
     * ⚠️ SQUARES **AND PROPS** (codex r7, P1). This gate used to live BELOW the
     * per-type branches, so it was only ever reached for SQUARES — while the
     * Props wizard has always offered an "Entry Password" field and the create
     * path has always stored it. A Props commissioner set a password, was told
     * the pool was protected, and every visitor walked straight in: the
     * exposed-and-unenforced shape of audit item 13a, in a second place. It is
     * hoisted above every branch now, so adding a pool type cannot silently
     * opt out of it.
     *
     * BRACKET is deliberately NOT here: its password gates JOINING, not viewing,
     * and that is enforced server-side in `joinBracketPool`. The NFL types have
     * no password at all.
     */
    const PASSWORD_VIEW_GATED_TYPES = ['SQUARES', 'PROPS'];
    const gated = pool as unknown as {
        id: string; ownerId?: string; gridPassword?: string; hasPoolPassword?: boolean;
    };
    const isPasswordProtected = PASSWORD_VIEW_GATED_TYPES.includes(pool.type)
        && Boolean(gated.hasPoolPassword || gated.gridPassword);


    // Actually it was mainly for debug in header.

    const renderPasswordGate = () => (
        <div className="min-h-screen bg-page flex items-center justify-center p-4">
            <div className="bg-card border border-line rounded-xl p-8 max-w-md w-full text-center shadow-card">
                <div className="w-16 h-16 bg-page rounded-full flex items-center justify-center mx-auto mb-6 border border-line"><Lock size={32} className="text-gold-500" /></div>
                <h2 className="text-2xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-2">Password Protected</h2>
                <p className="text-muted mb-6 font-body">This pool is private. Please enter the password to view it.</p>
                {passwordError && <div role="alert" className="bg-brandred-600/10 border border-brandred-600/30 text-brandred-500 p-3 rounded-lg text-sm mb-4 font-body">{passwordError}</div>}
                <div className="flex gap-2">
                    <input type="password" value={enteredPassword} onChange={(e) => setEnteredPassword(e.target.value)} placeholder="Enter Password" className="flex-1 bg-page border border-line rounded-lg px-4 py-2 text-[color:var(--text)] font-body outline-none focus:ring-2 focus:ring-gold-500 placeholder:text-faint" onKeyDown={(e) => { if (e.key === 'Enter') void handlePasswordSubmit(); }} />
                    <Button variant="primary" disabled={checkingPassword} onClick={() => { void handlePasswordSubmit(); }}>{checkingPassword ? 'Checking…' : 'Unlock'}</Button>
                </div>
                <div className="mt-6 pt-6 border-t border-line"><p className="text-xs text-faint font-body">Contact the pool manager for access.</p></div>
            </div>
        </div>
    );

    // `isManager`, not `ownerId` (codex r9, P2). A pool whose `managerUid`
    // differs from `ownerId` has a designated manager who can administer the
    // password server-side but would otherwise be shown the gate and locked out
    // of their own dashboard; `isPoolManager` is the predicate the rest of this
    // file already trusts for exactly that question, and it admits SUPER_ADMIN.
    if (isPasswordProtected && unlockedPoolId !== gated.id && !isManager) {
        return withHelp(renderPasswordGate());
    }

    if (pool.type === 'BRACKET') {
        return withHelp(
            <div className="min-h-screen bg-page text-[color:var(--text)] font-body selection:bg-gold-500/30 selection:text-[color:var(--text)] flex flex-col">
                <Header
                    user={user}
                    isManager={isManager}
                    onOpenAuth={onOpenAuth}
                    onLogout={onLogout}
                    onCreatePool={onCreatePool}
                />
                <div className="flex-grow">
                    <BracketPoolDashboard
                        pool={pool}
                        user={user}
                        onBack={() => navigate('/')}
                        onShare={() => {
                            const identifier = pool.slug || pool.id;
                            const url = `${window.location.origin}/pool/${identifier}`;
                            navigator.clipboard.writeText(url);
                            toast.success("Link copied to clipboard!");
                        }}
                    />
                </div>
                <Footer />
            </div>
        );
    }

    if (pool.type === 'PROPS') {
        return withHelp(
            <div className="min-h-screen bg-page text-[color:var(--text)] font-body selection:bg-gold-500/30 selection:text-[color:var(--text)] flex flex-col">
                <Header
                    user={user}
                    isManager={isManager}
                    onOpenAuth={onOpenAuth}
                    onLogout={onLogout}
                    onCreatePool={onCreatePool}
                />
                <div className="flex-grow">
                    <PropsPoolDashboard
                        pool={pool as PropsPool}
                        user={user}
                        isManager={isManager}
                        isAdmin={isSuperAdmin(user)}
                        onBack={() => navigate('/')}
                        onOpenAuth={onOpenAuth}
                    />
                </div>
                <Footer />
            </div>
        );
    }

    if (pool.type === 'NFL_PLAYOFFS') {
        return withHelp(
            <div className="min-h-screen bg-page text-[color:var(--text)] font-body selection:bg-gold-500/30 selection:text-[color:var(--text)] flex flex-col">
                <Header
                    user={user}
                    isManager={isManager}
                    onOpenAuth={onOpenAuth}
                    onLogout={onLogout}
                    onCreatePool={onCreatePool}
                />
                <div className="flex-grow">
                    <PlayoffDashboard
                        pool={pool as PlayoffPool}
                        user={user}
                        onBack={() => navigate('/')}
                    />
                </div>
                <Footer />
            </div>
        );
    }

    if (pool.type === 'NFL_PICKEM' || pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_MARGIN') {
        return withHelp(
            <div className="min-h-screen bg-page text-[color:var(--text)] font-body selection:bg-gold-500/30 selection:text-[color:var(--text)] flex flex-col">
                <Header
                    user={user}
                    isManager={nflIsManager}
                    onOpenAuth={onOpenAuth}
                    onLogout={onLogout}
                    onCreatePool={onCreatePool}
                />
                <div className="flex-grow">
                    {/* 🛑 `key` IS THE FIX, NOT A LIST-RENDER HABIT (codex r4).
                        This route keeps the dashboard MOUNTED across pool
                        navigation — the effect above sets `pool` from the global
                        cache with no loading state, which is the common path for
                        a commissioner moving between their own pools. Every
                        subscribed state in the dashboard (`entries`, `ownEntry`,
                        `members`, `standingsRows`, `recaps`) then holds the
                        PREVIOUS pool's data until its new snapshot lands, and
                        the picks grid renders the old own-entry row as this
                        pool's picks the whole time. Keying on the pool id makes
                        React discard that state instead of carrying it over —
                        one line, versus stamping every piece of state
                        separately. The tab and week ride in the URL, so they
                        survive the remount. */}
                    <NFLPoolDashboard
                        key={pool.id}
                        pool={pool}
                        user={user}
                        isManager={nflIsManager}
                        onBack={() => navigate('/')}
                        onOpenAuth={onOpenAuth}
                    />
                </div>
                <Footer />
            </div>
        );
    }

    // --- SQUARES LOGIC ---
    const squaresPool = pool as GameState;

    // Helper Functions

    // Claim Logic
    const handleClaimSquares = async (ids: number[], name: string, details: { email?: string, phone?: string }, guestKey?: string) => {
        if (!ids.length && !name) return { success: false, message: 'Invalid data' };
        if (!name.trim()) return { success: false, message: 'Name is required' };
        // Validations
        const normalizedName = name.trim();
        // Check for taking existing
        if (ids.some(id => squaresPool.squares[id]?.owner && squaresPool.squares[id].owner !== normalizedName)) {
            return { success: false, message: 'Square already taken.' };
        }
        // Max limit
        const currentOwned = squaresPool.squares.filter((s) => s.owner === normalizedName).length;
        const limit = Number(squaresPool.maxSquaresPerPlayer) || 10;
        if (currentOwned + ids.length > limit && squaresPool.ownerId !== user?.id) return { success: false, message: `Limit exceeded. Max ${limit}.` };

        try {
            const promises = ids.map(id => dbService.reserveSquare(
                squaresPool.id,
                id,
                { ...details, name: normalizedName },
                guestKey,
                normalizedName
            ));
            await Promise.all(promises);
        } catch (error: unknown) {
            logger.error("Reserve failed", error);
            const msg = error instanceof Error ? error.message : "Reservation failed.";
            return { success: false, message: msg };
        }

        // Email Confirmation Trigger (Client Side for now per original App.tsx)
        if ((squaresPool.emailConfirmation === 'Email Confirmation' || squaresPool.emailConfirmation === 'true') && details.email) {
            const p = pool as { ownerId?: string; managerUid?: string };
            const ownerId = p.ownerId || p.managerUid;
            import('../../services/emailService').then(({ emailService }) => {
                emailService.sendConfirmation(
                    squaresPool.name,
                    ids.map(id => ({ id, cost: squaresPool.costPerSquare })),
                    details.email!,
                    normalizedName,
                    squaresPool.id,
                    {
                        ruleVariations: squaresPool.ruleVariations,
                        charity: squaresPool.charity,
                        costPerSquare: squaresPool.costPerSquare,
                        payouts: squaresPool.payouts
                    },
                    ownerId,
                    squaresPool.paymentHandles
                ).catch(err => logger.error('[PoolRoute] Email failed', err));
            }).catch(err => logger.error('[PoolRoute] Failed to import emailService', err));
        }

        return { success: true };
    };

    const handleJoinWaitlist = async (name: string, email: string) => {
        if (squaresPool.waitlist?.some(w => w.email.toLowerCase() === email.toLowerCase())) {
            return { success: false, message: 'You are already on the waitlist!' };
        }
        try {
            await dbService.joinWaitlist(squaresPool.id, { email, name, timestamp: Date.now() });
            return { success: true, message: 'You have been added to the waitlist!' };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Failed to join waitlist.';
            return { success: false, message: msg };
        }
    };


    const homeLogo = squaresPool.homeTeamLogo || getTeamLogo(squaresPool.homeTeam);
    const awayLogo = squaresPool.awayTeamLogo || getTeamLogo(squaresPool.awayTeam);
    const homePredictions = calculateScenarioWinners(squaresPool, 'home');
    const awayPredictions = calculateScenarioWinners(squaresPool, 'away');
    const squaresRemaining = 100 - (squaresPool.squares?.filter(s => s.owner).length || 0);
    const latestWinner = winners.length > 0 ? winners[winners.length - 1].owner : null;

    return withHelp(
        <div
            className="min-h-screen bg-page text-[color:var(--text)] font-body selection:bg-gold-500/30 selection:text-[color:var(--text)] pb-20 relative transition-colors duration-500"
            style={{ backgroundColor: squaresPool.branding?.backgroundColor || undefined }}
        >
            <Header user={user} isManager={isManager} onOpenAuth={onOpenAuth} onLogout={onLogout} onCreatePool={onCreatePool} />
            <ShareModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} shareUrl={shareUrl} />

            {/* Header Content */}
            <div className="max-w-[1400px] mx-auto px-4 pt-6 flex justify-between items-center">
                <div className="text-center md:text-left">
                    <div className="flex items-center gap-3 mb-1">
                        {squaresPool.branding?.logoUrl && (
                            <img src={squaresPool.branding.logoUrl} className="h-16 w-auto object-contain drop-shadow-lg" alt="Pool Logo" />
                        )}
                        <h1 className="text-3xl font-display font-extrabold uppercase tracking-[0.02em] text-[color:var(--text)]">{squaresPool.name}</h1>
                        <button onClick={() => setShowAudit(true)} className="bg-gold-500/10 hover:bg-gold-500/20 text-gold-600 border border-gold-500/30 text-[10px] font-display font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors duration-150">
                            <Shield size={10} className="fill-gold-400/20" /> Fully Auditable
                        </button>
                    </div>
                    <p className="text-muted text-sm font-medium font-body"><span className="num">{squaresRemaining}</span> Squares Remaining</p>
                </div>
                <div className="flex gap-2">
                    {user && (user.id === squaresPool.ownerId || isSuperAdmin(user)) && (
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/${squaresPool.id}`)}>
                            <Edit2 size={16} /> Manage Pool
                        </Button>
                    )}
                    {!user && (
                        <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => handleLocalAuth('login')}>
                            Sign In to Manage Your Pool
                        </Button>
                    )}
                    <Button variant="primary" size="sm" onClick={() => openShare(squaresPool.id)}>Share</Button>
                </div>
            </div>

            {/* Latest Winner Banner */}
            {latestWinner && (
                <div className="flex justify-center mt-4 mb-2">
                    <div className="bg-[#FBF3E0] border border-[#EAD9A8] rounded-full px-8 py-2 text-gold-700 font-display font-bold tracking-[0.16em] uppercase shadow-card flex items-center gap-3">
                        <DollarSign size={16} /> In The Money: <span className="text-[color:var(--text)] text-lg">{latestWinner}</span> <DollarSign size={16} />
                    </div>
                </div>
            )}

            <div className="max-w-[1400px] mx-auto px-4 py-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-muted font-display font-bold uppercase text-xl tracking-[0.08em]">Pool Details</h3>
                    <button
                        onClick={() => setShowPoolInfo(!showPoolInfo)}
                        className="bg-card hover:bg-page text-muted p-2 rounded-full transition-colors duration-150 border border-line"
                    >
                        {showPoolInfo ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>

                <div className={`transition-collapse duration-300 ease-in-out overflow-hidden ${showPoolInfo ? 'max-h-[1000px] opacity-100 mb-6' : 'max-h-0 opacity-0 mb-0'}`}>
                    <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 ${(squaresPool as GameState).charity?.enabled ? 'lg:grid-cols-3' : 'lg:grid-cols-2 max-w-5xl mx-auto'}`}>

                        {/* 1. Status Card (Tabbed) */}
                        <div className="bg-card rounded-xl border border-line shadow-card flex flex-col overflow-hidden h-full">
                            {/* Tabs Header */}
                            <div className="flex border-b border-line">
                                <button onClick={() => setStatusTab('overview')} className={`flex-1 py-3 text-xs font-display font-bold uppercase tracking-[0.08em] transition-colors duration-150 ${statusTab === 'overview' ? 'bg-page text-[color:var(--text)] border-b-2 border-gold-500' : 'text-faint hover:text-muted hover:bg-page/50'}`}>Overview</button>
                                <button onClick={() => setStatusTab('rules')} className={`flex-1 py-3 text-xs font-display font-bold uppercase tracking-[0.08em] transition-colors duration-150 ${statusTab === 'rules' ? 'bg-page text-[color:var(--text)] border-b-2 border-gold-500' : 'text-faint hover:text-muted hover:bg-page/50'}`}>Rules</button>
                                <button onClick={() => setStatusTab('payment')} className={`flex-1 py-3 text-xs font-display font-bold uppercase tracking-[0.08em] transition-colors duration-150 ${statusTab === 'payment' ? 'bg-page text-[color:var(--text)] border-b-2 border-gold-500' : 'text-faint hover:text-muted hover:bg-page/50'}`}>Payment</button>
                            </div>

                            <div className="p-6 flex-1 flex flex-col justify-center">
                                {statusTab === 'overview' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-200">
                                        <div><h3 className="text-faint font-display font-bold uppercase text-xs tracking-[0.08em] mb-1">Status:</h3>
                                            {!squaresPool.isLocked ? <div className="flex items-center gap-2"><Badge status="open" /><p className="text-faint text-[10px] font-body">Grid is available to choose squares</p></div>
                                                : squaresPool.scores?.gameStatus === 'post' ? <div className="flex items-center gap-2"><Badge status="locked">Locked - Final</Badge><p className="text-faint text-[10px] font-body">Game has completed</p></div>
                                                    : squaresPool.scores?.gameStatus === 'in' ? <div className="flex items-center gap-2"><Badge status="live">Locked - Live</Badge><p className="text-faint text-[10px] font-body">Game has started</p></div>
                                                        : <div className="flex items-center gap-2"><Badge status="locked"><Lock size={12} /> Locked - Pending</Badge><p className="text-faint text-[10px] font-body">Waiting for kickoff</p></div>
                                            }</div>
                                        <div><h3 className="text-faint font-display font-bold uppercase text-xs tracking-[0.08em] mb-1">Grid Owner:</h3><p className="text-[color:var(--text)] font-medium font-body">{squaresPool.contactEmail || 'Admin'}</p></div>
                                        <div><h3 className="text-faint font-display font-bold uppercase text-xs tracking-[0.08em] mb-1">Cost Per Square:</h3><p className="text-[color:var(--text)] font-medium text-sm font-body num">${squaresPool.costPerSquare}</p></div>
                                    </div>
                                )}
                                {statusTab === 'rules' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                                        <div className="bg-page border border-line rounded-lg p-3 text-center">
                                            <PoolTimer
                                                targetDate={squaresPool.scores.startTime}
                                                gameStatus={squaresPool.scores.gameStatus}
                                                isLocked={squaresPool.isLocked || (squaresRemaining === 0 && !!squaresPool.axisNumbers)}
                                            />
                                        </div>
                                        <div><h3 className="text-faint font-display font-bold uppercase text-xs tracking-[0.08em] mb-1">Limits:</h3><p className="text-[color:var(--text)] font-medium text-sm font-body">Max <span className="num">{squaresPool.maxSquaresPerPlayer || 'N/A'}</span> squares per player</p></div>
                                        {/* Simplified Rule Buttons */}
                                        <div>
                                            <h3 className="text-faint font-display font-bold uppercase text-xs tracking-[0.08em] mb-1">Active Rules:</h3>
                                            <div className="flex flex-wrap gap-2">
                                                {/* Rollover */}
                                                {squaresPool.ruleVariations.quarterlyRollover && (
                                                    <div className="group relative cursor-help">
                                                        <div className="bg-gold-500/10 text-gold-600 border border-gold-500/30 px-2 py-0.5 rounded text-xs font-display font-bold uppercase tracking-[0.06em] flex items-center gap-1"><Zap size={12} className="fill-gold-500" /> Rollover Active</div>
                                                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-card text-[color:var(--text)] text-[10px] p-2 rounded shadow-card border border-line opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center font-body">
                                                            Unsold squares roll their prize money to the next quarter.
                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-[color:var(--card)]"></div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Number Sets */}
                                                <div className="group relative cursor-help">
                                                    <div className="bg-navy-800/10 text-navy-700 dark:text-[#9FB0CC] border border-navy-700/30 px-2 py-0.5 rounded text-xs font-display font-bold uppercase tracking-[0.06em] flex items-center gap-1">Number Sets: <span className="num">{squaresPool.numberSets || '1'}</span></div>
                                                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-card text-[color:var(--text)] text-[10px] p-2 rounded shadow-card border border-line opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center font-body">
                                                        {squaresPool.numberSets === 4 ? "New numbers generated for each quarter." : "Same numbers used for the entire game."}
                                                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-[color:var(--card)]"></div>
                                                    </div>
                                                </div>

                                                {/* Reverse Payouts */}
                                                {squaresPool.ruleVariations.reverseWinners && (
                                                    <div className="group relative cursor-help">
                                                        <div className="bg-gold-500/10 text-gold-600 border border-gold-500/30 px-2 py-0.5 rounded text-xs font-display font-bold uppercase tracking-[0.06em] flex items-center gap-1">Reverse Numbers</div>
                                                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-card text-[color:var(--text)] text-[10px] p-2 rounded shadow-card border border-line opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center font-body">
                                                            Winners split the pot 50/50 with the reverse number combination.
                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-[color:var(--card)]"></div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Every Score Pays */}
                                                {squaresPool.ruleVariations.scoreChangePayout && (
                                                    <div className="group relative cursor-help">
                                                        <div className="bg-[#5B2A86]/10 text-[#5B2A86] dark:text-[#8655B5] border border-[#5B2A86]/30 px-2 py-0.5 rounded text-xs font-display font-bold uppercase tracking-[0.06em] flex items-center gap-1">Every Score Pays</div>
                                                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-card text-[color:var(--text)] text-[10px] p-2 rounded shadow-card border border-line opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center font-body">
                                                            Payouts awarded for every score change, not just at quarter ends.
                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-[color:var(--card)]"></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <button onClick={() => setShowRulesModal(true)} className="flex items-center gap-2 group hover:text-[color:var(--text)] transition-colors duration-150 text-faint text-xs font-display font-bold uppercase tracking-[0.08em]">
                                                <HelpCircle size={14} className="text-faint group-hover:text-gold-500 transition-colors duration-150" /> View Full Rules
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {statusTab === 'payment' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200 w-full">
                                        {(squaresPool.paymentHandles?.venmo || squaresPool.paymentHandles?.zelle) ? (
                                            <div className="flex flex-col gap-2">
                                                {squaresPool.paymentHandles?.venmo && <a href={`https://venmo.com/u/${squaresPool.paymentHandles.venmo.replace('@', '')}`} target="_blank" rel="noreferrer" className="bg-[#008CFF] hover:bg-[#0077D9] text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 justify-center transition-colors w-full">Venmo: {squaresPool.paymentHandles.venmo} <ExternalLink size={14} /></a>}
                                                {squaresPool.paymentHandles?.zelle && <div className="bg-page border border-line text-[color:var(--text)] px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 justify-center w-full font-body">Zelle: {squaresPool.paymentHandles.zelle} <button onClick={() => { navigator.clipboard.writeText(squaresPool.paymentHandles?.zelle || ''); setZelleCopied(true); setTimeout(() => setZelleCopied(false), 2000); }} className="ml-2 bg-card hover:bg-surface p-1.5 rounded transition-colors duration-150 border border-line">{zelleCopied ? <Check size={14} className="text-[#0F7B4A]" /> : <Copy size={14} className="text-muted opacity-80" />}</button></div>}
                                            </div>
                                        ) : <div className="text-faint text-xs italic font-body">No digital payment methods configured.</div>}
                                        <div className="border-t border-line pt-3">
                                            <h3 className="text-faint font-display font-bold uppercase text-xs tracking-[0.08em] mb-1">Instructions:</h3>
                                            <p className="text-[color:var(--text)] text-sm leading-relaxed max-h-32 overflow-y-auto pr-1 font-body">{squaresPool.paymentInstructions || "No additional instructions."}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Charity */}
                        {squaresPool.charity?.enabled && (
                            <div className="bg-card border border-gold-500/30 rounded-xl p-6 shadow-card relative overflow-hidden flex flex-col justify-center">
                                <div className="absolute top-0 right-0 p-4 opacity-10"><Heart size={80} className="text-gold-500" /></div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-2 mb-2"><div className="bg-gold-500/20 p-1.5 rounded-lg"><Heart size={18} className="text-gold-600" /></div><h3 className="text-sm font-display font-bold text-[color:var(--text)] uppercase tracking-[0.08em]">Proudly Supporting</h3></div>
                                    <h2 className="text-2xl font-display font-bold uppercase text-gold-600 mb-1 leading-tight">{squaresPool.charity.name}</h2>
                                    <span className="text-2xl font-display font-bold text-[color:var(--text)] num">${(Math.floor((squaresPool.squares.filter(s => s.owner).length * squaresPool.costPerSquare * (squaresPool.charity.percentage / 100)))).toLocaleString()}</span>
                                </div>
                            </div>
                        )}

                        {/* Payout Structure Card - Simplified */}
                        <div className="bg-card rounded-xl border border-line shadow-card flex flex-col overflow-hidden h-full">
                            <div className="flex border-b border-line bg-page px-6 py-4"><h3 className="text-sm font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)]">Payout Structure</h3></div>
                            <div className="p-6 flex-1 flex flex-col justify-center">
                                <div className="flex justify-between items-center text-sm border-b border-line pb-2"><span className="text-muted font-body">Total Pot</span><span className="text-[color:var(--text)] font-bold num">${(squaresPool.squares.filter(s => s.owner).length * squaresPool.costPerSquare).toLocaleString()}</span></div>
                                <div className="flex justify-between items-center text-sm border-b border-line pb-2 mb-2 mt-2"><span className="text-[color:var(--text)] font-bold font-body">Net Prize Pool</span><span className="text-gold-600 font-display font-bold text-lg num">${(Math.floor((squaresPool.squares.filter(s => s.owner).length * squaresPool.costPerSquare * (1 - (squaresPool.charity?.enabled ? squaresPool.charity.percentage / 100 : 0))))).toLocaleString()}</span></div>
                                <div className="space-y-1 mt-2">
                                    {quarterlyPayouts.map((card) => {
                                        return (
                                            <div key={card.period} className="flex justify-between items-center text-sm border-b border-line/50 pb-2 last:border-0">
                                                <span className="text-muted font-bold font-body">{card.label} <span className="text-faint font-normal num">({(squaresPool as GameState).payouts[card.period as keyof typeof squaresPool.payouts]}%)</span></span>
                                                <div className="flex flex-col items-end"><span className="text-[color:var(--text)] font-bold num">${(card.amount || 0).toLocaleString()}</span></div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* SCOREBOARD */}
                <div className="bg-navy-900 rounded-xl border border-[rgba(230,206,150,0.16)] p-0 shadow-panel overflow-hidden relative mb-8 max-w-4xl mx-auto">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-navy-800/40 rounded-full blur-3xl"></div>
                    <div className="p-4 border-b border-[rgba(230,206,150,0.16)] text-center relative z-10 flex flex-col md:flex-row items-center justify-between px-8">
                        <h3 className="text-white font-display font-bold uppercase text-xl tracking-[0.05em]">Game Scoreboard</h3>
                        {squaresPool.scores.gameStatus === 'in'
                            ? <Badge status="live" />
                            : <p className="text-sm text-[#9FB0CC] font-display font-bold uppercase tracking-[0.08em]">{squaresPool.scores.gameStatus === 'post' ? 'FINAL' : 'PENDING'}</p>}
                    </div>
                    {/* Simple Scoreboard Grid */}
                    <div className="p-0 overflow-x-auto">
                        <table className="w-full text-center">
                            <thead>
                                <tr className="border-b border-[rgba(230,206,150,0.16)] bg-navy-950/50">
                                    <th className="py-3 px-4 text-xs font-display font-bold text-[#9FB0CC] uppercase tracking-[0.08em] text-left">Team</th>
                                    <th className="py-3 px-4 text-xs font-display font-bold text-[#9FB0CC] uppercase tracking-[0.08em]">Q1</th>
                                    <th className="py-3 px-4 text-xs font-display font-bold text-[#9FB0CC] uppercase tracking-[0.08em]">Q2</th>
                                    <th className="py-3 px-4 text-xs font-display font-bold text-[#9FB0CC] uppercase tracking-[0.08em]">Q3</th>
                                    <th className="py-3 px-4 text-xs font-display font-bold text-[#9FB0CC] uppercase tracking-[0.08em]">Q4</th>
                                    <th className="py-3 px-4 text-xs font-display font-bold text-white uppercase tracking-[0.08em] bg-navy-800">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[rgba(230,206,150,0.12)]">
                                <tr>
                                    <td className="py-4 px-4 font-bold text-white text-left flex items-center gap-2 font-body">{awayLogo ? <img src={awayLogo} alt="" className="w-6 h-6 object-contain" /> : null} {squaresPool.awayTeam}</td>
                                    <td className="py-4 px-4 num text-[#9FB0CC]">{squaresPool.scores.q1?.away ?? '-'}</td>
                                    <td className="py-4 px-4 num text-[#9FB0CC]">{squaresPool.scores.half && squaresPool.scores.q1 ? (squaresPool.scores.half.away - squaresPool.scores.q1.away) : (squaresPool.scores.period && squaresPool.scores.period >= 2 && squaresPool.scores.q1 ? ((squaresPool.scores.current?.away ?? 0) - squaresPool.scores.q1.away) : '-')}</td>
                                    <td className="py-4 px-4 num text-[#9FB0CC]">{squaresPool.scores.q3 && squaresPool.scores.half ? (squaresPool.scores.q3.away - squaresPool.scores.half.away) : (squaresPool.scores.period && squaresPool.scores.period >= 3 && squaresPool.scores.half ? ((squaresPool.scores.current?.away ?? 0) - squaresPool.scores.half.away) : '-')}</td>
                                    <td className="py-4 px-4 num text-[#9FB0CC]">{squaresPool.scores.final && squaresPool.scores.q3 ? (squaresPool.scores.final.away - squaresPool.scores.q3.away) : (squaresPool.scores.period && squaresPool.scores.period >= 4 && squaresPool.scores.q3 ? ((squaresPool.scores.current?.away ?? 0) - squaresPool.scores.q3.away) : '-')}</td>
                                    <td className="py-4 px-4 font-display font-bold text-gold-400 text-lg bg-navy-950/50 num">{squaresPool.scores.current?.away ?? 0}</td>
                                </tr>
                                <tr>
                                    <td className="py-4 px-4 font-bold text-white text-left flex items-center gap-2 font-body">{homeLogo ? <img src={homeLogo} alt="" className="w-6 h-6 object-contain" /> : null} {squaresPool.homeTeam}</td>
                                    <td className="py-4 px-4 num text-[#9FB0CC]">{squaresPool.scores.q1?.home ?? '-'}</td>
                                    <td className="py-4 px-4 num text-[#9FB0CC]">{squaresPool.scores.half && squaresPool.scores.q1 ? (squaresPool.scores.half.home - squaresPool.scores.q1.home) : (squaresPool.scores.period && squaresPool.scores.period >= 2 && squaresPool.scores.q1 ? ((squaresPool.scores.current?.home ?? 0) - squaresPool.scores.q1.home) : '-')}</td>
                                    <td className="py-4 px-4 num text-[#9FB0CC]">{squaresPool.scores.q3 && squaresPool.scores.half ? (squaresPool.scores.q3.home - squaresPool.scores.half.home) : (squaresPool.scores.period && squaresPool.scores.period >= 3 && squaresPool.scores.half ? ((squaresPool.scores.current?.home ?? 0) - squaresPool.scores.half.home) : '-')}</td>
                                    <td className="py-4 px-4 num text-[#9FB0CC]">{squaresPool.scores.final && squaresPool.scores.q3 ? (squaresPool.scores.final.home - squaresPool.scores.q3.home) : (squaresPool.scores.period && squaresPool.scores.period >= 4 && squaresPool.scores.q3 ? ((squaresPool.scores.current?.home ?? 0) - squaresPool.scores.q3.home) : '-')}</td>
                                    <td className="py-4 px-4 font-display font-bold text-brandred-500 text-lg bg-navy-950/50 num">{squaresPool.scores.current?.home ?? 0}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Grid Component */}
            <div className="max-w-[1600px] mx-auto px-4 py-8 flex flex-col items-center">
                {/* Grid Rendering */}
                <div className="flex items-center gap-4 w-full justify-center">
                    <div className="hidden md:flex flex-col items-center gap-2">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center border-2 border-gold-500 shadow-[0_0_20px_rgba(217,188,128,0.3)] bg-white p-1">
                            {awayLogo ? <img src={awayLogo} alt="" className="w-full h-full object-contain" /> : <span className="text-gold-600 font-display font-bold text-xl">{squaresPool.awayTeam.substring(0, 2).toUpperCase()}</span>}
                        </div>
                    </div>
                    <div className="flex-1 overflow-x-auto">
                        <Grid
                            gameState={squaresPool}
                            onClaimSquares={handleClaimSquares}
                            winners={winners}
                            highlightHomeDigit={getLastDigit(squaresPool.scores.current?.home ?? 0)}
                            highlightAwayDigit={getLastDigit(squaresPool.scores.current?.away ?? 0)}
                            currentUser={user}
                            onLogin={() => handleLocalAuth('login')}
                            onCreateClaimCode={(k) => dbService.createClaimCode(squaresPool.id, k)}
                            onClaimByCode={(c) => dbService.claimByCode(c)}
                            onJoinWaitlist={handleJoinWaitlist}
                            onConfirmPayment={(ids) => dbService.confirmPayment(squaresPool.id, ids)}
                        />
                    </div>
                    <div className="hidden md:flex flex-col items-center gap-2">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center border-2 border-brandred-500 shadow-[0_0_20px_rgba(196,52,46,0.3)] bg-white p-1">
                            {homeLogo ? <img src={homeLogo} alt="" className="w-full h-full object-contain" /> : <span className="text-brandred-500 font-display font-bold text-xl">{squaresPool.homeTeam.substring(0, 2).toUpperCase()}</span>}
                        </div>
                    </div>
                </div>
            </div>

            {/* What If Scenarios */}
            <div className="max-w-[1600px] mx-auto px-4 grid grid-cols-1 xl:grid-cols-2 gap-8 items-start mb-8">
                <div className="border border-gold-500/30 rounded-xl p-0 overflow-hidden">
                    <div className="bg-page p-4 border-b border-line flex items-center gap-2"><h3 className="text-gold-600 font-display font-bold uppercase tracking-[0.05em] text-sm">If {squaresPool.awayTeam} scores next...</h3></div>
                    <div className="bg-card p-4 space-y-4">{awayPredictions.map(pred => <div key={pred.points} className="flex justify-between items-center border-b border-line/50 pb-2"><div><span className="block text-[color:var(--text)] font-bold text-sm num">+{pred.points}</span><span className="text-[10px] text-faint num">Digit: {pred.newDigit}</span></div><span className="text-[color:var(--text)] font-bold text-sm font-body">{pred.owner}</span></div>)}</div>
                </div>
                <div className="border border-gold-500/30 rounded-xl p-0 overflow-hidden">
                    <div className="bg-page p-4 border-b border-line flex items-center gap-2"><h3 className="text-gold-600 font-display font-bold uppercase tracking-[0.05em] text-sm">If {squaresPool.homeTeam} scores next...</h3></div>
                    <div className="bg-card p-4 space-y-4">{homePredictions.map(pred => <div key={pred.points} className="flex justify-between items-center border-b border-line/50 pb-2"><div><span className="block text-[color:var(--text)] font-bold text-sm num">+{pred.points}</span><span className="text-[10px] text-faint num">Digit: {pred.newDigit}</span></div><span className="text-[color:var(--text)] font-bold text-sm font-body">{pred.owner}</span></div>)}</div>
                </div>
            </div>

            {/* Quarter Winner Cards */}
            <div className="max-w-[1600px] mx-auto px-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
                {quarterlyPayouts.map((card) => {
                    const homeDigit = getLastDigit(card.home);
                    const awayDigit = getLastDigit(card.away);

                    return (
                        <div key={card.period} className="bg-card border border-line rounded-xl p-6 flex flex-col items-center text-center shadow-card relative overflow-hidden group">
                            {/* Top Bar Color Indicator (Optional) */}
                            {card.isLocked && <div className="absolute top-0 left-0 right-0 h-1 bg-[#0F7B4A]"></div>}

                            <h3 className="text-faint font-display font-bold uppercase tracking-[0.16em] text-xs mb-4 mt-2">{card.label}</h3>

                            <div className="text-4xl font-display font-bold text-[color:var(--text)] mb-6 flex gap-4 items-center num">
                                <span>{card.home}</span>
                                <span className="text-faint text-2xl">-</span>
                                <span>{card.away}</span>
                            </div>

                            <div className="bg-page/50 border border-line rounded-lg p-3 w-full mb-4 grid grid-cols-2 gap-4">
                                <div className="flex flex-col items-center border-r border-line border-dashed pr-2">
                                    <span className="text-[10px] font-display font-bold text-brandred-500 uppercase tracking-[0.06em] mb-1">{squaresPool.homeTeam ? "Home Digit" : "Row Digit"}</span>
                                    <span className="text-2xl font-display font-bold text-[color:var(--text)] num">{homeDigit}</span>
                                </div>
                                <div className="flex flex-col items-center pl-2">
                                    <span className="text-[10px] font-display font-bold text-gold-600 uppercase tracking-[0.06em] mb-1">{squaresPool.awayTeam ? "Away Digit" : "Col Digit"}</span>
                                    <span className="text-2xl font-display font-bold text-[color:var(--text)] num">{awayDigit}</span>
                                </div>
                            </div>

                            <div className="text-faint text-xs mb-6 num">
                                This Quarter: {card.qPointsHome} - {card.qPointsAway}
                            </div>

                            <div className="mt-auto flex flex-col items-center w-full">
                                <span className="text-[10px] font-display font-bold text-faint uppercase tracking-[0.16em] mb-2">In The Money:</span>
                                <div className="text-lg font-bold text-[color:var(--text)] mb-1 truncate w-full px-2 font-body" title={card.winnerName}>{card.winnerName}</div>
                                <div className="text-3xl font-display font-bold text-gold-600 tracking-tight num">${card.amount}</div>
                            </div>

                            <div className="mt-6">
                                {card.isLocked ? <Lock size={18} className="text-[#0F7B4A]/40" /> : <Lock size={18} className="text-faint/50" />}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Score Change History (Only for Every Score Pays) */}
            {squaresPool.ruleVariations.scoreChangePayout && (
                <div className="max-w-[1600px] mx-auto px-4 mb-8">
                    <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card">
                        <div className="p-4 border-b border-line bg-page/50 flex items-center justify-between">
                            <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2"><Zap size={18} className="text-[#5B2A86] dark:text-[#8655B5]" /> Score Change History</h3>
                            <span className="text-xs font-display font-bold text-faint uppercase tracking-[0.08em]"><span className="num">{winners.filter(w => w.period === 'Event').length}</span> Events</span>
                        </div>
                        <div className="max-h-[400px] overflow-y-auto">
                            <table className="w-full">
                                <thead className="bg-page sticky top-0 z-10">
                                    <tr>
                                        <th className="py-3 px-4 text-left text-xs font-display font-bold text-faint uppercase tracking-[0.08em]">Event</th>
                                        <th className="py-3 px-4 text-center text-xs font-display font-bold text-faint uppercase tracking-[0.08em]">Digits</th>
                                        <th className="py-3 px-4 text-right text-xs font-display font-bold text-faint uppercase tracking-[0.08em]">Winner</th>
                                        <th className="py-3 px-4 text-right text-xs font-display font-bold text-faint uppercase tracking-[0.08em]">Prize</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {winners.filter(w => w.period === 'Event').length === 0 ? (
                                        <tr><td colSpan={4} className="py-8 text-center text-faint italic font-body">No score changes yet.</td></tr>
                                    ) : (
                                        winners.filter(w => w.period === 'Event').map((win, i) => (
                                            <tr key={i} className="hover:bg-page/30 transition-colors duration-150">
                                                <td className="py-3 px-4 text-muted text-sm font-body">{win.description || 'Score Update'}</td>
                                                <td className="py-3 px-4 text-center"><span className="bg-page px-2 py-1 rounded text-xs num text-[color:var(--text)] border border-line">{win.homeDigit}-{win.awayDigit}</span></td>
                                                <td className="py-3 px-4 text-right font-bold text-gold-600 font-body">{win.owner}</td>
                                                <td className="py-3 px-4 text-right num text-[color:var(--text)]">${win.amount}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* AI Commissioner */}
            <div className="max-w-[1600px] mx-auto px-4 mb-20">
                <AICommissioner poolId={squaresPool.id} userId={user?.id} userName={user?.name} />
                <div className="flex justify-center mt-8">
                    <p className="text-faint text-xs italic font-body">All pool activities are automated and verified.</p>
                </div>
            </div>

            <AuthModal isOpen={showAuthModalLocal} onClose={() => setShowAuthModalLocal(false)} initialMode={authModeLocal} />
            {showAudit && <AuditLog poolId={squaresPool.id} onClose={() => setShowAudit(false)} />}
            <Footer />

            {/* Rule Modal */}
            {showRulesModal && (
                <OverlayRoot id="pool-rules-modal" label="Pool rules and payouts" onEscape={() => setShowRulesModal(false)} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-card border border-line rounded-xl max-w-2xl w-full relative shadow-card overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-line bg-page flex justify-between items-center shrink-0">
                            <h3 className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                <HelpCircle className="text-gold-500" /> Pool Rules & Payouts
                            </h3>
                            <button onClick={() => setShowRulesModal(false)} className="text-muted hover:text-[color:var(--text)] transition-colors duration-150 bg-page hover:bg-surface p-2 rounded-lg border border-line">
                                <span className="sr-only">Close</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-8">
                            {/* General Stats */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-page p-3 rounded-lg border border-line text-center">
                                    <div className="text-[10px] text-faint uppercase font-display font-bold tracking-[0.08em] mb-1">Cost Per Square</div>
                                    <div className="text-xl font-display font-bold text-[color:var(--text)] num">${squaresPool.costPerSquare}</div>
                                </div>
                                <div className="bg-page p-3 rounded-lg border border-line text-center">
                                    <div className="text-[10px] text-faint uppercase font-display font-bold tracking-[0.08em] mb-1">Max Per Player</div>
                                    <div className="text-xl font-display font-bold text-[color:var(--text)] num">{squaresPool.maxSquaresPerPlayer || '∞'}</div>
                                </div>
                                <div className="bg-page p-3 rounded-lg border border-line text-center">
                                    <div className="text-[10px] text-faint uppercase font-display font-bold tracking-[0.08em] mb-1">Number Sets</div>
                                    <div className="text-xl font-display font-bold text-[color:var(--text)] num">{squaresPool.numberSets}</div>
                                </div>
                                <div className="bg-page p-3 rounded-lg border border-line text-center">
                                    <div className="text-[10px] text-faint uppercase font-display font-bold tracking-[0.08em] mb-1">Winners</div>
                                    <div className="text-xl font-display font-bold text-[color:var(--text)] num">{Object.keys(squaresPool.payouts).length + (squaresPool.ruleVariations.reverseWinners ? Object.keys(squaresPool.payouts).length : 0)}</div>
                                </div>
                            </div>

                            {/* Payout Structure */}
                            <div>
                                <h4 className="text-muted font-display font-bold uppercase text-xs tracking-[0.08em] mb-3 flex items-center gap-2">
                                    <Zap size={14} /> Payout Breakdown
                                </h4>
                                <div className="bg-page rounded-lg overflow-hidden border border-line">
                                    <table className="w-full text-sm">
                                        <thead className="bg-card text-faint font-display font-bold uppercase text-xs tracking-[0.08em]">
                                            <tr>
                                                <th className="py-2 px-4 text-left">Period</th>
                                                <th className="py-2 px-4 text-right">Percentage</th>
                                                <th className="py-2 px-4 text-right">Est. Prize</th>
                                                {squaresPool.ruleVariations.reverseWinners && <th className="py-2 px-4 text-right text-gold-600">Reverse</th>}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-line text-[color:var(--text)]">
                                            {[
                                                { label: '1st Quarter', pct: squaresPool.payouts.q1 },
                                                { label: 'Halftime', pct: squaresPool.payouts.half },
                                                { label: '3rd Quarter', pct: squaresPool.payouts.q3 },
                                                { label: 'Final Score', pct: squaresPool.payouts.final },
                                            ].map((r, i) => {
                                                // Calculate raw pot based on FULL grid (projected)
                                                // Adjust for charity
                                                const charityCut = squaresPool.charity?.enabled ? (squaresPool.charity.percentage / 100) : 0;
                                                const totalPot = 100 * squaresPool.costPerSquare;
                                                const netPot = totalPot * (1 - charityCut);
                                                const prize = Math.floor(netPot * (r.pct / 100));
                                                // If reverse winners, prize is split? Usually reverse is separate calc or split.
                                                // Assumption: If reverse is on, standard prize is halved? Or defined separately?
                                                // Implementation Plan: Reverse usually splits the pot for that quarter.
                                                // We'll show the base calculation.
                                                return (
                                                    <tr key={i}>
                                                        <td className="py-3 px-4 font-bold text-[color:var(--text)] font-body">{r.label}</td>
                                                        <td className="py-3 px-4 text-right num text-muted">{r.pct}%</td>
                                                        <td className="py-3 px-4 text-right num text-gold-600">${prize.toLocaleString()}*</td>
                                                        {squaresPool.ruleVariations.reverseWinners && <td className="py-3 px-4 text-right text-gold-600 font-display font-bold uppercase text-xs tracking-[0.06em]">Active</td>}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="text-[10px] text-faint mt-2 italic font-body">* Estimated prizes assuming all 100 squares are sold. Actual prizes depend on total sales.</p>
                            </div>

                            {/* Special Rules */}
                            <div>
                                <h4 className="text-muted font-display font-bold uppercase text-xs tracking-[0.08em] mb-3 flex items-center gap-2">
                                    <Shield size={14} /> Active Rules
                                </h4>
                                <div className="space-y-3">
                                    {squaresPool.numberSets === 4 ? (
                                        <div className="flex gap-3">
                                            <div className="shrink-0 w-1 bg-navy-700 rounded-full"></div>
                                            <div>
                                                <p className="font-display font-bold uppercase text-navy-700 dark:text-[#9FB0CC] text-sm">4 Number Sets</p>
                                                <p className="text-muted text-xs font-body">New numbers are generated for each quarter (Q1, Half, Q3, Final). This increases randomness and fairness.</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex gap-3">
                                            <div className="shrink-0 w-1 bg-line rounded-full"></div>
                                            <div>
                                                <p className="font-display font-bold uppercase text-muted text-sm">Standard Numbers</p>
                                                <p className="text-faint text-xs font-body">The same numbers (row/column) apply for the entire game.</p>
                                            </div>
                                        </div>
                                    )}

                                    {squaresPool.ruleVariations.quarterlyRollover && (
                                        <div className="flex gap-3">
                                            <div className="shrink-0 w-1 bg-gold-500 rounded-full"></div>
                                            <div>
                                                <p className="font-display font-bold uppercase text-gold-600 text-sm">Quarterly Rollover</p>
                                                <p className="text-muted text-xs font-body">If a winning square is unsold, the prize money rolls over and is added to the NEXT quarter's pot.</p>
                                            </div>
                                        </div>
                                    )}

                                    {squaresPool.ruleVariations.reverseWinners && (
                                        <div className="flex gap-3">
                                            <div className="shrink-0 w-1 bg-gold-500 rounded-full"></div>
                                            <div>
                                                <p className="font-display font-bold uppercase text-gold-600 text-sm">Reverse Winners</p>
                                                <p className="text-muted text-xs font-body">The square matching the REVERSE of the score digits also wins (e.g., if ending in 3-7, then 7-3 also wins). The quarter's pot is split.</p>
                                            </div>
                                        </div>
                                    )}

                                    {squaresPool.ruleVariations.scoreChangePayout && (
                                        <div className="flex gap-3">
                                            <div className="shrink-0 w-1 bg-[#5B2A86] rounded-full"></div>
                                            <div>
                                                <p className="font-display font-bold uppercase text-[#5B2A86] dark:text-[#8655B5] text-sm">Every Score Pays</p>
                                                <p className="text-muted text-xs font-body">Payouts are awarded for EVERY score change (Touchdown, Field Goal, Safety, etc.), not just end of quarters.</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Charity Info */}
                            {squaresPool.charity?.enabled && (
                                <div className="bg-gold-500/10 border border-gold-500/20 p-4 rounded-xl flex gap-4 items-start">
                                    <div className="bg-gold-500/20 p-2 rounded-lg shrink-0"><Heart className="text-gold-600" size={24} /></div>
                                    <div>
                                        <h4 className="text-gold-600 font-display font-bold text-sm uppercase tracking-[0.05em]">Fundraiser Pool</h4>
                                        <p className="text-[color:var(--text)] text-sm mb-1 font-body"><span className="font-bold num">{squaresPool.charity.percentage}%</span> of all proceeds go directly to <span className="font-bold">{squaresPool.charity.name}</span>.</p>
                                        {squaresPool.charity.url && <a href={squaresPool.charity.url} target="_blank" rel="noreferrer" className="text-xs text-gold-600 hover:text-gold-500 underline font-body">Learn more about this cause</a>}
                                    </div>
                                </div>
                            )}

                        </div>

                        <div className="p-4 border-t border-line bg-page text-center">
                            <p className="text-[10px] text-faint font-body">
                                This pool is hosted on MarchMelee. Prize distribution is managed by the pool host: <span className="text-muted">{squaresPool.contactEmail}</span>
                            </p>
                        </div>
                    </div>
                </OverlayRoot>
            )}
        </div>
    );
};

