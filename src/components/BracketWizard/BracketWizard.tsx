
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

    const [formData, setFormData] = useState<{
        name: string;
        slug: string; // generated or custom
        seasonYear: number;
        isListedPublic: boolean;
        password: '';
        maxEntriesTotal: number; // -1 unlimited
        maxEntriesPerUser: number;
        entryFee: number;
        paymentInstructions: string;
        scoringSystem: 'CLASSIC' | 'ESPN' | 'FIBONACCI' | 'CUSTOM';
        tieBreakers: { closestAbsolute: boolean; closestUnder: boolean; };
    }>({
        name: `${user.name}'s Bracket Pool`,
        slug: '',
        seasonYear: 2025,
        isListedPublic: false,
        password: '',
        maxEntriesTotal: -1,
        maxEntriesPerUser: 3,
        entryFee: 0,
        paymentInstructions: '',
        scoringSystem: 'CLASSIC',
        tieBreakers: { closestAbsolute: true, closestUnder: false }
    });

    const TOTAL_STEPS = 6;

    const handleNext = () => setStep(s => Math.min(TOTAL_STEPS, s + 1));
    const handleBack = () => setStep(s => Math.max(1, s - 1));

    const update = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handlePublish = async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Create Draft Pool
            const createFn = httpsCallable(functions, 'createBracketPool');
            const createRes = await createFn({
                name: formData.name,
                seasonYear: formData.seasonYear,
                settings: {
                    maxEntriesTotal: formData.maxEntriesTotal,
                    maxEntriesPerUser: formData.maxEntriesPerUser,
                    entryFee: formData.entryFee,
                    paymentInstructions: formData.paymentInstructions,
                    scoringSystem: formData.scoringSystem,
                    tieBreakers: formData.tieBreakers
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
                                    <div className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-500">
                                        {formData.seasonYear} Men's Basketball
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
                                    <div className="flex">
                                        <span className="bg-slate-800 border border-r-0 border-slate-700 rounded-l-lg px-3 py-3 text-slate-400">marchmelee.com/#pool/</span>
                                        <input type="text" value={formData.slug} onChange={(e) => update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder={formData.name.toLowerCase().replace(/[^a-z0-9]/g, '-')} className="flex-1 bg-slate-950 border border-slate-700 rounded-r-lg px-4 py-3 focus:border-indigo-500 outline-none font-mono text-sm" />
                                    </div>
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

                            <div className="mt-8 border-t border-slate-800 pt-6">
                                <h3 className="font-bold mb-4">Tiebreakers</h3>
                                <label className="flex items-center gap-3 mb-2 cursor-pointer">
                                    <input type="checkbox" checked={formData.tieBreakers.closestAbsolute} onChange={(e) => update('tieBreakers', { ...formData.tieBreakers, closestAbsolute: e.target.checked })} className="w-5 h-5 bg-slate-950 border-slate-700 rounded text-indigo-500" />
                                    <span>Closest to Total Score (Absolute Diff)</span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input type="checkbox" checked={formData.tieBreakers.closestUnder} onChange={(e) => update('tieBreakers', { ...formData.tieBreakers, closestUnder: e.target.checked })} className="w-5 h-5 bg-slate-950 border-slate-700 rounded text-indigo-500" />
                                    <span>Closest without going over (Price is Right rules)</span>
                                </label>
                            </div>
                        </div>
                    )}

                    {step === 5 && (
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

                    {step === 6 && (
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
                            </div>

                            <button onClick={handlePublish} disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl mt-8 flex items-center justify-center gap-2 transition-all">
                                {loading ? <span className="animate-pulse">Creating Pool...</span> : <><Shield size={20} /> Publish Pool</>}
                            </button>
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
