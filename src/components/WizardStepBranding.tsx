import React from 'react';
import type { GameState } from '../types';
import { Sparkles, Trash2, Settings } from 'lucide-react';
import { useToast } from './ui/Toast';
import { Button } from './ui';
// PLAN-HELP-SYSTEM T5. Direct, not through the `ui` barrel — the barrel does
// not export it (see `ui/Field.tsx`, which imports it the same way).
import { HelpTip } from './ui/HelpTip';
import { resolveLogoUrl } from '../utils/logoUrl';

interface WizardStepBrandingProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    onBack: () => void;
    onNext: () => void;
}

export const WizardStepBranding: React.FC<WizardStepBrandingProps> = ({ gameState, updateConfig, onBack, onNext }) => {
    const toast = useToast();

    // Simplified Theme Logic vs AdminPanel
    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) {
                toast.error("File too large. Max 2MB.");
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
        <div className="space-y-6 animate-in slide-in-from-right duration-200">
            <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Customization</h3>
                <p className="text-muted font-body text-sm mb-6">Make the pool your own.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Logo Upload */}
                    <div className="bg-surface p-6 rounded-xl border border-line">
                        <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4 flex items-center gap-2">
                            <Sparkles size={16} className="text-gold-500" /> Pool Logo
                        </h4>

                        <div className="flex flex-col items-center gap-4">
                            {gameState.branding?.logoUrl ? (
                                <div className="relative group">
                                    <div className="w-32 h-32 bg-card rounded-lg flex items-center justify-center border border-line p-2">
                                        <img src={resolveLogoUrl(gameState.branding.logoUrl)} className="max-w-full max-h-full object-contain" alt="Pool Logo" />
                                    </div>
                                    <button
                                        onClick={() => updateConfig({ branding: { ...gameState.branding, logoUrl: undefined } })}
                                        className="absolute -top-2 -right-2 bg-brandred-600 text-white p-1 rounded-full shadow-lg hover:bg-brandred-500 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div className="w-32 h-32 bg-page rounded-lg border-2 border-dashed border-line flex flex-col items-center justify-center text-faint gap-2">
                                    <div className="p-2 bg-card rounded-full"><Sparkles size={20} /></div>
                                    <span className="text-xs font-body">No Logo</span>
                                </div>
                            )}

                            <div className="w-full">
                                <label className="block text-center cursor-pointer bg-navy-800 hover:bg-navy-700 text-white font-display font-bold uppercase tracking-[0.05em] py-2 px-4 rounded-lg transition-colors duration-150 text-sm">
                                    Upload Logo (Max 2MB)
                                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                                </label>
                                <p className="text-[10px] text-faint font-body text-center mt-2">Recommended: Square PNG with transparent background.</p>
                            </div>
                        </div>
                    </div>

                    {/* Background Color */}
                    <div className="bg-surface p-6 rounded-xl border border-line">
                        {/* PLAN-HELP-SYSTEM T5: the `?` for `branding.backgroundColor`.
                            On the HEADING, not on a `FieldLabel`, because this control
                            is a bare `<input type="color">` under an `<h4>` — there is
                            no label component here to hang it off. The heading already
                            carries `text-[color:var(--text)]`, which is what the tip
                            inherits (`HelpTip` is `text-current`). */}
                        <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-4 flex items-center gap-2">
                            <Settings size={16} className="text-gold-500" /> Background color
                            <HelpTip helpId="branding.backgroundColor" />
                        </h4>
                        <div className="flex items-center gap-4">
                            <input
                                type="color"
                                value={gameState.branding?.backgroundColor || '#0f172a'}
                                onChange={(e) => updateConfig({ branding: { ...gameState.branding, backgroundColor: e.target.value } })}
                                className="w-16 h-16 rounded cursor-pointer border-none p-0 bg-transparent"
                            />
                            <div className="flex-1">
                                <div className="font-mono text-[color:var(--text)] mb-1">{gameState.branding?.backgroundColor || '#0f172a'}</div>
                                <button
                                    onClick={() => updateConfig({ branding: { ...gameState.branding, backgroundColor: '#0f172a' } })}
                                    className="text-xs text-muted hover:text-[color:var(--text)] underline"
                                >
                                    Reset to Default
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-between pt-8 border-t border-line mt-8">
                    <Button variant="ghost" size="sm" onClick={onBack}>Back</Button>
                    <Button variant="primary" onClick={onNext}>
                        Next: Review & Payment
                    </Button>
                </div>
            </div>
        </div>
    );
};
