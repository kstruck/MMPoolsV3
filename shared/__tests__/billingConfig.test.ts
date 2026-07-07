// Runnable self-check for the billing-config contract. node:assert, no
// framework — compile shared/ (`npx tsc -p shared`) then
// `node shared/dist/__tests__/billingConfig.test.js`.
// (Root vitest excludes shared/**, so the .test.ts name does not collide.)
import assert from 'node:assert';
import {
  BillingConfigSchema,
  DEFAULT_FORMAT_TIER_MAP,
  DEFAULT_TRIAL_DAYS,
  LEGACY_NEVER_EXPIRES_TERM_DAYS,
  normalizeLegacyPackage,
  packageSchema,
  type BillingConfigInput,
  type Package,
} from '../schemas/billingConfig';
import { POOL_TYPES } from '../poolTypes';

// --- Fixtures ----------------------------------------------------------------
const tiers = [
  { min: 11, max: 25, price: 19 },
  { min: 26, max: 50, price: 39 },
  { min: 51, max: 100, price: 69 },
  { min: 101, max: 9999, price: 99 },
];

const creditBundle: Package = {
  id: 'starter_3',
  name: 'Starter 3-Pack',
  description: 'Three pool credits',
  price: 49,
  kind: 'CREDIT_BUNDLE',
  poolsIncluded: 3,
  poolType: 'ALL',
  maxPlayersPerPool: 100,
  isActive: true,
};

const unlimitedPass: Package = {
  id: 'unlimited_1yr',
  name: 'Unlimited Pass',
  description: 'Unlimited pools for a year',
  price: 129,
  kind: 'UNLIMITED_PASS',
  termDays: 365,
  poolType: 'ALL',
  maxPlayersPerPool: 9999,
  isActive: true,
};

const validConfig: BillingConfigInput = {
  freePlayerThreshold: 10,
  gracePeriodDays: 7,
  trialDays: 14,
  pricing: { season: tiers, bracket: tiers, squares: tiers, props: tiers },
  formatTierMap: {
    SQUARES: 'squares',
    BRACKET: 'bracket',
    NFL_PLAYOFFS: 'bracket',
    PROPS: 'props',
    NFL_PICKEM: 'season',
    NFL_SURVIVOR: 'season',
    NFL_MARGIN: 'season',
  },
  features: {
    aiCommissioner: { isPremium: true, addonPrice: 19 },
    whatIfSimulator: { isPremium: true, addonPrice: 9 },
    customBranding: { isPremium: true, addonPrice: 29 },
    smsNotifications: { isPremium: true, addonPrice: 9 },
  },
  packagesList: [creditBundle, unlimitedPass],
  heroPromo: { code: 'EARLYBIRD30', discountLabel: '30% OFF', endsAt: 1785542399000 },
  packages: { buy_3: 49, unlimited_1yr: 129 },
};

// --- Full config: happy path + defaults ---------------------------------------
assert.doesNotThrow(() => BillingConfigSchema.parse(validConfig), 'full new-shape config parses');

{
  // trialDays / formatTierMap / packagesList are defaulted for pre-overhaul docs.
  const legacyish = { ...validConfig } as Record<string, unknown>;
  delete legacyish.trialDays;
  delete legacyish.formatTierMap;
  delete legacyish.packagesList;
  delete legacyish.heroPromo;
  const parsed = BillingConfigSchema.parse(legacyish);
  assert.strictEqual(parsed.trialDays, DEFAULT_TRIAL_DAYS, 'trialDays defaults to 14');
  assert.deepStrictEqual(parsed.formatTierMap, DEFAULT_FORMAT_TIER_MAP, 'formatTierMap defaults to canonical map');
  assert.deepStrictEqual(parsed.packagesList, [], 'packagesList defaults to []');
  assert.strictEqual(parsed.heroPromo, undefined, 'heroPromo stays optional');
}

// smsNotifications feature is optional for back-compat.
assert.doesNotThrow(() => {
  const { smsNotifications: _sms, ...rest } = validConfig.features;
  void _sms;
  BillingConfigSchema.parse({ ...validConfig, features: rest });
}, 'config without smsNotifications feature parses');

// Core ints must be positive.
assert.throws(() => BillingConfigSchema.parse({ ...validConfig, freePlayerThreshold: 0 }), 'freePlayerThreshold 0 rejected');
assert.throws(() => BillingConfigSchema.parse({ ...validConfig, gracePeriodDays: -1 }), 'negative gracePeriodDays rejected');
assert.throws(() => BillingConfigSchema.parse({ ...validConfig, trialDays: 0 }), 'trialDays 0 rejected');

