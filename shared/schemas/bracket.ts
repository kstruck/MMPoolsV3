// Reference CreatePoolInput schema — BRACKET. Its create payload is small and
// fully known (createBracketPool consumes name/settings/seasonYear/gender/
// tournamentType; BracketWizard sends exactly those). This is the pattern the
// remaining type schemas follow once their wizard payloads are captured.
import { z } from 'zod';
import { payoutsSchema, paymentHandlesSchema } from './common';

export const bracketScoringSystemSchema = z.enum(['CLASSIC', 'UPSET', 'CUSTOM']);

// All settings sub-fields are optional: createBracketPool applies defaults for
// any that are missing (bracketPools.ts:70-87).
export const bracketSettingsSchema = z.object({
  maxEntriesTotal: z.number().int().optional(),
  maxEntriesPerUser: z.number().int().optional(),
  entryFee: z.number().min(0).optional(),
  paymentInstructions: z.string().optional(),
  paymentHandles: paymentHandlesSchema.optional(),
  scoringSystem: bracketScoringSystemSchema.optional(),
  customScoring: z.unknown().nullable().optional(),
  tieBreakers: z
    .object({
      closestAbsolute: z.boolean().optional(),
      closestUnder: z.boolean().optional(),
    })
    .optional(),
  payouts: payoutsSchema.optional(),
});

export const bracketCreateInputSchema = z.object({
  type: z.literal('BRACKET').optional(),
  name: z.string().trim().min(1, 'Pool name is required.'),
  // seasonYear is checked with a truthiness guard server-side; accept the
  // year as number or non-empty string to match both wizard and callable.
  seasonYear: z.union([z.number().int(), z.string().trim().min(1)]),
  gender: z.enum(['mens', 'womens']).optional(),
  tournamentType: z.enum(['ncaa', 'bigeast', 'big12']).optional(),
  settings: bracketSettingsSchema.optional(),
});

export type BracketCreateInput = z.infer<typeof bracketCreateInputSchema>;
