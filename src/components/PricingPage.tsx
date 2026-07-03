import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { User, Pool, BillingConfig } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { dbService } from '../services/dbService';
import {
    CheckCircle, Sparkles, Zap,
    ArrowRight, LayoutGrid, Users, HelpCircle,
    ChevronRight, HelpCircle as InfoIcon, X
} from 'lucide-react';
import { BillingInvoiceCard } from './billing/BillingInvoiceCard';

const UpgradeTooltip: React.FC<{ title: string; description: string }> = ({ title, description }) => {
    return (
        <span className="relative group inline-block ml-1">
            <HelpCircle size={14} className="text-[#7C8BA6] hover:text-[#9FB0CC] cursor-help inline shrink-0 transition-colors" />
            <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-navy-900 border border-[rgba(230,206,150,0.16)] p-3.5 rounded-xl text-[11px] leading-relaxed text-[#EDF1F8] font-body opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-panel z-50 backdrop-blur-md">
                <strong className="text-gold-400 block mb-1 font-display font-bold uppercase tracking-[0.08em] text-[10px]">{title}</strong>
                {description}
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-navy-900" />
            </span>
        </span>
    );
};

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
    packages: {
        buy_3: 49.00,
        unlimited_1yr: 129.00
    }
};

// Active promo banner — surfaces best available pre-season coupon.
// Update window/code/discount as promos roll forward.
const ACTIVE_PROMO = {
    code: 'EARLYBIRD30',
    discount: 30,
    label: 'EARLY BIRD',
    endsAt: new Date('2026-07-31T23:59:59').getTime(),
    blurb: 'Pre-season launch — lock in 30% off your NFL or NCAA pool before July 31.'
};

/* Marketing/pricing page is navy chrome end-to-end — always dark in both themes. */

const chromeCard = 'bg-navy-900 border border-[rgba(230,206,150,0.16)]';
const chromeLabel = 'block font-display font-bold text-[10px] text-[#7C8BA6] uppercase tracking-[0.16em]';

