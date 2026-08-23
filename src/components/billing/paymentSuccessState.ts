import type { BillingStatus } from '../../types';

/**
 * What to tell a commissioner who has just come back from checkout
 * (PLAN-WIZARD-BUYFLOW-FIXES G5).
 *
 * The gap: `createCheckoutSession` redirects to
 * `/pool/{id}?payment=success&session_id=…`, and NOTHING in the client read
 * `payment=success` — only `cancelled` was handled. So the commissioner paid,
 * landed on their pool, saw the TRIAL banner still up (the webhook had not
 * landed yet) and had no acknowledgement that the money went anywhere.
 *
 * `/payment-success` exists but is unreachable: only legacy bundle paths point
 * at it, and those pass a `successUrl` the server no longer accepts.
 *
 * Two states, because "we took your money" and "your pool is on" are different
 * facts and the gap between them is a real webhook round-trip:
 *
 *  - `processing` — payment accepted, `billing.status` has not flipped yet.
 *  - `active` — the webhook (or the $0 FREE PATH, which activates inline)
 *    has stamped the pool active.
 *
 * The pool is a live subscription on this route, so the banner flips from one
 * to the other on its own without a refresh.
 */
export type PaymentAckKind = 'none' | 'processing' | 'active';

export interface PaymentAckState {
    kind: PaymentAckKind;
    title: string;
    detail: string;
}

export function paymentAckState(
    returnedFromCheckout: boolean,
    status: BillingStatus | undefined,
): PaymentAckState {
    if (!returnedFromCheckout) {
        return { kind: 'none', title: '', detail: '' };
    }
    if (status === 'active') {
        return {
            kind: 'active',
            title: 'Payment received — your pool is active.',
            detail: 'Hosting is settled. Every add-on you bought is switched on.',
        };
    }
    return {
        kind: 'processing',
        title: 'Payment received — activating your pool.',
        detail:
            'This usually takes a few seconds. You can keep using the pool; the trial banner clears itself once activation lands.',
    };
}

/**
 * Reads and CONSUMES the `payment=success` marker from a query string.
 * Returns the cleaned search string so the caller can drop it from the URL — a
 * refresh must not re-announce a payment, which is how `payment=cancelled`
 * already behaves in `BillingInvoiceCard`.
 *
 * `session_id` goes with it: it is Stripe's, it identifies a transaction, and
 * leaving it in the address bar of a page people screenshot and share is not
 * worth the zero benefit of keeping it.
 */
export function consumePaymentSuccess(search: string): { returned: boolean; cleanedSearch: string } {
    const params = new URLSearchParams(search);
    if (params.get('payment') !== 'success') {
        return { returned: false, cleanedSearch: search };
    }
    params.delete('payment');
    params.delete('session_id');
    const rest = params.toString();
    return { returned: true, cleanedSearch: rest ? `?${rest}` : '' };
}
