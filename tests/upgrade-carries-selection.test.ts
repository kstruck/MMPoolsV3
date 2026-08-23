import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T3 — "Upgrade Now" must carry the pool, the
 * wizard's add-ons, and the coupon.
 *
 * The behaviour is unit-tested in `src/components/billing/addonSeed.test.ts`
 * and `functions/src/__tests__/launchCoupon.test.ts`. What cannot be reached
 * from there is the WIRING — and all four drops Kevin hit were wiring, not
 * logic: a link with no pool id, a seed from the wrong field, hardcoded
 * `false` props, and a coupon nothing ever wrote.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const gate = read('src/components/billing/BillingGate.tsx');
const pricing = read('src/components/PricingPage.tsx');
const launchStep = read('src/components/wizard/create/LaunchStep.tsx');
const launchFields = read('src/components/wizard/create/launchFields.ts');
const poolOps = read('functions/src/poolOps.ts');
const nflPools = read('functions/src/nflPools.ts');
const bracketPools = read('functions/src/bracketPools.ts');

describe('a. every commissioner CTA carries the pool it is about', () => {
    it('BillingGate links to /pricing?poolId=, never a bare /pricing', () => {
        expect(gate).not.toContain('href="/pricing"');
        expect(gate).toContain('`/pricing?poolId=${encodeURIComponent(poolId)}`');
    });

    it('all four commissioner CTAs use it (trial, free/limit, grace, locked)', () => {
        expect(gate.match(/href=\{pricingHref\}/g)?.length).toBe(4);
    });
});

describe('b. the add-on toggles seed from the wizard selection', () => {
    it('PricingPage uses addonSeed, not featuresUnlocked directly', () => {
        expect(pricing).toContain('const seed = addonSeed(pool)');
        // The exact reads that wiped the selection on every trial pool.
        expect(pricing).not.toContain("setCalcAi(pool.billing?.featuresUnlocked?.aiCommissioner");
        expect(pricing).not.toContain("setCalcSim(pool.billing?.featuresUnlocked?.whatIfSimulator");
    });

    it('the branding toggle is seeded at all (it never was)', () => {
        expect(pricing).toContain('setCalcBranding(seed.customBranding)');
    });
});

describe('c. the checkout card receives the seeded state', () => {
    it('BillingInvoiceCard is no longer mounted with hardcoded false props', () => {
        expect(pricing).not.toContain('hasAiCommissioner={false}');
        expect(pricing).not.toContain('hasCustomBranding={false}');
        expect(pricing).toContain('hasAiCommissioner={calcAi}');
        expect(pricing).toContain('hasSmsNotifications={calcSms}');
        expect(pricing).toContain('hasWhatIfSimulator={calcSim}');
        expect(pricing).toContain('hasCustomBranding={calcBranding}');
    });
});

describe('d. the coupon survives the launch', () => {
    it('LaunchStep puts its coupon into the create payload', () => {
        // It lives in component state, not the form, so getValues() alone
        // never carried it — which is why billing.couponCode had no writer.
        expect(launchStep).toContain('couponForLaunch ? { ...clean, couponCode: couponForLaunch } : clean');
    });

    it('the shared payload builder passes couponCode through', () => {
        expect(launchFields).toContain('couponCode?: string;');
        expect(launchFields).toContain('return { estimatedPlayers, addons, couponCode };');
    });

    it('the raw couponCode is STRIPPED from the persisted envelope', () => {
        // Otherwise the permissive create envelope writes an unvalidated code to
        // the pool's top level, where nothing checks it but a reader may trust it.
        expect(poolOps).toMatch(/PRIVILEGED_POOL_FIELDS[\s\S]{0,2000}?'couponCode',/);
    });

    it('all three create callables stamp only a server-validated code', () => {
        for (const [name, src] of [['poolOps', poolOps], ['nflPools', nflPools], ['bracketPools', bracketPools]] as const) {
            expect(src, `${name} validates the coupon`).toContain('validLaunchCouponCode(');
            expect(src, `${name} resolves it against the coupons collection`).toContain('resolveCouponForQuote(db, code');
            expect(src, `${name} stamps it under billing`).toContain('{ couponCode: launchCouponCode }');
        }
    });

    it('a bracket launch persists what the commissioner picked', () => {
        // codex r1 [P1]: createBracketPool builds its document field by field
        // and dropped `addons`, so the new seed had nothing to read there and
        // the toggles still opened unchecked on the one path that never spread
        // the payload.
        expect(bracketPools).toContain('poolExtras.addons = normalizeAddonSelection(rawCreate)');
        expect(bracketPools).toContain('poolExtras.estimatedPlayers = bracketEstimate');
    });

    it('nothing in the create path reserves or increments coupon usage', () => {
        // T3 stamps a remembered INTENT. Redemption stays atomic in
        // createCheckoutSession; a second increment path would double-count.
        for (const src of [poolOps, nflPools, bracketPools]) {
            expect(src).not.toContain('makeConfirmedEntry');
            expect(src).not.toContain('usesCount');
        }
    });
});
