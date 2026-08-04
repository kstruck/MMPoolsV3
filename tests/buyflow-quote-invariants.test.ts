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
        expect(card).toContain('const priceUnknown = !quote;');
    });
});
