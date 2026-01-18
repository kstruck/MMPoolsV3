import React from 'react';
import {
    Trophy, Users, DollarSign, Calendar, Shield, Bell,
    CheckCircle, AlertCircle, Zap, Palette, Edit3
} from 'lucide-react';
import type { GameState } from '../../types';

interface WizardStepSummaryProps {
    gameState: GameState;
    onEditStep: (step: number) => void;
}

/**
 * Wizard Step 9: Pool Summary
 * Displays a comprehensive summary of all pool configuration before launch.
 */
export const WizardStepSummary: React.FC<WizardStepSummaryProps> = ({ gameState, onEditStep }) => {
    const totalPot = gameState.costPerSquare * 100;
    const charityAmount = gameState.charity?.enabled ? totalPot * (gameState.charity.percentage / 100) : 0;
    const netPot = totalPot - charityAmount;

    const SummaryCard = ({ title, icon: Icon, children, step, color = 'indigo' }: {
        title: string;
        icon: React.ElementType;
        children: React.ReactNode;
        step: number;
        color?: string;
    }) => (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 relative group">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg bg-${color}-500/20 text-${color}-400`}>
                        <Icon size={18} />
                    </div>
                    <h4 className="font-bold text-white">{title}</h4>
                </div>
                <button
                    onClick={() => onEditStep(step)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                    title={`Edit ${title}`}
                >
                    <Edit3 size={14} />
                </button>
            </div>
            <div className="space-y-2 text-sm">{children}</div>
        </div>
    );

    const InfoRow = ({ label, value, highlight = false }: { label: string; value: React.ReactNode; highlight?: boolean }) => (
        <div className="flex justify-between items-center py-1">
            <span className="text-slate-400">{label}</span>
            <span className={highlight ? 'text-emerald-400 font-bold' : 'text-white font-medium'}>{value}</span>
        </div>
    );

    const StatusBadge = ({ active, label }: { active: boolean; label: string }) => (
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'
            }`}>
            {active ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
            {label}
        </span>
    );

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border border-indigo-500/30 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-indigo-500 rounded-xl text-white">
                        <Trophy size={24} />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-white">{gameState.name || 'Unnamed Pool'}</h3>
                        <p className="text-indigo-300 text-sm">Review your pool configuration before launching</p>
                    </div>
                </div>
            </div>

            {/* Summary Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Matchup Info */}
                <SummaryCard title="Matchup" icon={Calendar} step={1}>
                    <InfoRow label="Home Team" value={gameState.homeTeam || 'Not Set'} />
                    <InfoRow label="Away Team" value={gameState.awayTeam || 'Not Set'} />
                    <InfoRow label="League" value={gameState.league?.toUpperCase() || 'NFL'} />
                    {gameState.gameId && <InfoRow label="ESPN Linked" value="✓ Yes" highlight />}
                    {gameState.scores.startTime && (
                        <InfoRow
                            label="Kickoff"
                            value={new Date(gameState.scores.startTime).toLocaleString([], {
                                dateStyle: 'medium',
                                timeStyle: 'short'
                            })}
                        />
                    )}
                </SummaryCard>

                {/* Basic Info */}
                <SummaryCard title="Pool Basics" icon={Users} step={2}>
                    <InfoRow label="URL Slug" value={`/${gameState.urlSlug}`} />
                    <InfoRow label="Manager" value={gameState.managerName || 'Not Set'} />
                    <InfoRow label="Contact" value={gameState.contactEmail || 'Not Set'} />
                    <InfoRow label="Visibility" value={gameState.isPublic ? 'Public' : 'Private'} />
                </SummaryCard>

                {/* Grid Rules */}
                <SummaryCard title="Grid Rules" icon={DollarSign} step={3} color="emerald">
                    <InfoRow label="Cost Per Square" value={`$${gameState.costPerSquare}`} highlight />
                    <InfoRow label="Max Per Player" value={gameState.maxSquaresPerPlayer} />
                    <InfoRow label="Number Sets" value={gameState.numberSets === 4 ? '4 Sets (Quarterly)' : 'Single Set'} />
                    <InfoRow label="Show Paid Status" value={gameState.showPaid ? 'Yes' : 'No'} />
                </SummaryCard>

                {/* Payout Config */}
                <SummaryCard title="Payouts" icon={Trophy} step={4} color="amber">
                    <InfoRow label="Total Pot (100 sq)" value={`$${totalPot.toLocaleString()}`} highlight />
                    {gameState.charity?.enabled && (
                        <InfoRow label="Charity Deduction" value={`-$${charityAmount.toLocaleString()} (${gameState.charity.percentage}%)`} />
                    )}
                    <InfoRow label="Net Prize Pool" value={`$${netPot.toLocaleString()}`} highlight />
                    <div className="border-t border-slate-800 mt-2 pt-2">
                        {gameState.ruleVariations.scoreChangePayout ? (
                            <div className="flex items-center gap-2 text-indigo-400">
                                <Zap size={14} />
                                <span>Every Score Pays Mode</span>
                            </div>
                        ) : (
                            <>
                                <InfoRow label="Q1" value={`${gameState.payouts.q1}%`} />
                                <InfoRow label="Halftime" value={`${gameState.payouts.half}%`} />
                                <InfoRow label="Q3" value={`${gameState.payouts.q3}%`} />
                                <InfoRow label="Final" value={`${gameState.payouts.final}%`} />
                            </>
                        )}
                    </div>
                </SummaryCard>

                {/* Side Hustle (Props) */}
                <SummaryCard title="Side Hustle (Props)" icon={Zap} step={5} color="purple">
                    <StatusBadge active={gameState.props?.enabled || false} label={gameState.props?.enabled ? 'Enabled' : 'Disabled'} />
                    {gameState.props?.enabled && (
                        <>
                            <InfoRow label="Cost Per Card" value={`$${gameState.props.cost || 0}`} />
                            <InfoRow label="Questions" value={gameState.props.questions?.length || 0} />
                        </>
                    )}
                </SummaryCard>

                {/* Branding */}
                <SummaryCard title="Branding" icon={Palette} step={6} color="pink">
                    <InfoRow label="Theme" value={gameState.theme || 'Default'} />
                    <InfoRow label="Custom Theme" value={gameState.themeId ? 'Custom' : 'Preset'} />
                </SummaryCard>

                {/* Reminders & Lock */}
                <SummaryCard title="Automation" icon={Bell} step={7} color="rose">
                    <StatusBadge
                        active={gameState.reminders?.payment?.enabled || false}
                        label="Payment Reminders"
                    />
                    <StatusBadge
                        active={gameState.reminders?.lock?.enabled || false}
                        label="Auto-Lock"
                    />
                    {gameState.reminders?.lock?.enabled && gameState.reminders?.lock?.lockAt && (
                        <InfoRow
                            label="Lock Time"
                            value={new Date(gameState.reminders.lock.lockAt).toLocaleString([], {
                                dateStyle: 'short',
                                timeStyle: 'short'
                            })}
                        />
                    )}
                    <StatusBadge
                        active={gameState.reminders?.winner?.enabled || false}
                        label="Winner Emails"
                    />
                </SummaryCard>

                {/* Data Collection & Notifications */}
                <SummaryCard title="Final Preferences" icon={Shield} step={8}>
                    <div className="flex flex-wrap gap-2 mb-2">
                        <StatusBadge active={gameState.collectPhone || false} label="Phone" />
                        <StatusBadge active={gameState.collectAddress || false} label="Address" />
                        <StatusBadge active={gameState.collectReferral || false} label="Referral" />
                        <StatusBadge active={gameState.collectNotes || false} label="Notes" />
                    </div>
                    <div className="border-t border-slate-800 pt-2 mt-2">
                        <InfoRow
                            label="Email Receipts"
                            value={gameState.emailConfirmation === 'Email Confirmation' ? 'Yes' : 'No'}
                        />
                        <InfoRow
                            label="Grid Password"
                            value={gameState.gridPassword ? '••••••' : 'None'}
                        />
                    </div>
                </SummaryCard>
            </div>

            {/* Launch Checklist */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                    <CheckCircle className="text-emerald-400" size={18} />
                    Launch Checklist
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                        { check: !!gameState.homeTeam && !!gameState.awayTeam, label: 'Teams selected' },
                        { check: !!gameState.name, label: 'Pool name set' },
                        { check: gameState.costPerSquare > 0, label: 'Entry price configured' },
                        { check: (gameState.payouts.q1 + gameState.payouts.half + gameState.payouts.q3 + gameState.payouts.final === 100) || gameState.ruleVariations.scoreChangePayout, label: 'Payouts total 100%' },
                        { check: !!gameState.contactEmail, label: 'Contact email set' },
                        { check: !!gameState.managerName, label: 'Manager name set' },
                    ].map((item, idx) => (
                        <div key={idx} className={`flex items-center gap-2 p-2 rounded ${item.check ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {item.check ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                            <span className="text-sm">{item.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
