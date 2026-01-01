import React from 'react';
import type { GameState } from '../types';
import { Sparkles, Trash2, Settings } from 'lucide-react';

interface WizardStepBrandingProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    onBack: () => void;
    onNext: () => void;
}

export const WizardStepBranding: React.FC<WizardStepBrandingProps> = ({ gameState, updateConfig, onBack, onNext }) => {

    // Simplified Theme Logic vs AdminPanel
    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) {
                alert("File too large. Max 2MB.");
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                updateConfig({ branding: { ...gameState.branding, logoUrl: reader.result as string } });
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2">Customization</h3>
                <p className="text-slate-400 text-sm mb-6">Make the pool your own.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Logo Upload */}
                    <div className="bg-slate-950 p-6 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                            <Sparkles size={16} className="text-amber-400" /> Pool Logo
                        </h4>

                        <div className="flex flex-col items-center gap-4">
                            {gameState.branding?.logoUrl ? (
                                <div className="relative group">
                                    <div className="w-32 h-32 bg-slate-900 rounded-lg flex items-center justify-center border border-slate-600 p-2">
                                        <img src={gameState.branding.logoUrl} className="max-w-full max-h-full object-contain" alt="Pool Logo" />
                                    </div>
                                    <button
                                        onClick={() => updateConfig({ branding: { ...gameState.branding, logoUrl: undefined } })}
                                        className="absolute -top-2 -right-2 bg-rose-500 text-white p-1 rounded-full shadow-lg hover:bg-rose-600 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div className="w-32 h-32 bg-slate-900/50 rounded-lg border-2 border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 gap-2">
                                    <div className="p-2 bg-slate-800 rounded-full"><Sparkles size={20} /></div>
                                    <span className="text-xs">No Logo</span>
                                </div>
                            )}

                            <div className="w-full">
                                <label className="block text-center cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                                    Upload Logo (Max 2MB)
                                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                                </label>
                                <p className="text-[10px] text-slate-500 text-center mt-2">Recommended: Square PNG with transparent background.</p>
                            </div>
                        </div>
                    </div>

                    {/* Background Color */}
                    <div className="bg-slate-950 p-6 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                            <Settings size={16} className="text-emerald-400" /> Background color
                        </h4>
                        <div className="flex items-center gap-4">
                            <input
                                type="color"
                                value={gameState.branding?.backgroundColor || '#0f172a'}
                                onChange={(e) => updateConfig({ branding: { ...gameState.branding, backgroundColor: e.target.value } })}
                                className="w-16 h-16 rounded cursor-pointer border-none p-0 bg-transparent"
                            />
                            <div className="flex-1">
                                <div className="font-mono text-white mb-1">{gameState.branding?.backgroundColor || '#0f172a'}</div>
                                <button
                                    onClick={() => updateConfig({ branding: { ...gameState.branding, backgroundColor: '#0f172a' } })}
                                    className="text-xs text-slate-500 hover:text-white underline"
                                >
                                    Reset to Default
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-between pt-8 border-t border-slate-800 mt-8">
                    <button onClick={onBack} className="px-6 py-2 rounded-lg font-bold text-slate-400 hover:bg-slate-800 transition-colors">Back</button>
                    <button onClick={onNext} className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-all hover:scale-105">
                        Next: Props Setup
                    </button>
                </div>
            </div>
        </div>
    );
};
