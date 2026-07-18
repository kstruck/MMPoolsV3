/**
 * Input schemas for the bracketScoring.ts SWEEP-LATER callables:
 * scoreBracketEntries, finalizeTournamentPayouts.
 * PURE: zod only, no firebase imports.
 */

import { z } from "zod";

const tournamentId = z.string().trim().min(1).max(200);

/**
 * scoreBracketEntries (SUPER_ADMIN) — tournamentId is OPTIONAL and the omission
 * is meaningful, not a mistake: with an id it scores that tournament, without
 * one it scores every tournament linked to a BRACKET pool. The OperationsPanel
 * "Score Bracket Entries" button deliberately calls it with no id (the global
 * form). Keeps the null->{} preprocess so a bare no-arg call still parses.
 */
export const scoreBracketEntriesSchema = z.preprocess(
    (v) => v ?? {},
    z.strictObject({
        tournamentId: tournamentId.optional(),
    }),
);

/** finalizeTournamentPayouts (SUPER_ADMIN) — { tournamentId }, required. */
export const finalizeTournamentPayoutsSchema = z.strictObject({
    tournamentId,
});

export type ScoreBracketEntriesInput = z.infer<typeof scoreBracketEntriesSchema>;
export type FinalizeTournamentPayoutsInput = z.infer<typeof finalizeTournamentPayoutsSchema>;
