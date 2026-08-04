import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Source invariants for PLAN-BUYFLOW-QUOTE-DEADEND.
 *
 * The behaviour of the button rule is unit-tested directly in
 * `src/components/billing/checkoutButtonState.test.ts`. What CANNOT be reached
 * that way is the wiring: whether the client actually strips empty fields
 * before calling `getPoolQuote`, and whether the component actually uses the
 * helper instead of an inline copy of the old expression. Both are the exact
 * things that were wrong, so both are pinned here.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const dbService = read('src/services/dbService.ts');
const card = read('src/components/billing/BillingInvoiceCard.tsx');

/** The body of a named method in dbService, up to the next same-indent close. */
function methodBody(source: string, name: string): string {
    const start = source.indexOf(`async ${name}(`);
    expect(start, `dbService should still define ${name}`).toBeGreaterThan(-1);
    const end = source.indexOf('\n    },', start);
    expect(end, `${name} should have a closing brace`).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('every callable that carries an optional string field strips empty keys', () => {
    // `couponCode: x ? x : undefined` reaches the server as `null`, which
    // `.optional()` rejects. getPoolQuote shipped without the strip and failed
    // on EVERY coupon-less quote in production.
    for (const name of ['getPoolQuote', 'createCheckoutSession']) {
        it(`${name} routes its params through stripEmptyCallableFields`, () => {
            expect(methodBody(dbService, name)).toContain('stripEmptyCallableFields(params)');
        });
    }

    it('the helper has ONE definition and dbService imports it', () => {
        expect(dbService).toContain("from \"./callableParams\"");
        // A second inline copy of the filter is how the two callables drifted
        // apart in the first place.
        expect(dbService).not.toMatch(/v !== undefined && v !== null/);
    });

    it('the guard discriminates — it fails on a method that does not strip', () => {
        const fake = 'async somethingElse(params: X) {\n    const r = await fn(params);\n    },';
        expect(methodBody(fake, 'somethingElse')).not.toContain('stripEmptyCallableFields(params)');
    });
});

describe('BillingInvoiceCard delegates the button rule instead of inlining it', () => {
    it('uses the extracted state helper', () => {
        expect(card).toContain("from './checkoutButtonState'");
        expect(card).toContain('disabled={buttonState.disabled}');
        expect(card).toContain('{buttonState.label}');
    });

    it('no longer carries the inline clause that disabled the free allocation', () => {
        expect(card).not.toMatch(/total <= 0 && \(!appliedCoupon/);
    });

    it('does not render a bare $0 while the price is unknown', () => {
        // Both money lines must consult priceUnknown before printing FREE.
        expect(card).toContain("{priceUnknown ? '—' : basePrice === 0 ? 'FREE'");
        expect(card).toContain("{priceUnknown ? '—' : total === 0 ? 'FREE'");
    });

    it('a quote is only usable for the inputs it was fetched for', () => {
        // codex round 1 [P1]: "has any quote ever loaded" is not the same as
        // "this quote prices what is on screen". A stale quote kept the button
        // live while the checkout payload had already changed.
        expect(card).toContain('const quoteKey = JSON.stringify(');
        expect(card).toContain("quoteFor === quoteKey ? 'ready'");
        expect(card).toContain("quoteFailedFor === quoteKey ? 'unavailable' : 'pending'");
        expect(card).toContain('setQuoteFor(key)');
        expect(card).toContain('setQuoteFailedFor(key)');
    });

    it('the free-pool-limit warning keys off the same decision as the button', () => {
        // Two derivations of "is this pool free-limited" is how the warning and
        // the button came to disagree. The card must not re-derive it, and must
        // not match on the label string either.
        expect(card).toContain("buttonState.kind === 'free-limit-reached'");
        expect(card).not.toMatch(/basePrice === 0 && subtotal === 0/);
    });

    it('a failed quote has a real retry, not just a label', () => {
        // codex round 2 [P1]: a transient failure was permanent for that input
        // set, because the fetch effect only re-runs when a priced input moves.
        expect(card).toContain('const retryQuote = ()');
        expect(card).toContain('setQuoteRetry((n) => n + 1)');
        expect(card).toContain('onClick={retryQuote}');
        // The retry nonce must actually be a dependency of the fetch effect.
        expect(card).toMatch(/couponInput, quoteRetry\]\);/);
        // codex round 3 [P1]: the retry must also drop the loaded-quote stamp,
        // or a cached quote for these inputs reads as `ready` mid-retry.
        expect(card).toMatch(/const retryQuote = \(\) => \{\n(?:.*\n)*?\s*setQuoteFor\(null\);/);
    });

    it('a failed refresh un-stamps a quote that was stamped for those inputs', () => {
        expect(card).toContain('setQuoteFor((prev) => (prev === key ? null : prev))');
    });

    it('the free-pool count starts UNLOADED, not zero', () => {
        // codex round 3 [P2].
        expect(card).toContain('useState<number | null>(null)');
    });

    it('free-tier eligibility is taken from the server quote, not inferred', () => {
        // codex round 1 [P1]: the client used to infer "free" from zeroes, and
        // `subtotal` has pricePaid subtracted from it client-side.
        expect(card).toContain('freeTierEligible: !!quote?.freeTierEligible');
    });
});
