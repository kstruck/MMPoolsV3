/**
 * The checkout button's disabled/label/style decision, extracted from
 * `BillingInvoiceCard`'s JSX so it can be asserted directly rather than through
 * a source-offset invariant (PLAN-BUYFLOW-QUOTE-DEADEND).
 *
 * Two states were previously indistinguishable and both rendered as "free":
 *
 *  - the server priced the pool at $0, and
 *  - no quote matched the current inputs, so every `quote?.x ?? 0` fell back to 0.
 *
 * `priceState` separates them, and it is the load-bearing guard: without it,
 * enabling the free-allocation path would let a commissioner activate a PAID
 * pool for nothing whenever the quote call failed or lagged behind the form.
 */

/**
 * Does a server quote describe the CURRENT form inputs?
 *
 * - `ready` — yes, and every figure below is that quote's
 * - `pending` — a request for these inputs is debouncing or in flight
 * - `unavailable` — the request for these inputs failed
 *
 * `pending` and `unavailable` both block checkout. They differ only in what the
 * button says, because "we are still working" and "this did not work" are not
 * the same message and a spinner that never resolves is its own bug report.
 */
export type PriceState = 'ready' | 'pending' | 'unavailable';

export interface CheckoutButtonInputs {
    isCheckoutLoading: boolean;
    hasPoolId: boolean;
    priceState: PriceState;
    /**
     * The SERVER's own verdict (`PoolQuote.freeTierEligible`: players ≤ the free
     * threshold AND total $0), not an inference from zeroes. It is the same
     * condition `computeQuote` uses to stamp `tier: 'free_tier'`, which is what
     * `createCheckoutSession`'s $0 path checks — so a button enabled on this
     * flag is a request the server will accept. Deriving it client-side from
     * `basePrice === 0 && subtotal === 0` can disagree: `subtotal` here has
     * `pricePaid` subtracted from it, which the server knows nothing about.
     */
    freeTierEligible: boolean;
    subtotal: number;
    total: number;
    hasAppliedCoupon: boolean;
    useCredit: boolean;
    hasUnlimitedPass: boolean;
    /** Other pools of this owner already active on the free tier. */
    activeFreePoolsCount: number;
}

/**
 * Which state the button is in. Exported so other parts of the card (the
 * free-pool-limit warning) can key off the SAME decision rather than
 * re-deriving it — a second derivation is how the warning and the button came
 * to disagree in the first place. Matching on a label string would work today
 * and break the moment the copy changes.
 */
export type CheckoutButtonKind =
    | 'no-pool'
    | 'price-pending'
    | 'price-unavailable'
    | 'free-limit-reached'
    | 'nothing-due'
    | 'free-allocation'
    | 'upgrade';

export interface CheckoutButtonState {
    kind: CheckoutButtonKind;
    disabled: boolean;
    label: string;
    /** Render greyed/inert rather than in brand red. */
    muted: boolean;
}

export function checkoutButtonState(i: CheckoutButtonInputs): CheckoutButtonState {
    if (!i.hasPoolId) {
        return { kind: 'no-pool', disabled: true, label: 'Select a Pool Above to Pay', muted: true };
    }

    // No price for what is currently on screen. This used to render as FREE.
    if (i.priceState !== 'ready') {
        return i.priceState === 'pending'
            ? { kind: 'price-pending', disabled: true, label: 'Updating Pricing…', muted: true }
            : { kind: 'price-unavailable', disabled: true, label: 'Pricing Unavailable — Retry', muted: true };
    }

    const coveredByEntitlement = i.useCredit || i.hasUnlimitedPass;
    const serverPricedFree = i.freeTierEligible && !coveredByEntitlement;

    // Priced free, but the commissioner has already spent their free allocation.
    // Mirrors the server's own check, which throws failed-precondition here.
    if (serverPricedFree && i.activeFreePoolsCount > 0) {
        return { kind: 'free-limit-reached', disabled: true, label: 'Free Limit Reached (Upgrade Needed)', muted: true };
    }

    // Priced free with the allocation still available: this is a real checkout,
    // and it is the case the old inline `total <= 0 && …` clause swallowed.
    const isFreeAllocation = serverPricedFree && i.activeFreePoolsCount === 0;

    // The original $0 guard, unchanged except that the free allocation is now
    // carved out of it. It still blocks a meaningless $0 checkout that is not
    // backed by a coupon, a credit, a pass, or a free allocation.
    const meaninglessZero =
        i.total <= 0 &&
        (!i.hasAppliedCoupon || i.subtotal === 0) &&
        !i.useCredit &&
        !i.hasUnlimitedPass &&
        !isFreeAllocation;

    // With a matching quote and the free allocation carved out, the only state
    // that still reaches here is "the pool is priced but `pricePaid` already
    // covers it" — nothing is owed and there is nothing to check out. It used
    // to render the free-allocation label in live red while being disabled,
    // which is the same look-clickable-but-dead defect one case over.
    if (meaninglessZero) {
        return { kind: 'nothing-due', disabled: true, label: 'Nothing Due', muted: true };
    }

    return i.total === 0
        ? { kind: 'free-allocation', disabled: i.isCheckoutLoading, label: 'Activate Pool (Free Allocation)', muted: false }
        : { kind: 'upgrade', disabled: i.isCheckoutLoading, label: 'Upgrade Pool to Premium', muted: false };
}
