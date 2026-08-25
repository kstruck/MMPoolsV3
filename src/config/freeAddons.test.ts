import { describe, it, expect } from 'vitest';
import { ADDON_KEYS } from '@shared/schemas/quote';
import { FREE_ADDON_KEYS, SELLABLE_ADDON_KEYS, isFreeAddon, stripFreeAddons } from './freeAddons';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T4 (Kevin's D1) — custom branding is included with
 * every pool. It was priced at $29 and stamped into
 * `billing.featuresUnlocked.customBranding` on activation, but NOTHING gated
 * it: no server check passed it to `checkBillingAccess` and no render path read
 * the flag, while the branding step asked everyone for a logo and two colours.
 */

describe('the free/sellable split', () => {
    it('custom branding is free', () => {
        expect(isFreeAddon('customBranding')).toBe(true);
    });

    it('the paid add-ons are untouched', () => {
        for (const key of ['aiCommissioner', 'whatIfSimulator', 'smsNotifications']) {
            expect(isFreeAddon(key)).toBe(false);
        }
    });

    it('SELLABLE + FREE covers every add-on key, with no overlap', () => {
        // A key added to the schema and forgotten here would silently vanish
        // from every wizard, since the wizard now iterates SELLABLE_ADDON_KEYS.
        expect([...SELLABLE_ADDON_KEYS, ...FREE_ADDON_KEYS].sort()).toEqual([...ADDON_KEYS].sort());
        expect(SELLABLE_ADDON_KEYS.some(isFreeAddon)).toBe(false);
    });
});

describe('stripFreeAddons', () => {
    const all = { aiCommissioner: true, smsNotifications: true, whatIfSimulator: true, customBranding: true };

    it('clears branding before a quote or checkout is requested', () => {
        expect(stripFreeAddons(all).customBranding).toBe(false);
    });

    it('leaves every paid add-on exactly as chosen', () => {
        const out = stripFreeAddons(all);
        expect(out.aiCommissioner).toBe(true);
        expect(out.smsNotifications).toBe(true);
        expect(out.whatIfSimulator).toBe(true);
    });

    it('does not mutate its input', () => {
        const input = { ...all };
        stripFreeAddons(input);
        expect(input.customBranding).toBe(true);
    });

    it('is what makes the UI change independent of the billing_config save', () => {
        // With `isPremium` still true server-side, an OLD pool carrying
        // addons.customBranding would otherwise be re-quoted $29 for something
        // that is no longer on screen.
        const legacyPool = { aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: true };
        expect(stripFreeAddons(legacyPool)).toEqual({
            aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false,
        });
    });
});
