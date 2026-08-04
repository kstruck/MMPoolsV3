import { describe, it, expect } from 'vitest';
import { checkoutButtonState, type CheckoutButtonInputs } from './checkoutButtonState';

/**
 * Guards PLAN-BUYFLOW-QUOTE-DEADEND.
 *
 * The headline case is the one measured dead on production 2026-08-04: a $0,
 * no-coupon, no-credit pool rendered `Activate Pool (Free Allocation)` in live
 * brand red with `button.disabled === true`. Nobody could self-activate a free
 * pool.
 *
 * The cases immediately after it are what keep the fix safe rather than merely
 * permissive: the SAME inputs with no matching quote must stay disabled,
 * because a failed or stale `getPoolQuote` is exactly what produced those
 * zeroes.
 */

// A quote for the CURRENT inputs has loaded and the server called it free-tier.
const freeAllocation: CheckoutButtonInputs = {
    isCheckoutLoading: false,
    hasPoolId: true,
    priceState: 'ready',
    freeTierEligible: true,
    subtotal: 0,
    total: 0,
    hasAppliedCoupon: false,
    useCredit: false,
    hasUnlimitedPass: false,
    activeFreePoolsCount: 0,
};

const priced: CheckoutButtonInputs = {
    ...freeAllocation,
    freeTierEligible: false,
    subtotal: 29,
    total: 29,
};

describe('checkoutButtonState — the free-allocation dead end', () => {
    it('a $0 / no-coupon / no-credit pool with a matching quote is ENABLED and offers activation', () => {
        const s = checkoutButtonState(freeAllocation);
        expect(s.disabled).toBe(false);
        expect(s.label).toBe('Activate Pool (Free Allocation)');
        expect(s.muted).toBe(false);
    });

    it('the SAME inputs with a FAILED quote are DISABLED — a failed quote is not a free pool', () => {
        const s = checkoutButtonState({ ...freeAllocation, priceState: 'unavailable' });
        expect(s.disabled).toBe(true);
        expect(s.label).toBe('Pricing Unavailable');
        expect(s.muted).toBe(true);
    });

    it('the disabled price-failure label does NOT promise a retry it cannot perform', () => {
        // codex round 2 [P1]: the label said "Retry" on a disabled button. The
        // retry lives on its own enabled control in the notice card.
        const s = checkoutButtonState({ ...freeAllocation, priceState: 'unavailable' });
        expect(s.disabled).toBe(true);
        expect(s.label.toLowerCase()).not.toContain('retry');
        expect(s.label.toLowerCase()).not.toContain('try again');
    });

    it('the SAME inputs with a STALE/in-flight quote are DISABLED and say so', () => {
        // The dangerous shape codex round 1 found: a quote from EARLIER inputs
        // is still on screen while the checkout payload has already moved on.
        const s = checkoutButtonState({ ...freeAllocation, priceState: 'pending' });
        expect(s.disabled).toBe(true);
        expect(s.label).toBe('Updating Pricing…');
        expect(s.muted).toBe(true);
    });

    it('a non-ready price beats every other state, including a priced pool and an unlimited pass', () => {
        for (const priceState of ['pending', 'unavailable'] as const) {
            expect(checkoutButtonState({ ...priced, priceState }).disabled).toBe(true);
            expect(
                checkoutButtonState({ ...freeAllocation, priceState, hasUnlimitedPass: true }).disabled
            ).toBe(true);
            expect(
                checkoutButtonState({ ...freeAllocation, priceState, useCredit: true }).disabled
            ).toBe(true);
        }
    });

    it('free-tier eligibility comes from the server flag, not from zero totals', () => {
        // `subtotal` has `pricePaid` subtracted client-side, so zeroes here do
        // NOT mean the server would accept a $0 activation.
        const zeroedByPreviousPayment = { ...priced, subtotal: 0, total: 0, freeTierEligible: false };
        const s = checkoutButtonState(zeroedByPreviousPayment);
        expect(s.label).not.toBe('Activate Pool (Free Allocation)');
        expect(s.disabled).toBe(true);
    });

    it('an already-active free pool still blocks a second one', () => {
        const s = checkoutButtonState({ ...freeAllocation, activeFreePoolsCount: 1 });
        expect(s.disabled).toBe(true);
        expect(s.label).toBe('Free Limit Reached (Upgrade Needed)');
        expect(s.muted).toBe(true);
    });

    it('a credit or an unlimited pass overrides the free-pool limit', () => {
        expect(
            checkoutButtonState({ ...priced, total: 0, useCredit: true, activeFreePoolsCount: 1 }).disabled
        ).toBe(false);
        expect(
            checkoutButtonState({ ...priced, total: 0, hasUnlimitedPass: true, activeFreePoolsCount: 1 }).disabled
        ).toBe(false);
    });
});

describe('checkoutButtonState — states that must not regress', () => {
    it('a priced pool is enabled and offers the upgrade', () => {
        const s = checkoutButtonState(priced);
        expect(s.disabled).toBe(false);
        expect(s.label).toBe('Upgrade Pool to Premium');
        expect(s.muted).toBe(false);
    });

    it('a 100% coupon on a priced pool stays enabled', () => {
        const s = checkoutButtonState({ ...priced, total: 0, hasAppliedCoupon: true });
        expect(s.disabled).toBe(false);
        expect(s.label).toBe('Activate Pool (Free Allocation)');
    });

    it('no pool selected is disabled with the select prompt', () => {
        const s = checkoutButtonState({ ...priced, hasPoolId: false });
        expect(s.disabled).toBe(true);
        expect(s.label).toBe('Select a Pool Above to Pay');
        expect(s.muted).toBe(true);
    });

    it('an in-flight checkout is disabled without changing the label', () => {
        const s = checkoutButtonState({ ...priced, isCheckoutLoading: true });
        expect(s.disabled).toBe(true);
        expect(s.label).toBe('Upgrade Pool to Premium');
    });

    it('a pool already covered by previous payments owes nothing and says so', () => {
        const s = checkoutButtonState({ ...priced, subtotal: 0, total: 0 });
        expect(s.disabled).toBe(true);
        expect(s.label).toBe('Nothing Due');
        expect(s.muted).toBe(true);
    });

    it('muted and enabled are never both true — a live-looking button is always clickable', () => {
        const inputs: CheckoutButtonInputs[] = [
            freeAllocation,
            priced,
            { ...freeAllocation, priceState: 'unavailable' },
            { ...freeAllocation, priceState: 'pending' },
            { ...freeAllocation, activeFreePoolsCount: 1 },
            { ...priced, hasPoolId: false },
            { ...priced, subtotal: 0, total: 0 },
            { ...priced, total: 0, hasAppliedCoupon: true },
            { ...priced, isCheckoutLoading: true },
        ];
        for (const i of inputs) {
            const s = checkoutButtonState(i);
            if (s.muted) expect(s.disabled).toBe(true);
        }
    });
});
