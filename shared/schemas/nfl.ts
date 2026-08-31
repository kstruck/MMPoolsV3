// CreatePoolInput — NFL season pools (Pick'em / Survivor / Margin). These go
// through createNFLPool, which requires type + name + season (nflPools.ts:44-52).
// Settings shapes per src/types/nflPoolTypes.ts.
import { z } from 'zod';
import { MAX_TEAM_USES, TIE_COUNTS_AS_VALUES } from '../survivorReuse';
import { WEEKLY_TIEBREAKER_VALUES } from '../nflTiebreaker';
import { hybridSplitProblem } from '../hybridSplit';
import { MAX_ENTRIES_PER_USER_CAP } from '../multiEntry';
import { contactFieldsSchema, brandingSchema, payoutsSchema, weeklyPayoutsSchema } from './common';

const nflBase = contactFieldsSchema.extend({
  name: z.string().trim().min(1, 'Pool name is required.'),
  season: z.union([z.string().trim().min(1), z.number()]),
  // ESPN season type: 1=preseason, 2=regular, 3=postseason. Persisted on the
  // pool; submitNFLPicks and scoreNFLWeek query nfl_games with
  // Number(pool.seasonType || 2), so omitting it means regular season.
  seasonType: z.coerce.number().int().min(1).max(3).optional(),
  branding: brandingSchema.optional(),
  isPublic: z.boolean().optional(),
});

const nflSettingsBase = {
  entryFee: z.number().min(0),
  paymentInstructions: z.string().optional(),
  isListedPublic: z.boolean().optional(),
  payouts: payoutsSchema,
  // PLAN-MULTI-ENTRY D8. Declared HERE because these are z.objects, which STRIP
  // unknown keys — without this line the wizard's choice would be silently
  // dropped at create and every new pool would play single-entry. Raise-only
  // after create (updatePoolSettings), and a client may never write it directly
  // (firestore.rules callableOnlySettingsUnchanged).
  maxEntriesPerUser: z.number().int().min(1).max(MAX_ENTRIES_PER_USER_CAP).default(1),
};

const hybridSplitCoherent = (settings: { payoutMode?: unknown; entryFee?: unknown; hybridSplit?: unknown; weeklyPayouts?: unknown }, ctx: z.RefinementCtx) => {
  const problem = hybridSplitProblem(settings);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ['hybridSplit'] });
  const wp = weeklyPayoutsProblem(settings);
  if (wp) ctx.addIssue({ code: z.ZodIssueCode.custom, message: wp, path: ['weeklyPayouts'] });
};

/** `weeklyPayouts` on a non-HYBRID mode is a stored lie (D1): the same shape of check as the split. Exported for the update gate. */
export const weeklyPayoutsProblem = (settings: { payoutMode?: unknown; weeklyPayouts?: unknown }): string | null => {
  const wp = settings.weeklyPayouts;
  if (wp === undefined || wp === null) return null;
  if (settings.payoutMode !== 'HYBRID') return 'WEEKLY_PAYOUTS_WRONG_MODE: a separate weekly place list only exists on a Hybrid pool.';
  return null;
};

export const pickemCreateInputSchema = nflBase.extend({
  type: z.literal('NFL_PICKEM'),
  settings: z.object({
    ...nflSettingsBase,
    confidenceMode: z.boolean().optional(),
    lockMode: z.enum(['PER_GAME', 'WEEKLY']).optional(),
    lockBufferMinutes: z.number().optional(),
    payoutMode: z.enum(['SEASON', 'WEEKLY', 'HYBRID']).optional(),
    // PLAN-PAYMENT-LEDGER D1/T1: the HYBRID weekly place list — only the two types that carry payoutMode; refused on a non-HYBRID mode by hybridSplitCoherent.
    weeklyPayouts: weeklyPayoutsSchema.optional(),
    pickMode: z.enum(['STRAIGHT', 'ATS']).optional(),
    // This is a z.object, so it STRIPS unknown keys — without this line the
    // wizard's choice would be silently dropped at create and every new pool
    // would play the default. Mandatory, not cosmetic (the same trap the two
    // survivor parity settings document above).
    weeklyTiebreaker: z.enum(WEEKLY_TIEBREAKER_VALUES).optional(),
    // HYBRID entry-fee split (PLAN-HYBRID-SPLIT). Coherence (whole dollars,
    // sums to entryFee, HYBRID only) is the superRefine below — shape here.
    hybridSplit: z.object({
      weeklyPerEntry: z.number().int().min(0),
      seasonPerEntry: z.number().int().min(0),
    }).optional(),
    pointsPerPick: z.number().optional(),
  }).superRefine(hybridSplitCoherent),
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
    // This is a z.object, so it STRIPS unknown keys — without these two lines
    // the wizard's values would be silently dropped at create. Mandatory, not
    // cosmetic (sweep S3).
    tieCountsAs: z.enum(TIE_COUNTS_AS_VALUES).optional(),
    maxTeamUses: z.number().int().min(0).max(MAX_TEAM_USES).optional(),
  }),
});

export const marginCreateInputSchema = nflBase.extend({
  type: z.literal('NFL_MARGIN'),
  settings: z.object({
    ...nflSettingsBase,
    payoutMode: z.enum(['SEASON', 'WEEKLY', 'HYBRID']).optional(),
    // PLAN-PAYMENT-LEDGER D1/T1: the HYBRID weekly place list — only the two types that carry payoutMode; refused on a non-HYBRID mode by hybridSplitCoherent.
    weeklyPayouts: weeklyPayoutsSchema.optional(),
    hybridSplit: z.object({
      weeklyPerEntry: z.number().int().min(0),
      seasonPerEntry: z.number().int().min(0),
    }).optional(),
  }).superRefine(hybridSplitCoherent),
});

export type PickemCreateInput = z.infer<typeof pickemCreateInputSchema>;
export type SurvivorCreateInput = z.infer<typeof survivorCreateInputSchema>;
export type MarginCreateInput = z.infer<typeof marginCreateInputSchema>;
