// Pure pricing/quote engine — the single price authority behind getPoolQuote
// and createCheckoutSession (PLAN Phase 2). NO Firebase imports: everything here
// is a pure function over an already-loaded BillingConfig + inputs, so it is
// exhaustively unit-testable and shared by the quote callable, the checkout
// callable, and the tests.
//
// Rules enforced:
//   - format → pricing key via formatTierMap (unmapped format throws)
//   - base price from the resolved tier band by player count
//   - each selected add-on priced from features[key].addonPrice (INCLUDING
//     smsNotifications — the pre-overhaul client omitted SMS; that bug dies here)
//   - coupon discount (percentage|flat), clamped so total ≥ $0
//   - freeTierEligible = players ≤ freePlayerThreshold AND total is $0
import type { BillingConfig } from "../shared/schemas/billingConfig";
import type {
  AddonKey,
  AddonSelection,
  CouponQuoteState,
  PoolQuote,
  QuoteLine,
} from "../shared/schemas/quote";
import { ADDON_KEYS, isIncludedAddon } from "../shared/schemas/quote";

/** A coupon as needed by the quote engine (subset of the stored Coupon doc). */
export interface QuoteCoupon {
  code: string;
  discountType: "percentage" | "flat";
  discountValue: number;
}

const ADDON_LABELS: Record<AddonKey, string> = {
  aiCommissioner: "AI Commissioner",
  smsNotifications: "SMS Notifications",
  whatIfSimulator: "What-If Simulator",
  customBranding: "Custom Branding",
};

/** Maps a feature add-on key to the billing_config.features field key. Identity today. */
type FeatureConfigKey = keyof BillingConfig["features"];
const ADDON_TO_FEATURE: Record<AddonKey, FeatureConfigKey> = {
  aiCommissioner: "aiCommissioner",
  smsNotifications: "smsNotifications",
  whatIfSimulator: "whatIfSimulator",
  customBranding: "customBranding",
};

/**
 * Resolves a pool format to its pricing key via formatTierMap. THROWS a plain
 * Error (callable wraps it as invalid-argument) when the format is unmapped —
 * an unmapped format must never silently price at $0.
 */
export function resolvePricingKey(
  config: Pick<BillingConfig, "formatTierMap">,
  poolType: string
): "season" | "bracket" | "squares" | "props" {
  const map = config.formatTierMap as Record<string, string> | undefined;
  const key = map?.[poolType];
  if (!key) {
    throw new Error(`No pricing tier mapping for pool format "${poolType}".`);
  }
  return key as "season" | "bracket" | "squares" | "props";
}

/** Base hosting price for a player count under the resolved pricing key. */
export function computeBasePrice(
  config: Pick<BillingConfig, "freePlayerThreshold" | "pricing" | "formatTierMap">,
  poolType: string,
  estimatedPlayers: number
): { basePrice: number; pricingKey: string } {
  const pricingKey = resolvePricingKey(config, poolType);
  const players = Number(estimatedPlayers) || 0;

  // At/under the free threshold the base hosting fee is $0 (add-ons still priced).
  if (players <= config.freePlayerThreshold) {
    return { basePrice: 0, pricingKey };
  }

  const tiers = (config.pricing as Record<string, Array<{ min: number; max: number; price: number }>>)[pricingKey] || [];
  const matched = tiers.find((t) => players >= t.min && players <= t.max);
  if (matched) return { basePrice: matched.price, pricingKey };

  // Above the top band: charge the highest tier (defensive; contiguous bands
  // should always match, but a player count beyond the last max lands here).
  if (tiers.length > 0) {
    const top = [...tiers].sort((a, b) => b.min - a.min)[0];
    return { basePrice: top.price, pricingKey };
  }
  // No tiers configured for this format at a chargeable size (players are above
  // the free threshold — the <=threshold case returned $0 earlier). This means
  // the billing config is missing or malformed. NEVER silently price a paid-size
  // pool at $0 (that would let it activate for free); fail loudly so getPoolQuote
  // and createCheckoutSession surface "pricing unavailable" instead. Pool CREATION
  // is unaffected — computeLaunchMode does not call this.
  throw new Error(
    `PRICING_NOT_CONFIGURED: no pricing tiers for "${pricingKey}" (format "${poolType}"). ` +
    `settings/billing_config is missing or malformed — re-save it from the Super-Admin Billing panel.`
  );
}

