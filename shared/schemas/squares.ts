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
  gameId: z.string().nullish(), // nullable + optional: a squares pool with no game assigned yet sends null
  gameTime: z.number().optional(),
  seasonType: z.enum(['1', '2', '3']).optional(),
  week: z.number().int().optional(),
  // Driven by a <select> in the wizard, so the raw form value is a string
  // ('1'/'4') — coerce rather than a bare z.number(), which would silently
  // fail RHF's full-form submit validation with no visible error.
  numberSets: z.coerce.number().int().optional(),
  theme: z.string().optional(),
  branding: brandingSchema.optional(),
});

export type SquaresCreateInput = z.infer<typeof squaresCreateInputSchema>;
