import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { 
    collection, doc, onSnapshot, setDoc, updateDoc, 
    addDoc, deleteDoc, query, orderBy 
} from 'firebase/firestore';
import { dbService } from '../../services/dbService';
import type { BillingConfig, Pool, PoolBilling, Coupon, ReferralConfig, User } from '../../types';
import { 
    Shield, Zap, Search, Save, CheckCircle, 
    ToggleLeft, ToggleRight, Calendar, Plus, Trash2, Ticket, Award
} from 'lucide-react';

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

type AdminSubTab = 'tiers' | 'features' | 'coupons' | 'referrals' | 'pools';

export const SuperAdminBillingPanel: React.FC = () => {
    const [config, setConfig] = useState<BillingConfig>(DEFAULT_BILLING_CONFIG);
    const [subTab, setSubTab] = useState<AdminSubTab>('tiers');
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
    
    // Core Collections State
    const [allPools, setAllPools] = useState<Pool[]>([]);
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [referralConfig, setReferralConfig] = useState<ReferralConfig>(DEFAULT_REFERRAL_CONFIG);
    const [allUsers, setAllUsers] = useState<User[]>([]);
    
    // UI Filtering & Search State
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [userSearchQuery, setUserSearchQuery] = useState<string>('');
    
    // Single Pool Override Edit State
    const [editingPoolId, setEditingPoolId] = useState<string>('');
    const [poolOverrideData, setPoolOverrideData] = useState<Partial<PoolBilling>>({});

    // Coupon Creator Form State
    const [newCouponCode, setNewCouponCode] = useState<string>('');
    const [newCouponType, setNewCouponType] = useState<'percentage' | 'flat'>('percentage');
    const [newCouponValue, setNewCouponValue] = useState<number>(20);
    const [newCouponMaxUses, setNewCouponMaxUses] = useState<string>('');
    const [newCouponPerUserLimit, setNewCouponPerUserLimit] = useState<string>('');
    const [newCouponExpiresAt, setNewCouponExpiresAt] = useState<string>('');
    const [newCouponAllowedTypes, setNewCouponAllowedTypes] = useState<string[]>([]);
    const [isCreatingCoupon, setIsCreatingCoupon] = useState<boolean>(false);
    const [expandedCouponId, setExpandedCouponId] = useState<string>('');

    // User Referral override edit state
    const [editingUserId, setEditingUserId] = useState<string>('');
    const [editReferralCredits, setEditReferralCredits] = useState<number>(0);
    const [editFreePools, setEditFreePools] = useState<number>(0);

    // 1. Subscribe to Global Billing Configuration
    useEffect(() => {
        const docRef = doc(db, 'settings', 'billing_config');
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setConfig(docSnap.data() as BillingConfig);
            } else {
                setDoc(docRef, DEFAULT_BILLING_CONFIG).then(() => {
                    setConfig(DEFAULT_BILLING_CONFIG);
                });
            }
        });
        return () => unsubscribe();
    }, []);

    // 2. Subscribe to Referral configurations
    useEffect(() => {
        const docRef = doc(db, 'settings', 'referral_config');
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setReferralConfig(docSnap.data() as ReferralConfig);
            } else {
                setDoc(docRef, DEFAULT_REFERRAL_CONFIG).then(() => {
                    setReferralConfig(DEFAULT_REFERRAL_CONFIG);
                });
            }
        });
        return () => unsubscribe();
    }, []);

    // 3. Subscribe to Coupons Collection
    useEffect(() => {
        if (subTab !== 'coupons') return;
        const q = query(collection(db, 'coupons'), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snap) => {
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Coupon));
            setCoupons(list);
        });
        return () => unsubscribe();
    }, [subTab]);

    // 4. Load System Pools for Overrides
    useEffect(() => {
        if (subTab !== 'pools') return;
        const unsubscribe = dbService.subscribeToAllPools(
            (pools) => setAllPools(pools),
            (err) => console.error("Error loading admin pools:", err)
        );
        return () => unsubscribe();
    }, [subTab]);

    // 5. Load User Profiles for Referral overrides
    useEffect(() => {
        if (subTab !== 'referrals') return;
        
        // Fetch users reactively or fallback to dbService
        const loadUsers = async () => {
            try {
                const list = await dbService.getAllUsers();
                setAllUsers(list);
            } catch (err) {
                console.error("Failed to load user profiles:", err);
            }
        };
        loadUsers();
    }, [subTab]);

    // 6. Save Pricing / Feature Config Tiers
    const handleSaveConfig = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            const docRef = doc(db, 'settings', 'billing_config');
            await setDoc(docRef, config);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (error) {
            console.error("Failed to save billing config:", error);
            alert("Error saving configuration to Firestore.");
        } finally {
            setIsSaving(false);
        }
    };

    // 7. Save Referral Policy configs
    const handleSaveReferralConfig = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            const docRef = doc(db, 'settings', 'referral_config');
            await setDoc(docRef, referralConfig);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (error) {
            console.error("Failed to save referral config:", error);
            alert("Error saving referral configurations.");
        } finally {
            setIsSaving(false);
        }
    };

    // 8. Create Coupon code
    const handleCreateCoupon = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCouponCode.trim()) return;

        setIsCreatingCoupon(true);
        try {
            const couponData: Omit<Coupon, 'id'> = {
                code: newCouponCode.trim().toUpperCase(),
                discountType: newCouponType,
                discountValue: newCouponValue,
                isActive: true,
                usesCount: 0,
                maxUses: newCouponMaxUses ? parseInt(newCouponMaxUses) : undefined,
                createdAt: Date.now(),
                perUserLimit: newCouponPerUserLimit ? parseInt(newCouponPerUserLimit) : undefined,
                expiresAt: newCouponExpiresAt ? new Date(newCouponExpiresAt).getTime() : undefined,
                allowedPoolTypes: newCouponAllowedTypes.length > 0 ? newCouponAllowedTypes as any : undefined,
                usageLog: []
            };

            await addDoc(collection(db, 'coupons'), couponData);
            setNewCouponCode('');
            setNewCouponMaxUses('');
            setNewCouponPerUserLimit('');
            setNewCouponExpiresAt('');
            setNewCouponAllowedTypes([]);
            alert(`Coupon ${couponData.code} created successfully!`);
        } catch (error) {
            console.error("Failed to create coupon:", error);
            alert("Failed to write coupon to database.");
        } finally {
            setIsCreatingCoupon(false);
        }
    };

    // 9. Delete Coupon code
    const handleDeleteCoupon = async (couponId: string, code: string) => {
        if (!window.confirm(`Are you sure you want to delete coupon ${code}?`)) return;
        try {
            await deleteDoc(doc(db, 'coupons', couponId));
        } catch (error) {
            console.error("Failed to delete coupon:", error);
            alert("Deletion failed.");
        }
    };

    // 10. Toggle Coupon active state
    const handleToggleCouponActive = async (coupon: Coupon) => {
        if (!coupon.id) return;
        try {
            await updateDoc(doc(db, 'coupons', coupon.id), {
                isActive: !coupon.isActive
            });
        } catch (err) {
            console.error(err);
        }
    };

    // 11. Save Pool Billing overrides
    const handleSavePoolOverride = async (poolId: string) => {
        try {
            const poolRef = doc(db, 'pools', poolId);
            await updateDoc(poolRef, {
                billing: poolOverrideData,
                updatedAt: Date.now()
            });
            setEditingPoolId('');
            alert("Pool billing parameters overridden successfully!");
        } catch (error) {
            console.error("Override failed:", error);
            alert("Failed to update pool billing configuration.");
        }
    };

    // 11b. Quick Action: Extend Trial by 14 days
    const handleExtendTrial = async (pool: Pool) => {
        if (!window.confirm(`Extend trial for "${pool.name}" by 14 days?`)) return;
        try {
            const poolRef = doc(db, 'pools', pool.id);
            const currentEnd = pool.billing?.trialEndsAt || Date.now();
            await updateDoc(poolRef, {
                'billing.status': 'trial',
                'billing.trialEndsAt': currentEnd + (14 * 24 * 60 * 60 * 1000),
                updatedAt: Date.now()
            });
            alert(`Trial extended by 14 days for "${pool.name}"`);
        } catch (error) {
            console.error("Extend trial failed:", error);
            alert("Failed to extend trial.");
        }
    };

    // 11c. Quick Action: Reset Grace Period
    const handleResetGrace = async (pool: Pool) => {
        if (!window.confirm(`Reset grace period for "${pool.name}"? This will move it from locked/grace back to grace_period with ${config.gracePeriodDays} days.`)) return;
        try {
            const poolRef = doc(db, 'pools', pool.id);
            await updateDoc(poolRef, {
                'billing.status': 'grace_period',
                'billing.gracePeriodEndsAt': Date.now() + (config.gracePeriodDays * 24 * 60 * 60 * 1000),
                updatedAt: Date.now()
            });
            alert(`Grace period reset for "${pool.name}" — ${config.gracePeriodDays} days from now.`);
        } catch (error) {
            console.error("Reset grace failed:", error);
            alert("Failed to reset grace period.");
        }
    };

    // 12. Save User Referral balance manual overrides
    const handleSaveUserReferralOverride = async (userId: string) => {
        try {
            await dbService.updateUser(userId, {
                referralCredits: editReferralCredits,
                freePoolsAvailable: editFreePools
            });
            setEditingUserId('');
            alert("User referral credit balances updated!");
            
            // Reload list
            const list = await dbService.getAllUsers();
            setAllUsers(list);
        } catch (error) {
            console.error(error);
            alert("Failed to update user profile.");
        }
    };

    // Filters
    const filteredPools = allPools.filter(pool => 
        pool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pool.managerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pool.type.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredUsers = allUsers.filter(user => 
        (user.name || '').toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        (user.email || '').toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        user.id.toLowerCase().includes(userSearchQuery.toLowerCase())
    );

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 relative overflow-hidden backdrop-blur-md">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center border-b border-slate-800 pb-4 gap-4">
                <div className="space-y-1">
                    <h2 className="text-2xl font-black text-white flex items-center gap-2">
                        <Shield className="text-orange-400" size={24} /> Monetization Dashboard
                    </h2>
                    <p className="text-xs text-slate-400">Configure core product tiers, feature matrix toggles, coupon configurations, and customer billing overrides.</p>
                </div>

                {/* Tab Navigation */}
                <div className="flex flex-wrap p-0.5 bg-slate-950 border border-slate-800 rounded-xl">
                    <button
                        onClick={() => setSubTab('tiers')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            subTab === 'tiers' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        🏈 Base Tiers
                    </button>
                    <button
                        onClick={() => setSubTab('features')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            subTab === 'features' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        ⚙️ Feature Matrix
                    </button>
                    <button
                        onClick={() => setSubTab('coupons')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            subTab === 'coupons' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        🎫 Coupon Codes
                    </button>
                    <button
                        onClick={() => setSubTab('referrals')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            subTab === 'referrals' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        🎁 Referral Policy
                    </button>
                    <button
                        onClick={() => setSubTab('pools')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            subTab === 'pools' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        🔑 Pool Overrides
                    </button>
                </div>
            </div>

            {/* TAB 1: TIERS & BASE PRICING */}
            {subTab === 'tiers' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Global Trial Parameters */}
                        <div className="p-5 rounded-2xl bg-slate-950/50 border border-slate-800 space-y-4">
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 text-orange-400">
                                <Calendar size={16} /> Global Grace Policies
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Free Limit (Players)</label>
                                    <input 
                                        type="number"
                                        value={config.freePlayerThreshold}
                                        onChange={(e) => setConfig({ ...config, freePlayerThreshold: Math.max(0, parseInt(e.target.value) || 0) })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white font-bold"
                                    />
                                    <span className="text-[9px] text-slate-500 leading-normal mt-1 block">Pools with this count or fewer are 100% free.</span>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Grace Period (Days)</label>
                                    <input 
                                        type="number"
                                        value={config.gracePeriodDays}
                                        onChange={(e) => setConfig({ ...config, gracePeriodDays: Math.max(0, parseInt(e.target.value) || 0) })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white font-bold"
                                    />
                                    <span className="text-[9px] text-slate-500 leading-normal mt-1 block">Free weeks allowed before lockouts trigger.</span>
                                </div>
                            </div>
                        </div>

                        {/* Flat Pricing */}
                        <div className="p-5 rounded-2xl bg-slate-950/50 border border-slate-800 space-y-4">
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 text-indigo-400">
                                <Zap size={16} /> Flat rate configurations
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Squares Grid Price ($)</label>
                                    <input 
                                        type="number"
                                        step="0.01"
                                        value={config.pricing.squares.flatPrice}
                                        onChange={(e) => setConfig({
                                            ...config,
                                            pricing: {
                                                ...config.pricing,
                                                squares: { flatPrice: Math.max(0, parseFloat(e.target.value) || 0) }
                                            }
                                        })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Prop Bet Sheets Price ($)</label>
                                    <input 
                                        type="number"
                                        step="0.01"
                                        value={config.pricing.props.flatPrice}
                                        onChange={(e) => setConfig({
                                            ...config,
                                            pricing: {
                                                ...config.pricing,
                                                props: { flatPrice: Math.max(0, parseFloat(e.target.value) || 0) }
                                            }
                                        })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white font-bold"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* 🏈 NFL SEASON TIERS */}
                        <div className="p-5 rounded-2xl bg-slate-950/50 border border-slate-800 space-y-4">
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                                🏈 NFL Season Pools Pricing Tiers
                            </h3>
                            <div className="space-y-3">
                                {[
                                    { key: 'tier1', label: '11 - 25 Players' },
                                    { key: 'tier2', label: '26 - 50 Players' },
                                    { key: 'tier3', label: '51 - 100 Players' },
                                    { key: 'tier4', label: '100+ Players' },
                                ].map(({ key, label }) => (
                                    <div key={key} className="flex justify-between items-center bg-slate-900 px-4 py-2.5 rounded-xl border border-slate-850">
                                        <span className="text-xs font-bold text-slate-300">{label}</span>
                                        <div className="flex items-center gap-1">
                                            <span className="text-slate-500 font-bold text-xs">$</span>
                                            <input 
                                                type="number"
                                                value={(config.pricing.season as any)[key].price}
                                                onChange={(e) => {
                                                    const price = Math.max(0, parseInt(e.target.value) || 0);
                                                    setConfig({
                                                        ...config,
                                                        pricing: {
                                                            ...config.pricing,
                                                            season: {
                                                                ...config.pricing.season,
                                                                [key]: { ...(config.pricing.season as any)[key], price }
                                                            }
                                                        }
                                                    });
                                                }}
                                                className="w-20 bg-slate-950 border border-slate-800 text-center font-bold rounded px-2 py-1 text-xs text-white"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 🏀 BRACKET POOLS TIERS */}
                        <div className="p-5 rounded-2xl bg-slate-950/50 border border-slate-800 space-y-4">
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                                🏀 NCAA Bracket Pools Pricing Tiers
                            </h3>
                            <div className="space-y-3">
                                {[
                                    { key: 'tier1', label: '11 - 25 Players' },
                                    { key: 'tier2', label: '26 - 50 Players' },
                                    { key: 'tier3', label: '51 - 100 Players' },
                                    { key: 'tier4', label: '100+ Players' },
                                ].map(({ key, label }) => (
                                    <div key={key} className="flex justify-between items-center bg-slate-900 px-4 py-2.5 rounded-xl border border-slate-850">
                                        <span className="text-xs font-bold text-slate-300">{label}</span>
                                        <div className="flex items-center gap-1">
                                            <span className="text-slate-500 font-bold text-xs">$</span>
                                            <input 
                                                type="number"
                                                value={(config.pricing.bracket as any)[key].price}
                                                onChange={(e) => {
                                                    const price = Math.max(0, parseInt(e.target.value) || 0);
                                                    setConfig({
                                                        ...config,
                                                        pricing: {
                                                            ...config.pricing,
                                                            bracket: {
                                                                ...config.pricing.bracket,
                                                                [key]: { ...(config.pricing.bracket as any)[key], price }
                                                            }
                                                        }
                                                    });
                                                }}
                                                className="w-20 bg-slate-950 border border-slate-800 text-center font-bold rounded px-2 py-1 text-xs text-white"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: FEATURE MATRIX MANAGER */}
            {subTab === 'features' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="p-5 rounded-2xl bg-slate-950/50 border border-slate-800 space-y-4">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 text-indigo-400">
                            ⚙️ Feature Premium/Add-on Allocation Control
                        </h3>
                        <p className="text-xs text-slate-400">Determine which premium tools are unlocked automatically vs. require an addon fee at checkout.</p>
                        
                        <div className="space-y-4 pt-2">
                            {[
                                { key: 'aiCommissioner', label: '🤖 AI Dispute Commissioner (Gemini)' },
                                { key: 'smsNotifications', label: '📱 Twilio SMS Notification Integration' },
                                { key: 'whatIfSimulator', label: '📊 What-If Standings Simulator' },
                                { key: 'customBranding', label: '🎨 Custom Cover & Branding Customization' },
                            ].map(({ key, label }) => {
                                const feat = (config.features as any)[key];
                                return (
                                    <div key={key} className="flex flex-col md:flex-row justify-between items-start md:items-center bg-slate-900 p-4 rounded-2xl border border-slate-850 gap-4">
                                        <div className="space-y-1">
                                            <span className="text-xs font-bold text-white block">{label}</span>
                                            <span className="text-[10px] text-slate-500 block">
                                                {feat.isPremium ? 'Currently Premium Upgrade Addon' : 'Currently Standard Free Allocation'}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-6 self-end md:self-auto">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-slate-400 font-bold uppercase">Upgrade Addon?</span>
                                                <button
                                                    onClick={() => {
                                                        setConfig({
                                                            ...config,
                                                            features: {
                                                                ...config.features,
                                                                [key]: { ...feat, isPremium: !feat.isPremium }
                                                            }
                                                        });
                                                    }}
                                                    className="text-orange-400 hover:text-orange-300"
                                                >
                                                    {feat.isPremium ? <ToggleRight size={28} /> : <ToggleLeft size={28} className="text-slate-600" />}
                                                </button>
                                            </div>

                                            {feat.isPremium && (
                                                <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                                                    <span className="text-[10px] text-slate-500 font-bold">$</span>
                                                    <input 
                                                        type="number"
                                                        value={feat.addonPrice}
                                                        onChange={(e) => {
                                                            const price = Math.max(0, parseInt(e.target.value) || 0);
                                                            setConfig({
                                                                ...config,
                                                                features: {
                                                                    ...config.features,
                                                                    [key]: { ...feat, addonPrice: price }
                                                                }
                                                            });
                                                        }}
                                                        className="w-14 bg-transparent border-none text-center font-bold text-xs text-white outline-none"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 3: COUPON CODE CREATOR */}
            {subTab === 'coupons' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                        {/* Left: Create Form */}
                        <form onSubmit={handleCreateCoupon} className="lg:col-span-4 bg-slate-950/40 p-6 border border-slate-800 rounded-2xl space-y-4">
                            <h3 className="font-bold text-white flex items-center gap-1.5 border-b border-slate-850 pb-2 text-sm uppercase text-orange-400">
                                <Ticket size={16} /> Spawn Coupon Code
                            </h3>
                            
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Coupon Code</label>
                                <input 
                                    type="text"
                                    required
                                    value={newCouponCode}
                                    onChange={(e) => setNewCouponCode(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
                                    placeholder="OFFICE50"
                                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white font-bold text-sm outline-none uppercase"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Discount Type</label>
                                    <select 
                                        value={newCouponType}
                                        onChange={(e) => setNewCouponType(e.target.value as any)}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white font-bold text-xs"
                                    >
                                        <option value="percentage">Percentage (%)</option>
                                        <option value="flat">Flat ($)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Value</label>
                                    <input 
                                        type="number"
                                        required
                                        value={newCouponValue}
                                        onChange={(e) => setNewCouponValue(Math.max(0, parseInt(e.target.value) || 0))}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white font-bold text-xs"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Max Uses Limit (Optional)</label>
                                <input 
                                    type="number"
                                    value={newCouponMaxUses}
                                    onChange={(e) => setNewCouponMaxUses(e.target.value)}
                                    placeholder="Unlimited if empty"
                                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-xs outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Per-User Limit (Optional)</label>
                                <input 
                                    type="number"
                                    value={newCouponPerUserLimit}
                                    onChange={(e) => setNewCouponPerUserLimit(e.target.value)}
                                    placeholder="No limit if empty"
                                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-xs outline-none"
                                />
                                <span className="text-[9px] text-slate-500 mt-1 block">Max times a single commissioner can use this code.</span>
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Expiration Date (Optional)</label>
                                <input 
                                    type="datetime-local"
                                    value={newCouponExpiresAt}
                                    onChange={(e) => setNewCouponExpiresAt(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-xs outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Restrict to Pool Types (Optional)</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {['SQUARES', 'BRACKET', 'NFL_PLAYOFFS', 'PROPS', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'].map(pt => (
                                        <button
                                            key={pt}
                                            type="button"
                                            onClick={() => {
                                                setNewCouponAllowedTypes(prev => 
                                                    prev.includes(pt) ? prev.filter(t => t !== pt) : [...prev, pt]
                                                );
                                            }}
                                            className={`px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all ${
                                                newCouponAllowedTypes.includes(pt)
                                                    ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                                                    : 'bg-slate-900 border-slate-700 text-slate-500 hover:text-white'
                                            }`}
                                        >
                                            {pt.replace('NFL_', '')}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-[9px] text-slate-500 mt-1 block">Leave empty to allow all pool types.</span>
                            </div>

                            <button
                                type="submit"
                                disabled={isCreatingCoupon}
                                className="w-full py-2 bg-gradient-to-r from-orange-500 to-indigo-600 hover:from-orange-600 hover:to-indigo-750 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1"
                            >
                                <Plus size={14} /> Create Coupon
                            </button>
                        </form>

                        {/* Right: Coupon List */}
                        <div className="lg:col-span-8 bg-slate-950/20 border border-slate-850 p-6 rounded-2xl space-y-4">
                            <h3 className="font-bold text-white text-sm uppercase tracking-wider text-slate-300">Active Campaign Coupons</h3>
                            
                            <div className="overflow-x-auto border border-slate-850 rounded-xl">
                                <table className="w-full text-left text-xs">
                                    <thead>
                                        <tr className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                                            <th className="p-3">Code</th>
                                            <th className="p-3">Discount</th>
                                            <th className="p-3">Status</th>
                                            <th className="p-3">Usage</th>
                                            <th className="p-3">Limits</th>
                                            <th className="p-3 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {coupons.map((coupon) => {
                                            const isExpired = coupon.expiresAt ? coupon.expiresAt < Date.now() : false;
                                            return (
                                                <React.Fragment key={coupon.id}>
                                                    <tr className="border-b border-slate-850 hover:bg-slate-950/20">
                                                        <td className="p-3 font-mono font-bold text-white tracking-wider">
                                                            {coupon.code}
                                                            {isExpired && (
                                                                <span className="ml-2 px-1.5 py-0.5 rounded text-[8px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                                                    EXPIRED
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 font-bold text-emerald-400">
                                                            {coupon.discountType === 'percentage' ? `${coupon.discountValue}% Off` : `$${coupon.discountValue} Off`}
                                                        </td>
                                                        <td className="p-3">
                                                            <button 
                                                                onClick={() => handleToggleCouponActive(coupon)}
                                                                className={`px-2 py-0.5 rounded-full font-black text-[9px] uppercase border transition-all ${
                                                                    coupon.isActive 
                                                                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                                                                        : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                                                                }`}
                                                            >
                                                                {coupon.isActive ? 'Active' : 'Paused'}
                                                            </button>
                                                        </td>
                                                        <td className="p-3 text-slate-400 font-mono">
                                                            <button
                                                                onClick={() => setExpandedCouponId(expandedCouponId === coupon.id ? '' : (coupon.id || ''))}
                                                                className="hover:text-white transition-colors"
                                                            >
                                                                {coupon.usesCount} / {coupon.maxUses || '∞'}
                                                            </button>
                                                        </td>
                                                        <td className="p-3 text-slate-500 text-[10px]">
                                                            {coupon.perUserLimit && <span className="block">Per-user: {coupon.perUserLimit}x</span>}
                                                            {coupon.allowedPoolTypes && coupon.allowedPoolTypes.length > 0 && (
                                                                <span className="block">{coupon.allowedPoolTypes.join(', ')}</span>
                                                            )}
                                                            {coupon.expiresAt && (
                                                                <span className="block">Exp: {new Date(coupon.expiresAt).toLocaleDateString()}</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-right">
                                                            <button 
                                                                onClick={() => handleDeleteCoupon(coupon.id!, coupon.code)}
                                                                className="p-1.5 hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 rounded transition-colors"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    {/* Expandable usage log */}
                                                    {expandedCouponId === coupon.id && coupon.usageLog && coupon.usageLog.length > 0 && (
                                                        <tr>
                                                            <td colSpan={6} className="p-0">
                                                                <div className="bg-slate-950/60 px-4 py-3 border-t border-slate-800">
                                                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Usage Audit Log</h4>
                                                                    <div className="space-y-1 max-h-40 overflow-y-auto">
                                                                        {coupon.usageLog.map((entry, idx) => (
                                                                            <div key={idx} className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                                                                                <span>User: {entry.userId.substring(0, 12)}...</span>
                                                                                <span>Pool: {entry.poolId.substring(0, 12)}...</span>
                                                                                <span>{new Date(entry.usedAt).toLocaleString()}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                        {coupons.length === 0 && (
                                            <tr>
                                                <td colSpan={6} className="p-8 text-center text-slate-500">
                                                    No active campaigns created yet.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 4: REFERRAL POLICY EDITOR */}
            {subTab === 'referrals' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                        
                        {/* Left: Referral Policy configurations */}
                        <div className="lg:col-span-5 bg-slate-950/40 p-6 border border-slate-800 rounded-2xl space-y-4">
                            <h3 className="font-bold text-white flex items-center gap-1.5 border-b border-slate-850 pb-2 text-sm uppercase text-orange-400">
                                <Award size={16} /> Referral Reward Structure
                            </h3>
                            
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Reward Payout Type</label>
                                <select 
                                    value={referralConfig.rewardType}
                                    onChange={(e) => setReferralConfig({ ...referralConfig, rewardType: e.target.value as any })}
                                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-white font-bold text-xs"
                                >
                                    <option value="free_pool">Free Pool Tokens (Threshold Recruits)</option>
                                    <option value="discount">Direct Discount Credit (Incremental)</option>
                                </select>
                            </div>

                            {referralConfig.rewardType === 'free_pool' ? (
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Paying Managers Required for Free Pool</label>
                                    <input 
                                        type="number"
                                        required
                                        value={referralConfig.creditsRequiredForFreePool}
                                        onChange={(e) => setReferralConfig({ ...referralConfig, creditsRequiredForFreePool: Math.max(1, parseInt(e.target.value) || 1) })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-xs font-bold"
                                    />
                                    <span className="text-[9px] text-slate-500 leading-relaxed block mt-1">E.g., 5 successful recruits awards the manager 1 free pool hosting token.</span>
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Discount Off Hosting Fee Per Recruit ($)</label>
                                    <input 
                                        type="number"
                                        required
                                        value={referralConfig.discountPerCredit}
                                        onChange={(e) => setReferralConfig({ ...referralConfig, discountPerCredit: Math.max(0, parseFloat(e.target.value) || 0) })}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-xs font-bold"
                                    />
                                    <span className="text-[9px] text-slate-500 leading-relaxed block mt-1">E.g., slash $5.00 off hosting checkouts for every paying recruit brought in.</span>
                                </div>
                            )}

                            <button
                                onClick={handleSaveReferralConfig}
                                disabled={isSaving}
                                className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-indigo-600 hover:from-orange-600 hover:to-indigo-750 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5"
                            >
                                <Save size={14} /> Update Reward Policy
                            </button>
                        </div>

                        {/* Right: User Credits Editor */}
                        <div className="lg:col-span-7 bg-slate-950/20 border border-slate-850 p-6 rounded-2xl space-y-4">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-850 pb-3 gap-2">
                                <h3 className="font-bold text-white text-sm uppercase tracking-wider text-slate-300">Manager Referral Ledger</h3>
                                <div className="relative w-full sm:max-w-[200px]">
                                    <Search className="absolute left-2.5 top-1.5 text-slate-500" size={14} />
                                    <input 
                                        type="text"
                                        placeholder="Search managers..."
                                        value={userSearchQuery}
                                        onChange={(e) => setUserSearchQuery(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-3 py-1 text-xs text-white outline-none placeholder-slate-600"
                                    />
                                </div>
                            </div>

                            <div className="overflow-x-auto border border-slate-850 rounded-xl">
                                <table className="w-full text-left text-xs whitespace-nowrap">
                                    <thead>
                                        <tr className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                                            <th className="p-3">Manager</th>
                                            <th className="p-3 text-center">Recruits</th>
                                            <th className="p-3 text-center">Free Pools</th>
                                            <th className="p-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredUsers
                                            .filter(u => u.role === 'POOL_MANAGER' || u.role === 'SUPER_ADMIN')
                                            .map((u) => {
                                                const isEditing = editingUserId === u.id;
                                                return (
                                                    <tr key={u.id} className="border-b border-slate-850 hover:bg-slate-950/20">
                                                        <td className="p-3">
                                                            <div className="font-bold text-white">{u.name || 'Anonymous'}</div>
                                                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">{u.email}</div>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            {isEditing ? (
                                                                <input 
                                                                    type="number"
                                                                    value={editReferralCredits}
                                                                    onChange={(e) => setEditReferralCredits(Math.max(0, parseInt(e.target.value) || 0))}
                                                                    className="w-12 bg-slate-950 border border-slate-800 text-center font-bold text-white rounded p-1"
                                                                />
                                                            ) : (
                                                                <span className="font-bold text-slate-300 font-mono">{u.referralCredits || 0} paying recruits</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            {isEditing ? (
                                                                <input 
                                                                    type="number"
                                                                    value={editFreePools}
                                                                    onChange={(e) => setEditFreePools(Math.max(0, parseInt(e.target.value) || 0))}
                                                                    className="w-12 bg-slate-950 border border-slate-800 text-center font-bold text-white rounded p-1"
                                                                />
                                                            ) : (
                                                                <span className="font-bold text-emerald-400 font-mono">{u.freePoolsAvailable || 0} tokens</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-right">
                                                            {isEditing ? (
                                                                <div className="flex gap-2 justify-end">
                                                                    <button 
                                                                        onClick={() => handleSaveUserReferralOverride(u.id)}
                                                                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded"
                                                                    >
                                                                        Save
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => setEditingUserId('')}
                                                                        className="px-2 py-1 bg-slate-800 text-slate-300 rounded font-bold"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button 
                                                                    onClick={() => {
                                                                        setEditingUserId(u.id);
                                                                        setEditReferralCredits(u.referralCredits || 0);
                                                                        setEditFreePools(u.freePoolsAvailable || 0);
                                                                    }}
                                                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded font-bold"
                                                                >
                                                                    Modify Credits
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 5: POOL BILLING OVERRIDES */}
            {subTab === 'pools' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5">
                        <Search size={18} className="text-slate-500" />
                        <input 
                            type="text"
                            placeholder="Search active pools by name, type, or manager..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="bg-transparent border-none text-sm text-white outline-none flex-grow"
                        />
                    </div>

                    <div className="overflow-x-auto border border-slate-850 rounded-2xl">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-950 border-b border-slate-850 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                                    <th className="p-4">Pool Name</th>
                                    <th className="p-4">Type</th>
                                    <th className="p-4">Manager</th>
                                    <th className="p-4">Billing Status</th>
                                    <th className="p-4">Tier</th>
                                    <th className="p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPools.map((pool) => {
                                    const isEditing = editingPoolId === pool.id;
                                    return (
                                        <tr key={pool.id} className="border-b border-slate-850/50 hover:bg-slate-950/20 transition-colors">
                                            <td className="p-4">
                                                <div className="font-bold text-white">{pool.name}</div>
                                                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{pool.contactEmail || pool.managerName || ''}</div>
                                            </td>
                                            <td className="p-4 text-slate-400 font-bold uppercase text-[10px]">{pool.type}</td>
                                            <td className="p-4 text-slate-400 text-xs">{pool.managerName || 'Anonymous'}</td>
                                            
                                            {/* BILLING STATUS */}
                                            <td className="p-4">
                                                {isEditing ? (
                                                    <select
                                                        value={poolOverrideData.status || 'free'}
                                                        onChange={(e) => setPoolOverrideData({ ...poolOverrideData, status: e.target.value as any })}
                                                        className="px-2 py-1 bg-slate-950 border border-slate-800 rounded text-xs text-white"
                                                    >
                                                        <option value="free">Free</option>
                                                        <option value="trial">Trial</option>
                                                        <option value="active">Active</option>
                                                        <option value="grace_period">Grace Period</option>
                                                        <option value="locked">Locked</option>
                                                    </select>
                                                ) : (
                                                    <span className={`px-2 py-0.5 rounded-full font-black text-[9px] uppercase tracking-wider border ${
                                                        pool.billing?.status === 'active' 
                                                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                                                            : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                                                    }`}>
                                                        {pool.billing?.status || 'unpaid_trial'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* MONETIZATION TIER */}
                                            <td className="p-4">
                                                {isEditing ? (
                                                    <select
                                                        value={poolOverrideData.tier || 'free_tier'}
                                                        onChange={(e) => setPoolOverrideData({ ...poolOverrideData, tier: e.target.value as any })}
                                                        className="px-2 py-1 bg-slate-950 border border-slate-800 rounded text-xs text-white"
                                                    >
                                                        <option value="free_tier">Free Tier</option>
                                                        <option value="standard_tier">Standard Edition</option>
                                                        <option value="premium_tier">Premium Edition</option>
                                                    </select>
                                                ) : (
                                                    <span className="font-bold text-slate-300">
                                                        {pool.billing?.tier === 'premium_tier' 
                                                            ? '⭐ Premium' 
                                                            : pool.billing?.tier === 'standard_tier' 
                                                            ? '⚡ Standard' 
                                                            : '🌱 Free'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* ACTIONS */}
                                            <td className="p-4 text-right">
                                                {isEditing ? (
                                                    <div className="flex gap-2 justify-end">
                                                        <button 
                                                            onClick={() => handleSavePoolOverride(pool.id)}
                                                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded"
                                                        >
                                                            Save
                                                        </button>
                                                        <button 
                                                            onClick={() => setEditingPoolId('')}
                                                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex gap-1.5 justify-end flex-wrap">
                                                        <button 
                                                            onClick={() => {
                                                                setEditingPoolId(pool.id);
                                                                setPoolOverrideData(pool.billing || {
                                                                    status: 'trial',
                                                                    tier: 'free_tier',
                                                                    pricePaid: 0,
                                                                    maxPlayersAllowed: 10,
                                                                    featuresUnlocked: {
                                                                        aiCommissioner: false,
                                                                        smsNotifications: false,
                                                                        whatIfSimulator: false,
                                                                        customBranding: true
                                                                    }
                                                                });
                                                            }}
                                                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-white rounded transition-colors"
                                                        >
                                                            Override
                                                        </button>
                                                        {(pool.billing?.status === 'trial' || pool.billing?.status === 'grace_period' || pool.billing?.status === 'locked') && (
                                                            <button 
                                                                onClick={() => handleExtendTrial(pool)}
                                                                className="px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-[10px] font-bold text-indigo-300 rounded border border-indigo-500/30 transition-colors"
                                                            >
                                                                +14d Trial
                                                            </button>
                                                        )}
                                                        {(pool.billing?.status === 'grace_period' || pool.billing?.status === 'locked') && (
                                                            <button 
                                                                onClick={() => handleResetGrace(pool)}
                                                                className="px-2 py-1 bg-amber-600/20 hover:bg-amber-600/40 text-[10px] font-bold text-amber-300 rounded border border-amber-500/30 transition-colors"
                                                            >
                                                                Reset Grace
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* SAVE BUTTON FOR CONFIG TABS */}
            {(subTab === 'tiers' || subTab === 'features') && (
                <div className="flex justify-end pt-4 border-t border-slate-800">
                    <button
                        onClick={handleSaveConfig}
                        disabled={isSaving}
                        className="bg-gradient-to-r from-orange-500 to-indigo-600 hover:from-orange-600 hover:to-indigo-750 text-white px-8 py-3.5 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2 disabled:opacity-50"
                    >
                        {isSaving ? (
                            <Loader2Icon />
                        ) : saveSuccess ? (
                            <>
                                <CheckCircle size={16} />
                                Config Saved!
                            </>
                        ) : (
                            <>
                                <Save size={16} />
                                Save Global Parameters
                            </>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
};

const Loader2Icon = () => (
    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
);
