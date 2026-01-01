import React from 'react';
import type { GameState } from '../types';
import { Bell, Clock } from 'lucide-react';

interface WizardStepRemindersProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    onNext: () => void;
}

export const WizardStepReminders: React.FC<WizardStepRemindersProps> = ({ gameState, updateConfig }) => {

    const reminders = gameState.reminders || {
        lock: { enabled: true, scheduleMinutes: [60, 30] },
        winner: { enabled: true }
    };

    const updateReminders = (updates: any) => {
        updateConfig({ reminders: { ...reminders, ...updates } });
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2">Smart Reminders</h3>
                <p className="text-slate-400 text-sm mb-6">Configure automated notifications.</p>

                <div className="space-y-4">
                    {/* Lock Reminders */}
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-700 flex items-start gap-4">
                        <div className={`p-2 rounded-lg ${reminders.lock?.enabled ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-500'}`}>
                            <Clock size={24} />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="font-bold text-white">Pending Pick Reminders</h4>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={reminders.lock?.enabled}
                                        onChange={(e) => updateReminders({ lock: { ...reminders.lock, enabled: e.target.checked } })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-amber-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                                </label>
                            </div>
                            <p className="text-xs text-slate-500">Automatically remind players who haven't completed their cards before lock time.</p>
                        </div>
                    </div>

                    {/* Winner Notifications */}
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-700 flex items-start gap-4">
                        <div className={`p-2 rounded-lg ${reminders.winner?.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                            <Bell size={24} />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="font-bold text-white">Winner Alerts</h4>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={reminders.winner?.enabled}
                                        onChange={(e) => updateReminders({ winner: { ...reminders.winner, enabled: e.target.checked } })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-emerald-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                                </label>
                            </div>
                            <p className="text-xs text-slate-500">Send an email summary when the game ends.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
