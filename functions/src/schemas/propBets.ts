/**
 * Input schemas for the propBets.ts SWEEP-LATER callables: gradeProp,
 * updatePropCard. PURE: zod only, no firebase imports.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";

const poolId = z.string().trim().min(1).max(200);

/**
 * gradeProp — { poolId, questionId, correctOptionIndex }, exactly what
 * dbService.gradeProp sends. questionId is matched with === against
 * pool.props.questions[].id, so it is a LOOKUP KEY and must NOT be trimmed
 * (see PICKUP-CALLABLE-SWEEP.md; a trimmed key silently fails to find the
 * question and throws not-found).
 */
export const gradePropSchema = z.strictObject({
    poolId,
    questionId: z.string().min(1).max(100),
    correctOptionIndex: z.number().int().min(0).max(1000),
});

/**
 * updatePropCard — { poolId, cardId, answers, tiebreakerVal?, cardName? }.
 *
 * NOTE: this callable currently has NO frontend caller. Every FE path
 * (PropCardForm, AdminPanel) goes through dbService.updatePropCard, which
 * writes pools/{id}/propCards/{cardId} DIRECTLY with updateDoc rather than
 * invoking this function. Those raw client writes are a known gap parked for
 * the firestore.rules write-path sweep, NOT this one. The schema is therefore
 * pinned to the handler's own destructuring and the shape it writes.
 *
 * `answers` mirrors purchasePropCardSchema exactly — same field, same doc.
 * `tiebreakerVal` accepts a number or a numeric string because the handler
 * coerces with Number(); both fall back to the stored value when absent.
 */
export const updatePropCardSchema = z.strictObject({
    poolId,
    cardId: z.string().min(1).max(200),
    answers: z
        .record(z.string().min(1).max(100), z.number().int().min(0).max(1000))
        .refine((o) => Object.keys(o).length <= 200, { message: "too many answers" }),
    tiebreakerVal: nullish(z.union([z.number().finite(), z.string().max(50)])),
    cardName: nullish(z.string().max(200)),
});

export type GradePropInput = z.infer<typeof gradePropSchema>;
export type UpdatePropCardInput = z.infer<typeof updatePropCardSchema>;
