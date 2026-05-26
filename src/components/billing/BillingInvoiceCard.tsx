import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { dbService } from '../../services/dbService';
import { 
    Ticket, CheckCircle, AlertTriangle, ShieldCheck, 
    CreditCard, ArrowRight, Sparkles, HelpCircle 
} from 'lucide-react';
import type { BillingConfig, Coupon } from '../../types';

interface BillingInvoiceCardProps {
    poolId?: string;
    poolName: string;
    poolType: string;
    estimatedPlayers: number;
    hasAiCommissioner?: boolean;
    hasSmsNotifications?: boolean;
    hasWhatIfSimulator?: boolean;
    isWizard?: boolean;
    onTosAcceptChange?: (accepted: boolean) => void;
    onCouponAppliedChange?: (couponCode: string | null, finalPrice: number) => void;
    initialCouponCode?: string;
}

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

export const BillingInvoiceCard: React.FC<BillingInvoiceCardProps> = ({
    poolId,
    poolName,
    poolType,
    estimatedPlayers,
    hasAiCommissioner = false,
    hasSmsNotifications = false,
    hasWhatIfSimulator = false,
    isWizard = false,
    onTosAcceptChange,
    onCouponAppliedChange,
    initialCouponCode = ''
}) => {
    const [config, setConfig] = useState<BillingConfig>(DEFAULT_BILLING_CONFIG);
    const [couponInput, setCouponInput] = useState(initialCouponCode);
    const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
    const [couponError, setCouponError] = useState<string | null>(null);
    const [couponSuccess, setCouponSuccess] = useState<string | null>(null);
    const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);
    const [tosAccepted, setTosAccepted] = useState(false);
    const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);

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

        if (pType === 'SQUARES') {
            return config.pricing.squares.flatPrice;
        }
        if (pType === 'PROPS') {
            return config.pricing.props.flatPrice;
        }

        // Bracket & Tournament pools
        if (pType === 'BRACKET' || pType === 'NFL_PLAYOFFS') {
            const tiers = config.pricing.bracket;
            if (players <= tiers.tier1.max) return tiers.tier1.price;
            if (players <= tiers.tier2.max) return tiers.tier2.price;
            if (players <= tiers.tier3.max) return tiers.tier3.price;
            return tiers.tier4.price;
        }

        // Season-long pools (Pick'em, Survivor, Margin)
        const tiers = config.pricing.season;
        if (players <= tiers.tier1.max) return tiers.tier1.price;
        if (players <= tiers.tier2.max) return tiers.tier2.price;
        if (players <= tiers.tier3.max) return tiers.tier3.price;
        return tiers.tier4.price;
    };

    const basePrice = getBasePrice();

    // Features add-on cost
    const aiCost = hasAiCommissioner ? config.features.aiCommissioner.addonPrice : 0;
    const smsCost = hasSmsNotifications ? config.features.smsNotifications.addonPrice : 0;
    const simCost = hasWhatIfSimulator ? config.features.whatIfSimulator.addonPrice : 0;
    
    const subtotal = basePrice + aiCost + smsCost + simCost;

    // Apply Coupon discount
    const getDiscountAmount = () => {
        if (!appliedCoupon) return 0;
        if (appliedCoupon.discountType === 'percentage') {
            return subtotal * (appliedCoupon.discountValue / 100);
        }
        return appliedCoupon.discountValue;
    };

    const discount = Math.min(subtotal, getDiscountAmount());
    const total = Math.max(0, subtotal - discount);

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

        try {
            const response = await dbService.createCheckoutSession({
                poolId,
                poolName,
                poolType,
                tier: basePrice === 0 && subtotal === 0 ? 'free_tier' : 'premium_tier',
                price: total,
                couponCode: appliedCoupon?.code || undefined
            });

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
        <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-2xl p-6 md:p-8 space-y-6 shadow-2xl relative overflow-hidden">
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

            {/* Itemized Table */}
            <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-850 space-y-3 font-medium text-sm">
                <div className="flex justify-between items-center text-slate-300">
                    <span>Base Hosting fee ({estimatedPlayers} estimated players)</span>
                    <span className="text-white font-mono">
                        {basePrice === 0 ? 'FREE' : `$${basePrice.toFixed(2)}`}
                    </span>
                </div>

                {hasAiCommissioner && (
                    <div className="flex justify-between items-center text-slate-400 text-xs">
                        <span className="flex items-center gap-1">✦ AI Trash-Talk Commissioner Addon</span>
                        <span className="text-white font-mono">+${aiCost.toFixed(2)}</span>
                    </div>
                )}
                {hasSmsNotifications && (
                    <div className="flex justify-between items-center text-slate-400 text-xs">
                        <span className="flex items-center gap-1">✦ Smart SMS Notification Alerts</span>
                        <span className="text-white font-mono">+${smsCost.toFixed(2)}</span>
                    </div>
                )}
                {hasWhatIfSimulator && (
                    <div className="flex justify-between items-center text-slate-400 text-xs">
                        <span className="flex items-center gap-1">✦ What-If Standings Simulator</span>
                        <span className="text-white font-mono">+${simCost.toFixed(2)}</span>
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
                            className="bg-slate-800 hover:bg-rose-900 hover:text-white text-slate-300 text-xs px-4 py-2 rounded-xl transition-all font-bold"
                        >
                            Remove
                        </button>
                    ) : (
                        <button
                            type="submit"
                            disabled={isValidatingCoupon || !couponInput.trim()}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white text-xs px-5 py-2.5 rounded-xl transition-all font-bold shrink-0"
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
                    <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={tosAccepted}
                            onChange={handleTosChange}
                            className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors leading-relaxed">
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
                        disabled={isCheckoutLoading || (total <= 0 && (!appliedCoupon || subtotal === 0))}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3.5 rounded-xl text-sm transition-all shadow-xl hover:shadow-indigo-500/20 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:hover:scale-100 hover:scale-[1.01]"
                    >
                        {isCheckoutLoading ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                {total === 0 ? 'Activating pool...' : 'Redirecting to Stripe...'}
                            </>
                        ) : (
                            <>
                                <CreditCard size={18} />
                                {total === 0 && appliedCoupon ? 'Activate Premium Pool (100% Off)' : 'Upgrade Pool to Premium'}
                                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                            </>
                        )}
                    </button>
                    <p className="text-[10px] text-slate-500 text-center">
                        Transactions are processed securely in Stripe Sandbox. No real credit card charges will occur.
                    </p>
                </div>
            )}
        </div>
    );
};
