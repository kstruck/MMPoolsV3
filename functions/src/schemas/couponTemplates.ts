/**
 * Input schemas for the couponTemplates TARGET-NOW callables (sweep C6):
 * createCouponTemplate, updateCouponTemplate, mintCouponFromTemplate.
 * PURE: zod + shared couponTemplate schema only, no firebase imports.
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

export type CreateCouponTemplateInput = z.infer<typeof createCouponTemplateSchema>;
export type UpdateCouponTemplateInput = z.infer<typeof updateCouponTemplateSchema>;
export type MintCouponFromTemplateInput = z.infer<typeof mintCouponFromTemplateSchema>;
