import type { PoolQuote } from '@shared/schemas';

/**
 * Which launch actions LaunchStep renders, extracted from its JSX so the rule
 * can be asserted directly (PLAN-WIZARD-BUYFLOW-FIXES T2).
 *
 * The defect this replaces: the Activate button rendered on `quote.total > 0`,
 * so a 100%-off coupon — which drives the server total to $0
 * (`quoteEngine.computeQuote`) — made the only paid path DISAPPEAR and left
 * the commissioner with the trial button alone (Kevin's repro).
 *
 * The server has supported $0 activation the whole time: `createCheckoutSession`'s
 * FREE PATH activates without a Stripe redirect when the coupon is a full
 * discount (`functions/src/stripe.ts` — `couponIsFullDiscount`).
 *
 * Mirroring that server condition is the load-bearing part here. The FREE PATH
 * accepts a $0 activation for exactly three reasons — an owned credit,
 * `tier === 'free_tier'`, or a full-discount coupon — and throws
 * `failed-precondition: No valid free-activation reason provided` otherwise. So
 * a $0 Activate button offered on any OTHER zero (a tier the config happens to
 * price at $0, say) would be a button that always fails.
 */

/** Does a server quote describe the current form inputs? */
export type LaunchQuoteState = 'ready' | 'pending' | 'unavailable';

export interface LaunchButtonsInputs {
    quoteState: LaunchQuoteState;
    /**
     * The last quote the server returned, which the component keeps across a
     * re-fetch. When `quoteState` is 'pending' this quote belongs to the
     * PREVIOUS inputs — see `activateDisabled`.
     */
    quote: PoolQuote | null;
}

export interface LaunchButtonsState {
    /**
     * The always-rendered primary action. 'free' only when the SERVER says the
     * pool qualifies (`freeTierEligible`), never inferred from a $0 total.
     *
     * It is a LABEL, not a decision: both branches call the same create path and
     * the server picks free vs trial itself (`computeLaunchMode`). That is why a
     * stale value here is cosmetic and the button stays enabled while re-quoting
     * — hiding or flipping the primary CTA on every keystroke would be worse.
     */
    primary: 'free' | 'trial';
    /** Render the "Activate now" secondary button. */
    showActivate: boolean;
    /**
     * Disable Activate while the quote on screen belongs to older inputs. Unlike
     * the primary, this button carries an AMOUNT, and starting checkout against
     * a superseded amount is the "look-clickable-but-wrong" defect
     * `checkoutButtonState` exists to prevent. The server re-prices either way,
     * so this protects the user's expectation, not the till.
     */
    activateDisabled: boolean;
    /**
     * Amount for the Activate label; the caller money-formats it so formatting
     * stays in one place.
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
    const { quote } = i;

    // No quote to reason from — either none has ever loaded, or the last one
    // failed. The trial is the only honest offer, and a failure gets a retry
    // rather than a dead end (codex r1 #5 on the plan).
    if (!quote || i.quoteState === 'unavailable') {
        return {
            primary: 'trial',
            showActivate: false,
            activateDisabled: true,
            activateAmount: 0,
            activateIsCouponZero: false,
            showQuoteRetry: i.quoteState === 'unavailable',
        };
    }

    const stale = i.quoteState !== 'ready';

    // Free-tier eligible: the green "Launch free pool" path already covers it,
    // and offering Activate alongside would charge for what is free.
    if (quote.freeTierEligible) {
        return {
            primary: 'free',
            showActivate: false,
            activateDisabled: true,
            activateAmount: 0,
            activateIsCouponZero: false,
            showQuoteRetry: false,
        };
    }

    const zeroByCoupon = quote.total === 0 && couponIsFullDiscount(quote);

    return {
        primary: 'trial',
        showActivate: quote.total > 0 || zeroByCoupon,
        activateDisabled: stale,
        activateAmount: quote.total,
        activateIsCouponZero: zeroByCoupon,
        showQuoteRetry: false,
    };
}
