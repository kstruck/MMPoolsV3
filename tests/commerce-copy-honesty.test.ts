import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE PRODUCT IS ONE-TIME COMMERCE. THE COPY MUST NOT PROMISE OTHERWISE.
 *
 * `DECISION-COMMERCE-MODEL.md` §1 records the decision and the evidence for it:
 * both Checkout sessions are `mode: "payment"`, `mode: "subscription"` appears
 * nowhere in `functions/`, the webhook carries no `invoice.*` or
 * `customer.subscription.*` branch, and the 1-Year Unlimited Pass stamps a
 * one-off `termEndsAt` that simply expires. Nothing in this system can charge a
 * commissioner a second time without them pressing buy again.
 *
 * Its §3 sweep found exactly two user-facing strings that contradicted that,
 * and they were the same string on the same product in two places: **"billed
 * annually"** under the Pass price on the pricing page and on the invoice card.
 * "Billed <cadence>" is not a description of a term, it is a description of a
 * BILLING SCHEDULE — on a pricing page it means a charge that repeats. There is
 * no such charge.
 *
 * ## Why a test and not just a fix
 *
 * Because the fix is two words and the pressure to write "billed annually"
 * comes back every time someone describes a 365-day product. This asserts the
 * replacement in both surfaces AND that the surfaces still agree with each
 * other — a pricing page and an invoice card that describe the same SKU
 * differently is its own defect, and it is the one that a single-surface fix
 * would have created.
 *
 * ## Scope, stated so the negative list is not read as more than it is
 *
 * The banned patterns below are billing-CADENCE vocabulary only. The word
 * "annual" on its own is fine and is deliberately left alone: "1-Year Unlimited
 * Pass", "your annual pass" and "unlimited annual hosting" all describe a
 * 365-day TERM, which is exactly what the product is. Likewise
 * `subscribeToPools` / `unsubscribe` are Firestore `onSnapshot` listeners in
 * both files and have nothing to do with money — a naive ban on "subscri" would
 * fail on listener code and teach the next reader to delete the test.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/**
 * 🛑 COMMENTS ARE STRIPPED BEFORE MATCHING — and here it is the FALSE-POSITIVE
 * direction, which is the unusual one.
 *
 * `nfl-surface-invariants.test.ts` strips comments because a `toContain` can
 * keep passing off a comment that quotes deleted code. This file has the mirror
 * problem: both surfaces carry a comment reading `NOT "billed annually"`, which
 * is exactly what stops the string coming back, and a raw scan reports that
 * explanation as the violation. Without the stripper the only way to keep this
 * suite green would be to delete the comment.
 *
 * Stripping also hardens the POSITIVE assertions: the qualifier then has to be
 * in real JSX rather than in prose about the qualifier.
 */
const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** The two surfaces that price the 1-Year Unlimited Pass. */
const SURFACES = [
    'src/components/PricingPage.tsx',
    'src/components/billing/BillingInvoiceCard.tsx',
] as const;

/**
 * ONE canonical qualifier, character for character, in both places. It states
 * the two facts a buyer needs and neither of them is a cadence: you pay once,
 * and it lasts 365 days.
 */
const QUALIFIER = 'one-time · 365 days';

/** `unlimited_1yr` price, then the qualifier span on the very next line. */
const PRICE_THEN_LABEL = /unlimited_1yr[^\n]*\n\s*<span[^>]*>([^<]*)<\/span>/;

/**
 * Phrases that promise a repeat charge. Each is a *cadence* claim — none of
 * them can appear in Firestore-listener code, which is what keeps this list
 * usable on files that are 90% React.
 */
const RECURRING_VOCABULARY: Array<[RegExp, string]> = [
    [/billed\s+(annually|monthly|yearly|weekly|quarterly)/i, 'names a billing cadence'],
    [/auto-?renew/i, 'promises an automatic renewal'],
    [/\brenews?\s+(automatically|every|each|annually|yearly|monthly)/i, 'promises a renewal'],
    [/\bper\s+(month|year)\b/i, 'prices by a repeating period'],
    [/\bbilling\s+cycle\b/i, 'implies repeating billing periods'],
    [/\brecurring\s+(charge|payment|billing|subscription)/i, 'says the charge repeats'],
    [/\bsubscription\s+(plan|price|fee|tier)\b/i, 'sells a subscription'],
    [/\bcancel\s+(your\s+)?subscription\b/i, 'implies a subscription to cancel'],
    [/\$?\s*[\d.]+\s*\/\s*(mo|month|yr|year)\b/i, 'prices per repeating period'],
];

