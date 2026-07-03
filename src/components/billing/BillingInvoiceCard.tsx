import React, { useState, useEffect } from 'react';
import { db, auth } from '../../firebase';
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { dbService } from '../../services/dbService';
import { 
    Ticket, CheckCircle, AlertTriangle, ShieldCheck, 
    CreditCard, ArrowRight, Sparkles
} from 'lucide-react';
import type { BillingConfig, Coupon } from '../../types';

interface BillingInvoiceCardProps {
    poolId?: string;
    poolName: string;
    poolType: string;
    estimatedPlayers: number;
    hasAiCommissioner?: boolean;
    hasWhatIfSimulator?: boolean;
    hasCustomBranding?: boolean; // NEW
    hasSmsNotifications?: boolean;
    isWizard?: boolean;
    pricePaid?: number; // NEW
    onTosAcceptChange?: (accepted: boolean) => void;
    onCouponAppliedChange?: (couponCode: string | null, finalPrice: number) => void;
    initialCouponCode?: string;
    onFeatureToggle?: (featureKey: 'aiCommissioner' | 'whatIfSimulator' | 'customBranding' | 'smsNotifications', enabled: boolean) => void; // NEW
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
        whatIfSimulator: { isPremium: true, addonPrice: 9 },
        customBranding: { isPremium: true, addonPrice: 29 }
    }
};

