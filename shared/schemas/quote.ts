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

// --- Add-on selection ---------------------------------------------------------
// The four premium features that carry an addonPrice in billing_config. Every
// field is optional+boolean and defaults to false so partial payloads (and the
// server pricing them) are unambiguous. SMS is a first-class add-on here — the
// pre-overhaul BillingInvoiceCard omitted it from the subtotal; that bug dies
// with this contract.
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
  }));
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
