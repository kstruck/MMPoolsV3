import React, { useState } from 'react';
import { WizardStepGame } from '../WizardStepGame';
import { WizardStepBranding } from '../WizardStepBranding';
import { WizardStepReminders } from '../WizardStepReminders';
import { PropsManager } from '../Props/PropsManager';
import { dbService } from '../../services/dbService';
import { Loader, ArrowLeft, Check, AlertTriangle, Mail, Lock, Users, QrCode, Plus, Trash2 } from 'lucide-react';
import type { GameState, PropsPool } from '../../types';
import { Header } from '../Header';
import { Footer } from '../Footer';
import { QRCodeSVG } from 'qrcode.react';

interface PropsWizardProps {
    user: any;
    onCancel: () => void;
    onComplete: (poolId: string) => void;
}

const STEPS = [
    { title: 'Game Selection', icon: '🏈' },
    { title: 'Branding', icon: '🎨' },
    { title: 'Details', icon: '📝' },
    { title: 'Props Setup', icon: '❓' },
    { title: 'Reminders', icon: '⏰' },
    { title: 'Final', icon: '🏁' },
];

export const PropsWizard: React.FC<PropsWizardProps> = ({ user, onCancel, onComplete }) => {
    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-400">
                <AlertTriangle size={48} className="text-amber-500 mb-4" />
                <h2 className="text-xl font-bold text-white mb-2">Login Required</h2>
                <p>You must be signed in to create a pool.</p>
                <div className="mt-6 flex gap-4">
                    <button onClick={onCancel} className="px-6 py-2 rounded-lg font-bold text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
                    {/* Parent should handle login modal open via Header or similar if we could callback, but for now just block */}
                </div>
            </div>
        );
    }
    const [step, setStep] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showQRCode, setShowQRCode] = useState(false); // For Final Step

    // Initial State Template
    const [config, setConfig] = useState<Partial<PropsPool>>({
        type: 'PROPS',
        ownerId: user.uid,
        name: '',
        managerName: user.displayName || '',
        contactEmail: user.email || '',
        isPublic: true, // Default to true for visibility
        urlSlug: '',
        reminders: {
            payment: { enabled: false, graceMinutes: 60, repeatEveryHours: 24, notifyUsers: false },
            lock: { enabled: true, scheduleMinutes: [60, 30, 15], lockAt: Date.now() + 86400000 },
            winner: { enabled: true, channels: ['email'], includeDigits: true, includeCharityImpact: true }
        },
        branding: {
            backgroundColor: '#0f172a'
        },
        props: {
            enabled: true,
            cost: 10,
            maxCards: 1,
            questions: [],
            payouts: [100] // Default winner take all
        },
        paymentHandles: {
            venmo: '',
            cashapp: '',
            paypal: '',
            googlePay: ''
        },
        paymentInstructions: '',
        // Defaults for new fields
        collectPhone: false,
        collectAddress: false,
        collectReferral: false,
        emailConfirmation: 'No Email Confirmation',
        notifyAdminFull: false
    });

    const updateConfig = (updates: Partial<PropsPool>) => {
        setConfig(prev => ({ ...prev, ...updates }));
    };

    const handleNext = () => {
        // Auto-set default lock time when moving from Game Selection
        if (step === 0 && config.gameTime) {
            // Check if we haven't already customized it (hacky but safer defaults)
            // Or just enforce "Kickoff" as default initial
            setConfig(prev => ({
                ...prev,
                reminders: {
                    ...prev.reminders!,
                    lock: {
                        ...prev.reminders!.lock,
                        enabled: true,
                        lockAt: config.gameTime
                    }
                }
            }));
        }
        setStep(s => Math.min(s + 1, STEPS.length - 1));
    };
    const handleBack = () => setStep(s => Math.max(s - 1, 0));

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);

        try {
            if (!config.name || !config.gameId) {
                // Warning removed to allow manual entry without gameId if desired, 
                // but for now gameId is technically required only if we assume auto-scoring.
                // We'll trust the validation in WizardStepGame which disables Next without name/lockDate.
            }

            // Create Payload
            const payload: any = {
                ...config,
                createdAt: Date.now(),
                isLocked: false,
                status: 'active',
                ownerId: user.uid,
                type: 'PROPS',
                // Shims for backend validation (it expects Squares pool fields)
                costPerSquare: 0,
                maxSquaresPerPlayer: 0,
            };

            const newPoolId = await dbService.createPool(payload);

            // Redirect to the new pool page
            window.location.hash = `#pool/${payload.urlSlug || newPoolId}`;
            onComplete(newPoolId); // Ensure parent knows (optional if we redirect)

        } catch (err: any) {
            setError(err.message || 'Failed to create pool.');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col">
            <Header
                user={user}
                isManager={user?.role === 'POOL_MANAGER' || user?.role === 'SUPER_ADMIN'}
                onOpenAuth={() => { }}
                onLogout={() => { }}
                onCreatePool={() => { }} // No-op as we are already creating 
            />

            <main className="flex-grow p-4 md:p-8">
                <div className="max-w-4xl mx-auto">
                    {/* Wizard Navigation Header */}
                    <div className="flex items-center justify-between mb-8">
                        <button onClick={onCancel} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                            <ArrowLeft size={20} /> Cancel
                        </button>
                        <div className="flex items-center gap-2">
                            {STEPS.map((s, idx) => (
                                <div key={idx} className={`flex items-center gap-2 ${idx === step ? 'opacity-100' : 'opacity-40'}`}>
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${idx === step ? 'bg-indigo-600' : idx < step ? 'bg-emerald-600' : 'bg-slate-800'}`}>
                                        {idx < step ? <Check size={14} /> : idx + 1}
                                    </div>
                                    <span className={`text-sm font-bold hidden md:block ${idx === step ? 'text-white' : 'text-slate-500'}`}>{s.title}</span>
                                    {idx < STEPS.length - 1 && <div className="w-8 h-[1px] bg-slate-700 hidden md:block" />}
                                </div>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/50 rounded-lg flex items-center gap-3 text-rose-400">
                            <AlertTriangle size={20} />
                            {error}
                        </div>
                    )}

                    {/* Content */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 md:p-8 shadow-2xl">
                        {step === 0 && (
                            <WizardStepGame
                                gameState={config as unknown as GameState}
                                updateConfig={updateConfig as any}
                                onNext={handleNext}
                            />
                        )}

                        {step === 1 && (
                            <WizardStepBranding
                                gameState={config as unknown as GameState}
                                updateConfig={updateConfig as any}
                                onBack={handleBack}
                                onNext={handleNext}
                            />
                        )}

                        {step === 2 && (
                            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                                <div className="text-center mb-6">
                                    <h2 className="text-2xl font-bold text-white mb-2">Pool Details</h2>
                                    <p className="text-slate-400">Configure public visibility and payment options.</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Name</label>
                                        <input
                                            type="text"
                                            value={config.name}
                                            onChange={(e) => updateConfig({ name: e.target.value })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                            placeholder="e.g. Super Bowl 2025 Props"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Custom URL Slug (Optional)</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-3 text-slate-600 font-mono text-sm">/</span>
                                            <input
                                                type="text"
                                                value={config.urlSlug || ''}
                                                onChange={(e) => updateConfig({ urlSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                                                className="w-full bg-slate-900 border border-slate-700 rounded pl-6 pr-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                                placeholder="my-super-pool"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Manager Name</label>
                                        <input
                                            type="text"
                                            value={config.managerName || ''}
                                            onChange={(e) => updateConfig({ managerName: e.target.value })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                            placeholder="Your Name"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Contact Email</label>
                                        <input
                                            type="email"
                                            value={config.contactEmail || ''}
                                            onChange={(e) => updateConfig({ contactEmail: e.target.value })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                            placeholder="admin@example.com"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Venmo Handle (@username)</label>
                                        <input
                                            type="text"
                                            value={config.paymentHandles?.venmo || ''}
                                            onChange={(e) => updateConfig({ paymentHandles: { ...config.paymentHandles, venmo: e.target.value } })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                            placeholder="@YourVenmo"
                                        />
                                    </div>

                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Payment Instructions</label>
                                        <textarea
                                            value={config.paymentInstructions || ''}
                                            onChange={(e) => updateConfig({ paymentInstructions: e.target.value })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none h-24 resize-none"
                                            placeholder="Example: Please pay within 24 hours. Good luck!"
                                        />
                                    </div>

                                    <div className="md:col-span-2">
                                        <label className="flex items-center gap-3 cursor-pointer p-4 bg-slate-900 rounded-lg border border-slate-800 hover:border-indigo-500 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={config.isPublic}
                                                onChange={(e) => updateConfig({ isPublic: e.target.checked })}
                                                className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            <div>
                                                <span className="font-bold text-white block">List in Public Directory</span>
                                                <span className="text-xs text-slate-500">Allow anyone to find and join your pool from the "Public Pools" page.</span>
                                            </div>
                                        </label>
                                    </div>
                                </div>

                                <div className="flex justify-between pt-8 border-t border-slate-800 mt-8">
                                    <button onClick={handleBack} className="px-6 py-2 rounded-lg font-bold text-slate-400 hover:bg-slate-800 transition-colors">Back</button>
                                    <button onClick={handleNext} disabled={!config.name} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-all hover:scale-105">
                                        Next: Props Setup
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 3 && (
                            /* Adapting PropsManager to be used as a setup step */
                            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                                <div className="text-center mb-6">
                                    <h2 className="text-2xl font-bold text-white mb-2">Configure Props Game</h2>
                                    <p className="text-slate-400">Set the entry fee, payouts, and questions.</p>
                                </div>

                                {/* Basic Settings */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Entry Fee ($)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={config.props?.cost}
                                            onChange={(e) => updateConfig({ props: { ...config.props!, cost: Number(e.target.value) } })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 font-mono font-bold text-emerald-400 focus:border-indigo-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Max Cards Per Player</label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={config.props?.maxCards}
                                            onChange={(e) => updateConfig({ props: { ...config.props!, maxCards: Number(e.target.value) } })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 font-bold text-white focus:border-indigo-500 outline-none"
                                        />
                                    </div>
                                </div>

                                {/* Payout Structure */}
                                <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                                    <h4 className="font-bold text-white mb-4 flex items-center justify-between">
                                        <span>Payout Structure (Percentages)</span>
                                        <span className={`text-sm ${(config.props?.payouts?.reduce((a, b) => a + b, 0) || 0) === 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                            Total: {config.props?.payouts?.reduce((a, b) => a + b, 0)}%
                                        </span>
                                    </h4>

                                    <div className="space-y-3">
                                        {config.props?.payouts?.map((p, idx) => (
                                            <div key={idx} className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-400 text-sm">
                                                    {idx + 1}
                                                </div>
                                                <div className="flex-grow relative">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="100"
                                                        value={p}
                                                        onChange={(e) => {
                                                            const newPayouts = [...(config.props?.payouts || [])];
                                                            newPayouts[idx] = Number(e.target.value);
                                                            updateConfig({ props: { ...config.props!, payouts: newPayouts } });
                                                        }}
                                                        className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white pr-8 focus:border-indigo-500 outline-none"
                                                    />
                                                    <span className="absolute right-3 top-2 text-slate-500">%</span>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const newPayouts = config.props?.payouts?.filter((_, i) => i !== idx);
                                                        updateConfig({ props: { ...config.props!, payouts: newPayouts } });
                                                    }}
                                                    className="p-2 text-slate-500 hover:text-rose-400 transition-colors"
                                                    disabled={(config.props?.payouts?.length || 0) <= 1}
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        ))}

                                        <button
                                            onClick={() => {
                                                const currentTotal = config.props?.payouts?.reduce((a, b) => a + b, 0) || 0;
                                                if (currentTotal < 100) {
                                                    updateConfig({ props: { ...config.props!, payouts: [...(config.props?.payouts || []), 100 - currentTotal] } });
                                                }
                                            }}
                                            className="w-full py-2 border border-dashed border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 transition-colors flex items-center justify-center gap-2 text-sm"
                                        >
                                            <Plus size={16} /> Add Place
                                        </button>
                                    </div>
                                </div>

                                <hr className="border-slate-800 my-6" />

                                <PropsManager
                                    gameState={config as unknown as PropsPool}
                                    updateConfig={updateConfig as any}
                                    isWizardMode={true}
                                />

                                <div className="flex justify-between pt-8 border-t border-slate-800 mt-8">
                                    <button onClick={handleBack} className="px-6 py-2 rounded-lg font-bold text-slate-400 hover:bg-slate-800 transition-colors">Back</button>
                                    <button onClick={handleNext} className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-all hover:scale-105">
                                        Next: Reminders
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 4 && (
                            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                                <WizardStepReminders
                                    gameState={config as unknown as GameState}
                                    updateConfig={updateConfig as any}
                                    onNext={handleNext}
                                    isProps={true}
                                />
                                <div className="flex justify-between pt-8 border-t border-slate-800 mt-8">
                                    <button onClick={handleBack} className="px-6 py-2 rounded-lg font-bold text-slate-400 hover:bg-slate-800 transition-colors">Back</button>
                                    <button onClick={handleNext} className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-all hover:scale-105">
                                        Next: Final Preferences
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 5 && (
                            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                                <div className="text-center mb-6">
                                    <h2 className="text-2xl font-bold text-white mb-2">Final Preferences</h2>
                                    <p className="text-slate-400">Customize data collection, notifications, and access.</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Player Data */}
                                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                                        <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Users size={16} className="text-indigo-400" /> Player Data Collection</h4>
                                        <div className="space-y-3">
                                            {['collectPhone', 'collectAddress', 'collectReferral', 'collectNotes'].map((field) => (
                                                <label key={field} className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-800 rounded">
                                                    <span className="text-sm text-slate-300 capitalize">{field.replace('collect', '').replace(/([A-Z])/g, ' $1').trim()} ({field === 'collectNotes' ? 'Notes' : 'Required'})</span>
                                                    <input type="checkbox" checked={(config as any)[field]} onChange={(e) => updateConfig({ [field]: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500" />
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Email Notifications */}
                                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                                        <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Mail size={16} className="text-sky-400" /> Notifications</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs text-slate-500 uppercase font-bold mb-1">User Confirmation Email</label>
                                                <select
                                                    value={config.emailConfirmation}
                                                    onChange={(e) => updateConfig({ emailConfirmation: e.target.value })}
                                                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-indigo-500"
                                                >
                                                    <option value="No Email Confirmation">Don't Send</option>
                                                    <option value="Email Confirmation">Send Email Receipt</option>
                                                </select>
                                            </div>

                                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-800 rounded border-t border-slate-800 pt-3">
                                                <span className="text-sm text-slate-300">Alert Admin when Pool Full/Active</span>
                                                <input type="checkbox" checked={config.notifyAdminFull} onChange={(e) => updateConfig({ notifyAdminFull: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500" />
                                            </label>
                                        </div>
                                    </div>

                                    {/* Access Control */}
                                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                                        <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Lock size={16} className="text-amber-400" /> Access Control</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Entry Password</label>
                                                <input type="text" value={config.gridPassword || ''} onChange={(e) => updateConfig({ gridPassword: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none" placeholder="Optional" />
                                            </div>
                                        </div>
                                    </div>

                                    {/* QR Code Sharing */}
                                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                                        <h4 className="font-bold text-white mb-4 flex items-center gap-2"><QrCode size={16} className="text-emerald-400" /> Share via QR Code</h4>
                                        <div className="text-center">
                                            <button
                                                onClick={() => setShowQRCode(!showQRCode)}
                                                className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2 mx-auto"
                                            >
                                                <QrCode size={16} />
                                                {showQRCode ? 'Hide QR Code' : 'Generate QR Code'}
                                            </button>
                                            {showQRCode && (
                                                <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                                                    <div className="bg-white p-4 rounded-xl inline-block">
                                                        <QRCodeSVG
                                                            id="pool-qr-code"
                                                            value={`${window.location.origin}/#pool/${config.urlSlug || 'new-pool'}`}
                                                            size={150}
                                                            level="H"
                                                            includeMargin
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-between pt-8 border-t border-slate-800 mt-8">
                                    <button onClick={handleBack} className="px-6 py-2 rounded-lg font-bold text-slate-400 hover:bg-slate-800 transition-colors">Back</button>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={isSubmitting}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 flex items-center gap-2"
                                    >
                                        {isSubmitting ? <Loader className="animate-spin" /> : <Check />}
                                        Create Pool
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
};
