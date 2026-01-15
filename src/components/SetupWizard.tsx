import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WizardStepGame } from './WizardStepGame';
import { WizardStepSquaresDetails } from './WizardStepSquaresDetails';
import { WizardStepBranding } from './WizardStepBranding';
import { WizardStepReminders } from './WizardStepReminders';
import { ArrowLeft, Check } from 'lucide-react';
import { dbService } from '../services/dbService';
import type { GameState, User } from '../types';

interface SetupWizardProps {
    user: User;
    onComplete: () => void;
    onBack: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ user, onComplete, onBack }) => {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [isCreating, setIsCreating] = useState(false);

    // Initial Draft State
    const [gameState, setGameState] = useState<Partial<GameState>>({
        name: '',
        ownerId: user.id,
        type: 'SQUARES',
        costPerSquare: 10,
        maxSquaresPerPlayer: 100, // Default unlimited
        payouts: { q1: 10, half: 20, q3: 10, final: 60 },
        ruleVariations: {
            quarterlyRollover: false,
            reverseWinners: false,
            scoreChangePayout: false,
            unclaimedFinalPrizeStrategy: 'random',
        },
        charity: { enabled: false, name: '', percentage: 0 },
        branding: { backgroundColor: '#020617' },
        emailConfirmation: 'false',
        paymentHandles: {},
        paymentInstructions: '',
        waitlist: []
    });

    const updateConfig = (updates: Partial<GameState>) => {
        setGameState(prev => ({ ...prev, ...updates }));
    };

    const handleCreate = async () => {
        setIsCreating(true);
        try {
            // Create the pool
            const newPool = {
                ...gameState,
                ownerId: user.id, // Ensure owner
                members: [user.id],
                createdAt: Date.now(),
                squares: Array(100).fill(null).map((_, i) => ({ id: i, owner: null })),
                scores: { q1: {}, half: {}, q3: {}, final: {}, current: { home: 0, away: 0 } } // Init scores
            };

            // We need to use dbService to create
            const poolId = await dbService.createPool(newPool as any); // Cast as any if partial mismatch types

            // Navigate to the new pool
            navigate(`/pool/${poolId}`);
            onComplete();
        } catch (error) {
            console.error("Failed to create pool", error);
            alert("Failed to create pool. Please try again.");
            setIsCreating(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center py-10 px-4">
            <div className="max-w-3xl w-full">
                <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-white mb-6 transition-colors font-bold text-sm">
                    <ArrowLeft size={16} /> Back to Selection
                </button>

                <div className="mb-8">
                    <div className="flex items-center gap-4 mb-2">
                        {[1, 2, 3, 4].map(s => (
                            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${step >= s ? 'bg-indigo-500' : 'bg-slate-800'}`}></div>
                        ))}
                    </div>
                    <h1 className="text-2xl font-bold text-white transition-all">
                        {step === 1 && 'Game Selection'}
                        {step === 2 && 'Grid Settings'}
                        {step === 3 && 'Branding'}
                        {step === 4 && 'Review & Payment'}
                    </h1>
                </div>

                {step === 1 && (
                    <WizardStepGame
                        gameState={gameState as GameState}
                        updateConfig={updateConfig}
                        onNext={() => setStep(2)}
                    />
                )}

                {step === 2 && (
                    <WizardStepSquaresDetails
                        gameState={gameState as GameState}
                        updateConfig={updateConfig}
                        onNext={() => setStep(3)}
                        onBack={() => setStep(1)}
                    />
                )}

                {step === 3 && (
                    <WizardStepBranding
                        gameState={gameState as GameState}
                        updateConfig={updateConfig}
                        onNext={() => setStep(4)}
                        onBack={() => setStep(2)}
                    />
                )}

                {step === 4 && (
                    <div className="space-y-6 animate-in slide-in-from-right duration-300">
                        <WizardStepReminders
                            gameState={gameState as GameState}
                            updateConfig={updateConfig}
                            onNext={() => { }}
                        />

                        <div className="flex justify-between pt-6 border-t border-slate-800">
                            <button onClick={() => setStep(3)} className="text-slate-400 hover:text-white font-bold text-sm">Back</button>
                            <button
                                onClick={handleCreate}
                                disabled={isCreating}
                                className="bg-emerald-500 hover:bg-emerald-400 text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all hover:scale-105 disabled:opacity-50 disabled:scale-100"
                            >
                                {isCreating ? 'Creating...' : <>Launch Pool <Check size={20} strokeWidth={3} /></>}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