export const BillingInvoiceCard: React.FC<BillingInvoiceCardProps> = ({
    poolId,
    poolName,
    poolType,
    estimatedPlayers,
    hasAiCommissioner = false,
    hasWhatIfSimulator = false,
    hasCustomBranding = true, // Default to true as custom branding is standard/premium depending on config
    isWizard = false,
    pricePaid = 0, // NEW
    onTosAcceptChange,
    onCouponAppliedChange,
    initialCouponCode = '',
    onFeatureToggle
}) => {
    const [config, setConfig] = useState<BillingConfig>(DEFAULT_BILLING_CONFIG);
    const [couponInput, setCouponInput] = useState(initialCouponCode);
    const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
    const [couponError, setCouponError] = useState<string | null>(null);
    const [couponSuccess, setCouponSuccess] = useState<string | null>(null);
    const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);
    const [tosAccepted, setTosAccepted] = useState(false);

    // Local addon selection states for the Setup Wizard (Included in trial!)
    const [localAi, setLocalAi] = useState(hasAiCommissioner);
    const [localSim, setLocalSim] = useState(hasWhatIfSimulator);
    const [localBranding, setLocalBranding] = useState(hasCustomBranding);

    useEffect(() => {
        setLocalAi(hasAiCommissioner);
    }, [hasAiCommissioner]);

    useEffect(() => {
        setLocalSim(hasWhatIfSimulator);
    }, [hasWhatIfSimulator]);

    useEffect(() => {
        setLocalBranding(hasCustomBranding);
    }, [hasCustomBranding]);

    const handleToggleFeature = (key: 'aiCommissioner' | 'whatIfSimulator' | 'customBranding', enabled: boolean) => {
        if (key === 'aiCommissioner') setLocalAi(enabled);
        if (key === 'whatIfSimulator') setLocalSim(enabled);
        if (key === 'customBranding') setLocalBranding(enabled);
        
        if (onFeatureToggle) {
            onFeatureToggle(key, enabled);
        }
    };
    const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
    const [checkoutCancelled, setCheckoutCancelled] = useState(false);

    // Detect a cancelled/abandoned Stripe Checkout. The server (createCheckoutSession)
    // appends `payment=cancelled` to the cancelUrl we pass (window.location.href),
    // so returning here without completing payment lands with that query param.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('payment') === 'cancelled') {
            setCheckoutCancelled(true);
            // Clean the param so a refresh doesn't re-show the notice
            params.delete('payment');
            const cleaned = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
            window.history.replaceState({}, '', cleaned);
        }
    }, []);
    const [managerProfile, setManagerProfile] = useState<any>(null);
    const [activeFreePoolsCount, setActiveFreePoolsCount] = useState(0);
    const [useCredit, setUseCredit] = useState(false);
    const [activePaymentTab, setActivePaymentTab] = useState<'single' | 'bundle'>('single');

    useEffect(() => {
        const unsubscribeAuth = auth.onAuthStateChanged((usr) => {
            if (usr) {
                const docRef = doc(db, 'users', usr.uid);
                const unsubDoc = onSnapshot(docRef, (snap) => {
                    if (snap.exists()) {
                        setManagerProfile(snap.data());
                    } else {
                        setManagerProfile(null);
                    }
                });
                return () => unsubDoc();
            } else {
                setManagerProfile(null);
            }
        });
        return () => unsubscribeAuth();
    }, []);

    useEffect(() => {
        const unsubscribeAuth = auth.onAuthStateChanged((usr) => {
            if (usr) {
                const q = query(
                    collection(db, 'pools'),
                    where('ownerId', '==', usr.uid),
                    where('billing.status', '==', 'active'),
                    where('billing.tier', '==', 'free_tier')
                );
                const unsub = onSnapshot(q, (snap) => {
                    const otherFreePools = snap.docs.filter(doc => doc.id !== poolId);
                    setActiveFreePoolsCount(otherFreePools.length);
                });
                return () => unsub();
            } else {
                setActiveFreePoolsCount(0);
            }
        });
        return () => unsubscribeAuth();
    }, [poolId]);

    // Subscribe to database billing configuration
    useEffect(() => {
        const docRef = doc(db, 'settings', 'billing_config');
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setConfig(docSnap.data() as BillingConfig);
            }
        }, (err) => {
            console.warn('[BillingInvoiceCard] Failed to fetch live billing config, using defaults:', err);
        });
        return () => unsubscribe();
    }, []);

    // Calculate Pricing based on configuration rules
    const getBasePrice = () => {
        const pType = poolType.toUpperCase();
        const players = Number(estimatedPlayers) || 0;

        // Free tier exemption
        if (players <= config.freePlayerThreshold) {
            return 0;
        }

        let tiers: any[] = [];
        if (pType === 'SQUARES') {
            tiers = config.pricing.squares || [];
        } else if (pType === 'PROPS') {
            tiers = config.pricing.props || [];
        } else if (pType === 'BRACKET' || pType === 'NFL_PLAYOFFS') {
            tiers = config.pricing.bracket || [];
        } else {
            tiers = config.pricing.season || [];
        }

        const matched = (Array.isArray(tiers) ? tiers : []).find(t => players >= t.min && players <= t.max);
        if (matched) return matched.price;

        if (Array.isArray(tiers) && tiers.length > 0) {
            const sorted = [...tiers].sort((a, b) => b.min - a.min);
            return sorted[0].price;
        }

        return 0;
    };

    const basePrice = getBasePrice();

    // Features add-on cost (only charged if marked as premium in active config)
    const aiCost = (localAi && config.features.aiCommissioner?.isPremium) ? config.features.aiCommissioner.addonPrice : 0;
    const simCost = (localSim && config.features.whatIfSimulator?.isPremium) ? config.features.whatIfSimulator.addonPrice : 0;
    const brandingCost = (localBranding && config.features.customBranding?.isPremium) ? config.features.customBranding.addonPrice : 0;
    
    // Pro-rate the subtotal
    const subtotalRaw = basePrice + aiCost + simCost + brandingCost;
    const subtotal = Math.max(0, subtotalRaw - pricePaid);

    const hasUnlimitedPass = !!(managerProfile?.activeBundleType === 'unlimited_1yr' && managerProfile?.bundleExpiresAt && managerProfile.bundleExpiresAt > Date.now());
    const freePoolsAvailable = managerProfile?.freePoolsAvailable || 0;

    // Scan poolCredits array for any matching eligible credits
    const getEligibleCustomCredit = () => {
        if (!Array.isArray(managerProfile?.poolCredits)) return null;
        
        const normalizedType = poolType.toUpperCase();
        const playersCount = Number(estimatedPlayers) || 0;
        
        return managerProfile.poolCredits.find((c: any) => {
            if (c.isUsed) return false;
            if (c.expiresAt && c.expiresAt < Date.now()) return false;
            
            // Match poolType restriction
            const matchesType = c.poolType === 'ALL' || c.poolType === normalizedType;
            // Match player size constraint
            const matchesSize = playersCount <= c.maxPlayersPerPool;
            
            return matchesType && matchesSize;
        });
    };

    const eligibleCredit = getEligibleCustomCredit();

    // Apply Coupon discount
    const getDiscountAmount = () => {
        if (!appliedCoupon) return 0;
        if (appliedCoupon.discountType === 'percentage') {
            return subtotal * (appliedCoupon.discountValue / 100);
        }
        return appliedCoupon.discountValue;
    };

    const discount = Math.min(subtotal, getDiscountAmount());
    const standardTotal = Math.max(0, subtotal - discount);
    const total = (hasUnlimitedPass || (useCredit && (freePoolsAvailable > 0 || !!eligibleCredit))) ? 0 : standardTotal;

    // Notify parent when prices or coupons change
    useEffect(() => {
        if (onCouponAppliedChange) {
            onCouponAppliedChange(appliedCoupon?.code || null, total);
        }
    }, [appliedCoupon, total, onCouponAppliedChange]);

    // Reusable Coupon Application & Verification
    const applyCouponCode = async (codeToApply: string) => {
        if (!codeToApply.trim()) return;

        setIsValidatingCoupon(true);
        setCouponError(null);
        setCouponSuccess(null);

        try {
            const code = codeToApply.toUpperCase().trim();
            const q = query(collection(db, 'coupons'), where('code', '==', code));
            const snap = await getDocs(q);

            if (snap.empty) {
                setCouponError('Invalid coupon code.');
                setAppliedCoupon(null);
                return;
            }

            const coupon = { id: snap.docs[0].id, ...snap.docs[0].data() } as Coupon;
            const now = Date.now();

            // Client-side validations matching backend rules
            if (!coupon.isActive) {
                setCouponError('This coupon is no longer active.');
                setAppliedCoupon(null);
                return;
            }
            if (coupon.expiresAt && coupon.expiresAt < now) {
                setCouponError('This coupon has expired.');
                setAppliedCoupon(null);
                return;
            }
            if (coupon.maxUses !== undefined && coupon.usesCount >= coupon.maxUses) {
                setCouponError('This coupon has reached its maximum uses.');
                setAppliedCoupon(null);
                return;
            }
            if (coupon.allowedPoolTypes && coupon.allowedPoolTypes.length > 0) {
                const normalizedType = poolType.toUpperCase();
                if (!coupon.allowedPoolTypes.includes(normalizedType as any)) {
                    setCouponError(`This coupon is not valid for ${poolType} pools.`);
                    setAppliedCoupon(null);
                    return;
                }
            }

            // Success!
            setAppliedCoupon(coupon);
            const discountDesc = coupon.discountType === 'percentage' 
                ? `${coupon.discountValue}% off` 
                : `$${coupon.discountValue} off`;
            setCouponSuccess(`Success! Applied ${discountDesc} to your order.`);
        } catch (err: any) {
            console.error('[BillingInvoiceCard] Coupon error:', err);
            setCouponError('Error validating coupon. Please try again.');
            setAppliedCoupon(null);
        } finally {
            setIsValidatingCoupon(false);
        }
    };

    // Auto-apply initialCouponCode whenever it is changed or provided
    useEffect(() => {
        if (initialCouponCode) {
            setCouponInput(initialCouponCode);
            applyCouponCode(initialCouponCode);
        } else {
            setAppliedCoupon(null);
            setCouponInput('');
            setCouponSuccess(null);
            setCouponError(null);
        }
    }, [initialCouponCode, poolType]);

    // Handle manual form Coupon Code Verification
    const handleApplyCoupon = async (e: React.FormEvent) => {
        e.preventDefault();
        await applyCouponCode(couponInput);
    };

    const handleRemoveCoupon = () => {
        setAppliedCoupon(null);
        setCouponInput('');
        setCouponSuccess(null);
        setCouponError(null);
    };

    // TOS Accept Handle
    const handleTosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const accepted = e.target.checked;
        setTosAccepted(accepted);
        if (onTosAcceptChange) {
            onTosAcceptChange(accepted);
        }
    };

    // Stripe Checkout Trigger
    const handleCheckout = async () => {
        if (!poolId) {
            setCheckoutError('Pool ID is missing. Cannot proceed to checkout.');
            return;
        }

        setIsCheckoutLoading(true);
        setCheckoutError(null);
        setCheckoutCancelled(false);

        try {
            const response = await dbService.createCheckoutSession({
                poolId,
                poolName,
                poolType,
                tier: (basePrice === 0 && subtotal === 0 && !useCredit && !hasUnlimitedPass) ? 'free_tier' : 'premium_tier',
                price: total,
                couponCode: appliedCoupon?.code || undefined,
                maxPlayersAllowed: estimatedPlayers,
                usedCredit: useCredit,
                customCreditId: (useCredit && eligibleCredit) ? eligibleCredit.id : undefined,
                successUrl: `${window.location.origin}/payment-success?poolId=${poolId}`,
                cancelUrl: window.location.href
            } as any);

            if (response?.sessionUrl) {
                // Redirect securely to Stripe Sandbox
                window.location.href = response.sessionUrl;
            } else {
                setCheckoutError('Failed to generate checkout session url.');
            }
        } catch (err: any) {
            console.error('[BillingInvoiceCard] Checkout Error:', err);
            setCheckoutError(err.message || 'Stripe redirect failed. Please try again.');
        } finally {
            setIsCheckoutLoading(false);
        }
    };

    return (
        <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-2xl p-6 md:p-8 space-y-6 shadow-2xl relative overflow-hidden text-left font-sans">
            {/* Ambient Background Accent */}
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-indigo-500/5 blur-3xl pointer-events-none" />
            
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <CreditCard className="text-indigo-400" size={22} />
                        Monetization Summary
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">Itemized pricing based on monetization rules</p>
                </div>
                {basePrice === 0 && estimatedPlayers <= config.freePlayerThreshold && (
                    <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase px-2.5 py-1 rounded-full flex items-center gap-1">
                        <Sparkles size={10} /> Free Pool Exempt
                    </span>
                )}
            </div>

            {/* Tab Selector */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950/80 rounded-xl border border-slate-850">
                <button
                    type="button"
                    onClick={() => setActivePaymentTab('single')}
                    className={`py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                        activePaymentTab === 'single'
                            ? 'bg-indigo-600 text-white shadow-lg'
                            : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                    <CreditCard size={14} />
                    Single Pool Hosting
                </button>
                <button
                    type="button"
                    onClick={() => setActivePaymentTab('bundle')}
                    className={`py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                        activePaymentTab === 'bundle'
                            ? 'bg-indigo-600 text-white shadow-lg'
                            : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                    <Sparkles size={14} className={activePaymentTab === 'bundle' ? 'text-amber-300' : 'text-slate-400'} />
                    Multi-Pool Bundle & Save
                </button>
            </div>

            {/* Cancelled / abandoned checkout notice (shown on both tabs) */}
            {checkoutCancelled && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-xl flex items-start gap-2.5 animate-in fade-in duration-300">
                    <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-left">
                        <strong className="text-amber-300 block font-bold">Checkout wasn't completed</strong>
                        <p className="text-slate-300 leading-relaxed mt-0.5">
                            No charge was made. If checkout doesn't complete, you can retry anytime — your pool stays in its current state until payment succeeds. Just use the payment button below when you're ready.
                        </p>
                    </div>
                </div>
            )}

            {activePaymentTab === 'single' ? (
                <div className="space-y-6 animate-in fade-in duration-300">
                    {/* Credits or Unlimited Annual Pass Banner */}
                    {hasUnlimitedPass && (
                        <div className="bg-gradient-to-r from-emerald-500/10 to-indigo-500/10 border border-emerald-500/20 rounded-xl p-4 flex gap-3 items-center animate-in fade-in duration-300">
                            <Sparkles className="text-emerald-400 shrink-0" size={20} />
                            <div className="text-xs">
                                <strong className="text-white block">✨ 1-Year Unlimited Pass Active!</strong>
                                <p className="text-slate-400">All pool creations and upgrades are 100% free under your annual pass.</p>
                            </div>
                        </div>
                    )}

                    {!hasUnlimitedPass && (freePoolsAvailable > 0 || !!eligibleCredit) && (
                        <label className="bg-slate-950/60 hover:bg-slate-950 border border-indigo-500/25 rounded-xl p-4 flex gap-3 items-center cursor-pointer transition-all animate-in fade-in duration-300">
                            <input
                                type="checkbox"
                                checked={useCredit}
                                onChange={(e) => setUseCredit(e.target.checked)}
                                className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                            />
                            <div className="text-xs">
                                <strong className="text-white block flex items-center gap-1">
                                    🎁 Apply Reusable Pool Credit {eligibleCredit ? `(${eligibleCredit.poolType} credit matched!)` : `(${freePoolsAvailable} Available)`}
                                </strong>
                                <p className="text-slate-400">
                                    {eligibleCredit 
                                        ? `Check this box to apply your custom ${eligibleCredit.poolType} Credit and activate this pool for free.` 
                                        : 'Check this box to apply 1 universal credit and activate this pool for free.'
                                    }
                                </p>
                            </div>
                        </label>
                    )}

                    {/* Trial Banner */}
                    {isWizard && (
                        <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-xl p-4 flex gap-3 items-start animate-in fade-in duration-300">
                            <ShieldCheck className="text-indigo-400 shrink-0 mt-0.5" size={20} />
                            <div className="text-xs space-y-1">
                                <strong className="text-white block">🚀 14-Day Free Trial Included!</strong>
                                <p className="text-slate-400 leading-relaxed">
                                    Your pool will launch instantly in an active trial state. Invite your friends, run drafts, and configure rules. You can complete hosting payment anytime during the 14 days!
                                </p>
                            </div>
                        </div>
                    )}

                    {/* 1 Free Pool Limit Warning */}
                    {basePrice === 0 && subtotal === 0 && !useCredit && !hasUnlimitedPass && activeFreePoolsCount > 0 && (
                        <div className="bg-gradient-to-r from-rose-500/15 to-orange-500/15 border border-rose-500/30 rounded-xl p-4 flex gap-3 items-start animate-in fade-in duration-300">
                            <AlertTriangle className="text-rose-400 shrink-0 mt-0.5" size={20} />
                            <div className="text-xs space-y-1">
                                <strong className="text-rose-400 block font-bold">⚠️ Active Free Pool Limit Reached</strong>
                                <p className="text-slate-300 leading-relaxed">
                                    March Melee Pools allows commissioners **exactly one active free pool** (10 or fewer players) at a time. You already have an active free pool. 
                                    To activate this pool, you must **upgrade it to a Premium tier** (by sliding estimated players above 10 or adding features), use a Pool Credit, or archive your other free pool in your dashboard.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Optional Trial Upgrades & Add-ons */}
                    {isWizard && (
                        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 space-y-3">
                            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5 text-indigo-400 animate-pulse">
                                <Sparkles size={14} /> Optional Trial Upgrades & Add-ons
                            </h4>
                            <p className="text-[11px] text-slate-400 leading-normal">
                                Toggle premium addons for your pool trial. They are <strong className="text-emerald-400">100% FREE during the 14-day trial</strong> so you can test them out! If you decide to keep them, they'll be included when you eventually upgrade.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                {[
                                    { key: 'aiCommissioner' as const, label: '🤖 AI Commissioner', desc: 'Auto trash-talk, weekly reviews, and dispute resolution.', value: localAi },
                                    ...( poolType.toUpperCase() === 'BRACKET' ? [{ key: 'whatIfSimulator' as const, label: '📊 What-If Simulator', desc: 'Interactively simulate potential game results to view projected standings.', value: localSim }] : [] ),
                                    { key: 'customBranding' as const, label: '🎨 Custom Branding', desc: 'Upload headers, customized color schemes, and manager logos.', value: localBranding }
                                ].map(({ key, label, desc, value }) => {
                                    const feat = config.features[key];
                                    // Only display if explicitly turned on (isPremium is true) in the superadmin settings
                                    if (!feat || !feat.isPremium) return null;

                                    return (
                                        <label key={key} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-905 border border-slate-850 hover:border-slate-750 cursor-pointer transition-all hover:bg-slate-900/80 group">
                                            <input 
                                                type="checkbox" 
                                                checked={!!value}
                                                onChange={(e) => handleToggleFeature(key, e.target.checked)}
                                                className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                            />
                                            <div className="flex-grow space-y-0.5 select-none text-left">
                                                <div className="flex justify-between items-center gap-1">
                                                    <span className="text-[11px] font-bold text-slate-200 group-hover:text-white transition-colors">{label}</span>
                                                    <span className="text-[9px] font-mono text-indigo-400 font-bold bg-indigo-500/10 px-1 rounded shrink-0">
                                                        +${feat.addonPrice}
                                                    </span>
                                                </div>
                                                <p className="text-[9px] text-slate-500 leading-normal">{desc}</p>
                                                <span className="text-[8px] text-emerald-400 font-extrabold uppercase tracking-wide block">FREE IN TRIAL</span>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Itemized Table */}
                    <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-850 space-y-3 font-medium text-sm text-left">
                        <div className="flex justify-between items-center text-slate-300">
                            <span>Base Hosting fee ({estimatedPlayers} estimated players)</span>
                            <span className="text-white font-mono">
                                {basePrice === 0 ? 'FREE' : `$${basePrice.toFixed(2)}`}
                            </span>
                        </div>

                        {localAi && config.features.aiCommissioner?.isPremium && (
                            <div className="flex justify-between items-center text-slate-400 text-xs">
                                <span className="flex items-center gap-1">✦ AI Trash-Talk Commissioner Addon</span>
                                <span className="text-white font-mono">
                                    +${aiCost.toFixed(2)} {isWizard && <span className="text-emerald-400 font-extrabold text-[9px] ml-1 bg-emerald-500/10 px-1.5 py-0.5 rounded">(FREE IN TRIAL)</span>}
                                </span>
                            </div>
                        )}
                        {localSim && config.features.whatIfSimulator?.isPremium && (
                            <div className="flex justify-between items-center text-slate-400 text-xs">
                                <span className="flex items-center gap-1">✦ What-If Standings Simulator</span>
                                <span className="text-white font-mono">
                                    +${simCost.toFixed(2)} {isWizard && <span className="text-emerald-400 font-extrabold text-[9px] ml-1 bg-emerald-500/10 px-1.5 py-0.5 rounded">(FREE IN TRIAL)</span>}
                                </span>
                            </div>
                        )}
                        {localBranding && config.features.customBranding?.isPremium && (
                            <div className="flex justify-between items-center text-slate-400 text-xs">
                                <span className="flex items-center gap-1">✦ Premium Custom Branding & Covers</span>
                                <span className="text-white font-mono">
                                    +${brandingCost.toFixed(2)} {isWizard && <span className="text-emerald-400 font-extrabold text-[9px] ml-1 bg-emerald-500/10 px-1.5 py-0.5 rounded">(FREE IN TRIAL)</span>}
                                </span>
                            </div>
                        )}
                        
                        {pricePaid > 0 && (
                            <div className="flex justify-between items-center text-slate-400 text-xs border-t border-dashed border-slate-800 pt-2 animate-in fade-in duration-200">
                                <span className="flex items-center gap-1">✦ Previous Payments Credit</span>
                                <span className="text-emerald-400 font-mono">-${pricePaid.toFixed(2)}</span>
                            </div>
                        )}

                        {appliedCoupon && (
                            <div className="flex justify-between items-center text-emerald-400 text-xs border-t border-dashed border-slate-800 pt-2">
                                <span>Discount Code applied ({appliedCoupon.code})</span>
                                <span className="font-mono">-${discount.toFixed(2)}</span>
                            </div>
                        )}

                        <div className="flex justify-between items-center border-t border-slate-800 pt-3 mt-1 text-white font-bold">
                            <span className="text-base">Upgrade Premium Total</span>
                            <span className="text-lg text-indigo-400 font-mono">
                                {total === 0 ? 'FREE' : `$${total.toFixed(2)}`}
                            </span>
                        </div>

                        {isWizard && (
                            <div className="flex justify-between items-center border-t border-dashed border-slate-800 pt-2.5 text-emerald-400 font-extrabold text-sm bg-slate-900/50 -mx-4 -mb-4 p-4 rounded-b-xl">
                                <span className="flex items-center gap-1">💰 Due Today (14-Day Free Trial)</span>
                                <span className="text-base bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded shadow-lg shadow-emerald-500/10 font-mono">
                                    $0.00 FREE
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Coupon Code Input */}
                    <form onSubmit={handleApplyCoupon} className="space-y-2">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Have a promo coupon code?
                        </label>
                        <div className="flex gap-2">
                            <div className="relative flex-grow">
                                <Ticket className="absolute left-3 top-3 text-slate-500" size={16} />
                                <input
                                    type="text"
                                    value={couponInput}
                                    onChange={(e) => setCouponInput(e.target.value)}
                                    disabled={appliedCoupon !== null || isValidatingCoupon}
                                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl pl-9 pr-4 py-2.5 text-white text-xs outline-none uppercase font-mono disabled:opacity-50"
                                    placeholder="e.g. MELEEFREE"
                                />
                            </div>
                            {appliedCoupon ? (
                                <button
                                    type="button"
                                    onClick={handleRemoveCoupon}
                                    className="bg-slate-800 hover:bg-rose-900 hover:text-white text-slate-300 text-xs px-4 py-2 rounded-xl transition-all font-bold animate-in fade-in"
                                >
                                    Remove
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={isValidatingCoupon || !couponInput.trim()}
                                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white text-xs px-5 py-2.5 rounded-xl transition-all font-bold shrink-0 shadow-lg shadow-indigo-600/15"
                                >
                                    {isValidatingCoupon ? 'Verifying...' : 'Apply Code'}
                                </button>
                            )}
                        </div>

                        {couponError && (
                            <p className="text-[11px] text-rose-400 flex items-center gap-1 font-bold animate-in slide-in-from-top-1">
                                <AlertTriangle size={12} /> {couponError}
                            </p>
                        )}
                        {couponSuccess && (
                            <p className="text-[11px] text-emerald-400 flex items-center gap-1 font-bold animate-in slide-in-from-top-1">
                                <CheckCircle size={12} /> {couponSuccess}
                            </p>
                        )}
                    </form>

                    {/* Wizard Mode: TOS + Gating */}
                    {isWizard && (
                        <div className="space-y-4 pt-2 border-t border-slate-800">
                            <label className="flex items-start gap-3 cursor-pointer group text-left">
                                <input
                                    type="checkbox"
                                    checked={tosAccepted}
                                    onChange={handleTosChange}
                                    className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                                <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors leading-relaxed select-none">
                                    I have read, understood, and agree to the{' '}
                                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline inline-flex items-center gap-0.5">
                                        Terms of Service
                                    </a>{' '}
                                    and{' '}
                                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline inline-flex items-center gap-0.5">
                                        Privacy Policy
                                    </a>.
                                </span>
                            </label>
                        </div>
                    )}

                    {/* Direct Pay Mode: Checkout redirect */}
                    {!isWizard && (
                        <div className="space-y-4 pt-2 border-t border-slate-800">
                            {checkoutError && (
                                <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center gap-2">
                                    <AlertTriangle size={16} className="shrink-0" />
                                    <span>{checkoutError}</span>
                                </div>
                            )}
                            
                            <button
                                onClick={handleCheckout}
                                disabled={
                                    isCheckoutLoading || 
                                    !poolId || 
                                    (total <= 0 && (!appliedCoupon || subtotal === 0) && !useCredit && !hasUnlimitedPass) ||
                                    (basePrice === 0 && subtotal === 0 && !useCredit && !hasUnlimitedPass && activeFreePoolsCount > 0)
                                }
                                className={`w-full font-bold py-3.5 rounded-xl text-sm transition-all shadow-xl flex items-center justify-center gap-2 group hover:scale-[1.01] ${
                                    !poolId || (basePrice === 0 && subtotal === 0 && !useCredit && !hasUnlimitedPass && activeFreePoolsCount > 0)
                                        ? 'bg-slate-800 border border-slate-750 text-slate-400 cursor-not-allowed hover:scale-100'
                                        : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white hover:shadow-indigo-500/20 shadow-indigo-550/20'
                                }`}
                            >
                                {isCheckoutLoading ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        {total === 0 ? 'Activating pool...' : 'Redirecting to Stripe...'}
                                    </>
                                ) : (
                                    <>
                                        <CreditCard size={18} />
                                        {!poolId ? (
                                            'Select a Pool Above to Pay'
                                        ) : basePrice === 0 && subtotal === 0 && !useCredit && !hasUnlimitedPass && activeFreePoolsCount > 0 ? (
                                            'Free Limit Reached (Upgrade Needed)'
                                        ) : total === 0 ? (
                                            'Activate Pool (Free Allocation)'
                                        ) : (
                                            'Upgrade Pool to Premium'
                                        )}
                                        {poolId && !(basePrice === 0 && subtotal === 0 && !useCredit && !hasUnlimitedPass && activeFreePoolsCount > 0) && <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />}
                                    </>
                                )}
                            </button>
                            <p className="text-[10px] text-slate-500 text-center">
                                Transactions are processed securely in Stripe Sandbox. No real credit card charges will occur.
                            </p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-4 animate-in fade-in duration-300 text-left">
                    <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-xl p-4 flex gap-3 items-start">
                        <Sparkles className="text-amber-400 shrink-0 mt-0.5 animate-pulse" size={18} />
                        <div className="text-xs space-y-1">
                            <strong className="text-white block font-bold">✨ Multi-Pool Bundle Advantage!</strong>
                            <p className="text-slate-400 leading-relaxed">
                                Buy a pack of pool credits upfront to unlock substantial hosting discounts! Reusable pool credits never expire and can be applied instantly to activate/upgrade any pool format.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3.5 max-h-[380px] overflow-y-auto pr-1">
                        {Array.isArray(config.packagesList) && config.packagesList.filter(b => b.isActive).length > 0 ? (
                            config.packagesList.filter(b => b.isActive).map((b) => {
                                const isUnlimited = b.poolsIncluded >= 9999;
                                const badgeLabel = isUnlimited ? 'Unlimited Pass' : b.poolType === 'ALL' ? 'Universal Pack' : `${b.poolType} Pack`;
                                const pricePerPoolLabel = isUnlimited 
                                    ? 'unlimited hosting' 
                                    : `$${(b.price / b.poolsIncluded).toFixed(2)} / pool`;

                                return (
                                    <div key={b.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-indigo-500/40 transition-all shadow-md group">
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-[9px] font-black uppercase px-2 py-0.5 rounded">
                                                    {badgeLabel}
                                                </span>
                                                <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                                    SAVE OVER 35%
                                                </span>
                                            </div>
                                            <h4 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">{b.name}</h4>
                                            <p className="text-[11px] text-slate-400 leading-normal">
                                                {b.description}
                                            </p>
                                            
                                            <div className="grid grid-cols-2 gap-2 bg-slate-900/40 p-2 rounded-lg border border-slate-900 text-[9px] font-mono text-slate-400">
                                                <div>Format: <strong className="text-slate-200">{b.poolType}</strong></div>
                                                <div>Max size: <strong className="text-slate-200">{b.maxPlayersPerPool === 9999 ? 'Unlimited' : `${b.maxPlayersPerPool} players`}</strong></div>
                                            </div>

                                            <div className="pt-1 flex items-baseline gap-1">
                                                <span className="text-xl font-black text-white">${Number(b.price).toFixed(2)}</span>
                                                <span className="text-[9px] text-slate-500 font-medium">
                                                    ({pricePerPoolLabel})
                                                </span>
                                            </div>
                                        </div>
                                        <div className="pt-3">
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    setIsCheckoutLoading(true);
                                                    setCheckoutError(null);
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
                                                        } else {
                                                            setCheckoutError('Failed to generate checkout session.');
                                                        }
                                                    } catch (err: any) {
                                                        console.error("Bundle purchase failed:", err);
                                                        setCheckoutError(err.message || 'Failed to initiate bundle checkout.');
                                                    } finally {
                                                        setIsCheckoutLoading(false);
                                                    }
                                                }}
                                                disabled={isCheckoutLoading}
                                                className="w-full bg-indigo-650 hover:bg-indigo-600 text-white font-bold py-2.5 px-4 rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/15"
                                            >
                                                {isCheckoutLoading ? (
                                                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                ) : (
                                                    <>
                                                        Purchase {b.name}
                                                        <ArrowRight size={12} />
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <>
                                {/* Default 3-Pool Bundle */}
                                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-indigo-500/40 transition-all shadow-md group">
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-[9px] font-black uppercase px-2 py-0.5 rounded">
                                                Universal Pack
                                            </span>
                                            <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                                SAVE OVER 40%
                                            </span>
                                        </div>
                                        <h4 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">3-Pool Credits Package</h4>
                                        <p className="text-[11px] text-slate-400 leading-normal">
                                            Get 3 universal premium hosting credits upfront. Use them anytime to instantly activate/upgrade Season, Bracket, Squares, or Props pools. Credits never expire!
                                        </p>
                                        <div className="pt-1 flex items-baseline gap-1">
                                            <span className="text-xl font-black text-white">${(config.packages?.buy_3 ?? 49.00).toFixed(2)}</span>
                                            <span className="text-[9px] text-slate-500 font-medium">one-time (${((config.packages?.buy_3 ?? 49.00) / 3).toFixed(2)} / pool)</span>
                                        </div>
                                    </div>
                                    <div className="pt-3">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                setIsCheckoutLoading(true);
                                                setCheckoutError(null);
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
                                                    } else {
                                                        setCheckoutError('Failed to generate checkout session.');
                                                    }
                                                } catch (err: any) {
                                                    console.error("Bundle purchase failed:", err);
                                                    setCheckoutError(err.message || 'Failed to initiate bundle checkout.');
                                                } finally {
                                                    setIsCheckoutLoading(false);
                                                }
                                            }}
                                            disabled={isCheckoutLoading}
                                            className="w-full bg-indigo-650 hover:bg-indigo-600 text-white font-bold py-2.5 px-4 rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/15"
                                        >
                                            {isCheckoutLoading ? (
                                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                            ) : (
                                                <>
                                                    Purchase 3-Pool Bundle
                                                    <ArrowRight size={12} />
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Default Unlimited Pass */}
                                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-amber-500/40 transition-all shadow-md group">
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[9px] font-black uppercase px-2 py-0.5 rounded">
                                                Unlimited Access
                                            </span>
                                            <span className="text-[9px] font-mono text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded">
                                                BEST VALUE
                                            </span>
                                        </div>
                                        <h4 className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors">1-Year Unlimited Pass</h4>
                                        <p className="text-[11px] text-slate-400 leading-normal">
                                            Host unlimited pools of any format with unlimited participants for a full 365 days. Perfect for corporate leagues and multi-format clubs.
                                        </p>
                                        <div className="pt-1 flex items-baseline gap-1">
                                            <span className="text-xl font-black text-white">${(config.packages?.unlimited_1yr ?? 129.00).toFixed(2)}</span>
                                            <span className="text-[9px] text-slate-500 font-medium">billed annually</span>
                                        </div>
                                    </div>
                                    <div className="pt-3">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                setIsCheckoutLoading(true);
                                                setCheckoutError(null);
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
                                                    } else {
                                                        setCheckoutError('Failed to generate checkout session.');
                                                    }
                                                } catch (err: any) {
                                                    console.error("Bundle purchase failed:", err);
                                                    setCheckoutError(err.message || 'Failed to initiate bundle checkout.');
                                                } finally {
                                                    setIsCheckoutLoading(false);
                                                }
                                            }}
                                            disabled={isCheckoutLoading}
                                            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold py-2.5 px-4 rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/15"
                                        >
                                            {isCheckoutLoading ? (
                                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                            ) : (
                                                <>
                                                    Unlock 1-Year Unlimited Pass
                                                    <ArrowRight size={12} />
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {checkoutError && (
                        <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center gap-2">
                            <AlertTriangle size={16} className="shrink-0" />
                            <span>{checkoutError}</span>
                        </div>
                    )}
                    
                    <p className="text-[10px] text-slate-500 text-center">
                        Transactions are processed securely in Stripe Sandbox. No real credit card charges will occur.
                    </p>
                </div>
            )}
        </div>
    );
};
