import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T6a — the three remaining §2 BLOCKERS.
 * (G3 shipped with T3; it is guarded in `tests/upgrade-carries-selection.test.ts`.)
 *
 * All three are wiring or copy, so source invariants are the honest guard; the
 * two decisions that have logic — the payment acknowledgement's two states and
 * the URL-marker consumption — are unit-tested in
 * `src/components/billing/paymentSuccessState.test.ts`.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const app = read('src/App.tsx');
const pricing = read('src/components/PricingPage.tsx');
const card = read('src/components/billing/BillingInvoiceCard.tsx');
const poolRoute = read('src/components/routes/PoolRoute.tsx');

describe('G2 — a logged-out visitor gets the auth modal, not a silent bounce', () => {
    it('the global create entry checks access first', () => {
        // `/create-pool` requires `user &&` on its route, so this used to bounce
        // an anonymous visitor to `/` with no modal and no message.
        expect(app).not.toContain("const handleCreatePoolClick = () => navigate('/create-pool');");
        expect(app).toMatch(/handleCreatePoolClick = \(\) => \{[\s\S]{0,200}?if \(!checkAccess\(\)\) return;/);
    });

    it('every /pricing create CTA routes through startCreate', () => {
        expect(pricing).not.toContain("onClick={canCreate ? () => navigate('/create-pool') : undefined}");
        expect(pricing.match(/onClick=\{startCreate\}/g)?.length).toBe(3);
    });

    it('startCreate opens auth for an anonymous visitor and continues after login', () => {
        expect(pricing).toMatch(/const startCreate = \(\) => \{[\s\S]{0,300}?pendingCreate\.current = true;[\s\S]{0,80}?onLogin\(\);/);
        expect(pricing).toContain('if (pendingCreate.current && user)');
    });

    it('startCreate still respects the pool-creation flag', () => {
        // It must not become a way past POOLS_OPEN / canAccessPoolCreation.
        expect(pricing).toMatch(/const startCreate = \(\) => \{\s*\r?\n\s*if \(!canCreate\) return;/);
    });
});

describe('G4 — the live checkout must not claim it is a sandbox', () => {
    it('no surface tells a paying commissioner their card will not be charged', () => {
        expect(card).not.toContain('No real credit card charges will occur');
        expect(card).not.toMatch(/processed securely in\s+Stripe Sandbox/);
    });

    it('both copies of the reassurance line were replaced, not just the first', () => {
        expect(card.match(/Payments are processed securely by Stripe\./g)?.length).toBe(2);
    });
});

describe('G5 — a return from checkout is acknowledged', () => {
    it('the banner is mounted once, in the wrapper every pool type returns through', () => {
        expect(poolRoute).toContain('<PaymentSuccessBanner');
        // One insertion point, not one per pool-type branch.
        expect(poolRoute.match(/<PaymentSuccessBanner/g)?.length).toBe(1);
    });

    it('it reads the pool\u2019s LIVE billing status, so it flips itself when the webhook lands', () => {
        expect(poolRoute).toContain('.billing?.status}');
    });

    it('the banner is keyed by pool id (codex r1 [P2])', () => {
        // PoolRoute stays MOUNTED across pool navigation — its own NFL branch
        // documents that. Without the key, the once-per-mount `payment=success`
        // read would persist onto the NEXT pool and announce a payment that
        // pool never received.
        expect(poolRoute).toMatch(/<PaymentSuccessBanner[\s\S]{0,40}?key=\{pool\.id\}/);
    });

    it('a BUNDLE purchase is acknowledged too (codex r1 [P1])', () => {
        // Bundle checkout returns to /pricing?payment=success, not a pool route.
        expect(pricing).toContain('<PaymentSuccessBanner purchase="bundle" />');
    });
});
