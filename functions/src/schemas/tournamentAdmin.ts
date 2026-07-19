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

/**
 * markEntryPaidStatus (bracketOps) — commissioner toggles an entry's paid flag.
 *
 * SWEEP-LATER batch 17. Like updateTournamentData above, this callable has ZERO
 * client callers today (grep of `src/` returns nothing), so the strict envelope
 * cannot break a live payload. The handler's own owner/manager check stays in
 * place — validated()'s `auth: "required"` only establishes that SOMEONE is
 * signed in; the pool-scoped authorisation is not a role and has no wrapper
 * equivalent.
 *
 * poolId/entryId are server-generated document ids, so trimming them is safe
 * (contrast the squares lookup-key regression, #194/#195 — never trim a
 * user-supplied string matched against stored data).
 */
export const markEntryPaidStatusSchema = z.strictObject({
    poolId: z.string().trim().min(1).max(200),
    entryId: z.string().trim().min(1).max(200),
    // The handler does `isPaid ? 'PAID' : 'UNPAID'`, so a missing value would
    // silently mean UNPAID. Required, so the caller must state its intent.
    isPaid: z.boolean(),
});
