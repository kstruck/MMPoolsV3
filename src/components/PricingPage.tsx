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
    ChevronRight, HelpCircle as InfoIcon
} from 'lucide-react';
import { BillingInvoiceCard } from './billing/BillingInvoiceCard';

const UpgradeTooltip: React.FC<{ title: string; description: string }> = ({ title, description }) => {
    return (
        <span className="relative group inline-block ml-1">
            <HelpCircle size={14} className="text-slate-500 hover:text-slate-350 cursor-help inline shrink-0 transition-colors" />
            <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-slate-900 border border-slate-800 p-3.5 rounded-xl text-[11px] leading-relaxed text-slate-300 font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-2xl z-50 backdrop-blur-md">
                <strong className="text-indigo-400 block mb-1 uppercase tracking-wider text-[10px]">{title}</strong>
                {description}
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
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
        <div className="min-h-screen text-slate-100 font-sans selection:bg-orange-500 selection:text-white bg-slate-950 flex flex-col">
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            {/* Hero Header Section */}
            <section className="relative overflow-hidden pt-24 pb-20 border-b border-slate-900 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900">
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-10 right-0 w-[550px] h-[550px] rounded-full blur-[140px] bg-indigo-500/10 opacity-70" />
                    <div className="absolute bottom-0 left-0 w-[550px] h-[550px] rounded-full blur-[140px] bg-orange-500/5 opacity-50" />
                </div>

                <div className="max-w-5xl mx-auto px-6 relative z-10 text-center space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
                    <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 shadow-md bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 backdrop-blur-md">
                        <Sparkles size={14} className="text-indigo-400 animate-spin-slow" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Monetization Dashboard V3</span>
                    </div>

                    <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-tight" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                        Flexible Pricing for <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-amber-400 to-indigo-400">Pool Commissioners</span>
                    </h1>
                    
                    <p className="text-base md:text-lg max-w-2xl mx-auto text-slate-400 leading-relaxed font-medium">
                        Start every pool with a <strong className="text-white">14-day free trial</strong>. Upgrade anytime to unlock premium tools, live scoring syncs, AI updates, and SMS alerts.
                    </p>

                    {ACTIVE_PROMO.endsAt > Date.now() && (
                        <div className="mt-6 inline-flex flex-col sm:flex-row items-center gap-3.5 px-6 py-4 rounded-3xl border border-amber-500/25 bg-slate-900/60 backdrop-blur-md shadow-2xl relative overflow-hidden group max-w-3xl mx-auto">
                            {/* Inner soft glow */}
                            <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-orange-500/5 to-amber-500/5 opacity-50 pointer-events-none" />
                            
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-400/35 text-[10px] font-black uppercase tracking-wider text-amber-300 shadow-sm shrink-0">
                                <Sparkles size={12} className="animate-pulse" /> {ACTIVE_PROMO.label}
                            </span>
                            <span className="text-xs sm:text-sm text-slate-200 font-medium leading-relaxed text-left">
                                {ACTIVE_PROMO.blurb} Use code{' '}
                                <code className="px-2 py-0.5 rounded-md bg-slate-950 border border-amber-400/40 text-amber-300 font-mono font-black text-xs shadow-inner">
                                    {ACTIVE_PROMO.code}
                                </code>{' '}
                                at checkout — save {ACTIVE_PROMO.discount}%.
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
                            <div className="bg-slate-900/40 border border-indigo-500/20 rounded-3xl p-6 space-y-4 shadow-xl">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Sparkles className="text-amber-400" size={20} />
                                    Your Trial Pools Awaiting Activation
                                </h3>
                                <p className="text-xs text-slate-400">
                                    Select one of your trial pools below to complete standard hosting payment and activate permanently.
                                </p>
                                <div className="grid grid-cols-1 gap-2.5">
                                    {userPools.map((pool) => (
                                        <button
                                            key={pool.id}
                                            onClick={() => setSelectedPoolId(pool.id)}
                                            className={`w-full flex items-center justify-between p-4 rounded-xl border text-left transition-all ${
                                                selectedPoolId === pool.id 
                                                    ? 'bg-indigo-600/10 border-indigo-500 shadow-lg' 
                                                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="space-y-1">
                                                <span className="text-sm font-bold text-white block">{pool.name}</span>
                                                <span className="text-xs text-slate-500 font-mono capitalize">
                                                    Format: {pool.type.toLowerCase().replace('_', ' ')}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-black uppercase px-2.5 py-1 rounded-full">
                                                    Trial State
                                                </span>
                                                <ChevronRight size={16} className="text-slate-400" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                {selectedPoolId && (
                                    <button 
                                        onClick={() => setSelectedPoolId(null)}
                                        className="text-xs text-slate-500 hover:text-white transition-colors"
                                    >
                                        ✕ Clear selection and show calculator
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Interactive Billing Calculator Panel */}
                        <div className="bg-slate-900/40 border border-slate-800/80 p-6 md:p-8 rounded-3xl space-y-6 shadow-2xl backdrop-blur-md hover:border-slate-700/60 transition-all duration-300 relative overflow-hidden group">
                            {/* Inner background blob */}
                            <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-indigo-500/5 blur-2xl pointer-events-none" />
                            
                            <div className="space-y-2 relative z-10">
                                <h3 className="text-xl font-bold text-white flex items-center gap-2" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                                    <LayoutGrid size={22} className="text-indigo-400" />
                                    Interactive Price Estimator
                                </h3>
                                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                                    Estimate your custom hosting plan based on format, estimated participant size, and premium additions.
                                </p>
                            </div>

                            <div className="space-y-6 relative z-10">
                                {/* 1. Format Select */}
                                <div>
                                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">
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
                                                className={`py-3.5 px-3 rounded-2xl text-xs font-bold transition-all border ${
                                                    calcPoolType === f.k 
                                                        ? 'bg-gradient-to-r from-indigo-500/15 to-purple-500/10 text-white border-indigo-500 shadow-lg shadow-indigo-500/10' 
                                                        : 'bg-slate-950/90 text-slate-400 border-slate-850 hover:border-indigo-500/30 hover:text-slate-200'
                                                }`}
                                            >
                                                {f.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* 2. Player Input Slider (if not Squares which is locked at 100) */}
                                {calcPoolType !== 'SQUARES' && (
                                    <div className="space-y-4 bg-slate-950/40 p-5 rounded-2xl border border-slate-850">
                                        <div className="flex justify-between items-center text-xs font-bold text-slate-400">
                                            <span className="uppercase tracking-widest text-[10px]">Estimated Participants</span>
                                            <span className="text-indigo-400 text-sm font-mono font-black bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20">{calcPlayers} Players</span>
                                        </div>
                                        <div className="flex gap-4 items-center">
                                            <input
                                                type="range"
                                                min="1"
                                                max="150"
                                                value={calcPlayers}
                                                onChange={(e) => setCalcPlayers(Number(e.target.value))}
                                                className="flex-grow h-2 rounded-lg appearance-none cursor-pointer bg-slate-800 accent-indigo-500 focus:outline-none"
                                            />
                                            <input
                                                type="number"
                                                value={calcPlayers}
                                                min={1}
                                                onChange={(e) => setCalcPlayers(Math.max(1, Number(e.target.value) || 1))}
                                                className="w-16 bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-center text-white font-bold outline-none font-mono focus:border-indigo-500/50 transition-colors"
                                            />
                                        </div>
                                        {calcPlayers <= config.freePlayerThreshold && (
                                            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-center gap-2.5 animate-in fade-in duration-300">
                                                <Sparkles size={14} className="animate-pulse" />
                                                <span>Under {config.freePlayerThreshold} players? This pool qualifies for the <strong className="text-white">Free Tier</strong>!</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 3. Feature Add-ons selection */}
                                <div className="space-y-3">
                                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                        Premium Upgrades (Optional)
                                    </label>
                                    <div className="space-y-2.5">
                                        {config.features.aiCommissioner.isPremium && (
                                            <label className={`flex items-center justify-between cursor-pointer p-4 bg-slate-950/80 border rounded-2xl hover:border-indigo-500/20 hover:bg-slate-950 transition-all duration-300 ${
                                                calcAi ? 'border-indigo-500 bg-gradient-to-r from-indigo-500/5 to-transparent' : 'border-slate-850'
                                            }`}>
                                                <div className="flex gap-3 items-center">
                                                    <div className={`p-2.5 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20`}>
                                                        <Zap size={16} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-bold text-slate-200 block flex items-center gap-1">
                                                            AI Commissioner Newsletter
                                                            <UpgradeTooltip 
                                                                title="AI commissioner" 
                                                                description="Generates weekly recaps, round-by-round highlights, and humorous trash-talking articles automatically. Uses state-of-the-art Gemini AI tailored exactly to your pool's rules and active standings."
                                                            />
                                                        </span>
                                                        <span className="text-xs text-slate-500">Auto-generate trash-talk posts & round recaps (+${config.features.aiCommissioner.addonPrice})</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={calcAi}
                                                    onChange={(e) => setCalcAi(e.target.checked)}
                                                    className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                                                />
                                            </label>
                                        )}
 
                                        {config.features.smsNotifications?.isPremium && (
                                            <label className={`flex items-center justify-between cursor-pointer p-4 bg-slate-950/80 border rounded-2xl hover:border-indigo-500/20 hover:bg-slate-950 transition-all duration-300 ${
                                                calcSms ? 'border-indigo-500 bg-gradient-to-r from-indigo-500/5 to-transparent' : 'border-slate-850'
                                            }`}>
                                                <div className="flex gap-3 items-center">
                                                    <div className={`p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20`}>
                                                        <Users size={16} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-bold text-slate-200 block flex items-center gap-1">
                                                            Smart SMS Broadcasts
                                                            <UpgradeTooltip 
                                                                title="smart sms broadcasts" 
                                                                description="Keeps your players active and engaged! Automatically sends SMS notifications to all players when bracket locks are near, pick deadlines approach, payouts are declared, or scores change."
                                                            />
                                                        </span>
                                                        <span className="text-xs text-slate-500">Deliver text alert pick deadlines & payouts (+${config.features.smsNotifications?.addonPrice})</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={calcSms}
                                                    onChange={(e) => setCalcSms(e.target.checked)}
                                                    className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                                                />
                                            </label>
                                        )}
 
                                        {config.features.whatIfSimulator.isPremium && (
                                            <label className={`flex items-center justify-between cursor-pointer p-4 bg-slate-950/80 border rounded-2xl hover:border-indigo-500/20 hover:bg-slate-950 transition-all duration-300 ${
                                                calcSim ? 'border-indigo-500 bg-gradient-to-r from-indigo-500/5 to-transparent' : 'border-slate-850'
                                            }`}>
                                                <div className="flex gap-3 items-center">
                                                    <div className={`p-2.5 rounded-xl bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20`}>
                                                        <CheckCircle size={16} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-bold text-slate-200 block flex items-center gap-1">
                                                            Standings What-If Simulator
                                                            <UpgradeTooltip 
                                                                title="what-if standings simulator" 
                                                                description="Enables the interactive simulator dashboard for all players! Participants can model future match outcomes and instantly visualize changes in standings and potential cash payouts."
                                                            />
                                                        </span>
                                                        <span className="text-xs text-slate-500">Interactive live scenarios modeling standings (+${config.features.whatIfSimulator.addonPrice})</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={calcSim}
                                                    onChange={(e) => setCalcSim(e.target.checked)}
                                                    className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
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
                            <div className="bg-gradient-to-r from-emerald-600/10 to-indigo-600/10 border border-emerald-500/20 p-5 rounded-2xl space-y-2">
                                <h4 className="text-sm font-black text-white uppercase flex items-center gap-1.5">
                                    <Sparkles size={16} className="text-amber-400" /> Pay For Selected Pool
                                </h4>
                                <div className="text-xs text-slate-400 leading-relaxed">
                                    You are preparing checkout for: <strong className="text-white font-mono">{selectedPoolData.name}</strong>.
                                    Applying a validated coupon below updates your Stripe session total immediately!
                                </div>
                            </div>
                        ) : (
                            <div className="bg-slate-900 border border-slate-850 p-5 rounded-2xl space-y-2">
                                <h4 className="text-xs font-black text-slate-500 uppercase flex items-center gap-1.5">
                                    <InfoIcon size={14} className="text-indigo-400" /> Interactive Quote Mode
                                </h4>
                                <p className="text-xs text-slate-400 leading-relaxed">
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
                                className="w-full bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800 hover:border-slate-700 py-4 px-6 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 group hover:scale-[1.01]"
                            >
                                Launch a New Pool Instead
                                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Packages & Bundles Section */}
                <div className="mt-20 border-t border-slate-900 pt-16 space-y-10 animate-in fade-in duration-300">
                    <div className="text-center max-w-2xl mx-auto space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 shadow-sm bg-amber-500/10 border border-amber-500/20">
                            <Sparkles size={14} className="text-amber-400" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-300">Commissioner Packages</span>
                        </div>
                        <h2 className="text-3xl font-black text-white" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                            Multi-Pool Bundles & Commissioner Packages
                        </h2>
                        <p className="text-sm text-slate-400 leading-relaxed font-medium">
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
                                    <div key={b.id} className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 md:p-8 relative overflow-hidden backdrop-blur-md flex flex-col justify-between hover:border-indigo-500/40 transition-all duration-300 shadow-xl group hover:scale-[1.02] hover:-translate-y-1">
                                        <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-indigo-500/5 blur-2xl pointer-events-none" />
                                        <div className="space-y-4">
                                            <span className="bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-[10px] font-black uppercase px-2.5 py-1 rounded-full inline-block">
                                                {badgeLabel}
                                            </span>
                                            <h3 className="text-xl font-bold text-white">{b.name}</h3>
                                            <p className="text-xs text-slate-400 leading-relaxed min-h-[48px]">
                                                {b.description}
                                            </p>
                                            
                                            {/* Constraints Info */}
                                            <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-850 space-y-2 text-[10px] font-mono text-slate-400">
                                                <div className="flex justify-between">Format: <strong className="text-white">{b.poolType}</strong></div>
                                                <div className="flex justify-between">Max size per pool: <strong className="text-white">{b.maxPlayersPerPool === 9999 ? 'Unlimited' : `${b.maxPlayersPerPool} players`}</strong></div>
                                                <div className="flex justify-between">Validity: <strong className="text-white">{b.durationDays === 0 ? 'No expiration' : `${b.durationDays} days`}</strong></div>
                                            </div>

                                            <div className="pt-2 flex items-baseline gap-1.5">
                                                <span className="text-3xl font-black text-white">${Number(b.price).toFixed(2)}</span>
                                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
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
                                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-6 rounded-2xl text-xs transition-all shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 group/btn"
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
                                <div className="bg-slate-900/40 border border-indigo-500/15 p-6 md:p-8 rounded-3xl relative overflow-hidden backdrop-blur-md flex flex-col justify-between hover:border-indigo-500/40 transition-all duration-300 shadow-xl group hover:scale-[1.02] hover:-translate-y-1">
                                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-indigo-500/5 blur-2xl pointer-events-none" />
                                    <div className="space-y-4">
                                        <span className="bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-[10px] font-black uppercase px-2.5 py-1 rounded-full inline-block">
                                            Most Popular Bundle
                                        </span>
                                        <h3 className="text-xl font-bold text-white">3-Pool Credits Package</h3>
                                        <p className="text-xs text-slate-400 leading-relaxed font-medium">
                                            Purchase 3 premium pool hosting credits upfront. Use them anytime to instantly upgrade any format (Season, Bracket, Squares, Props) to Premium. Credits never expire!
                                        </p>
                                        
                                        <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-850 space-y-2 text-[10px] font-mono text-slate-400">
                                            <div className="flex justify-between">Credits: <strong className="text-white">3 Pools Included</strong></div>
                                            <div className="flex justify-between">Validity: <strong className="text-white">Never Expires</strong></div>
                                            <div className="flex justify-between">Pool Formats: <strong className="text-white">Universal</strong></div>
                                        </div>

                                        <div className="pt-2 flex items-baseline gap-1.5">
                                            <span className="text-3xl font-black text-white">${(config.packages?.buy_3 ?? 49.00).toFixed(2)}</span>
                                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">one-time (${((config.packages?.buy_3 ?? 49.00) / 3).toFixed(2)} / pool)</span>
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
                                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-6 rounded-2xl text-xs transition-all shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 group/btn"
                                        >
                                            Purchase 3-Pool Credits Bundle
                                            <ArrowRight size={12} className="group-hover/btn:translate-x-0.5 transition-transform" />
                                        </button>
                                    </div>
                                </div>

                                {/* Package 2: Unlimited Annual Pass */}
                                <div className="bg-slate-900/40 border border-amber-500/15 p-6 md:p-8 rounded-3xl relative overflow-hidden backdrop-blur-md flex flex-col justify-between hover:border-amber-500/40 transition-all duration-300 shadow-xl group hover:scale-[1.02] hover:-translate-y-1">
                                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-amber-500/5 blur-2xl pointer-events-none" />
                                    <div className="space-y-4">
                                        <span className="bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[10px] font-black uppercase px-2.5 py-1 rounded-full inline-block">
                                            Unlimited Access
                                        </span>
                                        <h3 className="text-xl font-bold text-white">1-Year Unlimited Pool Pass</h3>
                                        <p className="text-xs text-slate-400 leading-relaxed font-medium">
                                            Unlock absolute freedom! Create and host unlimited pools of any format with unlimited participants for a full 365 days. Perfect for corporate leagues and multi-format clubs.
                                        </p>

                                        <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-850 space-y-2 text-[10px] font-mono text-slate-400">
                                            <div className="flex justify-between">Pool Limit: <strong className="text-white">Unlimited pools</strong></div>
                                            <div className="flex justify-between">Duration: <strong className="text-white">365 Days</strong></div>
                                            <div className="flex justify-between">Size Limit: <strong className="text-white">Unlimited players</strong></div>
                                        </div>

                                        <div className="pt-2 flex items-baseline gap-1.5">
                                            <span className="text-3xl font-black text-white">${(config.packages?.unlimited_1yr ?? 129.00).toFixed(2)}</span>
                                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">billed annually</span>
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
                                            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold py-3.5 px-6 rounded-2xl text-xs transition-all shadow-md shadow-amber-500/10 flex items-center justify-center gap-1.5 group/btn"
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
