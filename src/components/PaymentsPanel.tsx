import React, { useEffect, useMemo, useState } from 'react';
import { DollarSign, CheckCircle2, AlertCircle, Receipt, History } from 'lucide-react';
import type { Pool, User } from '../types';
import { subscribeToPaymentLedger, type PaymentLedgerEvent } from '../services/paymentService';
import { formatDeadline } from '../utils/formatTime';

interface PaymentsPanelProps {
    pool: Pool;
    user: User;
    /** Pool entries (already live-subscribed by the parent dashboard) */
    entries: any[];
}

/** Turn bare URLs in commissioner payment instructions into tappable links */
const linkify = (text: string): React.ReactNode[] => {
    const parts = text.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) =>
        /^https?:\/\//.test(part)
            ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline break-all">{part}</a>
            : <span key={i}>{part}</span>
    );
};

const EVENT_LABELS: Record<PaymentLedgerEvent['type'], { label: string; tone: string }> = {
    MARKED_PAID: { label: 'marked PAID', tone: 'text-emerald-400' },
    MARKED_UNPAID: { label: 'marked UNPAID', tone: 'text-rose-400' },
    REBUY_DUE: { label: 'rebuy — dues added', tone: 'text-amber-400' },
    PAYOUT_PAID: { label: 'payout sent', tone: 'text-emerald-400' },
    PAYOUT_UNPAID: { label: 'payout mark reversed', tone: 'text-rose-400' },
};

/**
 * Member-facing money view: what do I owe, am I marked paid, what's the pot,
 * and the shared timestamped ledger of every payment-state change.
 */
export const PaymentsPanel: React.FC<PaymentsPanelProps> = ({ pool, user, entries }) => {
    const castPool = pool as any;
    const [ledger, setLedger] = useState<PaymentLedgerEvent[]>([]);

    useEffect(() => {
        return subscribeToPaymentLedger(pool.id, setLedger);
    }, [pool.id]);

    const entryFee: number = castPool.settings?.entryFee ?? 0;
    const rebuyCost: number = castPool.settings?.rebuyCost ?? entryFee;
    const paymentInstructions: string = castPool.settings?.paymentInstructions || '';

    const myEntry = useMemo(() => entries.find(e => e.ownerUid === user.id) ?? null, [entries, user.id]);
    const isPaid = myEntry?.paidStatus === 'PAID';
    const myRebuys: number = myEntry?.rebuysUsed ?? 0;
    const myTotalDue = entryFee + myRebuys * rebuyCost;

    const pot = useMemo(() => {
        const paid = entries.filter(e => e.paidStatus === 'PAID').length;
        const totalRebuys = entries.reduce((sum, e) => sum + (e.rebuysUsed ?? 0), 0);
        return {
            paidCount: paid,
            unpaidCount: entries.length - paid,
            collected: paid * entryFee + totalRebuys * rebuyCost,
            expected: entries.length * entryFee + totalRebuys * rebuyCost,
        };
    }, [entries, entryFee, rebuyCost]);

    return (
        <div className="space-y-6">
            {/* My status */}
            <div className={`rounded-3xl border p-6 ${isPaid ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-amber-500/5 border-amber-500/30'}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Your Payment Status</span>
                        <div className="flex items-center gap-2">
                            {isPaid
                                ? <CheckCircle2 size={20} className="text-emerald-400" aria-hidden="true" />
                                : <AlertCircle size={20} className="text-amber-400" aria-hidden="true" />}
                            <span className={`text-xl font-black ${isPaid ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {isPaid ? 'PAID' : 'UNPAID'}
                            </span>
                        </div>
                        {!isPaid && myTotalDue > 0 && (
                            <p className="text-sm font-bold text-slate-300 mt-2">
                                You owe <span className="text-white">${myTotalDue}</span>
                                {myRebuys > 0 && <span className="text-slate-400"> (${entryFee} entry + {myRebuys} rebuy{myRebuys > 1 ? 's' : ''} × ${rebuyCost})</span>}
                                {' '}to the commissioner.
                            </p>
                        )}
                        {isPaid && (
                            <p className="text-xs text-slate-400 mt-2">
                                Marked paid by the commissioner — see the ledger below for the timestamped record.
                            </p>
                        )}
                    </div>
                    {entryFee > 0 && (
                        <div className="text-right">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">Entry Fee</span>
                            <span className="text-2xl font-black text-white">${entryFee}</span>
                        </div>
                    )}
                </div>

                {!isPaid && paymentInstructions && (
                    <div className="mt-4 pt-4 border-t border-slate-800">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">How to Pay</span>
                        <p className="text-sm text-slate-300 leading-relaxed">{linkify(paymentInstructions)}</p>
                    </div>
                )}
            </div>

            {/* Pool pot */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <DollarSign size={16} className="text-slate-500" aria-hidden="true" />
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Pool Pot</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase block">Collected</span>
                        <span className="text-xl font-black text-emerald-400">${pot.collected}</span>
                    </div>
                    <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase block">Expected</span>
                        <span className="text-xl font-black text-white">${pot.expected}</span>
                    </div>
                    <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase block">Paid Members</span>
                        <span className="text-xl font-black text-white">{pot.paidCount}</span>
                    </div>
                    <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase block">Unpaid</span>
                        <span className={`text-xl font-black ${pot.unpaidCount > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{pot.unpaidCount}</span>
                    </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-4">
                    Dues are collected and prizes paid out by your commissioner, not by March Melee Pools.
                </p>
            </div>

            {/* Ledger */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <History size={16} className="text-slate-500" aria-hidden="true" />
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Payment Ledger</h3>
                </div>
                {ledger.length === 0 ? (
                    <p className="text-sm text-slate-500">
                        No payment activity recorded yet. Every paid/unpaid mark and rebuy shows up here with a timestamp.
                    </p>
                ) : (
                    <ul className="divide-y divide-slate-800/60">
                        {ledger.map(ev => {
                            const meta = EVENT_LABELS[ev.type] ?? { label: ev.type, tone: 'text-slate-400' };
                            const mine = ev.uid === user.id;
                            return (
                                <li key={ev.id} className={`py-2.5 flex items-center gap-3 text-sm ${mine ? '' : 'opacity-80'}`}>
                                    <Receipt size={14} className="text-slate-600 shrink-0" aria-hidden="true" />
                                    <span className="flex-1 min-w-0">
                                        <span className={`font-bold ${mine ? 'text-white' : 'text-slate-300'}`}>
                                            {mine ? 'You' : (ev.entryName || 'A member')}
                                        </span>{' '}
                                        <span className={`font-bold ${meta.tone}`}>{meta.label}</span>
                                        {typeof ev.amount === 'number' && <span className="text-slate-400"> · ${ev.amount}</span>}
                                        {ev.note && <span className="text-slate-500"> · {ev.note}</span>}
                                    </span>
                                    <span className="text-[11px] text-slate-500 whitespace-nowrap shrink-0">{formatDeadline(ev.at)}</span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};