describe('the pricing surfaces do not promise recurring billing', () => {
    for (const file of SURFACES) {
        describe(file, () => {
            const text = strip(read(file));

            it('carries no recurring-billing vocabulary', () => {
                for (const [pattern, why] of RECURRING_VOCABULARY) {
                    const hit = text.match(pattern);
                    expect(
                        hit,
                        `${file} contains "${hit?.[0]}" — it ${why}, and nothing in this product recurs (DECISION-COMMERCE-MODEL.md §1)`,
                    ).toBeNull();
                }
            });

            it('qualifies the Unlimited Pass price with the one-time term instead', () => {
                // Adjacency, not a bare `toContain`: the string has to be the
                // label rendered next to the Pass price, so it cannot survive
                // somewhere harmless while the real label drifts to a cadence.
                const m = text.match(PRICE_THEN_LABEL);
                expect(m, `${file}: no qualifier span next to the Pass price`).not.toBeNull();
                expect(m![1]).toBe(QUALIFIER);
            });
        });
    }

    it('the two surfaces agree — one product, one description', () => {
        // A pricing page and an invoice card disagreeing about the same SKU is
        // the defect a single-surface fix would have introduced, so it is
        // asserted directly rather than left implied by the two checks above.
        const labels = SURFACES.map(f => strip(read(f)).match(PRICE_THEN_LABEL)![1]);
        expect(labels[0]).toBe(labels[1]);
        expect(labels[0]).toBe(QUALIFIER);
    });

    it('the stripper removes the prose and leaves the rendered label alone', () => {
        // Guard the stripper, both ways. If it ate JSX every surface assertion
        // above would pass vacuously; if it left comments in place the suite
        // could only go green by deleting the comment that states the rule.
        const raw = read(SURFACES[0]);
        const stripped = strip(raw);
        expect(stripped, 'the rendered qualifier must survive stripping').toContain(QUALIFIER);
        expect(raw, 'the explaining comment is still in the source').toContain('NOT "billed annually"');
        expect(stripped, 'and it must NOT survive stripping').not.toContain('NOT "billed annually"');
    });

    it('these greps match the copy they were written to catch', () => {
        // Guard the guard. Every vocabulary assertion is a negative, and a
        // regex that matches nothing passes a negative forever. Each pattern is
        // fired at a probe written in the voice it exists to ban.
        const removed = '<span className="text-[9px] text-muted font-medium num">billed annually</span>';
        expect(removed).toMatch(RECURRING_VOCABULARY[0][0]);
        const probes = [
            'Auto-renews unless cancelled',
            'Renews automatically each year',
            '$12.99 per month',
            'Your next billing cycle starts',
            'a recurring charge of $129',
            'Choose a subscription plan',
            'You can cancel your subscription anytime',
            '$129.00/yr',
        ];
        expect(probes.length, 'one probe per pattern after the first').toBe(RECURRING_VOCABULARY.length - 1);
        probes.forEach((probe, i) => {
            const [pattern] = RECURRING_VOCABULARY[i + 1];
            expect(probe, `pattern ${pattern} does not match its own probe`).toMatch(pattern);
        });
    });

    it('and do NOT fire on the listener code or the honest term wording', () => {
        // The false-positive direction. If any of these tripped, the test would
        // be unusable on the real files and the next reader would delete it.
        for (const safe of [
            'const unsubscribe = dbService.subscribeToPools((poolsList) => {',
            '<h3>1-Year Unlimited Pool Pass</h3>',
            'All pool creations and upgrades are 100% free under your annual pass.',
            'unlocking unlimited annual hosting for all your pool formats',
            QUALIFIER,
        ]) {
            for (const [pattern] of RECURRING_VOCABULARY) {
                expect(safe, `false positive: ${pattern} matched ${safe}`).not.toMatch(pattern);
            }
        }
    });
});

describe('the code behind the copy really is one-time', () => {
    // The copy assertions above are only worth anything while the claim they
    // rest on is true. If someone ships a subscription, this fails FIRST and
    // says to revisit the copy rather than leaving the two out of step.
    const stripe = read('functions/src/stripe.ts');

    it('both Checkout sessions open in payment mode', () => {
        // ⚠️ COUNT, not "every `mode:` in the file". `stripe.ts` also carries a
        // `{ mode: "live" | "mock" | "refuse" }` union for the key verdict, so a
        // blanket assertion over every `mode:` fails on code that has nothing to
        // do with Checkout.
        //
        // A FLOOR rather than an exact count: a third one-time product would be
        // perfectly consistent with this decision, and the assertion below is
        // what actually catches a conversion to subscription.
        const payment = stripe.match(/mode:\s*["']payment["']/g) ?? [];
        expect(payment.length, 'Checkout no longer opens in payment mode — or stripe.ts moved')
            .toBeGreaterThanOrEqual(2);
    });

    it('nothing in functions/src opens a subscription', () => {
        const walk = (dir: string): string[] => {
            const out: string[] = [];
            for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
                const rel = `${dir}/${e.name}`;
                if (e.isDirectory()) { out.push(...walk(rel)); continue; }
                if (e.name.endsWith('.ts')) out.push(rel);
            }
            return out;
        };
        const files = walk('functions/src');
        expect(files.length, 'the functions walker found nothing').toBeGreaterThan(20);
        for (const f of files) {
            expect(read(f), `${f} opens a Stripe subscription`).not.toMatch(/mode:\s*["']subscription["']/);
        }
    });

    it('and no subscription webhook branch has appeared', () => {
        // The other half of the same claim: a subscription nothing in this repo
        // CREATES could still arrive from the Stripe dashboard, and a handler
        // for one would be the first sign the model changed.
        //
        // ⚠️ The `case` grep is only meaningful while the webhook IS a switch on
        // `event.type`. Pinned first, so a refactor to if/else turns this into a
        // FAILURE rather than into a negative that can never fire again.
        expect(stripe, 'the webhook is still a switch on event.type')
            .toMatch(/switch\s*\(\s*event\.type\s*\)/);
        expect(stripe, 'and still branches in the shape this grep reads')
            .toMatch(/case\s+["']checkout\.session\.completed["']/);
        expect('case "invoice.paid": {', 'the grep matches the branch it bans')
            .toMatch(/case\s+["']invoice\./);

        expect(stripe).not.toMatch(/customer\.subscription\./);
        expect(stripe).not.toMatch(/case\s+["']invoice\./);
    });
});
