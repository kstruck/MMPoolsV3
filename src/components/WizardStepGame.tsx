import React from 'react';
import type { GameState } from '../types';

interface WizardStepGameProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    onNext: () => void;
}

export const WizardStepGame: React.FC<WizardStepGameProps> = ({ gameState, updateConfig, onNext }) => {
    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="mb-6">
                    <h3 className="text-xl font-bold text-white mb-2">Game Details</h3>
                    <p className="text-slate-400 text-sm">Name your pool and set the schedule.</p>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Name</label>
                        <input
                            type="text"
                            value={gameState.name || ''}
                            onChange={(e) => updateConfig({ name: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none font-bold text-lg"
                            placeholder="e.g. Super Bowl LIX Props"
                        />
                    </div>

                    {/* Simplified Date/Time Picker for Props Pool (No complex schedule fetch for now, can add later) */}
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Lock Time (Game Start)</label>
                        <p className="text-xs text-slate-500 mb-2">Players cannot submit or edit cards after this time.</p>
                        <input
                            type="datetime-local"
                            value={(gameState as any).lockDate ? new Date((gameState as any).lockDate).toISOString().slice(0, 16) : ''}
                            onChange={(e) => {
                                const date = new Date(e.target.value);
                                updateConfig({ lockDate: date.getTime(), date: date.getTime() } as any);
                            }}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                </div>

                <div className="pt-8 flex justify-end">
                    <button
                        onClick={onNext}
                        disabled={!gameState.name || !(gameState as any).lockDate}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-all hover:scale-105"
                    >
                        Next: Branding
                    </button>
                </div>
            </div>
        </div>
    );
};
