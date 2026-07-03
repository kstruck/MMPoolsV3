import React, { useState, useEffect } from 'react';
import { db, auth } from '../../firebase';
import { 
    collection, doc, onSnapshot, setDoc, updateDoc, 
    addDoc, deleteDoc, query, orderBy 
} from 'firebase/firestore';
import { dbService } from '../../services/dbService';
import type { BillingConfig, Pool, PoolBilling, Coupon, ReferralConfig, User, BillingBundle } from '../../types';
import {
    Shield, Zap, Search, Save, CheckCircle,
    ToggleLeft, ToggleRight, Calendar, Plus, Trash2, Ticket, Award,
    Trophy, Settings, Gift, Target, KeyRound
} from 'lucide-react';
import { useToast } from '../ui/Toast';

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
    },
    packages: {
        buy_3: 49.00,
        unlimited_1yr: 129.00
    }
};

const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
    creditsRequiredForFreePool: 5,
    discountPerCredit: 5.00,
    rewardType: 'free_pool'
};

type AdminSubTab = 'tiers' | 'features' | 'packages' | 'coupons' | 'referrals' | 'pools';

export const SuperAdminBillingPanel: React.FC = () => {
    const toast = useToast();
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

    // New Dynamic Bundle Form State
    const [newBundleName, setNewBundleName] = useState<string>('');
    const [newBundleDesc, setNewBundleDesc] = useState<string>('');
    const [newBundlePrice, setNewBundlePrice] = useState<number>(39);
    const [newBundlePoolType, setNewBundlePoolType] = useState<string>('ALL');
    const [newBundleMaxPlayers, setNewBundleMaxPlayers] = useState<number>(50);
    const [newBundlePoolsIncluded, setNewBundlePoolsIncluded] = useState<number>(3);
    const [newBundleDuration, setNewBundleDuration] = useState<number>(0);

    // Sync custom claims on mount for active session to resolve catch-22 permissions issue
    useEffect(() => {
        const syncAdminClaims = async () => {
            try {
                console.log("[SuperAdminBillingPanel] Checking and syncing admin custom claims...");
                const result = await dbService.syncMyClaims();
                console.log("[SuperAdminBillingPanel] Sync claims result:", result);
                if (result.success && auth.currentUser) {
                    console.log("[SuperAdminBillingPanel] Force refreshing Auth ID token...");
                    await auth.currentUser.getIdToken(true);
                    console.log("[SuperAdminBillingPanel] Auth ID token refreshed successfully!");
                }
            } catch (err) {
                console.error("[SuperAdminBillingPanel] Failed to sync admin custom claims:", err);
            }
        };
        syncAdminClaims();
    }, []);

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

    // 5.5. Dynamic Bundle Helpers
    const handleAddBundle = () => {
        if (!newBundleName.trim() || !newBundleDesc.trim()) {
            toast.error("Name and description are required.");
            return;
        }

        const newBundle: BillingBundle = {
            id: `bundle_${Date.now()}`,
            name: newBundleName.trim(),
            description: newBundleDesc.trim(),
            price: newBundlePrice,
            poolType: newBundlePoolType as any,
            maxPlayersPerPool: newBundleMaxPlayers,
            poolsIncluded: newBundlePoolsIncluded,
            durationDays: newBundleDuration,
            isActive: true
        };

        const currentList = Array.isArray(config.packagesList) ? config.packagesList : [];
        setConfig({
            ...config,
            packagesList: [...currentList, newBundle]
        });

        // Reset Form
        setNewBundleName('');
        setNewBundleDesc('');
        setNewBundlePrice(39);
        setNewBundlePoolType('ALL');
        setNewBundleMaxPlayers(50);
        setNewBundlePoolsIncluded(3);
        setNewBundleDuration(0);
    };

    const handleDeleteBundle = async (bundleId: string) => {
        const ok = await toast.confirm({ title: 'Delete Custom Bundle?', message: 'Are you sure you want to delete this custom bundle?', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        const currentList = Array.isArray(config.packagesList) ? config.packagesList : [];
        setConfig({
            ...config,
            packagesList: currentList.filter(b => b.id !== bundleId)
        });
    };

    const handleToggleBundleActive = (bundleId: string) => {
        const currentList = Array.isArray(config.packagesList) ? config.packagesList : [];
        setConfig({
            ...config,
            packagesList: currentList.map(b => b.id === bundleId ? { ...b, isActive: !b.isActive } : b)
        });
    };

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
            toast.error("Error saving configuration to Firestore.");
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
            toast.error("Error saving referral configurations.");
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
            const couponData: any = {
                code: newCouponCode.trim().toUpperCase(),
                discountType: newCouponType,
                discountValue: newCouponValue,
                isActive: true,
                usesCount: 0,
                createdAt: Date.now(),
                usageLog: []
            };

            if (newCouponMaxUses) couponData.maxUses = parseInt(newCouponMaxUses);
            if (newCouponPerUserLimit) couponData.perUserLimit = parseInt(newCouponPerUserLimit);
            if (newCouponExpiresAt) couponData.expiresAt = new Date(newCouponExpiresAt).getTime();
            if (newCouponAllowedTypes.length > 0) couponData.allowedPoolTypes = newCouponAllowedTypes;

            await addDoc(collection(db, 'coupons'), couponData);
            setNewCouponCode('');
            setNewCouponMaxUses('');
            setNewCouponPerUserLimit('');
            setNewCouponExpiresAt('');
            setNewCouponAllowedTypes([]);
            toast.success(`Coupon ${couponData.code} created successfully!`);
        } catch (error) {
            console.error("Failed to create coupon:", error);
            toast.error("Failed to write coupon to database.");
        } finally {
            setIsCreatingCoupon(false);
        }
    };

    // 9. Delete Coupon code
    const handleDeleteCoupon = async (couponId: string, code: string) => {
        const ok = await toast.confirm({ title: 'Delete Coupon?', message: `Are you sure you want to delete coupon ${code}?`, confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        try {
            await deleteDoc(doc(db, 'coupons', couponId));
        } catch (error) {
            console.error("Failed to delete coupon:", error);
            toast.error("Deletion failed.");
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
            toast.success("Pool billing parameters overridden successfully!");
        } catch (error) {
            console.error("Override failed:", error);
            toast.error("Failed to update pool billing configuration.");
        }
    };

    // 11b. Quick Action: Extend Trial by 14 days
    const handleExtendTrial = async (pool: Pool) => {
        const ok = await toast.confirm({ title: 'Extend Trial?', message: `Extend trial for "${pool.name}" by 14 days?`, confirmLabel: 'Extend' });
        if (!ok) return;
        try {
            const poolRef = doc(db, 'pools', pool.id);
            const currentEnd = pool.billing?.trialEndsAt || Date.now();
            await updateDoc(poolRef, {
                'billing.status': 'trial',
                'billing.trialEndsAt': currentEnd + (14 * 24 * 60 * 60 * 1000),
                updatedAt: Date.now()
            });
            toast.success(`Trial extended by 14 days for "${pool.name}"`);
        } catch (error) {
            console.error("Extend trial failed:", error);
            toast.error("Failed to extend trial.");
        }
    };

    // 11c. Quick Action: Reset Grace Period
    const handleResetGrace = async (pool: Pool) => {
        const ok = await toast.confirm({ title: 'Reset Grace Period?', message: `Reset grace period for "${pool.name}"? This will move it from locked/grace back to grace_period with ${config.gracePeriodDays} days.`, confirmLabel: 'Reset', danger: true });
        if (!ok) return;
        try {
            const poolRef = doc(db, 'pools', pool.id);
            await updateDoc(poolRef, {
                'billing.status': 'grace_period',
                'billing.gracePeriodEndsAt': Date.now() + (config.gracePeriodDays * 24 * 60 * 60 * 1000),
                updatedAt: Date.now()
            });
            toast.success(`Grace period reset for "${pool.name}" — ${config.gracePeriodDays} days from now.`);
        } catch (error) {
            console.error("Reset grace failed:", error);
            toast.error("Failed to reset grace period.");
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
            toast.success("User referral credit balances updated!");
            
            // Reload list
            const list = await dbService.getAllUsers();
            setAllUsers(list);
        } catch (error) {
            console.error(error);
            toast.error("Failed to update user profile.");
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
        <div className="bg-card border border-line rounded-3xl p-6 md:p-8 space-y-6 relative overflow-hidden backdrop-blur-md">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center border-b border-line pb-4 gap-4">
                <div className="space-y-1">
                    <h2 className="text-2xl font-display font-extrabold uppercase tracking-[0.03em] text-[color:var(--text)] flex items-center gap-2">
                        <Shield className="text-gold-500" size={24} /> Monetization Dashboard
                    </h2>
                    <p className="text-xs text-muted">Configure core product tiers, feature matrix toggles, coupon configurations, and customer billing overrides.</p>
                </div>

                {/* Tab Navigation */}
                <div className="flex flex-wrap p-0.5 bg-page border border-line rounded-xl">
                    <button
                        onClick={() => setSubTab('tiers')}
                        className={`px-3 py-1.5 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-lg transition-all flex items-center gap-1.5 ${
                            subTab === 'tiers' ? 'bg-navy-800 text-white' : 'text-muted hover:text-[color:var(--text)]'
                        }`}
                    >
                        <Trophy size={13} /> Base Tiers
                    </button>
                    <button
                        onClick={() => setSubTab('features')}
                        className={`px-3 py-1.5 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-lg transition-all flex items-center gap-1.5 ${
                            subTab === 'features' ? 'bg-navy-800 text-white' : 'text-muted hover:text-[color:var(--text)]'
                        }`}
                    >
                        <Settings size={13} /> Feature Matrix
                    </button>
                    <button
                        onClick={() => setSubTab('coupons')}
                        className={`px-3 py-1.5 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-lg transition-all flex items-center gap-1.5 ${
                            subTab === 'coupons' ? 'bg-navy-800 text-white' : 'text-muted hover:text-[color:var(--text)]'
                        }`}
                    >
                        <Ticket size={13} /> Coupon Codes
                    </button>
                    <button
                        onClick={() => setSubTab('packages')}
                        className={`px-3 py-1.5 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-lg transition-all flex items-center gap-1.5 ${
                            subTab === 'packages' ? 'bg-navy-800 text-white' : 'text-muted hover:text-[color:var(--text)]'
                        }`}
                    >
                        <Gift size={13} /> Packages
                    </button>
                    <button
                        onClick={() => setSubTab('referrals')}
                        className={`px-3 py-1.5 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-lg transition-all flex items-center gap-1.5 ${
                            subTab === 'referrals' ? 'bg-navy-800 text-white' : 'text-muted hover:text-[color:var(--text)]'
                        }`}
                    >
                        <Award size={13} /> Referral Policy
                    </button>
                    <button
                        onClick={() => setSubTab('pools')}
                        className={`px-3 py-1.5 text-xs font-display font-bold uppercase tracking-[0.05em] rounded-lg transition-all flex items-center gap-1.5 ${
                            subTab === 'pools' ? 'bg-navy-800 text-white' : 'text-muted hover:text-[color:var(--text)]'
                        }`}
                    >
                        <KeyRound size={13} /> Pool Overrides
                    </button>
                </div>
            </div>

            {/* TAB 1: TIERS & BASE PRICING */}
            {subTab === 'tiers' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Global Trial Parameters */}
                        <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
                            <h3 className="text-sm font-display font-bold uppercase tracking-[0.08em] flex items-center gap-1.5 text-gold-500">
                                <Calendar size={16} /> Global Grace Policies
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Free Limit (Players)</label>
                                    <input
                                        type="number"
                                        value={config.freePlayerThreshold}
                                        onChange={(e) => setConfig({ ...config, freePlayerThreshold: Math.max(0, parseInt(e.target.value) || 0) })}
                                        className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold"
                                    />
                                    <span className="text-[9px] text-faint leading-normal mt-1 block font-body">Pools with this count or fewer are 100% free.</span>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Grace Period (Days)</label>
                                    <input
                                        type="number"
                                        value={config.gracePeriodDays}
                                        onChange={(e) => setConfig({ ...config, gracePeriodDays: Math.max(0, parseInt(e.target.value) || 0) })}
                                        className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold"
                                    />
                                    <span className="text-[9px] text-faint leading-normal mt-1 block font-body">Free weeks allowed before lockouts trigger.</span>
                                </div>
                            </div>
                        </div>

                        {/* Explanatory Note */}
                        <div className="p-5 rounded-2xl bg-surface border border-line space-y-4 flex flex-col justify-center">
                            <h3 className="text-sm font-display font-bold uppercase tracking-[0.08em] flex items-center gap-1.5 text-gold-500">
                                <Zap size={16} /> Tiered pricing policy
                            </h3>
                            <p className="text-xs text-muted leading-relaxed font-body">
                                Pricing tiers are now dynamically applied to all formats (Season-long, NCAA Bracket, Gameday Squares Grid, and Custom Prop sheets) based on player count. Update the prices for each tier below.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* 🏈 NFL SEASON TIERS */}
                        <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="text-sm font-display font-bold uppercase tracking-[0.08em] text-gold-500 flex items-center gap-1.5">
                                    <Trophy size={16} className="text-gold-500" /> NFL Season Pools Pricing Tiers
                                </h3>
                                <button
                                    onClick={() => {
                                        const currentTiers = Array.isArray(config.pricing.season) ? config.pricing.season : [];
                                        const newTier = { min: 101, max: 9999, price: 149 };
                                        setConfig({
                                            ...config,
                                            pricing: {
                                                ...config.pricing,
                                                season: [...currentTiers, newTier]
                                            }
                                        });
                                    }}
                                    className="px-2 py-1 rounded bg-gold-500/10 hover:bg-gold-500/25 border border-gold-500/25 text-gold-700 dark:text-gold-400 font-display font-bold text-[10px] uppercase tracking-[0.08em] flex items-center gap-1 transition-all"
                                >
                                    <Plus size={10} /> Add Tier
                                </button>
                            </div>
                            <div className="space-y-3">
                                {(Array.isArray(config.pricing.season) ? config.pricing.season : []).map((tier, idx) => (
                                    <div key={idx} className="flex justify-between items-center bg-page px-4 py-2.5 rounded-xl border border-line gap-2">
                                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[color:var(--text)] font-body">
                                            <input
                                                type="number"
                                                value={tier.min}
                                                onChange={(e) => {
                                                    const tiers = [...config.pricing.season];
                                                    tiers[idx].min = Math.max(0, parseInt(e.target.value) || 0);
                                                    setConfig({ ...config, pricing: { ...config.pricing, season: tiers } });
                                                }}
                                                className="num w-16 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-[color:var(--text)]"
                                            />
                                            <span>to</span>
                                            <input
                                                type="number"
                                                value={tier.max}
                                                onChange={(e) => {
                                                    const tiers = [...config.pricing.season];
                                                    tiers[idx].max = Math.max(0, parseInt(e.target.value) || 0);
                                                    setConfig({ ...config, pricing: { ...config.pricing, season: tiers } });
                                                }}
                                                className="num w-20 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-[color:var(--text)]"
                                            />
                                            <span>Players</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-0.5">
                                                <span className="text-gold-700 dark:text-gold-400 font-bold text-[10px] num">$</span>
                                                <input
                                                    type="number"
                                                    value={tier.price}
                                                    onChange={(e) => {
                                                        const tiers = [...config.pricing.season];
                                                        tiers[idx].price = Math.max(0, parseInt(e.target.value) || 0);
                                                        setConfig({ ...config, pricing: { ...config.pricing, season: tiers } });
                                                    }}
                                                    className="num w-14 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-gold-700 dark:text-gold-400"
                                                />
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const tiers = config.pricing.season.filter((_, i) => i !== idx);
                                                    setConfig({ ...config, pricing: { ...config.pricing, season: tiers } });
                                                }}
                                                className="text-brandred-600 hover:text-brandred-500 p-0.5 rounded transition-colors"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 🏀 BRACKET POOLS TIERS */}
                        <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="text-sm font-display font-bold uppercase tracking-[0.08em] text-gold-500 flex items-center gap-1.5">
                                    <Trophy size={16} className="text-gold-500" /> NCAA Bracket Pools Pricing Tiers
                                </h3>
                                <button
                                    onClick={() => {
                                        const currentTiers = Array.isArray(config.pricing.bracket) ? config.pricing.bracket : [];
                                        const newTier = { min: 101, max: 9999, price: 99 };
                                        setConfig({
                                            ...config,
                                            pricing: {
                                                ...config.pricing,
                                                bracket: [...currentTiers, newTier]
                                            }
                                        });
                                    }}
                                    className="px-2 py-1 rounded bg-gold-500/10 hover:bg-gold-500/25 border border-gold-500/25 text-gold-700 dark:text-gold-400 font-display font-bold text-[10px] uppercase tracking-[0.08em] flex items-center gap-1 transition-all"
                                >
                                    <Plus size={10} /> Add Tier
                                </button>
                            </div>
                            <div className="space-y-3">
                                {(Array.isArray(config.pricing.bracket) ? config.pricing.bracket : []).map((tier, idx) => (
                                    <div key={idx} className="flex justify-between items-center bg-page px-4 py-2.5 rounded-xl border border-line gap-2">
                                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[color:var(--text)] font-body">
                                            <input
                                                type="number"
                                                value={tier.min}
                                                onChange={(e) => {
                                                    const tiers = [...config.pricing.bracket];
                                                    tiers[idx].min = Math.max(0, parseInt(e.target.value) || 0);
                                                    setConfig({ ...config, pricing: { ...config.pricing, bracket: tiers } });
                                                }}
                                                className="num w-16 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-[color:var(--text)]"
                                            />
                                            <span>to</span>
                                            <input
                                                type="number"
                                                value={tier.max}
                                                onChange={(e) => {
                                                    const tiers = [...config.pricing.bracket];
                                                    tiers[idx].max = Math.max(0, parseInt(e.target.value) || 0);
                                                    setConfig({ ...config, pricing: { ...config.pricing, bracket: tiers } });
                                                }}
                                                className="num w-20 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-[color:var(--text)]"
                                            />
                                            <span>Players</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-0.5">
                                                <span className="text-gold-700 dark:text-gold-400 font-bold text-[10px] num">$</span>
                                                <input
                                                    type="number"
                                                    value={tier.price}
                                                    onChange={(e) => {
                                                        const tiers = [...config.pricing.bracket];
                                                        tiers[idx].price = Math.max(0, parseInt(e.target.value) || 0);
                                                        setConfig({ ...config, pricing: { ...config.pricing, bracket: tiers } });
                                                    }}
                                                    className="num w-14 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-gold-700 dark:text-gold-400"
                                                />
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const tiers = config.pricing.bracket.filter((_, i) => i !== idx);
                                                    setConfig({ ...config, pricing: { ...config.pricing, bracket: tiers } });
                                                }}
                                                className="text-brandred-600 hover:text-brandred-500 p-0.5 rounded transition-colors"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 🟩 GAMEDAY SQUARES TIERS */}
                        <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="text-sm font-display font-bold uppercase tracking-[0.08em] text-gold-500 flex items-center gap-1.5">
                                    <Target size={16} className="text-gold-500" /> Gameday Squares Pricing Tiers
                                </h3>
                                <button
                                    onClick={() => {
                                        const currentTiers = Array.isArray(config.pricing.squares) ? config.pricing.squares : [];
                                        const newTier = { min: 101, max: 9999, price: 39 };
                                        setConfig({
                                            ...config,
                                            pricing: {
                                                ...config.pricing,
                                                squares: [...currentTiers, newTier]
                                            }
                                        });
                                    }}
                                    className="px-2 py-1 rounded bg-gold-500/10 hover:bg-gold-500/25 border border-gold-500/25 text-gold-700 dark:text-gold-400 font-display font-bold text-[10px] uppercase tracking-[0.08em] flex items-center gap-1 transition-all"
                                >
                                    <Plus size={10} /> Add Tier
                                </button>
                            </div>
                            <div className="space-y-3">
                                {(Array.isArray(config.pricing.squares) ? config.pricing.squares : []).map((tier, idx) => (
                                    <div key={idx} className="flex justify-between items-center bg-page px-4 py-2.5 rounded-xl border border-line gap-2">
                                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[color:var(--text)] font-body">
                                            <input
                                                type="number"
                                                value={tier.min}
                                                onChange={(e) => {
                                                    const tiers = [...config.pricing.squares];
                                                    tiers[idx].min = Math.max(0, parseInt(e.target.value) || 0);
                                                    setConfig({ ...config, pricing: { ...config.pricing, squares: tiers } });
                                                }}
                                                className="num w-16 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-[color:var(--text)]"
                                            />
                                            <span>to</span>
                                            <input
                                                type="number"
                                                value={tier.max}
                                                onChange={(e) => {
                                                    const tiers = [...config.pricing.squares];
                                                    tiers[idx].max = Math.max(0, parseInt(e.target.value) || 0);
                                                    setConfig({ ...config, pricing: { ...config.pricing, squares: tiers } });
                                                }}
                                                className="num w-20 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-[color:var(--text)]"
                                            />
                                            <span>Players</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-0.5">
                                                <span className="text-gold-700 dark:text-gold-400 font-bold text-[10px] num">$</span>
                                                <input
                                                    type="number"
                                                    value={tier.price}
                                                    onChange={(e) => {
                                                        const tiers = [...config.pricing.squares];
                                                        tiers[idx].price = Math.max(0, parseInt(e.target.value) || 0);
                                                        setConfig({ ...config, pricing: { ...config.pricing, squares: tiers } });
                                                    }}
                                                    className="num w-14 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-gold-700 dark:text-gold-400"
                                                />
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const tiers = config.pricing.squares.filter((_, i) => i !== idx);
                                                    setConfig({ ...config, pricing: { ...config.pricing, squares: tiers } });
                                                }}
                                                className="text-brandred-600 hover:text-brandred-500 p-0.5 rounded transition-colors"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 📝 PROP BETS TIERS */}
                        <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="text-sm font-display font-bold uppercase tracking-[0.08em] text-gold-500 flex items-center gap-1.5">
                                    <Ticket size={16} className="text-gold-500" /> Prop Sheets Pricing Tiers
                                </h3>
                                <button
                                    onClick={() => {
                                        const currentTiers = Array.isArray(config.pricing.props) ? config.pricing.props : [];
                                        const newTier = { min: 101, max: 9999, price: 39 };
                                        setConfig({
                                            ...config,
                                            pricing: {
                                                ...config.pricing,
                                                props: [...currentTiers, newTier]
                                            }
                                        });
                                    }}
                                    className="px-2 py-1 rounded bg-gold-500/10 hover:bg-gold-500/25 border border-gold-500/25 text-gold-700 dark:text-gold-400 font-display font-bold text-[10px] uppercase tracking-[0.08em] flex items-center gap-1 transition-all"
                                >
                                    <Plus size={10} /> Add Tier
                                </button>
                            </div>
                            <div className="space-y-3">
                                {(Array.isArray(config.pricing.props) ? config.pricing.props : []).map((tier, idx) => (
                                    <div key={idx} className="flex justify-between items-center bg-page px-4 py-2.5 rounded-xl border border-line gap-2">
                                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[color:var(--text)] font-body">
                                            <input
                                                type="number"
                                                value={tier.min}
                                                onChange={(e) => {
                                                    const tiers = [...config.pricing.props];
                                                    tiers[idx].min = Math.max(0, parseInt(e.target.value) || 0);
                                                    setConfig({ ...config, pricing: { ...config.pricing, props: tiers } });
                                                }}
                                                className="num w-16 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-[color:var(--text)]"
                                            />
                                            <span>to</span>
                                            <input
                                                type="number"
                                                value={tier.max}
                                                onChange={(e) => {
                                                    const tiers = [...config.pricing.props];
                                                    tiers[idx].max = Math.max(0, parseInt(e.target.value) || 0);
                                                    setConfig({ ...config, pricing: { ...config.pricing, props: tiers } });
                                                }}
                                                className="num w-20 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-[color:var(--text)]"
                                            />
                                            <span>Players</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-0.5">
                                                <span className="text-gold-700 dark:text-gold-400 font-bold text-[10px] num">$</span>
                                                <input
                                                    type="number"
                                                    value={tier.price}
                                                    onChange={(e) => {
                                                        const tiers = [...config.pricing.props];
                                                        tiers[idx].price = Math.max(0, parseInt(e.target.value) || 0);
                                                        setConfig({ ...config, pricing: { ...config.pricing, props: tiers } });
                                                    }}
                                                    className="num w-14 bg-page border-[1.5px] border-line text-center font-bold rounded px-1 py-0.5 text-xs text-gold-700 dark:text-gold-400"
                                                />
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const tiers = config.pricing.props.filter((_, i) => i !== idx);
                                                    setConfig({ ...config, pricing: { ...config.pricing, props: tiers } });
                                                }}
                                                className="text-brandred-600 hover:text-brandred-500 p-0.5 rounded transition-colors"
                                            >
                                                <Trash2 size={13} />
                                            </button>
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
                    <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
                        <h3 className="text-sm font-display font-bold uppercase tracking-[0.08em] flex items-center gap-1.5 text-gold-500">
                            <Settings size={16} className="text-gold-500" /> Feature Premium/Add-on Allocation Control
                        </h3>
                        <p className="text-xs text-muted font-body">Determine which premium tools are unlocked automatically vs. require an addon fee at checkout.</p>

                        <div className="space-y-4 pt-2">
                            {[
                                { key: 'aiCommissioner', label: 'AI Dispute Commissioner (Gemini) [ALL POOLS]' },
                                { key: 'whatIfSimulator', label: 'What-If Standings Simulator [BRACKET]' },
                                { key: 'customBranding', label: 'Custom Cover & Branding Customization [ALL POOLS]' },
                            ].map(({ key, label }) => {
                                const feat = (config.features as any)[key];
                                return (
                                    <div key={key} className="flex flex-col md:flex-row justify-between items-start md:items-center bg-page p-4 rounded-2xl border border-line gap-4">
                                        <div className="space-y-1">
                                            <span className="text-xs font-bold text-[color:var(--text)] block font-body">{label}</span>
                                            <span className="text-[10px] text-faint block font-body">
                                                {feat.isPremium ? 'Currently Premium Upgrade Addon' : 'Currently Standard Free Allocation'}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-6 self-end md:self-auto">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-muted font-display font-bold uppercase tracking-[0.08em]">Upgrade Addon?</span>
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
                                                    className="text-gold-500 hover:brightness-110"
                                                >
                                                    {feat.isPremium ? <ToggleRight size={28} /> : <ToggleLeft size={28} className="text-faint" />}
                                                </button>
                                            </div>

                                            {feat.isPremium && (
                                                <div className="flex items-center gap-1 bg-page px-2 py-1 rounded border border-line">
                                                    <span className="text-[10px] text-gold-700 dark:text-gold-400 font-bold num">$</span>
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
                                                        className="num w-14 bg-transparent border-none text-center font-bold text-xs text-gold-700 dark:text-gold-400 outline-none"
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
                        <form onSubmit={handleCreateCoupon} className="lg:col-span-4 bg-surface p-6 border border-line rounded-2xl space-y-4">
                            <h3 className="font-display font-bold text-gold-500 flex items-center gap-1.5 border-b border-line pb-2 text-sm uppercase tracking-[0.08em]">
                                <Ticket size={16} className="text-gold-500" /> Spawn Coupon Code
                            </h3>

                            <div>
                                <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Coupon Code</label>
                                <input
                                    type="text"
                                    required
                                    value={newCouponCode}
                                    onChange={(e) => setNewCouponCode(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
                                    placeholder="OFFICE50"
                                    className="w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold text-sm outline-none uppercase font-body placeholder:text-faint"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Discount Type</label>
                                    <select
                                        value={newCouponType}
                                        onChange={(e) => setNewCouponType(e.target.value as any)}
                                        className="w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold text-xs font-body"
                                    >
                                        <option value="percentage">Percentage (%)</option>
                                        <option value="flat">Flat ($)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Value</label>
                                    <input
                                        type="number"
                                        required
                                        value={newCouponValue}
                                        onChange={(e) => setNewCouponValue(Math.max(0, parseInt(e.target.value) || 0))}
                                        className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold text-xs"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Max Uses Limit (Optional)</label>
                                <input
                                    type="number"
                                    value={newCouponMaxUses}
                                    onChange={(e) => setNewCouponMaxUses(e.target.value)}
                                    placeholder="Unlimited if empty"
                                    className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] text-xs outline-none font-body placeholder:text-faint"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Per-User Limit (Optional)</label>
                                <input
                                    type="number"
                                    value={newCouponPerUserLimit}
                                    onChange={(e) => setNewCouponPerUserLimit(e.target.value)}
                                    placeholder="No limit if empty"
                                    className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] text-xs outline-none font-body placeholder:text-faint"
                                />
                                <span className="text-[9px] text-faint mt-1 block font-body">Max times a single commissioner can use this code.</span>
                            </div>

                            <div>
                                <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Expiration Date (Optional)</label>
                                <input
                                    type="datetime-local"
                                    value={newCouponExpiresAt}
                                    onChange={(e) => setNewCouponExpiresAt(e.target.value)}
                                    className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] text-xs outline-none font-body"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Restrict to Pool Types (Optional)</label>
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
                                            className={`px-2 py-0.5 rounded-full text-[9px] font-display font-bold uppercase tracking-[0.05em] border transition-all ${
                                                newCouponAllowedTypes.includes(pt)
                                                    ? 'bg-gold-500/10 border-gold-500/25 text-gold-700 dark:text-gold-400'
                                                    : 'bg-page border-line text-faint hover:text-[color:var(--text)]'
                                            }`}
                                        >
                                            {pt.replace('NFL_', '')}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-[9px] text-faint mt-1 block font-body">Leave empty to allow all pool types.</span>
                            </div>

                            <button
                                type="submit"
                                disabled={isCreatingCoupon}
                                className="w-full py-2 bg-brandred-600 hover:bg-brandred-500 text-white font-display font-bold uppercase tracking-[0.05em] rounded-xl text-xs flex items-center justify-center gap-1 shadow-[0_6px_16px_rgba(196,52,46,0.28)]"
                            >
                                <Plus size={14} /> Create Coupon
                            </button>
                        </form>

                        {/* Right: Coupon List */}
                        <div className="lg:col-span-8 bg-surface border border-line p-6 rounded-2xl space-y-4">
                            <h3 className="font-display font-bold text-[color:var(--text)] text-sm uppercase tracking-[0.08em]">Active Campaign Coupons</h3>

                            <div className="overflow-x-auto border border-line rounded-xl">
                                <table className="w-full text-left text-xs">
                                    <thead>
                                        <tr className="bg-page text-muted font-display font-bold uppercase tracking-[0.08em] text-[12px]">
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
                                                    <tr className="border-b border-line hover:bg-page">
                                                        <td className="p-3 font-mono font-bold text-[color:var(--text)] tracking-wider">
                                                            {coupon.code}
                                                            {isExpired && (
                                                                <span className="ml-2 px-1.5 py-0.5 rounded text-[8px] font-display font-bold uppercase tracking-[0.05em] bg-[#FBEEDD] border border-[#F2D6B0] text-[#B4530A]">
                                                                    EXPIRED
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 font-bold text-[#0F7B4A] num font-body">
                                                            {coupon.discountType === 'percentage' ? `${coupon.discountValue}% Off` : `$${coupon.discountValue} Off`}
                                                        </td>
                                                        <td className="p-3">
                                                            <button
                                                                onClick={() => handleToggleCouponActive(coupon)}
                                                                className={`px-2 py-0.5 rounded-full font-display font-bold text-[9px] uppercase tracking-[0.05em] border transition-all ${
                                                                    coupon.isActive
                                                                        ? 'bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]'
                                                                        : 'bg-[#FBEEDD] border border-[#F2D6B0] text-[#B4530A]'
                                                                }`}
                                                            >
                                                                {coupon.isActive ? 'Active' : 'Paused'}
                                                            </button>
                                                        </td>
                                                        <td className="p-3 text-muted font-mono num">
                                                            <button
                                                                onClick={() => setExpandedCouponId(expandedCouponId === coupon.id ? '' : (coupon.id || ''))}
                                                                className="hover:text-[color:var(--text)] transition-colors"
                                                            >
                                                                {coupon.usesCount} / {coupon.maxUses || '∞'}
                                                            </button>
                                                        </td>
                                                        <td className="p-3 text-faint text-[10px] font-body">
                                                            {coupon.perUserLimit && <span className="block num">Per-user: {coupon.perUserLimit}x</span>}
                                                            {coupon.allowedPoolTypes && coupon.allowedPoolTypes.length > 0 && (
                                                                <span className="block">{coupon.allowedPoolTypes.join(', ')}</span>
                                                            )}
                                                            {coupon.expiresAt && (
                                                                <span className="block num">Exp: {new Date(coupon.expiresAt).toLocaleDateString()}</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-right">
                                                            <button
                                                                onClick={() => handleDeleteCoupon(coupon.id!, coupon.code)}
                                                                className="p-1.5 text-brandred-600 hover:text-brandred-500 rounded transition-colors"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    {/* Expandable usage log */}
                                                    {expandedCouponId === coupon.id && coupon.usageLog && coupon.usageLog.length > 0 && (
                                                        <tr>
                                                            <td colSpan={6} className="p-0">
                                                                <div className="bg-page px-4 py-3 border-t border-line">
                                                                    <h4 className="text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-2">Usage Audit Log</h4>
                                                                    <div className="space-y-1 max-h-40 overflow-y-auto">
                                                                        {coupon.usageLog.map((entry, idx) => (
                                                                            <div key={idx} className="flex items-center justify-between text-[10px] text-faint font-mono">
                                                                                <span>User: {entry.userId.substring(0, 12)}...</span>
                                                                                <span>Pool: {entry.poolId.substring(0, 12)}...</span>
                                                                                <span className="num">{new Date(entry.usedAt).toLocaleString()}</span>
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
                                                <td colSpan={6} className="p-8 text-center text-faint font-body">
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

            {/* TAB 3.5: BUNDLES & PACKAGES CONFIG */}
            {subTab === 'packages' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                        {/* Left: Bundle Creator Form */}
                        <div className="lg:col-span-5 bg-surface p-6 border border-line rounded-2xl space-y-4">
                            <h3 className="font-display font-bold text-gold-500 flex items-center gap-1.5 border-b border-line pb-2 text-sm uppercase tracking-[0.08em]">
                                <Gift size={16} className="text-gold-500" /> Spawn Custom Credit Bundle
                            </h3>

                            <div>
                                <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Bundle Name</label>
                                <input
                                    type="text"
                                    required
                                    value={newBundleName}
                                    onChange={(e) => setNewBundleName(e.target.value)}
                                    placeholder="e.g. 3-Pool Squares Pack (Up to 50 Players)"
                                    className="w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold text-xs outline-none font-body placeholder:text-faint"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Description</label>
                                <textarea
                                    required
                                    value={newBundleDesc}
                                    onChange={(e) => setNewBundleDesc(e.target.value)}
                                    placeholder="e.g. Host 3 Gameday Squares pools with up to 50 players each."
                                    rows={2}
                                    className="w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] text-xs outline-none resize-none font-body placeholder:text-faint"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Price ($)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        value={newBundlePrice}
                                        onChange={(e) => setNewBundlePrice(Math.max(0, parseFloat(e.target.value) || 0))}
                                        className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-gold-700 dark:text-gold-400 font-bold text-xs"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Pool Type Restrict</label>
                                    <select
                                        value={newBundlePoolType}
                                        onChange={(e) => setNewBundlePoolType(e.target.value)}
                                        className="w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold text-xs font-body"
                                    >
                                        <option value="ALL">All Pools (Universal)</option>
                                        <option value="SQUARES">SQUARES (Gameday Grid)</option>
                                        <option value="BRACKET">BRACKET (NCAA March Madness)</option>
                                        <option value="PROPS">PROPS (Custom Sheets)</option>
                                        <option value="NFL_PLAYOFFS">NFL_PLAYOFFS (Bracket)</option>
                                        <option value="NFL_PICKEM">NFL_PICKEM (Weekly)</option>
                                        <option value="NFL_SURVIVOR">NFL_SURVIVOR (Survivor)</option>
                                        <option value="NFL_MARGIN">NFL_MARGIN (Margin)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5" title="Maximum players allowed per pool inside the bundle">Max Players</label>
                                    <input
                                        type="number"
                                        required
                                        value={newBundleMaxPlayers}
                                        onChange={(e) => setNewBundleMaxPlayers(Math.max(1, parseInt(e.target.value) || 1))}
                                        className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold text-xs text-center"
                                    />
                                    <span className="text-[8px] text-faint mt-0.5 block text-center font-body num">9999 = Unlimited</span>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5" title="Number of pool credits included in this package">Pools Included</label>
                                    <input
                                        type="number"
                                        required
                                        value={newBundlePoolsIncluded}
                                        onChange={(e) => setNewBundlePoolsIncluded(Math.max(1, parseInt(e.target.value) || 1))}
                                        className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold text-xs text-center"
                                    />
                                    <span className="text-[8px] text-faint mt-0.5 block text-center font-body num">9999 = Unlimited</span>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5" title="Period of validity for the credits in days. 0 = never expires">Duration (Days)</label>
                                    <input
                                        type="number"
                                        required
                                        value={newBundleDuration}
                                        onChange={(e) => setNewBundleDuration(Math.max(0, parseInt(e.target.value) || 0))}
                                        className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold text-xs text-center"
                                    />
                                    <span className="text-[8px] text-faint mt-0.5 block text-center font-body num">0 = No Expiration</span>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={handleAddBundle}
                                className="w-full py-2.5 bg-brandred-600 hover:bg-brandred-500 text-white font-display font-bold uppercase tracking-[0.05em] rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-[0_6px_16px_rgba(196,52,46,0.28)]"
                            >
                                <Plus size={14} /> Add Bundle to Ledger
                            </button>
                        </div>

                        {/* Right: Created Dynamic Bundles list */}
                        <div className="lg:col-span-7 bg-surface border border-line p-6 rounded-2xl space-y-4">
                            <h3 className="font-display font-bold text-[color:var(--text)] text-sm uppercase tracking-[0.08em]">Custom Dynamic Bundles Ledger</h3>

                            <div className="overflow-x-auto border border-line rounded-xl">
                                <table className="w-full text-left text-xs whitespace-nowrap">
                                    <thead>
                                        <tr className="bg-page text-muted font-display font-bold uppercase tracking-[0.08em] text-[12px]">
                                            <th className="p-3">Bundle Specification</th>
                                            <th className="p-3 text-center">Constraints</th>
                                            <th className="p-3 text-center">Price</th>
                                            <th className="p-3 text-center">Status</th>
                                            <th className="p-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(Array.isArray(config.packagesList) ? config.packagesList : []).map((b) => (
                                            <tr key={b.id} className="border-b border-line hover:bg-page">
                                                <td className="p-3 max-w-[200px] truncate">
                                                    <div className="font-bold text-[color:var(--text)] text-xs font-body">{b.name}</div>
                                                    <div className="text-[9px] text-faint mt-0.5 leading-normal whitespace-normal font-body">{b.description}</div>
                                                </td>
                                                <td className="p-3 text-[10px] text-muted font-medium">
                                                    <div className="flex flex-col gap-0.5 font-mono">
                                                        <span>Pool: <strong className="text-gold-700 dark:text-gold-400">{b.poolType}</strong></span>
                                                        <span>Max Size: <strong className="text-gold-700 dark:text-gold-400 num">{b.maxPlayersPerPool === 9999 ? '∞' : `${b.maxPlayersPerPool} players`}</strong></span>
                                                        <span>Count: <strong className="text-gold-700 dark:text-gold-400 num">{b.poolsIncluded === 9999 ? '∞' : `${b.poolsIncluded} pools`}</strong></span>
                                                        <span>Valid: <strong className="text-gold-700 dark:text-gold-400 num">{b.durationDays === 0 ? 'Never Exp' : `${b.durationDays} days`}</strong></span>
                                                    </div>
                                                </td>
                                                <td className="p-3 text-center font-bold text-gold-700 dark:text-gold-400 font-mono text-xs num">
                                                    ${Number(b.price).toFixed(2)}
                                                </td>
                                                <td className="p-3 text-center">
                                                    <button
                                                        onClick={() => handleToggleBundleActive(b.id)}
                                                        className={`px-2 py-0.5 rounded-full font-display font-bold text-[9px] uppercase tracking-[0.05em] border transition-all ${
                                                            b.isActive
                                                                ? 'bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]'
                                                                : 'bg-[#FBEEDD] border border-[#F2D6B0] text-[#B4530A]'
                                                        }`}
                                                    >
                                                        {b.isActive ? 'Active' : 'Paused'}
                                                    </button>
                                                </td>
                                                <td className="p-3 text-right">
                                                    <button
                                                        onClick={() => handleDeleteBundle(b.id)}
                                                        className="p-1.5 text-brandred-600 hover:text-brandred-500 rounded transition-colors"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {(!config.packagesList || config.packagesList.length === 0) && (
                                            <tr>
                                                <td colSpan={5} className="p-8 text-center text-faint font-body">
                                                    No customized credit bundles constructed yet.
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
                        <div className="lg:col-span-5 bg-surface p-6 border border-line rounded-2xl space-y-4">
                            <h3 className="font-display font-bold text-gold-500 flex items-center gap-1.5 border-b border-line pb-2 text-sm uppercase tracking-[0.08em]">
                                <Award size={16} className="text-gold-500" /> Referral Reward Structure
                            </h3>

                            <div>
                                <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Reward Payout Type</label>
                                <select
                                    value={referralConfig.rewardType}
                                    onChange={(e) => setReferralConfig({ ...referralConfig, rewardType: e.target.value as any })}
                                    className="w-full px-3 py-2.5 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] font-bold text-xs font-body"
                                >
                                    <option value="free_pool">Free Pool Tokens (Threshold Recruits)</option>
                                    <option value="discount">Direct Discount Credit (Incremental)</option>
                                </select>
                            </div>

                            {referralConfig.rewardType === 'free_pool' ? (
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Paying Managers Required for Free Pool</label>
                                    <input
                                        type="number"
                                        required
                                        value={referralConfig.creditsRequiredForFreePool}
                                        onChange={(e) => setReferralConfig({ ...referralConfig, creditsRequiredForFreePool: Math.max(1, parseInt(e.target.value) || 1) })}
                                        className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] text-xs font-bold"
                                    />
                                    <span className="text-[9px] text-faint leading-relaxed block mt-1 font-body">E.g., 5 successful recruits awards the manager 1 free pool hosting token.</span>
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em] mb-1.5">Discount Off Hosting Fee Per Recruit ($)</label>
                                    <input
                                        type="number"
                                        required
                                        value={referralConfig.discountPerCredit}
                                        onChange={(e) => setReferralConfig({ ...referralConfig, discountPerCredit: Math.max(0, parseFloat(e.target.value) || 0) })}
                                        className="num w-full px-3 py-2 bg-page border-[1.5px] border-line rounded-lg text-[color:var(--text)] text-xs font-bold"
                                    />
                                    <span className="text-[9px] text-faint leading-relaxed block mt-1 font-body">E.g., slash $5.00 off hosting checkouts for every paying recruit brought in.</span>
                                </div>
                            )}

                            <button
                                onClick={handleSaveReferralConfig}
                                disabled={isSaving}
                                className="w-full py-2.5 bg-brandred-600 hover:bg-brandred-500 text-white font-display font-bold uppercase tracking-[0.05em] rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-[0_6px_16px_rgba(196,52,46,0.28)]"
                            >
                                <Save size={14} /> Update Reward Policy
                            </button>
                        </div>

                        {/* Right: User Credits Editor */}
                        <div className="lg:col-span-7 bg-surface border border-line p-6 rounded-2xl space-y-4">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-line pb-3 gap-2">
                                <h3 className="font-display font-bold text-[color:var(--text)] text-sm uppercase tracking-[0.08em]">Manager Referral Ledger</h3>
                                <div className="relative w-full sm:max-w-[200px]">
                                    <Search className="absolute left-2.5 top-1.5 text-faint" size={14} />
                                    <input
                                        type="text"
                                        placeholder="Search managers..."
                                        value={userSearchQuery}
                                        onChange={(e) => setUserSearchQuery(e.target.value)}
                                        className="w-full bg-page border-[1.5px] border-line rounded-lg pl-7 pr-3 py-1 text-xs text-[color:var(--text)] outline-none placeholder:text-faint font-body"
                                    />
                                </div>
                            </div>

                            <div className="overflow-x-auto border border-line rounded-xl">
                                <table className="w-full text-left text-xs whitespace-nowrap">
                                    <thead>
                                        <tr className="bg-page text-muted font-display font-bold uppercase tracking-[0.08em] text-[12px]">
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
                                                    <tr key={u.id} className="border-b border-line hover:bg-page">
                                                        <td className="p-3">
                                                            <div className="font-bold text-[color:var(--text)] font-body">{u.name || 'Anonymous'}</div>
                                                            <div className="text-[10px] text-faint font-mono mt-0.5">{u.email}</div>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            {isEditing ? (
                                                                <input
                                                                    type="number"
                                                                    value={editReferralCredits}
                                                                    onChange={(e) => setEditReferralCredits(Math.max(0, parseInt(e.target.value) || 0))}
                                                                    className="num w-12 bg-page border-[1.5px] border-line text-center font-bold text-[color:var(--text)] rounded p-1"
                                                                />
                                                            ) : (
                                                                <span className="font-bold text-[color:var(--text)] font-mono num">{u.referralCredits || 0} paying recruits</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            {isEditing ? (
                                                                <input
                                                                    type="number"
                                                                    value={editFreePools}
                                                                    onChange={(e) => setEditFreePools(Math.max(0, parseInt(e.target.value) || 0))}
                                                                    className="num w-12 bg-page border-[1.5px] border-line text-center font-bold text-[color:var(--text)] rounded p-1"
                                                                />
                                                            ) : (
                                                                <span className="font-bold text-[#0F7B4A] font-mono num">{u.freePoolsAvailable || 0} tokens</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-right">
                                                            {isEditing ? (
                                                                <div className="flex gap-2 justify-end">
                                                                    <button
                                                                        onClick={() => handleSaveUserReferralOverride(u.id)}
                                                                        className="px-2 py-1 bg-[#0F7B4A] hover:brightness-110 text-white font-display font-bold uppercase tracking-[0.05em] rounded"
                                                                    >
                                                                        Save
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setEditingUserId('')}
                                                                        className="px-2 py-1 bg-navy-800 hover:bg-navy-700 text-white rounded font-display font-bold uppercase tracking-[0.05em]"
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
                                                                    className="px-2 py-1 bg-navy-800 hover:bg-navy-700 text-white rounded font-display font-bold uppercase tracking-[0.05em]"
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
                    <div className="flex items-center gap-3 bg-page border border-line rounded-xl px-4 py-2.5">
                        <Search size={18} className="text-faint" />
                        <input
                            type="text"
                            placeholder="Search active pools by name, type, or manager..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="bg-transparent border-none text-sm text-[color:var(--text)] outline-none flex-grow font-body placeholder:text-faint"
                        />
                    </div>

                    <div className="overflow-x-auto border border-line rounded-2xl">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-page border-b border-line text-muted font-display font-bold uppercase tracking-[0.08em] text-[12px]">
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
                                        <tr key={pool.id} className="border-b border-line hover:bg-page transition-colors">
                                            <td className="p-4">
                                                <div className="font-bold text-[color:var(--text)] font-body">{pool.name}</div>
                                                <div className="text-[10px] text-faint font-mono mt-0.5">{pool.contactEmail || pool.managerName || ''}</div>
                                            </td>
                                            <td className="p-4 text-muted font-display font-bold uppercase tracking-[0.05em] text-[10px]">{pool.type}</td>
                                            <td className="p-4 text-muted text-xs font-body">{pool.managerName || 'Anonymous'}</td>

                                            {/* BILLING STATUS */}
                                            <td className="p-4">
                                                {isEditing ? (
                                                    <select
                                                        value={poolOverrideData.status || 'free'}
                                                        onChange={(e) => setPoolOverrideData({ ...poolOverrideData, status: e.target.value as any })}
                                                        className="px-2 py-1 bg-page border-[1.5px] border-line rounded text-xs text-[color:var(--text)] font-body"
                                                    >
                                                        <option value="free">Free</option>
                                                        <option value="trial">Trial</option>
                                                        <option value="active">Active</option>
                                                        <option value="grace_period">Grace Period</option>
                                                        <option value="locked">Locked</option>
                                                    </select>
                                                ) : (
                                                    <span className={`px-2 py-0.5 rounded-full font-display font-bold text-[9px] uppercase tracking-[0.05em] border ${
                                                        pool.billing?.status === 'active'
                                                            ? 'bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]'
                                                            : 'bg-[#FBEEDD] border border-[#F2D6B0] text-[#B4530A]'
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
                                                        className="px-2 py-1 bg-page border-[1.5px] border-line rounded text-xs text-[color:var(--text)] font-body"
                                                    >
                                                        <option value="free_tier">Free Tier</option>
                                                        <option value="standard_tier">Standard Edition</option>
                                                        <option value="premium_tier">Premium Edition</option>
                                                    </select>
                                                ) : (
                                                    <span className="font-bold text-[color:var(--text)] font-body">
                                                        {pool.billing?.tier === 'premium_tier'
                                                            ? 'Premium'
                                                            : pool.billing?.tier === 'standard_tier'
                                                            ? 'Standard'
                                                            : 'Free'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* ACTIONS */}
                                            <td className="p-4 text-right">
                                                {isEditing ? (
                                                    <div className="flex gap-2 justify-end">
                                                        <button
                                                            onClick={() => handleSavePoolOverride(pool.id)}
                                                            className="px-2.5 py-1 bg-[#0F7B4A] hover:brightness-110 text-white font-display font-bold uppercase tracking-[0.05em] rounded"
                                                        >
                                                            Save
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingPoolId('')}
                                                            className="px-2.5 py-1 bg-navy-800 hover:bg-navy-700 text-white font-display font-bold uppercase tracking-[0.05em] rounded"
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
                                                                            whatIfSimulator: false,
                                                                            customBranding: true
                                                                        }
                                                                });
                                                            }}
                                                            className="px-2 py-1 bg-navy-800 hover:bg-navy-700 text-[10px] font-display font-bold uppercase tracking-[0.05em] text-white rounded transition-colors"
                                                        >
                                                            Override
                                                        </button>
                                                        {(pool.billing?.status === 'trial' || pool.billing?.status === 'grace_period' || pool.billing?.status === 'locked') && (
                                                            <button
                                                                onClick={() => handleExtendTrial(pool)}
                                                                className="px-2 py-1 bg-navy-700/20 hover:bg-navy-700/40 text-[10px] font-display font-bold uppercase tracking-[0.05em] text-navy-700 dark:text-[#9FB0CC] rounded border border-line transition-colors"
                                                            >
                                                                +14d Trial
                                                            </button>
                                                        )}
                                                        {(pool.billing?.status === 'grace_period' || pool.billing?.status === 'locked') && (
                                                            <button
                                                                onClick={() => handleResetGrace(pool)}
                                                                className="px-2 py-1 bg-[#FBEEDD] hover:brightness-105 text-[10px] font-display font-bold uppercase tracking-[0.05em] text-[#B4530A] rounded border border-[#F2D6B0] transition-colors"
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
            {(subTab === 'tiers' || subTab === 'features' || subTab === 'packages') && (
                <div className="flex justify-end pt-4 border-t border-line">
                    <button
                        onClick={handleSaveConfig}
                        disabled={isSaving}
                        className="bg-brandred-600 hover:bg-brandred-500 text-white px-8 py-3.5 rounded-xl font-display font-bold uppercase tracking-[0.05em] text-sm shadow-[0_6px_16px_rgba(196,52,46,0.28)] flex items-center gap-2 disabled:opacity-50"
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
