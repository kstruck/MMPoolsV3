import { describe, it, expect } from 'vitest';
import type { PoolQuote } from '@shared/schemas';
import { launchButtonsState, couponIsFullDiscount } from './launchButtonsState';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T2 — a coupon must never remove the Activate path.
 * Kevin's repro: a 100%-off coupon on a paid pool made "Activate now" vanish.
 */

function quote(over: Partial<PoolQuote> = {}): PoolQuote {
    return {
        poolType: 'NFL_PICKEM',
        pricingKey: 'season',
        estimatedPlayers: 100,
        tier: 'standard_tier',
        basePrice: 99,
        addonLines: [],
        subtotal: 99,
        discount: 0,
        total: 99,
        freeTierEligible: false,
        trialDays: 14,
        ...over,
    };
}

describe('launchButtonsState', () => {
    it('offers trial only, with a retry, when the quote failed', () => {
        const s = launchButtonsState({ quoteState: 'unavailable', quote: null });
        expect(s.primary).toBe('trial');
        expect(s.showActivate).toBe(false);
        expect(s.showQuoteRetry).toBe(true);
    });

    it('offers no retry while the quote is still loading', () => {
        const s = launchButtonsState({ quoteState: 'pending', quote: null });
        expect(s.showQuoteRetry).toBe(false);
        expect(s.showActivate).toBe(false);
    });

    it('holds the last decision while re-quoting, but disables Activate', () => {
        // The component keeps the last quote in state while re-fetching. Hiding
        // the buttons on every keystroke would make the CTA jump; offering to
        // charge a superseded amount would be worse. So: keep, disable.
        const s = launchButtonsState({ quoteState: 'pending', quote: quote({ total: 147, subtotal: 147 }) });
        expect(s.primary).toBe('trial');
        expect(s.showActivate).toBe(true);
        expect(s.activateDisabled).toBe(true);
        expect(s.showQuoteRetry).toBe(false);
    });

    it('keeps a free-eligible primary label steady while re-quoting', () => {
        const s = launchButtonsState({
            quoteState: 'pending',
            quote: quote({ freeTierEligible: true, basePrice: 0, subtotal: 0, total: 0, estimatedPlayers: 8 }),
        });
        expect(s.primary).toBe('free');
    });

    it('drops back to trial-only when a re-quote FAILS, even with a quote in hand', () => {
        // 'unavailable' means we could not confirm the price for these inputs;
        // the stale object must not keep a paid button alive.
        const s = launchButtonsState({ quoteState: 'unavailable', quote: quote({ total: 147 }) });
        expect(s.showActivate).toBe(false);
        expect(s.showQuoteRetry).toBe(true);
    });

    it('shows the free launch path (and no Activate) when the server says free', () => {
        const s = launchButtonsState({
            quoteState: 'ready',
            quote: quote({ freeTierEligible: true, basePrice: 0, subtotal: 0, total: 0, estimatedPlayers: 8 }),
        });
        expect(s.primary).toBe('free');
        expect(s.showActivate).toBe(false);
    });

    it('shows Activate at the real price on an ordinary paid quote', () => {
        const s = launchButtonsState({ quoteState: 'ready', quote: quote({ total: 147, subtotal: 147 }) });
        expect(s.primary).toBe('trial');
        expect(s.showActivate).toBe(true);
        expect(s.activateAmount).toBe(147);
        expect(s.activateIsCouponZero).toBe(false);
        expect(s.activateDisabled).toBe(false);
    });

    it('KEEPS Activate when a valid coupon zeroes the total (the reported bug)', () => {
        const s = launchButtonsState({
            quoteState: 'ready',
            quote: quote({
                subtotal: 99,
                discount: 99,
                total: 0,
                couponState: { code: 'FREEPOOL', valid: true, discountLabel: '100% off' },
            }),
        });
        expect(s.showActivate).toBe(true);
        expect(s.activateAmount).toBe(0);
        expect(s.activateIsCouponZero).toBe(true);
    });

    it('keeps Activate for a partial coupon that leaves a balance', () => {
        const s = launchButtonsState({
            quoteState: 'ready',
            quote: quote({
                subtotal: 99,
                discount: 20,
                total: 79,
                couponState: { code: 'SAVE20', valid: true, discountLabel: '$20 off' },
            }),
        });
        expect(s.showActivate).toBe(true);
        expect(s.activateAmount).toBe(79);
        expect(s.activateIsCouponZero).toBe(false);
    });

    it('still shows Activate at full price when the coupon is invalid', () => {
        const s = launchButtonsState({
            quoteState: 'ready',
            quote: quote({
                couponState: { code: 'EXPIRED', valid: false, reason: 'This coupon has expired' },
            }),
        });
        expect(s.showActivate).toBe(true);
        expect(s.activateAmount).toBe(99);
        expect(s.activateIsCouponZero).toBe(false);
    });

    it('hides Activate on a $0 total the server would refuse to activate', () => {
        // total 0, not free-tier eligible, no coupon → the FREE PATH throws
        // "No valid free-activation reason provided". A button here always fails.
        const s = launchButtonsState({
            quoteState: 'ready',
            quote: quote({ basePrice: 0, subtotal: 0, total: 0, freeTierEligible: false }),
        });
        expect(s.showActivate).toBe(false);
    });
});

describe('couponIsFullDiscount mirrors the server FREE PATH test', () => {
    it('is false when the subtotal was already zero', () => {
        expect(
            couponIsFullDiscount(
                quote({ subtotal: 0, discount: 0, total: 0, couponState: { code: 'X', valid: true } }),
            ),
        ).toBe(false);
    });

    it('is false for an invalid coupon even if the total is zero', () => {
        expect(
            couponIsFullDiscount(
                quote({ subtotal: 99, discount: 0, total: 0, couponState: { code: 'X', valid: false, reason: 'nope' } }),
            ),
        ).toBe(false);
    });

    it('is true when a valid coupon covers the whole subtotal', () => {
        expect(
            couponIsFullDiscount(
                quote({ subtotal: 99, discount: 99, total: 0, couponState: { code: 'X', valid: true } }),
            ),
        ).toBe(true);
    });
});
