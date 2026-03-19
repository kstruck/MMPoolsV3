import { logger } from '../../utils/logger';
import React, { useState } from 'react';
import type { User } from '../../types';
import { ArrowLeft, ArrowRight, CheckCircle, Trophy, DollarSign, Calendar, Users, Globe, Share2, Copy, ExternalLink, AlertTriangle, Mail, Sparkles } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { WizardStepBranding } from '../admin/WizardStepBranding';
import { WizardStepAdvanced } from '../admin/WizardStepAdvanced';

interface BracketWizardProps {
    user: User;
    onCancel: () => void;
    onSuccess: (poolId: string) => void;
}

// ---- Round configuration per tournament type ----
const ROUND_CONFIG: Record<string, { labels: string[]; classic: number[]; espn: number[]; fibonacci: number[] }> = {
    ncaa: {
        labels: ['R64', 'R32', 'Sweet 16', 'Elite 8', 'Final 4', 'Champ'],
        classic: [1, 2, 4, 8, 16, 32],
        espn: [10, 20, 40, 80, 160, 320],
        fibonacci: [1, 2, 3, 5, 8, 13],
    },
    big12: {
        labels: ['Round 1', 'Quarterfinals', 'Semifinals', 'Final', 'Champ'],
        classic: [1, 2, 4, 8, 16],
        espn: [10, 20, 40, 80, 160],
        fibonacci: [1, 2, 3, 5, 8],
    },
    bigeast: {
        labels: ['First Round', 'Quarterfinals', 'Semifinals', 'Champ'],
        classic: [1, 2, 4, 8],
        espn: [10, 20, 40, 80],
        fibonacci: [1, 2, 3, 5],
    },
};

const getRoundConfig = (type: string) => ROUND_CONFIG[type] || ROUND_CONFIG.ncaa;

