import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { User, Pool, BillingConfig } from '../types';
import { DEFAULT_TRIAL_DAYS, DEFAULT_FORMAT_TIER_MAP, normalizeLegacyPackage } from '@shared/schemas/billingConfig';
import { Header } from './Header';
import { Footer } from './Footer';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { dbService } from '../services/dbService';
import {
    CheckCircle, Sparkles, Zap,
    ArrowRight, LayoutGrid, Users,
    ChevronRight, HelpCircle as InfoIcon, X
} from 'lucide-react';
import { BillingInvoiceCard } from './billing/BillingInvoiceCard';
import { UpgradeInfoPopover } from './pricing/UpgradeInfoPopover';
import { EstimateSummaryCard } from './pricing/EstimateSummaryCard';
import { canAccessPoolCreation } from '../utils/auth';
import { setPostAuthIntent } from '../utils/postAuthIntent';
import { addonSeed } from './billing/addonSeed';
import { PaymentSuccessBanner } from './billing/PaymentSuccessBanner';
import { upgradeablePools, isUpgradeableStatus, canCheckoutPool, upgradeStatusLabel } from './billing/upgradeablePools';

interface PricingPageProps {
    user?: User | null;
    isManager?: boolean;
    onLogin: () => void;
    onSignup: () => void;
    onLogout?: () => void;
    onCreatePool?: () => void;
    isLoggedIn: boolean;
}

const DEFAULT_BILLING_CONFIG: BillingConfig = {
    freePlayerThreshold: 10,
    gracePeriodDays: 7,
    pricing: {
        season: [
            { min: 11, max: 25, price: 29 },
            { min: 26, max: 50, price: 59 },
            { min: 51, max: 100, price: 99 },
            { min: 101, max: 9999, price: 149 }
        ],
        bracket: [
            { min: 11, max: 25, price: 19 },
            { min: 26, max: 50, price: 39 },
            { min: 51, max: 100, price: 69 },
            { min: 101, max: 9999, price: 99 }
        ],
        squares: [
            { min: 11, max: 25, price: 9 },
            { min: 26, max: 50, price: 19 },
            { min: 51, max: 100, price: 29 },
            { min: 101, max: 9999, price: 39 }
        ],
        props: [
            { min: 11, max: 25, price: 9 },
            { min: 26, max: 50, price: 19 },
            { min: 51, max: 100, price: 29 },
            { min: 101, max: 9999, price: 39 }
        ]
    },
    features: {
        aiCommissioner: { isPremium: true, addonPrice: 19 },
        smsNotifications: { isPremium: true, addonPrice: 9 },
        whatIfSimulator: { isPremium: true, addonPrice: 9 },
        customBranding: { isPremium: true, addonPrice: 29 }
    },
    trialDays: DEFAULT_TRIAL_DAYS,
    formatTierMap: DEFAULT_FORMAT_TIER_MAP,
    packagesList: [],
    packages: {
        buy_3: 49.00,
        unlimited_1yr: 129.00
    }
};

/* Hero band stays navy chrome (always dark); the pricing content below flips light/dark. */

const contentCard = 'bg-card border border-line';
const contentLabel = 'block font-display font-bold text-[10px] text-faint uppercase tracking-[0.16em]';

