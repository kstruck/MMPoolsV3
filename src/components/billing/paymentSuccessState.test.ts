import { describe, it, expect } from 'vitest';
import { paymentAckState, consumePaymentSuccess } from './paymentSuccessState';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES G5 — after paying, nothing acknowledged the
 * payment. The server redirects to `/pool/{id}?payment=success&session_id=…`
 * and only `payment=cancelled` was ever read.
 */

describe('paymentAckState', () => {
    it('says nothing when the visitor did not come back from checkout', () => {
        expect(paymentAckState(false, 'trial').kind).toBe('none');
        expect(paymentAckState(false, 'active').kind).toBe('none');
    });

    it('acknowledges the money BEFORE the webhook lands', () => {
        // The gap between "paid" and "active" is a real webhook round-trip, and
        // during it the pool still shows its TRIAL banner. Saying nothing is
        // what made the commissioner think the payment vanished.
        const s = paymentAckState(true, 'trial');
        expect(s.kind).toBe('processing');
        expect(s.title).toContain('Payment received');
    });

    it('confirms activation once the pool is active', () => {
        const s = paymentAckState(true, 'active');
        expect(s.kind).toBe('active');
        expect(s.title).toContain('active');
    });

    it('treats an unknown / missing status as still processing, never as active', () => {
        // Fail toward "we are working on it". Claiming activation that has not
        // happened is a false statement on a money surface.
        expect(paymentAckState(true, undefined).kind).toBe('processing');
        expect(paymentAckState(true, 'grace_period').kind).toBe('processing');
        expect(paymentAckState(true, 'locked').kind).toBe('processing');
    });
});

describe('bundle purchases (codex r1 [P1])', () => {
    it('gets its own single-state message — there is no pool status to wait on', () => {
        const s = paymentAckState(true, undefined, 'bundle');
        expect(s.kind).toBe('active');
        expect(s.title).toContain('Payment received');
        expect(s.detail).toContain('Credits and passes');
    });

    it('still says nothing when the visitor did not come back from checkout', () => {
        expect(paymentAckState(false, undefined, 'bundle').kind).toBe('none');
    });

    it('defaults to the pool wording when the kind is omitted', () => {
        expect(paymentAckState(true, 'trial').detail).toContain('trial banner');
    });
});

describe('consumePaymentSuccess', () => {
    it('detects the marker and strips it', () => {
        const r = consumePaymentSuccess('?payment=success&session_id=cs_test_123');
        expect(r.returned).toBe(true);
        expect(r.cleanedSearch).toBe('');
    });

    it('strips session_id too — it is Stripe’s and the URL gets shared', () => {
        const r = consumePaymentSuccess('?tab=standings&payment=success&session_id=cs_test_123');
        expect(r.returned).toBe(true);
        expect(r.cleanedSearch).toBe('?tab=standings');
    });

    it('leaves an unrelated query string exactly alone', () => {
        const r = consumePaymentSuccess('?tab=standings&week=3');
        expect(r.returned).toBe(false);
        expect(r.cleanedSearch).toBe('?tab=standings&week=3');
    });

    it('does not fire on payment=cancelled, which another surface owns', () => {
        expect(consumePaymentSuccess('?payment=cancelled').returned).toBe(false);
    });

    it('handles an empty search string', () => {
        expect(consumePaymentSuccess('')).toEqual({ returned: false, cleanedSearch: '' });
    });
});
