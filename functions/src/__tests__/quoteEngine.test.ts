/**
 * quoteEngine.test.ts — Unit tests for the pure pricing/quote engine (single
 * price authority behind getPoolQuote + createCheckoutSession). Runner: vitest.
 *
 * Covers PLAN Layer-1 quote cases: every format resolves a tier (unmapped
 * throws), add-on pricing INCLUDING SMS (the pre-overhaul omission), coupon
 * math (percentage/flat/clamp), coupon-inclusive total, and freeTierEligible
 * disqualified by a paid add-on.
 */
import { describe, it, expect } from 'vitest';
import {
  resolvePricingKey,
  computeBasePrice,
  computeAddonLines,
  applyCouponDiscount,
  discountLabel,
  computeQuote,
} from '../lib/quoteEngine';
import { BillingConfigSchema, type BillingConfig } from '../shared/schemas/billingConfig';

// A realistic, schema-valid config (parsed so defaults are materialized).
const CONFIG: BillingConfig = BillingConfigSchema.parse({
  freePlayerThreshold: 10,
  gracePeriodDays: 7,
  trialDays: 14,
  pricing: {
    season: [
      { min: 11, max: 25, price: 29 },
      { min: 26, max: 50, price: 59 },
      { min: 51, max: 100, price: 99 },
      { min: 101, max: 9999, price: 149 },
    ],
    bracket: [
      { min: 11, max: 25, price: 19 },
      { min: 26, max: 50, price: 39 },
      { min: 51, max: 100, price: 69 },
      { min: 101, max: 9999, price: 99 },
    ],
    squares: [
      { min: 11, max: 25, price: 9 },
      { min: 26, max: 50, price: 19 },
      { min: 51, max: 100, price: 29 },
      { min: 101, max: 9999, price: 39 },
    ],
    props: [
      { min: 11, max: 25, price: 9 },
      { min: 26, max: 50, price: 19 },
      { min: 51, max: 100, price: 29 },
      { min: 101, max: 9999, price: 39 },
    ],
  },
  features: {
    aiCommissioner: { isPremium: true, addonPrice: 19 },
    whatIfSimulator: { isPremium: true, addonPrice: 9 },
    customBranding: { isPremium: true, addonPrice: 29 },
    smsNotifications: { isPremium: true, addonPrice: 5 },
  },
});

const NO_ADDONS = { aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false };

describe('resolvePricingKey — every live format maps to a tier', () => {
  const cases: Array<[string, string]> = [
    ['SQUARES', 'squares'],
    ['BRACKET', 'bracket'],
    ['NFL_PLAYOFFS', 'bracket'],
    ['PROPS', 'props'],
    ['NFL_PICKEM', 'season'],
    ['NFL_SURVIVOR', 'season'],
    ['NFL_MARGIN', 'season'],
  ];
  it.each(cases)('%s → %s', (format, key) => {
    expect(resolvePricingKey(CONFIG, format)).toBe(key);
  });

  it('THROWS for an unmapped format', () => {
    expect(() => resolvePricingKey(CONFIG, 'NOT_A_FORMAT')).toThrow(/No pricing tier mapping/);
  });
});

describe('computeBasePrice', () => {
  it('is $0 at/under the free threshold', () => {
    expect(computeBasePrice(CONFIG, 'SQUARES', 10).basePrice).toBe(0);
    expect(computeBasePrice(CONFIG, 'SQUARES', 0).basePrice).toBe(0);
  });

  it('prices from the tier band by player count', () => {
    expect(computeBasePrice(CONFIG, 'SQUARES', 11).basePrice).toBe(9);
    expect(computeBasePrice(CONFIG, 'SQUARES', 40).basePrice).toBe(19);
    // NFL season formats resolve to the 'season' tier band.
    expect(computeBasePrice(CONFIG, 'NFL_PICKEM', 30).basePrice).toBe(59);
    expect(computeBasePrice(CONFIG, 'NFL_PICKEM', 30).pricingKey).toBe('season');
    expect(computeBasePrice(CONFIG, 'BRACKET', 100).basePrice).toBe(69);
  });

  it('charges the top tier above the last band', () => {
    expect(computeBasePrice(CONFIG, 'SQUARES', 100000).basePrice).toBe(39);
  });

  it('THROWS on empty tiers at a chargeable size (malformed config must never price $0)', () => {
    // Simulates a missing/malformed billing config where a format resolves but
    // has no pricing tiers. A paid-size pool must fail loudly, not activate free.
    const emptyTiers = { ...CONFIG, pricing: { ...CONFIG.pricing, season: [] } } as BillingConfig;
    expect(() => computeBasePrice(emptyTiers, 'NFL_PICKEM', 40)).toThrow(/PRICING_NOT_CONFIGURED/);
    // At/under the free threshold it is still $0 (free tier), no throw.
    expect(computeBasePrice(emptyTiers, 'NFL_PICKEM', 10).basePrice).toBe(0);
  });
});

