import React, { useEffect, useMemo, useState } from 'react';
import { DollarSign, CheckCircle2, AlertCircle, Receipt, History } from 'lucide-react';
import type { Pool, User } from '../types';
import { subscribeToPaymentLedger, type PaymentLedgerEvent } from '../services/paymentService';
import { formatDeadline } from '../utils/formatTime';
import { Badge } from './ui';

interface PaymentsPanelProps {
    pool: Pool;
    user: User;
    /** Pool entries (already live-subscribed by the parent dashboard) */
    entries: any[];
    /** Member Records — the full roster incl. members without an entry (ADR 0003) */
    members?: any[];
    isManager?: boolean;
    /** Jump to the Commissioner view where paid status is managed */
    onManagePayments?: () => void;
}

/** Turn bare URLs in commissioner payment instructions into tappable links */
const linkify = (text: string): React.ReactNode[] => {
    const parts = text.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) =>
        /^https?:\/\//.test(part)
            ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-gold-700 dark:text-gold-400 underline break-all">{part}</a>
            : <span key={i}>{part}</span>
    );
};

const EVENT_LABELS: Record<PaymentLedgerEvent['type'], { label: string; tone: string }> = {
    MARKED_PAID: { label: 'marked PAID', tone: 'text-[#0F7B4A] dark:text-[#3FB77F]' },
    MARKED_UNPAID: { label: 'marked UNPAID', tone: 'text-[#B4530A] dark:text-[#E8853D]' },
    REBUY_DUE: { label: 'rebuy — dues added', tone: 'text-gold-700 dark:text-gold-400' },
    REBUY_SETTLED: { label: 'rebuy dues settled', tone: 'text-[#0F7B4A] dark:text-[#3FB77F]' },
    REBUY_UNSETTLED: { label: 'rebuy settlement reversed', tone: 'text-[#B4530A] dark:text-[#E8853D]' },
    PAYOUT_PAID: { label: 'payout sent', tone: 'text-[#0F7B4A] dark:text-[#3FB77F]' },
    PAYOUT_UNPAID: { label: 'payout mark reversed', tone: 'text-[#B4530A] dark:text-[#E8853D]' },
};

/**
 * Member-facing money view: what do I owe, am I marked paid, what's the pot,
 * and the shared timestamped ledger of every payment-state change.
 */
