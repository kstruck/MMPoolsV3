import React from 'react';
import {
    Trophy, Users, DollarSign, Calendar, Shield, Bell,
    CheckCircle, AlertCircle, Zap, Palette, Edit3, ShieldCheck
} from 'lucide-react';
import type { GameState } from '../../types';
import { BillingInvoiceCard } from '../billing/BillingInvoiceCard';

interface WizardStepSummaryProps {
    gameState: GameState;
    onEditStep: (step: number) => void;
    onTosAcceptChange?: (accepted: boolean) => void;
    onCouponAppliedChange?: (couponCode: string | null, finalPrice: number) => void;
    updateConfig: (updates: Partial<GameState>) => void;
}

const SummaryCard = ({ title, icon: Icon, children, step, onEditStep }: {
    title: string;
    icon: React.ElementType;
    children: React.ReactNode;
    step: number;
    color?: string;
    onEditStep: (step: number) => void;
}) => (
    <div className="bg-surface border border-line rounded-xl p-5 relative group">
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-navy-600/20 text-navy-600 dark:text-navy-500">
                    <Icon size={18} />
                </div>
                <h4 className="font-display font-bold uppercase text-[color:var(--text)]">{title}</h4>
            </div>
            <button
                onClick={() => onEditStep(step)}
                className="hover-reveal transition-opacity p-1.5 hover:bg-card rounded text-muted hover:text-[color:var(--text)]"
                title={`Edit ${title}`}
                aria-label={`Edit ${title}`}
            >
                <Edit3 size={14} />
            </button>
        </div>
        <div className="space-y-2 text-sm">{children}</div>
    </div>
);

const InfoRow = ({ label, value, highlight = false }: { label: string; value: React.ReactNode; highlight?: boolean }) => (
    <div className="flex justify-between items-center py-1">
        <span className="text-muted">{label}</span>
        <span className={highlight ? 'num text-gold-700 dark:text-gold-400 font-bold' : 'num text-[color:var(--text)] font-medium'}>{value}</span>
    </div>
);

