// Coupon Template (PLAN-BUYFLOW-OVERHAUL Phase 6 #23) — a saved, reusable Coupon
// DEFINITION from which a Super Admin mints real Coupons. A template is never
// itself redeemable: it carries the coupon's discount shape + constraints, but
// NONE of the per-instance identity/counters (code, usesCount, usageLog,
// createdAt-of-the-live-coupon). See CONTEXT.md "Coupon Template".
//
// Firestore layout:
//   couponTemplates/{templateId}
//
// Rules (Wave 5 owns firestore.rules): SUPER_ADMIN direct client READ (powers
// the Monetization tab template list); ALL writes functions-only (via the
// createCouponTemplate / updateCouponTemplate / deleteCouponTemplate callables).
//
// Shared by the client (@shared/schemas/couponTemplate) and Cloud Functions
// (./shared/schemas/couponTemplate via the copy-shared mirror) so there is
// exactly ONE definition of the template wire shape.
import { z } from 'zod';
import { POOL_TYPES } from '../poolTypes';

// --- Discount shape (mirrors the Coupon discount fields) ----------------------

export const couponDiscountTypeSchema = z.enum(['percentage', 'flat']);
export type CouponDiscountType = z.infer<typeof couponDiscountTypeSchema>;

/**
 * The reusable coupon body a template stores. This is the Coupon shape MINUS
 * `code`, `usesCount`, `usageLog`, `id`, and `createdAt` (those are minted
 * fresh per real coupon). `isActive` is kept so a template can pre-set whether
 * minted coupons start enabled.
 */
export const couponTemplateBodySchema = z.object({
  discountType: couponDiscountTypeSchema,
  /** Percentage points (1..100) when 'percentage'; dollars (>0) when 'flat'. */
  discountValue: z.number().positive(),
  isActive: z.boolean().default(true),
  /** Global cap on confirmed+pending uses of a minted coupon (omit = unlimited). */
  maxUses: z.number().int().positive().optional(),
  /** ms since epoch; omit = never expires. */
  expiresAt: z.number().int().positive().optional(),
  /** Max uses per unique commissioner (omit = no per-user cap). */
  perUserLimit: z.number().int().positive().optional(),
  /** Restrict minted coupons to these pool formats (empty/omit = all). */
  allowedPoolTypes: z.array(z.enum(POOL_TYPES)).optional(),
});
export type CouponTemplateBody = z.infer<typeof couponTemplateBodySchema>;

// --- Template doc -------------------------------------------------------------

/**
 * couponTemplates/{templateId}. `name` is required (the human label in the tab
 * list, e.g. "Black Friday"); `notes` is free-form admin memo. `createdAt` is
 * the template's own creation time (ms), distinct from any minted coupon's.
 */
export const couponTemplateDocSchema = couponTemplateBodySchema.extend({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative().optional(),
});
export type CouponTemplateDoc = z.infer<typeof couponTemplateDocSchema>;

/**
 * The create/update payload accepted by the callables. `createdAt`/`updatedAt`
 * are server-stamped (never trusted from the client), so they are omitted here.
 */
export const couponTemplateInputSchema = couponTemplateBodySchema.extend({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
});
export type CouponTemplateInput = z.infer<typeof couponTemplateInputSchema>;

/**
 * Build a real coupon's field set from a template body (PLAN #23
 * "mint from template"). Pure — the callable stamps `code`/`createdAt`/counters
 * around this. Returns only the constraint fields that are actually present so
 * we never write `undefined` into Firestore.
 */
export function couponFieldsFromTemplate(
  body: CouponTemplateBody
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    discountType: body.discountType,
    discountValue: body.discountValue,
    isActive: body.isActive,
  };
  if (typeof body.maxUses === 'number') out.maxUses = body.maxUses;
  if (typeof body.expiresAt === 'number') out.expiresAt = body.expiresAt;
  if (typeof body.perUserLimit === 'number') out.perUserLimit = body.perUserLimit;
  if (Array.isArray(body.allowedPoolTypes) && body.allowedPoolTypes.length > 0) {
    out.allowedPoolTypes = body.allowedPoolTypes;
  }
  return out;
}
