/**
 * Input schemas for the squares commissioner callables in
 * functions/src/squaresAdmin.ts. PURE: zod only, no firebase imports.
 */
import { z } from "zod";

const poolId = z.string().trim().min(1).max(200);

/** recomputeSquaresWinners — { poolId }. */
export const recomputeSquaresWinnersSchema = z.strictObject({ poolId });

/** drawSquaresFinalPrize — { poolId }. The draw takes no input a caller could steer. */
export const drawSquaresFinalPrizeSchema = z.strictObject({ poolId });

/** unlockSquaresPool — { poolId }. */
export const unlockSquaresPoolSchema = z.strictObject({ poolId });

export type RecomputeSquaresWinnersInput = z.infer<typeof recomputeSquaresWinnersSchema>;
export type DrawSquaresFinalPrizeInput = z.infer<typeof drawSquaresFinalPrizeSchema>;
export type UnlockSquaresPoolInput = z.infer<typeof unlockSquaresPoolSchema>;
