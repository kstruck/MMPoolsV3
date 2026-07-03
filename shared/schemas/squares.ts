// CreatePoolInput — SQUARES. Server requires name + costPerSquare
// (poolOps.ts:55-66); everything else is optional wizard config.
import { z } from 'zod';
import { contactFieldsSchema, brandingSchema } from './common';

export const squaresCreateInputSchema = contactFieldsSchema.extend({
  type: z.literal('SQUARES').optional(), // createPool defaults a missing type to SQUARES
  name: z.string().trim().min(1, 'Pool name is required.'),
  costPerSquare: z.number().min(0),
  maxSquaresPerPlayer: z.number().int().min(0).optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  gameId: z.string().optional(),
  gameTime: z.number().optional(),
  seasonType: z.enum(['1', '2', '3']).optional(),
  week: z.number().int().optional(),
  numberSets: z.number().int().optional(),
  theme: z.string().optional(),
  branding: brandingSchema.optional(),
});

export type SquaresCreateInput = z.infer<typeof squaresCreateInputSchema>;
