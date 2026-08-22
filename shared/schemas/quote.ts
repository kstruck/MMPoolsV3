// Canonical contracts for the buy-flow quote + checkout + coupon-reservation
// surface (PLAN-BUYFLOW-OVERHAUL Phases 2/3/5, ADR-0002). Shared by the client
// (@shared/schemas/quote) and Cloud Functions (./shared/schemas/quote via the
// copy-shared mirror) so there is exactly ONE definition of every wire shape
// and NO price math on the client.
//
// The server (getPoolQuote / createCheckoutSession) is the sole price
// authority: the client sends selections (poolType, estimatedPlayers, addon
// booleans, optional couponCode) and renders whatever itemized quote comes
// back. It never computes base price, addon price, discount, or free-tier
// eligibility itself.
import { z } from 'zod';
import { POOL_TYPES } from '../poolTypes';

// --- Unsellable add-ons -------------------------------------------------------
/**
 * Add-ons that exist in the contract but MUST NOT be sold right now
 * (PLAN-COST-CONTROLS 0.5.4). ONE definition, read by both places that have to
 * agree: the schema transform below (so nothing new can be quoted or charged)
 * and the Stripe webhook's in-flight-session clamp (so a session created before
 * this shipped cannot stamp the entitlement either). Adding a key here disables
 * selling it everywhere; removing one re-enables it everywhere.
 */
export const UNSELLABLE_ADDON_KEYS = ['smsNotifications'] as const;

/**
 * Force every unsellable add-on off. Pure. The return type is widened to
 * booleans rather than echoing `T`: this function can turn a `true` into a
 * `false`, so preserving a literal type would let the compiler keep believing a
 * clamped field is still `true`.
 */
export function clampUnsellableAddons<T extends Record<string, boolean>>(
  addons: T,
): { [K in keyof T]: boolean } {
  const out = { ...addons } as { [K in keyof T]: boolean };
  for (const key of UNSELLABLE_ADDON_KEYS) {
    if (key in out) (out as Record<string, boolean>)[key] = false;
  }
  return out;
}

/**
 * The whole in-flight-session decision for the Stripe webhook, as one pure
 * function: what the entitlement map should become, and which unsellable
 * add-ons were actually paid for (empty ⇒ nothing to alert about).
 *
 * Pure and exported so the behaviour is unit-testable. It used to live inline
 * in `finalizePoolPayment`, where the only thing a test could assert was that
 * certain strings appeared in the file — a guard that passes whether or not the
 * code still runs (codex round 3).
 *
 * `paidAddons` is the PAID RECORD (`billing.paid.addons`) and is deliberately
 * returned untouched by the caller: it is evidence of purchase, not a grant.
 */
export function unsellableClampOutcome(
  unlocked: Record<string, boolean>,
  paidAddons: readonly string[] = [],
): { unlocked: Record<string, boolean>; soldWhileOff: string[] } {
  const soldWhileOff = UNSELLABLE_ADDON_KEYS.filter(
    (k) => unlocked[k] === true || paidAddons.includes(k),
  );
  return { unlocked: clampUnsellableAddons(unlocked), soldWhileOff: [...soldWhileOff] };
}

// --- Add-on selection ---------------------------------------------------------
// The four premium features that carry an addonPrice in billing_config. Every
// field is optional+boolean and defaults to false so partial payloads (and the
// server pricing them) are unambiguous. SMS is a first-class add-on here — the
// pre-overhaul BillingInvoiceCard omitted it from the subtotal; that bug dies
// with this contract.
//
// ⚠️ SMS IS NOT SELLABLE (PLAN-COST-CONTROLS 0.5.4; Kevin's D-decision #3,
// 2026-08-22: "SMS is OFF until further notice"). The field stays in the
// contract so existing payloads still validate, but the transform below forces
// it false, which is the ONE choke point both buy paths share (getPoolQuote and
// createCheckoutSession) — so it cannot be priced into a quote (quoteEngine
// iterates ADDON_KEYS) and cannot be stamped into billing.featuresUnlocked
// (stripe.ts reads addons.smsNotifications). Coercing rather than rejecting is
// deliberate: the safe direction is never-charge/never-unlock, and a hard error
// would break a stale client instead of quietly quoting it the truth.
// Pools that ALREADY bought SMS keep their flag — this sells none, revokes none.
// To bring SMS back: delete the transform, and re-add the wizard toggle
// (BillingInvoiceCard removed it on the 2026-07-07 product decision).
export const addonSelectionSchema = z
  .object({
    aiCommissioner: z.boolean().optional().default(false),
    smsNotifications: z.boolean().optional().default(false),
    whatIfSimulator: z.boolean().optional().default(false),
    customBranding: z.boolean().optional().default(false),
  })
  // Full-object factory default so a missing `addons` still yields all-false
  // (Zod v4 requires the resolved output shape here, not `{}`).
  .default(() => ({
    aiCommissioner: false,
    smsNotifications: false,
    whatIfSimulator: false,
    customBranding: false,
  }))
  .transform((a) => clampUnsellableAddons(a));
