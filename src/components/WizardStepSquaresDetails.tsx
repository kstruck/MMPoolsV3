import React from 'react';
import { DollarSign, Shield, Trophy } from 'lucide-react';
import type { GameState } from '../types';
import { Button } from './ui';

interface WizardStepSquaresDetailsProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    onNext: () => void;
    onBack: () => void;
}

export const WizardStepSquaresDetails: React.FC<WizardStepSquaresDetailsProps> = ({ gameState, updateConfig, onNext, onBack }) => {

    const totalPayout = (gameState.payouts.q1 || 0) + (gameState.payouts.half || 0) + (gameState.payouts.q3 || 0) + (gameState.payouts.final || 0);
    const isValidPayout = totalPayout === 100;

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">

            {/* COST & LIMITS */}
            <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-6 flex items-center gap-2">
                    <DollarSign className="text-gold-500" /> Entry Settings
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-2">Cost Per Square</label>
                        <div className="relative">
                            <span className="absolute left-3 top-3 text-faint font-bold">$</span>
                            <input
                                type="number"
                                min="0"
                                value={gameState.costPerSquare}
                                onChange={(e) => updateConfig({ costPerSquare: Number(e.target.value) })}
                                className="w-full rounded-md border-[1.5px] border-line bg-page pl-8 pr-4 py-3 font-body font-bold text-lg text-[color:var(--text)] num transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-2">Max Squares Per Player</label>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={gameState.maxSquaresPerPlayer}
                            onChange={(e) => updateConfig({ maxSquaresPerPlayer: Number(e.target.value) })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body font-bold text-lg text-[color:var(--text)] num transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                        />
                        <p className="text-xs text-faint mt-1">Set to 100 for unlimited.</p>
                    </div>

                    {/* NEW FIELDS MATCHING ADMIN PANEL */}
                    <div>
                        <label className="block text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-2">Number Sets</label>
                        <select
                            value={gameState.numberSets}
                            onChange={(e) => updateConfig({ numberSets: parseInt(e.target.value) || 1 })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none cursor-pointer"
                        >
                            <option value="1">Single Set (Same numbers all game)</option>
                            <option value="4">4 Sets (New numbers every quarter)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-2">Show "Paid" Status</label>
                        <select
                            value={gameState.showPaid ? 'Yes' : 'No'}
                            onChange={(e) => updateConfig({ showPaid: e.target.value === 'Yes' })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none cursor-pointer"
                        >
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* PAYOUTS */}
            <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                        <Trophy className="text-gold-500" /> Payout Structure
                    </h3>
                    <span className={`text-sm font-display font-bold uppercase tracking-[0.05em] num px-3 py-1 rounded border ${isValidPayout ? 'bg-[#E4F5EC] text-[#0F7B4A] border-[#BEE7D0]' : 'bg-transparent text-brandred-600 border-brandred-500'}`}>
                        Total: {totalPayout}%
                    </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                        { key: 'q1', label: '1st Quarter' },
                        { key: 'half', label: 'Halftime' },
                        { key: 'q3', label: '3rd Quarter' },
                        { key: 'final', label: 'Final Score' }
                    ].map((p) => (
                        <div key={p.key}>
                            <label className="block text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-2">{p.label}</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={(gameState.payouts as any)[p.key]}
                                    onChange={(e) => updateConfig({
                                        payouts: { ...gameState.payouts, [p.key]: Number(e.target.value) }
                                    })}
                                    className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2 font-body font-bold text-[15px] text-[color:var(--text)] num transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                />
                                <span className="absolute right-3 top-2 text-faint font-bold">%</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* RULES */}
            <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-6 flex items-center gap-2">
                    <Shield className="text-gold-500" /> Advanced Rules
                </h3>
                <div className="space-y-4">
                    <label className="flex items-center justify-between p-3 rounded hover:bg-surface cursor-pointer transition-colors">
                        <div>
                            <span className="block text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em]">Quarterly Rollover</span>
                            <span className="text-xs font-body text-muted">If a quarter has no winner (empty square), add prize to next quarter.</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={gameState.ruleVariations?.quarterlyRollover}
                            onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations!, quarterlyRollover: e.target.checked } })}
                            className="w-6 h-6 rounded border-line accent-navy-800"
                        />
                    </label>

                    <label className="flex items-center justify-between p-3 rounded hover:bg-surface cursor-pointer transition-colors">
                        <div>
                            <span className="block text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em]">Reverse Winners (Loser Pool)</span>
                            <span className="text-xs font-body text-muted">Winning numbers are determined by the reverse of the score (e.g. 21 &rarr; 12).</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={gameState.ruleVariations?.reverseWinners}
                            onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations!, reverseWinners: e.target.checked } })}
                            className="w-6 h-6 rounded border-line accent-navy-800"
                        />
                    </label>
                    <label className="flex items-center justify-between p-3 rounded hover:bg-surface cursor-pointer transition-colors">
                        <div>
                            <span className="block text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em]">Every Score Pays</span>
                            <span className="text-xs font-body text-muted">Award a small prize for every score change (touchdown/field goal).</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={gameState.ruleVariations?.scoreChangePayout}
                            onChange={(e) => updateConfig({ ruleVariations: { ...gameState.ruleVariations!, scoreChangePayout: e.target.checked } })}
                            className="w-6 h-6 rounded border-line accent-navy-800"
                        />
                    </label>
                </div>
            </div>

            {/* NAVIGATION */}
            <div className="flex justify-between pt-6 border-t border-line">
                <Button variant="ghost" size="sm" onClick={onBack}>Back</Button>
                <Button
                    variant="primary"
                    onClick={onNext}
                    disabled={!isValidPayout}
                >
                    Next: Branding
                </Button>
            </div>
        </div>
    );
};
