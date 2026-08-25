import { describe, it, expect } from 'vitest';
import { estimateIsSet, feeWithoutPaymentPathWarning } from './launchReadiness';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T6b — G7 and G14.
 */

describe('estimateIsSet (G7)', () => {
    it('0 is not a pool size — it is "nobody answered"', () => {
        // The field defaulted to 0 and was never required, so an untouched
        // field silently routed a 40-person pool onto the free plan and the
        // wall was found by the 11th member, mid-season.
        expect(estimateIsSet(0)).toBe(false);
        expect(estimateIsSet('0')).toBe(false);
    });

    it('accepts any real count from 1 up', () => {
        expect(estimateIsSet(1)).toBe(true);
        expect(estimateIsSet(40)).toBe(true);
        expect(estimateIsSet('12')).toBe(true);
    });

    it('rejects a fractional count (codex r2)', () => {
        // `poolQuoteInputSchema` is `.int()`, so a fraction makes every quote
        // fail — and that surfaces as "Could not load pricing right now",
        // naming nothing the commissioner can act on.
        expect(estimateIsSet(1.5)).toBe(false);
        expect(estimateIsSet('12.4')).toBe(false);
        expect(estimateIsSet(0.5)).toBe(false);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['an empty string', ''],
        ['text', 'lots'],
        ['NaN', Number.NaN],
        ['a negative', -3],
    ])('rejects %s', (_label, value) => {
        expect(estimateIsSet(value)).toBe(false);
    });
});

describe('feeWithoutPaymentPathWarning (G14)', () => {
    const NONE = { venmo: '', zelle: '', cashapp: '', paypal: '', googlePay: '' };

    it('warns on a fee with no handle and no instructions', () => {
        // Invitees see "Entry Fee $25" and no way to pay it.
        const w = feeWithoutPaymentPathWarning({ fee: 25, handles: NONE, instructions: '' });
        expect(w).toContain('no payment handle');
    });

    it('is silent when ANY handle is filled', () => {
        for (const key of ['venmo', 'zelle', 'cashapp', 'paypal', 'googlePay'] as const) {
            expect(
                feeWithoutPaymentPathWarning({ fee: 25, handles: { ...NONE, [key]: '@me' }, instructions: '' }),
                key,
            ).toBeNull();
        }
    });

    it('is silent when only instructions are given', () => {
        // "Pay me at the bar" is a complete answer.
        expect(feeWithoutPaymentPathWarning({ fee: 25, handles: NONE, instructions: 'Cash at the bar.' })).toBeNull();
    });

    it('treats whitespace as blank', () => {
        expect(feeWithoutPaymentPathWarning({ fee: 25, handles: { venmo: '   ' }, instructions: '  ' })).not.toBeNull();
    });

    it('says nothing when there is no fee', () => {
        expect(feeWithoutPaymentPathWarning({ fee: 0, handles: NONE, instructions: '' })).toBeNull();
        expect(feeWithoutPaymentPathWarning({ fee: undefined, handles: NONE, instructions: '' })).toBeNull();
        expect(feeWithoutPaymentPathWarning({ fee: 'free', handles: NONE, instructions: '' })).toBeNull();
    });

    it('tolerates a missing handles map', () => {
        expect(feeWithoutPaymentPathWarning({ fee: 25, handles: null, instructions: '' })).not.toBeNull();
        expect(feeWithoutPaymentPathWarning({ fee: 25, handles: undefined, instructions: undefined })).not.toBeNull();
    });

    it('offers the legitimate answer instead of just scolding', () => {
        // It WARNS, never blocks: collecting cash in person is a real answer
        // and a commissioner who has one is not helped by being stopped.
        expect(feeWithoutPaymentPathWarning({ fee: 25, handles: NONE, instructions: '' }))
            .toContain('collecting in person');
    });
});