export const PricingPage: React.FC<PricingPageProps> = ({
    user,
    isManager = false,
    onLogin,
    onLogout,
    onCreatePool
}) => {
    const navigate = useNavigate();
    const canCreate = canAccessPoolCreation(user);
    const [searchParams] = useSearchParams();
    const targetPoolId = searchParams.get('poolId');

    // State Variables
    const [config, setConfig] = useState<BillingConfig>(DEFAULT_BILLING_CONFIG);
    const [userPools, setUserPools] = useState<Pool[]>([]);
    const [selectedPoolId, setSelectedPoolId] = useState<string | null>(targetPoolId);
    const [selectedPoolData, setSelectedPoolData] = useState<Pool | null>(null);

    // Calculator Inputs State
    const [calcPoolType, setCalcPoolType] = useState<string>('BRACKET');
    const [calcPlayers, setCalcPlayers] = useState<number>(30);
    const [calcAi, setCalcAi] = useState<boolean>(false);
    const [calcSms, setCalcSms] = useState<boolean>(false);
    const [calcSim, setCalcSim] = useState<boolean>(false);
    const [calcBranding, setCalcBranding] = useState<boolean>(false);

    // Explicit visitor-state machine — all render branching below keys off this.
    const visitorState: 'anon' | 'noPools' | 'hasUpgradeablePools' = !user
        ? 'anon'
        : userPools.length > 0
            ? 'hasUpgradeablePools'
            : 'noPools';

    /**
     * Render the real checkout, not the estimator. True when the user has any
     * upgradeable pool, OR when a ?poolId= deep link resolved to one they can
     * pay for (codex r2 [P1] on T3): the free / locked CTAs now carry a pool id,
     * so the page must be able to sell that pool even if the list is still
     * loading or the pool is not in it.
     */
    const selectedIsPayable =
        !!selectedPoolData &&
        canCheckoutPool(selectedPoolData as never, user?.id) &&
        isUpgradeableStatus(selectedPoolData.billing?.status);

    /**
     * G2 — the create CTAs used to `navigate('/create-pool')` for everyone,
     * including logged-out visitors. That route requires `user &&`
     * (`App.tsx`), so an anonymous click on a button captioned
     * "Build Your Pool — Free to Start / no account needed" was bounced to `/`
     * with no auth modal and no message at all. `canAccessPoolCreation` never
     * checks login, so nothing else caught it either.
     *
     * Now: open the auth modal, remember the intent, and continue to the wizard
     * as soon as the user exists.
     */
    const startCreate = () => {
        if (!canCreate) return;
        if (!user) {
            // The continuation is App's, not this page's: a brand-new account is
            // navigated to /participant on sign-up, which unmounts this page
            // before any effect here could run (codex r2 [P1]).
            setPostAuthIntent('/create-pool');
            onLogin();
            return;
        }
        navigate('/create-pool');
    };

    // Optional config-driven hero promo (shared BillingConfig schema field).
    const heroPromo = config.heroPromo;
    const heroPromoEndsAt = heroPromo?.endsAt != null ? new Date(heroPromo.endsAt).getTime() : Number.NaN;
    const showHeroPromo = Boolean(heroPromo?.code) && Number.isFinite(heroPromoEndsAt) && heroPromoEndsAt > Date.now();

    // Fetch monetization configuration
    useEffect(() => {
        const docRef = doc(db, 'settings', 'billing_config');
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setConfig(docSnap.data() as BillingConfig);
            }
        }, (err) => {
            console.warn('[PricingPage] Using default pricing config:', err);
        });
        return () => unsubscribe();
    }, []);

    // Fetch the user's UPGRADEABLE pools — trial, grace, free AND locked (G3).
    // Listing only trial/grace is what dead-ended the free-plan 10-player wall,
    // which is the moment both the lock banner and the lock email link here for.
    useEffect(() => {
        if (!user?.id) return;
        const unsubscribe = dbService.subscribeToPools((poolsList) => {
            setUserPools(upgradeablePools(poolsList, user.id));
        }, (err) => {
            console.error('[PricingPage] Failed subscribing to user pools:', err);
        }, user.id);
        return () => unsubscribe();
    }, [user?.id]);

    // Keep selection in sync when the ?poolId= deep link changes after mount.
    useEffect(() => {
        if (targetPoolId) setSelectedPoolId(targetPoolId);
    }, [targetPoolId]);

    // Handle Selected Pool monitoring
    useEffect(() => {
        if (!selectedPoolId) {
            setSelectedPoolData(null);
            return;
        }

        const unsubscribe = dbService.subscribeToPool(selectedPoolId, (pool) => {
            if (pool) {
                setSelectedPoolData(pool);
                // Synchronize calculator inputs to match selected pool for convenience
                setCalcPoolType(pool.type);
                setCalcPlayers((pool as any).estimatedPlayers || ((pool as any).settings?.maxEntriesTotal > 0 ? (pool as any).settings.maxEntriesTotal : 30));
                // ⚠️ `pool.addons` FIRST, `billing.featuresUnlocked` only as the
                // legacy fallback (PLAN-WIZARD-BUYFLOW-FIXES T3). `addons` is the
                // commissioner's own wizard selection, stored top-level by
                // `readLaunchFields`. `featuresUnlocked` is what the pool has
                // ACTIVE — and a trial launch stamps it all-false
                // (`poolCreation.LOCKED_FEATURES`), so seeding from it wiped
                // every add-on the commissioner had picked and the upgrade page
                // opened with nothing selected. Kevin's repro exactly: a $147
                // quote in the wizard, an empty checkout on /pricing.
                const seed = addonSeed(pool);
                setCalcAi(seed.aiCommissioner);
                setCalcSms(seed.smsNotifications);
                setCalcSim(seed.whatIfSimulator);
                setCalcBranding(seed.customBranding);
            }
        }, (err) => {
            console.error('[PricingPage] Error fetching pool details:', err);
        });
        return () => unsubscribe();
    }, [selectedPoolId]);

    return (
        <div className="min-h-screen text-[color:var(--text)] font-body bg-page flex flex-col">
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            {/* G5 (codex r1 [P1]) — bundle purchases come back HERE, to
                /pricing?payment=success, not to a pool route. Same banner, the
                bundle message: there is no pool status to wait on. */}
            <PaymentSuccessBanner purchase="bundle" />

            {/* Hero Header Section — navy chrome (always dark) */}
            <section className="relative overflow-hidden pt-24 pb-20 border-b border-[rgba(230,206,150,0.16)] text-white bg-gradient-to-b from-navy-950 via-navy-950 to-navy-900">
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-10 right-0 w-[550px] h-[550px] rounded-full blur-[140px] bg-navy-600/25 opacity-70" />
                    <div className="absolute bottom-0 left-0 w-[550px] h-[550px] rounded-full blur-[140px] bg-gold-500/10 opacity-50" />
                </div>

                <div className="max-w-5xl mx-auto px-6 relative z-10 text-center space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
                    <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 shadow-md bg-gold-500/10 border border-gold-500/25 backdrop-blur-md">
                        <Sparkles size={14} className="text-gold-400 animate-spin-slow" />
                        <span className="font-display font-bold text-[10px] uppercase tracking-[0.16em] text-gold-400">Monetization Dashboard V3</span>
                    </div>

                    <h1 className="font-display font-extrabold uppercase text-4xl md:text-6xl text-white tracking-tight leading-[0.9]">
                        Flexible Pricing for <br />
                        <span className="text-gold-400">Pool Commissioners</span>
                    </h1>

                    <p className="text-base md:text-lg max-w-2xl mx-auto font-body text-[#9FB0CC] leading-relaxed">
                        Start every pool with a <strong className="text-white">14-day free trial</strong>. Upgrade anytime to unlock premium tools, live scoring syncs, AI updates, and SMS alerts.
                    </p>

                    {showHeroPromo && heroPromo && (
                        <div className="mt-6 inline-flex flex-col sm:flex-row items-center gap-3.5 px-6 py-4 rounded-3xl border border-gold-500/25 bg-navy-900/60 backdrop-blur-md shadow-panel relative overflow-hidden max-w-3xl mx-auto">
                            {/* Inner soft glow */}
                            <div className="absolute inset-0 bg-gradient-to-r from-gold-500/5 via-gold-400/5 to-gold-500/5 opacity-50 pointer-events-none" />

                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gold-500/10 border border-gold-400/35 font-display font-bold text-[10px] uppercase tracking-[0.08em] text-gold-300 shadow-sm shrink-0">
                                <Sparkles size={12} className="animate-live-pulse" /> {heroPromo.discountLabel || 'Limited-Time Offer'}
                            </span>
                            <span className="text-xs sm:text-sm text-[#EDF1F8] font-body leading-relaxed text-left">
                                Limited-time promo — use code{' '}
                                <code className="px-2 py-0.5 rounded-md bg-navy-950 border border-gold-400/40 text-gold-300 font-mono font-black text-xs shadow-inner">
                                    {heroPromo.code}
                                </code>{' '}
                                at checkout.
                            </span>
                        </div>
                    )}

                    {/* Anonymous visitors get a direct, login-free path into the wizard. */}
                    {visitorState === 'anon' && (
                        <div className="pt-2 space-y-3">
                            <button
                                onClick={startCreate}
                                disabled={!canCreate}
                                title={canCreate ? 'Start building your pool — no account needed' : 'Pool creation is coming soon'}
                                className="inline-flex items-center justify-center gap-2 bg-brandred-600 hover:bg-brandred-500 text-white font-display font-bold uppercase tracking-[0.05em] py-4 px-8 rounded-2xl text-sm transition-all duration-150 hover:-translate-y-px shadow-red-cta group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                            >
                                {canCreate ? (
                                    <>
                                        Build Your Pool — Free to Start
                                        <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                                    </>
                                ) : (
                                    'Pool Creation Coming Soon'
                                )}
                            </button>
                            <p className="text-xs text-[#9FB0CC] font-body">
                                No account needed to start building — pools of <span className="num">{config.freePlayerThreshold}</span> players or fewer host free.
                            </p>
                        </div>
                    )}
                </div>
            </section>

            {/* Main Interactive Bento Layout */}
            <main className="flex-grow max-w-7xl mx-auto px-4 md:px-8 py-16 w-full">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

                    {/* LEFT COLUMN: Pricing Calculator Settings & User Pools */}
                    <div className="lg:col-span-7 space-y-8">

                        {/* Pool Upgrade Select (If Logged In & Has Trial Pools) */}
                        {visitorState === 'hasUpgradeablePools' && (
                            <div className="bg-card border border-gold-500/25 rounded-3xl p-6 space-y-4 shadow-panel">
                                <h3 className="font-display font-bold uppercase text-lg text-[color:var(--text)] flex items-center gap-2">
                                    <Sparkles className="text-gold-600 dark:text-gold-400" size={20} />
                                    Your Pools — Ready to Upgrade
                                </h3>
                                <p className="text-xs font-body text-muted">
                                    Select a pool below to complete hosting payment and activate it permanently. Free-plan pools that have hit the player limit are listed here too.
                                </p>
                                <div className="grid grid-cols-1 gap-2.5">
                                    {userPools.map((pool) => (
                                        <button
                                            key={pool.id}
                                            onClick={() => setSelectedPoolId(pool.id)}
                                            className={`w-full flex items-center justify-between p-4 rounded-xl border text-left transition-all ${
                                                selectedPoolId === pool.id
                                                    ? 'bg-gold-500/10 border-gold-500 shadow-lg'
                                                    : 'bg-surface border-line hover:border-gold-500/40'
                                            }`}
                                        >
                                            <div className="space-y-1">
                                                <span className="text-sm font-display font-bold uppercase text-[color:var(--text)] block">{pool.name}</span>
                                                <span className="text-xs text-faint font-mono capitalize">
                                                    Format: {pool.type.toLowerCase().replace('_', ' ')}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="bg-gold-500/10 border border-gold-500/25 text-gold-600 dark:text-gold-400 font-display font-bold text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded-full">
                                                    {upgradeStatusLabel(pool.billing?.status)}
                                                </span>
                                                <ChevronRight size={16} className="text-muted" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                {selectedPoolId && (
                                    <button
                                        onClick={() => setSelectedPoolId(null)}
                                        className="inline-flex items-center gap-1 text-xs font-body text-faint hover:text-[color:var(--text)] transition-colors"
                                    >
                                        <X size={12} /> Clear selection and show calculator
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Interactive Billing Calculator Panel — hidden when a PAYABLE pool is selected (that pool's checkout on the right is authoritative; the estimator is for exploring pricing before you pick a pool). A deep link to a pool the visitor cannot pay for keeps the estimator, since the right column stays estimate-only too. */}
                        {!selectedIsPayable && (
                        <div className={`${contentCard} p-6 md:p-8 rounded-3xl space-y-6 shadow-panel backdrop-blur-md hover:border-gold-500/40 transition-all duration-300 relative overflow-hidden`}>
                            {/* Inner background blob */}
                            <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-gold-500/5 blur-2xl pointer-events-none" />

                            <div className="space-y-2 relative z-10">
                                <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] flex items-center gap-2">
                                    <LayoutGrid size={22} className="text-gold-600 dark:text-gold-400" />
                                    Interactive Price Estimator
                                </h3>
                                <p className="text-xs font-body text-muted leading-relaxed">
                                    Estimate your custom hosting plan based on format, estimated participant size, and premium additions.
                                </p>
                                {visitorState !== 'hasUpgradeablePools' && !selectedIsPayable && (
                                    <p className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-gold-600 dark:text-gold-400">
                                        Estimate only — launch a pool to purchase
                                    </p>
                                )}
                            </div>

                            <div className="space-y-6 relative z-10">
                                {/* 1. Format Select */}
                                <div>
                                    <label className={`${contentLabel} mb-3`}>
                                        Select Pool Format
                                    </label>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                        {[
                                            { k: 'BRACKET', label: 'Bracket Tree' },
                                            { k: 'SQUARES', label: 'Gameday Grid' },
                                            { k: 'PROPS', label: 'Props Sheet' },
                                            { k: 'NFL_PICKEM', label: 'Pick\'em' },
                                            { k: 'NFL_SURVIVOR', label: 'Survivor' },
                                            { k: 'NFL_MARGIN', label: 'Margin' }
                                        ].map(f => (
                                            <button
                                                key={f.k}
                                                onClick={() => {
                                                    setCalcPoolType(f.k);
                                                    if (f.k === 'SQUARES') setCalcPlayers(100);
                                                    // What-If Simulator is a Bracket-only add-on (matches the checkout gating); clear it when switching to another format.
                                                    if (f.k.toUpperCase() !== 'BRACKET') setCalcSim(false);
                                                }}
                                                className={`py-3.5 px-3 rounded-2xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all border ${
                                                    calcPoolType === f.k
                                                        ? 'bg-gold-500/15 text-[color:var(--text)] border-gold-500 shadow-lg shadow-gold-500/10'
                                                        : 'bg-surface text-muted border-line hover:border-gold-500/30 hover:text-[color:var(--text)]'
                                                }`}
                                            >
                                                {f.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* 2. Player Input Slider (if not Squares which is locked at 100) */}
                                {calcPoolType !== 'SQUARES' && (
                                    <div className="space-y-4 bg-surface p-5 rounded-2xl border border-line">
                                        <div className="flex justify-between items-center text-xs font-display font-bold uppercase text-muted">
                                            <span className="tracking-[0.16em] text-[10px]">Estimated Participants</span>
                                            <span className="text-gold-600 dark:text-gold-400 text-sm font-mono font-black bg-gold-500/10 px-3 py-1 rounded-full border border-gold-500/25 num">{calcPlayers} Players</span>
                                        </div>
                                        <div className="flex gap-4 items-center">
                                            <input
                                                type="range"
                                                min="1"
                                                max="150"
                                                value={calcPlayers}
                                                onChange={(e) => setCalcPlayers(Number(e.target.value))}
                                                className="flex-grow h-2 rounded-lg appearance-none cursor-pointer bg-line accent-gold-600 focus:outline-none"
                                            />
                                            <input
                                                type="number"
                                                value={calcPlayers}
                                                min={1}
                                                onChange={(e) => setCalcPlayers(Math.max(1, Number(e.target.value) || 1))}
                                                className="w-16 bg-card border border-line rounded-xl px-2 py-2 text-center text-[color:var(--text)] font-bold outline-none font-mono num focus:border-gold-500/50 transition-colors"
                                            />
                                        </div>
                                        {calcPlayers <= config.freePlayerThreshold && (
                                            <div className="p-3.5 bg-[#0F7B4A]/15 border border-[#0F7B4A]/40 text-emerald-600 dark:text-emerald-400 text-xs rounded-xl flex items-center gap-2.5 animate-in fade-in duration-300">
                                                <Sparkles size={14} className="animate-live-pulse" />
                                                <span>Under <span className="num">{config.freePlayerThreshold}</span> players? This pool qualifies for the <strong className="text-[color:var(--text)]">Free Tier</strong>!</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 3. Feature Add-ons selection */}
                                <div className="space-y-3">
                                    <label className={contentLabel}>
                                        Premium Upgrades (Optional)
                                    </label>
                                    <div className="space-y-2.5">
                                        {config.features.aiCommissioner.isPremium && (
                                            <label className={`flex items-center justify-between cursor-pointer p-4 bg-surface border rounded-2xl hover:border-gold-500/30 hover:bg-card transition-all duration-300 ${
                                                calcAi ? 'border-gold-500 bg-gradient-to-r from-gold-500/5 to-transparent' : 'border-line'
                                            }`}>
                                                <div className="flex gap-3 items-center">
                                                    <div className={`p-2.5 rounded-xl bg-gold-500/10 text-gold-600 dark:text-gold-400 border border-gold-500/25`}>
                                                        <Zap size={16} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-display font-bold uppercase text-[color:var(--text)] block flex items-center gap-1">
                                                            AI Commissioner Newsletter
                                                            <UpgradeInfoPopover
                                                                title="AI commissioner"
                                                                description="Generates weekly recaps, round-by-round highlights, and humorous trash-talking articles automatically. Uses state-of-the-art Gemini AI tailored exactly to your pool's rules and active standings."
                                                            />
                                                        </span>
                                                        <span className="text-xs font-body text-muted">Auto-generate trash-talk posts & round recaps (+<span className="num">${config.features.aiCommissioner.addonPrice}</span>)</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={calcAi}
                                                    onChange={(e) => setCalcAi(e.target.checked)}
                                                    className="w-5 h-5 rounded border-line bg-surface text-gold-500 focus:ring-gold-500 cursor-pointer"
                                                />
                                            </label>
                                        )}

                                        {config.features.smsNotifications?.isPremium && (
                                            <label className={`flex items-center justify-between cursor-pointer p-4 bg-surface border rounded-2xl hover:border-gold-500/30 hover:bg-card transition-all duration-300 ${
                                                calcSms ? 'border-gold-500 bg-gradient-to-r from-gold-500/5 to-transparent' : 'border-line'
                                            }`}>
                                                <div className="flex gap-3 items-center">
                                                    <div className={`p-2.5 rounded-xl bg-navy-600/15 text-navy-700 dark:text-[#9FB0CC] border border-line`}>
                                                        <Users size={16} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-display font-bold uppercase text-[color:var(--text)] block flex items-center gap-1">
                                                            Smart SMS Broadcasts
                                                            <UpgradeInfoPopover
                                                                title="smart sms broadcasts"
                                                                description="Keeps your players active and engaged! Automatically sends SMS notifications to all players when bracket locks are near, pick deadlines approach, payouts are declared, or scores change."
                                                            />
                                                        </span>
                                                        <span className="text-xs font-body text-muted">Deliver text alert pick deadlines & payouts (+<span className="num">${config.features.smsNotifications?.addonPrice}</span>)</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={calcSms}
                                                    onChange={(e) => setCalcSms(e.target.checked)}
                                                    className="w-5 h-5 rounded border-line bg-surface text-gold-500 focus:ring-gold-500 cursor-pointer"
                                                />
                                            </label>
                                        )}

                                        {config.features.whatIfSimulator.isPremium && calcPoolType.toUpperCase() === 'BRACKET' && (
                                            <label className={`flex items-center justify-between cursor-pointer p-4 bg-surface border rounded-2xl hover:border-gold-500/30 hover:bg-card transition-all duration-300 ${
                                                calcSim ? 'border-gold-500 bg-gradient-to-r from-gold-500/5 to-transparent' : 'border-line'
                                            }`}>
                                                <div className="flex gap-3 items-center">
                                                    <div className={`p-2.5 rounded-xl bg-navy-600/15 text-navy-700 dark:text-[#9FB0CC] border border-line`}>
                                                        <CheckCircle size={16} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-display font-bold uppercase text-[color:var(--text)] block flex items-center gap-1">
                                                            Standings What-If Simulator
                                                            <UpgradeInfoPopover
                                                                title="what-if standings simulator"
                                                                description="Enables the interactive simulator dashboard for all players! Participants can model future match outcomes and instantly visualize changes in standings and potential cash payouts."
                                                            />
                                                        </span>
                                                        <span className="text-xs font-body text-muted">Interactive live scenarios modeling standings (+<span className="num">${config.features.whatIfSimulator.addonPrice}</span>)</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={calcSim}
                                                    onChange={(e) => setCalcSim(e.target.checked)}
                                                    className="w-5 h-5 rounded border-line bg-surface text-gold-500 focus:ring-gold-500 cursor-pointer"
                                                />
                                            </label>
                                        )}

                                        {config.features.customBranding?.isPremium && (
                                            <label className={`flex items-center justify-between cursor-pointer p-4 bg-surface border rounded-2xl hover:border-gold-500/30 hover:bg-card transition-all duration-300 ${
                                                calcBranding ? 'border-gold-500 bg-gradient-to-r from-gold-500/5 to-transparent' : 'border-line'
                                            }`}>
                                                <div className="flex gap-3 items-center">
                                                    <div className={`p-2.5 rounded-xl bg-navy-600/15 text-navy-700 dark:text-[#9FB0CC] border border-line`}>
                                                        <Sparkles size={16} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-display font-bold uppercase text-[color:var(--text)] block flex items-center gap-1">
                                                            Premium Custom Branding & Covers
                                                            <UpgradeInfoPopover
                                                                title="custom branding"
                                                                description="Upload custom headers and cover images, set your own color scheme, and add manager logos so your pool looks unmistakably yours."
                                                            />
                                                        </span>
                                                        <span className="text-xs font-body text-muted">Custom headers, colors & logos (+<span className="num">${config.features.customBranding.addonPrice}</span>)</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={calcBranding}
                                                    onChange={(e) => setCalcBranding(e.target.checked)}
                                                    className="w-5 h-5 rounded border-line bg-surface text-gold-500 focus:ring-gold-500 cursor-pointer"
                                                />
                                            </label>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        )}

                        {/* When paying for a specific pool: adjust participant estimate. Format is fixed to the pool (changing it would mean re-running the wizard), but size drives price so it stays editable. */}
                        {selectedPoolData && (
                            <div className={`${contentCard} p-6 rounded-3xl space-y-4 shadow-panel`}>
                                <h3 className="font-display font-bold uppercase text-lg text-[color:var(--text)] flex items-center gap-2">
                                    <LayoutGrid size={20} className="text-gold-600 dark:text-gold-400" />
                                    Adjust Participant Estimate
                                </h3>
                                <p className="text-xs font-body text-muted leading-relaxed">
                                    Pricing scales with pool size. Estimate how many players <strong className="text-[color:var(--text)]">{selectedPoolData.name}</strong> will have — change it anytime before paying.
                                </p>
                                <div className="space-y-4 bg-surface p-5 rounded-2xl border border-line">
                                    <div className="flex justify-between items-center text-xs font-display font-bold uppercase text-muted">
                                        <span className="tracking-[0.16em] text-[10px]">Estimated Participants</span>
                                        <span className="text-gold-600 dark:text-gold-400 text-sm font-mono font-black bg-gold-500/10 px-3 py-1 rounded-full border border-gold-500/25 num">{calcPlayers} Players</span>
                                    </div>
                                    <div className="flex gap-4 items-center">
                                        <input type="range" min="1" max="150" value={calcPlayers}
                                            onChange={(e) => setCalcPlayers(Number(e.target.value))}
                                            className="flex-grow h-2 rounded-lg appearance-none cursor-pointer bg-line accent-gold-600 focus:outline-none" />
                                        <input type="number" value={calcPlayers} min={1}
                                            onChange={(e) => setCalcPlayers(Math.max(1, Number(e.target.value) || 1))}
                                            className="w-16 bg-card border border-line rounded-xl px-2 py-2 text-center text-[color:var(--text)] font-bold outline-none font-mono num focus:border-gold-500/50 transition-colors" />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* RIGHT COLUMN: state-driven — real checkout for trial pools, estimate-only quote otherwise */}
                    <div className="lg:col-span-5 space-y-6">
                        {visitorState === 'hasUpgradeablePools' || selectedIsPayable ? (
                            // ⚠️ `selectedIsPayable`, NOT `selectedPoolData` (codex r3 [P2]).
                            // Pool documents are publicly readable, so a bare
                            // `?poolId=` of somebody else's pool would otherwise
                            // render a full checkout — quote, terms and all —
                            // that only fails at the server's ownership rule.
                            selectedIsPayable ? (
                                <>
                                    <div className="bg-card border border-gold-500/25 p-5 rounded-2xl space-y-2">
                                        <h4 className="text-sm font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-1.5">
                                            <Sparkles size={16} className="text-gold-600 dark:text-gold-400" /> Pay For Selected Pool
                                        </h4>
                                        <div className="text-xs font-body text-muted leading-relaxed">
                                            You are preparing checkout for: <strong className="text-[color:var(--text)] font-mono">{selectedPoolData.name}</strong>.
                                            Applying a validated coupon below updates your Stripe session total immediately!
                                        </div>
                                    </div>

                                    <BillingInvoiceCard
                                        poolId={selectedPoolId || undefined}
                                        poolName={selectedPoolData.name}
                                        poolType={calcPoolType}
                                        estimatedPlayers={calcPlayers}
                                        hasAiCommissioner={calcAi}
                                        hasSmsNotifications={calcSms}
                                        hasWhatIfSimulator={calcSim}
                                        hasCustomBranding={calcBranding}
                                        isWizard={false} // Renders "Complete Payment & Upgrade" button
                                        pricePaid={selectedPoolData.billing?.pricePaid || 0}
                                        initialCouponCode={selectedPoolData.billing?.couponCode || ''}
                                    />
                                </>
                            ) : (
                                <>
                                    {/* No pool picked yet — nudge toward the trial list instead of a dead pay button */}
                                    <div className="bg-card border border-gold-500/25 p-5 rounded-2xl space-y-2">
                                        <h4 className="text-sm font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-1.5">
                                            <InfoIcon size={16} className="text-gold-600 dark:text-gold-400" /> Pick a Pool to Check Out
                                        </h4>
                                        <p className="text-xs font-body text-muted leading-relaxed">
                                            Choose a pool from the <strong className="text-[color:var(--text)]">Your Pools — Ready to Upgrade</strong> list to load its checkout here.
                                        </p>
                                    </div>

                                    <EstimateSummaryCard
                                        config={config}
                                        poolType={calcPoolType}
                                        players={calcPlayers}
                                        hasAiCommissioner={calcAi}
                                        hasSmsNotifications={calcSms}
                                        hasWhatIfSimulator={calcSim}
                                        hasCustomBranding={calcBranding}
                                    />

                                    <button
                                        onClick={startCreate}
                                        disabled={!canCreate}
                                        className="w-full bg-surface hover:bg-card text-[color:var(--text)] border border-line hover:border-gold-500/40 py-4 px-6 rounded-2xl text-sm font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 hover:-translate-y-px flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:border-line"
                                        title={canCreate ? 'Launch a new pool' : 'Pool creation is coming soon'}
                                    >
                                        {canCreate ? <>Launch a New Pool Instead
                                        <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" /></> : 'Pool Creation Coming Soon'}
                                    </button>
                                </>
                            )
                        ) : (
                            <>
                                {/* anon / noPools: estimate only — no payment or checkout card is rendered */}
                                <EstimateSummaryCard
                                    config={config}
                                    poolType={calcPoolType}
                                    players={calcPlayers}
                                    hasAiCommissioner={calcAi}
                                    hasSmsNotifications={calcSms}
                                    hasWhatIfSimulator={calcSim}
                                    hasCustomBranding={calcBranding}
                                />

                                <button
                                    onClick={startCreate}
                                    disabled={!canCreate}
                                    className="w-full bg-brandred-600 hover:bg-brandred-500 text-white py-4 px-6 rounded-2xl text-sm font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 hover:-translate-y-px shadow-red-cta flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                    title={canCreate ? 'Launch a new pool' : 'Pool creation is coming soon'}
                                >
                                    {canCreate ? (
                                        <>
                                            {visitorState === 'anon' ? 'Build Your Pool — Free to Start' : 'Create Your Pool'}
                                            <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                                        </>
                                    ) : (
                                        'Pool Creation Coming Soon'
                                    )}
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Packages & Bundles Section */}
                <div className="mt-20 border-t border-line pt-16 space-y-10 animate-in fade-in duration-300">
                    <div className="text-center max-w-2xl mx-auto space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 shadow-sm bg-gold-500/10 border border-gold-500/25">
                            <Sparkles size={14} className="text-gold-600 dark:text-gold-400" />
                            <span className="font-display font-bold text-[10px] uppercase tracking-[0.16em] text-gold-600 dark:text-gold-400">Commissioner Packages</span>
                        </div>
                        <h2 className="font-display font-extrabold uppercase text-3xl leading-[0.95] text-[color:var(--text)]">
                            Multi-Pool Bundles & Commissioner Packages
                        </h2>
                        <p className="text-sm font-body text-muted leading-relaxed">
                            Are you a professional pool manager? Save big by purchasing reusable pool credits upfront or unlocking unlimited annual hosting for all your pool formats.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto pt-6 justify-center">
                        {/* Dynamic Custom Bundles */}
                        {Array.isArray(config.packagesList) && config.packagesList.map(normalizeLegacyPackage).filter(b => b.isActive).length > 0 ? (
                            config.packagesList.map(normalizeLegacyPackage).filter(b => b.isActive).map((b) => {
                                const isUnlimited = b.kind === 'UNLIMITED_PASS';

                                const badgeLabel = isUnlimited ? 'Unlimited Pass' : b.poolType === 'ALL' ? 'Universal Pack' : `${b.poolType} Pack`;
                                const pricePerPoolLabel = isUnlimited
                                    ? 'unlimited hosting'
                                    : `$${(b.price / b.poolsIncluded).toFixed(2)} / pool`;

                                return (
                                    <div key={b.id} className={`${contentCard} rounded-3xl p-6 md:p-8 relative overflow-hidden backdrop-blur-md flex flex-col justify-between hover:border-gold-500/40 transition-all duration-300 shadow-panel group hover:-translate-y-1`}>
                                        <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-gold-500/5 blur-2xl pointer-events-none" />
                                        <div className="space-y-4">
                                            <span className="bg-gold-500/10 border border-gold-500/25 text-gold-600 dark:text-gold-300 font-display font-bold text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded-full inline-block">
                                                {badgeLabel}
                                            </span>
                                            <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)]">{b.name}</h3>
                                            <p className="text-xs font-body text-muted leading-relaxed min-h-[48px]">
                                                {b.description}
                                            </p>

                                            {/* Constraints Info */}
                                            <div className="bg-surface p-4 rounded-2xl border border-line space-y-2 text-[10px] font-mono text-muted num">
                                                <div className="flex justify-between">Format: <strong className="text-[color:var(--text)]">{b.poolType}</strong></div>
                                                <div className="flex justify-between">Max size per pool: <strong className="text-[color:var(--text)]">{b.maxPlayersPerPool === 9999 ? 'Unlimited' : `${b.maxPlayersPerPool} players`}</strong></div>
                                                <div className="flex justify-between">Validity: <strong className="text-[color:var(--text)]">{b.kind === 'UNLIMITED_PASS' ? `${b.termDays} days` : 'No expiration'}</strong></div>
                                            </div>

                                            <div className="pt-2 flex items-baseline gap-1.5">
                                                <span className="font-display font-extrabold text-3xl text-[color:var(--text)] num">${Number(b.price).toFixed(2)}</span>
                                                <span className="font-display font-bold text-[10px] text-faint uppercase tracking-[0.08em] num">
                                                    ({pricePerPoolLabel})
                                                </span>
                                            </div>
                                        </div>
                                        <div className="pt-6">
                                            <button
                                                onClick={async () => {
                                                    if (!user) {
                                                        onLogin();
                                                        return;
                                                    }
                                                    try {
                                                        const response = await dbService.createCheckoutSession({
                                                            price: Number(b.price),
                                                            bundleType: b.id,
                                                            poolId: `bundle_${b.id}`,
                                                            poolName: b.name,
                                                            poolType: 'BUNDLE',
                                                            tier: 'bundle',
                                                            successUrl: `${window.location.origin}/payment-success?poolId=bundle_${b.id}`,
                                                            cancelUrl: window.location.href
                                                        } as any);
                                                        if (response?.sessionUrl) {
                                                            window.location.href = response.sessionUrl;
                                                        }
                                                    } catch (err) {
                                                        console.error("Bundle purchase failed:", err);
                                                    }
                                                }}
                                                className="w-full bg-brandred-600 hover:bg-brandred-500 text-white font-display font-bold uppercase tracking-[0.05em] py-3.5 px-6 rounded-md text-xs transition-all duration-150 hover:-translate-y-px shadow-red-cta flex items-center justify-center gap-1.5 group/btn"
                                            >
                                                Purchase {b.name}
                                                <ArrowRight size={12} className="group-hover/btn:translate-x-0.5 transition-transform" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <>
                                {/* Package 1: 3-Pool Bundle */}
                                <div className={`${contentCard} p-6 md:p-8 rounded-3xl relative overflow-hidden backdrop-blur-md flex flex-col justify-between hover:border-gold-500/40 transition-all duration-300 shadow-panel group hover:-translate-y-1`}>
                                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-gold-500/5 blur-2xl pointer-events-none" />
                                    <div className="space-y-4">
                                        <span className="bg-gold-500/10 border border-gold-500/25 text-gold-600 dark:text-gold-300 font-display font-bold text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded-full inline-block">
                                            Most Popular Bundle
                                        </span>
                                        <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)]">3-Pool Credits Package</h3>
                                        <p className="text-xs font-body text-muted leading-relaxed">
                                            Purchase 3 premium pool hosting credits upfront. Use them anytime to instantly upgrade any format (Season, Bracket, Squares, Props) to Premium. Credits never expire!
                                        </p>

                                        <div className="bg-surface p-4 rounded-2xl border border-line space-y-2 text-[10px] font-mono text-muted num">
                                            <div className="flex justify-between">Credits: <strong className="text-[color:var(--text)]">3 Pools Included</strong></div>
                                            <div className="flex justify-between">Validity: <strong className="text-[color:var(--text)]">Never Expires</strong></div>
                                            <div className="flex justify-between">Pool Formats: <strong className="text-[color:var(--text)]">Universal</strong></div>
                                        </div>

                                        <div className="pt-2 flex items-baseline gap-1.5">
                                            <span className="font-display font-extrabold text-3xl text-[color:var(--text)] num">${(config.packages?.buy_3 ?? 49.00).toFixed(2)}</span>
                                            <span className="font-display font-bold text-[10px] text-faint uppercase tracking-[0.08em] num">one-time (${((config.packages?.buy_3 ?? 49.00) / 3).toFixed(2)} / pool)</span>
                                        </div>
                                    </div>
                                    <div className="pt-6">
                                        <button
                                            onClick={async () => {
                                                if (!user) {
                                                    onLogin();
                                                    return;
                                                }
                                                try {
                                                    const response = await dbService.createCheckoutSession({
                                                        price: config.packages?.buy_3 ?? 49.00,
                                                        bundleType: 'buy_3',
                                                        poolId: 'bundle_buy_3',
                                                        poolName: '3-Pool Bundle Package',
                                                        poolType: 'BUNDLE',
                                                        tier: 'bundle',
                                                        successUrl: `${window.location.origin}/payment-success?poolId=bundle_buy_3`,
                                                        cancelUrl: window.location.href
                                                    } as any);
                                                    if (response?.sessionUrl) {
                                                        window.location.href = response.sessionUrl;
                                                    }
                                                } catch (err) {
                                                    console.error("Bundle purchase failed:", err);
                                                }
                                            }}
                                            className="w-full bg-brandred-600 hover:bg-brandred-500 text-white font-display font-bold uppercase tracking-[0.05em] py-3.5 px-6 rounded-md text-xs transition-all duration-150 hover:-translate-y-px shadow-red-cta flex items-center justify-center gap-1.5 group/btn"
                                        >
                                            Purchase 3-Pool Credits Bundle
                                            <ArrowRight size={12} className="group-hover/btn:translate-x-0.5 transition-transform" />
                                        </button>
                                    </div>
                                </div>

                                {/* Package 2: Unlimited Annual Pass */}
                                <div className="bg-card border border-gold-500/35 p-6 md:p-8 rounded-3xl relative overflow-hidden backdrop-blur-md flex flex-col justify-between hover:border-gold-500/70 transition-all duration-300 shadow-panel group hover:-translate-y-1">
                                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-gold-500/10 blur-2xl pointer-events-none" />
                                    <div className="space-y-4">
                                        <span className="bg-gold-foil text-navy-900 font-display font-bold text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded-full inline-block">
                                            Unlimited Access
                                        </span>
                                        <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)]">1-Year Unlimited Pool Pass</h3>
                                        <p className="text-xs font-body text-muted leading-relaxed">
                                            Unlock absolute freedom! Create and host unlimited pools of any format with unlimited participants for a full 365 days. Perfect for corporate leagues and multi-format clubs.
                                        </p>

                                        <div className="bg-surface p-4 rounded-2xl border border-line space-y-2 text-[10px] font-mono text-muted num">
                                            <div className="flex justify-between">Pool Limit: <strong className="text-[color:var(--text)]">Unlimited pools</strong></div>
                                            <div className="flex justify-between">Duration: <strong className="text-[color:var(--text)]">365 Days</strong></div>
                                            <div className="flex justify-between">Size Limit: <strong className="text-[color:var(--text)]">Unlimited players</strong></div>
                                        </div>

                                        <div className="pt-2 flex items-baseline gap-1.5">
                                            <span className="font-display font-extrabold text-3xl text-[color:var(--text)] num">${(config.packages?.unlimited_1yr ?? 129.00).toFixed(2)}</span>
                                            <span className="font-display font-bold text-[10px] text-faint uppercase tracking-[0.08em]">billed annually</span>
                                        </div>
                                    </div>
                                    <div className="pt-6">
                                        <button
                                            onClick={async () => {
                                                if (!user) {
                                                    onLogin();
                                                    return;
                                                }
                                                try {
                                                    const response = await dbService.createCheckoutSession({
                                                        price: config.packages?.unlimited_1yr ?? 129.00,
                                                        bundleType: 'unlimited_1yr',
                                                        poolId: 'bundle_unlimited_1yr',
                                                        poolName: '1-Year Unlimited Pool Pass',
                                                        poolType: 'BUNDLE',
                                                        tier: 'bundle',
                                                        successUrl: `${window.location.origin}/payment-success?poolId=bundle_unlimited_1yr`,
                                                        cancelUrl: window.location.href
                                                    } as any);
                                                    if (response?.sessionUrl) {
                                                        window.location.href = response.sessionUrl;
                                                    }
                                                } catch (err) {
                                                    console.error("Bundle purchase failed:", err);
                                                }
                                            }}
                                            className="w-full bg-gold-foil text-navy-900 font-display font-bold uppercase tracking-[0.05em] py-3.5 px-6 rounded-md text-xs transition-all duration-150 hover:-translate-y-px hover:brightness-105 shadow-[0_6px_16px_rgba(140,109,51,0.28)] flex items-center justify-center gap-1.5 group/btn"
                                        >
                                            Unlock 1-Year Unlimited Pass
                                            <ArrowRight size={12} className="group-hover/btn:translate-x-0.5 transition-transform" />
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
};
