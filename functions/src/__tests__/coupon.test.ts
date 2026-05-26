/**
 * coupon.test.ts — Unit tests for coupon validation logic
 *
 * Extracts and tests the validation chain from redeemCoupon in billing.ts.
 * All Firebase/Firestore dependencies are replaced with pure function tests.
 *
 * Runner: vitest
 */

import { describe, it, expect } from 'vitest';
import type { Coupon, PoolType } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Pure validation function — mirrors the logic inside redeemCoupon transaction
// ─────────────────────────────────────────────────────────────────────────────

type CouponValidationResult =
  | { valid: true; discountType: Coupon['discountType']; discountValue: number }
  | { valid: false; reason: string };

function validateCoupon(
  coupon: Coupon,
  userId: string,
  poolType: string,
  now = Date.now()
): CouponValidationResult {
  // 1. Active?
  if (!coupon.isActive) {
    return { valid: false, reason: 'This coupon is no longer active.' };
  }

  // 2. Expired?
  if (coupon.expiresAt && coupon.expiresAt < now) {
    return { valid: false, reason: 'This coupon has expired.' };
  }

  // 3. Max uses?
  if (coupon.maxUses !== undefined && coupon.usesCount >= coupon.maxUses) {
    return { valid: false, reason: 'This coupon has reached its maximum number of uses.' };
  }

  // 4. Per-user limit?
  if (coupon.perUserLimit !== undefined && coupon.usageLog) {
    const userUsageCount = coupon.usageLog.filter(entry => entry.userId === userId).length;
    if (userUsageCount >= coupon.perUserLimit) {
      return { valid: false, reason: 'You have already used this coupon the maximum number of times.' };
    }
  }

  // 5. Allowed pool types?
  if (coupon.allowedPoolTypes && coupon.allowedPoolTypes.length > 0) {
    if (!coupon.allowedPoolTypes.includes(poolType as any)) {
      return { valid: false, reason: `This coupon is not valid for ${poolType} pools.` };
    }
  }

  return {
    valid: true,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Discount math helpers
// ─────────────────────────────────────────────────────────────────────────────

function applyDiscount(
  originalPrice: number,
  discountType: 'percentage' | 'flat',
  discountValue: number
): number {
  let finalPrice: number;
  if (discountType === 'percentage') {
    finalPrice = originalPrice * (1 - discountValue / 100);
  } else {
    finalPrice = originalPrice - discountValue;
  }
  // Stacking guard: never go below $0
  return Math.max(0, finalPrice);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suites
// ─────────────────────────────────────────────────────────────────────────────

describe('Coupon Validation', () => {
  const now = 1_700_000_000_000; // fixed timestamp for deterministic tests

  const baseCoupon: Coupon = {
    code: 'TESTCODE',
    discountType: 'percentage',
    discountValue: 20,
    isActive: true,
    usesCount: 0,
    createdAt: now - 86_400_000,
  };

  // ── 1. Valid coupon ──────────────────────────────────────────────────────

  it('should accept a valid, active, non-expired coupon within limits', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      maxUses: 100,
      expiresAt: now + 86_400_000, // expires tomorrow
    };

    const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.discountType).toBe('percentage');
      expect(result.discountValue).toBe(20);
    }
  });

  // ── 2. Expired coupon ────────────────────────────────────────────────────

  it('should reject an expired coupon (expiresAt < now)', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      expiresAt: now - 86_400_000, // expired yesterday
    };

    const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('expired');
    }
  });

  it('should accept a coupon with no expiresAt (never expires)', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      // expiresAt is undefined
    };

    const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
    expect(result.valid).toBe(true);
  });

  // ── 3. Maxed out coupon ──────────────────────────────────────────────────

  it('should reject a coupon that has reached maxUses', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      maxUses: 5,
      usesCount: 5, // all used up
    };

    const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('maximum number of uses');
    }
  });

  it('should accept a coupon where usesCount < maxUses', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      maxUses: 10,
      usesCount: 9, // one left
    };

    const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
    expect(result.valid).toBe(true);
  });

  it('should accept a coupon with no maxUses set (unlimited)', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      usesCount: 9999,
      // maxUses is undefined
    };

    const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
    expect(result.valid).toBe(true);
  });

  // ── 4. Per-user limit ────────────────────────────────────────────────────

  it('should reject when user has used coupon perUserLimit times', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      perUserLimit: 2,
      usageLog: [
        { userId: 'user_1', poolId: 'pool_a', usedAt: now - 1000 },
        { userId: 'user_1', poolId: 'pool_b', usedAt: now - 500 },
      ],
    };

    const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('maximum number of times');
    }
  });

  it('should allow a different user even if another user hit the limit', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      perUserLimit: 1,
      usageLog: [
        { userId: 'user_1', poolId: 'pool_a', usedAt: now - 1000 }, // user_1 is maxed
      ],
    };

    const result = validateCoupon(coupon, 'user_2', 'SQUARES', now);
    expect(result.valid).toBe(true);
  });

  it('should allow when perUserLimit is not set (no per-user restriction)', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      // perUserLimit is undefined
      usageLog: [
        { userId: 'user_1', poolId: 'pool_a', usedAt: now - 1000 },
        { userId: 'user_1', poolId: 'pool_b', usedAt: now - 500 },
        { userId: 'user_1', poolId: 'pool_c', usedAt: now - 200 },
      ],
    };

    const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
    expect(result.valid).toBe(true);
  });

  // ── 5. Pool type restriction ─────────────────────────────────────────────

  it('should reject coupon with allowedPoolTypes when pool type is not in the list', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      allowedPoolTypes: ['SQUARES'] as any[],
    };

    const result = validateCoupon(coupon, 'user_1', 'BRACKET', now);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('not valid for BRACKET');
    }
  });

  it('should accept coupon when pool type IS in allowedPoolTypes', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      allowedPoolTypes: ['SQUARES', 'BRACKET'] as any[],
    };

    const result = validateCoupon(coupon, 'user_1', 'BRACKET', now);
    expect(result.valid).toBe(true);
  });

  it('should accept coupon when allowedPoolTypes is empty (all types allowed)', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      allowedPoolTypes: [] as any[],
    };

    const result = validateCoupon(coupon, 'user_1', 'NFL_PLAYOFFS', now);
    expect(result.valid).toBe(true);
  });

  it('should accept coupon when allowedPoolTypes is undefined (all types allowed)', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      // allowedPoolTypes is undefined
    };

    const result = validateCoupon(coupon, 'user_1', 'PROPS', now);
    expect(result.valid).toBe(true);
  });

  // ── 6. Inactive coupon ───────────────────────────────────────────────────

  it('should reject an inactive coupon', () => {
    const coupon: Coupon = {
      ...baseCoupon,
      isActive: false,
    };

    const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('no longer active');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Discount Math
// ─────────────────────────────────────────────────────────────────────────────

describe('Discount calculation', () => {
  // ── 6. Percentage vs flat discount ────────────────────────────────────────

  it('should correctly apply a percentage discount', () => {
    // 20% off $49 = $39.20
    expect(applyDiscount(49, 'percentage', 20)).toBeCloseTo(39.2, 2);
  });

  it('should correctly apply a 50% percentage discount', () => {
    expect(applyDiscount(100, 'percentage', 50)).toBe(50);
  });

  it('should correctly apply a 100% percentage discount (free)', () => {
    expect(applyDiscount(79, 'percentage', 100)).toBe(0);
  });

  it('should correctly apply a flat dollar discount', () => {
    // $10 off $49 = $39
    expect(applyDiscount(49, 'flat', 10)).toBe(39);
  });

  it('should correctly apply a flat discount equal to the price', () => {
    expect(applyDiscount(29, 'flat', 29)).toBe(0);
  });

  // ── 7. Stacking guard — never below $0 ───────────────────────────────────

  it('should clamp to $0 when flat discount exceeds price', () => {
    expect(applyDiscount(10, 'flat', 25)).toBe(0);
  });

  it('should clamp to $0 when percentage discount > 100%', () => {
    // Defensive: should never happen, but guard anyway
    expect(applyDiscount(49, 'percentage', 150)).toBe(0);
  });

  it('should handle $0 original price gracefully', () => {
    expect(applyDiscount(0, 'flat', 10)).toBe(0);
    expect(applyDiscount(0, 'percentage', 50)).toBe(0);
  });
});