export const BracketWizard: React.FC<BracketWizardProps> = ({ user, onCancel, onSuccess }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [shareMessage, setShareMessage] = useState('');

    const [formData, setFormData] = useState<{
        // Step 1: Basics
        name: string;
        slug: string;
        seasonYear: number;
        gender: 'mens' | 'womens';
        tournamentType: 'ncaa' | 'bigeast' | 'big12';
        isListedPublic: boolean;
        managerName: string;
        contactEmail: string;
        venmo: string;
        zelle: string;
        cashapp: string;
        paypal: string;
        paymentInstructions: string;

        // Step 2: Rules
        maxEntriesTotal: number; // -1 unlimited
        maxEntriesPerUser: number;
        entryFee: number;
        scoringSystem: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
        customScoring: number[];
        tieBreaker: 'CLOSEST_ABSOLUTE' | 'CLOSEST_UNDER';
        upsetBonus?: {
            enabled: boolean;
            multiplier: number;
        };
        lockAt: number; // Tournament start timestamp

        // Step 3: Payouts
        payouts: {
            places: { rank: number; percentage: number }[];
            bonuses: { name: string; percentage: number }[];
        };

        // Step 4: Branding
        branding: {
            logoUrl?: string;
            backgroundColor?: string;
        };

        // Step 5: Reminders
        reminders: {
            auto24h: boolean;
            auto1h: boolean;
            autoLock: boolean;
            announceWinner: boolean;
            recipientFilter: 'all' | 'unpaid' | 'noentry';
            smsEnabled?: boolean;
        };

        // Step 6: Advanced
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

        // Charity
        charity: {
            enabled: boolean;
            name: string;
            percentage: number;
            description: string;
            url: string;
        };
    }>({
        // Basics
        name: `${user.name}'s March Madness Pool`,
        slug: '',
        seasonYear: 2026,
        gender: 'mens',
        tournamentType: 'ncaa',
        isListedPublic: false,
        managerName: user.name || '',
        contactEmail: user.email || '',
        venmo: '',
        zelle: '',
        cashapp: '',
        paypal: '',
        paymentInstructions: '',

        // Rules
        maxEntriesTotal: -1,
        maxEntriesPerUser: 3,
        entryFee: 20,
        scoringSystem: 'CLASSIC',
        customScoring: [1, 2, 4, 8, 16, 32], // re-initialized when tournamentType changes
        tieBreaker: 'CLOSEST_ABSOLUTE',
        upsetBonus: {
            enabled: false,
            multiplier: 5
        },
        lockAt: new Date('2026-03-17T12:00:00').getTime(), // March Madness 2026

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
            recipientFilter: 'all',
            smsEnabled: false
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
        notifyAdminFull: true,

        // Charity
        charity: {
            enabled: false,
            name: '',
            percentage: 10,
            description: '',
            url: ''
        }
    });

    const [touched, setTouched] = useState<Record<string, boolean>>({});

    const handleBlur = (field: string) => {
        setTouched(prev => ({ ...prev, [field]: true }));
    };

    const TOTAL_STEPS = 8;

    const handleNext = () => {
        // Mark all current step fields as touched
        if (step === 1) {
            setTouched(prev => ({ ...prev, name: true, contactEmail: true }));
            if (!formData.name.trim()) {
                setError('Pool name is required');
                return;
            }
            if (!formData.contactEmail.trim()) {
                setError('Contact email is required');
                return;
            }
        }

        if (step === 3) {
            // Validate payouts equal 100%
            const charityPct = formData.charity.enabled ? formData.charity.percentage : 0;
            const total = [...formData.payouts.places, ...formData.payouts.bonuses].reduce((sum, p) => sum + p.percentage, 0) + charityPct;
            if (Math.abs(total - 100) > 0.01) {
                setError(`Payout percentages must equal 100% (currently ${total.toFixed(1)}%)`);
                return;
            }
        }

        setError(null);
        setStep(s => Math.min(TOTAL_STEPS, s + 1));
    };

    const handleBack = () => setStep(s => Math.max(1, s - 1));

    const update = React.useCallback((updates: Partial<typeof formData>) => {
        setFormData(prev => ({ ...prev, ...updates }));
    }, []);

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

    const handlePublish = async () => {
        setLoading(true);
        setError(null);

        try {
            const payload = {
                name: formData.name,
                slug: formData.slug || formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                seasonYear: formData.seasonYear,
                gender: formData.gender,
                tournamentType: formData.tournamentType,
                isListedPublic: formData.isListedPublic,
                managerName: formData.managerName,
                contactEmail: formData.contactEmail,
                venmo: formData.venmo,
                zelle: formData.zelle,
                cashapp: formData.cashapp,
                paypal: formData.paypal,
                branding: formData.branding,
                reminders: formData.reminders,
                accessControl: {
                    ...formData.accessControl,
                    requireEmail: formData.accessControl.requireEmail,
                    requirePhone: formData.accessControl.requirePhone
                },
                settings: {
                    maxEntriesTotal: formData.maxEntriesTotal,
                    maxEntriesPerUser: formData.maxEntriesPerUser,
                    entryFee: formData.entryFee,
                    paymentInstructions: formData.paymentInstructions,
                    scoringSystem: formData.scoringSystem,
                    customScoring: formData.scoringSystem === 'CUSTOM'
                        ? formData.customScoring.slice(0, getRoundConfig(formData.tournamentType).labels.length)
                        : undefined,
                    tieBreakers: {
                        closestAbsolute: formData.tieBreaker === 'CLOSEST_ABSOLUTE',
                        closestUnder: formData.tieBreaker === 'CLOSEST_UNDER'
                    },
                    payouts: formData.payouts
                },
                lockAt: formData.lockAt,
                charity: formData.charity
            };

            const createBracketPool = httpsCallable(functions, 'createBracketPool');
            const result = await createBracketPool(payload);
            const data = result.data as { poolId?: string; message?: string };

            if (data.poolId) {
                onSuccess(data.poolId);
            } else {
                setError(data.message || 'Failed to create pool');
            }
        } catch (err: unknown) {
            logger.error('Publish error:', err);
            const msg = err instanceof Error ? err.message : 'An error occurred';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    // Auto-generate slug from name
    React.useEffect(() => {
        if (!formData.slug && formData.name) {
            const autoSlug = formData.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
            update({ slug: autoSlug });
        }
    }, [formData.name, formData.slug, update]);

    // Re-initialize customScoring when tournament type changes
    React.useEffect(() => {
        const cfg = getRoundConfig(formData.tournamentType);
        const roundCount = cfg.labels.length;
        // Only resize if the current array doesn't match
        if (formData.customScoring.length !== roundCount) {
            update({ customScoring: cfg.classic.slice() });
        }
    }, [formData.tournamentType]); // eslint-disable-line react-hooks/exhaustive-deps

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
                                    <Trophy className="text-amber-400" size={28} />
                                    Create Bracket Pool
                                </h1>
                                <p className="text-sm text-slate-400">March Madness Tournament</p>
                            </div>
                        </div>
                    </div>

                    {/* Progress Indicator */}
                    <div className="mb-6">
                        <div className="flex justify-between text-xs font-bold uppercase text-slate-500 mb-2">
                            {[
                                '1. Basics',
                                '2. Rules',
                                '3. Payouts',
                                '4. Branding',
                                '5. Reminders',
                                '6. Advanced',
                                '7. Share',
                                '8. Review'
                            ].map((label, i) => (
                                <button
                                    key={i}
                                    onClick={() => setStep(i + 1)}
                                    className={`uppercase font-bold transition-colors hover:text-white ${step >= i + 1 ? 'text-indigo-400' : ''
                                        }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-indigo-600 transition-all duration-500"
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
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-indigo-500/20"
                        >
                            Next Step <ArrowRight size={18} />
                        </button>
                    ) : (
                        <button
                            onClick={handlePublish}
                            disabled={loading}
                            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                        >
                            {loading ? 'Creating...' : (
                                <>
                                    <CheckCircle size={18} /> Publish Pool
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
                    <p className="text-slate-400 text-sm mb-6">Let's set up your bracket pool with the essential details.</p>

                    {/* Public Visibility Toggle */}
                    <div className="mb-6 bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${formData.isListedPublic ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
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
                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                        </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Name <span className="text-rose-500">*</span></label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => update({ name: e.target.value })}
                                onBlur={() => handleBlur('name')}
                                className={`w-full bg-slate-950 border ${touched.name && !formData.name.trim() ? 'border-rose-500 bg-rose-500/5 focus:ring-rose-500' : 'border-slate-700 focus:ring-indigo-500'} rounded px-4 py-3 text-white focus:ring-1 outline-none transition-colors`}
                                placeholder="e.g., The Office Pool 2026"
                            />
                            {touched.name && !formData.name.trim() && (
                                <p className="text-xs text-rose-400 mt-1">Pool name is required.</p>
                            )}
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
                                    className="w-full bg-slate-950 border border-slate-700 rounded pl-6 pr-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                    placeholder="e.g., office-pool-26"
                                />
                            </div>
                            <p className="text-slate-500 text-[10px] mt-1">Lowercase letters, numbers, and dashes only.</p>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Tournament Type</label>
                            <select
                                value={formData.tournamentType}
                                onChange={(e) => {
                                    const type = e.target.value as 'ncaa' | 'bigeast' | 'big12';
                                    let lockAt = new Date('2026-03-17T12:00:00').getTime(); // NCAA default
                                    if (type === 'bigeast') {
                                        lockAt = new Date('2026-03-11T15:00:00').getTime(); // Big East tipoff
                                    } else if (type === 'big12') {
                                        lockAt = new Date('2026-03-10T12:00:00').getTime(); // Big 12 tipoff
                                    }
                                    update({ tournamentType: type, lockAt });
                                }}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-indigo-500"
                            >
                                <option value="ncaa">NCAA March Madness 2026</option>
                                <option value="bigeast">Big East Championship 2026</option>
                                <option value="big12">Big 12 Championship 2026</option>
                            </select>
                            {formData.tournamentType === 'bigeast' && (
                                <p className="text-[10px] text-amber-400 mt-1">🏀 Big East: 11 teams, 10 picks, lock date auto-set to Mar 11</p>
                            )}
                            {formData.tournamentType === 'big12' && (
                                <p className="text-[10px] text-amber-400 mt-1">🏀 Big 12: 16 teams, 15 picks, lock date auto-set to Mar 10</p>
                            )}
                        </div>

                        {formData.tournamentType === 'ncaa' && (
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Gender</label>
                                <select
                                    value={formData.gender}
                                    onChange={(e) => update({ gender: e.target.value as 'mens' | 'womens' })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-indigo-500"
                                >
                                    <option value="mens">Men's</option>
                                    <option value="womens">Women's</option>
                                </select>
                            </div>
                        )}

                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Manager Name</label>
                            <input
                                type="text"
                                value={formData.managerName}
                                onChange={(e) => update({ managerName: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                placeholder="Your Name"
                            />
                        </div>

                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Contact Email <span className="text-rose-500">*</span></label>
                            <input
                                type="email"
                                value={formData.contactEmail}
                                onChange={(e) => update({ contactEmail: e.target.value })}
                                onBlur={() => handleBlur('contactEmail')}
                                className={`w-full bg-slate-950 border ${touched.contactEmail && !formData.contactEmail.trim() ? 'border-rose-500 bg-rose-500/5 focus:ring-rose-500' : 'border-slate-700 focus:ring-indigo-500'} rounded px-4 py-3 text-white focus:ring-1 outline-none transition-colors`}
                                placeholder="email@example.com"
                            />
                            {touched.contactEmail && !formData.contactEmail.trim() && (
                                <p className="text-xs text-rose-400 mt-1">Contact email is required.</p>
                            )}
                            <p className="text-slate-500 text-[10px] mt-1">Visible to pool members so they can contact you.</p>
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
                    <p className="text-slate-400 text-sm mb-6">Configure entry fees, limits, and scoring system.</p>

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
                            <p className="text-xs text-slate-500 mt-2">How many brackets can one person submit?</p>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Total Entry Limit</label>
                            <select
                                value={formData.maxEntriesTotal}
                                onChange={(e) => update({ maxEntriesTotal: parseInt(e.target.value) })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-indigo-500"
                            >
                                <option value="-1">Unlimited</option>
                                <option value="10">10 Brackets</option>
                                <option value="25">25 Brackets</option>
                                <option value="50">50 Brackets</option>
                                <option value="100">100 Brackets</option>
                            </select>
                            <p className="text-xs text-slate-500 mt-2">The total number of brackets allowed for the entire pool.</p>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Scoring System</label>
                            {(() => {
                                const cfg = getRoundConfig(formData.tournamentType);
                                return (
                                    <select
                                        value={formData.scoringSystem}
                                        onChange={(e) => update({ scoringSystem: e.target.value as 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM' })}
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-indigo-500"
                                    >
                                        <option value="CLASSIC">Classic ({cfg.classic.join('-')})</option>
                                        <option value="ESPN">ESPN ({cfg.espn.join('-')})</option>
                                        <option value="FIBONACCI">Fibonacci ({cfg.fibonacci.join('-')})</option>
                                        <option value="CUSTOM">Custom</option>
                                    </select>
                                );
                            })()}
                        </div>

                        {formData.scoringSystem === 'CUSTOM' && (() => {
                            const cfg = getRoundConfig(formData.tournamentType);
                            const roundCount = cfg.labels.length;
                            return (
                                <div className="md:col-span-2 bg-slate-950 p-4 rounded-lg border border-amber-500/30">
                                    <label className="block text-xs font-bold text-amber-400 uppercase mb-3">⚡ Custom Points Per Round ({roundCount} rounds)</label>
                                    <div className={`grid grid-cols-3 sm:grid-cols-${Math.min(roundCount, 6)} gap-3`}>
                                        {cfg.labels.map((label, i) => (
                                            <div key={i}>
                                                <label className="block text-[10px] text-slate-500 mb-1 text-center">{label}</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={formData.customScoring[i] ?? 0}
                                                    onChange={(e) => {
                                                        const newScoring = [...formData.customScoring];
                                                        newScoring[i] = parseInt(e.target.value) || 0;
                                                        update({ customScoring: newScoring });
                                                    }}
                                                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-2 text-white text-sm text-center outline-none focus:border-amber-500"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-2">Points awarded per correct pick in each round.</p>
                                </div>
                            );
                        })()}

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Upset Bonuses</label>
                            <div className="flex items-center justify-between bg-slate-950 border border-slate-700 rounded-lg p-3">
                                <div>
                                    <h4 className="font-bold text-white text-sm">Enable Upset Bonus</h4>
                                    <p className="text-xs text-slate-500">Reward players for bolder predictions.</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.upsetBonus?.enabled}
                                        onChange={(e) => update({ upsetBonus: { ...(formData.upsetBonus || { multiplier: 5 }), enabled: e.target.checked } })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500" />
                                </label>
                            </div>

                            {formData.upsetBonus?.enabled && (
                                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mt-3 animate-in fade-in slide-in-from-top-2">
                                    <label className="block text-[10px] font-bold text-amber-500/80 uppercase mb-1">Points Per Seed Difference</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formData.upsetBonus.multiplier}
                                        onChange={(e) => update({ upsetBonus: { ...formData.upsetBonus, multiplier: parseInt(e.target.value) || 0, enabled: true } })}
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-amber-500"
                                    />
                                    <p className="text-[10px] text-amber-500/60 mt-2 leading-snug">
                                        E.g. A 12-seed beats a 5-seed = difference of 7. <br />
                                        7 × {formData.upsetBonus.multiplier || 0} = <strong className="text-amber-400">+{7 * (formData.upsetBonus.multiplier || 0)} Bonus Points</strong>.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Lock Date/Time</label>
                            <input
                                type="datetime-local"
                                value={(() => {
                                    const d = new Date(formData.lockAt);
                                    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                                        .toISOString()
                                        .slice(0, 16);
                                })()}
                                onChange={(e) => update({ lockAt: new Date(e.target.value).getTime() })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-indigo-500"
                            />
                            <p className="text-xs text-slate-500 mt-1">When should the pool lock? (your local time)</p>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Tiebreaker Rule</label>
                            <select
                                value={formData.tieBreaker}
                                onChange={(e) => update({ tieBreaker: e.target.value as 'CLOSEST_ABSOLUTE' | 'CLOSEST_UNDER' })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white outline-none focus:border-indigo-500"
                            >
                                <option value="CLOSEST_ABSOLUTE">Closest (Over/Under)</option>
                                <option value="CLOSEST_UNDER">Closest Without Going Over</option>
                            </select>
                            <p className="text-xs text-slate-500 mt-1">
                                {formData.tieBreaker === 'CLOSEST_ABSOLUTE' && 'Wins if they are closest to the total score, regardless if they go over.'}
                                {formData.tieBreaker === 'CLOSEST_UNDER' && 'Standard Price is Right rules. If everyone goes over, closest to total wins.'}
                            </p>
                        </div>
                    </div>

                    {formData.entryFee > 0 && (
                        <div className="mt-6 pt-6 border-t border-slate-800 animate-in slide-in-from-top duration-300">
                            <h4 className="text-sm font-bold text-white mb-4">Payment Information</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="md:col-span-1">
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Venmo (@username)</label>
                                    <input
                                        type="text"
                                        value={formData.venmo}
                                        onChange={(e) => update({ venmo: e.target.value })}
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                        placeholder="@YourVenmo"
                                    />
                                </div>

                                <div className="md:col-span-1">
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Zelle (@username/phone)</label>
                                    <input
                                        type="text"
                                        value={formData.zelle}
                                        onChange={(e) => update({ zelle: e.target.value })}
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                        placeholder="Enter Zelle Info"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Payment Instructions</label>
                                    <textarea
                                        value={formData.paymentInstructions}
                                        onChange={(e) => update({ paymentInstructions: e.target.value })}
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none h-24 resize-none"
                                        placeholder="e.g., &quot;Venmo @Michael-Scott and put your bracket name in the memo. No refunds!&quot;"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    function renderStep3() {
        const baseTotal = [...formData.payouts.places, ...formData.payouts.bonuses].reduce((sum, p) => sum + p.percentage, 0);
        const total = baseTotal + (formData.charity.enabled ? formData.charity.percentage : 0);
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
                                className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded font-bold"
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

                    {/* Charity / Fundraising Section */}
                    <div className="mt-8 pt-8 border-t border-slate-800">
                        <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                            <Sparkles size={20} className="text-indigo-400" /> Charity / Fundraising
                        </h3>
                        <p className="text-slate-400 text-sm mb-6">Allocate a percentage of the pot to a cause.</p>

                        <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors mb-4">
                            <div>
                                <span className="font-bold text-slate-200 block">Enable Fundraising</span>
                                <span className="text-xs text-slate-500">Deduct a percentage from determining the payouts.</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={formData.charity.enabled}
                                onChange={(e) => update({ charity: { ...formData.charity, enabled: e.target.checked } })}
                                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                            />
                        </label>

                        {formData.charity.enabled && (
                            <div className="space-y-4 animate-in fade-in bg-slate-950 p-4 rounded-lg border border-slate-800">
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Organization Name</label>
                                    <input
                                        type="text"
                                        value={formData.charity.name}
                                        onChange={(e) => update({ charity: { ...formData.charity, name: e.target.value } })}
                                        placeholder="e.g. Red Cross"
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Percentage %</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={formData.charity.percentage}
                                                onChange={(e) => update({ charity: { ...formData.charity, percentage: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) } })}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500 pr-8"
                                            />
                                            <span className="absolute right-3 top-2 text-slate-500">%</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Link (Optional)</label>
                                        <input
                                            type="url"
                                            value={formData.charity.url || ''}
                                            onChange={(e) => update({ charity: { ...formData.charity, url: e.target.value } })}
                                            placeholder="https://..."
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Description</label>
                                    <textarea
                                        value={formData.charity.description || ''}
                                        onChange={(e) => update({ charity: { ...formData.charity, description: e.target.value } })}
                                        rows={2}
                                        placeholder="Briefly describe the cause..."
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    function renderStep4() {
        return (
            <WizardStepBranding
                branding={formData.branding}
                onUpdate={(branding) => update({ branding: { ...formData.branding, ...branding } })}
            />
        );
    }

    function renderStep5() {
        return (
            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <Calendar size={20} className="text-emerald-400" />
                        Smart Reminders
                    </h3>
                    <p className="text-slate-400 text-sm mb-6">Automatically notify players at key moments.</p>

                    <div className="space-y-4">
                        <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
                            <div>
                                <span className="font-bold text-slate-200 block">24-Hour Reminder</span>
                                <span className="text-xs text-slate-500">Email all players 24h before lock</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={formData.reminders.auto24h}
                                onChange={(e) => update({ reminders: { ...formData.reminders, auto24h: e.target.checked } })}
                                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                            />
                        </label>

                        <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
                            <div>
                                <span className="font-bold text-slate-200 block">1-Hour Reminder</span>
                                <span className="text-xs text-slate-500">Final reminder 1h before lock</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={formData.reminders.auto1h}
                                onChange={(e) => update({ reminders: { ...formData.reminders, auto1h: e.target.checked } })}
                                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                            />
                        </label>

                        <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
                            <div>
                                <span className="font-bold text-slate-200 block">Auto-Lock Pool</span>
                                <span className="text-xs text-slate-500">Automatically lock at tournament start</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={formData.reminders.autoLock}
                                onChange={(e) => update({ reminders: { ...formData.reminders, autoLock: e.target.checked } })}
                                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                            />
                        </label>

                        <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
                            <div>
                                <span className="font-bold text-slate-200 block">Winner Announcements</span>
                                <span className="text-xs text-slate-500">Auto-email when winners are finalized</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={formData.reminders.announceWinner}
                                onChange={(e) => update({ reminders: { ...formData.reminders, announceWinner: e.target.checked } })}
                                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                            />
                        </label>

                        <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
                            <div>
                                <span className="font-bold text-slate-200 block">SMS Notifications</span>
                                <span className="text-xs text-slate-500">Send text messages to players who opt-in</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={formData.reminders.smsEnabled || false}
                                onChange={(e) => update({ reminders: { ...formData.reminders, smsEnabled: e.target.checked } })}
                                className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                            />
                        </label>
                    </div>
                </div>
            </div>
        );
    }

    function renderStep6() {
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
                poolUrl={`${window.location.origin}/#bracket/${formData.slug || formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                poolSlug={formData.slug}
                onUpdate={(settings) => {
                    const newData: Partial<typeof formData> = {};
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

    function renderStep7() {
        const poolSlug = formData.slug || formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const baseUrl = `https://www.marchmeleepools.com/${poolSlug}`;
        const defaultMessage = `🏀 Join my March Madness bracket pool "${formData.name}"! Entry fee: $${formData.entryFee}. Think you can pick the winners?`;
        const message = shareMessage || defaultMessage;

        const makeUrl = (platform: string) => {
            const params = new URLSearchParams({
                utm_source: platform,
                utm_medium: 'social',
                utm_campaign: poolSlug
            });
            return `${baseUrl}?${params.toString()}`;
        };

        const shareToFacebook = () => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(makeUrl('facebook'))}&quote=${encodeURIComponent(message)}`, '_blank');
        const shareToX = () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(makeUrl('twitter'))}`, '_blank');
        const shareToReddit = () => window.open(`https://reddit.com/submit?url=${encodeURIComponent(makeUrl('reddit'))}&title=${encodeURIComponent(message)}`, '_blank');
        const shareToEmail = () => window.open(`mailto:?subject=${encodeURIComponent(`Join: ${formData.name}`)}&body=${encodeURIComponent(`${message}\n\n${makeUrl('email')}`)}`);

        const copyToClipboard = (platform: string) => {
            const url = makeUrl(platform);
            const text = `${message}\n\n${url}`;
            navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            });
        };

        return (
            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <Share2 size={24} className="text-indigo-400" />
                        <h3 className="text-xl font-bold text-white">Share Your Pool</h3>
                    </div>
                    <p className="text-slate-400 text-sm mb-6">Invite players to join your bracket pool via social media.</p>

                    {/* Custom Message Editor */}
                    <div className="mb-6">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Customize Your Message</label>
                        <textarea
                            value={shareMessage || defaultMessage}
                            onChange={(e) => setShareMessage(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-indigo-500 h-24 resize-none"
                            placeholder="Write your invite message..."
                        />
                        <p className="text-[10px] text-slate-500 mt-1">This message will be included when sharing to each platform.</p>
                    </div>

                    {/* Share Buttons */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                        <button
                            onClick={shareToFacebook}
                            className="flex items-center justify-center gap-2 bg-[#1877F2] hover:bg-[#166FE5] text-white px-4 py-3 rounded-lg font-bold text-sm transition-all"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                            Facebook
                        </button>

                        <button
                            onClick={shareToX}
                            className="flex items-center justify-center gap-2 bg-black hover:bg-slate-800 text-white px-4 py-3 rounded-lg font-bold text-sm transition-all border border-slate-700"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                            X (Twitter)
                        </button>

                        <button
                            onClick={shareToReddit}
                            className="flex items-center justify-center gap-2 bg-[#FF4500] hover:bg-[#E03D00] text-white px-4 py-3 rounded-lg font-bold text-sm transition-all"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" /></svg>
                            Reddit
                        </button>

                        <button
                            onClick={() => copyToClipboard('discord')}
                            className="flex items-center justify-center gap-2 bg-[#5865F2] hover:bg-[#4752C4] text-white px-4 py-3 rounded-lg font-bold text-sm transition-all"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286z" /></svg>
                            Discord
                        </button>

                        <button
                            onClick={shareToEmail}
                            className="flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-3 rounded-lg font-bold text-sm transition-all"
                        >
                            <Mail size={18} />
                            Email
                        </button>

                        <button
                            onClick={() => copyToClipboard('copy')}
                            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-lg font-bold text-sm transition-all"
                        >
                            <Copy size={16} />
                            {copied ? '✓ Copied!' : 'Copy Link'}
                        </button>
                    </div>

                    {/* Instagram — No Tracking */}
                    <div className="bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-amber-500/10 border border-purple-500/20 rounded-lg p-4 mb-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="text-pink-400"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>
                                <div>
                                    <p className="text-white text-sm font-bold">Instagram</p>
                                    <p className="text-[10px] text-slate-400">Paste the copied link in your bio, story, or DM</p>
                                </div>
                            </div>
                            <button
                                onClick={() => copyToClipboard('instagram')}
                                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"
                            >
                                {copied ? '✓ Copied!' : 'Copy for Instagram'}
                            </button>
                        </div>
                        <div className="flex items-center gap-2 mt-3 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                            <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                            <p className="text-[10px] text-amber-300">No click tracking available for Instagram — links shared on Instagram bypass UTM parameters.</p>
                        </div>
                    </div>

                    {/* URL Preview */}
                    <div className="bg-slate-950 border border-slate-700 rounded-lg p-4">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tracked URL Preview</label>
                        <div className="flex items-center gap-2">
                            <ExternalLink size={14} className="text-indigo-400 shrink-0" />
                            <code className="text-xs text-indigo-300 break-all">{makeUrl('platform')}</code>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-2">Each platform generates a unique tracked URL so you can see which channels drive the most signups.</p>
                    </div>
                </div>
            </div>
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
                                <div className="text-slate-400">Tournament:</div>
                                <div className="text-white">{formData.gender === 'mens' ? "Men's" : "Women's"} {formData.seasonYear}</div>
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
                                <div className="text-slate-400">Scoring:</div>
                                <div className="text-white">{formData.scoringSystem}</div>
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
                                {formData.charity.enabled && (
                                    <div className="flex justify-between border-t border-slate-800 pt-1 mt-1">
                                        <span className="text-indigo-400">Charity ({formData.charity.name || 'Unnamed'})</span>
                                        <span className="text-indigo-400 font-mono">{formData.charity.percentage}%</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
};
