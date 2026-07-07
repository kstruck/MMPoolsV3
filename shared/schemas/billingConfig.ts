// Canonical contract for the Firestore doc `settings/billing_config` — the
// single billing-config authority per ADR-0001. Shared by the client
// (@shared/schemas/billingConfig) and Cloud Functions (./shared/schemas/…
// via the copy-shared mirror).
//
// Usage pattern:
//   - WRITE gate (adminSaveBillingConfig): .parse() the payload, reject invalid,
//     persist the parsed (normalized) doc — defaults materialized, junk stripped.
//   - READ (schedulers / pricing): parse with safeParse and fail OPEN to the
//     exported DEFAULT_* constants; a malformed doc must never stall billing
//     enforcement. Readers that only need a slice should .pick() the fields
//     they use (the top-level schema is deliberately refine-free so .pick()
//     stays available).
//   - Legacy packagesList items (durationDays / poolsIncluded>=9999 sentinels)
//     are NOT modeled here — convert them at read time with
//     normalizeLegacyPackage() until the config is re-saved in the new shape.
import { z } from 'zod';
import { POOL_TYPES } from '../poolTypes';
import type { PoolType } from '../poolTypes';

// --- Defaults (fail-open values for readers; keep in sync with product copy) --
export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_GRACE_PERIOD_DAYS = 7;
/**
 * Legacy bundles used durationDays=0 to mean "never expires". The new model
 * requires an explicit term on every UNLIMITED_PASS, so normalizeLegacyPackage
 * maps "never expires" to this effectively-evergreen term (10 years). Re-save
 * the config to pick an intentional term.
 */
export const LEGACY_NEVER_EXPIRES_TERM_DAYS = 3650;

// --- Pricing tiers ------------------------------------------------------------
export const pricingTierSchema = z.object({
  min: z.number().int().min(0),
  max: z.number().int(),
  price: z.number().min(0),
});
export type PricingTier = z.infer<typeof pricingTierSchema>;

// Tiers must be internally sane (min <= max) and form one ascending,
// gap-free, non-overlapping band: each tier starts exactly one player above
// where the previous tier ended. (Player counts are integers, so
// contiguous === next.min == prev.max + 1.)
const pricingTiersSchema = z.array(pricingTierSchema).superRefine((tiers, ctx) => {
  tiers.forEach((tier, i) => {
    if (tier.max < tier.min) {
      ctx.addIssue({
        code: 'custom',
        path: [i, 'max'],
        message: `tier ${i}: max (${tier.max}) must be >= min (${tier.min})`,
      });
    }
    if (i > 0 && tier.min !== tiers[i - 1].max + 1) {
      ctx.addIssue({
        code: 'custom',
        path: [i, 'min'],
        message: `tier ${i}: min (${tier.min}) must be exactly prev.max + 1 (${tiers[i - 1].max + 1}) — tiers must be contiguous, ascending, non-overlapping`,
      });
    }
  });
});

// --- Pricing key + pool-format -> pricing-key map ------------------------------
export const pricingKeySchema = z.enum(['season', 'bracket', 'squares', 'props']);
export type PricingKey = z.infer<typeof pricingKeySchema>;

// Every live pool type MUST map to a pricing key. The `satisfies` clause pins
// this shape to shared/poolTypes.ts — adding a pool type without extending the
// map is a compile error here, not a runtime surprise in checkout.
const formatTierMapShape = {
  SQUARES: pricingKeySchema,
  BRACKET: pricingKeySchema,
  NFL_PLAYOFFS: pricingKeySchema,
  PROPS: pricingKeySchema,
  NFL_PICKEM: pricingKeySchema,
  NFL_SURVIVOR: pricingKeySchema,
  NFL_MARGIN: pricingKeySchema,
} satisfies Record<PoolType, typeof pricingKeySchema>;
export const formatTierMapSchema = z.object(formatTierMapShape);
export type FormatTierMap = z.infer<typeof formatTierMapSchema>;

export const DEFAULT_FORMAT_TIER_MAP: FormatTierMap = {
  SQUARES: 'squares',
  BRACKET: 'bracket',
  NFL_PLAYOFFS: 'bracket',
  PROPS: 'props',
  NFL_PICKEM: 'season',
  NFL_SURVIVOR: 'season',
  NFL_MARGIN: 'season',
};

// --- Premium features ----------------------------------------------------------
export const billingFeatureFlagSchema = z.object({
  isPremium: z.boolean(),
  addonPrice: z.number().min(0),
});
export type BillingFeatureFlag = z.infer<typeof billingFeatureFlagSchema>;

// --- Bundle products (packagesList) ---------------------------------------------
// Modeled as a discriminated union rather than optionals + refine: the
// task-level rules "poolsIncluded is CREDIT_BUNDLE-only" and "termDays is
// UNLIMITED_PASS-only" are enforced structurally — each variant simply does
// not carry the other's field.
const packageBaseShape = {
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  price: z.number().min(0),
  poolType: z.union([z.literal('ALL'), z.enum(POOL_TYPES)]),
  maxPlayersPerPool: z.number().int().positive(),
  isActive: z.boolean(),
};

export const creditBundlePackageSchema = z.object({
  ...packageBaseShape,
  kind: z.literal('CREDIT_BUNDLE'),
  /** How many pool credits the bundle grants (CREDIT_BUNDLE only). */
  poolsIncluded: z.number().int().min(1).max(100),
});
export type CreditBundlePackage = z.infer<typeof creditBundlePackageSchema>;