export const PricingPage: React.FC<PricingPageProps> = ({
    user,
    isManager = false,
    onLogin,
    onLogout,
    onCreatePool
}) => {
    const navigate = useNavigate();
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

    // Fetch user pools in trial / grace period if logged in
    useEffect(() => {
        if (!user?.id) return;
        const unsubscribe = dbService.subscribeToPools((poolsList) => {
            const trialsOnly = poolsList.filter(p =>
                p.billing?.status === 'trial' || p.billing?.status === 'grace_period'
            );
            setUserPools(trialsOnly);
        }, (err) => {
            console.error('[PricingPage] Failed subscribing to user pools:', err);
        }, user.id);
        return () => unsubscribe();
    }, [user?.id]);

    // Handle Selected Pool monitoring
    useEffect(() => {
        const poolIdToLoad = selectedPoolId || targetPoolId;
        if (!poolIdToLoad) {
            setSelectedPoolData(null);
            return;
        }

        const unsubscribe = dbService.subscribeToPool(poolIdToLoad, (pool) => {
            if (pool) {
                setSelectedPoolData(pool);
                // Synchronize calculator inputs to match selected pool for convenience
                setCalcPoolType(pool.type);
                setCalcPlayers((pool as any).settings?.maxEntriesTotal === -1 ? 40 : ((pool as any).settings?.maxEntriesTotal || 40));
                setCalcAi(pool.billing?.featuresUnlocked?.aiCommissioner || false);
                setCalcSms(pool.billing?.featuresUnlocked?.smsNotifications || false);
                setCalcSim(pool.billing?.featuresUnlocked?.whatIfSimulator || false);
            }
        }, (err) => {
            console.error('[PricingPage] Error fetching pool details:', err);
        });
        return () => unsubscribe();
    }, [selectedPoolId, targetPoolId]);

    return (
        <div className="min-h-screen text-white font-body bg-navy-950 flex flex-col">
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            {/* Hero Header Section */}
            <section className="relative overflow-hidden pt-24 pb-20 border-b border-[rgba(230,206,150,0.16)] bg-gradient-to-b from-navy-950 via-navy-950 to-navy-900">
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

                    {ACTIVE_PROMO.endsAt > Date.now() && (
                        <div className="mt-6 inline-flex flex-col sm:flex-row items-center gap-3.5 px-6 py-4 rounded-3xl border border-gold-500/25 bg-navy-900/60 backdrop-blur-md shadow-panel relative overflow-hidden group max-w-3xl mx-auto">
                            {/* Inner soft glow */}
                            <div className="absolute inset-0 bg-gradient-to-r from-gold-500/5 via-gold-400/5 to-gold-500/5 opacity-50 pointer-events-none" />

                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gold-500/10 border border-gold-400/35 font-display font-bold text-[10px] uppercase tracking-[0.08em] text-gold-300 shadow-sm shrink-0">
                                <Sparkles size={12} className="animate-live-pulse" /> {ACTIVE_PROMO.label}
                            </span>
                            <span className="text-xs sm:text-sm text-[#EDF1F8] font-body leading-relaxed text-left">
                                {ACTIVE_PROMO.blurb} Use code{' '}
                                <code className="px-2 py-0.5 rounded-md bg-navy-950 border border-gold-400/40 text-gold-300 font-mono font-black text-xs shadow-inner">
                                    {ACTIVE_PROMO.code}
                                </code>{' '}
                                at checkout — save <span className="num">{ACTIVE_PROMO.discount}%</span>.
                            </span>
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
                        {user && userPools.length > 0 && (
                            <div className="bg-navy-900 border border-gold-500/25 rounded-3xl p-6 space-y-4 shadow-panel">
                                <h3 className="font-display font-bold uppercase text-lg text-white flex items-center gap-2">
                                    <Sparkles className="text-gold-400" size={20} />
                                    Your Trial Pools Awaiting Activation
                                </h3>
                                <p className="text-xs font-body text-[#9FB0CC]">
                                    Select one of your trial pools below to complete standard hosting payment and activate permanently.
                                </p>
                                <div className="grid grid-cols-1 gap-2.5">
                                    {userPools.map((pool) => (
                                        <button
                                            key={pool.id}
                                            onClick={() => setSelectedPoolId(pool.id)}
                                            className={`w-full flex items-center justify-between p-4 rounded-xl border text-left transition-all ${
                                                selectedPoolId === pool.id
                                                    ? 'bg-gold-500/10 border-gold-500 shadow-lg'
                                                    : 'bg-navy-950/60 border-[rgba(230,206,150,0.16)] hover:border-gold-500/40'
                                            }`}
                                        >
                                            <div className="space-y-1">
                                                <span className="text-sm font-display font-bold uppercase text-white block">{pool.name}</span>
                                                <span className="text-xs text-[#7C8BA6] font-mono capitalize">
                                                    Format: {pool.type.toLowerCase().replace('_', ' ')}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="bg-gold-500/10 border border-gold-500/25 text-gold-400 font-display font-bold text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded-full">
                                                    Trial State
                                                </span>
                                                <ChevronRight size={16} className="text-[#9FB0CC]" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                {selectedPoolId && (
                                    <button
                                        onClick={() => setSelectedPoolId(null)}
                                        className="inline-flex items-center gap-1 text-xs font-body text-[#7C8BA6] hover:text-white transition-colors"
                                    >
                                        <X size={12} /> Clear selection and show calculator
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Interactive Billing Calculator Panel */}
                        <div className={`${chromeCard} p-6 md:p-8 rounded-3xl space-y-6 shadow-panel backdrop-blur-md hover:border-gold-500/40 transition-all duration-300 relative overflow-hidden group`}>
                            {/* Inner background blob */}
                            <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-gold-500/5 blur-2xl pointer-events-none" />

                            <div className="space-y-2 relative z-10">
                                <h3 className="font-display font-bold uppercase text-xl text-white flex items-center gap-2">
                                    <LayoutGrid size={22} className="text-gold-400" />
                                    Interactive Price Estimator
                                </h3>
                                <p className="text-xs font-body text-[#9FB0CC] leading-relaxed">
                                    Estimate your custom hosting plan based on format, estimated participant size, and premium additions.
                                </p>
                            </div>

                            <div className="space-y-6 relative z-10">
                                {/* 1. Format Select */}
                                <div>
                                    <label className={`${chromeLabel} mb-3`}>
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
                                                }}
                                                className={`py-3.5 px-3 rounded-2xl text-xs font-display font-bold uppercase tracking-[0.05em] transition-all border ${
                                                    calcPoolType === f.k
                                                        ? 'bg-gold-500/15 text-white border-gold-500 shadow-lg shadow-gold-500/10'
                                                        : 'bg-navy-950 text-[#9FB0CC] border-[rgba(230,206,150,0.16)] hover:border-gold-500/30 hover:text-[#EDF1F8]'
                                                }`}
                                            >
                                                {f.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* 2. Player Input Slider (if not Squares which is locked at 100) */}
                                {calcPoolType !== 'SQUARES' && (
                                    <div className="space-y-4 bg-navy-950/40 p-5 rounded-2xl border border-[rgba(230,206,150,0.16)]">
                                        <div className="flex justify-between items-center text-xs font-display font-bold uppercase text-[#9FB0CC]">
                                            <span className="tracking-[0.16em] text-[10px]">Estimated Participants</span>
                                            <span className="text-gold-400 text-sm font-mono font-black bg-gold-500/10 px-3 py-1 rounded-full border border-gold-500/25 num">{calcPlayers} Players</span>
                                        </div>
                                        <div className="flex gap-4 items-center">
                                            <input
                                                type="range"
                                                min="1"
                                                max="150"
                                                value={calcPlayers}
                                                onChange={(e) => setCalcPlayers(Number(e.target.value))}
                                                className="flex-grow h-2 rounded-lg appearance-none cursor-pointer bg-navy-800 accent-gold-600 focus:outline-none"
                                            />
                                            <input
                                                type="number"
                                                value={calcPlayers}
                                                min={1}
                                                onChange={(e) => setCalcPlayers(Math.max(1, Number(e.target.value) || 1))}
                                                className="w-16 bg-navy-950 border border-[rgba(230,206,150,0.16)] rounded-xl px-2 py-2 text-center text-white font-bold outline-none font-mono num focus:border-gold-500/50 transition-colors"
                                            />
                                        </div>
                                        {calcPlayers <= config.freePlayerThreshold && (
                                            <div className="p-3.5 bg-[#0F7B4A]/15 border border-[#0F7B4A]/40 text-emerald-400 text-xs rounded-xl flex items-center gap-2.5 animate-in fade-in duration-300">
                                                <Sparkles size={14} className="animate-live-pulse" />
                                                <span>Under <span className="num">{config.freePlayerThreshold}</span> players? This pool qualifies for the <strong className="text-white">Free Tier</strong>!</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 3. Feature Add-ons selection */}
                                <div className="space-y-3">
                                    <label className={chromeLabel}>
                                        Premium Upgrades (Optional)
                                    </label>
                                    <div className="space-y-2.5">
                                        {config.features.aiCommissioner.isPremium && (
                                            <label className={`flex items-center justify-between cursor-pointer p-4 bg-navy-950/80 border rounded-2xl hover:border-gold-500/30 hover:bg-navy-950 transition-all duration-300 ${
                                                calcAi ? 'border-gold-500 bg-gradient-to-r from-gold-500/5 to-transparent' : 'border-[rgba(230,206,150,0.16)]'
                                            }`}>
                                                <div className="flex gap-3 items-center">
                                                    <div className={`p-2.5 rounded-xl bg-gold-500/10 text-gold-400 border border-gold-500/25`}>
                                                        <Zap size={16} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-display font-bold uppercase text-[#EDF1F8] block flex items-center gap-1">
                                                            AI Commissioner Newsletter
                                                            <UpgradeTooltip
                                                                title="AI commissioner"
                                                                description="Generates weekly recaps, round-by-round highlights, and humorous trash-talking articles automatically. Uses state-of-the-art Gemini AI tailored exactly to your pool's rules and active standings."
                                                            />
                                                        </span>
                                                        <span className="text-xs font-body text-[#9FB0CC]">Auto-generate trash-talk posts & round recaps (+<span className="num">${config.features.aiCommissioner.addonPrice}</span>)</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={calcAi}
                                                    onChange={(e) => setCalcAi(e.target.checked)}
                                                    className="w-5 h-5 rounded border-navy-700 bg-navy-800 text-gold-500 focus:ring-gold-500 cursor-pointer"
                                                />
                                            </label>
                                        )}

                                        {config.features.smsNotifications?.isPremium && (
                                            <label className={`flex items-center justify-between cursor-pointer p-4 bg-navy-950/80 border rounded-2xl hover:border-gold-500/30 hover:bg-navy-950 transition-all duration-300 ${
                                                calcSms ? 'border-gold-500 bg-gradient-to-r from-gold-500/5 to-transparent' : 'border-[rgba(230,206,150,0.16)]'
                                            }`}>
                                                <div className="flex gap-3 items-center">
                                                    <div className={`p-2.5 rounded-xl bg-navy-700/50 text-[#9FB0CC] border border-[rgba(230,206,150,0.16)]`}>
                                                        <Users size={16} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-display font-bold uppercase text-[#EDF1F8] block flex items-center gap-1">
                                                            Smart SMS Broadcasts
                                                            <UpgradeTooltip
                                                                title="smart sms broadcasts"
                                                                description="Keeps your players active and engaged! Automatically sends SMS notifications to all players when bracket locks are near, pick deadlines approach, payouts are declared, or scores change."
                                                            />
                                                        </span>
                                                        <span className="text-xs font-body text-[#9FB0CC]">Deliver text alert pick deadlines & payouts (+<span className="num">${config.features.smsNotifications?.addonPrice}</span>)</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={calcSms}
                                                    onChange={(e) => setCalcSms(e.target.checked)}
                                                    className="w-5 h-5 rounded border-navy-700 bg-navy-800 text-gold-500 focus:ring-gold-500 cursor-pointer"
                                                />
                                            </label>
                                        )}

                                        {config.features.whatIfSimulator.isPremium && (
                                            <label className={`flex items-center justify-between cursor-pointer p-4 bg-navy-950/80 border rounded-2xl hover:border-gold-500/30 hover:bg-navy-950 transition-all duration-300 ${
                                                calcSim ? 'border-gold-500 bg-gradient-to-r from-gold-500/5 to-transparent' : 'border-[rgba(230,206,150,0.16)]'
                                            }`}>
                                                <div className="flex gap-3 items-center">
                                                    <div className={`p-2.5 rounded-xl bg-navy-700/50 text-[#9FB0CC] border border-[rgba(230,206,150,0.16)]`}>
                                                        <CheckCircle size={16} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-display font-bold uppercase text-[#EDF1F8] block flex items-center gap-1">
                                                            Standings What-If Simulator
                                                            <UpgradeTooltip
                                                                title="what-if standings simulator"
                                                                description="Enables the interactive simulator dashboard for all players! Participants can model future match outcomes and instantly visualize changes in standings and potential cash payouts."
                                                            />
                                                        </span>
                                                        <span className="text-xs font-body text-[#9FB0CC]">Interactive live scenarios modeling standings (+<span className="num">${config.features.whatIfSimulator.addonPrice}</span>)</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={calcSim}
                                                    onChange={(e) => setCalcSim(e.target.checked)}
                                                    className="w-5 h-5 rounded border-navy-700 bg-navy-800 text-gold-500 focus:ring-gold-500 cursor-pointer"
                                                />
                                            </label>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Real-Time Quote & Invoice checkout */}
                    <div className="lg:col-span-5 space-y-6">

                        {/* Title Context depending on selected / calculator mode */}
                        {selectedPoolData ? (
                            <div className="bg-navy-900 border border-gold-500/25 p-5 rounded-2xl space-y-2">
                                <h4 className="text-sm font-display font-bold uppercase text-white flex items-center gap-1.5">
                                    <Sparkles size={16} className="text-gold-400" /> Pay For Selected Pool
                                </h4>
                                <div className="text-xs font-body text-[#9FB0CC] leading-relaxed">
                                    You are preparing checkout for: <strong className="text-white font-mono">{selectedPoolData.name}</strong>.
                                    Applying a validated coupon below updates your Stripe session total immediately!
                                </div>
                            </div>
                        ) : (
                            <div className={`${chromeCard} p-5 rounded-2xl space-y-2`}>
                                <h4 className="text-xs font-display font-bold uppercase tracking-[0.08em] text-[#7C8BA6] flex items-center gap-1.5">
                                    <InfoIcon size={14} className="text-gold-400" /> Interactive Quote Mode
                                </h4>
                                <p className="text-xs font-body text-[#9FB0CC] leading-relaxed">
                                    This quote reflects estimated hosting plans. To complete actual payment, select one of your trial pools above or launch a new pool!
                                </p>
                            </div>
                        )}

                        <BillingInvoiceCard
                            poolId={selectedPoolId || undefined}
                            poolName={selectedPoolData?.name || `${calcPoolType.toLowerCase()} pool`}
                            poolType={calcPoolType}
                            estimatedPlayers={calcPlayers}
                            hasAiCommissioner={calcAi}
                            hasSmsNotifications={calcSms}
                            hasWhatIfSimulator={calcSim}
                            isWizard={false} // Renders "Complete Payment & Upgrade" button
                            pricePaid={selectedPoolData?.billing?.pricePaid || 0}
                            initialCouponCode={selectedPoolData?.billing?.couponCode || ''}
                        />

                        {/* Direct Create CTA if not paying for existing pool */}
                        {!selectedPoolId && (
                            <button
                                onClick={() => {
                                    if (user) navigate('/create-pool');
                                    else onLogin();
                                }}
                                className="w-full bg-navy-800 hover:bg-navy-700 text-white border border-[rgba(230,206,150,0.16)] hover:border-gold-500/40 py-4 px-6 rounded-2xl text-sm font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 hover:-translate-y-px flex items-center justify-center gap-2 group"
                            >
                                Launch a New Pool Instead
                                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Packages & Bundles Section */}
                <div className="mt-20 border-t border-[rgba(230,206,150,0.16)] pt-16 space-y-10 animate-in fade-in duration-300">
                    <div className="text-center max-w-2xl mx-auto space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 shadow-sm bg-gold-500/10 border border-gold-500/25">
                            <Sparkles size={14} className="text-gold-400" />
                            <span className="font-display font-bold text-[10px] uppercase tracking-[0.16em] text-gold-400">Commissioner Packages</span>
                        </div>
                        <h2 className="font-display font-extrabold uppercase text-3xl leading-[0.95] text-white">
                            Multi-Pool Bundles & Commissioner Packages
                        </h2>
                        <p className="text-sm font-body text-[#9FB0CC] leading-relaxed">
                            Are you a professional pool manager? Save big by purchasing reusable pool credits upfront or unlocking unlimited annual hosting for all your pool formats.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto pt-6 justify-center">
                        {/* Dynamic Custom Bundles */}
                        {Array.isArray(config.packagesList) && config.packagesList.filter(b => b.isActive).length > 0 ? (
                            config.packagesList.filter(b => b.isActive).map((b) => {
                                const isUnlimited = b.poolsIncluded >= 9999;

                                const badgeLabel = isUnlimited ? 'Unlimited Pass' : b.poolType === 'ALL' ? 'Universal Pack' : `${b.poolType} Pack`;
                                const pricePerPoolLabel = isUnlimited
                                    ? 'unlimited hosting'
                                    : `$${(b.price / b.poolsIncluded).toFixed(2)} / pool`;

                                return (
                                    <div key={b.id} className={`${chromeCard} rounded-3xl p-6 md:p-8 relative overflow-hidden backdrop-blur-md flex flex-col justify-between hover:border-gold-500/40 transition-all duration-300 shadow-panel group hover:-translate-y-1`}>
                                        <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-gold-500/5 blur-2xl pointer-events-none" />
                                        <div className="space-y-4">
                                            <span className="bg-gold-500/10 border border-gold-500/25 text-gold-300 font-display font-bold text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded-full inline-block">
                                                {badgeLabel}
                                            </span>
                                            <h3 className="font-display font-bold uppercase text-xl text-white">{b.name}</h3>
                                            <p className="text-xs font-body text-[#9FB0CC] leading-relaxed min-h-[48px]">
                                                {b.description}
                                            </p>

                                            {/* Constraints Info */}
                                            <div className="bg-navy-950/40 p-4 rounded-2xl border border-[rgba(230,206,150,0.16)] space-y-2 text-[10px] font-mono text-[#9FB0CC] num">
                                                <div className="flex justify-between">Format: <strong className="text-white">{b.poolType}</strong></div>
                                                <div className="flex justify-between">Max size per pool: <strong className="text-white">{b.maxPlayersPerPool === 9999 ? 'Unlimited' : `${b.maxPlayersPerPool} players`}</strong></div>
                                                <div className="flex justify-between">Validity: <strong className="text-white">{b.durationDays === 0 ? 'No expiration' : `${b.durationDays} days`}</strong></div>
                                            </div>

                                            <div className="pt-2 flex items-baseline gap-1.5">
                                                <span className="font-display font-extrabold text-3xl text-white num">${Number(b.price).toFixed(2)}</span>
                                                <span className="font-display font-bold text-[10px] text-[#7C8BA6] uppercase tracking-[0.08em] num">
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
                                <div className={`${chromeCard} p-6 md:p-8 rounded-3xl relative overflow-hidden backdrop-blur-md flex flex-col justify-between hover:border-gold-500/40 transition-all duration-300 shadow-panel group hover:-translate-y-1`}>
                                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-gold-500/5 blur-2xl pointer-events-none" />
                                    <div className="space-y-4">
                                        <span className="bg-gold-500/10 border border-gold-500/25 text-gold-300 font-display font-bold text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded-full inline-block">
                                            Most Popular Bundle
                                        </span>
                                        <h3 className="font-display font-bold uppercase text-xl text-white">3-Pool Credits Package</h3>
                                        <p className="text-xs font-body text-[#9FB0CC] leading-relaxed">
                                            Purchase 3 premium pool hosting credits upfront. Use them anytime to instantly upgrade any format (Season, Bracket, Squares, Props) to Premium. Credits never expire!
                                        </p>

                                        <div className="bg-navy-950/40 p-4 rounded-2xl border border-[rgba(230,206,150,0.16)] space-y-2 text-[10px] font-mono text-[#9FB0CC] num">
                                            <div className="flex justify-between">Credits: <strong className="text-white">3 Pools Included</strong></div>
                                            <div className="flex justify-between">Validity: <strong className="text-white">Never Expires</strong></div>
                                            <div className="flex justify-between">Pool Formats: <strong className="text-white">Universal</strong></div>
                                        </div>

                                        <div className="pt-2 flex items-baseline gap-1.5">
                                            <span className="font-display font-extrabold text-3xl text-white num">${(config.packages?.buy_3 ?? 49.00).toFixed(2)}</span>
                                            <span className="font-display font-bold text-[10px] text-[#7C8BA6] uppercase tracking-[0.08em] num">one-time (${((config.packages?.buy_3 ?? 49.00) / 3).toFixed(2)} / pool)</span>
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
                                <div className="bg-navy-900 border border-gold-500/35 p-6 md:p-8 rounded-3xl relative overflow-hidden backdrop-blur-md flex flex-col justify-between hover:border-gold-500/70 transition-all duration-300 shadow-panel group hover:-translate-y-1">
                                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-gold-500/10 blur-2xl pointer-events-none" />
                                    <div className="space-y-4">
                                        <span className="bg-gold-foil text-navy-900 font-display font-bold text-[10px] uppercase tracking-[0.08em] px-2.5 py-1 rounded-full inline-block">
                                            Unlimited Access
                                        </span>
                                        <h3 className="font-display font-bold uppercase text-xl text-white">1-Year Unlimited Pool Pass</h3>
                                        <p className="text-xs font-body text-[#9FB0CC] leading-relaxed">
                                            Unlock absolute freedom! Create and host unlimited pools of any format with unlimited participants for a full 365 days. Perfect for corporate leagues and multi-format clubs.
                                        </p>

                                        <div className="bg-navy-950/40 p-4 rounded-2xl border border-[rgba(230,206,150,0.16)] space-y-2 text-[10px] font-mono text-[#9FB0CC] num">
                                            <div className="flex justify-between">Pool Limit: <strong className="text-white">Unlimited pools</strong></div>
                                            <div className="flex justify-between">Duration: <strong className="text-white">365 Days</strong></div>
                                            <div className="flex justify-between">Size Limit: <strong className="text-white">Unlimited players</strong></div>
                                        </div>

                                        <div className="pt-2 flex items-baseline gap-1.5">
                                            <span className="font-display font-extrabold text-3xl text-white num">${(config.packages?.unlimited_1yr ?? 129.00).toFixed(2)}</span>
                                            <span className="font-display font-bold text-[10px] text-[#7C8BA6] uppercase tracking-[0.08em]">billed annually</span>
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
