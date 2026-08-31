import { describe, it, expect } from 'vitest';
import { addonSeed } from './addonSeed';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T3 — "Upgrade Now" must not forget what the
 * commissioner picked in the wizard. /pricing seeded from
 * `billing.featuresUnlocked`, which a TRIAL launch stamps all-false, so the
 * checkout page opened with nothing selected.
 */

describe('addonSeed', () => {
    it('seeds from the wizard selection on a trial pool', () => {
        // The exact reported case: AI + branding picked, trial launch locks all
        // features, upgrade page must still show both ticked.
        expect(
            addonSeed({
                addons: { aiCommissioner: true, customBranding: true, smsNotifications: false, whatIfSimulator: false },
                billing: {
                    featuresUnlocked: {
                        aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false,
                    },
                },
            }),
        ).toEqual({
            aiCommissioner: true,
            smsNotifications: false,
            whatIfSimulator: false,
            customBranding: true,
        });
    });

    it('falls back to featuresUnlocked for a legacy pool with no addons map', () => {
        expect(
            addonSeed({ billing: { featuresUnlocked: { aiCommissioner: true } } }),
        ).toEqual({
            aiCommissioner: true,
            smsNotifications: false,
            whatIfSimulator: false,
            customBranding: false,
        });
    });

    it('prefers featuresUnlocked once the pool has actually PAID', () => {
        // The wizard intent is stale at that point: the commissioner chose at
        // checkout NOT to buy branding. Seeding from `addons` would re-sell it.
        expect(
            addonSeed({
                addons: { aiCommissioner: true, customBranding: true },
                billing: {
                    paid: { tier: 'premium_tier', addons: ['aiCommissioner'], at: 1 },
                    featuresUnlocked: { aiCommissioner: true, customBranding: false },
                },
            }),
        ).toEqual({
            aiCommissioner: true,
            smsNotifications: false,
            whatIfSimulator: false,
            customBranding: false,
        });
    });

    it('returns all-false for a pool with neither record', () => {
        expect(addonSeed({})).toEqual({
            aiCommissioner: false,
            smsNotifications: false,
            whatIfSimulator: false,
            customBranding: false,
        });
    });

    it('tolerates null / undefined without throwing', () => {
        expect(addonSeed(null).aiCommissioner).toBe(false);
        expect(addonSeed(undefined).customBranding).toBe(false);
    });

    it('treats non-boolean truthy values as not selected', () => {
        // Firestore data is untrusted shape; only an explicit `true` counts.
        expect(addonSeed({ addons: { aiCommissioner: 'yes' } }).aiCommissioner).toBe(false);
    });
});
