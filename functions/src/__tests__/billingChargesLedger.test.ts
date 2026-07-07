/**
 * billingChargesLedger.test.ts — Unit tests for the ledger schema extension
 * (PLAN Phase 5 #18): paymentIntentId / chargeId / relatedChargeId, kind
 * widening to pool|bundle|refund|dispute, deterministic idempotent doc ids, and
 * the negative-amount refund/dispute adjustment shape. Runner: vitest.
 *
 * Pure helpers only (buildBillingChargeDoc / billingChargeDocId /
 * summarizeCharges) — no Firestore.
 */
import { describe, it, expect } from 'vitest';
import {
  billingChargeDocId,
  buildBillingChargeDoc,
  summarizeCharges,
  type BillingCharge,
} from '../lib/billingCharges';

describe('billingChargeDocId — deterministic, idempotent ids', () => {
  it('pool/bundle rows key off the Stripe session id', () => {
    expect(billingChargeDocId({ userId: 'u', kind: 'pool', amount: 49, stripeSessionId: 'cs_123' })).toBe('cs_123');
    expect(billingChargeDocId({ userId: 'u', kind: 'bundle', amount: 49, stripeSessionId: 'cs_abc' })).toBe('cs_abc');
  });

  it('refund/dispute rows key off the charge id (NOT the session) so they never collide with the original', () => {
    expect(billingChargeDocId({ userId: 'u', kind: 'refund', amount: -49, chargeId: 'ch_9' })).toBe('refund_ch_9');
    expect(billingChargeDocId({ userId: 'u', kind: 'dispute', amount: -49, chargeId: 'ch_9' })).toBe('dispute_ch_9');
  });

  it('refund/dispute ids fall back to relatedChargeId then session id', () => {
    expect(billingChargeDocId({ userId: 'u', kind: 'refund', amount: -1, relatedChargeId: 'cs_orig' })).toBe('refund_cs_orig');
  });
});

describe('buildBillingChargeDoc — shape & new fields', () => {
  it('serializes the widened fields, defaulting absent ones to null', () => {
    const charge: BillingCharge = {
      userId: 'u1', kind: 'pool', amount: 49, poolId: 'p1', tier: 'premium_tier',
      stripeSessionId: 'cs_1', paymentIntentId: 'pi_1',
    };
    const { docId, data } = buildBillingChargeDoc(charge);
    expect(docId).toBe('cs_1');
    expect(data.paymentIntentId).toBe('pi_1');
    expect(data.chargeId).toBeNull();
    expect(data.relatedChargeId).toBeNull();
    expect(data.amount).toBe(49);
    expect(data.kind).toBe('pool');
  });

  it('a refund row is a NEGATIVE-amount adjustment linked via relatedChargeId', () => {
    const refund: BillingCharge = {
      userId: 'u1', kind: 'refund', amount: -49, poolId: 'p1',
      chargeId: 'ch_1', paymentIntentId: 'pi_1', relatedChargeId: 'cs_1',
    };
    const { docId, data } = buildBillingChargeDoc(refund);
    expect(docId).toBe('refund_ch_1');
    expect(data.amount).toBe(-49);
    expect(data.kind).toBe('refund');
    expect(data.relatedChargeId).toBe('cs_1');
    expect(data.chargeId).toBe('ch_1');
  });

  it('coerces a non-finite amount to 0', () => {
    const { data } = buildBillingChargeDoc({ userId: 'u', kind: 'pool', amount: NaN as unknown as number, stripeSessionId: 'cs' });
    expect(data.amount).toBe(0);
  });
});

describe('summarizeCharges — refund/dispute net the totals (kind widening)', () => {
  const NOW = 1_700_000_000_000;
  it('nets negative refund/dispute rows against gross revenue', () => {
    const out = summarizeCharges(
      [
        { amount: 49, kind: 'pool', at: NOW },
        { amount: 30, kind: 'bundle', at: NOW },
        { amount: -49, kind: 'refund', at: NOW },
        { amount: -30, kind: 'dispute', at: NOW },
      ],
      NOW
    );
    expect(out.byKind.pool).toBe(49);
    expect(out.byKind.bundle).toBe(30);
    expect(out.byKind.refund).toBe(-49);
    expect(out.byKind.dispute).toBe(-30);
    expect(out.totalRevenue).toBe(0); // 49 + 30 - 49 - 30
    expect(out.chargeCount).toBe(4);
  });
});
