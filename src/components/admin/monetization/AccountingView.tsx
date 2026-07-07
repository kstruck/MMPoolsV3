import React, { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { MonetizationBillingCharge } from '../../../services/dbService';
import {
    fmtUSD,
    fmtDateTime,
    stripePaymentLink,
    totalsFor,
    bucketByPeriod,
    byFormat,
    type Period,
} from './monetizationCalcs';

interface Props {
    charges: MonetizationBillingCharge[];
    locked: boolean;
}

const CARD =
    'bg-surface border border-line rounded-2xl p-5';
const LABEL =
    'text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em]';

/** A hand-rolled inline SVG bar chart — NO chart dependency (repo has none). */
const MiniBars: React.FC<{ data: { key: string; value: number }[]; height?: number }> = ({
    data,
    height = 120,
}) => {
    if (data.length === 0) return <div className="text-xs text-faint">No data.</div>;
    const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
    const barW = 100 / data.length;
    return (
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
            {data.map((d, i) => {
                const h = (Math.abs(d.value) / max) * (height - 18);
                const x = i * barW;
                const positive = d.value >= 0;
                return (
                    <g key={d.key}>
                        <rect
                            x={x + barW * 0.15}
                            y={height - 14 - h}
                            width={barW * 0.7}
                            height={Math.max(0, h)}
                            rx={0.6}
                            fill={positive ? 'var(--gold-500, #d4af37)' : '#ef4444'}
                            opacity={0.85}
                        />
                    </g>
                );
            })}
        </svg>
    );
};

export const AccountingView: React.FC<Props> = ({ charges, locked }) => {
    const [period, setPeriod] = useState<Period>('month');

    const totals = useMemo(() => totalsFor(charges), [charges]);
    const buckets = useMemo(() => bucketByPeriod(charges, period), [charges, period]);
    const formats = useMemo(() => byFormat(charges), [charges]);

    // Most recent 50 rows for the ledger table (already newest-first from the query).
    const recent = useMemo(() => charges.slice(0, 50), [charges]);

    if (locked) {
        return (
            <div className={CARD}>
                <p className="text-sm text-muted">
                    Billing ledger is locked. Reading <code>billingCharges</code> requires a live
                    SUPER_ADMIN session and the Wave-5 Firestore rules. Once those are in place this
                    view populates from the ledger automatically.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Number cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className={CARD}>
                    <div className={LABEL}>Net revenue</div>
                    <div className="text-2xl font-display font-bold text-[color:var(--text)]">{fmtUSD(totals.net)}</div>
                    <div className="text-[10px] text-faint mt-1">{totals.chargeCount} charge rows</div>
                </div>
                <div className={CARD}>
                    <div className={LABEL}>Gross (pool + bundle)</div>
                    <div className="text-2xl font-display font-bold text-[color:var(--text)]">{fmtUSD(totals.gross)}</div>
                    <div className="text-[10px] text-faint mt-1">
                        pool {fmtUSD(totals.byKind.pool)} · bundle {fmtUSD(totals.byKind.bundle)}
                    </div>
                </div>
                <div className={CARD}>
                    <div className={LABEL}>Refunds + disputes</div>
                    <div className="text-2xl font-display font-bold text-red-500">
                        {fmtUSD(totals.refunds + totals.disputes)}
                    </div>
                    <div className="text-[10px] text-faint mt-1">
                        refunds {fmtUSD(totals.refunds)} · disputes {fmtUSD(totals.disputes)}
                    </div>
                </div>
                <div className={CARD}>
                    <div className={LABEL}>Coupon redemptions</div>
                    <div className="text-2xl font-display font-bold text-[color:var(--text)]">{totals.couponRedemptions}</div>
                    <div className="text-[10px] text-faint mt-1">charge rows carrying a code</div>
                </div>
            </div>

            {/* Revenue over time */}
            <div className={CARD}>
                <div className="flex items-center justify-between mb-3">
                    <div className={LABEL}>Revenue by {period}</div>
                    <div className="flex gap-1">
                        {(['day', 'week', 'month'] as Period[]).map((p) => (
                            <button
                                key={p}
                                onClick={() => setPeriod(p)}
                                className={`px-2.5 py-1 rounded-md text-[10px] font-display font-bold uppercase tracking-[0.08em] ${
                                    period === p
                                        ? 'bg-navy-800 text-white'
                                        : 'text-muted hover:text-[color:var(--text)]'
                                }`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </div>
                <MiniBars data={buckets.map((b) => ({ key: b.key, value: b.net }))} />
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-faint">
                                <th className="py-1.5 pr-3 font-display uppercase tracking-[0.06em]">{period}</th>
                                <th className="py-1.5 pr-3 text-right">Net</th>
                                <th className="py-1.5 pr-3 text-right">Pool</th>
                                <th className="py-1.5 pr-3 text-right">Bundle</th>
                                <th className="py-1.5 pr-3 text-right">Refunds</th>
                                <th className="py-1.5 pr-3 text-right">Disputes</th>
                                <th className="py-1.5 text-right">Rows</th>
                            </tr>
                        </thead>
                        <tbody>
                            {buckets.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-3 text-faint">
                                        No charges yet.
                                    </td>
                                </tr>
                            ) : (
                                buckets.map((b) => (
                                    <tr key={b.key} className="border-t border-line/50">
                                        <td className="py-1.5 pr-3 font-mono text-[color:var(--text)]">{b.key}</td>
                                        <td className="py-1.5 pr-3 text-right font-bold">{fmtUSD(b.net)}</td>
                                        <td className="py-1.5 pr-3 text-right">{fmtUSD(b.pool)}</td>
                                        <td className="py-1.5 pr-3 text-right">{fmtUSD(b.bundle)}</td>
                                        <td className="py-1.5 pr-3 text-right text-red-500">{fmtUSD(b.refunds)}</td>
                                        <td className="py-1.5 pr-3 text-right text-red-500">{fmtUSD(b.disputes)}</td>
                                        <td className="py-1.5 text-right text-faint">{b.count}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* By format/tier */}
            <div className={CARD}>
                <div className={`${LABEL} mb-3`}>Revenue by format / tier</div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-faint">
                                <th className="py-1.5 pr-3 font-display uppercase tracking-[0.06em]">Format / tier</th>
                                <th className="py-1.5 pr-3 text-right">Net</th>
                                <th className="py-1.5 text-right">Rows</th>
                            </tr>
                        </thead>
                        <tbody>
                            {formats.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="py-3 text-faint">
                                        No charges yet.
                                    </td>
                                </tr>
                            ) : (
                                formats.map((f) => (
                                    <tr key={f.label} className="border-t border-line/50">
                                        <td className="py-1.5 pr-3 font-mono text-[color:var(--text)]">{f.label}</td>
                                        <td className="py-1.5 pr-3 text-right font-bold">{fmtUSD(f.net)}</td>
                                        <td className="py-1.5 text-right text-faint">{f.count}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Recent ledger rows w/ Stripe deep-links */}
            <div className={CARD}>
                <div className={`${LABEL} mb-3`}>Recent charges (deep-link to Stripe test dashboard)</div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-faint">
                                <th className="py-1.5 pr-3 font-display uppercase tracking-[0.06em]">When</th>
                                <th className="py-1.5 pr-3">Kind</th>
                                <th className="py-1.5 pr-3 text-right">Amount</th>
                                <th className="py-1.5 pr-3">Coupon</th>
                                <th className="py-1.5 pr-3">User</th>
                                <th className="py-1.5">Stripe</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recent.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="py-3 text-faint">
                                        No charges yet.
                                    </td>
                                </tr>
                            ) : (
                                recent.map((c) => (
                                    <tr key={c.id} className="border-t border-line/50">
                                        <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDateTime(c.at)}</td>
                                        <td className="py-1.5 pr-3">
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                                    c.kind === 'refund' || c.kind === 'dispute'
                                                        ? 'bg-red-500/15 text-red-500'
                                                        : 'bg-navy-800/40 text-[color:var(--text)]'
                                                }`}
                                            >
                                                {c.kind ?? 'pool'}
                                            </span>
                                        </td>
                                        <td
                                            className={`py-1.5 pr-3 text-right font-bold ${
                                                (c.amount ?? 0) < 0 ? 'text-red-500' : ''
                                            }`}
                                        >
                                            {fmtUSD(c.amount ?? 0)}
                                        </td>
                                        <td className="py-1.5 pr-3 font-mono text-[10px]">{c.couponCode ?? '—'}</td>
                                        <td className="py-1.5 pr-3 font-mono text-[10px] text-faint">
                                            {c.userId ? c.userId.slice(0, 8) : '—'}
                                        </td>
                                        <td className="py-1.5">
                                            <a
                                                href={stripePaymentLink(c.paymentIntentId)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-gold-500 hover:underline"
                                                title={c.paymentIntentId ? `Open ${c.paymentIntentId}` : 'Open Stripe payments'}
                                            >
                                                <ExternalLink size={12} /> view
                                            </a>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
