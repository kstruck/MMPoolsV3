import React, { useState, useEffect } from 'react';
import type { User, Pool, PoolBilling, BillingConfig, Coupon, ReferralConfig } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';
import { db } from '../firebase';
import { 
    doc, updateDoc, onSnapshot, collection, 
    getDocs, query, where, increment 
} from 'firebase/firestore';
import { dbService } from '../services/dbService';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { 
    CheckCircle, Shield, Sparkles, ArrowRight, 
    Users, AlertCircle, CreditCard, Lock, Loader2, Info, Ticket, Gift, Award
} from 'lucide-react';

interface PricingPageProps {
    user?: User | null;
    isManager?: boolean;
    onLogin: () => void;
    onSignup: () => void;
    onLogout?: () => void;
    onCreatePool?: () => void;
    isLoggedIn: boolean;
}

type PoolCategory = 'season' | 'bracket' | 'squares';
type PlayerTier = 'tier1' | 'tier2' | 'tier3' | 'tier4';

const DEFAULT_BILLING_CONFIG: BillingConfig = {
    freePlayerThreshold: 10,
    gracePeriodDays: 7,
    pricing: {
        season: {
            tier1: { min: 11, max: 25, price: 29 },
            tier2: { min: 26, max: 50, price: 59 },
            tier3: { min: 51, max: 100, price: 99 },
            tier4: { min: 101, max: 9999, price: 149 }
        },
        bracket: {
            tier1: { min: 11, max: 25, price: 19 },
            tier2: { min: 26, max: 50, price: 39 },
            tier3: { min: 51, max: 100, price: 69 },
            tier4: { min: 101, max: 9999, price: 99 }
        },
        squares: {
            flatPrice: 9.99
        },
        props: {
            flatPrice: 9.99
        }
    },
    features: {
        aiCommissioner: { isPremium: true, addonPrice: 15 },
        smsNotifications: { isPremium: true, addonPrice: 15 },
        whatIfSimulator: { isPremium: true, addonPrice: 15 },
        customBranding: { isPremium: false, addonPrice: 0 }
    }
};

const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
    creditsRequiredForFreePool: 5,
    discountPerCredit: 5.00,
    rewardType: 'free_pool'
};