// --- Tier contiguity refine -----------------------------------------------------
const withSeason = (season: unknown) =>
  ({ ...validConfig, pricing: { ...validConfig.pricing, season } });

assert.throws(
  () => BillingConfigSchema.parse(withSeason([{ min: 11, max: 25, price: 19 }, { min: 27, max: 50, price: 39 }])),
  'gap between tiers rejected (26 unpriced)',
);
assert.throws(
  () => BillingConfigSchema.parse(withSeason([{ min: 11, max: 25, price: 19 }, { min: 20, max: 50, price: 39 }])),
  'overlapping tiers rejected',
);
assert.throws(
  () => BillingConfigSchema.parse(withSeason([{ min: 26, max: 50, price: 39 }, { min: 11, max: 25, price: 19 }])),
  'descending tiers rejected',
);
assert.throws(
  () => BillingConfigSchema.parse(withSeason([{ min: 30, max: 20, price: 19 }])),
  'tier with max < min rejected',
);
assert.throws(
  () => BillingConfigSchema.parse(withSeason([{ min: -1, max: 10, price: 0 }])),
  'negative min rejected',
);
assert.throws(
  () => BillingConfigSchema.parse(withSeason([{ min: 11, max: 25, price: -5 }])),
  'negative price rejected',
);
assert.doesNotThrow(
  () => BillingConfigSchema.parse(withSeason([])),
  'empty tier list is allowed (nothing to be non-contiguous)',
);

// --- formatTierMap exhaustiveness ------------------------------------------------
for (const t of POOL_TYPES) {
  const partial = { ...validConfig.formatTierMap } as Record<string, unknown>;
  delete partial[t];
  assert.throws(
    () => BillingConfigSchema.parse({ ...validConfig, formatTierMap: partial }),
    `formatTierMap missing ${t} rejected`,
  );
}
assert.throws(
  () => BillingConfigSchema.parse({ ...validConfig, formatTierMap: { ...validConfig.formatTierMap, SQUARES: 'flat' } }),
  'formatTierMap with unknown pricing key rejected',
);

// --- packagesList: discriminated union rules -------------------------------------
assert.doesNotThrow(() => packageSchema.parse(creditBundle), 'CREDIT_BUNDLE parses');
assert.doesNotThrow(() => packageSchema.parse(unlimitedPass), 'UNLIMITED_PASS parses');
assert.doesNotThrow(
  () => packageSchema.parse({ ...creditBundle, poolType: 'BRACKET' }),
  'package scoped to a single pool format parses',
);
assert.throws(
  () => packageSchema.parse({ ...creditBundle, poolsIncluded: 0 }),
  'CREDIT_BUNDLE poolsIncluded < 1 rejected',
);
assert.throws(
  () => packageSchema.parse({ ...creditBundle, poolsIncluded: 101 }),
  'CREDIT_BUNDLE poolsIncluded > 100 rejected',
);
{
  const { poolsIncluded: _p, ...noCount } = creditBundle as Extract<Package, { kind: 'CREDIT_BUNDLE' }>;
  void _p;
  assert.throws(() => packageSchema.parse(noCount), 'CREDIT_BUNDLE without poolsIncluded rejected');
}
{
  const { termDays: _t, ...noTerm } = unlimitedPass as Extract<Package, { kind: 'UNLIMITED_PASS' }>;
  void _t;
  assert.throws(() => packageSchema.parse(noTerm), 'UNLIMITED_PASS without termDays rejected');
}
assert.throws(
  () => packageSchema.parse({ ...unlimitedPass, termDays: 0 }),
  'UNLIMITED_PASS termDays 0 rejected',
);
assert.throws(
  () => packageSchema.parse({ ...creditBundle, poolType: 'CONFIDENCE' }),
  'unknown poolType rejected',
);
assert.throws(
  () => BillingConfigSchema.parse({
    ...validConfig,
    // legacy-shaped item (no kind) must NOT silently pass the new schema
    packagesList: [{ id: 'x', name: 'x', description: '', poolType: 'ALL', maxPlayersPerPool: 50, poolsIncluded: 3, durationDays: 0, price: 49, isActive: true }],
  }),
  'legacy bundle inside packagesList rejected by new schema',
);