const StatusBadge = ({ active, label }: { active: boolean; label: string }) => (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${active ? 'bg-[#0F7B4A]/20 text-[#0F7B4A]' : 'bg-card text-muted'
        }`}>
        {active ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
        {label}
    </span>
);

/**
 * Wizard Step 9: Pool Summary
 * Displays a comprehensive summary of all pool configuration before launch.
 */
export const WizardStepSummary: React.FC<WizardStepSummaryProps> = ({ 
    gameState, 
    onEditStep,
    onTosAcceptChange,
    onCouponAppliedChange,
    updateConfig
}) => {
    const totalPot = gameState.costPerSquare * 100;
    const charityAmount = gameState.charity?.enabled ? totalPot * (gameState.charity.percentage / 100) : 0;
    const netPot = totalPot - charityAmount;

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="bg-gradient-to-r from-navy-800/20 to-navy-600/20 border border-navy-600/30 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-navy-800 rounded-xl text-white">
                        <Trophy size={24} />
                    </div>
                    <div>
                        <h3 className="text-2xl font-display font-bold uppercase text-[color:var(--text)]">{gameState.name || 'Unnamed Pool'}</h3>
                        <p className="text-muted text-sm">Review your pool configuration before launching</p>
                    </div>
                </div>
            </div>

            {/* Summary Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Matchup Info */}
                <SummaryCard title="Matchup" icon={Calendar} step={1} onEditStep={onEditStep}>
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
                <SummaryCard title="Pool Basics" icon={Users} step={2} onEditStep={onEditStep}>
                    <InfoRow label="URL Slug" value={`/${gameState.urlSlug}`} />
                    <InfoRow label="Manager" value={gameState.managerName || 'Not Set'} />
                    <InfoRow label="Contact" value={gameState.contactEmail || 'Not Set'} />
                    <InfoRow label="Visibility" value={gameState.isPublic ? 'Public' : 'Private'} />
                </SummaryCard>

                {/* Grid Rules */}
                <SummaryCard title="Grid Rules" icon={DollarSign} step={3} color="emerald" onEditStep={onEditStep}>
                    <InfoRow label="Cost Per Square" value={`$${gameState.costPerSquare}`} highlight />
                    <InfoRow label="Max Per Player" value={gameState.maxSquaresPerPlayer} />
                    <InfoRow label="Number Sets" value={gameState.numberSets === 4 ? '4 Sets (Quarterly)' : 'Single Set'} />
                    <InfoRow label="Show Paid Status" value={gameState.showPaid ? 'Yes' : 'No'} />
                </SummaryCard>

                {/* Payout Config */}
                <SummaryCard title="Payouts" icon={Trophy} step={4} color="amber" onEditStep={onEditStep}>
                    <InfoRow label="Total Pot (100 sq)" value={`$${totalPot.toLocaleString()}`} highlight />
                    {gameState.charity?.enabled && (
                        <InfoRow label="Charity Deduction" value={`-$${charityAmount.toLocaleString()} (${gameState.charity.percentage}%)`} />
                    )}
                    <InfoRow label="Net Prize Pool" value={`$${netPot.toLocaleString()}`} highlight />
                    <div className="border-t border-line mt-2 pt-2">
                        {gameState.ruleVariations.scoreChangePayout ? (
                            <div className="flex items-center gap-2 text-[#5B2A86]">
                                <Zap size={14} />
                                <span className="font-display font-bold uppercase">Every Score Pays Mode</span>
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
                <SummaryCard title="Side Hustle (Props)" icon={Zap} step={5} color="purple" onEditStep={onEditStep}>
                    <StatusBadge active={gameState.props?.enabled || false} label={gameState.props?.enabled ? 'Enabled' : 'Disabled'} />
                    {gameState.props?.enabled && (
                        <>
                            <InfoRow label="Cost Per Card" value={`$${gameState.props.cost || 0}`} />
                            <InfoRow label="Questions" value={gameState.props.questions?.length || 0} />
                        </>
                    )}
                </SummaryCard>

                {/* Branding */}
                <SummaryCard title="Branding" icon={Palette} step={6} color="pink" onEditStep={onEditStep}>
                    <InfoRow label="Theme" value={gameState.theme || 'Default'} />
                    <InfoRow label="Custom Theme" value={gameState.themeId ? 'Custom' : 'Preset'} />
                </SummaryCard>

                {/* Reminders & Lock */}
                <SummaryCard title="Automation" icon={Bell} step={7} color="rose" onEditStep={onEditStep}>
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
                <SummaryCard title="Final Preferences" icon={Shield} step={8} onEditStep={onEditStep}>
                    <div className="flex flex-wrap gap-2 mb-2">
                        <StatusBadge active={gameState.collectPhone || false} label="Phone" />
                        <StatusBadge active={gameState.collectAddress || false} label="Address" />
                        <StatusBadge active={gameState.collectReferral || false} label="Referral" />
                        <StatusBadge active={gameState.collectNotes || false} label="Notes" />
                    </div>
                    <div className="border-t border-line pt-2 mt-2">
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

            {/* Billing invoice card */}
            <BillingInvoiceCard
                poolName={gameState.name || 'New Pool'}
                poolType="SQUARES"
                estimatedPlayers={100} // Gameday Squares is always 100 squares
                hasAiCommissioner={gameState.billing?.featuresUnlocked?.aiCommissioner || false}
                isWizard={true}
                onTosAcceptChange={onTosAcceptChange}
                onCouponAppliedChange={onCouponAppliedChange}
                initialCouponCode={gameState.billing?.couponCode || ''}
                onFeatureToggle={(featureKey, enabled) => {
                    const currentBilling: any = gameState.billing || {};
                    const currentFeatures = currentBilling.featuresUnlocked || {};
                    updateConfig({
                        billing: {
                            ...currentBilling,
                            featuresUnlocked: {
                                ...currentFeatures,
                                [featureKey]: enabled
                            }
                        } as any
                    });
                }}
            />

            <div className="mt-4 p-4 bg-card/60 border border-line rounded-2xl flex gap-3 items-start animate-in fade-in duration-300 text-muted text-xs text-left">
                <ShieldCheck className="text-navy-600 dark:text-navy-500 shrink-0 mt-0.5" size={20} />
                <div>
                    <strong className="text-[color:var(--text)] block mb-0.5">100% Free Trial Setup</strong>
                    Set up rules, invite participants, and run your pool completely free for 14 days! Pay only when you are ready to upgrade.
                </div>
            </div>

            {/* Launch Checklist */}
            <div className="bg-surface border border-line rounded-xl p-6">
                <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                    <CheckCircle className="text-[#0F7B4A]" size={18} />
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
                        <div key={idx} className={`flex items-center gap-2 p-2 rounded ${item.check ? 'text-[#0F7B4A]' : 'text-brandred-600'}`}>
                            {item.check ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                            <span className="text-sm">{item.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
