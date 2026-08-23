import type { PoolQuote } from '@shared/schemas';

/**
 * Which launch actions LaunchStep renders, extracted from its JSX so the rule
 * can be asserted directly (PLAN-WIZARD-BUYFLOW-FIXES T2).
 *
 * The defect this replaces: the Activate button rendered on `quote.total > 0`,
 * so a 100%-off coupon — which drives the server total to $0
 * (`quoteEngine.computeQuote`) — made the only paid path DISAPPEAR and left
 * the commissioner with the trial button alone. The server has supported $0
 * activation the whole time: `createCheckoutSession`'s FREE PATH activates
 * without a Stripe redirect when the coupon is a full discount
 * (`functions/src/stripe.ts` — `couponIsFullDiscount`).
 *
 * The mirror of that server condition is the load-bearing part here. The FREE
 * PATH accepts a $0 activation for exactly three reasons — an owned credit,
 * `tier === 'free_tier'`, or a full-discount coupon — and throws
 * `failed-precondition: No valid free-activation reason provided` otherwise.
 * So a $0 Activate button offered on any OTHER zero (a tier the config happens
 * to price at $0, say) would be a button that always fails.
 */

/** Does a server quote describe the current form inputs? */
export type LaunchQuoteState = 'ready' | 'pending' | 'unavailable';

export interface LaunchButtonsInputs {
    quoteState: LaunchQuoteState;
    /** The server quote for the current inputs; only read when state is 'ready'. */
    quote: PoolQuote | null;
}

export interface LaunchButtonsState {
    /**
     * The always-rendered primary action. 'free' only when the SERVER says the
     * pool qualifies (`freeTierEligible`), never inferred from a $0 total.
     */
    primary: 'free' | 'trial';
    /** Render the "Activate now" secondary button. */
    showActivate: boolean;
    /**
     * Suffix for the Activate label, already money-formatted by the caller's
     * `money()` — this helper returns the raw amount and a flag instead, so the
     * formatting stays in one place.
     */
    activateAmount: number;
    /** The $0-because-of-a-coupon case, which needs its own explanatory label. */
    activateIsCouponZero: boolean;
    /** Offer a retry control for the quote (only when the quote failed). */
    showQuoteRetry: boolean;
}

/**
 * True when the coupon on this quote wipes the whole subtotal — the same test
 * `createCheckoutSession` runs before taking the FREE PATH.
 * `subtotal > 0` matters: a $0 subtotal discounted by $0 is not a "full
 * discount", it is a pool that costs nothing to begin with.
 */
export function couponIsFullDiscount(quote: PoolQuote): boolean {
    return (
        quote.couponState?.valid === true &&
        quote.subtotal > 0 &&
        quote.discount >= quote.subtotal
    );
}

export function launchButtonsState(i: LaunchButtonsInputs): LaunchButtonsState {
    const quote = i.quoteState === 'ready' ? i.quote : null;

    // No usable quote: the trial is the only honest offer, and a failed quote
    // gets a retry rather than a dead end (codex r1 #5 on the plan).
    if (!quote) {
        return {
            primary: 'trial',
            showActivate: false,
            activateAmount: 0,
            activateIsCouponZero: false,
            showQuoteRetry: i.quoteState === 'unavailable',
        };
    }

    // Free-tier eligible: the green "Launch free pool" path already covers it,
    // and offering Activate alongside would charge for what is free.
    if (quote.freeTierEligible) {
        return {
            primary: 'free',
            showActivate: false,
            activateAmount: 0,
            activateIsCouponZero: false,
            showQuoteRetry: false,
        };
    }

    const zeroByCoupon = quote.total === 0 && couponIsFullDiscount(quote);

    return {
        primary: 'trial',
        showActivate: quote.total > 0 || zeroByCoupon,
        activateAmount: quote.total,
        activateIsCouponZero: zeroByCoupon,
        showQuoteRetry: false,
    };
}
