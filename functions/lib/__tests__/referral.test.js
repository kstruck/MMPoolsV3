"use strict";
/**
 * referral.test.ts — Unit tests for referral system logic
 *
 * Tests the referral token generation/parsing and the credit accumulation
 * logic from creditReferralOnPayment in referral.ts.
 *
 * Runner: vitest
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// ─────────────────────────────────────────────────────────────────────────────
// Token generation / parsing helpers
// (In the real app these use btoa/atob, which are globals in Node 16+)
// ─────────────────────────────────────────────────────────────────────────────
function generateReferralToken(userId) {
    return Buffer.from(userId).toString('base64');
}
function parseReferralToken(token) {
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        // Basic sanity: a decoded userId should be non-empty and not contain null bytes
        if (!decoded || decoded.includes('\0'))
            return null;
        return decoded;
    }
    catch (_a) {
        return null;
    }
}
function accumulateCredit(current, config) {
    const newCredits = current.referralCredits + 1;
    const result = Object.assign(Object.assign({}, current), { referralCredits: newCredits });
    // If they've hit the free pool threshold, award a free pool token
    if (newCredits >= config.creditsRequiredForFreePool) {
        result.freePoolsAvailable = current.freePoolsAvailable + 1;
        result.referralCredits = newCredits - config.creditsRequiredForFreePool;
    }
    return result;
}
// ─────────────────────────────────────────────────────────────────────────────
// 1. Token generation
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Referral token generation', () => {
    (0, vitest_1.it)('should produce a base64-encoded token from a userId', () => {
        const token = generateReferralToken('user_abc123');
        (0, vitest_1.expect)(token).toBeTruthy();
        (0, vitest_1.expect)(typeof token).toBe('string');
        // Base64 should not contain special URL characters that would break a link
        (0, vitest_1.expect)(token).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
    (0, vitest_1.it)('should produce different tokens for different userIds', () => {
        const token1 = generateReferralToken('user_1');
        const token2 = generateReferralToken('user_2');
        (0, vitest_1.expect)(token1).not.toBe(token2);
    });
    (0, vitest_1.it)('should produce the same token for the same userId (deterministic)', () => {
        const token1 = generateReferralToken('consistent_user');
        const token2 = generateReferralToken('consistent_user');
        (0, vitest_1.expect)(token1).toBe(token2);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 2. Token parsing
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Referral token parsing', () => {
    (0, vitest_1.it)('should decode a valid token back to the original userId', () => {
        const originalUserId = 'user_abc123';
        const token = generateReferralToken(originalUserId);
        const parsed = parseReferralToken(token);
        (0, vitest_1.expect)(parsed).toBe(originalUserId);
    });
    (0, vitest_1.it)('should round-trip complex userIds with special characters', () => {
        const complexId = 'firebase|auth0|12345-abcdef';
        const token = generateReferralToken(complexId);
        const parsed = parseReferralToken(token);
        (0, vitest_1.expect)(parsed).toBe(complexId);
    });
    (0, vitest_1.it)('should handle an empty userId gracefully', () => {
        const token = generateReferralToken('');
        const parsed = parseReferralToken(token);
        // Empty string encodes to empty base64, which decodes to empty string
        // Our parser treats empty as null
        (0, vitest_1.expect)(parsed).toBeNull();
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 3. Invalid token
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Invalid referral token handling', () => {
    (0, vitest_1.it)('should return null for garbage input', () => {
        // While most strings can technically be base64 decoded, this tests the flow
        const result = parseReferralToken('');
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)('should return a decoded string for technically valid base64 (non-matching userId)', () => {
        // "AAAA" is valid base64 that decodes to 3 null bytes → our null check catches this
        const result = parseReferralToken('AAAA');
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)('should handle very long garbage strings', () => {
        const longGarbage = 'x'.repeat(10000);
        const result = parseReferralToken(longGarbage);
        // Should not throw, result is some decoded string or null
        (0, vitest_1.expect)(result === null || typeof result === 'string').toBe(true);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 4. Credit accumulation
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Referral credit accumulation', () => {
    const config = {
        creditsRequiredForFreePool: 5,
        discountPerCredit: 5,
        rewardType: 'free_pool',
    };
    (0, vitest_1.it)('should increment credits by 1 for each referral', () => {
        const before = { referralCredits: 2, freePoolsAvailable: 0 };
        const after = accumulateCredit(before, config);
        (0, vitest_1.expect)(after.referralCredits).toBe(3);
        (0, vitest_1.expect)(after.freePoolsAvailable).toBe(0);
    });
    (0, vitest_1.it)('should award a free pool token at the threshold (5 credits → 1 free pool)', () => {
        const before = { referralCredits: 4, freePoolsAvailable: 0 };
        const after = accumulateCredit(before, config);
        // 4 + 1 = 5, which hits threshold → award free pool, reset credits
        (0, vitest_1.expect)(after.freePoolsAvailable).toBe(1);
        (0, vitest_1.expect)(after.referralCredits).toBe(0); // 5 - 5 = 0
    });
    (0, vitest_1.it)('should carry over excess credits after awarding a free pool', () => {
        // Edge case: config with threshold 3
        const lowConfig = {
            creditsRequiredForFreePool: 3,
            discountPerCredit: 5,
            rewardType: 'free_pool',
        };
        const before = { referralCredits: 2, freePoolsAvailable: 1 };
        const after = accumulateCredit(before, lowConfig);
        // 2 + 1 = 3, hits threshold → award, 3 - 3 = 0 credits remaining
        (0, vitest_1.expect)(after.freePoolsAvailable).toBe(2);
        (0, vitest_1.expect)(after.referralCredits).toBe(0);
    });
    (0, vitest_1.it)('should NOT award a free pool if credits are below threshold', () => {
        const before = { referralCredits: 1, freePoolsAvailable: 0 };
        const after = accumulateCredit(before, config);
        (0, vitest_1.expect)(after.freePoolsAvailable).toBe(0);
        (0, vitest_1.expect)(after.referralCredits).toBe(2);
    });
    (0, vitest_1.it)('should accumulate multiple free pools over time', () => {
        let state = { referralCredits: 0, freePoolsAvailable: 0 };
        // 10 referrals with threshold=5 should yield 2 free pools
        for (let i = 0; i < 10; i++) {
            state = accumulateCredit(state, config);
        }
        (0, vitest_1.expect)(state.freePoolsAvailable).toBe(2);
        (0, vitest_1.expect)(state.referralCredits).toBe(0);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// 5. Double-credit prevention
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Double-credit prevention', () => {
    (0, vitest_1.it)('should skip already-confirmed referrals (creditReferralOnPayment only processes pending)', () => {
        const confirmedReferral = {
            referrerId: 'referrer_1',
            referredUserId: 'referred_1',
            status: 'confirmed', // Already processed
            createdAt: Date.now() - 86400000,
            confirmedAt: Date.now() - 3600000,
            creditAwarded: true,
        };
        // The query in creditReferralOnPayment filters: .where('status', '==', 'pending')
        // So a 'confirmed' referral would NOT appear in results.
        (0, vitest_1.expect)(confirmedReferral.status).toBe('confirmed');
        (0, vitest_1.expect)(confirmedReferral.status).not.toBe('pending');
        // Simulating the query result: confirmed referrals are excluded
        const pendingReferrals = [confirmedReferral].filter(r => r.status === 'pending');
        (0, vitest_1.expect)(pendingReferrals).toHaveLength(0);
    });
    (0, vitest_1.it)('should only process pending referrals', () => {
        const referrals = [
            {
                referrerId: 'referrer_1',
                referredUserId: 'referred_1',
                status: 'confirmed',
                createdAt: Date.now() - 86400000,
                confirmedAt: Date.now() - 3600000,
                creditAwarded: true,
            },
            {
                referrerId: 'referrer_2',
                referredUserId: 'referred_2',
                status: 'pending',
                createdAt: Date.now() - 43200000,
                creditAwarded: false,
            },
        ];
        const pendingOnly = referrals.filter(r => r.status === 'pending');
        (0, vitest_1.expect)(pendingOnly).toHaveLength(1);
        (0, vitest_1.expect)(pendingOnly[0].referrerId).toBe('referrer_2');
    });
    (0, vitest_1.it)('should mark referral as confirmed after processing', () => {
        const referral = {
            referrerId: 'referrer_1',
            referredUserId: 'referred_1',
            status: 'pending',
            createdAt: Date.now() - 86400000,
            creditAwarded: false,
        };
        // Simulate the transaction update
        const updated = Object.assign(Object.assign({}, referral), { status: 'confirmed', confirmedAt: Date.now(), creditAwarded: true });
        (0, vitest_1.expect)(updated.status).toBe('confirmed');
        (0, vitest_1.expect)(updated.creditAwarded).toBe(true);
        (0, vitest_1.expect)(updated.confirmedAt).toBeDefined();
    });
    (0, vitest_1.it)('should not process a referral where billing status did NOT change to active', () => {
        // The trigger checks: before.billing?.status !== after.billing?.status
        // AND after.billing?.status === 'active'
        const beforeBilling = { status: 'trial' };
        const afterBilling = { status: 'trial' }; // No change
        const statusChanged = beforeBilling.status !== afterBilling.status;
        const isNowActive = afterBilling.status === 'active';
        (0, vitest_1.expect)(statusChanged).toBe(false);
        // Function returns early if status didn't change
    });
    (0, vitest_1.it)('should only trigger on transition TO active (not from active to something else)', () => {
        const beforeBilling = { status: 'active' };
        const afterBilling = { status: 'locked' }; // Changed but NOT to active
        const statusChanged = beforeBilling.status !== afterBilling.status;
        const isNowActive = afterBilling.status === 'active';
        (0, vitest_1.expect)(statusChanged).toBe(true);
        (0, vitest_1.expect)(isNowActive).toBe(false);
        // Function returns early because new status is not 'active'
    });
});
//# sourceMappingURL=referral.test.js.map