export const PaymentsPanel: React.FC<PaymentsPanelProps> = ({ pool, user, entries, members = [], isManager, onManagePayments }) => {
    const castPool = pool as any;
    const [ledger, setLedger] = useState<PaymentLedgerEvent[]>([]);

    useEffect(() => {
        return subscribeToPaymentLedger(pool.id, setLedger);
    }, [pool.id]);

    const entryFee: number = castPool.settings?.entryFee ?? 0;
    const rebuyCost: number = castPool.settings?.rebuyCost ?? entryFee;
    const paymentInstructions: string = castPool.settings?.paymentInstructions || '';

    const myEntry = useMemo(() => entries.find(e => e.ownerUid === user.id) ?? null, [entries, user.id]);
    const myMember = useMemo(() => members.find(m => m.uid === user.id) ?? null, [members, user.id]);
    const isPaid = (myMember?.paidStatus ?? myEntry?.paidStatus) === 'PAID';
    const myRebuys: number = myEntry?.rebuysUsed ?? 0;
    const myTotalDue = entryFee + myRebuys * rebuyCost;

    // Pot: prefer the Member Record roster (everyone who joined) so the count and expected
    // dues are right even before members submit entries; fall back to entries pre-backfill.
    const pot = useMemo(() => {
        const realParticipants = ((castPool.participantIds || []) as string[]).filter(id => id && id !== 'guest');
        const memberCount = Math.max(members.length, realParticipants.length, entries.length);
        const paidSource = members.length > 0 ? members : entries;
        const paid = paidSource.filter((m: any) => m.paidStatus === 'PAID').length;
        const totalRebuys = entries.reduce((sum, e) => sum + (e.rebuysUsed ?? 0), 0);
        return {
            paidCount: paid,
            unpaidCount: Math.max(0, memberCount - paid),
            collected: paid * entryFee + totalRebuys * rebuyCost,
            expected: memberCount * entryFee + totalRebuys * rebuyCost,
        };
    }, [members, entries, castPool.participantIds, entryFee, rebuyCost]);

    return (
        <div className="space-y-6">
            {/* Commissioner controls — manage everyone's paid status in the Commissioner view */}
            {isManager && (
                <div className="rounded-3xl border border-gold-500/30 bg-gold-400/5 p-5 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-lg bg-gold-400/10 border border-gold-500/30 text-gold-700 dark:text-gold-400">
                            <DollarSign size={18} />
                        </div>
                        <div>
                            <p className="font-display font-bold uppercase text-[13px] tracking-[0.04em] text-[color:var(--text)]">You are the commissioner</p>
                            <p className="text-[12px] text-muted font-body">Mark members paid, see everyone who joined, and send payment or picks reminders.</p>
                        </div>
                    </div>
                    {onManagePayments && (
                        <button onClick={onManagePayments} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-navy-800 hover:bg-navy-700 text-white font-display font-bold uppercase text-[11px] tracking-[0.08em] transition-colors">
                            <Receipt size={14} /> Edit / Manage Payments
                        </button>
                    )}
                </div>
            )}
            {/* My status */}
            <div className={`rounded-3xl border p-6 ${isPaid ? 'bg-[#0F7B4A]/5 border-[#0F7B4A]/30' : 'bg-[#B4530A]/5 border-[#B4530A]/30'}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <span className="font-display font-bold uppercase text-[12px] tracking-[0.16em] text-muted block mb-1">Your Payment Status</span>
                        <div className="flex items-center gap-2">
                            {isPaid
                                ? <CheckCircle2 size={20} className="text-[#0F7B4A] dark:text-[#3FB77F]" aria-hidden="true" />
                                : <AlertCircle size={20} className="text-[#B4530A] dark:text-[#E8853D]" aria-hidden="true" />}
                            <Badge status={isPaid ? 'paid' : 'unpaid'} className="text-[15px]">
                                {isPaid ? 'PAID' : 'UNPAID'}
                            </Badge>
                        </div>
                        {!isPaid && myTotalDue > 0 && (
                            <p className="text-sm font-body font-bold text-[color:var(--text)] mt-2">
                                You owe <span className="text-gold-700 dark:text-gold-400 num">${myTotalDue}</span>
                                {myRebuys > 0 && <span className="text-muted num"> (${entryFee} entry + {myRebuys} rebuy{myRebuys > 1 ? 's' : ''} × ${rebuyCost})</span>}
                                {' '}to the commissioner.
                            </p>
                        )}
                        {isPaid && (
                            <p className="text-xs font-body text-muted mt-2">
                                Marked paid by the commissioner — see the ledger below for the timestamped record.
                            </p>
                        )}
                    </div>
                    {entryFee > 0 && (
                        <div className="text-right">
                            <span className="font-display font-bold uppercase text-[12px] tracking-[0.16em] text-muted block">Entry Fee</span>
                            <span className="font-display font-bold text-2xl text-gold-700 dark:text-gold-400 num">${entryFee}</span>
                        </div>
                    )}
                </div>

                {!isPaid && paymentInstructions && (
                    <div className="mt-4 pt-4 border-t border-line">
                        <span className="font-display font-bold uppercase text-[12px] tracking-[0.16em] text-muted block mb-1">How to Pay</span>
                        <p className="text-sm font-body text-[color:var(--text)] leading-relaxed">{linkify(paymentInstructions)}</p>
                    </div>
                )}
            </div>

            {/* Pool pot */}
            <div className="bg-card border border-line rounded-3xl p-6 shadow-card">
                <div className="flex items-center gap-2 mb-4">
                    <DollarSign size={16} className="text-gold-600 dark:text-gold-400" aria-hidden="true" />
                    <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.16em] text-muted">Pool Pot</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                        <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block">Collected</span>
                        <span className="font-display font-bold text-xl text-gold-700 dark:text-gold-400 num">${pot.collected}</span>
                    </div>
                    <div>
                        <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block">Expected</span>
                        <span className="font-display font-bold text-xl text-gold-700 dark:text-gold-400 num">${pot.expected}</span>
                    </div>
                    <div>
                        <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block">Paid Members</span>
                        <span className="font-display font-bold text-xl text-[color:var(--text)] num">{pot.paidCount}</span>
                    </div>
                    <div>
                        <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted block">Unpaid</span>
                        <span className={`font-display font-bold text-xl num ${pot.unpaidCount > 0 ? 'text-[#B4530A] dark:text-[#E8853D]' : 'text-faint'}`}>{pot.unpaidCount}</span>
                    </div>
                </div>
                <p className="text-[11px] font-body text-faint mt-4">
                    Dues are collected and prizes paid out by your commissioner, not by March Melee Pools.
                </p>
            </div>

            {/* Ledger */}
            <div className="bg-card border border-line rounded-3xl p-6 shadow-card">
                <div className="flex items-center gap-2 mb-4">
                    <History size={16} className="text-gold-600 dark:text-gold-400" aria-hidden="true" />
                    <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.16em] text-muted">Payment Ledger</h3>
                </div>
                {ledger.length === 0 ? (
                    <p className="text-sm font-body text-muted">
                        No payment activity recorded yet. Every paid/unpaid mark and rebuy shows up here with a timestamp.
                    </p>
                ) : (
                    <ul className="divide-y divide-line">
                        {ledger.map(ev => {
                            const meta = EVENT_LABELS[ev.type] ?? { label: ev.type, tone: 'text-muted' };
                            const mine = ev.uid === user.id;
                            return (
                                <li key={ev.id} className={`py-2.5 flex items-center gap-3 text-sm font-body ${mine ? '' : 'opacity-80'}`}>
                                    <Receipt size={14} className="text-faint shrink-0" aria-hidden="true" />
                                    <span className="flex-1 min-w-0">
                                        <span className={`font-bold ${mine ? 'text-[color:var(--text)]' : 'text-muted'}`}>
                                            {mine ? 'You' : (ev.entryName || 'A member')}
                                        </span>{' '}
                                        <span className={`font-bold ${meta.tone}`}>{meta.label}</span>
                                        {typeof ev.amount === 'number' && <span className="text-gold-700 dark:text-gold-400 num"> · ${ev.amount}</span>}
                                        {ev.note && <span className="text-faint"> · {ev.note}</span>}
                                    </span>
                                    <span className="text-[11px] text-faint whitespace-nowrap shrink-0 num">{formatDeadline(ev.at)}</span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};
