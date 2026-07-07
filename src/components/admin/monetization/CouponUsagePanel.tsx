import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { MonetizationCoupon } from '../../../services/dbService';
import {
    fmtDateTime,
    liveUseCount,
    pendingUseCount,
    confirmedUseCount,
    usesRemaining,
    isExpiringSoon,
    couponUsageMs,
    fmtDate,
} from './monetizationCalcs';

interface Props {
    coupons: MonetizationCoupon[];
    locked: boolean;
    /** "Save as template" on any coupon — opens the template create form prefilled. */
    onSaveAsTemplate?: (coupon: MonetizationCoupon) => void;
}

const CARD = 'bg-surface border border-line rounded-2xl p-5';
const LABEL = 'text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em]';

export const CouponUsagePanel: React.FC<Props> = ({ coupons, locked, onSaveAsTemplate }) => {
    const [expanded, setExpanded] = useState<string>('');
    const now = Date.now();

    const expiringSoon = useMemo(
        () => coupons.filter((c) => isExpiringSoon(c, now, 7)),
        [coupons, now]
    );

    if (locked) {
        return (
            <div className={CARD}>
                <p className="text-sm text-muted">
                    Coupon reads require a SUPER_ADMIN session (per ADR-0002, <code>coupons</code> is
                    admin-read-only). This panel populates once the Wave-5 rules are live.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Expiring-soon list */}
            <div className={CARD}>
                <div className={`${LABEL} mb-3 flex items-center gap-1.5`}>
                    <AlertTriangle size={13} className="text-gold-500" /> Expiring within 7 days
                </div>
                {expiringSoon.length === 0 ? (
                    <div className="text-xs text-faint">No coupons expiring soon.</div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {expiringSoon.map((c) => (
                            <span
                                key={c.id}
                                className="px-2.5 py-1 rounded-lg bg-gold-500/10 border border-gold-500/30 text-[11px]"
                            >
                                <span className="font-mono font-bold text-[color:var(--text)]">{c.code}</span>{' '}
                                <span className="text-faint">expires {fmtDate(c.expiresAt)}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Per-coupon table */}
            <div className={CARD}>
                <div className={`${LABEL} mb-3`}>Coupons ({coupons.length})</div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-faint">
                                <th className="py-1.5 pr-2"></th>
                                <th className="py-1.5 pr-3 font-display uppercase tracking-[0.06em]">Code</th>
                                <th className="py-1.5 pr-3">Discount</th>
                                <th className="py-1.5 pr-3 text-right">Confirmed</th>
                                <th className="py-1.5 pr-3 text-right">Pending</th>
                                <th className="py-1.5 pr-3 text-right">Remaining</th>
                                <th className="py-1.5 pr-3">Active</th>
                                <th className="py-1.5"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {coupons.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="py-3 text-faint">
                                        No coupons.
                                    </td>
                                </tr>
                            ) : (
                                coupons.map((c) => {
                                    const rem = usesRemaining(c);
                                    const isOpen = expanded === c.id;
                                    const log = [...(c.usageLog ?? [])].sort(
                                        (a, b) => (couponUsageMs(b) ?? 0) - (couponUsageMs(a) ?? 0)
                                    );
                                    return (
                                        <React.Fragment key={c.id}>
                                            <tr className="border-t border-line/50">
                                                <td className="py-1.5 pr-2">
                                                    <button
                                                        onClick={() => setExpanded(isOpen ? '' : c.id)}
                                                        className="text-faint hover:text-[color:var(--text)]"
                                                        aria-label="Toggle usage timeline"
                                                    >
                                                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                    </button>
                                                </td>
                                                <td className="py-1.5 pr-3 font-mono font-bold text-[color:var(--text)]">
                                                    {c.code}
                                                </td>
                                                <td className="py-1.5 pr-3">
                                                    {c.discountType === 'percentage'
                                                        ? `${c.discountValue ?? 0}%`
                                                        : `$${(c.discountValue ?? 0).toFixed(2)}`}
                                                </td>
                                                <td className="py-1.5 pr-3 text-right">{confirmedUseCount(c)}</td>
                                                <td className="py-1.5 pr-3 text-right">
                                                    {pendingUseCount(c) > 0 ? (
                                                        <span className="text-gold-500 font-bold">{pendingUseCount(c)}</span>
                                                    ) : (
                                                        0
                                                    )}
                                                </td>
                                                <td className="py-1.5 pr-3 text-right">
                                                    {rem === undefined ? '∞' : rem}
                                                </td>
                                                <td className="py-1.5 pr-3">
                                                    {c.isActive ? (
                                                        <span className="text-emerald-500">●</span>
                                                    ) : (
                                                        <span className="text-faint">○</span>
                                                    )}
                                                </td>
                                                <td className="py-1.5">
                                                    {onSaveAsTemplate && (
                                                        <button
                                                            onClick={() => onSaveAsTemplate(c)}
                                                            className="text-[10px] text-gold-500 hover:underline"
                                                        >
                                                            Save as template
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                            {isOpen && (
                                                <tr className="bg-page/40">
                                                    <td colSpan={8} className="p-3">
                                                        <div className="text-[10px] font-display uppercase tracking-[0.08em] text-faint mb-2">
                                                            Usage timeline · live {liveUseCount(c)}
                                                        </div>
                                                        {log.length === 0 ? (
                                                            <div className="text-xs text-faint">No uses yet.</div>
                                                        ) : (
                                                            <table className="w-full text-[11px]">
                                                                <thead>
                                                                    <tr className="text-left text-faint">
                                                                        <th className="py-1 pr-3">Status</th>
                                                                        <th className="py-1 pr-3">User</th>
                                                                        <th className="py-1 pr-3">Pool</th>
                                                                        <th className="py-1">When</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {log.map((e, i) => (
                                                                        <tr key={e.reservationId ?? i} className="border-t border-line/40">
                                                                            <td className="py-1 pr-3">
                                                                                <span
                                                                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                                                                        e.status === 'released'
                                                                                            ? 'bg-faint/10 text-faint'
                                                                                            : e.status === 'pending'
                                                                                            ? 'bg-gold-500/15 text-gold-500'
                                                                                            : 'bg-emerald-500/15 text-emerald-500'
                                                                                    }`}
                                                                                >
                                                                                    {e.status ?? 'confirmed'}
                                                                                </span>
                                                                            </td>
                                                                            <td className="py-1 pr-3 font-mono text-faint">
                                                                                {e.userId ? e.userId.slice(0, 10) : '—'}
                                                                            </td>
                                                                            <td className="py-1 pr-3 font-mono text-faint">
                                                                                {e.poolId ? e.poolId.slice(0, 10) : '—'}
                                                                            </td>
                                                                            <td className="py-1">{fmtDateTime(couponUsageMs(e))}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
