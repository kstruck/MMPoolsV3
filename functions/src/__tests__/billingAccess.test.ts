/**
 * billingAccess.test.ts — Unit tests for the deny-by-default paid-feature gate
 * (PLAN Phase 4 #6c). Imports the REAL checkBillingAccess (pure lib, no Firebase
 * init). Runner: vitest.
 *
 * The key behavior change: a MISSING featuresUnlocked flag now DENIES a paid
 * feature (previously it was treated as allowed).
 */
import { describe, it, expect } from 'vitest';
import { checkBillingAccess, PAID_FEATURE_KEYS } from '../lib/billingAccess';
import type { PoolBilling } from '../types';

const activeBilling = (features?: Partial<PoolBilling['featuresUnlocked']>): PoolBilling => ({
  status: 'active',
  tier: 'premium_tier',
  pricePaid: 49,
  maxPlayersAllowed: 50,
  featuresUnlocked: features as PoolBilling['featuresUnlocked'],
});

describe('checkBillingAccess — pool-level', () => {
  it('allows when there is no billing record (legacy free pool)', () => {
    expect(checkBillingAccess(undefined).allowed).toBe(true);
  });

  it('denies a locked pool', () => {
    const r = checkBillingAccess(activeBilling({ aiCommissioner: true }) && { ...activeBilling(), status: 'locked' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/locked/i);
  });

  it('allows a non-locked pool with no feature requested', () => {
    expect(checkBillingAccess(activeBilling({ aiCommissioner: false })).allowed).toBe(true);
  });
});

describe('checkBillingAccess — deny-by-default for paid features', () => {
  it.each(PAID_FEATURE_KEYS as readonly string[])('DENIES paid feature "%s" when its flag is MISSING', (feature) => {
    // featuresUnlocked present but WITHOUT this key.
    const billing = activeBilling({});
    const r = checkBillingAccess(billing, feature);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/premium/i);
  });

  it.each(PAID_FEATURE_KEYS as readonly string[])('DENIES paid feature "%s" when featuresUnlocked is entirely undefined', (feature) => {
    const billing = { status: 'active', tier: 'premium_tier', pricePaid: 0, maxPlayersAllowed: 10 } as unknown as PoolBilling;
    expect(checkBillingAccess(billing, feature).allowed).toBe(false);
  });

  it.each(PAID_FEATURE_KEYS as readonly string[])('DENIES paid feature "%s" when explicitly false', (feature) => {
    const billing = activeBilling({ [feature]: false } as Partial<PoolBilling['featuresUnlocked']>);
    expect(checkBillingAccess(billing, feature).allowed).toBe(false);
  });

  it.each(PAID_FEATURE_KEYS as readonly string[])('ALLOWS paid feature "%s" only when explicitly true', (feature) => {
    const billing = activeBilling({ [feature]: true } as Partial<PoolBilling['featuresUnlocked']>);
    expect(checkBillingAccess(billing, feature).allowed).toBe(true);
  });
});

describe('checkBillingAccess — non-paid / unknown feature keys keep prior semantics', () => {
  it('allows an unknown feature key when its flag is missing', () => {
    const billing = activeBilling({ aiCommissioner: true });
    expect(checkBillingAccess(billing, 'someUnknownFeature').allowed).toBe(true);
  });

  it('denies an unknown feature key only when explicitly false', () => {
    const billing = { ...activeBilling({}), featuresUnlocked: { someUnknownFeature: false } as any };
    expect(checkBillingAccess(billing, 'someUnknownFeature').allowed).toBe(false);
  });
});
