import React from 'react';
import { Users, Mail, Lock, Hammer, RefreshCw } from 'lucide-react';
import type { GameState } from '../../types';

interface WizardStepFinishProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    handleFixSync?: () => Promise<void>;
    isFixing?: boolean;
    setupMode?: boolean; // If true, hide Debug tools (for SetupWizard)
    currentUser?: { role?: string }; // For SuperAdmin check
}

export const WizardStepFinish: React.FC<WizardStepFinishProps> = ({
    gameState,
    updateConfig,
    handleFixSync,
    isFixing = false,
    setupMode = false,
    currentUser
}) => {
    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-surface border border-line rounded-xl p-6">
                <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">Final Preferences</h3>
                <p className="text-muted text-sm mb-6">Customize data collection, notifications, and advanced rules.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Player Data */}
                    <div className="bg-card p-4 rounded-xl border border-line">
                        <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2"><Users size={16} className="text-navy-600 dark:text-navy-500" /> Player Data Collection</h4>
                        <div className="space-y-3">
                            {(['collectPhone', 'collectAddress', 'collectReferral', 'collectNotes'] as const).map((field) => (
                                <label key={field} className="flex items-center justify-between cursor-pointer p-2 hover:bg-surface rounded">
                                    <span className="text-sm text-muted capitalize">{field.replace('collect', '').replace(/([A-Z])/g, ' $1').trim()}</span>
                                    <input type="checkbox" checked={!!gameState[field]} onChange={(e) => updateConfig({ [field]: e.target.checked })} className="size-5 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800 focus:ring-navy-600" />
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Email Notifications */}
                    <div className="bg-card p-4 rounded-xl border border-line">
                        <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2"><Mail size={16} className="text-navy-600 dark:text-navy-500" /> Email Notifications</h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">User Picks Confirmation</label>
                                <select
                                    value={gameState.emailConfirmation}
                                    onChange={(e) => updateConfig({ emailConfirmation: e.target.value })}
                                    className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2.5 font-body text-sm text-[color:var(--text)] cursor-pointer transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                >
                                    <option value="No Email Confirmation">Don't Send</option>
                                    <option value="Email Confirmation">Send Email Receipt</option>
                                </select>
                            </div>

                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-surface rounded">
                                <span className="text-sm text-muted">Email Players when Numbers Set</span>
                                <input type="checkbox" checked={gameState.emailNumbersGenerated} onChange={(e) => updateConfig({ emailNumbersGenerated: e.target.checked })} className="size-5 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800 focus:ring-navy-600" />
                            </label>

                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-surface rounded border-t border-line pt-3">
                                <span className="text-sm text-muted">Alert Admin when Grid Full</span>
                                <input type="checkbox" checked={gameState.notifyAdminFull} onChange={(e) => updateConfig({ notifyAdminFull: e.target.checked })} className="size-5 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800 focus:ring-navy-600" />
                            </label>
                        </div>
                    </div>

                    {/* Access Control */}
                    <div className="bg-card p-4 rounded-xl border border-line">
                        <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2"><Lock size={16} className="text-gold-700 dark:text-gold-400" /> Access Control</h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Grid Password</label>
                                <input type="text" value={gameState.gridPassword} onChange={(e) => updateConfig({ gridPassword: e.target.value })} className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none" placeholder="Optional" />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer pt-2">
                                <input type="checkbox" checked={gameState.isPublic} onChange={(e) => updateConfig({ isPublic: e.target.checked })} className="size-5 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800 focus:ring-navy-600" />
                                <span className="text-sm text-muted">List in Public Directory</span>
                            </label>
                        </div>
                    </div>

                    {/* Debug & Repair (SuperAdmin Only - Hidden in Setup) */}
                    {!setupMode && handleFixSync && isSuperAdmin && (
                        <div className="bg-card p-4 rounded-xl border border-line border-l-4 border-l-gold-500">
                            <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-3 text-sm flex items-center gap-2"><Hammer size={14} className="text-gold-700 dark:text-gold-400" /> Debug & Repair</h4>
                            <p className="text-xs text-faint mb-4">Advanced tools to fix stuck states or missing scores.</p>

                            <button
                                onClick={handleFixSync}
                                disabled={isFixing}
                                className="w-full bg-navy-800 hover:bg-navy-700 text-white py-2 px-4 rounded-md font-display font-bold uppercase text-xs tracking-[0.05em] transition-all duration-150 hover:-translate-y-px flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {isFixing ? <div className="animate-spin rounded-full h-3 w-3 border-2 border-white/60 border-t-transparent" /> : <RefreshCw size={14} />}
                                Recalculate Scores from ESPN
                            </button>
                            <p className="text-[10px] text-faint mt-2 text-center">Forces a full re-sync and re-processes all winners.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
