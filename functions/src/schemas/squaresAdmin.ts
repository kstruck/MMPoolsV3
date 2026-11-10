/**
 * Input schemas for the squares commissioner callables in
 * functions/src/squaresAdmin.ts. PURE: zod only, no firebase imports.
 */
import { z } from "zod";

const poolId = z.string().trim().min(1).max(200);

// Any finite number: the comparison is with what is STORED, and a score box
// accepts whatever the commissioner typed. A stricter shape here would turn "the
// scores are still saving" into an unreadable validation error.
const periodScore = z.strictObject({
    home: z.number().finite(),
    away: z.number().finite(),
}).nullable();

/**
 * recomputeSquaresWinners — { poolId, expectedScores? }.
 *
 * `expectedScores` is the four quarter scores AS THE COMMISSIONER SEES THEM on
 * the page they pressed the button on (`null` for a quarter with no score).
 * The page saves a typed score and records winners through two separate
 * requests; without this, a press that arrives before the save recorded the
 * winner for the PREVIOUS score and reported success. When present, the handler
 * refuses unless the stored scores are the ones the commissioner was looking
 * at. Optional, so a tab left open across the deploy still works.
 */
export const recomputeSquaresWinnersSchema = z.strictObject({
    poolId,
    expectedScores: z.strictObject({
        q1: periodScore, half: periodScore, q3: periodScore, final: periodScore,
    }).optional(),
});

/** drawSquaresFinalPrize — { poolId }. The draw takes no input a caller could steer. */
export const drawSquaresFinalPrizeSchema = z.strictObject({ poolId });

/** unlockSquaresPool — { poolId }. */
export const unlockSquaresPoolSchema = z.strictObject({ poolId });

export type RecomputeSquaresWinnersInput = z.infer<typeof recomputeSquaresWinnersSchema>;
export type DrawSquaresFinalPrizeInput = z.infer<typeof drawSquaresFinalPrizeSchema>;
export type UnlockSquaresPoolInput = z.infer<typeof unlockSquaresPoolSchema>;
