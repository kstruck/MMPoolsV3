import React from 'react';
import type { GameState } from '../types';
import { Bell, Clock, Trash2, CheckCircle, Sparkles } from 'lucide-react';

interface WizardStepRemindersProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    onNext: () => void;
    isProps?: boolean;
}

export const WizardStepReminders: React.FC<WizardStepRemindersProps> = ({ gameState, updateConfig, isProps = false }) => {

    const defaultReminders = {
        payment: { enabled: false, graceMinutes: 60, repeatEveryHours: 24, notifyUsers: false },
        lock: { enabled: true, scheduleMinutes: [60, 30, 15], lockAt: undefined as number | undefined },
        winner: { enabled: true, channels: ['email'] as ('email' | 'in-app')[], includeDigits: true, includeCharityImpact: true }
    };

    const safeReminders = {
        payment: { ...defaultReminders.payment, ...(gameState.reminders?.payment || {}) },
        lock: { ...defaultReminders.lock, ...(gameState.reminders?.lock || {}) },
        winner: { ...defaultReminders.winner, ...(gameState.reminders?.winner || {}) }
    };

    // Helper to calculate estimated start time if available
    const estimatedStartTime = gameState.gameTime ? new Date(gameState.gameTime) : gameState.scores?.startTime ? new Date(gameState.scores.startTime) : null;

    const charityConfig = gameState.charity || {
        enabled: false,
        name: '',
        percentage: 10,
        description: '',
        url: ''
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            {/* Payment Reminders */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Bell size={20} className="text-amber-400" /> Payment Reminders
                </h3>
                <p className="text-slate-400 text-sm mb-6">Automate follow-ups for unpaid {isProps ? 'entries' : 'squares'}.</p>

                <div className="space-y-4">
                    <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
                        <div>
                            <span className="font-bold text-slate-200 block">Enable Auto-Reminders</span>
                            <span className="text-xs text-slate-500">System checks every 15 mins for unpaid {isProps ? 'entries' : 'reservations'}.</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={safeReminders.payment.enabled}
                            onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, enabled: e.target.checked } } })}
                            className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                        />
                    </label>

                    {safeReminders.payment.enabled && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Grace Period (Minutes)</label>
                                <input
                                    type="number"
                                    value={safeReminders.payment.graceMinutes}
                                    onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, graceMinutes: parseInt(e.target.value) || 0 } } })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                />
                                <p className="text-[10px] text-slate-500 mt-1">Wait time after reservation before detailed reminder.</p>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Repeat Every (Hours)</label>
                                <input
                                    type="number"
                                    value={safeReminders.payment.repeatEveryHours}
                                    onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, repeatEveryHours: parseInt(e.target.value) || 0 } } })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                />
                                <p className="text-[10px] text-slate-500 mt-1">Frequency of follow-up emails.</p>
                            </div>

                            <label className="md:col-span-2 flex items-center gap-3 cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800">
                                <input
                                    type="checkbox"
                                    checked={safeReminders.payment.notifyUsers}
                                    onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, notifyUsers: e.target.checked } } })}
                                    className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600"
                                />
                                <span className="text-sm text-slate-300">Also email the <strong>Participants</strong> directly (not just Host summary)</span>
                            </label>

                            <div className="md:col-span-2 pt-4 border-t border-slate-800 mt-2">
                                <label className="flex items-center justify-between cursor-pointer p-2 mb-2">
                                    <div>
                                        <span className="font-bold text-rose-400 block flex items-center gap-2">
                                            <Trash2 size={14} /> Auto-Release Unpaid {isProps ? 'Entries' : 'Squares'}
                                        </span>
                                        <span className="text-xs text-slate-500">Automatically remove {isProps ? 'entry' : 'reservation'} if not paid in time.</span>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={safeReminders.payment.autoRelease}
                                        onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, autoRelease: e.target.checked } } })}
                                        className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-rose-600 focus:ring-rose-500"
                                    />
                                </label>

                                {safeReminders.payment.autoRelease && (
                                    <div className="pl-4 animate-in fade-in">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Release After (Hours)</label>
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="number"
                                                value={safeReminders.payment.autoReleaseHours || 24}
                                                onChange={(e) => updateConfig({ reminders: { ...safeReminders, payment: { ...safeReminders.payment, autoReleaseHours: parseInt(e.target.value) || 0 } } })}
                                                className="w-24 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-rose-500"
                                            />
                                            <span className="text-xs text-slate-500">hours from reservation time.</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Auto-Lock & Number Generation */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Clock size={20} className="text-rose-400" /> {isProps ? 'Auto-Lock System' : 'Auto-Lock & Number Generation'}
                </h3>
                <p className="text-slate-400 text-sm mb-6">Automatically lock the {isProps ? 'pool' : 'grid and reveal numbers'}.</p>

                <div className="space-y-4">
                    <label className="flex items-center gap-2 cursor-pointer p-2 hover:bg-slate-900 rounded mb-2 border border-transparent hover:border-slate-700 transition-all">
                        <input
                            type="checkbox"
                            checked={safeReminders.lock.enabled}
                            onChange={(e) => updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, enabled: e.target.checked } } })}
                            className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div>
                            <span className="text-sm font-bold text-slate-200 block">Enable Auto-Lock System</span>
                            <span className="text-xs text-slate-500">If disabled, the pool will NEVER auto-lock.</span>
                        </div>
                    </label>

                    <div className={`bg-slate-950 p-4 rounded-lg border border-slate-800 ${!safeReminders.lock.enabled ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Trigger Time</label>
                        <select
                            className="w-full bg-slate-900 border border-slate-700 rounded px-4 py-3 text-white mb-4 outline-none focus:border-indigo-500"
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'manual') {
                                    updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: undefined } } });
                                } else if (val === 'custom') {
                                    let defaultTime = new Date();
                                    if (estimatedStartTime) {
                                        defaultTime = new Date(estimatedStartTime);
                                    } else {
                                        defaultTime.setMinutes(defaultTime.getMinutes() + 60);
                                    }
                                    updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, enabled: true, lockAt: defaultTime.getTime() } } });
                                    updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, enabled: true, lockAt: defaultTime.getTime() } } });
                                } else if (val === '0') {
                                    if (estimatedStartTime) {
                                        updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, enabled: true, lockAt: estimatedStartTime.getTime() } } });
                                    }
                                } else {
                                    const offsetMins = parseInt(val);
                                    if (estimatedStartTime) {
                                        const start = estimatedStartTime.getTime();
                                        updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, enabled: true, lockAt: start - (offsetMins * 60 * 1000) } } });
                                    }
                                }
                            }}
                            value={
                                !safeReminders.lock.lockAt ? 'manual' :
                                    estimatedStartTime && Math.abs(safeReminders.lock.lockAt - (estimatedStartTime.getTime() - 3600000)) < 10000 ? '60' :
                                        estimatedStartTime && Math.abs(safeReminders.lock.lockAt - (estimatedStartTime.getTime() - 1800000)) < 10000 ? '30' :
                                            estimatedStartTime && Math.abs(safeReminders.lock.lockAt - (estimatedStartTime.getTime() - 900000)) < 10000 ? '15' :
                                                estimatedStartTime && Math.abs(safeReminders.lock.lockAt - (estimatedStartTime.getTime() - 900000)) < 10000 ? '15' :
                                                    estimatedStartTime && Math.abs(safeReminders.lock.lockAt - (estimatedStartTime.getTime() - 300000)) < 10000 ? '5' :
                                                        estimatedStartTime && Math.abs(safeReminders.lock.lockAt - estimatedStartTime.getTime()) < 10000 ? '0' :
                                                            'custom'
                            }
                        >
                            <option value="manual">Manual (I will click 'Lock')</option>
                            <option value="0" disabled={!estimatedStartTime} className="font-bold">Kickoff (Game Start)</option>
                            <option value="5" disabled={!estimatedStartTime}>5 Minutes Before Kickoff</option>
                            <option value="15" disabled={!estimatedStartTime}>15 Minutes Before Kickoff</option>
                            <option value="30" disabled={!estimatedStartTime}>30 Minutes Before Kickoff</option>
                            <option value="60" disabled={!estimatedStartTime}>1 Hour Before Kickoff</option>
                            <option value="custom">Custom Date & Time...</option>
                        </select>

                        {safeReminders.lock.lockAt && (
                            <div className="animate-in fade-in slide-in-from-top-2 border-t border-slate-800 pt-4 mt-2">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Date</label>
                                        <input
                                            type="date"
                                            value={(() => {
                                                const d = new Date(safeReminders.lock.lockAt!);
                                                const year = d.getFullYear();
                                                const month = String(d.getMonth() + 1).padStart(2, '0');
                                                const day = String(d.getDate()).padStart(2, '0');
                                                return `${year}-${month}-${day}`;
                                            })()}
                                            onChange={(e) => {
                                                if (!e.target.value) return;
                                                const [y, m, d] = e.target.value.split('-').map(Number);
                                                const current = new Date(safeReminders.lock.lockAt!);
                                                current.setFullYear(y);
                                                current.setMonth(m - 1);
                                                current.setDate(d);
                                                updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: current.getTime() } } });
                                            }}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Time</label>
                                        <div className="flex bg-slate-900 border border-slate-700 rounded px-1">
                                            <select
                                                className="bg-transparent text-white outline-none text-center font-bold font-mono py-2 flex-1"
                                                value={(() => {
                                                    let h = new Date(safeReminders.lock.lockAt!).getHours();
                                                    if (h === 0) h = 12;
                                                    else if (h > 12) h -= 12;
                                                    return h;
                                                })()}
                                                onChange={(e) => {
                                                    const newH = parseInt(e.target.value);
                                                    const current = new Date(safeReminders.lock.lockAt!);
                                                    const isPM = current.getHours() >= 12;
                                                    let h = newH;
                                                    if (isPM && newH !== 12) h += 12;
                                                    if (!isPM && newH === 12) h = 0;
                                                    current.setHours(h);
                                                    updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: current.getTime() } } });
                                                }}
                                            >
                                                {Array.from({ length: 12 }, (_, i) => i + 1).map(h => <option key={h} value={h} className="bg-slate-900 text-white">{h}</option>)}
                                            </select>
                                            <span className="py-2 text-slate-500">:</span>
                                            <select
                                                className="bg-transparent text-white outline-none text-center font-bold font-mono py-2 flex-1"
                                                value={Math.floor(new Date(safeReminders.lock.lockAt!).getMinutes() / 5) * 5}
                                                onChange={(e) => {
                                                    const m = parseInt(e.target.value);
                                                    const current = new Date(safeReminders.lock.lockAt!);
                                                    current.setMinutes(m);
                                                    updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: current.getTime() } } });
                                                }}
                                            >
                                                {Array.from({ length: 12 }, (_, i) => i * 5).map(m => <option key={m} value={m} className="bg-slate-900 text-white">{m.toString().padStart(2, '0')}</option>)}
                                            </select>
                                            <select
                                                className="bg-transparent text-indigo-400 outline-none font-bold py-2 pl-2"
                                                value={new Date(safeReminders.lock.lockAt!).getHours() >= 12 ? 'PM' : 'AM'}
                                                onChange={(e) => {
                                                    const isPM = e.target.value === 'PM';
                                                    const current = new Date(safeReminders.lock.lockAt!);
                                                    let h = current.getHours();
                                                    if (isPM && h < 12) h += 12;
                                                    if (!isPM && h >= 12) h -= 12;
                                                    current.setHours(h);
                                                    updateConfig({ reminders: { ...safeReminders, lock: { ...safeReminders.lock, lockAt: current.getTime() } } });
                                                }}
                                            >
                                                <option value="AM" className="bg-slate-900 text-white">AM</option>
                                                <option value="PM" className="bg-slate-900 text-white">PM</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-[10px] text-emerald-400 mt-2 flex items-center gap-1">
                                    <CheckCircle size={10} /> {isProps ? 'Pool will automatically lock at this time.' : 'Grid will automatically lock and numbers will be generated at this time.'}
                                </p>
                                <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                                    📍 Times shown in your local timezone: <span className="font-mono text-slate-400">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span> <br />
                                    (Server Time: {new Date().toLocaleTimeString([], { timeZoneName: 'short' })})
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Winner Announcements */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Sparkles size={20} className="text-emerald-400" /> Winner Announcements
                </h3>
                <p className="text-slate-400 text-sm mb-6">Instant alerts when a result is final.</p>
                <div className="space-y-4">
                    <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
                        <div>
                            <span className="font-bold text-slate-200 block">Enable Winner Emails</span>
                            <span className="text-xs text-slate-500">Auto-email all participants when a winner is calculated.</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={safeReminders.winner.enabled}
                            onChange={(e) => updateConfig({ reminders: { ...safeReminders, winner: { ...safeReminders.winner, enabled: e.target.checked } } })}
                            className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                        />
                    </label>
                    {safeReminders.winner.enabled && (
                        <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 p-3 bg-slate-950 rounded-lg border border-slate-800">
                            {/* Hidden for Props */}
                            {!isProps && (
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={safeReminders.winner.includeDigits}
                                        onChange={(e) => updateConfig({ reminders: { ...safeReminders, winner: { ...safeReminders.winner, includeDigits: e.target.checked } } })}
                                        className="w-5 h-5 rounded bg-slate-800 border-slate-600"
                                    />
                                    <span className="text-sm text-slate-300">Include Winning Digits</span>
                                </label>
                            )}
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={safeReminders.winner.includeCharityImpact}
                                    onChange={(e) => updateConfig({ reminders: { ...safeReminders, winner: { ...safeReminders.winner, includeCharityImpact: e.target.checked } } })}
                                    className="w-5 h-5 rounded bg-slate-800 border-slate-600"
                                />
                                <span className="text-sm text-slate-300">Include Charity Impact</span>
                            </label>
                        </div>
                    )}
                </div>
            </div>

            {/* Charity / Fundraising Section (New) */}
            {isProps && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <Sparkles size={20} className="text-indigo-400" /> Charity / Fundraising
                    </h3>
                    <p className="text-slate-400 text-sm mb-6">Allocate a percentage of the pot to a cause.</p>

                    <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors mb-4">
                        <div>
                            <span className="font-bold text-slate-200 block">Enable Fundraising</span>
                            <span className="text-xs text-slate-500">Deduct a percentage from determining the payouts.</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={charityConfig.enabled}
                            onChange={(e) => updateConfig({ charity: { ...charityConfig, enabled: e.target.checked } })}
                            className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                        />
                    </label>

                    {charityConfig.enabled && (
                        <div className="space-y-4 animate-in fade-in bg-slate-950 p-4 rounded-lg border border-slate-800">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Organization Name</label>
                                <input
                                    type="text"
                                    value={charityConfig.name}
                                    onChange={(e) => updateConfig({ charity: { ...charityConfig, name: e.target.value } })}
                                    placeholder="e.g. Red Cross"
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Percentage %</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={charityConfig.percentage}
                                            onChange={(e) => updateConfig({ charity: { ...charityConfig, percentage: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) } })}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500 pr-8"
                                        />
                                        <span className="absolute right-3 top-2 text-slate-500">%</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Link (Optional)</label>
                                    <input
                                        type="url"
                                        value={charityConfig.url || ''}
                                        onChange={(e) => updateConfig({ charity: { ...charityConfig, url: e.target.value } })}
                                        placeholder="https://..."
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Description</label>
                                <textarea
                                    value={charityConfig.description || ''}
                                    onChange={(e) => updateConfig({ charity: { ...charityConfig, description: e.target.value } })}
                                    rows={2}
                                    placeholder="Briefly describe the cause..."
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
