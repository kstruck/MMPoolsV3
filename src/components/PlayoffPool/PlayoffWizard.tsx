import React, { useState, useEffect } from 'react';
import type { User, PlayoffTeam, PayoutSettings } from '../../types';
import { dbService } from '../../services/dbService';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { ArrowLeft, ArrowRight, CheckCircle, Trophy, DollarSign, Calendar, Users, Globe } from 'lucide-react';
import { WizardStepBranding } from '../admin/WizardStepBranding';
import { WizardStepAdvanced } from '../admin/WizardStepAdvanced';

// Current 2024-25 NFL Playoff Teams
const PLAYOFF_TEAMS_MOCK: PlayoffTeam[] = [
    { id: 'KC', name: 'Kansas City Chiefs', conference: 'AFC', seed: 1, eliminated: false },
    { id: 'BUF', name: 'Buffalo Bills', conference: 'AFC', seed: 2, eliminated: false },
    { id: 'BAL', name: 'Baltimore Ravens', conference: 'AFC', seed: 3, eliminated: false },
    { id: 'HOU', name: 'Houston Texans', conference: 'AFC', seed: 4, eliminated: false },
    { id: 'CLE', name: 'Cleveland Browns', conference: 'AFC', seed: 5, eliminated: false },
    { id: 'MIA', name: 'Miami Dolphins', conference: 'AFC', seed: 6, eliminated: false },
    { id: 'PIT', name: 'Pittsburgh Steelers', conference: 'AFC', seed: 7, eliminated: false },
    { id: 'SF', name: 'San Francisco 49ers', conference: 'NFC', seed: 1, eliminated: false },
    { id: 'DAL', name: 'Dallas Cowboys', conference: 'NFC', seed: 2, eliminated: false },
    { id: 'DET', name: 'Detroit Lions', conference: 'NFC', seed: 3, eliminated: false },
    { id: 'TB', name: 'Tampa Bay Buccaneers', conference: 'NFC', seed: 4, eliminated: false },
    { id: 'PHI', name: 'Philadelphia Eagles', conference: 'NFC', seed: 5, eliminated: false },
    { id: 'LAR', name: 'Los Angeles Rams', conference: 'NFC', seed: 6, eliminated: false },
    { id: 'GB', name: 'Green Bay Packers', conference: 'NFC', seed: 7, eliminated: false },
];

interface PlayoffWizardProps {
    user: User;
    onCancel: () => void;
    onComplete: (poolId: string) => void;
    editPoolId?: string | null;
}

