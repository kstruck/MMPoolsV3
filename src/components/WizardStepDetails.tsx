import React from 'react';
import { User, Wallet, Globe, Mail, FileText } from 'lucide-react';
import type { GameState } from '../types';
import { DebouncedInput, DebouncedTextarea } from './admin/DebouncedInputs';
import { Button, Toggle } from './ui';

interface WizardStepDetailsProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    onNext: () => void;
    onBack: () => void;
}

export const WizardStepDetails: React.FC<WizardStepDetailsProps> = ({ gameState, updateConfig, onNext, onBack }) => {

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Pool Details</h3>
                <p className="text-muted font-body text-sm mb-6">Who is running this pool and how should they pay?</p>

                {/* VISIBILITY */}
                <div className="mb-6 bg-surface border border-line rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${gameState.isPublic ? 'bg-navy-600/15 text-navy-600 dark:text-gold-400' : 'bg-card text-faint'}`}>
                            <Globe size={24} />
                        </div>
                        <div>
                            <h4 className={`font-display font-bold uppercase tracking-[0.05em] ${gameState.isPublic ? 'text-[color:var(--text)]' : 'text-muted'}`}>Public Visibility</h4>
                            <p className="text-xs font-body text-faint">
                                {gameState.isPublic
                                    ? "Listed in 'Browse Pools' directory."
                                    : "Only accessible via direct link."}
                            </p>
                        </div>
                    </div>
                    <Toggle
                        checked={!!gameState.isPublic}
                        onChange={(checked) => updateConfig({ isPublic: checked })}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* BASIC INFO */}
                    <div className="md:col-span-2">
                        <label className="block mb-1.5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Pool Name</label>
                        <DebouncedInput
                            value={gameState.name}
                            onChange={(val) => updateConfig({ name: val })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] font-bold text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                            placeholder="e.g. Super Bowl Squares 2024"
                        />
                    </div>

                    <div>
                        <label className="block mb-1.5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Manager Name</label>
                        <div className="relative">
                            <User className="absolute left-3 top-3 text-faint" size={18} />
                            <DebouncedInput
                                value={gameState.managerName || ''}
                                onChange={(val) => updateConfig({ managerName: val })}
                                className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                placeholder="Your Name"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block mb-1.5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Contact Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-3 text-faint" size={18} />
                            <DebouncedInput
                                value={gameState.contactEmail}
                                onChange={(val) => updateConfig({ contactEmail: val })}
                                className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                placeholder="admin@example.com"
                            />
                        </div>
                    </div>

                    {/* PAYMENT HANDLES */}
                    <div>
                        <label className="block mb-1.5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Venmo Handle</label>
                        <div className="relative">
                            <span className="absolute left-3 top-3 text-[#008CFF] font-bold text-sm">V</span>
                            <DebouncedInput
                                value={gameState.paymentHandles?.venmo || ''}
                                onChange={(val) => updateConfig({ paymentHandles: { ...gameState.paymentHandles, venmo: val } })}
                                className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                placeholder="@YourUsername"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block mb-1.5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Zelle / CashApp</label>
                        <div className="relative">
                            <Wallet className="absolute left-3 top-3 text-faint" size={18} />
                            <DebouncedInput
                                value={gameState.paymentHandles?.zelle || ''}
                                onChange={(val) => updateConfig({ paymentHandles: { ...gameState.paymentHandles, zelle: val } })}
                                className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                placeholder="Phone or $Cashtag"
                            />
                        </div>
                    </div>

                    <div className="md:col-span-2">
                        <label className="block mb-1.5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Payment Instructions</label>
                        <div className="relative">
                            <FileText className="absolute left-3 top-3 text-faint" size={18} />
                            <DebouncedTextarea
                                value={gameState.paymentInstructions}
                                onChange={(val) => updateConfig({ paymentInstructions: val })}
                                className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none h-24 resize-none"
                                placeholder="e.g. Please put your square coordinates in the payment note!"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-between pt-6 border-t border-line mt-6">
                    <Button variant="ghost" size="sm" onClick={onBack}>Back</Button>
                    <Button variant="primary" onClick={onNext}>
                        Next: Grid Settings
                    </Button>
                </div>
            </div>
        </div>
    );
};
