// CreatePoolInput — NFL_PLAYOFFS. Goes through createPool with the payload
// built in PlayoffWizard.tsx:355-406. season is not required at create
// (createPool doesn't enforce it; only createNFLPool does).
import { z } from 'zod';
import { contactFieldsSchema, brandingSchema, payoutsSchema, optionalDateMillis } from './common';

export const roundMultipliersSchema = z.object({
  WILD_CARD: z.number(),
  DIVISIONAL: z.number(),
  CONF_CHAMP: z.number(),
  SUPER_BOWL: z.number(),
});

export const playoffCreateInputSchema = contactFieldsSchema.extend({
  type: z.literal('NFL_PLAYOFFS'),
  name: z.string().trim().min(1, 'Pool name is required.'),
  season: z.union([z.string().trim().min(1), z.number()]).optional(),
  settings: z.object({
    entryFee: z.number().min(0),
    paymentInstructions: z.string().optional(),
    isListedPublic: z.boolean().optional(),
    maxEntriesTotal: z.number().int().optional(),
    maxEntriesPerUser: z.number().int().optional(),
    payouts: payoutsSchema,
    scoring: z.object({ roundMultipliers: roundMultipliersSchema }),
  }),
  branding: brandingSchema.optional(),
  isPublic: z.boolean().optional(),
  // <input type="datetime-local"> gives a raw ISO-ish string client-side and
  // an already-converted millis number server-side (via buildPlayoffPayload).
  lockDate: optionalDateMillis,
});

export type PlayoffCreateInput = z.infer<typeof playoffCreateInputSchema>;
