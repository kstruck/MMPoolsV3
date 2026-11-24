/**
 * The pool type a hosting checkout prices a pool as — the client's copy of the
 * server's `checkoutPricingType` (functions/src/stripe.ts). The server prices a
 * checkout by the pool's STORED type and ignores the one the page sends
 * (qodo #786), so the page must quote and send the same value:
 *
 * - upper-cased (`formatTierMap` and the quote schema are keyed in capitals);
 * - a pool with no stored type is a legacy squares pool;
 * - a legacy playoff pool (stored `'playoff'`) is NFL_PLAYOFFS.
 *
 * Without it a legacy playoff pool was quoted as `PLAYOFF`, which the quote and
 * checkout schemas reject, so its pay button never armed; and a pool with no
 * type crashed the pricing page on `undefined.toUpperCase()`.
 *
 * `checkoutPricingType.test.ts` pins this against the server's function, so
 * the two cannot drift.
 */
const LEGACY_PRICING_TYPE_ALIASES: Readonly<Record<string, string>> = {
    PLAYOFF: 'NFL_PLAYOFFS',
    NFL_PLAYOFF: 'NFL_PLAYOFFS',
};

export function checkoutPricingType(storedType: unknown): string {
    if (typeof storedType !== 'string' || storedType.trim() === '') return 'SQUARES';
    const upper = storedType.trim().toUpperCase();
    return LEGACY_PRICING_TYPE_ALIASES[upper] ?? upper;
}
