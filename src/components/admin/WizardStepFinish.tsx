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
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2">Final Preferences</h3>
                <p className="text-slate-400 text-sm mb-6">Customize data collection, notifications, and advanced rules.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Player Data */}
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Users size={16} className="text-indigo-400" /> Player Data Collection</h4>
                        <div className="space-y-3">
                            {(['collectPhone', 'collectAddress', 'collectReferral', 'collectNotes'] as const).map((field) => (
                                <label key={field} className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded">
                                    <span className="text-sm text-slate-300 capitalize">{field.replace('collect', '').replace(/([A-Z])/g, ' $1').trim()}</span>
                                    <input type="checkbox" checked={!!gameState[field]} onChange={(e) => updateConfig({ [field]: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" />
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Email Notifications */}
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Mail size={16} className="text-sky-400" /> Email Notifications</h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-slate-500 uppercase font-bold mb-1">User Picks Confirmation</label>
                                <select
                                    value={gameState.emailConfirmation}
                                    onChange={(e) => updateConfig({ emailConfirmation: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-sm outline-none focus:border-indigo-500"
                                >
                                    <option value="No Email Confirmation">Don't Send</option>
                                    <option value="Email Confirmation">Send Email Receipt</option>
                                </select>
                            </div>

                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded">
                                <span className="text-sm text-slate-300">Email Players when Numbers Set</span>
                                <input type="checkbox" checked={gameState.emailNumbersGenerated} onChange={(e) => updateConfig({ emailNumbersGenerated: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" />
                            </label>

                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded border-t border-slate-800 pt-3">
                                <span className="text-sm text-slate-300">Alert Admin when Grid Full</span>
                                <input type="checkbox" checked={gameState.notifyAdminFull} onChange={(e) => updateConfig({ notifyAdminFull: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" />
                            </label>
                        </div>
                    </div>

                    {/* Access Control */}
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Lock size={16} className="text-amber-400" /> Access Control</h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Grid Password</label>
                                <input type="text" value={gameState.gridPassword} onChange={(e) => updateConfig({ gridPassword: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white outline-none" placeholder="Optional" />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer pt-2">
                                <input type="checkbox" checked={gameState.isPublic} onChange={(e) => updateConfig({ isPublic: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500" />
                                <span className="text-sm text-slate-300">List in Public Directory</span>
                            </label>
                        </div>
                    </div>

                    {/* Debug & Repair (SuperAdmin Only - Hidden in Setup) */}
                    {!setupMode && handleFixSync && isSuperAdmin && (
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-700 border-l-4 border-l-amber-500">
                            <h4 className="font-bold text-white mb-3 text-sm uppercase flex items-center gap-2"><Hammer size={14} className="text-amber-400" /> Debug & Repair</h4>
                            <p className="text-xs text-slate-500 mb-4">Advanced tools to fix stuck states or missing scores.</p>

                            <button
                                onClick={handleFixSync}
                                disabled={isFixing}
                                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 py-2 px-4 rounded text-xs font-bold uppercase transition-colors flex items-center justify-center gap-2"
                            >
                                {isFixing ? <div className="animate-spin rounded-full h-3 w-3 border-2 border-slate-400 border-t-transparent" /> : <RefreshCw size={14} />}
                                Recalculate Scores from ESPN
                            </button>
                            <p className="text-[10px] text-slate-600 mt-2 text-center">Forces a full re-sync and re-processes all winners.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
