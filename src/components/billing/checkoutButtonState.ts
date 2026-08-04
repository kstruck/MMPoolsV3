/**
 * The checkout button's disabled/label/style decision, extracted from
 * `BillingInvoiceCard`'s JSX so it can be asserted directly rather than through
 * a source-offset invariant (PLAN-BUYFLOW-QUOTE-DEADEND).
 *
 * Two states were previously indistinguishable and both rendered as "free":
 *
 *  - the server priced the pool at $0, and
 *  - the quote never loaded, so every `quote?.x ?? 0` fell back to 0.
 *
 * `priceUnknown` separates them. It is the load-bearing guard here: without it,
 * enabling the free-allocation path would let a commissioner activate a PAID
 * pool for nothing whenever the quote call failed.
 */

export interface CheckoutButtonInputs {
    isCheckoutLoading: boolean;
    hasPoolId: boolean;
    /** No quote has ever loaded — the price is unknown, NOT zero. */
    priceUnknown: boolean;
    basePrice: number;
    subtotal: number;
    total: number;
    hasAppliedCoupon: boolean;
    useCredit: boolean;
    hasUnlimitedPass: boolean;
    /** How many free-tier pools the commissioner already has active. */
    activeFreePoolsCount: number;
}

export interface CheckoutButtonState {
    disabled: boolean;
    label: string;
    /** Render greyed/inert rather than in brand red. */
    muted: boolean;
}

export function checkoutButtonState(i: CheckoutButtonInputs): CheckoutButtonState {
    if (!i.hasPoolId) {
        return { disabled: true, label: 'Select a Pool Above to Pay', muted: true };
    }

    // A failed quote must never present as a price. It used to render as FREE.
    if (i.priceUnknown) {
        return { disabled: true, label: 'Pricing Unavailable — Retry', muted: true };
    }

    const coveredByEntitlement = i.useCredit || i.hasUnlimitedPass;
    const serverPricedFree = i.basePrice === 0 && i.subtotal === 0 && !coveredByEntitlement;

    // Priced free, but the commissioner has already spent their free allocation.
    if (serverPricedFree && i.activeFreePoolsCount > 0) {
        return { disabled: true, label: 'Free Limit Reached (Upgrade Needed)', muted: true };
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

    // With a loaded quote and the free allocation carved out, the only state
    // that still reaches here is "the pool is priced but `pricePaid` already
    // covers it" — nothing is owed and there is nothing to check out. It used
    // to render the free-allocation label in live red while being disabled,
    // which is the same look-clickable-but-dead defect one case over.
    if (meaninglessZero) {
        return { disabled: true, label: 'Nothing Due', muted: true };
    }

    return {
        disabled: i.isCheckoutLoading,
        label: i.total === 0 ? 'Activate Pool (Free Allocation)' : 'Upgrade Pool to Premium',
        muted: false,
    };
}