export const unlimitedPassPackageSchema = z.object({
  ...packageBaseShape,
  kind: z.literal('UNLIMITED_PASS'),
  /** Pass validity in days (UNLIMITED_PASS only). */
  termDays: z.number().int().positive(),
});
export type UnlimitedPassPackage = z.infer<typeof unlimitedPassPackageSchema>;

export const packageSchema = z.discriminatedUnion('kind', [
  creditBundlePackageSchema,
  unlimitedPassPackageSchema,
]);
export type Package = z.infer<typeof packageSchema>;

/**
 * @deprecated Legacy `packagesList` item shape still present in Firestore docs
 * saved before the buyflow overhaul (durationDays=0 => never expires,
 * poolsIncluded>=9999 => unlimited). New writes must use `Package`; readers
 * convert old items with {@link normalizeLegacyPackage}.
 */
export interface LegacyBillingBundle {
  id: string;
  name: string;
  description: string;
  poolType: 'ALL' | PoolType;
  maxPlayersPerPool: number;
  poolsIncluded: number;
  durationDays: number;
  price: number;
  isActive: boolean;
}

const isPoolTypeOrAll = (v: unknown): v is 'ALL' | PoolType =>
  v === 'ALL' || (typeof v === 'string' && (POOL_TYPES as readonly string[]).includes(v));

const finiteNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Converts a packagesList item of unknown vintage into the new Package shape
 * so readers can consume old configs until they are re-saved.
 *
 * Conversion rules (legacy docs):
 *   - durationDays > 0                  -> UNLIMITED_PASS, termDays = durationDays
 *   - poolsIncluded >= 9999 (no term)   -> UNLIMITED_PASS, termDays = LEGACY_NEVER_EXPIRES_TERM_DAYS
 *   - anything else                     -> CREDIT_BUNDLE, poolsIncluded clamped to 1..100
 *
 * Total function: never throws. Unreadable fields fall back to safe values
 * (empty strings, price 0, isActive false) — a garbage legacy item becomes an
 * inactive zero-price package, never a purchasable surprise.
 */
export function normalizeLegacyPackage(raw: unknown): Package {
  // Already new-shape? Pass it through validated.
  const asNew = packageSchema.safeParse(raw);
  if (asNew.success) return asNew.data;

  const rec: Record<string, unknown> =
    raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const base = {
    id: typeof rec.id === 'string' ? rec.id : '',
    name: typeof rec.name === 'string' ? rec.name : '',
    description: typeof rec.description === 'string' ? rec.description : '',
    price: Math.max(0, finiteNumber(rec.price) ?? 0),
    poolType: isPoolTypeOrAll(rec.poolType) ? rec.poolType : ('ALL' as const),
    // 9999 is the legacy "unlimited players" sentinel — keep it as the fallback.
    maxPlayersPerPool: Math.max(1, Math.round(finiteNumber(rec.maxPlayersPerPool) ?? 9999)),
    isActive: rec.isActive === true,
  };

  const durationDays = finiteNumber(rec.durationDays) ?? 0;
  const poolsIncluded = finiteNumber(rec.poolsIncluded) ?? 0;

  if (durationDays > 0) {
    return { ...base, kind: 'UNLIMITED_PASS', termDays: Math.max(1, Math.round(durationDays)) };
  }
  if (poolsIncluded >= 9999) {
    return { ...base, kind: 'UNLIMITED_PASS', termDays: LEGACY_NEVER_EXPIRES_TERM_DAYS };
  }
  return {
    ...base,
    kind: 'CREDIT_BUNDLE',
    poolsIncluded: Math.min(100, Math.max(1, Math.round(poolsIncluded || 1))),
  };
}

// --- Hero promo banner ----------------------------------------------------------
export const heroPromoSchema = z.object({
  code: z.string().min(1),
  discountLabel: z.string().min(1),
  /** Promo end, ms since epoch. */
  endsAt: z.number().int().positive(),
});
export type HeroPromo = z.infer<typeof heroPromoSchema>;

// --- Top-level config -------------------------------------------------------------
// Deliberately a plain ZodObject (all refinements live on nested field
// schemas) so consumers can .pick() slices without losing validation.
export const BillingConfigSchema = z.object({
  freePlayerThreshold: z.number().int().positive(),
  gracePeriodDays: z.number().int().positive(),
  trialDays: z.number().int().positive().default(DEFAULT_TRIAL_DAYS),
  pricing: z.object({
    season: pricingTiersSchema,
    bracket: pricingTiersSchema,
    squares: pricingTiersSchema,
    props: pricingTiersSchema,
  }),
  formatTierMap: formatTierMapSchema.default(DEFAULT_FORMAT_TIER_MAP),
  features: z.object({
    aiCommissioner: billingFeatureFlagSchema,
    whatIfSimulator: billingFeatureFlagSchema,
    customBranding: billingFeatureFlagSchema,
    // Optional for back-compat: some saved configs predate SMS.
    smsNotifications: billingFeatureFlagSchema.optional(),
  }),
  packagesList: z.array(packageSchema).default([]),
  heroPromo: heroPromoSchema.optional(),
  /**
   * @deprecated Flat legacy bundle prices (buy_3 / unlimited_1yr). Kept as an
   * optional passthrough so pre-overhaul docs and readers keep working; new
   * bundle products belong in `packagesList`.
   */
  packages: z.record(z.string(), z.number().min(0)).optional(),
});

/** Parsed/normalized doc shape (defaults applied) — the canonical BillingConfig. */
export type BillingConfig = z.infer<typeof BillingConfigSchema>;
/** Accepted write payload shape (defaulted fields optional). */
export type BillingConfigInput = z.input<typeof BillingConfigSchema>;
