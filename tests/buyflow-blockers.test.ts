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
        expect(app).toMatch(/handleCreatePoolClick = \(\) => \{[\s\S]{0,600}?if \(!checkAccess\(\)\) return;/);
    });

    it('the global entry records the create intent before opening auth', () => {
        // codex r3 [P2]: without it, a new account lands on /participant and a
        // returning user stays put, instead of continuing to the wizard.
        expect(app).toMatch(/handleCreatePoolClick = \(\) => \{[\s\S]{0,400}?setPostAuthIntent\('\/create-pool'\);/);
    });

    it('every /pricing create CTA routes through startCreate', () => {
        expect(pricing).not.toContain("onClick={canCreate ? () => navigate('/create-pool') : undefined}");
        expect(pricing.match(/onClick=\{startCreate\}/g)?.length).toBe(3);
    });

    it('startCreate opens auth for an anonymous visitor and records the intent', () => {
        expect(pricing).toMatch(/const startCreate = \(\) => \{[\s\S]{0,400}?setPostAuthIntent\('\/create-pool'\);[\s\S]{0,80}?onLogin\(\);/);
        // The continuation is App's, not this page's: a brand-new account is
        // navigated to /participant on sign-up, unmounting this page first.
        // The continuation runs from an effect that waits for `user` to actually
        // materialise — the auth observer resolves asynchronously, so the
        // modal's success callback is too early to enter a `user &&`-guarded
        // route (codex r4 [P1]).
        expect(app).toContain('const intent = takePostAuthIntent();');
        expect(app).toMatch(/useEffect\(\(\) => \{[\s\S]{0,200}?takePostAuthIntent\(\);[\s\S]{0,80}?navigate\(intent\);/);
        expect(app).toContain('if (hasPostAuthIntent()) return;');
    });

    it('startCreate still respects the pool-creation flag', () => {
        // It must not become a way past POOLS_OPEN / canAccessPoolCreation.
        expect(pricing).toMatch(/const startCreate = \(\) => \{\s*\r?\n\s*if \(!canCreate\) return;/);
    });
});

describe('G2 — a cancelled sign-in does not teleport the visitor later', () => {
    const authModal = read('src/components/modals/AuthModal.tsx');

    it('closing the modal drops the intent', () => {
        // Only a CANCELLED close discards it: on success the intent must survive
        // until `user` lands (codex r4 [P1]).
        expect(app).toContain('if (!authSucceededRef.current) clearPostAuthIntent();');
        expect(app).toContain('authSucceededRef.current = true;');
        // Reset when the modal opens, or one success would arm every later close.
        expect(app).toMatch(/handleOpenAuth = \([\s\S]{0,120}?authSucceededRef\.current = false;/);
    });

    it('a SUCCESSFUL auth runs the continuation before the close handler clears it', () => {
        // Order is load-bearing: onClose discards the intent, so a success that
        // closed first would throw away the continuation it just earned.
        expect(authModal).toContain('onAuthenticated?.(result); onClose();');
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
