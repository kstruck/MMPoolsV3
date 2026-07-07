import React, { useMemo, useState } from 'react';
import { ShieldAlert, Check, Ban, ExternalLink } from 'lucide-react';
import { dbService } from '../../../services/dbService';
import type { MonetizationAlert, MonetizationCoupon } from '../../../services/dbService';
import { useToast } from '../../ui/Toast';
import { fmtDateTime, stripePaymentLink } from './monetizationCalcs';

interface Props {
    alerts: MonetizationAlert[];
    coupons: MonetizationCoupon[];
    locked: boolean;
}

const CARD = 'bg-surface border border-line rounded-2xl p-5';
const LABEL = 'text-[10px] font-display font-bold text-muted uppercase tracking-[0.08em]';

/** The two coupon-abuse alert types are surfaced with a red accent. */
const ABUSE_TYPES = new Set(['COUPON_VELOCITY_SPIKE', 'COUPON_NEW_ACCOUNT_CLUSTER']);
const MONEY_TYPES = new Set(['REFUND', 'DISPUTE', 'DOUBLE_CHARGE_REVIEW']);

function alertAccent(type?: string): string {
    if (type && ABUSE_TYPES.has(type)) return 'border-red-500/40 bg-red-500/5';
    if (type && MONEY_TYPES.has(type)) return 'border-amber-500/40 bg-amber-500/5';
    return 'border-line';
}

export const AlertCenter: React.FC<Props> = ({ alerts, coupons, locked }) => {
    const toast = useToast();
    const [busy, setBusy] = useState<string>('');
    const [showAcked, setShowAcked] = useState(false);

    const codeToCouponId = useMemo(() => {
        const m = new Map<string, string>();
        for (const c of coupons) if (c.code) m.set(c.code.toUpperCase(), c.id);
        return m;
    }, [coupons]);

    const visible = useMemo(
        () => alerts.filter((a) => (showAcked ? true : a.status !== 'acked')),
        [alerts, showAcked]
    );

    const deactivateCoupon = async (alert: MonetizationAlert) => {
        const code = alert.couponCode?.toUpperCase();
        const couponId = alert.couponId || (code ? codeToCouponId.get(code) : undefined);
        if (!couponId) {
            toast.error('Cannot resolve the coupon id for this alert.');
            return;
        }
        setBusy(alert.id);
        try {
            // Reuse the EXISTING adminManageCoupon toggle — do NOT reimplement it.
            await dbService.adminManageCoupon({ op: 'toggle', couponId, data: { isActive: false } });
            toast.success(`Coupon ${alert.couponCode ?? couponId} deactivated. In-flight reservations still honored.`);
        } catch (e) {
            toast.error(`Deactivate failed: ${(e as Error).message}`);
        } finally {
            setBusy('');
        }
    };

    const acknowledge = async (alert: MonetizationAlert, next: 'acked' | 'open') => {
        setBusy(alert.id);
        try {
            await dbService.acknowledgeMonetizationAlert(alert.id, next);
            toast.success(next === 'acked' ? 'Alert acknowledged.' : 'Alert reopened.');
        } catch (e) {
            toast.error(`Update failed: ${(e as Error).message}`);
        } finally {
            setBusy('');
        }
    };

    if (locked) {
        return (
            <div className={CARD}>
                <p className="text-sm text-muted">
                    Reading <code>monetization_alerts</code> requires a SUPER_ADMIN session and the
                    Wave-5 Firestore rules. Alerts populate once those land; the scheduled
                    <code> monetizationAlerts</code> job must also be enabled in{' '}
                    <code>system/config</code>.
                </p>
            </div>
        );
    }

    const openCount = alerts.filter((a) => a.status !== 'acked').length;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className={`${LABEL} flex items-center gap-1.5`}>
                    <ShieldAlert size={14} className="text-red-500" /> {openCount} open alert
                    {openCount === 1 ? '' : 's'}
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer">
                    <input
                        type="checkbox"
                        checked={showAcked}
                        onChange={(e) => setShowAcked(e.target.checked)}
                    />
                    show acknowledged
                </label>
            </div>

            {visible.length === 0 ? (
                <div className={CARD}>
                    <div className="text-sm text-muted">No {showAcked ? '' : 'open '}alerts. All clear.</div>
                </div>
            ) : (
                visible.map((a) => {
                    const isCoupon = !!a.couponCode || (a.type ?? '').startsWith('COUPON_');
                    return (
                        <div key={a.id} className={`border rounded-2xl p-4 ${alertAccent(a.type)}`}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-navy-800/40 text-[color:var(--text)]">
                                            {a.type ?? 'ALERT'}
                                        </span>
                                        {a.status === 'acked' && (
                                            <span className="text-[9px] uppercase text-faint">acknowledged</span>
                                        )}
                                    </div>
                                    <div className="text-sm text-[color:var(--text)] mt-1.5">
                                        {a.message ??
                                            `${a.type ?? 'Alert'}${a.couponCode ? ` · ${a.couponCode}` : ''}`}
                                    </div>
                                    <div className="text-[10px] text-faint mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                        <span>{fmtDateTime(a.createdAt)}</span>
                                        {a.couponCode && <span>coupon {a.couponCode}</span>}
                                        {typeof a.amount === 'number' && <span>amount ${Math.abs(a.amount).toFixed(2)}</span>}
                                        {a.paymentIntentId && (
                                            <a
                                                href={stripePaymentLink(a.paymentIntentId)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-gold-500 hover:underline"
                                            >
                                                <ExternalLink size={11} /> Stripe
                                            </a>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {isCoupon && (
                                        <button
                                            onClick={() => deactivateCoupon(a)}
                                            disabled={busy === a.id}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-500 border border-red-500/30 text-[11px] font-bold uppercase tracking-[0.06em] disabled:opacity-50"
                                            title="Deactivate the offending coupon (in-flight reservations still honored)"
                                        >
                                            <Ban size={12} /> Deactivate
                                        </button>
                                    )}
                                    {a.status === 'acked' ? (
                                        <button
                                            onClick={() => acknowledge(a, 'open')}
                                            disabled={busy === a.id}
                                            className="px-2.5 py-1.5 rounded-lg text-[11px] text-muted border border-line disabled:opacity-50"
                                        >
                                            Reopen
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => acknowledge(a, 'acked')}
                                            disabled={busy === a.id}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-navy-800 text-white text-[11px] font-bold uppercase tracking-[0.06em] disabled:opacity-50"
                                        >
                                            <Check size={12} /> Ack
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );
};
