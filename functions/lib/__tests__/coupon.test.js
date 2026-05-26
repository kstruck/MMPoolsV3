"use strict";
/**
 * coupon.test.ts — Unit tests for coupon validation logic
 *
 * Extracts and tests the validation chain from redeemCoupon in billing.ts.
 * All Firebase/Firestore dependencies are replaced with pure function tests.
 *
 * Runner: vitest
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
function validateCoupon(coupon, userId, poolType, now = Date.now()) {
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
        if (!coupon.allowedPoolTypes.includes(poolType)) {
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
function applyDiscount(originalPrice, discountType, discountValue) {
    let finalPrice;
    if (discountType === 'percentage') {
        finalPrice = originalPrice * (1 - discountValue / 100);
    }
    else {
        finalPrice = originalPrice - discountValue;
    }
    // Stacking guard: never go below $0
    return Math.max(0, finalPrice);
}
// ─────────────────────────────────────────────────────────────────────────────
// Test Suites
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Coupon Validation', () => {
    const now = 1700000000000; // fixed timestamp for deterministic tests
    const baseCoupon = {
        code: 'TESTCODE',
        discountType: 'percentage',
        discountValue: 20,
        isActive: true,
        usesCount: 0,
        createdAt: now - 86400000,
    };
    // ── 1. Valid coupon ──────────────────────────────────────────────────────
    (0, vitest_1.it)('should accept a valid, active, non-expired coupon within limits', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { maxUses: 100, expiresAt: now + 86400000 });
        const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
        (0, vitest_1.expect)(result.valid).toBe(true);
        if (result.valid) {
            (0, vitest_1.expect)(result.discountType).toBe('percentage');
            (0, vitest_1.expect)(result.discountValue).toBe(20);
        }
    });
    // ── 2. Expired coupon ────────────────────────────────────────────────────
    (0, vitest_1.it)('should reject an expired coupon (expiresAt < now)', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { expiresAt: now - 86400000 });
        const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
        (0, vitest_1.expect)(result.valid).toBe(false);
        if (!result.valid) {
            (0, vitest_1.expect)(result.reason).toContain('expired');
        }
    });
    (0, vitest_1.it)('should accept a coupon with no expiresAt (never expires)', () => {
        const coupon = Object.assign({}, baseCoupon);
        const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    // ── 3. Maxed out coupon ──────────────────────────────────────────────────
    (0, vitest_1.it)('should reject a coupon that has reached maxUses', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { maxUses: 5, usesCount: 5 });
        const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
        (0, vitest_1.expect)(result.valid).toBe(false);
        if (!result.valid) {
            (0, vitest_1.expect)(result.reason).toContain('maximum number of uses');
        }
    });
    (0, vitest_1.it)('should accept a coupon where usesCount < maxUses', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { maxUses: 10, usesCount: 9 });
        const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    (0, vitest_1.it)('should accept a coupon with no maxUses set (unlimited)', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { usesCount: 9999 });
        const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    // ── 4. Per-user limit ────────────────────────────────────────────────────
    (0, vitest_1.it)('should reject when user has used coupon perUserLimit times', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { perUserLimit: 2, usageLog: [
                { userId: 'user_1', poolId: 'pool_a', usedAt: now - 1000 },
                { userId: 'user_1', poolId: 'pool_b', usedAt: now - 500 },
            ] });
        const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
        (0, vitest_1.expect)(result.valid).toBe(false);
        if (!result.valid) {
            (0, vitest_1.expect)(result.reason).toContain('maximum number of times');
        }
    });
    (0, vitest_1.it)('should allow a different user even if another user hit the limit', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { perUserLimit: 1, usageLog: [
                { userId: 'user_1', poolId: 'pool_a', usedAt: now - 1000 }, // user_1 is maxed
            ] });
        const result = validateCoupon(coupon, 'user_2', 'SQUARES', now);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    (0, vitest_1.it)('should allow when perUserLimit is not set (no per-user restriction)', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { 
            // perUserLimit is undefined
            usageLog: [
                { userId: 'user_1', poolId: 'pool_a', usedAt: now - 1000 },
                { userId: 'user_1', poolId: 'pool_b', usedAt: now - 500 },
                { userId: 'user_1', poolId: 'pool_c', usedAt: now - 200 },
            ] });
        const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    // ── 5. Pool type restriction ─────────────────────────────────────────────
    (0, vitest_1.it)('should reject coupon with allowedPoolTypes when pool type is not in the list', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { allowedPoolTypes: ['SQUARES'] });
        const result = validateCoupon(coupon, 'user_1', 'BRACKET', now);
        (0, vitest_1.expect)(result.valid).toBe(false);
        if (!result.valid) {
            (0, vitest_1.expect)(result.reason).toContain('not valid for BRACKET');
        }
    });
    (0, vitest_1.it)('should accept coupon when pool type IS in allowedPoolTypes', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { allowedPoolTypes: ['SQUARES', 'BRACKET'] });
        const result = validateCoupon(coupon, 'user_1', 'BRACKET', now);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    (0, vitest_1.it)('should accept coupon when allowedPoolTypes is empty (all types allowed)', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { allowedPoolTypes: [] });
        const result = validateCoupon(coupon, 'user_1', 'NFL_PLAYOFFS', now);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    (0, vitest_1.it)('should accept coupon when allowedPoolTypes is undefined (all types allowed)', () => {
        const coupon = Object.assign({}, baseCoupon);
        const result = validateCoupon(coupon, 'user_1', 'PROPS', now);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    // ── 6. Inactive coupon ───────────────────────────────────────────────────
    (0, vitest_1.it)('should reject an inactive coupon', () => {
        const coupon = Object.assign(Object.assign({}, baseCoupon), { isActive: false });
        const result = validateCoupon(coupon, 'user_1', 'SQUARES', now);
        (0, vitest_1.expect)(result.valid).toBe(false);
        if (!result.valid) {
            (0, vitest_1.expect)(result.reason).toContain('no longer active');
        }
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// Discount Math
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Discount calculation', () => {
    // ── 6. Percentage vs flat discount ────────────────────────────────────────
    (0, vitest_1.it)('should correctly apply a percentage discount', () => {
        // 20% off $49 = $39.20
        (0, vitest_1.expect)(applyDiscount(49, 'percentage', 20)).toBeCloseTo(39.2, 2);
    });
    (0, vitest_1.it)('should correctly apply a 50% percentage discount', () => {
        (0, vitest_1.expect)(applyDiscount(100, 'percentage', 50)).toBe(50);
    });
    (0, vitest_1.it)('should correctly apply a 100% percentage discount (free)', () => {
        (0, vitest_1.expect)(applyDiscount(79, 'percentage', 100)).toBe(0);
    });
    (0, vitest_1.it)('should correctly apply a flat dollar discount', () => {
        // $10 off $49 = $39
        (0, vitest_1.expect)(applyDiscount(49, 'flat', 10)).toBe(39);
    });
    (0, vitest_1.it)('should correctly apply a flat discount equal to the price', () => {
        (0, vitest_1.expect)(applyDiscount(29, 'flat', 29)).toBe(0);
    });
    // ── 7. Stacking guard — never below $0 ───────────────────────────────────
    (0, vitest_1.it)('should clamp to $0 when flat discount exceeds price', () => {
        (0, vitest_1.expect)(applyDiscount(10, 'flat', 25)).toBe(0);
    });
    (0, vitest_1.it)('should clamp to $0 when percentage discount > 100%', () => {
        // Defensive: should never happen, but guard anyway
        (0, vitest_1.expect)(applyDiscount(49, 'percentage', 150)).toBe(0);
    });
    (0, vitest_1.it)('should handle $0 original price gracefully', () => {
        (0, vitest_1.expect)(applyDiscount(0, 'flat', 10)).toBe(0);
        (0, vitest_1.expect)(applyDiscount(0, 'percentage', 50)).toBe(0);
    });
});
//# sourceMappingURL=coupon.test.js.map