describe('computeAddonLines — SMS is priced (the pre-overhaul bug)', () => {
  it('prices every selected premium add-on, INCLUDING smsNotifications', () => {
    const lines = computeAddonLines(CONFIG, { aiCommissioner: true, smsNotifications: true, whatIfSimulator: true, customBranding: true });
    const byKey = Object.fromEntries(lines.map((l) => [l.key, l.amount]));
    expect(byKey.aiCommissioner).toBe(19);
    expect(byKey.smsNotifications).toBe(5); // <-- SMS included
    expect(byKey.whatIfSimulator).toBe(9);
    expect(byKey.customBranding).toBe(29);
  });

  it('adds no line for an unselected add-on', () => {
    const lines = computeAddonLines(CONFIG, { ...NO_ADDONS, aiCommissioner: true });
    expect(lines).toHaveLength(1);
    expect(lines[0].key).toBe('aiCommissioner');
  });

  it('adds no line for a non-premium or zero-price add-on', () => {
    const cfg = { features: { ...CONFIG.features, aiCommissioner: { isPremium: false, addonPrice: 19 } } } as BillingConfig;
    expect(computeAddonLines(cfg, { ...NO_ADDONS, aiCommissioner: true })).toHaveLength(0);
  });
});

describe('applyCouponDiscount — percentage / flat / clamp', () => {
  it('percentage', () => {
    expect(applyCouponDiscount(49, 'percentage', 20)).toBeCloseTo(39.2, 2);
    expect(applyCouponDiscount(100, 'percentage', 50)).toBe(50);
    expect(applyCouponDiscount(79, 'percentage', 100)).toBe(0);
  });
  it('flat', () => {
    expect(applyCouponDiscount(49, 'flat', 10)).toBe(39);
    expect(applyCouponDiscount(29, 'flat', 29)).toBe(0);
  });
  it('clamps to $0', () => {
    expect(applyCouponDiscount(10, 'flat', 25)).toBe(0);
    expect(applyCouponDiscount(49, 'percentage', 150)).toBe(0);
    expect(applyCouponDiscount(0, 'flat', 10)).toBe(0);
  });
});

describe('discountLabel', () => {
  it('formats percentage and flat', () => {
    expect(discountLabel('percentage', 20)).toBe('20% off');
    expect(discountLabel('flat', 10)).toBe('$10 off');
  });
});

describe('computeQuote — itemized, coupon-inclusive, free-tier eligibility', () => {
  it('sums base + all add-ons (incl SMS) into subtotal', () => {
    const q = computeQuote({
      config: CONFIG, poolType: 'SQUARES', estimatedPlayers: 40,
      addons: { aiCommissioner: true, smsNotifications: true, whatIfSimulator: false, customBranding: false },
    });
    // base(40 squares)=19 + ai 19 + sms 5 = 43
    expect(q.basePrice).toBe(19);
    expect(q.subtotal).toBe(43);
    expect(q.discount).toBe(0);
    expect(q.total).toBe(43);
  });

  it('applies a valid coupon to the total (coupon-inclusive quote)', () => {
    const q = computeQuote({
      config: CONFIG, poolType: 'SQUARES', estimatedPlayers: 40, addons: NO_ADDONS,
      couponState: { code: 'HALF', valid: true, discountType: 'percentage', discountValue: 50, discountLabel: '50% off' },
      coupon: { code: 'HALF', discountType: 'percentage', discountValue: 50 },
    });
    // base 19, 50% off → 9.5 discount, total 9.5
    expect(q.subtotal).toBe(19);
    expect(q.discount).toBeCloseTo(9.5, 2);
    expect(q.total).toBeCloseTo(9.5, 2);
  });

  it('an INVALID coupon applies no discount', () => {
    const q = computeQuote({
      config: CONFIG, poolType: 'SQUARES', estimatedPlayers: 40, addons: NO_ADDONS,
      couponState: { code: 'NOPE', valid: false, reason: 'expired' },
    });
    expect(q.discount).toBe(0);
    expect(q.total).toBe(19);
  });

  it('freeTierEligible when players ≤ threshold AND total $0', () => {
    const q = computeQuote({ config: CONFIG, poolType: 'SQUARES', estimatedPlayers: 8, addons: NO_ADDONS });
    expect(q.basePrice).toBe(0);
    expect(q.total).toBe(0);
    expect(q.freeTierEligible).toBe(true);
    expect(q.tier).toBe('free_tier');
  });

  it('freeTierEligible is FALSE when a paid add-on is selected (even under threshold)', () => {
    const q = computeQuote({
      config: CONFIG, poolType: 'SQUARES', estimatedPlayers: 8,
      addons: { ...NO_ADDONS, aiCommissioner: true },
    });
    // base 0 (under threshold) but ai 19 → total 19 → NOT free
    expect(q.total).toBe(19);
    expect(q.freeTierEligible).toBe(false);
    expect(q.tier).toBe('premium_tier');
  });

  it('a 100% coupon on a base-only pool yields $0 and freeTierEligible only if under threshold', () => {
    // Over threshold: total $0 via coupon, but players > threshold → NOT free-tier eligible.
    const q = computeQuote({
      config: CONFIG, poolType: 'SQUARES', estimatedPlayers: 40, addons: NO_ADDONS,
      couponState: { code: 'FREE', valid: true, discountType: 'percentage', discountValue: 100 },
      coupon: { code: 'FREE', discountType: 'percentage', discountValue: 100 },
    });
    expect(q.total).toBe(0);
    expect(q.freeTierEligible).toBe(false); // 40 > 10 threshold
  });

  it('surfaces trialDays from config', () => {
    const q = computeQuote({ config: CONFIG, poolType: 'SQUARES', estimatedPlayers: 40, addons: NO_ADDONS });
    expect(q.trialDays).toBe(14);
  });

  it('throws (propagates) for an unmapped format', () => {
    expect(() =>
      computeQuote({ config: CONFIG, poolType: 'BOGUS', estimatedPlayers: 40, addons: NO_ADDONS })
    ).toThrow(/No pricing tier mapping/);
  });
});
