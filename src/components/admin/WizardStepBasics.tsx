import React, { useState } from 'react';
import { Globe } from 'lucide-react';
import type { GameState } from '../../types';
import { DebouncedInput, DebouncedTextarea } from './DebouncedInputs';

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
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2">Basic Information</h3>
                <p className="text-slate-400 text-sm mb-6">Let's verify the core details of your pool.</p>

                {/* Public Visibility Toggle */}
                <div className="mb-6 bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${gameState.isPublic ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
                            <Globe size={24} />
                        </div>
                        <div>
                            <h4 className={`font-bold ${gameState.isPublic ? 'text-white' : 'text-slate-400'}`}>Public Visibility</h4>
                            <p className="text-xs text-slate-500">
                                {gameState.isPublic
                                    ? "Your pool is listed in the 'Browse Pools' directory."
                                    : "Only people with the link can access this pool."}
                            </p>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!!gameState.isPublic}
                            onChange={(e) => updateConfig({ isPublic: e.target.checked })}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Name</label>
                        <DebouncedInput
                            value={gameState.name}
                            onChange={(val) => updateConfig({ name: val })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                            placeholder="Enter Pool Name"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">URL Slug</label>
                        <div className="relative">
                            <span className="absolute left-3 top-3 text-slate-600 font-mono text-sm">/</span>
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
                                className={`w-full bg-slate-950 border ${slugError ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-700 focus:ring-indigo-500'} rounded pl-6 pr-4 py-3 text-white focus:ring-1 outline-none`}
                                placeholder="unique-id"
                            />
                        </div>
                        {slugError && <p className="text-rose-500 text-xs mt-1 font-bold">{slugError}</p>}
                        <p className="text-slate-500 text-[10px] mt-1">Lowercase letters, numbers, and dashes only.</p>
                    </div>

                    <div className="md:col-span-1">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Manager Name</label>
                        <DebouncedInput
                            value={gameState.managerName || ''}
                            onChange={(val) => updateConfig({ managerName: val })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                            placeholder="Your Name"
                        />
                    </div>
                    <div className="md:col-span-1">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Contact Email</label>
                        <DebouncedInput
                            value={gameState.contactEmail}
                            onChange={(val) => updateConfig({ contactEmail: val })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                            placeholder="admin@example.com"
                        />
                    </div>
                    <div className="md:col-span-1">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Venmo Handle (@username)</label>
                        <DebouncedInput
                            value={gameState.paymentHandles?.venmo || ''}
                            onChange={(val) => updateConfig({ paymentHandles: { ...gameState.paymentHandles, venmo: val } })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                            placeholder="@YourVenmo"
                        />
                    </div>
                    <div className="md:col-span-1">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Zelle (@username/phone)</label>
                        <DebouncedInput
                            value={gameState.paymentHandles?.zelle || ''}
                            onChange={(val) => updateConfig({ paymentHandles: { ...gameState.paymentHandles, zelle: val } })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                            placeholder="Enter Zelle Info"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Payment Instructions</label>
                        <DebouncedTextarea
                            value={gameState.paymentInstructions}
                            onChange={(val) => updateConfig({ paymentInstructions: val })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none h-24 resize-none"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
