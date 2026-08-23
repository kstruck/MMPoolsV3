import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T4 (Kevin's D1) — "Custom branding" must not be
 * offered for sale anywhere. The rule is unit-tested in
 * `src/config/freeAddons.test.ts`; this pins that the surfaces actually stopped
 * selling it, and — the load-bearing half — that no surface still REQUESTS it,
 * which is what makes the change independent of the billing_config save.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const launchStep = read('src/components/wizard/create/LaunchStep.tsx');
const card = read('src/components/billing/BillingInvoiceCard.tsx');
const pricing = read('src/components/PricingPage.tsx');
const estimate = read('src/components/pricing/EstimateSummaryCard.tsx');
const brandingStep = read('src/components/wizard/steps/StepBranding.tsx');

describe('nothing offers custom branding as a paid add-on', () => {
    it('the wizard iterates the SELLABLE keys, not every key', () => {
        expect(launchStep).toContain('SELLABLE_ADDON_KEYS.filter');
        expect(launchStep).not.toMatch(/\{ADDON_KEYS\.filter/);
    });

    it('the checkout card has no branding toggle and no branding line', () => {
        expect(card).not.toContain("{ key: 'customBranding' as const");
        expect(card).not.toContain('Premium Custom Branding & Covers');
        expect(card).not.toContain('localBranding');
    });

    it('/pricing has no branding upsell and the estimator has no branding line', () => {
        expect(pricing).not.toContain('calcBranding');
        expect(pricing).not.toContain('Premium Custom Branding');
        expect(estimate).not.toContain('brandingCost');
    });
});

describe('nothing REQUESTS custom branding from the server', () => {
    // This is what makes the UI change independent of the (Kevin-owned)
    // `settings/billing_config` save that sets isPremium:false. With the config
    // untouched, a stray `customBranding: true` would still price at $29.
    it('the wizard strips it from both the quote and the checkout call', () => {
        expect(launchStep.match(/addons: stripFreeAddons\(addons\)/g)?.length).toBe(2);
    });

    it('the checkout card sends a hard false', () => {
        expect(card).toContain('customBranding: false,');
    });
});

describe('the branding step says it is free', () => {
    it('so a commissioner is not left wondering what it costs', () => {
        expect(brandingStep).toMatch(/Included with every pool/);
    });
});

describe('the SERVER is the guarantee, not the UI', () => {
    // codex r1 [P1]: this is a single-page app served from a CDN, so a browser
    // on a stale bundle keeps sending `customBranding: true`. If pricing still
    // honoured it, that browser would be CHARGED for a feature nothing gates.
    it('the included list lives in shared/, crossing the client/server boundary', () => {
        expect(read('shared/schemas/quote.ts')).toContain("export const INCLUDED_ADDON_KEYS = ['customBranding'] as const;");
        expect(read('src/config/freeAddons.ts')).toContain('export const FREE_ADDON_KEYS = INCLUDED_ADDON_KEYS;');
    });

    it('computeAddonLines skips it — the one choke point both buy paths price through', () => {
        const engine = read('functions/src/lib/quoteEngine.ts');
        expect(engine).toContain('if (isIncludedAddon(key)) continue;');
        // Before the config lookup, so `isPremium: true` cannot resurrect it.
        expect(engine.indexOf('if (isIncludedAddon(key)) continue;'))
            .toBeLessThan(engine.indexOf('const feat = config.features[ADDON_TO_FEATURE[key]];'));
    });
});

describe('pricing and launch mode agree about what is paid', () => {
    it('PAID_ADDON_KEYS is derived from the included list, not hand-listed', () => {
        // codex r2 [P1]: a stale bundle sending `customBranding: true` would
        // otherwise create a small pool as a 14-day TRIAL — which eventually
        // LOCKS — while the quote on screen said free.
        const ops = read('functions/src/poolOps.ts');
        expect(ops).toContain('const PAID_ADDON_KEYS = ADDON_KEYS.filter((k) => !isIncludedAddon(k));');
        expect(ops).not.toMatch(/const PAID_ADDON_KEYS = \[[\s\S]{0,200}?'customBranding',/);
    });
});

describe('the plumbing stays, dormant', () => {
    it('the add-on key still exists in the shared schema', () => {
        // D1 keeps the key, the schema and featuresUnlocked for a future
        // genuinely-premium branding tier. Deleting them is NOT this ticket.
        expect(read('shared/schemas/quote.ts')).toContain("'customBranding'");
    });

    it('the server still stamps the flag on activation', () => {
        expect(read('functions/src/stripe.ts')).toContain('customBranding: addons.customBranding === true');
    });
});