/** Priced add-on lines for the selected add-ons (only premium+priced features add a line). */
export function computeAddonLines(
  config: Pick<BillingConfig, "features">,
  addons: AddonSelection
): QuoteLine[] {
  const lines: QuoteLine[] = [];
  for (const key of ADDON_KEYS) {
    if (!addons[key]) continue;
    // Included with every pool — never priced, whatever the config says and
    // whatever a stale client sends (T4/D1, codex r1 [P1]). This is the choke
    // point both getPoolQuote and createCheckoutSession price through, so a
    // skip here is a skip everywhere.
    if (isIncludedAddon(key)) continue;
    const feat = config.features[ADDON_TO_FEATURE[key]];
    // Missing feature config or non-premium/zero-price → no charge, no line.
    if (!feat || !feat.isPremium || !(feat.addonPrice > 0)) continue;
    lines.push({ key, label: ADDON_LABELS[key], amount: feat.addonPrice });
  }
  return lines;
}

/** Applies a coupon discount to a subtotal, clamped so the result is ≥ $0. */
export function applyCouponDiscount(
  subtotal: number,
  discountType: "percentage" | "flat",
  discountValue: number
): number {
  let discounted: number;
  if (discountType === "percentage") {
    discounted = subtotal * (1 - discountValue / 100);
  } else {
    discounted = subtotal - discountValue;
  }
  return Math.max(0, discounted);
}

/** Human-readable label for a coupon discount, e.g. "20% off" / "$10 off". */
export function discountLabel(
  discountType: "percentage" | "flat",
  discountValue: number
): string {
  return discountType === "percentage" ? `${discountValue}% off` : `$${discountValue} off`;
}

/**
 * The full itemized quote. Pure: `config` is already loaded/parsed, `coupon` is
 * the already-validated coupon doc (or a couponState carrying an invalid
 * reason). Base price, add-on prices, discount, total and free-tier eligibility
 * are ALL computed here — the client renders this verbatim.
 */
export function computeQuote(args: {
  config: BillingConfig;
  poolType: string;
  estimatedPlayers: number;
  addons: AddonSelection;
  /** A validated coupon (valid) or a reason (invalid) or undefined (none supplied). */
  couponState?: CouponQuoteState;
  coupon?: QuoteCoupon;
}): PoolQuote {
  const { config, poolType, estimatedPlayers, addons } = args;
  const { basePrice, pricingKey } = computeBasePrice(config, poolType, estimatedPlayers);
  const addonLines = computeAddonLines(config, addons);
  const subtotal = basePrice + addonLines.reduce((s, l) => s + l.amount, 0);

  let discount = 0;
  let total = subtotal;
  if (args.couponState?.valid && args.coupon) {
    total = applyCouponDiscount(subtotal, args.coupon.discountType, args.coupon.discountValue);
    discount = Math.max(0, subtotal - total);
  }

  const players = Number(estimatedPlayers) || 0;
  const freeTierEligible = players <= config.freePlayerThreshold && total === 0;

  // Tier classification: free when eligible; otherwise premium if any add-on is
  // charged, else standard. (The webhook stamps the concrete tier from the
  // pending snapshot; this is the display/quote classification.)
  const tier: PoolQuote["tier"] = freeTierEligible
    ? "free_tier"
    : addonLines.length > 0
      ? "premium_tier"
      : "standard_tier";

  return {
    poolType,
    pricingKey,
    estimatedPlayers: players,
    tier,
    basePrice,
    addonLines,
    subtotal,
    discount,
    total,
    couponState: args.couponState,
    freeTierEligible,
    trialDays: config.trialDays,
  };
}

/** The list of add-on keys that ended up priced (for the pending billable snapshot). */
export function pricedAddonKeys(lines: QuoteLine[]): AddonKey[] {
  return lines.map((l) => l.key);
}
