import { OverlayRoot } from '../ui/OverlayRoot';
import React, { useState } from 'react';
import { Trophy, Zap, Users, Activity, CheckCircle, Shield, Heart, AlertTriangle } from 'lucide-react';
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
    const [showRandomDrawWarning, setShowRandomDrawWarning] = useState(false);

    const handleRandomDrawClick = () => {
        setShowRandomDrawWarning(true);
    };

    const confirmRandomDraw = () => {
        updateConfig({ ruleVariations: { ...gameState.ruleVariations, unclaimedFinalPrizeStrategy: 'random' } });
        setShowRandomDrawWarning(false);
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">

            {/* 1. Main Payout Mode Selection (Card Based) */}
            <div className="bg-surface border border-line rounded-xl p-6">
                <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">Payout Config</h3>
                <p className="text-muted text-sm mb-6">Choose how players get paid. This is the most important rule!</p>

                <div className="grid md:grid-cols-2 gap-4 mb-8">
                    {/* Card 1: Standard Quarterly */}
                    <button
                        onClick={() => updateConfig({
                            payouts: { q1: 25, half: 25, q3: 25, final: 25 },
                            ruleVariations: { ...gameState.ruleVariations, scoreChangePayout: false }
                        })}
                        className={`relative p-6 rounded-2xl border-2 text-left transition-all group ${!gameState.ruleVariations.scoreChangePayout
                            ? 'bg-navy-600/10 border-navy-600 ring-4 ring-navy-600/10'
                            : 'bg-card border-line hover:border-navy-600'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div className={`p-3 rounded-xl ${!gameState.ruleVariations.scoreChangePayout ? 'bg-navy-800 text-white' : 'bg-page text-muted'}`}>
                                <Trophy size={24} />
                            </div>
                            {!gameState.ruleVariations.scoreChangePayout && (
                                <div className="bg-navy-800 text-white text-[10px] uppercase font-display font-bold px-2 py-1 rounded-full">
                                    Selected
                                </div>
                            )}
                        </div>
                        <h4 className={`text-lg font-display font-bold uppercase mb-2 ${!gameState.ruleVariations.scoreChangePayout ? 'text-[color:var(--text)]' : 'text-muted'}`}>
                            Standard Quarterly
                        </h4>
                        <p className="text-sm text-muted leading-relaxed mb-4">
                            The classic pool format. Payouts happen only at the end of each quarter (Q1, Halftime, Q3, Final).
                        </p>
                        <div className="flex items-center gap-2 text-xs font-mono text-[#0F7B4A] bg-[#0F7B4A]/10 w-fit px-2 py-1 rounded">
                            <Users size={12} />
                            <span className="num">4 Winners Total</span>
                        </div>
                    </button>

                    {/* Card 2: Every Score Pays */}
                    <button
                        onClick={() => updateConfig({
                            payouts: { q1: 0, half: 0, q3: 0, final: 0 },
                            ruleVariations: {
                                ...gameState.ruleVariations,
                                scoreChangePayout: true,
                                combineTDandXP: false, // Separate TD and 2PT conversions for maximum scoring events
                                // CRITICAL: Always initialize hybrid weights with defaults
                                // This ensures pools have the correct payout percentages even if user doesn't touch sliders
                                scoreChangeHybridWeights: gameState.ruleVariations.scoreChangeHybridWeights || {
                                    final: 40,
                                    halftime: 20,
                                    other: 40
                                }
                            }
                        })}
                        className={`relative p-6 rounded-2xl border-2 text-left transition-all group ${gameState.ruleVariations.scoreChangePayout
                            ? 'bg-navy-600/10 border-navy-600 ring-4 ring-navy-600/10'
                            : 'bg-card border-line hover:border-navy-600'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <div className={`p-3 rounded-xl ${gameState.ruleVariations.scoreChangePayout ? 'bg-navy-800 text-white' : 'bg-page text-muted'}`}>
                                <Zap size={24} />
                            </div>
                            {gameState.ruleVariations.scoreChangePayout && (
                                <div className="bg-navy-800 text-white text-[10px] uppercase font-display font-bold px-2 py-1 rounded-full">
                                    Selected
                                </div>
                            )}
                        </div>
                        <h4 className={`text-lg font-display font-bold uppercase mb-2 ${gameState.ruleVariations.scoreChangePayout ? 'text-[color:var(--text)]' : 'text-muted'}`}>
                            Every Score Pays
                        </h4>
                        <p className="text-sm text-muted leading-relaxed mb-4">
                            A modern twist! Someone wins money every single time the score changes (Touchdowns, FGs, Safeties).
                        </p>
                        <div className="flex items-center gap-2 text-xs font-mono text-[#0F7B4A] bg-[#0F7B4A]/10 w-fit px-2 py-1 rounded">
                            <Activity size={12} />
                            <span className="num">~15-20 Winners Total</span>
                        </div>
                    </button>
                </div>

                {/* 2. Standard Sliders (Only if NOT Every Score Mode OR if using Hybrid) */}
                {(!gameState.ruleVariations.scoreChangePayout) && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-1">Pot Distribution</h4>
                                <p className="text-muted text-sm">Define how the pot is split. Must total 100%.</p>
                            </div>
                            <div className={`num text-xl font-bold font-mono px-4 py-2 rounded border ${totalPayout === 100 ? 'bg-[#0F7B4A]/10 text-[#0F7B4A] border-[#0F7B4A]/50' : 'bg-brandred-500/10 text-brandred-600 border-brandred-500/50'}`}>
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
                                <div key={key} className="bg-card p-4 rounded-xl border border-line flex items-center gap-4">
                                    <div className="w-32 font-display font-bold uppercase text-[color:var(--text)]">
                                        {label}
                                        <div className="num text-[10px] text-gold-700 dark:text-gold-400 font-normal">Est. ${projectedAmount.toLocaleString()}</div>
                                    </div>
                                    <input type="range" min="0" max="100" step="5" value={val} onChange={(e) => updateConfig({ payouts: { ...gameState.payouts, [key]: parseInt(e.target.value) } })} className="flex-1 accent-gold-600 h-2 bg-line rounded-lg appearance-none cursor-pointer" />
                                    <div className="w-20 relative">
                                        <input type="number" value={val} onChange={(e) => updateConfig({ payouts: { ...gameState.payouts, [key]: parseFloat(e.target.value) || 0 } })} className="num w-full rounded-md border-[1.5px] border-line bg-page px-2 py-1 text-right text-gold-700 dark:text-gold-400 font-mono font-bold outline-none focus:border-navy-600 transition-colors" />
                                        <span className="absolute right-6 top-1.5 text-faint text-xs hidden">%</span>
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
                            <h4 className="font-display font-bold uppercase text-[color:var(--text)] text-lg">Payout Strategy</h4>
                            <span className="bg-brandred-600 text-white text-[10px] font-display font-bold px-2 py-0.5 rounded uppercase">Required</span>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                            <button
                                onClick={() => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangePayoutStrategy: 'equal_split' } })}
                                className={`relative p-5 rounded-xl border text-left transition-all ${gameState.ruleVariations.scoreChangePayoutStrategy === 'equal_split'
                                    ? 'bg-navy-600/20 border-navy-600 ring-2 ring-navy-600'
                                    : 'bg-card border-line hover:border-navy-600'
                                    }`}
                            >
                                {gameState.ruleVariations.scoreChangePayoutStrategy === 'equal_split' && (
                                    <div className="absolute top-3 right-3 bg-navy-800 text-white p-1 rounded-full">
                                        <CheckCircle size={14} />
                                    </div>
                                )}
                                <div className="font-display font-bold uppercase text-[color:var(--text)] mb-2 flex items-center gap-2">
                                    <div className={`p-1.5 rounded-lg ${gameState.ruleVariations.scoreChangePayoutStrategy === 'equal_split' ? 'bg-navy-800 text-white' : 'bg-page text-muted'}`}>
                                        <Zap size={16} />
                                    </div>
                                    Option A: Equal Split
                                </div>
                                <p className="text-xs text-muted leading-relaxed pl-9">
                                    Most fair. The total pot is divided by the total number of scoring events. Every score is worth the exact same amount.
                                </p>
                            </button>

                            <button
                                onClick={() => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangePayoutStrategy: 'hybrid' } })}
                                className={`relative p-5 rounded-xl border text-left transition-all ${gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid'
                                    ? 'bg-navy-600/20 border-navy-600 ring-2 ring-navy-600'
                                    : 'bg-card border-line hover:border-navy-600'
                                    }`}
                            >
                                {gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid' && (
                                    <div className="absolute top-3 right-3 bg-navy-800 text-white p-1 rounded-full">
                                        <CheckCircle size={14} />
                                    </div>
                                )}
                                <div className="font-display font-bold uppercase text-[color:var(--text)] mb-2 flex items-center gap-2">
                                    <div className={`p-1.5 rounded-lg ${gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid' ? 'bg-navy-800 text-white' : 'bg-page text-muted'}`}>
                                        <Trophy size={16} />
                                    </div>
                                    Option B: Hybrid (Best of Both)
                                </div>
                                <p className="text-xs text-muted leading-relaxed pl-9">
                                    Reserve larger payouts for Final/Halftime, and split the remainder across all other scoring events to keep it exciting.
                                </p>
                            </button>
                        </div>

                        {/* Strategy Details */}
                        {gameState.ruleVariations.scoreChangePayoutStrategy === 'hybrid' && (
                            <div className="bg-card p-6 rounded-xl border border-line">
                                <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4">Hybrid Payout Weights</h4>
                                <div className="space-y-4">
                                    {/* Final */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-[color:var(--text)] font-bold">Final Score</span>
                                        <div className="flex items-center gap-2">
                                            <input type="number"
                                                value={gameState.ruleVariations.scoreChangeHybridWeights?.final || 40}
                                                onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangeHybridWeights: { ...(gameState.ruleVariations.scoreChangeHybridWeights || { final: 40, halftime: 20, other: 40 }), final: parseInt(e.target.value) } } })}
                                                className="num w-20 rounded-md border-[1.5px] border-line bg-page px-2 py-1 text-right text-gold-700 dark:text-gold-400 font-mono font-bold outline-none focus:border-navy-600 transition-colors"
                                            />
                                            <span className="text-faint text-sm num">%</span>
                                        </div>
                                    </div>
                                    {/* Halftime */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-[color:var(--text)] font-bold">Halftime</span>
                                        <div className="flex items-center gap-2">
                                            <input type="number"
                                                value={gameState.ruleVariations.scoreChangeHybridWeights?.halftime || 20}
                                                onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangeHybridWeights: { ...(gameState.ruleVariations.scoreChangeHybridWeights || { final: 40, halftime: 20, other: 40 }), halftime: parseInt(e.target.value) } } })}
                                                className="num w-20 rounded-md border-[1.5px] border-line bg-page px-2 py-1 text-right text-gold-700 dark:text-gold-400 font-mono font-bold outline-none focus:border-navy-600 transition-colors"
                                            />
                                            <span className="text-faint text-sm num">%</span>
                                        </div>
                                    </div>
                                    {/* Remainder */}
                                    <div className="flex items-center justify-between border-t border-line pt-4">
                                        <span className="text-sm text-navy-600 dark:text-gold-400 font-bold">All Other Scores (Split)</span>
                                        <span className="num font-mono font-bold text-gold-700 dark:text-gold-400 text-lg">
                                            {100 - ((gameState.ruleVariations.scoreChangeHybridWeights?.final || 40) + (gameState.ruleVariations.scoreChangeHybridWeights?.halftime || 20))}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Edge Cases */}
                        <div className="bg-card p-6 rounded-xl border border-line">
                            <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 text-sm tracking-[0.08em]">Edge Cases & Rules</h4>
                            <div className="space-y-4">
                                {/* TD + XP */}
                                <label className="flex items-center justify-between cursor-pointer">
                                    <div>
                                        <span className="text-sm text-[color:var(--text)] block font-bold">Combine TD + XP?</span>
                                        <span className="text-xs text-faint">If Yes, a touchdown and its extra point count as 1 payout event.</span>
                                    </div>
                                    <input type="checkbox" checked={gameState.ruleVariations.combineTDandXP || false} onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, combineTDandXP: e.target.checked } })} className="size-5 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800" />
                                </label>

                                {/* Overtime */}
                                <label className="flex items-center justify-between cursor-pointer border-t border-line pt-3">
                                    <div>
                                        <span className="text-sm text-[color:var(--text)] block font-bold">Include Overtime?</span>
                                        <span className="text-xs text-faint">If Yes, OT score changes also trigger payouts.</span>
                                    </div>
                                    <input type="checkbox" checked={gameState.ruleVariations.includeOTInScorePayouts || false} onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, includeOTInScorePayouts: e.target.checked } })} className="size-5 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800" />
                                </label>

                                {/* Unsold */}
                                <div className="border-t border-line pt-3">
                                    <label className="text-sm text-[color:var(--text)] block font-bold mb-2">If Winning Square is Unsold?</label>
                                    <select
                                        value={gameState.ruleVariations.scoreChangeHandleUnsold || 'rollover_next'}
                                        onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, scoreChangeHandleUnsold: e.target.value as 'rollover_next' | 'house' | 'split_winners' } })}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2.5 font-body text-sm text-[color:var(--text)] cursor-pointer outline-none focus:border-navy-600 focus:bg-surface transition-colors"
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
            <div className="bg-surface border border-line rounded-xl p-6">
                <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-4">Other Game Logic</h3>
                <div className="space-y-3">
                    <label className="flex items-center justify-between cursor-pointer p-3 bg-card rounded border border-line hover:border-navy-600/30">
                        <div>
                            <span className="font-display font-bold uppercase text-[color:var(--text)] block">Include Overtime in Final?</span>
                            <span className="text-xs text-faint">If No, Final Score is taken at end of Q4.</span>
                        </div>
                        <input type="checkbox" checked={gameState.includeOvertime} onChange={(e) => updateConfig({ includeOvertime: e.target.checked })} className="size-6 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800" />
                    </label>
                </div>
            </div>

            {/* Charity Section (Moved down) */}
            <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-1 flex items-center gap-2">
                            <Heart size={20} className="text-gold-700 dark:text-gold-400" /> Charity & Fundraising
                        </h3>
                        <p className="text-muted text-sm">Dedicate a portion of the pot to a cause.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={gameState.charity?.enabled || false}
                            onChange={(e) => updateConfig({ charity: { ...(gameState.charity || { name: '', percentage: 0, url: '' }), enabled: e.target.checked } })}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-line peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-navy-800 dark:peer-checked:bg-gold-600"></div>
                    </label>
                </div>

                {gameState.charity?.enabled && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Charity Name</label>
                                <input
                                    type="text"
                                    value={gameState.charity.name}
                                    onChange={(e) => updateConfig({ charity: { ...gameState.charity!, name: e.target.value } })}
                                    className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                    placeholder="e.g. Red Cross"
                                />
                            </div>
                            <div>
                                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Website URL (Optional)</label>
                                <input
                                    type="text"
                                    value={gameState.charity.url || ''}
                                    onChange={(e) => updateConfig({ charity: { ...gameState.charity!, url: e.target.value } })}
                                    className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                    placeholder="https://..."
                                />
                            </div>
                        </div>

                        <div className="bg-card p-4 rounded-xl border border-line">
                            <div className="flex justify-between mb-2">
                                <span className="font-display font-bold uppercase text-[color:var(--text)]">Donation Percentage</span>
                                <span className="num font-mono font-bold text-gold-700 dark:text-gold-400">{gameState.charity.percentage}% Off The Top</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                value={gameState.charity.percentage}
                                onChange={(e) => updateConfig({ charity: { ...gameState.charity!, percentage: parseInt(e.target.value) } })}
                                className="w-full accent-gold-600 h-2 bg-line rounded-lg appearance-none cursor-pointer"
                            />
                            <p className="text-xs text-faint mt-2">
                                This percentage will be deducted from the <strong className="text-[color:var(--text)]">Total Pot</strong> before winner payouts.
                            </p>

                            {/* Projected Donation Amount */}
                            <div className="mt-4 p-3 bg-gold-500/10 border border-gold-500/30 rounded-lg flex justify-between items-center">
                                <span className="text-xs font-display font-bold uppercase text-gold-700 dark:text-gold-400">Projected Donation (100 Sqs)</span>
                                <span className="num font-mono font-bold text-gold-700 dark:text-gold-400 text-lg">
                                    ${((gameState.costPerSquare * 100) * (gameState.charity.percentage / 100)).toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-1 flex items-center gap-2">
                            <Shield size={20} className="text-navy-600 dark:text-navy-500" /> Unclaimed Prize Rules
                        </h3>
                        <p className="text-muted text-sm">What happens if a winning square is empty?</p>
                    </div>
                </div>

                <div className="space-y-4">
                    {/* Note: Unsold handling for Score Events is configured above. This handles Quarterly. */}

                    <label className="flex items-center justify-between cursor-pointer p-3 bg-card rounded-lg border border-line hover:border-navy-600/50 transition-colors">
                        <div>
                            <span className="font-display font-bold uppercase text-[color:var(--text)] block">Roll Over Winnings (Quarterly)</span>
                            <span className="text-xs text-faint">Unclaimed quarter prizes move to the next quarter.</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={gameState.ruleVariations.quarterlyRollover}
                            onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations, quarterlyRollover: e.target.checked } })}
                            className="size-6 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800 focus:ring-navy-600"
                        />
                    </label>

                    {gameState.ruleVariations.quarterlyRollover && !gameState.ruleVariations.scoreChangePayout && (
                        <div className="animate-in fade-in slide-in-from-top-2 p-4 bg-card/50 border border-line rounded-lg">
                            <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-3">Final Score Unclaimed Logic</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <button
                                    onClick={() => updateConfig({ ruleVariations: { ...gameState.ruleVariations, unclaimedFinalPrizeStrategy: 'last_winner' } })}
                                    className={`p-3 rounded-lg border text-left transition-all ${gameState.ruleVariations.unclaimedFinalPrizeStrategy === 'last_winner' || !gameState.ruleVariations.unclaimedFinalPrizeStrategy ? 'bg-navy-600/20 border-navy-600 text-navy-600 dark:text-navy-500' : 'bg-page border-line text-muted hover:border-navy-600'}`}
                                >
                                    <div className="font-display font-bold uppercase text-sm mb-1">Option A: Last Winner</div>
                                    <div className="text-xs opacity-80">Award prize to the most recent previous winner (e.g. Q3).</div>
                                </button>

                                <button
                                    onClick={handleRandomDrawClick}
                                    className={`p-3 rounded-lg border text-left transition-all ${gameState.ruleVariations.unclaimedFinalPrizeStrategy === 'random' ? 'bg-navy-600/20 border-navy-600 text-navy-600 dark:text-navy-500' : 'bg-page border-line text-muted hover:border-navy-600'}`}
                                >
                                    <div className="font-display font-bold uppercase text-sm mb-1">Option B: Random Draw</div>
                                    <div className="text-xs opacity-80">Activates a "Randomizer" button to pick a lucky square.</div>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Random Draw Warning Modal */}
            {showRandomDrawWarning && (
                <OverlayRoot id="squares-random-draw-warning" label="Random draw warning" onEscape={() => setShowRandomDrawWarning(false)} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-in fade-in">
                    <div className="bg-surface border border-gold-500/50 rounded-2xl p-6 max-w-md mx-4 shadow-panel animate-in zoom-in-95">
                        <div className="flex items-start gap-4 mb-4">
                            <div className="p-3 bg-gold-500/20 rounded-xl text-gold-700 dark:text-gold-400">
                                <AlertTriangle size={24} />
                            </div>
                            <div>
                                <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] mb-1">Random Draw Warning</h3>
                                <p className="text-muted text-sm leading-relaxed">
                                    Choosing <strong className="text-gold-700 dark:text-gold-400">Random Draw</strong> means that if the Final winning square is empty,
                                    you will need to manually click a "Randomizer" button after the game ends to pick a lucky square that receives the rollover pot.
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-faint mb-6 pl-16">
                            This requires action from you after the game. Are you sure you want this option?
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowRandomDrawWarning(false)}
                                className="px-4 py-2 text-muted hover:text-[color:var(--text)] transition-colors font-display font-bold uppercase tracking-[0.05em]"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmRandomDraw}
                                className="px-4 py-2 bg-gold-foil hover:brightness-105 text-navy-900 font-display font-bold uppercase tracking-[0.05em] rounded-md shadow-[0_6px_16px_rgba(140,109,51,0.28)] transition-all duration-150 hover:-translate-y-px"
                            >
                                Yes, Use Random Draw
                            </button>
                        </div>
                    </div>
                </OverlayRoot>
            )}
        </div>
    );
};

export default WizardStepPayouts;