export const PlayoffWizard: React.FC<PlayoffWizardProps> = ({ user, onCancel, onComplete, editPoolId }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [playoffTeams, setPlayoffTeams] = useState<PlayoffTeam[]>(PLAYOFF_TEAMS_MOCK);

    useEffect(() => {
        const unsub = dbService.subscribeToPlayoffConfig((config) => {
            if (config && config.teams && config.teams.length > 0) {
                setPlayoffTeams(config.teams);
            }
        });
        return () => unsub();
    }, []);

    // Load existing pool data if editing
    useEffect(() => {
        if (!editPoolId) return;

        const loadPool = async () => {
            try {
                setLoading(true);
                const poolRef = doc(db, 'pools', editPoolId);
                const snap = await getDoc(poolRef);

                if (snap.exists()) {
                    const data = snap.data() as any; // Cast to any to handle loose mismatches

                    // Map data to formData
                    setFormData(prev => ({
                        ...prev,
                        name: data.name || prev.name,
                        slug: data.urlSlug || prev.slug,
                        season: data.season || prev.season,
                        isListedPublic: data.settings?.isListedPublic || false,
                        managerName: data.managerName || prev.managerName,
                        contactEmail: data.contactEmail || prev.contactEmail,
                        venmo: data.venmo || '',
                        googlePay: data.googlePay || '',
                        cashapp: data.cashapp || '',
                        paypal: data.paypal || '',
                        paymentInstructions: data.settings?.paymentInstructions || '',

                        maxEntriesTotal: data.settings?.maxEntriesTotal || -1,
                        maxEntriesPerUser: data.settings?.maxEntriesPerUser || 10, // Default to 10 if not found, or use standard default
                        entryFee: data.settings?.entryFee || 0,
                        lockAt: data.lockDate || prev.lockAt,

                        multipliers: {
                            wc: data.settings?.scoring?.roundMultipliers?.WILD_CARD || 1,
                            div: data.settings?.scoring?.roundMultipliers?.DIVISIONAL || 2,
                            conf: data.settings?.scoring?.roundMultipliers?.CONF_CHAMP || 4,
                            sb: data.settings?.scoring?.roundMultipliers?.SUPER_BOWL || 8,
                        },

                        payouts: data.settings?.payouts || prev.payouts,

                        branding: {
                            logoUrl: data.branding?.logo,
                            backgroundColor: data.branding?.bgColor || prev.branding.backgroundColor
                        },

                        reminders: {
                            auto24h: data.reminders?.auto24h ?? true,
                            auto1h: data.reminders?.auto1h ?? true,
                            autoLock: data.reminders?.autoLock ?? true,
                            announceWinner: data.reminders?.announceWinner ?? true,
                            recipientFilter: data.reminders?.recipientFilter || 'all'
                        },

                        accessControl: {
                            password: data.accessControl?.password || '',
                            requireEmail: data.accessControl?.requireEmail ?? false,
                            requirePhone: data.accessControl?.requirePhone ?? false
                        },

                        // Remaining boolean toggles
                        collectPhone: false,
                        collectAddress: false,
                        collectReferral: false,
                        collectNotes: false,
                        emailConfirmation: 'Email Confirmation',
                        emailNumbersGenerated: true,
                        notifyAdminFull: true
                    }));
                }
            } catch (err) {
                console.error("Failed to load pool for editing", err);
                setError("Failed to load pool data.");
            } finally {
                setLoading(false);
            }
        };

        loadPool();
    }, [editPoolId]);

    const [formData, setFormData] = useState<{
        // Step 1: Basics
        name: string;
        slug: string;
        season: string;
        isListedPublic: boolean;
        managerName: string;
        contactEmail: string;
        venmo: string;
        googlePay: string;
        cashapp: string;
        paypal: string;
        paymentInstructions: string;

        // Step 2: Rules
        maxEntriesTotal: number;
        maxEntriesPerUser: number;
        entryFee: number;
        lockAt: number;

        // Step 3: Scoring
        multipliers: {
            wc: number;
            div: number;
            conf: number;
            sb: number;
        };

        // Step 4: Payouts
        payouts: PayoutSettings;

        // Step 5: Branding
        branding: {
            logoUrl?: string;
            backgroundColor?: string;
        };

        // Step 6: Reminders
        reminders: {
            auto24h: boolean;
            auto1h: boolean;
            autoLock: boolean;
            announceWinner: boolean;
            recipientFilter: 'all' | 'unpaid' | 'noentry';
        };

        // Step 7: Advanced
        accessControl: {
            password: string;
            requireEmail: boolean;
            requirePhone: boolean;
        };
        collectPhone: boolean;
        collectAddress: boolean;
        collectReferral: boolean;
        collectNotes: boolean;
        emailConfirmation: string;
        emailNumbersGenerated: boolean;
        notifyAdminFull: boolean;
    }>({
        // Basics
        name: `${user.name}'s Playoff Pool`,
        slug: '',
        season: '2024',
        isListedPublic: false,
        managerName: user.name || '',
        contactEmail: user.email || '',
        venmo: '',
        googlePay: '',
        cashapp: '',
        paypal: '',
        paymentInstructions: '',

        // Rules
        maxEntriesTotal: -1,
        maxEntriesPerUser: 1,
        entryFee: 20,
        lockAt: new Date('2025-01-11T16:30:00-05:00').getTime(), // Wild Card Saturday

        // Scoring
        multipliers: {
            wc: 1,
            div: 2,
            conf: 4,
            sb: 8
        },

        // Payouts
        payouts: {
            places: [
                { rank: 1, percentage: 60 },
                { rank: 2, percentage: 30 },
                { rank: 3, percentage: 10 }
            ],
            bonuses: []
        },

        // Branding
        branding: {
            logoUrl: undefined,
            backgroundColor: '#0f172a'
        },

        // Reminders
        reminders: {
            auto24h: true,
            auto1h: true,
            autoLock: true,
            announceWinner: true,
            recipientFilter: 'all'
        },

        // Advanced
        accessControl: {
            password: '',
            requireEmail: false,
            requirePhone: false
        },
        collectPhone: false,
        collectAddress: false,
        collectReferral: false,
        collectNotes: false,
        emailConfirmation: 'Email Confirmation',
        emailNumbersGenerated: true,
        notifyAdminFull: true
    });

    const TOTAL_STEPS = 8;

    const handleNext = () => {
        // Validation
        if (step === 1) {
            if (!formData.name.trim()) {
                setError('Pool name is required');
                return;
            }
            if (!formData.contactEmail.trim()) {
                setError('Contact email is required');
                return;
            }
        }

        if (step === 4) {
            // Validate payouts equal 100%
            const total = [...formData.payouts.places, ...formData.payouts.bonuses].reduce((sum, p) => sum + p.percentage, 0);
            if (Math.abs(total - 100) > 0.01) {
                setError(`Payout percentages must equal 100% (currently ${total.toFixed(1)}%)`);
                return;
            }
        }

        setError(null);
        setStep(s => Math.min(TOTAL_STEPS, s + 1));
    };

    const handleBack = () => setStep(s => Math.max(1, s - 1));

    const update = (updates: Partial<typeof formData>) => {
        setFormData(prev => ({ ...prev, ...updates }));
    };

    // Payout Helpers
    const addPlace = () => {
        const nextRank = formData.payouts.places.length + 1;
        update({
            payouts: {
                ...formData.payouts,
                places: [...formData.payouts.places, { rank: nextRank, percentage: 0 }]
            }
        });
    };

    const removePlace = (index: number) => {
        const newPlaces = formData.payouts.places
            .filter((_, i) => i !== index)
            .map((p, i) => ({ ...p, rank: i + 1 }));
        update({ payouts: { ...formData.payouts, places: newPlaces } });
    };

    const updatePlace = (index: number, val: number) => {
        const newPlaces = [...formData.payouts.places];
        newPlaces[index].percentage = val;
        update({ payouts: { ...formData.payouts, places: newPlaces } });
    };

    const addBonus = () => {
        update({
            payouts: {
                ...formData.payouts,
                bonuses: [...formData.payouts.bonuses, { name: 'Bonus', percentage: 0 }]
            }
        });
    };

    const removeBonus = (index: number) => {
        const newBonuses = formData.payouts.bonuses.filter((_, i) => i !== index);
        update({ payouts: { ...formData.payouts, bonuses: newBonuses } });
    };

    const updateBonus = (index: number, field: 'name' | 'percentage', val: string | number) => {
        const newBonuses = [...formData.payouts.bonuses];
        if (field === 'name') {
            newBonuses[index].name = val as string;
        } else {
            newBonuses[index].percentage = val as number;
        }
        update({ payouts: { ...formData.payouts, bonuses: newBonuses } });
    };

    const handleCreate = async () => {
        setLoading(true);
        setError(null);
        try {
            const newPool: any = {
                type: 'NFL_PLAYOFFS',
                league: 'NFL',
                name: formData.name,
                ownerId: user.id,
                season: formData.season,
                createdAt: Date.now(),
                urlSlug: formData.slug || undefined,
                managerName: formData.managerName,
                contactEmail: formData.contactEmail,
                venmo: formData.venmo,
                googlePay: formData.googlePay,
                cashapp: formData.cashapp,
                paypal: formData.paypal,
                branding: {
                    logo: formData.branding.logoUrl,
                    bgColor: formData.branding.backgroundColor
                },
                reminders: formData.reminders,
                accessControl: formData.accessControl,

                settings: {
                    entryFee: formData.entryFee,
                    paymentInstructions: formData.paymentInstructions,
                    isListedPublic: formData.isListedPublic,
                    payouts: formData.payouts,
                    scoring: {
                        roundMultipliers: {
                            WILD_CARD: formData.multipliers.wc,
                            DIVISIONAL: formData.multipliers.div,
                            CONF_CHAMP: formData.multipliers.conf,
                            SUPER_BOWL: formData.multipliers.sb
                        }
                    }
                },

                teams: playoffTeams,
                entries: {},
                results: {},
                lockDate: formData.lockAt
            };

            if (editPoolId) {
                // Update existing
                const poolRef = doc(db, 'pools', editPoolId);

                // Create clean update object
                const updateData = { ...newPool, updatedAt: Date.now() };

                // Remove fields check should not be updated or are undefined
                delete updateData.entries;
                delete updateData.results;
                delete updateData.createdAt;

                // Remove checks for explicit undefined keys to satisfy Firestore
                Object.keys(updateData).forEach(key => {
                    if (updateData[key] === undefined) delete updateData[key];
                });

                await updateDoc(poolRef, updateData);
                onComplete(editPoolId);
            } else {
                // Create New
                const poolId = await dbService.createPool(newPool);
                onComplete(poolId);
            }
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to create pool.');
        } finally {
            setLoading(false);
        }
    };

    // Auto-generate slug
    React.useEffect(() => {
        if (!formData.slug && formData.name) {
            const autoSlug = formData.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
            update({ slug: autoSlug });
        }
    }, [formData.name]);

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            <div className="max-w-4xl mx-auto p-6 py-12">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={onCancel}
                                className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            >
                                <ArrowLeft size={20} />
                            </button>
                            <div>
                                <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                                    <Trophy className="text-emerald-400" size={28} />
                                    {editPoolId ? 'Edit Pool Settings' : 'Create Playoff Pool'}
                                </h1>
                                <p className="text-sm text-slate-400">NFL Playoff Rankings</p>
                            </div>
                        </div>
                    </div>

                    {/* Progress Indicator */}
                    <div className="mb-6">
                        <div className="flex justify-between text-xs font-bold uppercase text-slate-500 mb-2">
                            {[
                                '1. Basics',
                                '2. Rules',
                                '3. Scoring',
                                '4. Payouts',
                                '5. Branding',
                                '6. Reminders',
                                '7. Advanced',
                                '8. Review'
                            ].map((label, i) => (
                                <button
                                    key={i}
                                    onClick={() => setStep(i + 1)}
                                    className={`uppercase font-bold transition-colors hover:text-white ${step >= i + 1 ? 'text-emerald-400' : ''
                                        }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-emerald-600 transition-all duration-500"
                                style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="bg-rose-500/20 border border-rose-500 rounded-lg p-4 text-rose-300 text-sm">
                            {error}
                        </div>
                    )}
                </div>

                {/* Step Content */}
                {step === 1 && renderStep1()}
                {step === 2 && renderStep2()}
                {step === 3 && renderStep3()}
                {step === 4 && renderStep4()}
                {step === 5 && renderStep5()}
                {step === 6 && renderStep6()}
                {step === 7 && renderStep7()}
                {step === 8 && renderStep8()}

                {/* Navigation */}
                <div className="flex justify-between pt-6 border-t border-slate-800 mt-8">
                    <button
                        onClick={handleBack}
                        disabled={step === 1}
                        className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-all"
                    >
                        <ArrowLeft size={18} /> Previous
                    </button>
                    {step < TOTAL_STEPS ? (
                        <button
                            onClick={handleNext}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                        >
                            Next Step <ArrowRight size={18} />
                        </button>
                    ) : (
                        <button
                            onClick={handleCreate}
                            disabled={loading}
                            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                        >
                            {loading ? 'Creating...' : (
                                <>
                                    <CheckCircle size={18} /> {editPoolId ? 'Save Changes' : 'Publish Pool'}
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

    // ========== STEP RENDERERS ==========

    function renderStep1() {
        return (
            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-white mb-2">Pool Basics</h3>
                    <p className="text-slate-400 text-sm mb-6">Set up your playoff ranking pool with essential details.</p>

                    {/* Public Visibility Toggle */}
                    <div className="mb-6 bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${formData.isListedPublic ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                                <Globe size={24} />
                            </div>
                            <div>
                                <h4 className={`font-bold ${formData.isListedPublic ? 'text-white' : 'text-slate-400'}`}>
                                    Public Visibility
                                </h4>
                                <p className="text-xs text-slate-500">
                                    {formData.isListedPublic
                                        ? "Your pool is listed in the 'Browse Pools' directory."
                                        : "Only people with the link can access this pool."}
                                </p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.isListedPublic}
                                onChange={(e) => update({ isListedPublic: e.target.checked })}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600" />
                        </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Name</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => update({ name: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                                placeholder="My Playoff Pool"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">URL Slug</label>
                            <div className="relative">
                                <span className="absolute left-3 top-3 text-slate-600 font-mono text-sm">/</span>
                                <input
                                    type="text"
                                    value={formData.slug}
                                    onChange={(e) => {
                                        const safe = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                                        update({ slug: safe });
                                    }}
                                    className="w-full bg-slate-950 border border-slate-700 rounded pl-6 pr-4 py-3 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                                    placeholder="my-playoff-pool"
                                />
                            </div>
                            <p className="text-slate-500 text-[10px] mt-1">Lowercase letters, numbers, and dashes only.</p>
                        </div>



                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Manager Name</label>
                            <input
                                type="text"
                                value={formData.managerName}
                                onChange={(e) => update({ managerName: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                                placeholder="Your Name"
                            />
                        </div>

                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Contact Email</label>
                            <input
                                type="email"
                                value={formData.contactEmail}
                                onChange={(e) => update({ contactEmail: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                                placeholder="email@example.com"
                            />
                        </div>

                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Venmo (@username)</label>
                            <input
                                type="text"
                                value={formData.venmo}
                                onChange={(e) => update({ venmo: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                                placeholder="@YourVenmo"
                            />
                        </div>

                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Google Pay / Other</label>
                            <input
                                type="text"
                                value={formData.googlePay}
                                onChange={(e) => update({ googlePay: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                                placeholder="Email or Phone"
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Payment Instructions</label>
                            <textarea
                                value={formData.paymentInstructions}
                                onChange={(e) => update({ paymentInstructions: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-emerald-500 outline-none h-24 resize-none"
                                placeholder="How should players pay you?"
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    function renderStep2() {
        return (
            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-white mb-2">Pool Rules</h3>
                    <p className="text-slate-400 text-sm mb-6">Configure entry fees, limits, and lock time.</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Entry Fee</label>
                            <div className="flex items-center gap-3">
                                <div className="bg-emerald-500/20 p-3 rounded-lg text-emerald-400">
                                    <DollarSign size={24} />
                                </div>
                                <input
                                    type="number"
                                    value={formData.entryFee}
                                    onChange={(e) => update({ entryFee: parseInt(e.target.value) || 0 })}
                                    className="bg-transparent border-b border-slate-600 text-2xl font-bold text-white w-full outline-none focus:border-emerald-500 py-1"
                                    min="0"
                                />
                            </div>
                        </div>

                        <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Max Entries Per User</label>
                            <div className="flex items-center gap-3">
                                <div className="bg-indigo-500/20 p-3 rounded-lg text-indigo-400">
                                    <Users size={24} />
                                </div>
                                <input
                                    type="number"
                                    value={formData.maxEntriesPerUser}
                                    onChange={(e) => update({ maxEntriesPerUser: parseInt(e.target.value) || 1 })}
                                    className="bg-transparent border-b border-slate-600 text-2xl font-bold text-white w-full outline-none focus:border-indigo-500 py-1"
                                    min="1"
                                />
                            </div>
                            <p className="text-xs text-slate-500 mt-2">How many rankings can one person submit?</p>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Total Entry Limit</label>
                            <select
                                value={formData.maxEntriesTotal}
                                onChange={(e) => update({ maxEntriesTotal: parseInt(e.target.value) })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-emerald-500"
                            >
                                <option value="-1">Unlimited</option>
                                <option value="10">10 Entries</option>
                                <option value="25">25 Entries</option>
                                <option value="50">50 Entries</option>
                                <option value="100">100 Entries</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-3">Lock Date/Time</label>

                            {/* Quick Select Buttons */}
                            <div className="flex flex-wrap gap-2 mb-4">
                                {[
                                    { label: 'Wild Card Kickoff', time: '2026-01-10T14:30:00-07:00' },
                                    { label: 'Divisional Round', time: '2026-01-17T14:30:00-07:00' }
                                ].map((preset) => (
                                    <button
                                        key={preset.label}
                                        onClick={() => update({ lockAt: new Date(preset.time).getTime() })}
                                        className="text-xs px-3 py-1.5 rounded-full bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 border border-slate-700 transition-colors"
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>

                            <div className="relative">
                                <Calendar className="absolute left-3 top-3 text-emerald-500" size={18} />
                                <input
                                    type="datetime-local"
                                    value={(() => {
                                        const d = new Date(formData.lockAt);
                                        // Adjust to local ISO string including offset
                                        const offset = d.getTimezoneOffset() * 60000;
                                        return new Date(d.getTime() - offset).toISOString().slice(0, 16);
                                    })()}
                                    onChange={(e) => {
                                        const localDate = new Date(e.target.value);
                                        update({ lockAt: localDate.getTime() });
                                    }}
                                    className="w-full bg-slate-950 border border-slate-700 rounded pl-10 pr-4 py-3 text-white outline-none focus:border-emerald-500 font-mono"
                                />
                            </div>
                            <p className="text-xs text-slate-500 mt-2">
                                Locked at: {new Date(formData.lockAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    function renderStep3() {
        return (
            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <CheckCircle className="text-indigo-400" /> Scoring System
                    </h3>
                    <p className="text-slate-400 mb-6 text-sm">
                        Participants rank all 14 playoff teams from 14 down to 1. If a team wins in a round, the participant gets points:<br />
                        <span className="font-mono text-emerald-400">Assigned Rank × Round Multiplier</span>
                    </p>

                    <h4 className="font-bold mb-4 text-white border-b border-slate-800 pb-2">Round Multipliers</h4>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[
                            { k: 'wc', l: 'Wild Card' },
                            { k: 'div', l: 'Divisional' },
                            { k: 'conf', l: 'Conference' },
                            { k: 'sb', l: 'Super Bowl' }
                        ].map(r => (
                            <div key={r.k} className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                                <div className="text-sm text-slate-500 mb-1 uppercase font-bold">{r.l}</div>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-400 text-sm">×</span>
                                    <input
                                        type="number"
                                        value={(formData.multipliers as any)[r.k]}
                                        onChange={(e) => update({ multipliers: { ...formData.multipliers, [r.k]: Number(e.target.value) } })}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 font-bold text-center focus:border-indigo-500 outline-none text-white"
                                        min="1"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    function renderStep4() {
        const total = [...formData.payouts.places, ...formData.payouts.bonuses].reduce((sum, p) => sum + p.percentage, 0);
        const isValid = Math.abs(total - 100) < 0.01;

        return (
            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-white mb-2">Payout Structure</h3>
                    <p className="text-slate-400 text-sm mb-6">Define how winnings will be distributed.</p>

                    {/* Total Indicator */}
                    <div className={`mb-6 p-4 rounded-lg border-2 ${isValid ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
                        <div className="flex justify-between items-center">
                            <span className="font-bold text-white">Total Payout</span>
                            <span className={`text-2xl font-black ${isValid ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {total.toFixed(1)}%
                            </span>
                        </div>
                        {!isValid && (
                            <p className="text-xs text-rose-300 mt-2">
                                Must equal exactly 100% to proceed
                            </p>
                        )}
                    </div>

                    {/* Place Payouts */}
                    <div className="mb-6">
                        <div className="flex justify-between items-center mb-3">
                            <h4 className="font-bold text-white">Place Payouts</h4>
                            <button
                                onClick={addPlace}
                                className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded font-bold"
                                type="button"
                            >
                                + Add Place
                            </button>
                        </div>
                        <div className="space-y-2">
                            {formData.payouts.places.map((place, i) => (
                                <div key={i} className="flex items-center gap-3 bg-slate-950 p-3 rounded-lg border border-slate-700">
                                    <span className="text-sm font-bold text-slate-400 w-16">#{place.rank}</span>
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="1"
                                        value={place.percentage}
                                        onChange={(e) => updatePlace(i, parseFloat(e.target.value))}
                                        className="flex-1"
                                    />
                                    <input
                                        type="number"
                                        value={place.percentage}
                                        onChange={(e) => updatePlace(i, parseFloat(e.target.value) || 0)}
                                        className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm text-center"
                                        min="0"
                                        max="100"
                                        step="0.1"
                                    />
                                    <span className="text-sm text-slate-400">%</span>
                                    {formData.payouts.places.length > 1 && (
                                        <button
                                            onClick={() => removePlace(i)}
                                            className="text-rose-400 hover:text-rose-300 text-sm"
                                            type="button"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Bonus Payouts */}
                    <div>
                        <div className="flex justify-between items-center mb-3">
                            <h4 className="font-bold text-white">Bonus Payouts</h4>
                            <button
                                onClick={addBonus}
                                className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded font-bold"
                                type="button"
                            >
                                + Add Bonus
                            </button>
                        </div>
                        {formData.payouts.bonuses.length === 0 ? (
                            <p className="text-sm text-slate-500 text-center py-4">No bonus payouts configured</p>
                        ) : (
                            <div className="space-y-2">
                                {formData.payouts.bonuses.map((bonus, i) => (
                                    <div key={i} className="flex items-center gap-3 bg-slate-950 p-3 rounded-lg border border-slate-700">
                                        <input
                                            type="text"
                                            value={bonus.name}
                                            onChange={(e) => updateBonus(i, 'name', e.target.value)}
                                            className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm"
                                            placeholder="Bonus Name"
                                        />
                                        <input
                                            type="range"
                                            min="0"
                                            max="50"
                                            step="1"
                                            value={bonus.percentage}
                                            onChange={(e) => updateBonus(i, 'percentage', parseFloat(e.target.value))}
                                            className="flex-1"
                                        />
                                        <input
                                            type="number"
                                            value={bonus.percentage}
                                            onChange={(e) => updateBonus(i, 'percentage', parseFloat(e.target.value) || 0)}
                                            className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm text-center"
                                            min="0"
                                            max="100"
                                            step="0.1"
                                        />
                                        <span className="text-sm text-slate-400">%</span>
                                        <button
                                            onClick={() => removeBonus(i)}
                                            className="text-rose-400 hover:text-rose-300 text-sm"
                                            type="button"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    function renderStep5() {
        return (
            <WizardStepBranding
                branding={formData.branding}
                onUpdate={(branding) => update({ branding: { ...formData.branding, ...branding } })}
            />
        );
    }

    function renderStep6() {
        return (
            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <Calendar size={20} className="text-emerald-400" />
                        Smart Reminders
                    </h3>
                    <p className="text-slate-400 text-sm mb-6">Automatically notify players at key moments.</p>

                    <div className="space-y-4">
                        <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-emerald-500/50 transition-colors">
                            <div>
                                <span className="font-bold text-slate-200 block">24-Hour Reminder</span>
                                <span className="text-xs text-slate-500">Email all players 24h before lock</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={formData.reminders.auto24h}
                                onChange={(e) => update({ reminders: { ...formData.reminders, auto24h: e.target.checked } })}
                                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-emerald-600 focus:ring-emerald-500"
                            />
                        </label>

                        <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-emerald-500/50 transition-colors">
                            <div>
                                <span className="font-bold text-slate-200 block">1-Hour Reminder</span>
                                <span className="text-xs text-slate-500">Final reminder 1h before lock</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={formData.reminders.auto1h}
                                onChange={(e) => update({ reminders: { ...formData.reminders, auto1h: e.target.checked } })}
                                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-emerald-600 focus:ring-emerald-500"
                            />
                        </label>

                        <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-emerald-500/50 transition-colors">
                            <div>
                                <span className="font-bold text-slate-200 block">Auto-Lock Pool</span>
                                <span className="text-xs text-slate-500">Automatically lock at Wild Card start</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={formData.reminders.autoLock}
                                onChange={(e) => update({ reminders: { ...formData.reminders, autoLock: e.target.checked } })}
                                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-emerald-600 focus:ring-emerald-500"
                            />
                        </label>

                        <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-emerald-500/50 transition-colors">
                            <div>
                                <span className="font-bold text-slate-200 block">Winner Announcements</span>
                                <span className="text-xs text-slate-500">Auto-email when winners are finalized</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={formData.reminders.announceWinner}
                                onChange={(e) => update({ reminders: { ...formData.reminders, announceWinner: e.target.checked } })}
                                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-emerald-600 focus:ring-emerald-500"
                            />
                        </label>
                    </div>
                </div>
            </div>
        );
    }

    function renderStep7() {
        return (
            <WizardStepAdvanced
                settings={{
                    collectPhone: formData.collectPhone,
                    collectAddress: formData.collectAddress,
                    collectReferral: formData.collectReferral,
                    collectNotes: formData.collectNotes,
                    emailConfirmation: formData.emailConfirmation,
                    emailNumbersGenerated: formData.emailNumbersGenerated,
                    notifyAdminFull: formData.notifyAdminFull,
                    gridPassword: formData.accessControl.password,
                    isPublic: formData.isListedPublic
                }}
                poolUrl={`${window.location.origin}/#pool/${formData.slug || formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                poolSlug={formData.slug}
                onUpdate={(settings) => {
                    const newData: any = {};
                    if (settings.collectPhone !== undefined) newData.collectPhone = settings.collectPhone;
                    if (settings.collectAddress !== undefined) newData.collectAddress = settings.collectAddress;
                    if (settings.collectReferral !== undefined) newData.collectReferral = settings.collectReferral;
                    if (settings.collectNotes !== undefined) newData.collectNotes = settings.collectNotes;
                    if (settings.emailConfirmation !== undefined) newData.emailConfirmation = settings.emailConfirmation;
                    if (settings.emailNumbersGenerated !== undefined) newData.emailNumbersGenerated = settings.emailNumbersGenerated;
                    if (settings.notifyAdminFull !== undefined) newData.notifyAdminFull = settings.notifyAdminFull;
                    if (settings.isPublic !== undefined) newData.isListedPublic = settings.isPublic;
                    if (settings.gridPassword !== undefined) {
                        newData.accessControl = { ...formData.accessControl, password: settings.gridPassword };
                    }
                    update(newData);
                }}
            />
        );
    }

    function renderStep8() {
        return (
            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-white mb-2">Review & Launch</h3>
                    <p className="text-slate-400 text-sm mb-6">Double-check everything before publishing your pool.</p>

                    <div className="space-y-4">
                        <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                            <h4 className="font-bold text-white text-sm mb-2">Pool Details</h4>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="text-slate-400">Name:</div>
                                <div className="text-white font-mono">{formData.name}</div>
                                <div className="text-slate-400">Slug:</div>
                                <div className="text-white font-mono">/{formData.slug}</div>
                                <div className="text-slate-400">Season:</div>
                                <div className="text-white">{formData.season}-{parseInt(formData.season) + 1} NFL Playoffs</div>
                                <div className="text-slate-400">Manager:</div>
                                <div className="text-white">{formData.managerName}</div>
                                <div className="text-slate-400">Email:</div>
                                <div className="text-white">{formData.contactEmail}</div>
                            </div>
                        </div>

                        <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                            <h4 className="font-bold text-white text-sm mb-2">Rules</h4>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="text-slate-400">Entry Fee:</div>
                                <div className="text-emerald-400 font-bold">${formData.entryFee}</div>
                                <div className="text-slate-400">Max Per User:</div>
                                <div className="text-white">{formData.maxEntriesPerUser} entries</div>
                                <div className="text-slate-400">Total Limit:</div>
                                <div className="text-white">{formData.maxEntriesTotal === -1 ? 'Unlimited' : formData.maxEntriesTotal}</div>
                            </div>
                        </div>

                        <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                            <h4 className="font-bold text-white text-sm mb-2">Scoring Multipliers</h4>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-400">WC: ×{formData.multipliers.wc}</span>
                                <span className="text-slate-400">Div: ×{formData.multipliers.div}</span>
                                <span className="text-slate-400">Conf: ×{formData.multipliers.conf}</span>
                                <span className="text-slate-400">SB: ×{formData.multipliers.sb}</span>
                            </div>
                        </div>

                        <div className="bg-slate-950 p-4 rounded-lg border border-slate-700">
                            <h4 className="font-bold text-white text-sm mb-2">Payouts</h4>
                            <div className="space-y-1 text-sm">
                                {formData.payouts.places.map(p => (
                                    <div key={p.rank} className="flex justify-between">
                                        <span className="text-slate-400">#{p.rank}</span>
                                        <span className="text-emerald-400 font-mono">{p.percentage}%</span>
                                    </div>
                                ))}
                                {formData.payouts.bonuses.map((b, i) => (
                                    <div key={i} className="flex justify-between">
                                        <span className="text-amber-400">{b.name}</span>
                                        <span className="text-amber-400 font-mono">{b.percentage}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
};
