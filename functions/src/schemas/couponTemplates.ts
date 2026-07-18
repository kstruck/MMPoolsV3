/**
 * Input schemas for the couponTemplates callables: the TARGET-NOW trio
 * (sweep C6) createCouponTemplate, updateCouponTemplate,
 * mintCouponFromTemplate, plus the SWEEP-LATER pair deleteCouponTemplate,
 * acknowledgeMonetizationAlert. PURE: zod + shared couponTemplate schema
 * only, no firebase imports.
 */

import { z } from "zod";
import { couponTemplateInputSchema } from "../shared/schemas/couponTemplate";

const templateId = z.string().trim().min(1).max(200);

/** createCouponTemplate — the template body IS the payload (dbService sends it top-level). */
export const createCouponTemplateSchema = couponTemplateInputSchema;

/**
 * updateCouponTemplate — { templateId, template } as dbService sends it. The
 * old handler also accepted template fields spread at the top level
 * (`?? request.data` fallback); no caller ever used that shape, so the wrapper
 * requires the nested form.
 */
export const updateCouponTemplateSchema = z.strictObject({
    templateId,
    template: couponTemplateInputSchema,
});

/** mintCouponFromTemplate — { templateId, code }; code normalized (UPPER) in the handler. */
export const mintCouponFromTemplateSchema = z.strictObject({
    templateId,
    code: z.string().trim().min(1).max(64),
});

/** deleteCouponTemplate — { templateId }. */
export const deleteCouponTemplateSchema = z.strictObject({
    templateId,
});

/** acknowledgeMonetizationAlert — { alertId, status? }; anything but "open" acks (matches the old hand check). */
export const acknowledgeMonetizationAlertSchema = z.strictObject({
    alertId: z.string().trim().min(1).max(200),
    status: z.enum(["acked", "open"]).optional(),
});

export type CreateCouponTemplateInput = z.infer<typeof createCouponTemplateSchema>;
export type UpdateCouponTemplateInput = z.infer<typeof updateCouponTemplateSchema>;
export type MintCouponFromTemplateInput = z.infer<typeof mintCouponFromTemplateSchema>;
export type DeleteCouponTemplateInput = z.infer<typeof deleteCouponTemplateSchema>;
export type AcknowledgeMonetizationAlertInput = z.infer<typeof acknowledgeMonetizationAlertSchema>;
