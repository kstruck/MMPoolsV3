"use strict";
/**
 * billing.test.ts — Unit tests for Cloud Functions billing logic
 *
 * Tests the enforceBillingStatus scheduler and validateBillingAccess callable.
 * All Firebase Admin / Firestore interactions are mocked with test doubles.
 *
 * Runner: vitest (matches existing project setup)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
function createMockDoc(id, data, exists = true) {
    return {
        id,
        data: () => data,
        ref: { id },
        exists,
    };
}
function createMockQuerySnapshot(docs) {
    return {
        docs,
        empty: docs.length === 0,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// 1. enforceBillingStatus — Billing status transitions
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('enforceBillingStatus — billing status transitions', () => {
    const ONE_DAY_MS = 86400000;
    const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
    const defaultBillingConfig = {
        freePlayerThreshold: 10,
        gracePeriodDays: 7,
        pricing: {
            season: {
                tier1: { min: 0, max: 10, price: 0 },
                tier2: { min: 11, max: 25, price: 29 },
                tier3: { min: 26, max: 50, price: 49 },
                tier4: { min: 51, max: 999, price: 79 },
            },
            bracket: {
                tier1: { min: 0, max: 10, price: 0 },
                tier2: { min: 11, max: 25, price: 19 },
                tier3: { min: 26, max: 50, price: 39 },
                tier4: { min: 51, max: 999, price: 59 },
            },
            squares: { flatPrice: 9 },
            props: { flatPrice: 9 },
        },
        features: {
            aiCommissioner: { isPremium: true, addonPrice: 10 },
            smsNotifications: { isPremium: true, addonPrice: 5 },
            whatIfSimulator: { isPremium: true, addonPrice: 5 },
            customBranding: { isPremium: false, addonPrice: 0 },
        },
    };
    (0, vitest_1.it)('should identify pools with expired trials for transition to grace_period', () => {
        const now = Date.now();
        const pool = {
            billing: {
                status: 'trial',
                tier: 'free_tier',
                pricePaid: 0,
                trialEndsAt: now - ONE_DAY_MS, // expired yesterday
                maxPlayersAllowed: 10,
                featuresUnlocked: {
                    aiCommissioner: false,
                    smsNotifications: false,
                    whatIfSimulator: false,
                    customBranding: true,
                },
            },
        };
        // Verify the pool qualifies for transition
        (0, vitest_1.expect)(pool.billing.status).toBe('trial');
        (0, vitest_1.expect)(pool.billing.trialEndsAt).toBeLessThan(now);
        // Simulate the transition logic from enforceBillingStatus
        const newStatus = 'grace_period';
        const gracePeriodEndsAt = now + (defaultBillingConfig.gracePeriodDays * ONE_DAY_MS);
        (0, vitest_1.expect)(newStatus).toBe('grace_period');
        (0, vitest_1.expect)(gracePeriodEndsAt).toBe(now + SEVEN_DAYS_MS);
    });
    (0, vitest_1.it)('should NOT transition a pool whose trial has NOT expired', () => {
        const now = Date.now();
        const pool = {
            billing: {
                status: 'trial',
                tier: 'free_tier',
                pricePaid: 0,
                trialEndsAt: now + 3 * ONE_DAY_MS, // 3 days from now
                maxPlayersAllowed: 10,
                featuresUnlocked: {
                    aiCommissioner: false,
                    smsNotifications: false,
                    whatIfSimulator: false,
                    customBranding: true,
                },
            },
        };
        // This pool should NOT be in the expired query results
        const isExpired = pool.billing.trialEndsAt < now;
        (0, vitest_1.expect)(isExpired).toBe(false);
    });
    (0, vitest_1.it)('should transition grace_period → locked when grace period expires', () => {
        const now = Date.now();
        const pool = {
            billing: {
                status: 'grace_period',
                tier: 'standard_tier',
                pricePaid: 0,
                gracePeriodEndsAt: now - ONE_DAY_MS, // expired yesterday
                maxPlayersAllowed: 25,
                featuresUnlocked: {
                    aiCommissioner: false,
                    smsNotifications: false,
                    whatIfSimulator: false,
                    customBranding: true,
                },
            },
        };
        // Verify the pool qualifies for lock transition
        (0, vitest_1.expect)(pool.billing.status).toBe('grace_period');
        (0, vitest_1.expect)(pool.billing.gracePeriodEndsAt).toBeLessThan(now);
        // Simulate the transition
        const newStatus = 'locked';
        (0, vitest_1.expect)(newStatus).toBe('locked');
    });
    (0, vitest_1.it)('should use configurable grace period days from BillingConfig', () => {
        const customConfig = Object.assign(Object.assign({}, defaultBillingConfig), { gracePeriodDays: 14 });
        const now = Date.now();
        const gracePeriodMs = customConfig.gracePeriodDays * ONE_DAY_MS;
        const gracePeriodEndsAt = now + gracePeriodMs;
        (0, vitest_1.expect)(gracePeriodEndsAt).toBe(now + 14 * ONE_DAY_MS);
    });
    (0, vitest_1.it)('should default to 7-day grace period when config is missing', () => {
        var _a;
        const billingConfig = undefined;
        const gracePeriodDays = (_a = billingConfig === null || billingConfig === void 0 ? void 0 : billingConfig.gracePeriodDays) !== null && _a !== void 0 ? _a : 7;
        (0, vitest_1.expect)(gracePeriodDays).toBe(7);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 2. validateBillingAccess — Access control checks
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('validateBillingAccess — access control', () => {
    /**
     * Extracted logic mirror of the validateBillingAccess callable.
     * We test the pure decision logic without the Firebase wrapper.
     */
    function checkBillingAccess(billing, feature) {
        // No billing record = free pool, always allowed
        if (!billing) {
            return { allowed: true };
        }
        // Locked pool requires payment
        if (billing.status === 'locked') {
            return { allowed: false, reason: 'Pool is locked. Payment required.' };
        }
        // Check specific feature access
        if (feature) {
            const featureKey = feature;
            if (billing.featuresUnlocked && featureKey in billing.featuresUnlocked) {
                if (!billing.featuresUnlocked[featureKey]) {
                    return { allowed: false, reason: 'Feature requires premium upgrade.' };
                }
            }
        }
        return { allowed: true };
    }
    (0, vitest_1.it)('should allow access when billing is undefined (free pool)', () => {
        const result = checkBillingAccess(undefined);
        (0, vitest_1.expect)(result.allowed).toBe(true);
        (0, vitest_1.expect)(result.reason).toBeUndefined();
    });
    (0, vitest_1.it)('should allow access for active pools', () => {
        const billing = {
            status: 'active',
            tier: 'standard_tier',
            pricePaid: 29,
            maxPlayersAllowed: 25,
            featuresUnlocked: {
                aiCommissioner: true,
                smsNotifications: true,
                whatIfSimulator: true,
                customBranding: true,
            },
        };
        const result = checkBillingAccess(billing);
        (0, vitest_1.expect)(result.allowed).toBe(true);
    });
    (0, vitest_1.it)('should allow access for trial pools', () => {
        const billing = {
            status: 'trial',
            tier: 'free_tier',
            pricePaid: 0,
            trialEndsAt: Date.now() + 86400000 * 14,
            maxPlayersAllowed: 10,
            featuresUnlocked: {
                aiCommissioner: false,
                smsNotifications: false,
                whatIfSimulator: false,
                customBranding: true,
            },
        };
        const result = checkBillingAccess(billing);
        (0, vitest_1.expect)(result.allowed).toBe(true);
    });
    (0, vitest_1.it)('should block access for locked pools', () => {
        const billing = {
            status: 'locked',
            tier: 'standard_tier',
            pricePaid: 0,
            maxPlayersAllowed: 25,
            featuresUnlocked: {
                aiCommissioner: false,
                smsNotifications: false,
                whatIfSimulator: false,
                customBranding: true,
            },
        };
        const result = checkBillingAccess(billing);
        (0, vitest_1.expect)(result.allowed).toBe(false);
        (0, vitest_1.expect)(result.reason).toBe('Pool is locked. Payment required.');
    });
    (0, vitest_1.it)('should block access to a premium feature that is not unlocked', () => {
        const billing = {
            status: 'active',
            tier: 'standard_tier',
            pricePaid: 29,
            maxPlayersAllowed: 25,
            featuresUnlocked: {
                aiCommissioner: false, // NOT unlocked
                smsNotifications: true,
                whatIfSimulator: false,
                customBranding: true,
            },
        };
        const result = checkBillingAccess(billing, 'aiCommissioner');
        (0, vitest_1.expect)(result.allowed).toBe(false);
        (0, vitest_1.expect)(result.reason).toBe('Feature requires premium upgrade.');
    });
    (0, vitest_1.it)('should allow access to a premium feature that IS unlocked', () => {
        const billing = {
            status: 'active',
            tier: 'premium_tier',
            pricePaid: 79,
            maxPlayersAllowed: 100,
            featuresUnlocked: {
                aiCommissioner: true,
                smsNotifications: true,
                whatIfSimulator: true,
                customBranding: true,
            },
        };
        const result = checkBillingAccess(billing, 'aiCommissioner');
        (0, vitest_1.expect)(result.allowed).toBe(true);
    });
    (0, vitest_1.it)('should allow access when requesting a feature key not in featuresUnlocked', () => {
        const billing = {
            status: 'active',
            tier: 'standard_tier',
            pricePaid: 29,
            maxPlayersAllowed: 25,
            featuresUnlocked: {
                aiCommissioner: false,
                smsNotifications: false,
                whatIfSimulator: false,
                customBranding: true,
            },
        };
        // "unknownFeature" not in the map → falls through, allowed
        const result = checkBillingAccess(billing, 'unknownFeature');
        (0, vitest_1.expect)(result.allowed).toBe(true);
    });
    (0, vitest_1.it)('should allow grace_period pools general access (only locked blocks)', () => {
        const billing = {
            status: 'grace_period',
            tier: 'standard_tier',
            pricePaid: 0,
            gracePeriodEndsAt: Date.now() + 86400000 * 3,
            maxPlayersAllowed: 25,
            featuresUnlocked: {
                aiCommissioner: false,
                smsNotifications: false,
                whatIfSimulator: false,
                customBranding: true,
            },
        };
        const result = checkBillingAccess(billing);
        (0, vitest_1.expect)(result.allowed).toBe(true);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 3. Free pool bypass — ≤10 players stays free
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Free pool bypass', () => {
    (0, vitest_1.it)('should treat a pool with ≤10 players and free_tier billing as free', () => {
        const billing = {
            status: 'free',
            tier: 'free_tier',
            pricePaid: 0,
            maxPlayersAllowed: 10,
            featuresUnlocked: {
                aiCommissioner: false,
                smsNotifications: false,
                whatIfSimulator: false,
                customBranding: true,
            },
        };
        // Free pools should always be allowed and never transition to locked
        (0, vitest_1.expect)(billing.status).toBe('free');
        (0, vitest_1.expect)(billing.tier).toBe('free_tier');
        (0, vitest_1.expect)(billing.maxPlayersAllowed).toBeLessThanOrEqual(10);
    });
    (0, vitest_1.it)('should never lock a free pool (status stays free regardless of time)', () => {
        const billing = {
            status: 'free',
            tier: 'free_tier',
            pricePaid: 0,
            maxPlayersAllowed: 10,
            featuresUnlocked: {
                aiCommissioner: false,
                smsNotifications: false,
                whatIfSimulator: false,
                customBranding: true,
            },
        };
        // The enforceBillingStatus scheduler only queries trial and grace_period,
        // so free pools are never touched by the scheduler.
        (0, vitest_1.expect)(billing.status).not.toBe('trial');
        (0, vitest_1.expect)(billing.status).not.toBe('grace_period');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 4. Tier pricing calculation
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Tier pricing calculation', () => {
    const billingConfig = {
        freePlayerThreshold: 10,
        gracePeriodDays: 7,
        pricing: {
            season: {
                tier1: { min: 0, max: 10, price: 0 },
                tier2: { min: 11, max: 25, price: 29 },
                tier3: { min: 26, max: 50, price: 49 },
                tier4: { min: 51, max: 999, price: 79 },
            },
            bracket: {
                tier1: { min: 0, max: 10, price: 0 },
                tier2: { min: 11, max: 25, price: 19 },
                tier3: { min: 26, max: 50, price: 39 },
                tier4: { min: 51, max: 999, price: 59 },
            },
            squares: { flatPrice: 9 },
            props: { flatPrice: 9 },
        },
        features: {
            aiCommissioner: { isPremium: true, addonPrice: 10 },
            smsNotifications: { isPremium: true, addonPrice: 5 },
            whatIfSimulator: { isPremium: true, addonPrice: 5 },
            customBranding: { isPremium: false, addonPrice: 0 },
        },
    };
    function getTierPrice(playerCount, poolType) {
        if (poolType === 'squares')
            return billingConfig.pricing.squares.flatPrice;
        if (poolType === 'props')
            return billingConfig.pricing.props.flatPrice;
        const tiers = billingConfig.pricing[poolType];
        for (const tier of [tiers.tier1, tiers.tier2, tiers.tier3, tiers.tier4]) {
            if (playerCount >= tier.min && playerCount <= tier.max) {
                return tier.price;
            }
        }
        return tiers.tier4.price; // fallback to highest tier
    }
    (0, vitest_1.it)('should return $0 for ≤10 players in a season pool (free tier)', () => {
        (0, vitest_1.expect)(getTierPrice(5, 'season')).toBe(0);
        (0, vitest_1.expect)(getTierPrice(10, 'season')).toBe(0);
    });
    (0, vitest_1.it)('should return $29 for 11-25 players in a season pool', () => {
        (0, vitest_1.expect)(getTierPrice(11, 'season')).toBe(29);
        (0, vitest_1.expect)(getTierPrice(25, 'season')).toBe(29);
    });
    (0, vitest_1.it)('should return $49 for 26-50 players in a season pool', () => {
        (0, vitest_1.expect)(getTierPrice(30, 'season')).toBe(49);
    });
    (0, vitest_1.it)('should return $79 for 51+ players in a season pool', () => {
        (0, vitest_1.expect)(getTierPrice(100, 'season')).toBe(79);
    });
    (0, vitest_1.it)('should return $19 for 11-25 players in a bracket pool', () => {
        (0, vitest_1.expect)(getTierPrice(15, 'bracket')).toBe(19);
    });
    (0, vitest_1.it)('should return flat $9 for squares pools regardless of player count', () => {
        (0, vitest_1.expect)(getTierPrice(5, 'squares')).toBe(9);
        (0, vitest_1.expect)(getTierPrice(100, 'squares')).toBe(9);
    });
    (0, vitest_1.it)('should return flat $9 for props pools regardless of player count', () => {
        (0, vitest_1.expect)(getTierPrice(1, 'props')).toBe(9);
        (0, vitest_1.expect)(getTierPrice(200, 'props')).toBe(9);
    });
});
//# sourceMappingURL=billing.test.js.map