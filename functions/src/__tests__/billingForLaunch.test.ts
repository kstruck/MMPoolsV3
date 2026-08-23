import { describe, it, expect } from 'vitest';
import { billingForLaunch, trialFeaturesUnlocked, LOCKED_FEATURES } from '../lib/poolCreation';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T5 (Kevin's D2: approved) — a trial launch unlocks
 * the add-ons the commissioner selected in the wizard.
 *
 * The gap: a trial stamped `featuresUnlocked` ALL FALSE regardless, so a
 * commissioner who ticked AI Commissioner and started the trial had no AI tab
 * for the whole trial. They could not try the very thing the trial exists to
 * sell — add-ons only turned on after payment (the webhook stamps from the
 * checkout snapshot). This is why Kevin "never saw AI working".
 */

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe('trialFeaturesUnlocked', () => {
    it('unlocks exactly what was selected', () => {
        expect(trialFeaturesUnlocked({ aiCommissioner: true })).toEqual({
            aiCommissioner: true,
            smsNotifications: false,
            whatIfSimulator: false,
            customBranding: false,
        });
    });

    it('returns every key explicitly, never a partial map', () => {
        // A missing flag reads as denied anyway, but it leaves the document
        // illegible — and `checkBillingAccess` is deny-by-default precisely
        // because absence used to be ambiguous.
        expect(Object.keys(trialFeaturesUnlocked({})).sort()).toEqual(Object.keys(LOCKED_FEATURES).sort());
    });

    it('counts ONLY an explicit true', () => {
        // Firestore payload shapes are untrusted; a truthy string must not
        // unlock a paid feature.
        const out = trialFeaturesUnlocked({ aiCommissioner: 'yes' as unknown as boolean });
        expect(out.aiCommissioner).toBe(false);
    });

    it('is all-false for no selection at all', () => {
        expect(trialFeaturesUnlocked(undefined)).toEqual(LOCKED_FEATURES);
    });

    it('NEVER unlocks an UNSELLABLE add-on (codex r1 [P1])', () => {
        // PLAN-COST-CONTROLS 0.5.4 turned SMS off everywhere. Its two existing
        // enforcement points are the quote-input schema and the Stripe webhook
        // clamp — neither of which a CREATE payload passes through, and the
        // create envelopes are permissive (ADR-0001). So a crafted
        // `smsNotifications: true` would otherwise stamp the entitlement.
        expect(trialFeaturesUnlocked({ smsNotifications: true }).smsNotifications).toBe(false);
    });

    it('clamping SMS does not disturb the add-ons selected alongside it', () => {
        expect(trialFeaturesUnlocked({ smsNotifications: true, aiCommissioner: true })).toEqual({
            aiCommissioner: true,
            smsNotifications: false,
            whatIfSimulator: false,
            customBranding: false,
        });
    });
});

describe('billingForLaunch — trial', () => {
    it('stamps the selected add-ons', () => {
        const b = billingForLaunch('trial', 14, NOW, { aiCommissioner: true, whatIfSimulator: true });
        expect(b.status).toBe('trial');
        expect(b.featuresUnlocked).toEqual({
            aiCommissioner: true,
            smsNotifications: false,
            whatIfSimulator: true,
            customBranding: false,
        });
    });

    it('a crafted SMS selection cannot buy the entitlement through the trial path', () => {
        expect(billingForLaunch('trial', 14, NOW, { smsNotifications: true }).featuresUnlocked.smsNotifications).toBe(false);
    });

    it('still all-false when the wizard selected nothing', () => {
        expect(billingForLaunch('trial', 14, NOW).featuresUnlocked).toEqual(LOCKED_FEATURES);
    });

    it('does not disturb the trial clock', () => {
        expect(billingForLaunch('trial', 14, NOW, { aiCommissioner: true }).trialEndsAt).toBe(NOW + 14 * DAY);
        expect(billingForLaunch('trial', 7, NOW, { aiCommissioner: true }).trialEndsAt).toBe(NOW + 7 * DAY);
    });

    it('keeps its tier and price', () => {
        const b = billingForLaunch('trial', 14, NOW, { aiCommissioner: true });
        expect(b.tier).toBe('standard_tier');
        expect(b.pricePaid).toBe(0);
    });
});

describe('billingForLaunch — free stays LOCKED', () => {
    it('never unlocks an add-on on the free path, even if one is passed', () => {
        // Not an oversight. Any paid add-on forces computeLaunchMode to 'trial',
        // so a free pool by definition selected none — and unlocking here would
        // hand out paid features PERMANENTLY to pools that never enter a trial.
        const b = billingForLaunch('free', 14, NOW, { aiCommissioner: true, whatIfSimulator: true });
        expect(b.status).toBe('free');
        expect(b.featuresUnlocked).toEqual(LOCKED_FEATURES);
        expect((b as { trialEndsAt?: number }).trialEndsAt).toBeUndefined();
    });

    it('the default (no mode) is still free and locked', () => {
        expect(billingForLaunch().featuresUnlocked).toEqual(LOCKED_FEATURES);
    });
});

describe('the returned featuresUnlocked is a fresh object', () => {
    it('mutating one launch cannot leak into the next', () => {
        const a = billingForLaunch('trial', 14, NOW, { aiCommissioner: true });
        (a.featuresUnlocked as Record<string, boolean>).aiCommissioner = false;
        expect(billingForLaunch('trial', 14, NOW, { aiCommissioner: true }).featuresUnlocked.aiCommissioner).toBe(true);
        expect(LOCKED_FEATURES.aiCommissioner).toBe(false);
    });
});
