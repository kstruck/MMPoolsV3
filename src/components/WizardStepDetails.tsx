import React from 'react';
import { User, Wallet, Globe, Mail, FileText } from 'lucide-react';
import type { GameState } from '../types';
import { DebouncedInput, DebouncedTextarea } from './admin/DebouncedInputs';

interface WizardStepDetailsProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    onNext: () => void;
    onBack: () => void;
}

export const WizardStepDetails: React.FC<WizardStepDetailsProps> = ({ gameState, updateConfig, onNext, onBack }) => {

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2">Pool Details</h3>
                <p className="text-slate-400 text-sm mb-6">Who is running this pool and how should they pay?</p>

                {/* VISIBILITY */}
                <div className="mb-6 bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${gameState.isPublic ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
                            <Globe size={24} />
                        </div>
                        <div>
                            <h4 className={`font-bold ${gameState.isPublic ? 'text-white' : 'text-slate-400'}`}>Public Visibility</h4>
                            <p className="text-xs text-slate-500">
                                {gameState.isPublic
                                    ? "Listed in 'Browse Pools' directory."
                                    : "Only accessible via direct link."}
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
                    {/* BASIC INFO */}
                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Name</label>
                        <DebouncedInput
                            value={gameState.name}
                            onChange={(val) => updateConfig({ name: val })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none font-bold"
                            placeholder="e.g. Super Bowl Squares 2024"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Manager Name</label>
                        <div className="relative">
                            <User className="absolute left-3 top-3 text-slate-500" size={18} />
                            <DebouncedInput
                                value={gameState.managerName || ''}
                                onChange={(val) => updateConfig({ managerName: val })}
                                className="w-full bg-slate-950 border border-slate-700 rounded pl-10 pr-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                placeholder="Your Name"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Contact Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-3 text-slate-500" size={18} />
                            <DebouncedInput
                                value={gameState.contactEmail}
                                onChange={(val) => updateConfig({ contactEmail: val })}
                                className="w-full bg-slate-950 border border-slate-700 rounded pl-10 pr-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                placeholder="admin@example.com"
                            />
                        </div>
                    </div>

                    {/* PAYMENT HANDLES */}
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Venmo Handle</label>
                        <div className="relative">
                            <span className="absolute left-3 top-3 text-sky-500 font-bold text-sm">V</span>
                            <DebouncedInput
                                value={gameState.paymentHandles?.venmo || ''}
                                onChange={(val) => updateConfig({ paymentHandles: { ...gameState.paymentHandles, venmo: val } })}
                                className="w-full bg-slate-950 border border-slate-700 rounded pl-10 pr-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                placeholder="@YourUsername"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Zelle / CashApp</label>
                        <div className="relative">
                            <Wallet className="absolute left-3 top-3 text-slate-500" size={18} />
                            <DebouncedInput
                                value={gameState.paymentHandles?.zelle || ''}
                                onChange={(val) => updateConfig({ paymentHandles: { ...gameState.paymentHandles, zelle: val } })}
                                className="w-full bg-slate-950 border border-slate-700 rounded pl-10 pr-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                placeholder="Phone or $Cashtag"
                            />
                        </div>
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Payment Instructions</label>
                        <div className="relative">
                            <FileText className="absolute left-3 top-3 text-slate-500" size={18} />
                            <DebouncedTextarea
                                value={gameState.paymentInstructions}
                                onChange={(val) => updateConfig({ paymentInstructions: val })}
                                className="w-full bg-slate-950 border border-slate-700 rounded pl-10 pr-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none h-24 resize-none"
                                placeholder="e.g. Please put your square coordinates in the payment note!"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-between pt-6 border-t border-slate-800 mt-6">
                    <button onClick={onBack} className="text-slate-400 hover:text-white font-bold text-sm">Back</button>
                    <button
                        onClick={onNext}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-all hover:scale-105"
                    >
                        Next: Grid Settings
                    </button>
                </div>
            </div>
        </div>
    );
};
