/**
 * Input schemas for the tournament/playoff admin TARGET-NOW callables:
 * updateTournamentData (bracketOps) and updateGlobalPlayoffResults
 * (playoffPools). PURE: zod only, no firebase imports.
 *
 * Both callables previously gated on the MUTABLE users/{uid}.role doc alone
 * (sweep C5); the validated() wrapper upgrades them to claim+doc agreement.
 */

import { z } from "zod";

/**
 * updateTournamentData — SUPER_ADMIN raw merge into tournaments/{id}.
 * tournamentData stays an open record for now: the Tournament shape is large,
 * the merge is Partial<Tournament> by design, and the callable currently has
 * ZERO client callers (admin/ESPN-sync surface). The gate this wave adds is
 * the strict envelope + claim+doc role; content-level modeling is deferred to
 * the sweep pass alongside the other bracket callables.
 */
export const updateTournamentDataSchema = z.strictObject({
    tournamentId: z.string().trim().min(1).max(200),
    tournamentData: z.record(z.string(), z.unknown()),
});

/** One playoff round's winners: ESPN team ids. */
const roundWinners = z.array(z.string().trim().min(1).max(50)).max(40);

/**
 * updateGlobalPlayoffResults — the exact shape PlayoffResultsManager sends
 * (all four rounds always present; save and reset both send the full object).
 * Non-strict object: a legacy key echoed back from the stored doc is stripped,
 * not rejected — only the canonical rounds are persisted.
 */
export const updateGlobalPlayoffResultsSchema = z.strictObject({
    results: z.object({
        WILD_CARD: roundWinners,
        DIVISIONAL: roundWinners,
        CONF_CHAMP: roundWinners,
        SUPER_BOWL: roundWinners,
    }),
});

export type UpdateTournamentDataInput = z.infer<typeof updateTournamentDataSchema>;
export type UpdateGlobalPlayoffResultsInput = z.infer<typeof updateGlobalPlayoffResultsSchema>;
