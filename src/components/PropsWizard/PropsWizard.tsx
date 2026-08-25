import React, { useState } from 'react';
import { WizardStepGame } from '../WizardStepGame';
import { WizardStepBranding } from '../WizardStepBranding';
import { WizardStepReminders } from '../WizardStepReminders';
import { PropsManager } from '../Props/PropsManager';
import { dbService } from '../../services/dbService';
import { Loader, ArrowLeft, Check, AlertTriangle, Mail, Lock, Users, QrCode, Plus, Trash2, Sparkles, ShieldCheck } from 'lucide-react';
import type { GameState, PropsPool } from '../../types';
import { QRCodeSVG } from 'qrcode.react';
import { BillingInvoiceCard } from '../billing/BillingInvoiceCard';
import { Button } from '../ui';

interface PropsWizardProps {
    user: any;
    onCancel: () => void;
    onComplete: (poolId: string) => void;
    initialData?: PropsPool;
    embedded?: boolean;
}

const STEPS = [
    { title: 'Game Selection' },
    { title: 'Branding' },
    { title: 'Details' },
    { title: 'Props Setup' },
    { title: 'Reminders' },
    { title: 'Final' },
];

const CONTROL =
    'w-full rounded-md border-[1.5px] border-line bg-page px-4 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint focus:border-navy-600 focus:bg-surface focus:outline-none transition-colors';
const LABEL =
    'block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted mb-1';

