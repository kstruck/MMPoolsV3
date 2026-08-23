import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader, X } from 'lucide-react';
import type { BillingStatus } from '../../types';
import { paymentAckState, consumePaymentSuccess } from './paymentSuccessState';

interface PaymentSuccessBannerProps {
    /** The pool's live billing status — this route subscribes, so it updates. */
    status: BillingStatus | undefined;
}

/**
 * Acknowledges a return from checkout on the pool routes (G5).
 *
 * Mounted once inside `PoolRoute`'s `withHelp` wrapper, so every pool type gets
 * it from one insertion point rather than five.
 *
 * It reads `payment=success` ONCE on mount and strips it from the URL, so the
 * banner survives the webhook round-trip (component state) without a refresh
 * re-announcing the payment.
 */
export const PaymentSuccessBanner: React.FC<PaymentSuccessBannerProps> = ({ status }) => {
    // Read the marker ONCE, on the first render, and hold the answer. A lazy
    // initializer rather than an effect: `consumePaymentSuccess` is a pure read
    // of the query string, and holding the verdict in state is what lets the
    // banner survive the URL being cleaned below (and a re-render from the live
    // pool subscription flipping `status`).
    const [arrival] = useState(() => consumePaymentSuccess(window.location.search));
    const [dismissed, setDismissed] = useState(false);

    // Strip the marker so a refresh does not re-announce the payment — the same
    // thing BillingInvoiceCard already does for `payment=cancelled`.
    useEffect(() => {
        if (!arrival.returned) return;
        window.history.replaceState({}, '', `${window.location.pathname}${arrival.cleanedSearch}${window.location.hash}`);
    }, [arrival]);

    const ack = paymentAckState(arrival.returned, status);
    if (ack.kind === 'none' || dismissed) return null;

    const isActive = ack.kind === 'active';

    return (
        <div
            role="status"
            className={`w-full border-b px-4 py-3 ${
                isActive
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-indigo-500/40 bg-indigo-500/10'
            }`}
        >
            <div className="mx-auto flex max-w-7xl items-start gap-3">
                {isActive ? (
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                ) : (
                    <Loader size={18} className="mt-0.5 shrink-0 animate-spin text-indigo-400" />
                )}
                <div className="min-w-0 flex-grow">
                    <p className={`text-sm font-bold ${isActive ? 'text-emerald-600 dark:text-emerald-300' : 'text-indigo-600 dark:text-indigo-300'}`}>
                        {ack.title}
                    </p>
                    <p className="text-xs text-muted">{ack.detail}</p>
                </div>
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    aria-label="Dismiss payment notice"
                    className="shrink-0 rounded p-1 text-muted hover:text-[color:var(--text)]"
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
};
