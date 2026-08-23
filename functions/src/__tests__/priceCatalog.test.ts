import { describe, it, expect } from 'vitest';
import {
  estimateGeminiCostUSD,
  lookupGeminiPrice,
  PRICE_CATALOG_VERSION,
  GEMINI_PRICES,
} from '../lib/priceCatalog';

/**
 * PLAN-COST-CONTROLS Phase 1.5 — the versioned price catalog.
 *
 * Two properties are load-bearing and are what these tests pin:
 *
 * 1. UNPRICED IS NULL, NEVER ZERO. Phase 2.3's spend breaker sums these costs.
 *    A guessed or zeroed cost for a model we do not know would make the breaker
 *    either trip early or never trip — and an all-unknown month would read as a
 *    free month. Until Phase 3.4 pins the model, unknown ids are EXPECTED.
 *
 * 2. LONGEST-PREFIX WINS. `gemini-2.0-flash-lite` is a strict extension of
 *    `gemini-2.0-flash`, so a naive first-match scan prices the cheap model at
 *    the expensive one's rate (1.33x here). That is a silent overcharge in the
 *    breaker, which is worse than a loud failure.
 */
describe('priceCatalog', () => {
  it('prices a known model from its measured token counts', () => {
    // 1M input @ $0.10 + 1M output @ $0.40 = $0.50 exactly.
    const r = estimateGeminiCostUSD('gemini-2.0-flash', 1_000_000, 1_000_000);
    expect(r.priced).toBe(true);
    expect(r.estimatedCostUSD).toBeCloseTo(0.5, 6);
    expect(r.pricedAs).toBe('gemini-2.0-flash');
    expect(r.catalogVersion).toBe(PRICE_CATALOG_VERSION);
  });

  it('keeps sub-cent costs representable rather than rounding them to zero', () => {
    // A realistic request: ~20K in, ~1K out on flash-lite → ~$0.0018.
    const r = estimateGeminiCostUSD('gemini-2.0-flash-lite', 20_000, 1_000);
    expect(r.priced).toBe(true);
    expect(r.estimatedCostUSD).toBeGreaterThan(0);
    // Rounding to cents would make this 0 and the monthly rollup read as free.
    expect(r.estimatedCostUSD).toBeLessThan(0.01);
  });

  it('matches the LONGEST prefix, so flash-lite is not priced as flash', () => {
    const lite = lookupGeminiPrice('gemini-2.0-flash-lite-preview-02-05');
    expect(lite?.key).toBe('gemini-2.0-flash-lite');

    // The regression this guards: pricing flash-lite at flash's rate.
    const litePrice = estimateGeminiCostUSD('gemini-2.0-flash-lite-preview-02-05', 1_000_000, 0);
    const flashPrice = estimateGeminiCostUSD('gemini-2.0-flash', 1_000_000, 0);
    expect(litePrice.estimatedCostUSD).toBeLessThan(flashPrice.estimatedCostUSD as number);
  });

  it('strips a models/ prefix and is case-insensitive', () => {
    expect(lookupGeminiPrice('models/Gemini-2.0-Flash')?.key).toBe('gemini-2.0-flash');
  });

  it('returns NULL cost — not zero — for a model it does not know', () => {
    const r = estimateGeminiCostUSD('gemini-9.9-unreleased', 1000, 1000);
    expect(r.priced).toBe(false);
    expect(r.estimatedCostUSD).toBeNull();
    expect(r.pricedAs).toBeNull();
  });

  it('returns NULL cost when token counts are missing, even for a known model', () => {
    // usageMetadata absent → we must not substitute a prompt-length estimate.
    for (const [i, o] of [[null, 5], [5, null], [undefined, undefined]] as const) {
      const r = estimateGeminiCostUSD('gemini-2.0-flash', i as number | null, o as number | null);
      expect(r.priced).toBe(false);
      expect(r.estimatedCostUSD).toBeNull();
      // The model was still recognised — that is worth recording separately.
      expect(r.pricedAs).toBe('gemini-2.0-flash');
    }
  });

  it('handles a null/empty model without throwing', () => {
    expect(lookupGeminiPrice(null)).toBeNull();
    expect(lookupGeminiPrice('   ')).toBeNull();
    expect(estimateGeminiCostUSD(undefined, 1, 1).priced).toBe(false);
  });

  it('every catalog entry carries both rates and an asOf date', () => {
    // A half-filled entry would price one side of the call at undefined → NaN.
    for (const [key, price] of Object.entries(GEMINI_PRICES)) {
      expect(typeof price.inputPerMillionUSD, key).toBe('number');
      expect(typeof price.outputPerMillionUSD, key).toBe('number');
      expect(price.asOf, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('version string is dated so a same-day correction is distinguishable', () => {
    expect(PRICE_CATALOG_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe('priceCatalog — prefix resolution is order-independent', () => {
  it('resolves every prefix-pair to the LONGER key, whatever the literal order', () => {
    // The general property, asserted over the real catalog rather than one
    // hand-picked pair: if key A is a strict prefix of key B, then looking up B
    // must return B. GEMINI_PRICES declares each family before its longer
    // variants on purpose, so this fails if the descending-length sort in
    // lookupGeminiPrice is removed.
    const keys = Object.keys(GEMINI_PRICES);
    const pairs = keys.flatMap((a) => keys.filter((b) => b !== a && b.startsWith(a)).map((b) => [a, b]));
    expect(pairs.length, 'catalog must contain at least one prefix pair for this to guard anything').toBeGreaterThan(0);
    for (const [shorter, longer] of pairs) {
      expect(lookupGeminiPrice(longer)?.key, `${longer} must not resolve to ${shorter}`).toBe(longer);
    }
  });
});
