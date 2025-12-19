
import React, { useState } from 'react';
import type { User } from '../../types';
import { ArrowLeft, ArrowRight, CheckCircle, Shield, Trophy, DollarSign, Settings } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase'; // Adjust import based on actual file structure

// Steps
// 1. Basics (Name, Season)
// 2. Visibility (Public/Private, Password)
// 3. Entries (Limits)
// 4. Scoring (System)
// 5. Payment (Instructions)
// 6. Review

interface BracketWizardProps {
    user: User;
    onCancel: () => void;
    onSuccess: (poolId: string) => void;
}

export const BracketWizard: React.FC<BracketWizardProps> = ({ user, onCancel, onSuccess }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');

    const [formData, setFormData] = useState<{
        name: string;
        slug: string; // generated or custom
        seasonYear: number;
        gender: 'mens' | 'womens';
        isListedPublic: boolean;
        password: '';
        maxEntriesTotal: number; // -1 unlimited
        maxEntriesPerUser: number;
        entryFee: number;
        paymentInstructions: string;
        scoringSystem: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
        customScoring: number[];
        tieBreaker: 'CLOSEST_ABSOLUTE' | 'CLOSEST_UNDER';
        payouts: {
            places: { rank: number; percentage: number }[];
            bonuses: { name: string; percentage: number }[];
        };
    }>({
        name: `${user.name}'s Bracket Pool`,
        slug: '',
        seasonYear: 2025,
        gender: 'mens' as 'mens' | 'womens',
        isListedPublic: false,
        password: '',
        maxEntriesTotal: -1,
        maxEntriesPerUser: 3,
        entryFee: 0,
        paymentInstructions: '',
        scoringSystem: 'CLASSIC',
        customScoring: [1, 2, 4, 8, 16, 32],
        tieBreaker: 'CLOSEST_ABSOLUTE',
        payouts: {
            places: [{ rank: 1, percentage: 70 }, { rank: 2, percentage: 30 }],
            bonuses: []
        }
    });

    const TOTAL_STEPS = 7;

    const handleNext = () => setStep(s => Math.min(TOTAL_STEPS, s + 1));
    const handleBack = () => setStep(s => Math.max(1, s - 1));

    const update = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const addPlace = () => {
        const nextRank = formData.payouts.places.length + 1;
        update('payouts', { ...formData.payouts, places: [...formData.payouts.places, { rank: nextRank, percentage: 0 }] });
    };

    const removePlace = (index: number) => {
        const newPlaces = formData.payouts.places.filter((_, i) => i !== index).map((p, i) => ({ ...p, rank: i + 1 }));
        update('payouts', { ...formData.payouts, places: newPlaces });
    };

    const updatePlace = (index: number, val: number) => {
        const newPlaces = [...formData.payouts.places];
        newPlaces[index].percentage = val;
        update('payouts', { ...formData.payouts, places: newPlaces });
    };

    const addBonus = () => {
        update('payouts', { ...formData.payouts, bonuses: [...formData.payouts.bonuses, { name: 'Bonus', percentage: 0 }] });
    };

    const removeBonus = (index: number) => {
        const newBonuses = formData.payouts.bonuses.filter((_, i) => i !== index);
        update('payouts', { ...formData.payouts, bonuses: newBonuses });
    };

    const updateBonus = (index: number, field: 'name' | 'percentage', val: any) => {
        const newBonuses = [...formData.payouts.bonuses];
        // @ts-ignore
        newBonuses[index][field] = val;
        update('payouts', { ...formData.payouts, bonuses: newBonuses });
    };

    const totalPercentage = [...formData.payouts.places, ...formData.payouts.bonuses].reduce((sum, p) => sum + p.percentage, 0);

    const handlePublish = async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Create Draft Pool
            const createFn = httpsCallable(functions, 'createBracketPool');
            const createRes = await createFn({
                name: formData.name,
                seasonYear: formData.seasonYear,
                gender: formData.gender,
                settings: {
                    maxEntriesTotal: formData.maxEntriesTotal,
                    maxEntriesPerUser: formData.maxEntriesPerUser,
                    entryFee: formData.entryFee,
                    paymentInstructions: formData.paymentInstructions,
                    scoringSystem: formData.scoringSystem,
                    customScoring: formData.scoringSystem === 'CUSTOM' ? formData.customScoring : undefined,
                    tieBreakers: {
                        closestAbsolute: formData.tieBreaker === 'CLOSEST_ABSOLUTE',
                        closestUnder: formData.tieBreaker === 'CLOSEST_UNDER'
                    },
                    payouts: formData.payouts
                }
            });
            const { poolId } = createRes.data as { poolId: string };

            // 2. Publish (Slug + Password)
            // Auto-generate slug if empty? 
            // The cloud function auto-generates a temporary slug on create, but publish sets the real one.
            // Ideally we let user pick slug in wizard.
            const publishFn = httpsCallable(functions, 'publishBracketPool');
            await publishFn({
                poolId,
                slug: formData.slug || formData.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                password: formData.password || undefined,
                isListedPublic: formData.isListedPublic
            });

            onSuccess(poolId);
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to create pool.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 flex justify-center">
            <div className="max-w-3xl w-full">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <button onClick={onCancel} className="text-slate-400 hover:text-white flex items-center gap-2">
                        <ArrowLeft size={20} /> Cancel
                    </button>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-500">Step {step} of {TOTAL_STEPS}</span>
                    </div>
                </div>

                {/* Progress */}
                <div className="w-full bg-slate-900 h-2 rounded-full mb-8 overflow-hidden">
                    <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}></div>
                </div>

                {/* Content */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 md:p-10 shadow-xl min-h-[400px]">
                    {error && <div className="bg-rose-500/10 text-rose-400 p-4 rounded-lg mb-6 border border-rose-500/20">{error}</div>}

                    {step === 1 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><Trophy className="text-amber-400" /> Pool Basics</h2>
                            <div className="space-y-4 max-w-lg">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Pool Name</label>
                                    <input type="text" value={formData.name} onChange={(e) => update('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 focus:border-indigo-500 outline-none text-lg font-bold" />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Season</label>
                                    <div className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-500 cursor-not-allowed">
                                        {formData.seasonYear} Season (Current)
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-2">Tournament</label>
                                    <div className="flex gap-4">
                                        <button
                                            onClick={() => update('gender', 'mens')}
                                            className={`flex-1 py-3 px-4 rounded-lg border font-bold transition-all ${formData.gender === 'mens' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-600'}`}
                                        >
                                            Men's Tournament
                                        </button>
                                        <button
                                            disabled
                                            className="flex-1 py-3 px-4 rounded-lg border border-slate-800 bg-slate-900/50 text-slate-600 cursor-not-allowed font-medium relative overflow-hidden"
                                        >
                                            Women's Tournament
                                            <span className="absolute inset-0 bg-slate-950/20 backdrop-blur-[1px]"></span>
                                            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800 text-xs px-2 py-1 rounded border border-slate-700 opacity-90">Coming Soon</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><Shield className="text-indigo-400" /> Visibility & Access</h2>
                            <div className="space-y-6 max-w-lg">
                                <label className="flex items-start gap-4 p-4 border border-slate-800 rounded-lg hover:bg-slate-800/50 cursor-pointer transition-colors">
                                    <input type="checkbox" checked={formData.isListedPublic} onChange={(e) => update('isListedPublic', e.target.checked)} className="mt-1 w-5 h-5 bg-slate-950 border-slate-700 rounded text-indigo-500" />
                                    <div>
                                        <div className="font-bold">List in Public Directory</div>
                                        <div className="text-sm text-slate-400">Allow strangers to find and join your pool from the "Browse Pools" page.</div>
                                    </div>
                                </label>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Pool Password (Optional)</label>
                                    <input type="text" value={formData.password} onChange={(e) => update('password', e.target.value)} placeholder="Leave empty for open access" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 focus:border-indigo-500 outline-none" />
                                    <p className="text-xs text-slate-500 mt-2">If set, participants must enter this password to join.</p>
                                </div>

                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Custom URL Slug</label>
                                    <div className="flex relative">
                                        <span className="bg-slate-800 border border-r-0 border-slate-700 rounded-l-lg px-3 py-3 text-slate-400">marchmelee.com/#pool/</span>
                                        <input
                                            type="text"
                                            value={formData.slug}
                                            onChange={(e) => {
                                                const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                                                update('slug', val);
                                                // Reset availability check on change
                                                setSlugStatus('idle');
                                            }}
                                            onBlur={async () => {
                                                if (!formData.slug) return;
                                                setSlugStatus('checking');
                                                try {
                                                    const { doc, getDoc } = await import('firebase/firestore');
                                                    const { db } = await import('../../firebase');
                                                    const slugRef = doc(db, 'slugs', formData.slug);
                                                    const slugSnap = await getDoc(slugRef);
                                                    if (slugSnap.exists()) {
                                                        setSlugStatus('taken');
                                                    } else {
                                                        setSlugStatus('available');
                                                    }
                                                } catch (err) {
                                                    console.error("Slug check failed", err);
                                                    setSlugStatus('error');
                                                }
                                            }}
                                            placeholder={formData.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}
                                            className={`flex-1 bg-slate-950 border rounded-r-lg px-4 py-3 outline-none font-mono text-sm ${slugStatus === 'taken' ? 'border-rose-500 text-rose-500' : slugStatus === 'available' ? 'border-emerald-500 text-emerald-500' : 'border-slate-700 focus:border-indigo-500'}`}
                                        />
                                        <div className="absolute right-3 top-3">
                                            {slugStatus === 'checking' && <span className="text-slate-500 animate-pulse">Running check...</span>}
                                            {slugStatus === 'taken' && <span className="text-rose-500 font-bold">✕ Taken</span>}
                                            {slugStatus === 'available' && <span className="text-emerald-500 font-bold">✓ Available</span>}
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-2">Alphanumeric and hyphens only. We'll check if it's available.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><Settings className="text-slate-400" /> Entry Limits</h2>
                            <div className="space-y-6 max-w-lg">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Max Entries Per Person</label>
                                    <select value={formData.maxEntriesPerUser} onChange={(e) => update('maxEntriesPerUser', parseInt(e.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white outline-none">
                                        <option value={1}>1 Entry</option>
                                        <option value={2}>2 Entries</option>
                                        <option value={3}>3 Entries</option>
                                        <option value={5}>5 Entries</option>
                                        <option value={10}>10 Entries</option>
                                        <option value={20}>20 Entries</option>
                                        <option value={25}>25 Entries</option>
                                        <option value={50}>50 Entries</option>
                                        <option value={-1}>Unlimited</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Total Pool Capacity</label>
                                    <select value={formData.maxEntriesTotal} onChange={(e) => update('maxEntriesTotal', parseInt(e.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white outline-none">
                                        <option value={-1}>Unlimited</option>
                                        <option value={50}>50 Entries</option>
                                        <option value={100}>100 Entries</option>
                                        <option value={500}>500 Entries</option>
                                        <option value={1000}>1000 Entries</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><CheckCircle className="text-emerald-400" /> Scoring System</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {[
                                    { value: 'CLASSIC', label: 'Classic', desc: '1 - 2 - 4 - 8 - 16 - 32' },
                                    { value: 'ESPN', label: 'ESPN Standard', desc: '10 - 20 - 40 - 80 - 160 - 320' },
                                    { value: 'FIBONACCI', label: 'Fibonacci', desc: '2 - 3 - 5 - 8 - 13 - 21' },
                                    { value: 'CUSTOM', label: 'Custom', desc: 'Define your own values per round' }
                                ].map(opt => (
                                    <div key={opt.value} onClick={() => update('scoringSystem', opt.value)} className={`p-4 border rounded-lg cursor-pointer transition-all ${formData.scoringSystem === opt.value ? 'bg-indigo-900/20 border-indigo-500' : 'bg-slate-950 border-slate-800 hover:border-slate-600'}`}>
                                        <div className="font-bold text-lg mb-1">{opt.label}</div>
                                        <div className="text-sm text-slate-400">{opt.desc}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-6 border-t border-slate-800 pt-6">
                                {formData.scoringSystem === 'CUSTOM' && (
                                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 mb-6 animate-in fade-in zoom-in-95">
                                        <h3 className="font-bold mb-4 text-indigo-400">Custom Round Scoring</h3>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                            {['R64', 'R32', 'Sweet 16', 'Elite 8', 'Final 4', 'Champ'].map((label, i) => (
                                                <div key={label}>
                                                    <label className="block text-xs text-slate-500 mb-1">{label}</label>
                                                    <input
                                                        type="number"
                                                        value={formData.customScoring[i]}
                                                        onChange={(e) => {
                                                            const newScores = [...formData.customScoring];
                                                            newScores[i] = parseInt(e.target.value) || 0;
                                                            update('customScoring', newScores);
                                                        }}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-2 text-center font-mono focus:border-indigo-500 outline-none"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <h3 className="font-bold mb-4">Tiebreakers</h3>
                                <div className="space-y-4 max-w-lg">
                                    <label className="block text-sm text-slate-400 mb-1">Select Tiebreaker Rule</label>
                                    <select
                                        value={formData.tieBreaker}
                                        onChange={(e) => update('tieBreaker', e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white outline-none"
                                    >
                                        <option value="CLOSEST_ABSOLUTE">Closest to Total Score (Absolute Diff)</option>
                                        <option value="CLOSEST_UNDER">Closest without going over (Price is Right)</option>
                                    </select>
                                    <p className="text-xs text-slate-500">Determines who wins if multiple entries have the same bracket score.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 5 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><DollarSign className="text-fuchsia-400" /> Payout Structure</h2>
                            <div className="space-y-6 max-w-lg">
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="block text-sm text-slate-400">Place Payouts</label>
                                        <button onClick={addPlace} className="text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-indigo-400">+ Add Place</button>
                                    </div>
                                    {formData.payouts.places.map((place, idx) => (
                                        <div key={idx} className="flex gap-2 mb-2">
                                            <div className="bg-slate-800 px-3 py-2 rounded text-slate-400 min-w-[60px] flex items-center justify-center font-bold">
                                                {place.rank}{place.rank === 1 ? 'st' : place.rank === 2 ? 'nd' : place.rank === 3 ? 'rd' : 'th'}
                                            </div>
                                            <div className="flex-1 relative">
                                                <input
                                                    type="number"
                                                    value={place.percentage}
                                                    onChange={(e) => updatePlace(idx, parseFloat(e.target.value))}
                                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none pr-8"
                                                />
                                                <span className="absolute right-3 top-2 text-slate-500">%</span>
                                            </div>
                                            {idx > 0 && <button onClick={() => removePlace(idx)} className="text-rose-500 hover:text-rose-400 px-2">×</button>}
                                        </div>
                                    ))}
                                </div>

                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="block text-sm text-slate-400">Bonus Payouts</label>
                                        <button onClick={addBonus} className="text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-pink-400">+ Add Bonus</button>
                                    </div>
                                    {formData.payouts.bonuses.map((bonus, idx) => (
                                        <div key={idx} className="flex gap-2 mb-2">
                                            <select
                                                value={bonus.name}
                                                onChange={(e) => updateBonus(idx, 'name', e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none text-sm"
                                            >
                                                <option value="Select Bonus...">Select Bonus...</option>
                                                <option value="Highest Percentage Correct">Highest Percentage Correct</option>
                                                <option value="Most Correct in Round 1">Most Correct in Round 1</option>
                                            </select>
                                            <div className="w-24 relative">
                                                <input
                                                    type="number"
                                                    value={bonus.percentage}
                                                    onChange={(e) => updateBonus(idx, 'percentage', parseFloat(e.target.value))}
                                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none pr-8"
                                                />
                                                <span className="absolute right-3 top-2 text-slate-500">%</span>
                                            </div>
                                            <button onClick={() => removeBonus(idx)} className="text-rose-500 hover:text-rose-400 px-2">×</button>
                                        </div>
                                    ))}
                                </div>

                                <div className={`p-4 rounded-lg flex justify-between items-center ${totalPercentage === 100 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                                    <span className="font-bold">Total Allocation</span>
                                    <span className="font-mono text-xl">{totalPercentage}%</span>
                                </div>
                                {totalPercentage !== 100 && <p className="text-xs text-amber-500">Total must equal 100% to publish.</p>}
                            </div>
                        </div>
                    )}

                    {step === 6 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><DollarSign className="text-green-400" /> Payment & Fees</h2>
                            <div className="space-y-6 max-w-lg">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Entry Fee ($)</label>
                                    <input type="number" value={formData.entryFee} onChange={(e) => update('entryFee', parseFloat(e.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white outline-none font-mono" />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Payment Instructions</label>
                                    <textarea value={formData.paymentInstructions} onChange={(e) => update('paymentInstructions', e.target.value)} placeholder="e.g. Venmo @MyName with 'Pool Entry'" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white outline-none h-32" />
                                    <p className="text-xs text-slate-500 mt-2">Displayed to participants after they join.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 7 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-6">Review & Publish</h2>
                            <div className="bg-slate-950 border border-slate-800 rounded-lg p-6 space-y-4 text-sm text-slate-300">
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Name</span>
                                    <span className="font-bold text-white">{formData.name}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Access</span>
                                    <span className="font-bold text-white">{formData.isListedPublic ? 'Public' : 'Private'} {formData.password ? '(Password Protected)' : ''}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Slug</span>
                                    <span className="font-bold text-white text-xs">{formData.slug || 'Auto-generated'}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Entry Fee</span>
                                    <span className="font-bold text-white">${formData.entryFee}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Scoring</span>
                                    <span className="font-bold text-white">{formData.scoringSystem}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Payouts</span>
                                    <div className="text-right">
                                        {formData.payouts.places.map(p => <div key={p.rank}>{p.rank === 1 ? '1st' : p.rank + 'th'}: {p.percentage}%</div>)}
                                        {formData.payouts.bonuses.map(b => <div key={b.name} className="text-xs text-pink-400">{b.name}: {b.percentage}%</div>)}
                                    </div>
                                </div>
                            </div>

                            <button onClick={handlePublish} disabled={loading || totalPercentage !== 100} className={`w-full font-bold py-4 rounded-xl mt-8 flex items-center justify-center gap-2 transition-all ${totalPercentage === 100 ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}>
                                {loading ? <span className="animate-pulse">Creating Pool...</span> : <><Shield size={20} /> Publish Pool</>}
                            </button>
                            {totalPercentage !== 100 && <p className="text-center text-xs text-rose-500 mt-2">Payouts must equal 100%.</p>}
                            <p className="text-center text-xs text-slate-500 mt-4">By publishing, you agree to manage this pool responsibly.</p>
                        </div>
                    )}
                </div>

                {/* Footer Nav */}
                <div className="mt-8 flex justify-between">
                    {step > 1 ? (
                        <button onClick={handleBack} className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2">
                            <ArrowLeft size={18} /> Back
                        </button>
                    ) : <div></div>}

                    {step < TOTAL_STEPS ? (
                        <button onClick={handleNext} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2">
                            Next <ArrowRight size={18} />
                        </button>
                    ) : <div></div>}
                </div>

            </div>
        </div>
    );
};