export const PricingPage: React.FC<PricingPageProps> = ({ 
    user, 
    isManager = false, 
    onLogin, 
    onSignup,
    onLogout, 
    onCreatePool,
    isLoggedIn 
}) => {
    const [activeCategory, setActiveCategory] = useState<PoolCategory>('season');
    const [myPools, setMyPools] = useState<Pool[]>([]);
    const [selectedPoolId, setSelectedPoolId] = useState<string>('');
    const [playerRange, setPlayerRange] = useState<PlayerTier>('tier2'); // default 26-50 players
    const [loadingPools, setLoadingPools] = useState<boolean>(false);
    
    // Live configurations from Super-Admin Panel
    const [billingConfig, setBillingConfig] = useState<BillingConfig>(DEFAULT_BILLING_CONFIG);
    const [referralConfig, setReferralConfig] = useState<ReferralConfig>(DEFAULT_REFERRAL_CONFIG);
    
    // Live User details (to load referral balances)
    const [currentUserDetails, setCurrentUserDetails] = useState<User | null>(null);

    const [selectedAddons, setSelectedAddons] = useState<Record<string, boolean>>({
        aiCommissioner: true,
        smsNotifications: true,
        whatIfSimulator: true,
        customBranding: false
    });

    // Checkout Modal Coupon & Referral States
    const [showCheckout, setShowCheckout] = useState<boolean>(false);
    const [checkoutTier, setCheckoutTier] = useState<'standard_tier' | 'premium_tier'>('premium_tier');
    
    // Coupon State
    const [couponInput, setCouponInput] = useState<string>('');
    const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
    const [couponError, setCouponError] = useState<string>('');
    const [isValidatingCoupon, setIsValidatingCoupon] = useState<boolean>(false);

    // Referral Redemption State
    const [applyReferralCredits, setApplyReferralCredits] = useState<boolean>(false);
    const [applyFreePoolToken, setApplyFreePoolToken] = useState<boolean>(false);

    // General checkout modal variables
    const [cardNumber, setCardNumber] = useState<string>('');
    const [cardExpiry, setCardExpiry] = useState<string>('');
    const [cardCVC, setCardCVC] = useState<string>('');
    const [isPaying, setIsPaying] = useState<boolean>(false);
    const [paymentSuccess, setPaymentSuccess] = useState<boolean>(false);

    // 1. Subscribe to Global Configs
    useEffect(() => {
        const unsubscribe = onSnapshot(doc(db, 'settings', 'billing_config'), (snap) => {
            if (snap.exists()) setBillingConfig(snap.data() as BillingConfig);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const unsubscribe = onSnapshot(doc(db, 'settings', 'referral_config'), (snap) => {
            if (snap.exists()) setReferralConfig(snap.data() as ReferralConfig);
        });
        return () => unsubscribe();
    }, []);

    // 2. Subscribe to user profiles (for live referral balances)
    useEffect(() => {
        if (!user) {
            setCurrentUserDetails(null);
            return;
        }
        const unsubscribe = onSnapshot(doc(db, 'users', user.id), (snap) => {
            if (snap.exists()) {
                setCurrentUserDetails(snap.data() as User);
            }
        });
        return () => unsubscribe();
    }, [user]);

    // 3. Subscribe to user's pools if logged in
    useEffect(() => {
        if (!user) {
            setMyPools([]);
            return;
        }

        setLoadingPools(true);
        const unsubscribe = dbService.subscribeToPools(
            (pools) => {
                setMyPools(pools);
                setLoadingPools(false);
            },
            (err) => {
                console.error("Error loading pricing pools:", err);
                setLoadingPools(false);
            },
            user.id
        );

        return () => unsubscribe();
    }, [user]);

    // Apply Coupon Code Validation
    const handleApplyCoupon = async (e: React.FormEvent) => {
        e.preventDefault();
        setCouponError('');
        setAppliedCoupon(null);
        if (!couponInput.trim()) return;

        setIsValidatingCoupon(true);
        try {
            const q = query(
                collection(db, 'coupons'), 
                where('code', '==', couponInput.trim().toUpperCase())
            );
            const querySnap = await getDocs(q);

            if (querySnap.empty) {
                setCouponError("Invalid coupon code.");
                return;
            }

            const couponDoc = querySnap.docs[0];
            const coupon = { id: couponDoc.id, ...couponDoc.data() } as Coupon;

            // Validation checks
            if (!coupon.isActive) {
                setCouponError("This coupon is currently inactive.");
                return;
            }

            if (coupon.maxUses !== undefined && coupon.usesCount >= coupon.maxUses) {
                setCouponError("This coupon has reached its maximum usage limit.");
                return;
            }

            // Check coupon expiration date
            if (coupon.expiresAt && coupon.expiresAt < Date.now()) {
                setCouponError("This coupon has expired.");
                return;
            }

            // Check per-user usage limit
            if (coupon.perUserLimit && user && coupon.usageLog) {
                const userUses = coupon.usageLog.filter(entry => entry.userId === user.id).length;
                if (userUses >= coupon.perUserLimit) {
                    setCouponError("You've already used this coupon the maximum number of times.");
                    return;
                }
            }

            // Check pool-type restriction
            if (coupon.allowedPoolTypes && coupon.allowedPoolTypes.length > 0 && selectedPool) {
                const poolType = (selectedPool as Pool & { type: string }).type;
                if (!coupon.allowedPoolTypes.includes(poolType as any)) {
                    setCouponError(`This coupon is not valid for ${poolType} pools.`);
                    return;
                }
            }

            // Coupon successfully validated and applied!
            setAppliedCoupon(coupon);
        } catch (err) {
            console.error(err);
            setCouponError("Error validating coupon. Please try again.");
        } finally {
            setIsValidatingCoupon(false);
        }
    };

    // Reset checkout states on close
    const handleCloseCheckout = () => {
        setShowCheckout(false);
        setAppliedCoupon(null);
        setCouponInput('');
        setCouponError('');
        setApplyReferralCredits(false);
        setApplyFreePoolToken(false);
        setCardNumber('');
        setCardExpiry('');
        setCardCVC('');
        setPaymentSuccess(false);
    };

    // Dynamic price calculation based on category & tier
    const getBasePrice = () => {
        if (activeCategory === 'squares') {
            return billingConfig.pricing.squares.flatPrice;
        }
        if (activeCategory === 'season') {
            return billingConfig.pricing.season[playerRange].price;
        }
        return billingConfig.pricing.bracket[playerRange].price;
    };

    const getAddonTotal = () => {
        let total = 0;
        Object.entries(billingConfig.features).forEach(([key, feat]) => {
            if (feat.isPremium && selectedAddons[key]) {
                total += feat.addonPrice;
            }
        });
        return total;
    };

    const basePrice = getBasePrice();
    const addonTotal = getAddonTotal();
    const subtotal = basePrice + addonTotal;

    // Calculate final price with coupons & referral rewards applied
    const getCheckoutMath = () => {
        let currentTotal = subtotal;
        let couponDiscount = 0;
        let referralDiscount = 0;

        // 1. Apply Referral Free Pool Token (Sets price to $0)
        if (applyFreePoolToken) {
            return {
                subtotal,
                couponDiscount: 0,
                referralDiscount: subtotal,
                total: 0
            };
        }

        // 2. Apply Coupon Discount
        if (appliedCoupon) {
            if (appliedCoupon.discountType === 'percentage') {
                couponDiscount = currentTotal * (appliedCoupon.discountValue / 100);
            } else {
                couponDiscount = Math.min(currentTotal, appliedCoupon.discountValue);
            }
            currentTotal -= couponDiscount;
        }

        // 3. Apply Referral Credits Discount
        if (applyReferralCredits && currentUserDetails?.referralCredits) {
            const potentialDiscount = currentUserDetails.referralCredits * referralConfig.discountPerCredit;
            referralDiscount = Math.min(currentTotal, potentialDiscount);
            currentTotal -= referralDiscount;
        }

        return {
            subtotal,
            couponDiscount,
            referralDiscount,
            total: Math.max(0, currentTotal)
        };
    };

    const checkoutPrices = getCheckoutMath();
    const finalPrice = checkoutPrices.total;

    // Process payment and decrement balances in Firestore
    const handleProcessPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedPoolId || !user) return;

        setIsPaying(true);
        try {
            const poolRef = doc(db, 'pools', selectedPoolId);
            const userRef = doc(db, 'users', user.id);
            
            // Unlocked features list based on checkmarks
            const activeFeatures = {
                aiCommissioner: billingConfig.features.aiCommissioner.isPremium 
                    ? selectedAddons.aiCommissioner 
                    : true,
                smsNotifications: billingConfig.features.smsNotifications.isPremium 
                    ? selectedAddons.smsNotifications 
                    : true,
                whatIfSimulator: billingConfig.features.whatIfSimulator.isPremium 
                    ? selectedAddons.whatIfSimulator 
                    : true,
                customBranding: billingConfig.features.customBranding.isPremium 
                    ? selectedAddons.customBranding 
                    : true
            };

            const billingData: PoolBilling = {
                status: 'active',
                tier: checkoutTier,
                pricePaid: finalPrice,
                maxPlayersAllowed: checkoutTier === 'premium_tier' ? 9999 : 50,
                featuresUnlocked: activeFeatures
            };

            // Transactional Updates: Update Pool document
            await updateDoc(poolRef, {
                billing: billingData,
                updatedAt: Date.now()
            });

            // If Free Pool token is consumed, decrement user balance
            if (applyFreePoolToken) {
                await updateDoc(userRef, {
                    freePoolsAvailable: increment(-1)
                });
            }

            // If referral credits discount is applied, clear/decrement consumed credits
            if (applyReferralCredits && currentUserDetails?.referralCredits) {
                // Calculate how many credits were actually consumed to cover the cost
                const potentialCredits = currentUserDetails.referralCredits;
                const creditValue = referralConfig.discountPerCredit;
                const neededCredits = Math.ceil((subtotal - checkoutPrices.couponDiscount) / creditValue);
                const consumedCredits = Math.min(potentialCredits, neededCredits);

                await updateDoc(userRef, {
                    referralCredits: increment(-consumedCredits)
                });
            }

            // If coupon is used, increment its usagesCount and append to usageLog
            if (appliedCoupon?.id) {
                const couponRef = doc(db, 'coupons', appliedCoupon.id);
                const logEntry = { userId: user.id, poolId: selectedPoolId, usedAt: Date.now() };
                await updateDoc(couponRef, {
                    usesCount: increment(1),
                    usageLog: [...(appliedCoupon.usageLog || []), logEntry]
                });
            }

            setPaymentSuccess(true);
            setTimeout(() => {
                handleCloseCheckout();
            }, 2500);
        } catch (error) {
            console.error("Payment processing error:", error);
            alert("Payment failed. Please verify Firestore rules.");
        } finally {
            setIsPaying(false);
        }
    };

    // Stripe Checkout Redirect — calls createCheckoutSession Cloud Function
    const handleStripeCheckout = async () => {
        if (!selectedPoolId || !user) return;

        setIsPaying(true);
        try {
            const functions = getFunctions();
            const createCheckoutSession = httpsCallable<any, { sessionUrl: string }>(functions, 'createCheckoutSession');

            const selectedPool = userPools.find(p => p.id === selectedPoolId);
            const result = await createCheckoutSession({
                poolId: selectedPoolId,
                poolName: selectedPool?.name || 'Pool Hosting',
                poolType: selectedPool?.type || 'UNKNOWN',
                tier: checkoutTier,
                price: Math.round(finalPrice * 100), // cents
                couponCode: appliedCoupon?.code || null,
                referralCredits: applyReferralCredits ? currentUserDetails?.referralCredits || 0 : 0
            });

            // Redirect to Stripe Checkout
            window.location.href = result.data.sessionUrl;
        } catch (error: any) {
            console.error("Stripe checkout error:", error);
            alert(error.message || "Failed to initiate Stripe checkout.");
        } finally {
            setIsPaying(false);
        }
    };

    const selectedPool = myPools.find(p => p.id === selectedPoolId);

    const getCategoryDetails = () => {
        switch (activeCategory) {
            case 'season':
                return {
                    name: 'NFL Full Season Suite',
                    subtitle: 'Weekly Pick\'em, Survivor, & Margin',
                    description: 'Full season access featuring automated locks, scheduled ties cascades, and mulligans configuration.',
                };
            case 'bracket':
                return {
                    name: 'NCAA Bracket Tournament',
                    subtitle: 'March Madness & Conference Tournaments',
                    description: 'Interactive tournament bracket systems featuring live What-If standings generators and PDF bracket exports.',
                };
            case 'squares':
                return {
                    name: 'Gameday Grid Squares',
                    subtitle: 'Super Bowl & Single Football Grids',
                    description: 'Classic 10x10 football squares including automated transactional coordinate generation and live scores syncing.',
                };
        }
    };

    const catDetails = getCategoryDetails();

    return (
        <div className="min-h-screen text-slate-100 font-sans selection:bg-orange-500 selection:text-white bg-slate-950 flex flex-col">
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            {/* Hero Header */}
            <section className="relative overflow-hidden pt-20 pb-16 border-b border-slate-900 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none">
                    <div className="absolute top-10 right-0 w-[500px] h-[500px] rounded-full blur-[140px] bg-indigo-500/10"></div>
                    <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full blur-[140px] bg-orange-500/5"></div>
                </div>

                <div className="max-w-4xl mx-auto px-6 relative z-10 text-center space-y-6">
                    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 shadow-sm bg-orange-500/10 border border-orange-500/20">
                        <Sparkles size={14} className="text-orange-400 animate-pulse" />
                        <span className="text-xs font-bold uppercase tracking-wider text-orange-400">Interactive Billing Portal</span>
                    </div>

                    <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-tight">
                        Premium Hosting Options & <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-pink-400 to-indigo-400">Dynamic Pricing Calculator</span>
                    </h1>
                    
                    <p className="text-base md:text-lg max-w-2xl mx-auto text-slate-400 leading-relaxed">
                        Complete commissioner automation. Select your format, customize your features, and calculate prices in real-time.
                    </p>

                    {/* Category Tabs */}
                    <div className="flex justify-center p-1 bg-slate-900/80 border border-slate-800 rounded-2xl max-w-lg mx-auto backdrop-blur-md">
                        <button
                            onClick={() => { setActiveCategory('season'); setSelectedPoolId(''); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-xs font-bold rounded-xl transition-all ${
                                activeCategory === 'season' 
                                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/10' 
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            🏈 Season Suite
                        </button>
                        <button
                            onClick={() => { setActiveCategory('bracket'); setSelectedPoolId(''); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-xs font-bold rounded-xl transition-all ${
                                activeCategory === 'bracket' 
                                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/10' 
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            🏀 Bracket Pools
                        </button>
                        <button
                            onClick={() => { setActiveCategory('squares'); setSelectedPoolId(''); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-xs font-bold rounded-xl transition-all ${
                                activeCategory === 'squares' 
                                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/10' 
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            ⏹️ Grids & Squares
                        </button>
                    </div>
                </div>
            </section>

            {/* Pricing details and sandbox mock */}
            <section className="py-16 max-w-7xl mx-auto px-6 w-full flex-grow">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                    
                    {/* Left: Dynamic Config Card */}
                    <div className="lg:col-span-7 space-y-6">
                        <div className="bg-slate-900/50 border border-slate-850 p-6 md:p-8 rounded-3xl backdrop-blur-md space-y-6">
                            <div className="space-y-1">
                                <h2 className="text-2xl font-black text-white">{catDetails.name} Hosting</h2>
                                <p className="text-xs text-slate-400">{catDetails.description}</p>
                            </div>

                            {/* League Size Tiers */}
                            {activeCategory !== 'squares' && (
                                <div className="space-y-3 border-t border-slate-800/80 pt-4">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">1. Choose League Size</label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        {[
                                            { id: 'tier1', label: '11 - 25 Players' },
                                            { id: 'tier2', label: '26 - 50 Players' },
                                            { id: 'tier3', label: '51 - 100 Players' },
                                            { id: 'tier4', label: '100+ Players' }
                                        ].map((t) => (
                                            <button
                                                key={t.id}
                                                onClick={() => setPlayerRange(t.id as PlayerTier)}
                                                className={`p-3 rounded-xl border text-center transition-all flex flex-col justify-center gap-1 ${
                                                    playerRange === t.id 
                                                        ? 'bg-orange-500/15 border-orange-500 text-orange-400' 
                                                        : 'bg-slate-950/40 border-slate-850 text-slate-400 hover:border-slate-800'
                                                }`}
                                            >
                                                <span className="text-[10px] font-bold block">{t.label}</span>
                                                <span className="text-xs font-black block text-white">
                                                    ${activeCategory === 'season' 
                                                        ? billingConfig.pricing.season[t.id as PlayerTier].price 
                                                        : billingConfig.pricing.bracket[t.id as PlayerTier].price}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Dynamic Feature Customization */}
                            <div className="space-y-4 border-t border-slate-800/80 pt-4">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">2. Configure Premium Add-ons</label>
                                
                                <div className="space-y-3">
                                    {[
                                        { key: 'aiCommissioner', label: '🤖 AI Dispute Commissioner (Gemini)' },
                                        { key: 'smsNotifications', label: '📱 Twilio SMS Notification Integration' },
                                        { key: 'whatIfSimulator', label: '📊 "What-If" Standings Simulator' },
                                        { key: 'customBranding', label: '🎨 Custom Cover & Branding' }
                                    ].map(({ key, label }) => {
                                        const feat = billingConfig.features[key as keyof typeof billingConfig.features];
                                        const isPremium = feat.isPremium;

                                        return (
                                            <div key={key} className="flex justify-between items-center bg-slate-950/50 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors">
                                                <div className="space-y-1">
                                                    <span className="text-xs font-bold text-white block">{label}</span>
                                                    <span className="text-[10px] text-slate-500 block">
                                                        {isPremium ? `Requires premium add-on payment: +$${feat.addonPrice}` : 'Included in base standard fee'}
                                                    </span>
                                                </div>

                                                {isPremium ? (
                                                    <input 
                                                        type="checkbox" 
                                                        checked={selectedAddons[key]}
                                                        onChange={(e) => setSelectedAddons({ ...selectedAddons, [key]: e.target.checked })}
                                                        className="w-5 h-5 rounded text-orange-500 bg-slate-900 border-slate-850 focus:ring-orange-500 focus:ring-offset-slate-900 cursor-pointer"
                                                    />
                                                ) : (
                                                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold uppercase">Included</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Standard matrices check */}
                        <div className="p-5 rounded-3xl bg-slate-900/30 border border-slate-900 space-y-4">
                            <h3 className="font-bold text-white text-base flex items-center gap-2">
                                <Shield className="text-indigo-400" size={18} /> Pricing Policies & Guarantees
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-400">
                                <div className="space-y-1">
                                    <h4 className="font-bold text-white text-xs">Commissioner Managed</h4>
                                    <p className="leading-relaxed">All host pricing models represent flat fees charged directly to the Pool Manager. Participants submit selections completely free.</p>
                                </div>
                                <div className="space-y-1">
                                    <h4 className="font-bold text-white text-xs">Free Tier (10 or Less)</h4>
                                    <p className="leading-relaxed">Any pool containing 10 or fewer players remains 100% free with core capabilities (no addon features allowed).</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right: Sandbox Integration */}
                    <div className="lg:col-span-5 bg-slate-900 border border-slate-850 p-6 md:p-8 rounded-3xl space-y-6 flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b border-slate-850 pb-4">
                                <h2 className="text-xl font-black text-white flex items-center gap-2">
                                    <Users className="text-orange-400" size={22} /> Sandbox Checkout
                                </h2>
                                <span className="text-[9px] px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/20 text-indigo-400 font-bold uppercase">Dynamic</span>
                            </div>

                            {/* Dynamically calculated bill box */}
                            <div className="p-5 rounded-2xl bg-slate-950 border border-slate-850 space-y-3">
                                <div className="flex justify-between items-center text-xs text-slate-400">
                                    <span>Base Standard fee:</span>
                                    <span className="font-bold text-white">${basePrice.toFixed(2)}</span>
                                </div>

                                {addonTotal > 0 && (
                                    <div className="flex justify-between items-center text-xs text-slate-400">
                                        <span>Premium add-on upgrades:</span>
                                        <span className="font-bold text-orange-400">+${addonTotal.toFixed(2)}</span>
                                    </div>
                                )}

                                <div className="flex justify-between items-center pt-3 border-t border-slate-900 text-sm font-black text-white">
                                    <span>Total Price:</span>
                                    <span className="text-lg text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-indigo-400">${subtotal.toFixed(2)}</span>
                                </div>
                            </div>

                            {!isLoggedIn ? (
                                <div className="text-center py-8 space-y-4">
                                    <Lock className="text-slate-600 mx-auto" size={24} />
                                    <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
                                        Log in to sync your active brackets, Survivor suites, and squares to apply direct standard upgrades.
                                    </p>
                                    <button 
                                        onClick={onLogin}
                                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-750 text-white font-bold text-xs rounded-xl transition-all"
                                    >
                                        Log In
                                    </button>
                                </div>
                            ) : loadingPools ? (
                                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500">
                                    <Loader2 size={24} className="animate-spin text-orange-400" />
                                    <span className="text-xs">Loading active leagues...</span>
                                </div>
                            ) : myPools.length === 0 ? (
                                <div className="text-center py-8 space-y-3">
                                    <Info className="text-slate-600 mx-auto" size={20} />
                                    <p className="text-xs text-slate-400 max-w-xs mx-auto">
                                        You haven't created any pools yet. Launch a new pool or grid in seconds to test.
                                    </p>
                                    <button 
                                        onClick={onCreatePool}
                                        className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded-xl transition-all"
                                    >
                                        Create Pool
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Select Pool to Manage</label>
                                    <select
                                        value={selectedPoolId}
                                        onChange={(e) => setSelectedPoolId(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-950 border border-slate-850 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-orange-500/50"
                                    >
                                        <option value="">Choose your pool...</option>
                                        {myPools.map((pool) => (
                                            <option key={pool.id} value={pool.id}>
                                                {pool.type === 'SQUARES' ? '⏹️' : pool.type === 'BRACKET' ? '🏀' : '🏈'} {pool.name}
                                            </option>
                                        ))}
                                    </select>

                                    {selectedPool && (
                                        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-850 space-y-3 animate-in fade-in duration-350">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase">Billing Status</span>
                                                <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase border ${
                                                    selectedPool.billing?.status === 'active'
                                                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                                        : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                                                }`}>
                                                    {selectedPool.billing?.status || 'unpaid_trial'}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between border-t border-slate-900 pt-2 text-xs">
                                                <span className="text-[10px] text-slate-400">Paid Tier Level</span>
                                                <span className="font-bold text-white">
                                                    {selectedPool.billing?.tier === 'premium_tier' 
                                                        ? '⭐ Premium Edition' 
                                                        : selectedPool.billing?.tier === 'standard_tier' 
                                                        ? '⚡ Standard Edition' 
                                                        : '🌱 Free Tier'}
                                                </span>
                                            </div>

                                            {selectedPool.billing?.status !== 'active' && (
                                                <div className="pt-2 border-t border-slate-900">
                                                    <button 
                                                        onClick={() => {
                                                            setCheckoutTier(addonTotal > 0 ? 'premium_tier' : 'standard_tier');
                                                            setCheckoutPrice(totalPrice);
                                                            setShowCheckout(true);
                                                        }}
                                                        className="w-full py-3 bg-gradient-to-r from-orange-500 to-indigo-600 hover:from-orange-600 hover:to-indigo-750 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-500/10"
                                                    >
                                                        Pay & Activate Pool (${totalPrice.toFixed(2)})
                                                        <ArrowRight size={12} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {isLoggedIn && myPools.length > 0 && (
                            <div className="p-4 bg-orange-500/5 border border-orange-500/10 rounded-2xl flex items-start gap-2.5 text-[10px] text-slate-400">
                                <AlertCircle className="text-orange-400 shrink-0 mt-0.5" size={14} />
                                <p className="leading-relaxed">
                                    <strong>Real-time Sync Sandbox:</strong> Changes made inside the Super-Admin panel instantly restructure this calculator! Try toggling features premium state in the admin dashboard and refresh this page to inspect.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* MOCK SECURE CREDIT CARD CHECKOUT MODAL */}
            {showCheckout && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 z-50 animate-in fade-in duration-300">
                    <div className="w-full max-w-lg bg-slate-900 border border-slate-850 rounded-3xl p-6 md:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
                        <button 
                            onClick={handleCloseCheckout}
                            className="absolute top-4 right-4 text-slate-400 hover:text-white text-lg font-bold"
                            disabled={isPaying || paymentSuccess}
                        >
                            ✕
                        </button>

                        {paymentSuccess ? (
                            <div className="text-center py-8 space-y-4 animate-in zoom-in-95 duration-500">
                                <div className="w-20 h-20 bg-emerald-500/15 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto text-emerald-400 animate-bounce">
                                    <CheckCircle size={44} />
                                </div>
                                <div className="space-y-2">
                                    <h3 className="text-xl font-black text-white">Payment Confirmed</h3>
                                    <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                                        Your pool has been successfully upgraded to the **{checkoutTier === 'premium_tier' ? 'Premium' : 'Standard'}** plan! All premium features are unlocked in real-time.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div className="space-y-2 text-center">
                                    <h3 className="text-xl font-black text-white flex items-center justify-center gap-2">
                                        <CreditCard className="text-orange-400" size={24} /> Secure Checkout
                                    </h3>
                                    <p className="text-xs text-slate-400">
                                        Activating **{catDetails.name}** for **{selectedPool?.name}**.
                                    </p>
                                </div>

                                {/* Active Referral Credit Redemptions */}
                                {isLoggedIn && currentUserDetails && (
                                    <div className="p-4 bg-slate-950 border border-slate-850 rounded-2xl space-y-3">
                                        <h4 className="text-[10px] font-bold text-orange-400 uppercase tracking-widest flex items-center gap-1.5">
                                            <Award size={14} /> My Referral Credits
                                        </h4>
                                        
                                        {/* Free Pool Token */}
                                        {currentUserDetails.freePoolsAvailable && currentUserDetails.freePoolsAvailable > 0 ? (
                                            <div className="flex justify-between items-center bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                                                <div className="space-y-0.5">
                                                    <span className="text-xs font-bold text-white flex items-center gap-1">
                                                        <Gift size={12} className="text-indigo-400" /> Redeem Free Pool Token
                                                    </span>
                                                    <span className="text-[9px] text-slate-500 block">Available: {currentUserDetails.freePoolsAvailable} tokens</span>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        setApplyFreePoolToken(!applyFreePoolToken);
                                                        setApplyReferralCredits(false);
                                                    }}
                                                    className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all ${
                                                        applyFreePoolToken 
                                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold' 
                                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                                                    }`}
                                                >
                                                    {applyFreePoolToken ? 'Applied' : 'Redeem'}
                                                </button>
                                            </div>
                                        ) : null}

                                        {/* Credit Discount Option */}
                                        {currentUserDetails.referralCredits && currentUserDetails.referralCredits > 0 && !applyFreePoolToken ? (
                                            <div className="flex justify-between items-center bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                                                <div className="space-y-0.5">
                                                    <span className="text-xs font-bold text-white flex items-center gap-1">
                                                        <Users size={12} className="text-indigo-400" /> Apply Referral Credits
                                                    </span>
                                                    <span className="text-[9px] text-slate-500 block">
                                                        Accumulated: {currentUserDetails.referralCredits} recruits (Save ${currentUserDetails.referralCredits * referralConfig.discountPerCredit})
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => setApplyReferralCredits(!applyReferralCredits)}
                                                    className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all ${
                                                        applyReferralCredits 
                                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold' 
                                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                                                    }`}
                                                >
                                                    {applyReferralCredits ? 'Applied' : 'Apply'}
                                                </button>
                                            </div>
                                        ) : null}
                                        
                                        {!currentUserDetails.freePoolsAvailable && !currentUserDetails.referralCredits && (
                                            <p className="text-[10px] text-slate-500 italic">No available referral credit balances. Invite pool managers to earn credits.</p>
                                        )}
                                    </div>
                                )}

                                {/* Coupon Promo Input */}
                                {!applyFreePoolToken && (
                                    <form onSubmit={handleApplyCoupon} className="p-4 bg-slate-950 border border-slate-850 rounded-2xl space-y-3">
                                        <h4 className="text-[10px] font-bold text-orange-400 uppercase tracking-widest flex items-center gap-1.5">
                                            <Ticket size={14} /> Promo Campaign Code
                                        </h4>
                                        <div className="flex gap-2">
                                            <input 
                                                type="text"
                                                placeholder="Enter coupon (e.g. OFFICE50)"
                                                value={couponInput}
                                                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                                                disabled={appliedCoupon !== null}
                                                className="flex-grow px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white font-mono text-xs uppercase outline-none"
                                            />
                                            {appliedCoupon ? (
                                                <button 
                                                    type="button"
                                                    onClick={() => { setAppliedCoupon(null); setCouponInput(''); }}
                                                    className="px-3 py-2 bg-rose-900/30 border border-rose-800 text-rose-300 font-bold rounded-lg text-xs"
                                                >
                                                    Remove
                                                </button>
                                            ) : (
                                                <button 
                                                    type="submit"
                                                    disabled={isValidatingCoupon || !couponInput.trim()}
                                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs"
                                                >
                                                    {isValidatingCoupon ? 'Validating...' : 'Apply'}
                                                </button>
                                            )}
                                        </div>
                                        {couponError && (
                                            <p className="text-[10px] text-rose-400 flex items-center gap-1 font-medium">
                                                <AlertCircle size={12} /> {couponError}
                                            </p>
                                        )}
                                        {appliedCoupon && (
                                            <p className="text-[10px] text-emerald-400 flex items-center gap-1 font-bold">
                                                <CheckCircle size={12} /> Code {appliedCoupon.code} applied! Save {
                                                    appliedCoupon.discountType === 'percentage' 
                                                        ? `${appliedCoupon.discountValue}%` 
                                                        : `$${appliedCoupon.discountValue}`
                                                } off!
                                            </p>
                                        )}
                                    </form>
                                )}

                                {/* Bill Box Math */}
                                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-850 space-y-2 text-xs">
                                    <div className="flex justify-between items-center text-slate-400">
                                        <span>Invoice Subtotal:</span>
                                        <span className="font-bold text-white">${checkoutPrices.subtotal.toFixed(2)}</span>
                                    </div>
                                    
                                    {checkoutPrices.couponDiscount > 0 && (
                                        <div className="flex justify-between items-center text-emerald-400 font-bold">
                                            <span>Campaign Discount ({appliedCoupon?.code}):</span>
                                            <span>-${checkoutPrices.couponDiscount.toFixed(2)}</span>
                                        </div>
                                    )}

                                    {checkoutPrices.referralDiscount > 0 && (
                                        <div className="flex justify-between items-center text-emerald-400 font-bold">
                                            <span>Referral Credits Redeemed:</span>
                                            <span>-${checkoutPrices.referralDiscount.toFixed(2)}</span>
                                        </div>
                                    )}

                                    <div className="flex justify-between items-center pt-2 border-t border-slate-900 text-sm font-black text-white">
                                        <span>Dynamic Total Due:</span>
                                        <span className="text-base text-emerald-400">${finalPrice.toFixed(2)}</span>
                                    </div>
                                </div>

                                {/* Primary: Stripe Checkout */}
                                <button
                                    type="button"
                                    onClick={handleStripeCheckout}
                                    disabled={isPaying}
                                    className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-3.5 rounded-xl text-sm transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isPaying ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            Redirecting to Stripe...
                                        </>
                                    ) : (
                                        <>
                                            {finalPrice === 0 ? 'Activate Pool Free (Redeem Credit)' : `Pay $${finalPrice.toFixed(2)} with Stripe`}
                                            <ArrowRight size={14} />
                                        </>
                                    )}
                                </button>

                                <p className="text-[9px] text-slate-500 text-center">
                                    Secure payment powered by Stripe. Your card details never touch our servers.
                                </p>

                                {/* Sandbox/Testing Mode - Hidden toggle */}
                                <details className="border-t border-slate-800 pt-2 mt-2">
                                    <summary className="text-[10px] text-slate-600 cursor-pointer hover:text-slate-400 transition-colors">
                                        🧪 Sandbox Testing Mode
                                    </summary>
                                    <form onSubmit={handleProcessPayment} className="space-y-3 mt-3">
                                        {finalPrice > 0 && (
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Card Number</label>
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            required
                                                            maxLength={19}
                                                            value={cardNumber}
                                                            onChange={(e) => setCardNumber(e.target.value.replace(/[^\d ]/g, '').replace(/(.{4})/g, '$1 ').trim())}
                                                            className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-850 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-orange-500/50"
                                                            placeholder="4242 4242 4242 4242"
                                                        />
                                                        <CreditCard className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Expiry</label>
                                                        <input
                                                            type="text"
                                                            required
                                                            maxLength={5}
                                                            value={cardExpiry}
                                                            onChange={(e) => setCardExpiry(e.target.value.replace(/[^\d/]/g, ''))}
                                                            className="w-full px-3 py-2.5 bg-slate-950 border border-slate-850 rounded-xl text-white text-sm outline-none"
                                                            placeholder="MM/YY"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">CVC</label>
                                                        <input
                                                            type="password"
                                                            required
                                                            maxLength={4}
                                                            value={cardCVC}
                                                            onChange={(e) => setCardCVC(e.target.value.replace(/[^\d]/g, ''))}
                                                            className="w-full px-3 py-2.5 bg-slate-950 border border-slate-850 rounded-xl text-white text-sm outline-none"
                                                            placeholder="123"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <button
                                            type="submit"
                                            disabled={isPaying}
                                            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            {isPaying ? (
                                                <><Loader2 size={14} className="animate-spin" /> Processing...</>
                                            ) : (
                                                <>{finalPrice === 0 ? 'Activate Free (Sandbox)' : `Sandbox Pay $${finalPrice.toFixed(2)}`}</>
                                            )}
                                        </button>
                                    </form>
                                </details>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <Footer />
        </div>
    );
};
