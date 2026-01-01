import React, { useState } from 'react';
import { WizardStepGame } from '../WizardStepGame';
import { WizardStepBranding } from '../WizardStepBranding';
import { WizardStepReminders } from '../WizardStepReminders';
import { PropsManager } from '../Props/PropsManager';
import { dbService } from '../../services/dbService';
import { Loader, ArrowLeft, Check, AlertTriangle } from 'lucide-react';
import type { GameState, PropsPool } from '../../types';

interface PropsWizardProps {
    user: any;
    onCancel: () => void;
    onComplete: (poolId: string) => void;
}

const STEPS = [
    { title: 'Game Selection', icon: '🏈' },
    { title: 'Branding', icon: '🎨' },
    { title: 'Props Setup', icon: '❓' },
    { title: 'Reminders', icon: '⏰' },
];

export const PropsWizard: React.FC<PropsWizardProps> = ({ user, onCancel, onComplete }) => {
    const [step, setStep] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Initial State Template
    const [config, setConfig] = useState<Partial<PropsPool>>({
        type: 'PROPS',
        ownerId: user.uid,
        name: '',
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
        }
    });

    const updateConfig = (updates: Partial<PropsPool>) => {
        setConfig(prev => ({ ...prev, ...updates }));
    };

    const handleNext = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
    const handleBack = () => setStep(s => Math.max(s - 1, 0));

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);

        try {
            if (!config.name || !config.gameId) {
                throw new Error("Please select a game first.");
            }

            // Create Payload
            const payload: PropsPool = {
                ...config,
                createdAt: Date.now(),
                isLocked: false,
                status: 'active',
                ownerId: user.uid,
                type: 'PROPS'
            } as PropsPool;

            const newPoolId = await dbService.createPool(payload);
            onComplete(newPoolId);

        } catch (err: any) {
            setError(err.message || 'Failed to create pool.');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
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
                        /* Adapting PropsManager to be used as a setup step */
                        <div className="space-y-6">
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

                            <hr className="border-slate-800 my-6" />

                            <PropsManager
                                gameState={config as unknown as GameState}
                                updateConfig={updateConfig as any}
                                updateGameState={updateConfig as any}
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

                    {step === 3 && (
                        <div className="space-y-6">
                            <WizardStepReminders
                                gameState={config as unknown as GameState}
                                updateConfig={updateConfig as any}
                                onNext={() => { }} // We handle submit separately
                            />
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
        </div>
    );
};
