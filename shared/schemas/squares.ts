// CreatePoolInput — SQUARES. Server requires name + costPerSquare
// (poolOps.ts:55-66); everything else is optional wizard config.
import { z } from 'zod';
import { contactFieldsSchema, brandingSchema } from './common';
import { isFeedLogoUrl } from '../squaresDefaults';

export const squaresCreateInputSchema = contactFieldsSchema.extend({
  type: z.literal('SQUARES').optional(), // createPool defaults a missing type to SQUARES
  name: z.string().trim().min(1, 'Pool name is required.'),
  costPerSquare: z.number().min(0),
  maxSquaresPerPlayer: z.number().int().min(0).optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  // nullable + optional: a squares pool with no game assigned yet sends null
  // (or ''). A linked game's id is the score feed's event id — digits. It is
  // put into the feed's URL every minute, so nothing else is accepted.
  gameId: z.string().regex(/^\d{0,15}$/, 'Not a game from the schedule.').nullish(),
  gameTime: z.number().optional(),
  seasonType: z.enum(['1', '2', '3']).optional(),
  week: z.number().int().optional(),
  // Driven by a <select> in the wizard, so the raw form value is a string
  // ('1'/'4') — coerce rather than a bare z.number(), which would silently
  // fail RHF's full-form submit validation with no visible error.
  numberSets: z.coerce.number().int().optional(),
  theme: z.string().optional(),
  branding: brandingSchema.optional(),
  // Stamped from the chosen game alongside gameId — never typed.
  league: z.enum(['nfl', 'college']).optional(),
  // The feed's own badge URL and nothing else — these are rendered as images
  // on a page every member loads (`isFeedLogoUrl`).
  homeTeamLogo: z.string().refine(isFeedLogoUrl, 'Not a team badge from the score feed.').optional(),
  awayTeamLogo: z.string().refine(isFeedLogoUrl, 'Not a team badge from the score feed.').optional(),
  // How the prize pot is split between the four quarters. Sent as
  // `squaresPayouts` because `payouts` is a server-owned field `createPool`
  // strips from every payload; the server copies this in after this check.
  squaresPayouts: z.object({
    q1: z.number().min(0).max(100),
    half: z.number().min(0).max(100),
    q3: z.number().min(0).max(100),
    final: z.number().min(0).max(100),
  }).refine(
    (p) => Math.abs(p.q1 + p.half + p.q3 + p.final - 100) < 1e-9,
    { message: 'The four quarters must add up to exactly 100%.' },
  ).optional(),
  charity: z.object({
    enabled: z.boolean(),
    name: z.string().trim().max(120).optional(),
    percentage: z.number().min(0).max(100),
  }).optional(),
  ruleVariations: z.object({
    reverseWinners: z.boolean().optional(),
    quarterlyRollover: z.boolean().optional(),
    unclaimedFinalPrizeStrategy: z.enum(['last_winner', 'random']).optional(),
  }).optional(),
});

export type SquaresCreateInput = z.infer<typeof squaresCreateInputSchema>;
