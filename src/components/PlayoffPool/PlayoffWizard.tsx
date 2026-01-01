import React, { useState } from 'react';
import type { User, PlayoffTeam, PayoutSettings } from '../../types';
import { dbService } from '../../services/dbService';
import { ArrowLeft, ArrowRight, CheckCircle, Trophy, DollarSign, AlertTriangle } from 'lucide-react';

// Mock of 14 teams for the current season (2024-25)
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
}

export const PlayoffWizard: React.FC<PlayoffWizardProps> = ({ user, onCancel, onComplete }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [formData, setFormData] = useState<{
        name: string;
        slug: string;
        isListedPublic: boolean;
        password: string;
        entryFee: number;
        paymentInstructions: string;
        multipliers: {
            wc: number;
            div: number;
            conf: number;
            sb: number;
        };
        payouts: PayoutSettings;
    }>({
        name: `${user.name}'s Playoff Challenge`,
        slug: '',
        isListedPublic: false,
        password: '',
        entryFee: 20,
        paymentInstructions: '',
        multipliers: {
            wc: 1,
            div: 2,
            conf: 4,
            sb: 8
        },
        payouts: {
            places: [{ rank: 1, percentage: 70 }, { rank: 2, percentage: 30 }],
            bonuses: []
        }
    });

    const TOTAL_STEPS = 5;

    const handleNext = () => setStep(s => Math.min(TOTAL_STEPS, s + 1));
    const handleBack = () => setStep(s => Math.max(1, s - 1));

    const update = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // Payout Helpers
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

    const totalPercentage = formData.payouts.places.reduce((sum, p) => sum + p.percentage, 0);

    const handleCreate = async () => {
        setLoading(true);
        setError(null);
        try {
            // New Pool Object
            const newPool: any = { // Use any to bypass specific backend constraints if strictly typed
                type: 'NFL_PLAYOFFS',
                league: 'NFL',
                name: formData.name,
                ownerId: user.id,
                season: '2024',
                createdAt: Date.now(),
                urlSlug: formData.slug || undefined,

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

                // Initial State
                teams: PLAYOFF_TEAMS_MOCK,
                entries: {},
                results: {},
                isLocked: false,
                lockDate: new Date('2025-01-11T16:30:00-05:00').getTime() // Example Wildcard Sat 1/11
            };

            const poolId = await dbService.createPool(newPool); // Use generic createPool
            onComplete(poolId);
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to create pool.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white flex justify-center p-4">
            <div className="max-w-3xl w-full">
                {/* Header */}
                <div className="flex items-center justify-between mb-8 mt-4">
                    <button onClick={onCancel} className="text-slate-400 hover:text-white flex items-center gap-2">
                        <ArrowLeft size={20} /> Cancel
                    </button>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-500">Step {step} of {TOTAL_STEPS}</span>
                    </div>
                </div>

                {/* Progress */}
                <div className="w-full bg-slate-900 h-2 rounded-full mb-8 overflow-hidden">
                    <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}></div>
                </div>

                {/* Content */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 md:p-10 shadow-xl min-h-[400px]">
                    {error && <div className="bg-rose-500/10 text-rose-400 p-4 rounded-lg mb-6 border border-rose-500/20 flex items-center gap-2"><AlertTriangle size={20} /> {error}</div>}

                    {step === 1 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><Trophy className="text-emerald-400" /> Pool Basics</h2>
                            <div className="space-y-4 max-w-lg">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Pool Name</label>
                                    <input type="text" value={formData.name} onChange={(e) => update('name', e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 focus:border-emerald-500 outline-none text-lg font-bold" />
                                </div>
                                <label className="flex items-start gap-4 p-4 border border-slate-800 rounded-lg hover:bg-slate-800/50 cursor-pointer transition-colors">
                                    <input type="checkbox" checked={formData.isListedPublic} onChange={(e) => update('isListedPublic', e.target.checked)} className="mt-1 w-5 h-5 accent-emerald-500" />
                                    <div>
                                        <div className="font-bold">List in Public Directory</div>
                                        <div className="text-sm text-slate-400">Allow strangers to find and join your pool.</div>
                                    </div>
                                </label>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1">Custom URL Slug (Optional)</label>
                                    <div className="flex relative">
                                        <span className="bg-slate-800 border border-r-0 border-slate-700 rounded-l-lg px-3 py-3 text-slate-400">#pool/</span>
                                        <input
                                            type="text"
                                            value={formData.slug}
                                            onChange={(e) => update('slug', e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
                                            placeholder="my-awesome-pool"
                                            className="flex-1 bg-slate-950 border border-slate-700 rounded-r-lg px-4 py-3 outline-none focus:border-emerald-500"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><CheckCircle className="text-indigo-400" /> Scoring Rules</h2>
                            <p className="text-slate-400 mb-6">Participants rank all 14 playoff teams from 14 down to 1. If a team wins in a round, the participant gets points: <br /> <span className="font-mono text-emerald-400">Assigned Rank × Round Multiplier</span>.</p>

                            <h3 className="font-bold mb-4 text-white border-b border-slate-800 pb-2">Round Multipliers</h3>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                {[{ k: 'wc', l: 'Wild Card' }, { k: 'div', l: 'Divisional' }, { k: 'conf', l: 'Conference' }, { k: 'sb', l: 'Super Bowl' }].map(r => (
                                    <div key={r.k} className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                                        <div className="text-sm text-slate-500 mb-1 uppercase font-bold">{r.l}</div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400 text-sm">x</span>
                                            <input
                                                type="number"
                                                // @ts-ignore
                                                value={formData.multipliers[r.k]}
                                                // @ts-ignore
                                                onChange={(e) => update('multipliers', { ...formData.multipliers, [r.k]: Number(e.target.value) })}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 font-bold text-center focus:border-indigo-500 outline-none"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><DollarSign className="text-fuchsia-400" /> Payout Structure</h2>
                            <div className="space-y-6 max-w-lg">
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="block text-sm text-slate-400">Place Payouts (% of Pot)</label>
                                        <button onClick={addPlace} className="text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-emerald-400">+ Add Place</button>
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

                                <div className={`p-4 rounded-lg flex justify-between items-center ${totalPercentage === 100 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                                    <span className="font-bold">Total Allocation</span>
                                    <span className="font-mono text-xl">{totalPercentage}%</span>
                                </div>
                                {totalPercentage !== 100 && <p className="text-xs text-amber-500">Total must equal 100%.</p>}
                            </div>
                        </div>
                    )}

                    {step === 4 && (
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
                                    <p className="text-xs text-slate-500 mt-2">These instructions are shown to players after they join. Payments are handled off-platform.</p>
                                </div>
                                <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg text-sm text-blue-200">
                                    <strong>Disclaimer:</strong> You are responsible for collecting all entry fees and distributing payouts. This platform is for hosting and scoring only.
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 5 && (
                        <div className="animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-2xl font-bold mb-6">Review & Launch</h2>
                            <div className="bg-slate-950 border border-slate-800 rounded-lg p-6 space-y-4 text-sm text-slate-300">
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Pool Name</span>
                                    <span className="font-bold text-white">{formData.name}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Entry Fee</span>
                                    <span className="font-bold text-white">${formData.entryFee}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Visibility</span>
                                    <span className="font-bold text-white">{formData.isListedPublic ? 'Public Directory' : 'Private (Link Only)'}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Scoring Multipliers</span>
                                    <span className="font-bold text-white">{formData.multipliers.wc}x, {formData.multipliers.div}x, {formData.multipliers.conf}x, {formData.multipliers.sb}x</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-800 pb-2">
                                    <span>Payouts</span>
                                    <div className="text-right">
                                        {formData.payouts.places.map(p => <div key={p.rank}>{p.rank === 1 ? '1st' : p.rank + 'th'}: {p.percentage}%</div>)}
                                    </div>
                                </div>
                            </div>

                            <button onClick={handleCreate} disabled={loading || totalPercentage !== 100} className={`w-full font-bold py-4 rounded-xl mt-8 flex items-center justify-center gap-2 transition-all ${totalPercentage === 100 ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}>
                                {loading ? <span className="animate-pulse">Creating Pool...</span> : <><CheckCircle size={20} /> Launch Pool</>}
                            </button>
                            {totalPercentage !== 100 && <p className="text-center text-xs text-rose-500 mt-2">Payouts must equal 100%.</p>}
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
                        <button onClick={handleNext} className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2">
                            Next <ArrowRight size={18} />
                        </button>
                    ) : <div></div>}
                </div>
            </div>
        </div>
    );
};
