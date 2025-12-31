import React from 'react';
import { Trophy, Zap, Users, Activity, CheckCircle, Shield, Heart } from 'lucide-react';
import type { GameState, PayoutConfig } from '../../types';

interface WizardStepPayoutsProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    totalPayout: number;
}

/**
 * Wizard Step 4: Payout Configuration
 * Allows users to configure payout mode (Standard Quarterly vs Every Score Pays),
 * pot distribution, charity settings, and unclaimed prize rules.
 */
export const WizardStepPayouts: React.FC<WizardStepPayoutsProps> = ({
    gameState,
    updateConfig,
    totalPayout
}) => {
    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">

            {/* 1. Main Payout Mode Selection (Card Based) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2">Payout Config</h3>
                <p className="text-slate-400 text-sm mb-6">Choose how players get paid. This is the most important rule!</p>

                <div className="grid md:grid-cols-2 gap-4 mb-8">
                    {/* Card 1: Standard Quarterly */}
                    <button
                        onClick={() => updateConfig({
                            payouts: { q1: 25, half: 25, q3: 25, final: 25 },
                            ruleVariations: { ...gameState.ruleVariations, scoreChangePayout: false }
                        })}
                        className={`relative p-6 rounded-2xl border-2 text-left transition-all group ${!gameState.ruleVariations.scoreChangePayout
                            ? 'bg-indigo-600/10 border-indigo-500 ring-4 ring-indigo-500/10'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-600'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div className={`p-3 rounded-xl ${!gameState.ruleVariations.scoreChangePayout ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                                <Trophy size={24} />
                            </div>
                            {!gameState.ruleVariations.scoreChangePayout && (
                                <div className="bg-indigo-500 text-white text-[10px] uppercase font-bold px-2 py-1 rounded-full">
                                    Selected
                                </div>
                            )}
                        </div>
                        <h4 className={`text-lg font-bold mb-2 ${!gameState.ruleVariations.scoreChangePayout ? 'text-white' : 'text-slate-300'}`}>
                            Standard Quarterly
                        </h4>
                        <p className="text-sm text-slate-400 leading-relaxed mb-4">
                            The classic pool format. Payouts happen only at the end of each quarter (Q1, Halftime, Q3, Final).
                        </p>
                        <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-400/10 w-fit px-2 py-1 rounded">
                            <Users size={12} />
                            <span>4 Winners Total</span>
                        </div>
                    </button>

                    {/* Card 2: Every Score Pays */}
                    <button
                        onClick={() => updateConfig({
                            payouts: { q1: 0, half: 0, q3: 0, final: 0 },
                            ruleVariations: { ...gameState.ruleVariations, scoreChangePayout: true }
                        })}
                        className={`relative p-6 rounded-2xl border-2 text-left transition-all group ${gameState.ruleVariations.scoreChangePayout
                            ? 'bg-indigo-600/10 border-indigo-500 ring-4 ring-indigo-500/10'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-600'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div className={`p-3 rounded-xl ${gameState.ruleVariations.scoreChangePayout ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                                <Zap size={24} />
                            </div>
                            {gameState.ruleVariations.scoreChangePayout && (
                                <div className="bg-indigo-500 text-white text-[10px] uppercase font-bold px-2 py-1 rounded-full">
                                    Selected
                                </div>
                            )}
                        </div>
                        <h4 className={`text-lg font-bold mb-2 ${gameState.ruleVariations.scoreChangePayout ? 'text-white' : 'text-slate-300'}`}>
                            Every Score Pays
                        </h4>
                        <p className="text-sm text-slate-400 leading-relaxed mb-4">
                            A modern twist! Someone wins money every single time the score changes (Touchdowns, FGs, Safeties).
                        </p>
                        <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-400/10 w-fit px-2 py-1 rounded">
                            <Activity size={12} />
                            <span>~15-20 Winners Total</span>
                        </div>
                    </button>
                </div>

                {/* 2. Standard Sliders (Only if NOT Every Score Mode OR if using Hybrid) */}
                {(!gameState.ruleVariations.scoreChangePayout) && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h4 className="font-bold text-white mb-1">Pot Distribution</h4>
                                <p className="text-slate-400 text-sm">Define how the pot is split. Must total 100%.</p>
                            </div>
                            <div className={`text-xl font-bold font-mono px-4 py-2 rounded border ${totalPayout === 100 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50' : 'bg-rose-500/10 text-rose-400 border-rose-500/50'}`}>
                                Total: {totalPayout}%
                            </div>
                        </div>
                        {['q1', 'half', 'q3', 'final'].map((key) => {
                            const label = key === 'q1' ? '1st Quarter' : key === 'half' ? 'Halftime' : key === 'q3' ? '3rd Quarter' : 'Final Score';
                            const val = gameState.payouts[key as keyof PayoutConfig];
                            const totalPot = gameState.costPerSquare * 100;
                            const charityDeduction = gameState.charity?.enabled ? (totalPot * (gameState.charity.percentage / 100)) : 0;
                            const netPot = totalPot - charityDeduction;
                            const projectedAmount = (netPot * (val / 100));

                            return (
                                <div key={key} className="bg-slate-950 p-4 rounded-xl border border-slate-700 flex items-center gap-4">
                                    <div className="w-32 font-bold text-slate-300">
                                        {label}
                                        <div className="text-[10px] text-slate-500 font-normal">Est. ${projectedAmount.toLocaleString()}</div>
                                    </div>
                                    <input type="range" min="0" max="100" step="5" value={val} onChange={(e) => updateConfig({ payouts: { ...gameState.payouts, [key]: parseInt(e.target.value) } })} className="flex-1 accent-indigo-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                                    <div className="w-20 relative">
                                        <input type="number" value={val} onChange={(e) => updateConfig({ payouts: { ...gameState.payouts, [key]: parseFloat(e.target.value) || 0 } })} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-right text-white font-mono font-bold outline-none focus:border-indigo-500" />
                                        <span className="absolute right-6 top-1.5 text-slate-500 text-xs hidden">%</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* 2. Every Score Pays - Strategy Selection (Required) */}
                {gameState.ruleVariations.scoreChangePayout && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">

                        <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-bold text-white text-lg">Payout Strategy</h4>
                            <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase">Required</span>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                            <button
                                onClick={() => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangePayoutStrategy: 'equal_split' } })}
                                className={`relative p-5 rounded-xl border text-left transition-all ${gameState.ruleVariations.scoreChangePayoutStrategy === 'equal_split'
                                    ? 'bg-indigo-500/20 border-indigo-500 ring-2 ring-indigo-500'
                                    : 'bg-slate-950 border-slate-700 hover:border-slate-500'
                                    }`}
                            >
                                {gameState.ruleVariations.scoreChangePayoutStrategy === 'equal_split' && (
                                    <div className="absolute top-3 right-3 bg-indigo-500 text-white p-1 rounded-full">
                                        <CheckCircle size={14} />
                                    </div>
                                )}
                                <div className="font-bold text-white mb-2 flex items-center gap-2">
                                    <div className={`p-1.5 rounded-lg ${gameState.ruleVariations.scoreChangePayoutStrategy === 'equal_split' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                                        <Zap size={16} />
                                    </div>
                                    Option A: Equal Split
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed pl-9">
                                    Most fair. The total pot is divided by the total number of scoring events. Every score is worth the exact same amount.
                                </p>
                            </button>

                            <button
                                onClick={() => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangePayoutStrategy: 'hybrid' } })}
                                className={`relative p-5 rounded-xl border text-left transition-all ${gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid'
                                    ? 'bg-indigo-500/20 border-indigo-500 ring-2 ring-indigo-500'
                                    : 'bg-slate-950 border-slate-700 hover:border-slate-500'
                                    }`}
                            >
                                {gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid' && (
                                    <div className="absolute top-3 right-3 bg-indigo-500 text-white p-1 rounded-full">
                                        <CheckCircle size={14} />
                                    </div>
                                )}
                                <div className="font-bold text-white mb-2 flex items-center gap-2">
                                    <div className={`p-1.5 rounded-lg ${gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                                        <Trophy size={16} />
                                    </div>
                                    Option B: Hybrid (Best of Both)
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed pl-9">
                                    Reserve larger payouts for Final/Halftime, and split the remainder across all other scoring events to keep it exciting.
                                </p>
                            </button>
                        </div>

                        {/* Strategy Details */}
                        {gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid' && (
                            <div className="bg-slate-950 p-6 rounded-xl border border-slate-700">
                                <h4 className="font-bold text-white mb-4">Hybrid Payout Weights</h4>
                                <div className="space-y-4">
                                    {/* Final */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-slate-300 font-bold">Final Score</span>
                                        <div className="flex items-center gap-2">
                                            <input type="number"
                                                value={gameState.ruleVariations.scoreChangeHybridWeights?.final || 40}
                                                onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangeHybridWeights: { ...(gameState.ruleVariations.scoreChangeHybridWeights || { final: 40, halftime: 20, other: 40 }), final: parseInt(e.target.value) } } })}
                                                className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-right text-white font-mono font-bold outline-none"
                                            />
                                            <span className="text-slate-500 text-sm">%</span>
                                        </div>
                                    </div>
                                    {/* Halftime */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-slate-300 font-bold">Halftime</span>
                                        <div className="flex items-center gap-2">
                                            <input type="number"
                                                value={gameState.ruleVariations.scoreChangeHybridWeights?.halftime || 20}
                                                onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangeHybridWeights: { ...(gameState.ruleVariations.scoreChangeHybridWeights || { final: 40, halftime: 20, other: 40 }), halftime: parseInt(e.target.value) } } })}
                                                className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-right text-white font-mono font-bold outline-none"
                                            />
                                            <span className="text-slate-500 text-sm">%</span>
                                        </div>
                                    </div>
                                    {/* Remainder */}
                                    <div className="flex items-center justify-between border-t border-slate-800 pt-4">
                                        <span className="text-sm text-indigo-400 font-bold">All Other Scores (Split)</span>
                                        <span className="font-mono font-bold text-white text-lg">
                                            {100 - ((gameState.ruleVariations.scoreChangeHybridWeights?.final || 40) + (gameState.ruleVariations.scoreChangeHybridWeights?.halftime || 20))}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Edge Cases */}
                        <div className="bg-slate-950 p-6 rounded-xl border border-slate-700">
                            <h4 className="font-bold text-white mb-4 text-sm uppercase tracking-wide">Edge Cases & Rules</h4>
                            <div className="space-y-4">
                                {/* TD + XP */}
                                <label className="flex items-center justify-between cursor-pointer">
                                    <div>
                                        <span className="text-sm text-slate-300 block font-bold">Combine TD + XP?</span>
                                        <span className="text-xs text-slate-500">If Yes, a touchdown and its extra point count as 1 payout event.</span>
                                    </div>
                                    <input type="checkbox" checked={gameState.ruleVariations.combineTDandXP || false} onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, combineTDandXP: e.target.checked } })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600" />
                                </label>

                                {/* Overtime */}
                                <label className="flex items-center justify-between cursor-pointer border-t border-slate-800 pt-3">
                                    <div>
                                        <span className="text-sm text-slate-300 block font-bold">Include Overtime?</span>
                                        <span className="text-xs text-slate-500">If Yes, OT score changes also trigger payouts.</span>
                                    </div>
                                    <input type="checkbox" checked={gameState.ruleVariations.includeOTInScorePayouts || false} onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, includeOTInScorePayouts: e.target.checked } })} className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600" />
                                </label>

                                {/* Unsold */}
                                <div className="border-t border-slate-800 pt-3">
                                    <label className="text-sm text-slate-300 block font-bold mb-2">If Winning Square is Unsold?</label>
                                    <select
                                        value={gameState.ruleVariations.scoreChangeHandleUnsold || 'rollover_next'}
                                        onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangeHandleUnsold: e.target.value as any } })}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500 text-sm"
                                    >
                                        <option value="rollover_next">Rollover to Next Event (Increases Pot)</option>
                                        <option value="split_winners">Split Among ALL Previous Winners</option>
                                        <option value="house">Return to House / Pool Organizer</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                    </div>
                )}

            </div>

            {/* Legacy Game Logic - Now in Step 4 */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-4">Other Game Logic</h3>
                <div className="space-y-3">
                    <label className="flex items-start gap-4 cursor-pointer p-4 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/30 transition-all">
                        <input type="checkbox" checked={gameState.ruleVariations.reverseWinners} onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, reverseWinners: e.target.checked } })} className="w-6 h-6 mt-1 rounded border-slate-600 bg-slate-800 text-indigo-600 shrink-0" />
                        <div className="flex-1">
                            <span className="font-bold text-slate-200 block text-lg">Reverse Winners</span>
                            <span className="text-sm text-slate-400 block mb-3">Pay out both the regular AND reverse score digits (Pot split 50/50).</span>

                            {/* Visual Diagram */}
                            <div className={`transition-all overflow-hidden ${gameState.ruleVariations.reverseWinners ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'}`}>
                                <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 mt-2">
                                    <div className="flex items-center justify-between text-xs font-bold text-slate-400 mb-2">
                                        <span>Example: Score 24-17</span>
                                        <span className="text-indigo-400">Q1 Prize: $100</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-2 text-center">
                                            <div className="text-[10px] text-emerald-400 font-bold uppercase mb-1">Regular Winner</div>
                                            <div className="text-white font-mono font-bold">4 - 7</div>
                                            <div className="text-emerald-400 font-bold text-sm">$50 (50%)</div>
                                        </div>
                                        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded p-2 text-center">
                                            <div className="text-[10px] text-indigo-400 font-bold uppercase mb-1">Reverse Winner</div>
                                            <div className="text-white font-mono font-bold">7 - 4</div>
                                            <div className="text-indigo-400 font-bold text-sm">$50 (50%)</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </label>

                    <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded border border-slate-800 hover:border-indigo-500/30">
                        <div>
                            <span className="font-bold text-slate-300 block">Include Overtime in Final?</span>
                            <span className="text-xs text-slate-500">If No, Final Score is taken at end of Q4.</span>
                        </div>
                        <input type="checkbox" checked={gameState.includeOvertime} onChange={(e) => updateConfig({ includeOvertime: e.target.checked })} className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600" />
                    </label>
                </div>
            </div>

            {/* Charity Section (Moved down) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                            <Heart size={20} className="text-rose-500" /> Charity & Fundraising
                        </h3>
                        <p className="text-slate-400 text-sm">Dedicate a portion of the pot to a cause.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={gameState.charity?.enabled || false}
                            onChange={(e) => updateConfig({ charity: { ...(gameState.charity || { name: '', percentage: 0, url: '' }), enabled: e.target.checked } })}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
                    </label>
                </div>

                {gameState.charity?.enabled && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Charity Name</label>
                                <input
                                    type="text"
                                    value={gameState.charity.name}
                                    onChange={(e) => updateConfig({ charity: { ...gameState.charity!, name: e.target.value } })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-rose-500 outline-none"
                                    placeholder="e.g. Red Cross"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Website URL (Optional)</label>
                                <input
                                    type="text"
                                    value={gameState.charity.url || ''}
                                    onChange={(e) => updateConfig({ charity: { ...gameState.charity!, url: e.target.value } })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-rose-500 outline-none"
                                    placeholder="https://..."
                                />
                            </div>
                        </div>

                        <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                            <div className="flex justify-between mb-2">
                                <span className="font-bold text-slate-300">Donation Percentage</span>
                                <span className="font-mono font-bold text-rose-400">{gameState.charity.percentage}% Off The Top</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                value={gameState.charity.percentage}
                                onChange={(e) => updateConfig({ charity: { ...gameState.charity!, percentage: parseInt(e.target.value) } })}
                                className="w-full accent-rose-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                            />
                            <p className="text-xs text-slate-500 mt-2">
                                This percentage will be deducted from the <strong>Total Pot</strong> before winner payouts.
                            </p>

                            {/* Projected Donation Amount */}
                            <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg flex justify-between items-center">
                                <span className="text-xs font-bold text-rose-300 uppercase">Projected Donation (100 Sqs)</span>
                                <span className="font-mono font-bold text-white text-lg">
                                    ${((gameState.costPerSquare * 100) * (gameState.charity.percentage / 100)).toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                            <Shield size={20} className="text-indigo-400" /> Unclaimed Prize Rules
                        </h3>
                        <p className="text-slate-400 text-sm">What happens if a winning square is empty?</p>
                    </div>
                </div>

                <div className="space-y-4">
                    {/* Note: Unsold handling for Score Events is configured above. This handles Quarterly. */}

                    <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-950 rounded-lg border border-slate-800 hover:border-indigo-500/50 transition-colors">
                        <div>
                            <span className="font-bold text-slate-200 block">Roll Over Winnings (Quarterly)</span>
                            <span className="text-xs text-slate-500">Unclaimed quarter prizes move to the next quarter.</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={gameState.ruleVariations.quarterlyRollover}
                            onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, quarterlyRollover: e.target.checked } })}
                            className="w-6 h-6 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                        />
                    </label>

                    {gameState.ruleVariations.quarterlyRollover && !gameState.ruleVariations.scoreChangePayout && (
                        <div className="animate-in fade-in slide-in-from-top-2 p-4 bg-slate-950/50 border border-slate-800 rounded-lg">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-3">Final Score Unclaimed Logic</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <button
                                    onClick={() => updateConfig({ ruleVariations: { ...gameState.ruleVariations, unclaimedFinalPrizeStrategy: 'last_winner' } })}
                                    className={`p-3 rounded-lg border text-left transition-all ${gameState.ruleVariations.unclaimedFinalPrizeStrategy === 'last_winner' || !gameState.ruleVariations.unclaimedFinalPrizeStrategy ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                >
                                    <div className="font-bold text-sm mb-1">Option A: Last Winner</div>
                                    <div className="text-xs opacity-80">Award prize to the most recent previous winner (e.g. Q3).</div>
                                </button>

                                <button
                                    onClick={() => updateConfig({ ruleVariations: { ...gameState.ruleVariations, unclaimedFinalPrizeStrategy: 'random' } })}
                                    className={`p-3 rounded-lg border text-left transition-all ${gameState.ruleVariations.unclaimedFinalPrizeStrategy === 'random' ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                >
                                    <div className="font-bold text-sm mb-1">Option B: Random Draw</div>
                                    <div className="text-xs opacity-80">Activates a "Randomizer" button to pick a lucky square.</div>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WizardStepPayouts;