// --- heroPromo --------------------------------------------------------------------
assert.throws(
  () => BillingConfigSchema.parse({ ...validConfig, heroPromo: { code: '', discountLabel: 'x', endsAt: 1 } }),
  'heroPromo with empty code rejected',
);
assert.throws(
  () => BillingConfigSchema.parse({ ...validConfig, heroPromo: { code: 'X', discountLabel: 'x', endsAt: -5 } }),
  'heroPromo with non-positive endsAt rejected',
);

// --- normalizeLegacyPackage ---------------------------------------------------------
{
  // durationDays > 0 -> UNLIMITED_PASS with termDays = durationDays
  const legacy = { id: 'l1', name: 'Season Pass', description: 'd', poolType: 'ALL', maxPlayersPerPool: 100, poolsIncluded: 9999, durationDays: 365, price: 129, isActive: true };
  const p = normalizeLegacyPackage(legacy);
  assert.strictEqual(p.kind, 'UNLIMITED_PASS', 'durationDays>0 becomes UNLIMITED_PASS');
  assert.ok(p.kind === 'UNLIMITED_PASS' && p.termDays === 365, 'termDays carried from durationDays');
}
{
  // poolsIncluded >= 9999 with no duration -> evergreen UNLIMITED_PASS
  const legacy = { id: 'l2', name: 'Forever', description: '', poolType: 'ALL', maxPlayersPerPool: 9999, poolsIncluded: 9999, durationDays: 0, price: 199, isActive: true };
  const p = normalizeLegacyPackage(legacy);
  assert.ok(p.kind === 'UNLIMITED_PASS' && p.termDays === LEGACY_NEVER_EXPIRES_TERM_DAYS, 'legacy never-expires maps to evergreen term');
}
{
  // plain counted bundle -> CREDIT_BUNDLE
  const legacy = { id: 'l3', name: '3-Pack', description: '', poolType: 'BRACKET', maxPlayersPerPool: 50, poolsIncluded: 3, durationDays: 0, price: 49, isActive: true };
  const p = normalizeLegacyPackage(legacy);
  assert.ok(p.kind === 'CREDIT_BUNDLE' && p.poolsIncluded === 3, 'counted bundle becomes CREDIT_BUNDLE');
  assert.strictEqual(p.poolType, 'BRACKET', 'poolType preserved');
}
{
  // out-of-range legacy count clamps into the schema's 1..100 window
  const p = normalizeLegacyPackage({ id: 'l4', name: 'Mega', description: '', poolType: 'ALL', maxPlayersPerPool: 50, poolsIncluded: 500, durationDays: 0, price: 999, isActive: true });
  assert.ok(p.kind === 'CREDIT_BUNDLE' && p.poolsIncluded === 100, 'oversized legacy count clamps to 100');
}
{
  // new-shape input passes through unchanged (validated)
  const p = normalizeLegacyPackage(creditBundle);
  assert.deepStrictEqual(p, creditBundle, 'new-shape package passes through');
}
{
  // garbage input degrades to a safe, inactive, unpriced bundle — never throws
  const p = normalizeLegacyPackage(null);
  assert.strictEqual(p.kind, 'CREDIT_BUNDLE', 'garbage input yields CREDIT_BUNDLE');
  assert.strictEqual(p.isActive, false, 'garbage input is inactive');
  assert.strictEqual(p.price, 0, 'garbage input is unpriced');
  // every normalized non-garbage-id output should satisfy the schema; id/name
  // fall back to '' which the schema (min 1) intentionally flags on re-save
  assert.strictEqual(packageSchema.safeParse(normalizeLegacyPackage({ id: 'ok', name: 'ok', description: '', poolType: 'ALL', maxPlayersPerPool: 10, poolsIncluded: 2, durationDays: 0, price: 5, isActive: true })).success, true, 'normalized legacy item satisfies packageSchema');
}

// --- Scheduler slice (.pick) stays parseable on legacy docs -------------------------
{
  const slice = BillingConfigSchema.pick({ gracePeriodDays: true, trialDays: true })
    .safeParse({ freePlayerThreshold: 10, gracePeriodDays: 9, pricing: {}, packagesList: [{ legacy: true }] });
  assert.ok(slice.success, 'pick(gracePeriodDays, trialDays) ignores unrelated legacy fields');
  assert.strictEqual(slice.success && slice.data.gracePeriodDays, 9, 'picked gracePeriodDays honored');
  assert.strictEqual(slice.success && slice.data.trialDays, DEFAULT_TRIAL_DAYS, 'picked trialDays defaults');
}

console.log('billingConfig.test: all assertions passed');
