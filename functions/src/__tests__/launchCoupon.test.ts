import { describe, it, expect, vi } from 'vitest';
import { readLaunchCouponCode, validLaunchCouponCode } from '../lib/launchCoupon';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T3 (D3) — the wizard's coupon is remembered at
 * launch so the upgrade page can preload it. It is an INTENT, never a
 * redemption: nothing is reserved and no usage counter moves here.
 */

describe('readLaunchCouponCode', () => {
    it('uppercases and trims', () => {
        expect(readLaunchCouponCode('  save10 ')).toBe('SAVE10');
    });

    it('accepts dashes and underscores', () => {
        expect(readLaunchCouponCode('early-bird_26')).toBe('EARLY-BIRD_26');
    });

    it.each([
        ['empty', ''],
        ['whitespace only', '   '],
        ['not a string', 42],
        ['null', null],
        ['undefined', undefined],
        ['an object', { code: 'SAVE10' }],
    ])('rejects %s', (_label, value) => {
        expect(readLaunchCouponCode(value)).toBeUndefined();
    });

    it('rejects a code with punctuation or spaces inside', () => {
        expect(readLaunchCouponCode('SAVE 10')).toBeUndefined();
        expect(readLaunchCouponCode('SAVE;DROP')).toBeUndefined();
        expect(readLaunchCouponCode('../../etc')).toBeUndefined();
    });

    it('rejects an over-long code rather than persisting it', () => {
        // The create envelope is permissive; without the cap a client could push
        // an arbitrarily long string into the pool document.
        expect(readLaunchCouponCode('A'.repeat(65))).toBeUndefined();
        expect(readLaunchCouponCode('A'.repeat(64))).toBe('A'.repeat(64));
    });
});

describe('validLaunchCouponCode', () => {
    it('stamps the server-normalized code when the coupon validates', async () => {
        const resolve = vi.fn(async () => ({ state: { code: 'SAVE10', valid: true } }));
        expect(await validLaunchCouponCode(resolve, ' save10 ')).toBe('SAVE10');
        expect(resolve).toHaveBeenCalledWith('SAVE10');
    });

    it('stamps nothing when the coupon is invalid', async () => {
        const resolve = vi.fn(async () => ({ state: { code: 'EXPIRED', valid: false } }));
        expect(await validLaunchCouponCode(resolve, 'expired')).toBeUndefined();
    });

    it('stamps nothing when the coupon does not exist', async () => {
        const resolve = vi.fn(async () => undefined);
        expect(await validLaunchCouponCode(resolve, 'NOPE')).toBeUndefined();
    });

    it('never calls the resolver for a malformed code', async () => {
        const resolve = vi.fn(async () => ({ state: { code: 'X', valid: true } }));
        expect(await validLaunchCouponCode(resolve, '   ')).toBeUndefined();
        expect(resolve).not.toHaveBeenCalled();
    });

    it('a coupon lookup that THROWS must not fail the pool creation', async () => {
        // The pool is the product; the coupon is a convenience. A coupons read
        // that throws would otherwise turn "I typed a promo code" into "your
        // pool could not be created".
        const resolve = vi.fn(async () => { throw new Error('permission-denied'); });
        const logger = { warn: vi.fn() };
        await expect(validLaunchCouponCode(resolve, 'SAVE10', logger)).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// codex r1 [P1] on T3: `createBracketPool` builds its pool document field by
// field and never persisted `addons`, so a bracket launch left the upgrade
// page's seed nothing to read and every toggle opened unchecked — the exact
// defect T3 exists to fix, surviving on one of the three create paths.
// ---------------------------------------------------------------------------
describe('normalizeAddonSelection', () => {
    it('returns all four keys, all false, for a payload with no addons', async () => {
        const { normalizeAddonSelection } = await import('../lib/launchFields');
        expect(normalizeAddonSelection({})).toEqual({
            aiCommissioner: false,
            smsNotifications: false,
            whatIfSimulator: false,
            customBranding: false,
        });
    });

    it('carries the selected add-ons through', async () => {
        const { normalizeAddonSelection } = await import('../lib/launchFields');
        expect(normalizeAddonSelection({ addons: { aiCommissioner: true, whatIfSimulator: true } })).toEqual({
            aiCommissioner: true,
            smsNotifications: false,
            whatIfSimulator: true,
            customBranding: false,
        });
    });

    it('counts ONLY an explicit true', async () => {
        const { normalizeAddonSelection } = await import('../lib/launchFields');
        const out = normalizeAddonSelection({ addons: { aiCommissioner: 'yes', customBranding: 1 } });
        expect(out.aiCommissioner).toBe(false);
        expect(out.customBranding).toBe(false);
    });

    it('accepts the SIBLING-FLAG payload shape too (codex r2 [P2] on T5)', async () => {
        // computeLaunchMode / payloadHasPaidAddon accept `{ aiCommissioner: true }`
        // at the top level and will put that create on a trial. If this read
        // only `data.addons`, that pool would be a trial with everything locked.
        const { normalizeAddonSelection } = await import('../lib/launchFields');
        expect(normalizeAddonSelection({ aiCommissioner: true }).aiCommissioner).toBe(true);
    });

    it('a present addons object WINS over sibling flags, same as payloadHasPaidAddon', async () => {
        const { normalizeAddonSelection } = await import('../lib/launchFields');
        const out = normalizeAddonSelection({ aiCommissioner: true, addons: { whatIfSimulator: true } });
        expect(out).toEqual({
            aiCommissioner: false,
            smsNotifications: false,
            whatIfSimulator: true,
            customBranding: false,
        });
    });

    it('tolerates null / a non-object addons field', async () => {
        const { normalizeAddonSelection } = await import('../lib/launchFields');
        expect(normalizeAddonSelection(null).aiCommissioner).toBe(false);
        expect(normalizeAddonSelection({ addons: 'nope' }).aiCommissioner).toBe(false);
    });
});