export type AddonSelection = z.infer<typeof addonSelectionSchema>;
/** The four add-on keys, in canonical order. */
export const ADDON_KEYS = [
  'aiCommissioner',
  'smsNotifications',
  'whatIfSimulator',
  'customBranding',
] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];

// --- getPoolQuote input -------------------------------------------------------
export const poolQuoteInputSchema = z.object({
  // Accept any of the seven live pool formats. Unmapped formats are rejected by
  // the callable (invalid-argument), not here, so the message can name the
  // format.
  poolType: z.enum(POOL_TYPES),
  estimatedPlayers: z.coerce.number().int().min(0),
  addons: addonSelectionSchema,
  couponCode: z.string().trim().min(1).optional(),
});
export type PoolQuoteInput = z.infer<typeof poolQuoteInputSchema>;

// --- getPoolQuote output ------------------------------------------------------
// A single itemized line (add-on). Base price is a separate top-level field.
export interface QuoteLine {
  key: AddonKey;
  label: string;
  amount: number; // dollars
}

// Sanitized coupon state — enough for the UI to explain the discount, nothing
// that leaks other users' usage (per ADR-0002, coupons become admin-read-only
// and the buyer only ever sees this).
export interface CouponQuoteState {
  code: string;
  valid: boolean;
  /** Populated only when !valid — a human-readable reason. */
  reason?: string;
  /** Populated only when valid — e.g. "20% off" or "$10 off". */
  discountLabel?: string;
  discountType?: 'percentage' | 'flat';
  discountValue?: number;
}

export interface PoolQuote {
  poolType: string;
  /** The resolved pricing key (season|bracket|squares|props). */
  pricingKey: string;
  estimatedPlayers: number;
  tier: 'free_tier' | 'standard_tier' | 'premium_tier';
  basePrice: number;
  addonLines: QuoteLine[];
  /** Sum of base + all addon lines, before any coupon. */
  subtotal: number;
  /** Coupon discount actually applied (0 when no/invalid coupon). Clamped so total ≥ 0. */
  discount: number;
  /** subtotal − discount, clamped to ≥ 0. The authoritative amount to charge. */
  total: number;
  /** Present only when a couponCode was supplied. */
  couponState?: CouponQuoteState;
  /**
   * True IFF players ≤ freePlayerThreshold AND total is $0 (i.e. no paid
   * add-on and no residual base). Any paid add-on disqualifies free.
   */
  freeTierEligible: boolean;
  /** Trial length in days (from billing_config) so the UI needn't guess. */
  trialDays: number;
}

// --- createCheckoutSession input (hardened) -----------------------------------
// successUrl/cancelUrl are DELIBERATELY absent: the server derives redirect URLs
// from an allowlisted origin + fixed route templates (open-redirect fix). Any
// client-supplied redirect URL is ignored. Add-on booleans are validated here
// and PRICED SERVER-SIDE — the client price is never trusted.
export const checkoutPoolInputSchema = z.object({
  poolId: z.string().min(1),
  poolName: z.string().min(1),
  poolType: z.enum(POOL_TYPES),
  estimatedPlayers: z.coerce.number().int().min(0),
  addons: addonSelectionSchema,
  couponCode: z.string().trim().min(1).optional(),
  usedCredit: z.boolean().optional().default(false),
  customCreditId: z.string().trim().min(1).optional(),
});
export type CheckoutPoolInput = z.infer<typeof checkoutPoolInputSchema>;

// --- Coupon reservation lifecycle (ADR-0002) ---------------------------------
// A usageLog entry is a two-phase record keyed by a SERVER-generated
// reservationId (Stripe session.id does not exist until after the external API
// call, so it cannot key the reservation). Legacy entries (pre-overhaul) were
// { userId, poolId, usedAt } with no reservationId/status — both shapes coexist
// in Firestore until backfilled; readers treat a missing status as 'confirmed'.
export type CouponReservationStatus = 'pending' | 'confirmed' | 'released';

export interface CouponUsageEntry {
  /** Server-generated id that keys the reservation across reserve→confirm→release. */
  reservationId?: string;
  userId: string;
  poolId: string;
  status?: CouponReservationStatus;
  reservedAt?: number;
  confirmedAt?: number;
  releasedAt?: number;
  /** Stripe session id, stamped at confirm. */
  sessionId?: string;
  /** Legacy field (pre-reservation writes). Kept for back-compat reads. */
  usedAt?: number;
}

/**
 * The pending billable snapshot stored on the reservation/session record (NOT
 * on the live pool doc). On successful payment/redemption the webhook copies it
 * to billing.paid + billing.featuresUnlocked. Cancel/decline leaves the pool
 * untouched.
 */
export interface PendingBillableSnapshot {
  tier: 'standard_tier' | 'premium_tier' | 'free_tier';
  maxPlayersAllowed: number;
  addons: AddonKey[];
}
