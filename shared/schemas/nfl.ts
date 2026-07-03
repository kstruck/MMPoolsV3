// CreatePoolInput — NFL season pools (Pick'em / Survivor / Margin). These go
// through createNFLPool, which requires type + name + season (nflPools.ts:44-52).
// Settings shapes per src/types/nflPoolTypes.ts.
import { z } from 'zod';
import { contactFieldsSchema, brandingSchema, payoutsSchema } from './common';

const nflBase = contactFieldsSchema.extend({
  name: z.string().trim().min(1, 'Pool name is required.'),
  season: z.union([z.string().trim().min(1), z.number()]),
  branding: brandingSchema.optional(),
  isPublic: z.boolean().optional(),
});

const nflSettingsBase = {
  entryFee: z.number().min(0),
  paymentInstructions: z.string().optional(),
  isListedPublic: z.boolean().optional(),
  payouts: payoutsSchema,
};

export const pickemCreateInputSchema = nflBase.extend({
  type: z.literal('NFL_PICKEM'),
  settings: z.object({
    ...nflSettingsBase,
    confidenceMode: z.boolean().optional(),
    lockMode: z.enum(['PER_GAME', 'WEEKLY']).optional(),
    lockBufferMinutes: z.number().optional(),
    payoutMode: z.enum(['SEASON', 'WEEKLY', 'HYBRID']).optional(),
    pickMode: z.enum(['STRAIGHT', 'ATS']).optional(),
    pointsPerPick: z.number().optional(),
  }),
});

export const survivorCreateInputSchema = nflBase.extend({
  type: z.literal('NFL_SURVIVOR'),
  settings: z.object({
    ...nflSettingsBase,
    maxStrikes: z.number().int().min(0),
    maxRebuys: z.number().int().min(0),
    rebuyDeadlineWeek: z.number().int().optional(),
    rebuyCost: z.number().min(0).optional(),
    pickLosersMode: z.boolean().optional(),
    autoSurviveExemptionEnabled: z.boolean().optional(),
  }),
});

export const marginCreateInputSchema = nflBase.extend({
  type: z.literal('NFL_MARGIN'),
  settings: z.object({
    ...nflSettingsBase,
    payoutMode: z.enum(['SEASON', 'WEEKLY', 'HYBRID']).optional(),
  }),
});

export type PickemCreateInput = z.infer<typeof pickemCreateInputSchema>;
export type SurvivorCreateInput = z.infer<typeof survivorCreateInputSchema>;
export type MarginCreateInput = z.infer<typeof marginCreateInputSchema>;
