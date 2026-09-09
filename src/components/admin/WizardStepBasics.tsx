import React, { useState } from 'react';
import { Globe } from 'lucide-react';
import type { GameState } from '../../types';
import { DebouncedInput, DebouncedTextarea } from './DebouncedInputs';

import { Switch } from '../ui/Switch';
interface WizardStepBasicsProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    checkSlugAvailable?: (slug: string) => boolean;
}

export const WizardStepBasics: React.FC<WizardStepBasicsProps> = ({
    gameState,
    updateConfig,
    checkSlugAvailable
}) => {
    const [slugError, setSlugError] = useState<string | null>(null);

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-200">
            <div className="bg-surface border border-line rounded-xl p-6">
                <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">Basic Information</h3>
                <p className="text-muted text-sm mb-6">Let's verify the core details of your pool.</p>

                {/* Public Visibility Toggle */}
                <div className="mb-6 bg-card border border-line rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${gameState.isPublic ? 'bg-gold-500/20 text-gold-700 dark:text-gold-400' : 'bg-card text-faint'}`}>
                            <Globe size={24} />
                        </div>
                        <div>
                            <h4 className={`font-display font-bold uppercase ${gameState.isPublic ? 'text-[color:var(--text)]' : 'text-muted'}`}>Public Visibility</h4>
                            <p className="text-xs text-faint">
                                {gameState.isPublic
                                    ? "Your pool is listed in the 'Browse Pools' directory."
                                    : "Only people with the link can access this pool."}
                            </p>
                        </div>
                    </div>
                    <Switch
                        checked={!!gameState.isPublic}
                        onChange={(isPublic) => updateConfig({ isPublic })}
                        label="Public visibility"
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-2">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Pool Name</label>
                        <DebouncedInput
                            value={gameState.name}
                            onChange={(val) => updateConfig({ name: val })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                            placeholder="Enter Pool Name"
                        />
                    </div>

                    <div>
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">URL Slug</label>
                        <div className="relative">
                            <span className="absolute left-3.5 top-3 text-faint font-mono text-sm num">/</span>
                            <DebouncedInput
                                value={gameState.urlSlug || ''}
                                onChange={(val) => {
                                    const safe = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
                                    if (checkSlugAvailable) {
                                        if (safe && !checkSlugAvailable(safe)) setSlugError("Slug is already taken");
                                        else setSlugError(null);
                                    }
                                    updateConfig({ urlSlug: safe });
                                }}
                                className={`w-full rounded-md border-[1.5px] ${slugError ? 'border-brandred-500 bg-[#FCEEED] dark:text-ink focus:border-brandred-500' : 'border-line bg-page focus:border-navy-600 focus:bg-surface'} pl-6 pr-4 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors outline-none`}
                                placeholder="unique-id"
                            />
                        </div>
                        {slugError && <p className="text-brandred-600 text-[13px] mt-1.5 font-body">{slugError}</p>}
                        <p className="text-faint text-[10px] mt-1">Lowercase letters, numbers, and dashes only.</p>
                    </div>

                    <div className="md:col-span-1">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Pool Manager Name</label>
                        <DebouncedInput
                            value={gameState.managerName || ''}
                            onChange={(val) => updateConfig({ managerName: val })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                            placeholder="Your Name"
                        />
                    </div>
                    <div className="md:col-span-1">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Contact Email</label>
                        <DebouncedInput
                            value={gameState.contactEmail}
                            onChange={(val) => updateConfig({ contactEmail: val })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                            placeholder="admin@example.com"
                        />
                    </div>
                    <div className="md:col-span-1">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Venmo Handle (@username)</label>
                        <DebouncedInput
                            value={gameState.paymentHandles?.venmo || ''}
                            onChange={(val) => updateConfig({ paymentHandles: { ...gameState.paymentHandles, venmo: val } })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                            placeholder="@YourVenmo"
                        />
                    </div>
                    <div className="md:col-span-1">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Zelle (@username/phone)</label>
                        <DebouncedInput
                            value={gameState.paymentHandles?.zelle || ''}
                            onChange={(val) => updateConfig({ paymentHandles: { ...gameState.paymentHandles, zelle: val } })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                            placeholder="Enter Zelle Info"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Payment Instructions</label>
                        <DebouncedTextarea
                            value={gameState.paymentInstructions}
                            onChange={(val) => updateConfig({ paymentInstructions: val })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none h-24 resize-none"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