export const PropsWizard: React.FC<PropsWizardProps> = ({ user, onCancel, onComplete, initialData, embedded }) => {
    // All hooks must run unconditionally (rules-of-hooks). The login guard is
    // applied AFTER the hooks below — never as an early return before them.
    const [step, setStep] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showQRCode, setShowQRCode] = useState(false); // For Final Step
    const [tosAccepted, setTosAccepted] = useState(false);

    // Premium Features States
    const [hasCustomBranding, setHasCustomBranding] = useState(true);
    const [hasAiCommissioner, setHasAiCommissioner] = useState(false);

    // Initial State Template
    const [config, setConfig] = useState<Partial<PropsPool>>(() => {
        if (initialData) {
            return { ...initialData };
        }
        return {
            type: 'PROPS',
            ownerId: user?.uid,
            name: '',
            managerName: user?.displayName || '',
            contactEmail: user?.email || '',
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
        };
    });

    // Login guard — after all hooks so hook order stays stable across renders.
    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-muted font-body">
                <AlertTriangle size={48} className="text-gold-500 mb-4" />
                <h2 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Login Required</h2>
                <p>You must be signed in to create a pool.</p>
                <div className="mt-6 flex gap-4">
                    <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                </div>
            </div>
        );
    }

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
            if (initialData && initialData.id) {
                // UPDATE MODE
                await dbService.updatePool(initialData.id, config as any);
                onComplete(initialData.id);
            } else {
                // CREATE MODE
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
                    // Billing injection — single-event pool, 14-day trial
                    billing: {
                        status: 'trial',
                        tier: 'free_tier',
                        pricePaid: 0,
                        trialEndsAt: Date.now() + (14 * 24 * 60 * 60 * 1000),
                        maxPlayersAllowed: 10,
                        featuresUnlocked: {
                            whatIfSimulator: false,
                            customBranding: hasCustomBranding,
                            aiCommissioner: hasAiCommissioner
                        },
                        couponCode: (config as any).billing?.couponCode || undefined
                    },
                };

                const newPoolId = await dbService.createPool(payload);

                // Redirect to the new pool page
                window.location.href = `/pool/${payload.urlSlug || newPoolId}`;
                onComplete(newPoolId);
            }

        } catch (err: any) {
            setError(err.message || 'Failed to save pool.');
            setIsSubmitting(false);
        }
    };

    return (
        <div className={`min-h-screen bg-page text-[color:var(--text)] font-body flex flex-col ${embedded ? 'min-h-0 bg-transparent' : ''}`}>
            {/* Header handled by Layout */}

            <main className={`flex-grow ${embedded ? 'p-0' : 'p-4 md:p-8'}`}>
                <div className="max-w-4xl mx-auto">
                    {/* Wizard Navigation Header */}
                    <div className="flex items-center justify-between mb-8">
                        <button onClick={onCancel} className="flex items-center gap-2 text-muted hover:text-[color:var(--text)] transition-colors duration-150">
                            <ArrowLeft size={20} /> Cancel
                        </button>
                        <div className="flex items-center gap-2">
                            {STEPS.map((s, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setStep(idx)}
                                    className={`flex items-center gap-2 transition-all hover:opacity-100 ${idx === step ? 'opacity-100' : 'opacity-40 cursor-pointer'}`}
                                >
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-sm num transition-colors duration-150 ${idx === step ? 'bg-navy-800 text-white dark:bg-gold-500 dark:text-navy-900' : idx < step ? 'bg-gold-foil text-navy-900' : 'bg-surface border border-line text-muted'}`}>
                                        {idx < step ? <Check size={14} /> : idx + 1}
                                    </div>
                                    <span className={`text-sm font-display font-bold uppercase tracking-[0.05em] hidden md:block transition-colors duration-150 ${idx === step ? 'text-[color:var(--text)]' : 'text-faint'}`}>{s.title}</span>
                                    {idx < STEPS.length - 1 && <div className="w-8 h-[1px] bg-line hidden md:block" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-brandred-600/10 border border-brandred-600/40 rounded-lg flex items-center gap-3 text-brandred-600">
                            <AlertTriangle size={20} />
                            {error}
                        </div>
                    )}

                    {/* Content */}
                    <div className="bg-card border border-line rounded-xl p-6 md:p-8 shadow-card">
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
                                    <h2 className="text-2xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Pool Details</h2>
                                    <p className="text-muted">Configure public visibility and payment options.</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="md:col-span-2">
                                        <label className={LABEL}>Pool Name</label>
                                        <input
                                            type="text"
                                            value={config.name}
                                            onChange={(e) => updateConfig({ name: e.target.value })}
                                            className={CONTROL}
                                            placeholder="e.g. Super Bowl 2025 Props"
                                        />
                                    </div>

                                    <div>
                                        <label className={LABEL}>Custom URL Slug (Optional)</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-3 text-faint font-body text-sm">/</span>
                                            <input
                                                type="text"
                                                value={config.urlSlug || ''}
                                                onChange={(e) => updateConfig({ urlSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                                                className={`${CONTROL} pl-6`}
                                                placeholder="my-super-pool"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className={LABEL}>Pool Manager Name</label>
                                        <input
                                            type="text"
                                            value={config.managerName || ''}
                                            onChange={(e) => updateConfig({ managerName: e.target.value })}
                                            className={CONTROL}
                                            placeholder="Your Name"
                                        />
                                    </div>

                                    <div>
                                        <label className={LABEL}>Contact Email</label>
                                        <input
                                            type="email"
                                            value={config.contactEmail || ''}
                                            onChange={(e) => updateConfig({ contactEmail: e.target.value })}
                                            className={CONTROL}
                                            placeholder="admin@example.com"
                                        />
                                    </div>

                                    <div>
                                        <label className={LABEL}>Venmo Handle (@username)</label>
                                        <input
                                            type="text"
                                            value={config.paymentHandles?.venmo || ''}
                                            onChange={(e) => updateConfig({ paymentHandles: { ...config.paymentHandles, venmo: e.target.value } })}
                                            className={CONTROL}
                                            placeholder="@YourVenmo"
                                        />
                                    </div>

                                    <div className="md:col-span-2">
                                        <label className={LABEL}>Payment Instructions</label>
                                        <textarea
                                            value={config.paymentInstructions || ''}
                                            onChange={(e) => updateConfig({ paymentInstructions: e.target.value })}
                                            className={`${CONTROL} h-24 resize-none`}
                                            placeholder="Example: Please pay within 24 hours. Good luck!"
                                        />
                                    </div>

                                    <div className="md:col-span-2">
                                        <label className="flex items-center gap-3 cursor-pointer p-4 bg-surface rounded-lg border border-line hover:border-navy-600 transition-colors duration-150">
                                            <input
                                                type="checkbox"
                                                checked={config.isPublic}
                                                onChange={(e) => updateConfig({ isPublic: e.target.checked })}
                                                className="w-5 h-5 rounded border-line bg-page text-navy-800 focus:ring-navy-600"
                                            />
                                            <div>
                                                <span className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] block">List in Public Directory</span>
                                                <span className="text-xs text-faint">Allow anyone to find and join your pool from the "Public Pools" page.</span>
                                            </div>
                                        </label>
                                    </div>
                                </div>

                                <div className="flex justify-between pt-8 border-t border-line mt-8">
                                    <Button variant="ghost" onClick={handleBack}>Back</Button>
                                    <Button onClick={handleNext} disabled={!config.name} className="px-8">
                                        Next: Props Setup
                                    </Button>
                                </div>
                            </div>
                        )}

                        {step === 3 && (
                            /* Adapting PropsManager to be used as a setup step */
                            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                                <div className="text-center mb-6">
                                    <h2 className="text-2xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Configure Props Game</h2>
                                    <p className="text-muted">Set the entry fee, payouts, and questions.</p>
                                </div>

                                {/* Basic Settings */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className={LABEL}>Entry Fee ($)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={config.props?.cost}
                                            onChange={(e) => updateConfig({ props: { ...config.props!, cost: Number(e.target.value) } })}
                                            className={`${CONTROL} num font-bold text-gold-600 dark:text-gold-400`}
                                        />
                                    </div>
                                    <div>
                                        <label className={LABEL}>Max Cards Per Player</label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={config.props?.maxCards}
                                            onChange={(e) => updateConfig({ props: { ...config.props!, maxCards: Number(e.target.value) } })}
                                            className={`${CONTROL} num font-bold`}
                                        />
                                    </div>
                                </div>

                                <div className="p-3.5 bg-gold-500/10 border border-gold-500/25 text-muted text-xs rounded-xl flex gap-2 items-start animate-in fade-in duration-300">
                                    <Sparkles size={16} className="text-gold-500 shrink-0 mt-0.5" />
                                    <div>
                                        <strong className="text-[color:var(--text)] block mb-0.5">Start Small, Upgrade Later!</strong>
                                        Not sure how many players will join? Choose a lower estimate to minimize upfront costs. You can instantly upgrade with one click later for only the pro-rated difference!
                                    </div>
                                </div>

                                {/* Payout Structure */}
                                <div className="bg-surface p-4 rounded-xl border border-line">
                                    <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4 flex items-center justify-between">
                                        <span>Payout Structure (Percentages)</span>
                                        <span className={`text-sm num ${(config.props?.payouts?.reduce((a, b) => a + b, 0) || 0) === 100 ? 'text-[#0F7B4A]' : 'text-gold-600 dark:text-gold-400'}`}>
                                            Total: {config.props?.payouts?.reduce((a, b) => a + b, 0)}%
                                        </span>
                                    </h4>

                                    <div className="space-y-3">
                                        {config.props?.payouts?.map((p, idx) => (
                                            <div key={idx} className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-page border border-line flex items-center justify-center font-display font-bold text-muted text-sm num">
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
                                                        className="w-full bg-page border-[1.5px] border-line rounded-md px-3 py-2 text-[color:var(--text)] num pr-8 focus:border-navy-600 outline-none"
                                                    />
                                                    <span className="absolute right-3 top-2 text-faint">%</span>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const newPayouts = config.props?.payouts?.filter((_, i) => i !== idx);
                                                        updateConfig({ props: { ...config.props!, payouts: newPayouts } });
                                                    }}
                                                    className="p-2 text-faint hover:text-brandred-600 transition-colors duration-150"
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
                                            className="w-full py-2 border border-dashed border-line rounded-lg text-muted hover:text-[color:var(--text)] hover:border-navy-600 transition-colors duration-150 flex items-center justify-center gap-2 text-sm"
                                        >
                                            <Plus size={16} /> Add Place
                                        </button>
                                    </div>
                                </div>

                                <hr className="border-line my-6" />

                                <PropsManager
                                    gameState={config as unknown as PropsPool}
                                    updateConfig={updateConfig as any}
                                    isWizardMode={true}
                                />

                                <div className="flex justify-between pt-8 border-t border-line mt-8">
                                    <Button variant="ghost" onClick={handleBack}>Back</Button>
                                    <Button onClick={handleNext} className="px-8">
                                        Next: Reminders
                                    </Button>
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
                                <div className="flex justify-between pt-8 border-t border-line mt-8">
                                    <Button variant="ghost" onClick={handleBack}>Back</Button>
                                    <Button onClick={handleNext} className="px-8">
                                        Next: Final Preferences
                                    </Button>
                                </div>
                            </div>
                        )}

                        {step === 5 && (
                            <div className="space-y-6 animate-in slide-in-from-right duration-300">
                                <div className="text-center mb-6">
                                    <h2 className="text-2xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Final Preferences</h2>
                                    <p className="text-muted">Customize data collection, notifications, and access.</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Player Data */}
                                    <div className="bg-surface p-4 rounded-xl border border-line">
                                        <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4 flex items-center gap-2"><Users size={16} className="text-navy-700 dark:text-gold-400" /> Player Data Collection</h4>
                                        <div className="space-y-3">
                                            {['collectPhone', 'collectAddress', 'collectReferral', 'collectNotes'].map((field) => (
                                                <label key={field} className="flex items-center justify-between cursor-pointer p-2 hover:bg-page rounded">
                                                    <span className="text-sm text-[color:var(--text)] capitalize">{field.replace('collect', '').replace(/([A-Z])/g, ' $1').trim()} ({field === 'collectNotes' ? 'Notes' : 'Required'})</span>
                                                    <input type="checkbox" checked={(config as any)[field]} onChange={(e) => updateConfig({ [field]: e.target.checked })} className="w-5 h-5 rounded border-line bg-page text-navy-800 focus:ring-navy-600" />
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Email Notifications */}
                                    <div className="bg-surface p-4 rounded-xl border border-line">
                                        <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4 flex items-center gap-2"><Mail size={16} className="text-navy-700 dark:text-gold-400" /> Notifications</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={LABEL}>User Confirmation Email</label>
                                                <select
                                                    value={config.emailConfirmation}
                                                    onChange={(e) => updateConfig({ emailConfirmation: e.target.value })}
                                                    className="w-full bg-page border-[1.5px] border-line rounded-md px-3 py-2 text-[color:var(--text)] text-sm outline-none focus:border-navy-600 cursor-pointer"
                                                >
                                                    <option value="No Email Confirmation">Don't Send</option>
                                                    <option value="Email Confirmation">Send Email Receipt</option>
                                                </select>
                                            </div>

                                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-page rounded border-t border-line pt-3">
                                                <span className="text-sm text-[color:var(--text)]">Alert Admin when Pool Full/Active</span>
                                                <input type="checkbox" checked={config.notifyAdminFull} onChange={(e) => updateConfig({ notifyAdminFull: e.target.checked })} className="w-5 h-5 rounded border-line bg-page text-navy-800 focus:ring-navy-600" />
                                            </label>
                                        </div>
                                    </div>

                                    {/* Access Control */}
                                    <div className="bg-surface p-4 rounded-xl border border-line">
                                        <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4 flex items-center gap-2"><Lock size={16} className="text-gold-500" /> Access Control</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={LABEL}>Entry Password</label>
                                                <input type="text" value={config.gridPassword || ''} onChange={(e) => updateConfig({ gridPassword: e.target.value })} className="w-full bg-page border-[1.5px] border-line rounded-md px-3 py-2 text-[color:var(--text)] placeholder:text-faint outline-none focus:border-navy-600" placeholder="Optional" />
                                            </div>
                                        </div>
                                    </div>

                                    {/* QR Code Sharing */}
                                    <div className="bg-surface p-4 rounded-xl border border-line">
                                        <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4 flex items-center gap-2"><QrCode size={16} className="text-gold-500" /> Share via QR Code</h4>
                                        <div className="text-center">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => setShowQRCode(!showQRCode)}
                                                className="mx-auto"
                                            >
                                                <QrCode size={16} />
                                                {showQRCode ? 'Hide QR Code' : 'Generate QR Code'}
                                            </Button>
                                            {showQRCode && (
                                                <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                                                    <div className="bg-white p-4 rounded-xl inline-block border border-line">
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

                                <div className="mt-6 font-body">
                                    <BillingInvoiceCard
                                        poolName={config.name || 'New Pool'}
                                        poolType="PROPS"
                                        estimatedPlayers={25}
                                        hasAiCommissioner={hasAiCommissioner}
                                        isWizard={true}
                                        onTosAcceptChange={setTosAccepted}
                                        onCouponAppliedChange={(couponCode) => {
                                            updateConfig({
                                                billing: {
                                                    ...((config as any).billing || {}),
                                                    couponCode: couponCode || undefined
                                                } as any
                                            });
                                        }}
                                        initialCouponCode={(config as any).billing?.couponCode || ''}
                                        onFeatureToggle={(featureKey, enabled) => {
                                            if (featureKey === 'customBranding') setHasCustomBranding(enabled);
                                            if (featureKey === 'aiCommissioner') setHasAiCommissioner(enabled);
                                        }}
                                    />

                                    <div className="mt-4 p-4 bg-surface border border-line rounded-2xl flex gap-3 items-start animate-in fade-in duration-300 text-muted text-xs">
                                        <ShieldCheck className="text-gold-500 shrink-0 mt-0.5" size={20} />
                                        <div>
                                            <strong className="text-[color:var(--text)] block mb-0.5">100% Free Trial Setup</strong>
                                            Set up rules, invite participants, and run your pool completely free for 14 days! Pay only when you are ready to upgrade.
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-between pt-8 border-t border-line mt-8">
                                    <Button variant="ghost" onClick={handleBack}>Back</Button>
                                    <Button
                                        onClick={handleSubmit}
                                        disabled={isSubmitting || !tosAccepted}
                                        className="px-8"
                                    >
                                        {isSubmitting ? <Loader className="animate-spin" /> : <Check />}
                                        {initialData ? 'Update Pool' : 'Create Pool'}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>
            {/* Footer handled by Layout */}
        </div>
    );
};
