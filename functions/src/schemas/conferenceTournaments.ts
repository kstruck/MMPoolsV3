/**
 * Input schemas for the conferenceTournaments.ts SWEEP-LATER callables:
 * initializeBigEastTournamentHttp, initializeBig12TournamentHttp.
 * PURE: zod only, no firebase imports.
 */

import { z } from "zod";

/**
 * Both callables are reached from TWO call sites that send DIFFERENT payloads:
 *
 *  - OperationsPanel's one-click buttons send `{}` (handler falls back to its
 *    built-in default id, 'bigeast-2026' / 'big12-2026').
 *  - TournamentManager's "Re-Initialize Skeleton" sends the full five-field
 *    payload it uses for adminInitTournament: tournamentId, seasonYear, gender,
 *    teams, overwrite.
 *
 * The handlers only ever read `tournamentId` and `overwrite`. seasonYear /
 * gender / teams are DEAD fields here — but a .strict() schema that omitted
 * them would reject that real button (same class as createBracketEntry's
 * ignored tiebreakerScore and adminInitTournament's ignored overwrite). They
 * are accepted and ignored, deliberately.
 *
 * tournamentId stays optional: the handler's `|| 'bigeast-2026'` default is the
 * documented behavior of the OperationsPanel button.
 */
const conferenceInitShape = {
    tournamentId: z.string().trim().min(1).max(200).optional(),
    overwrite: z.boolean().optional(),
    // --- accepted-but-unread by these handlers (see note above) ---
    seasonYear: z.number().int().min(2000).max(2100).optional(),
    gender: z.enum(["mens", "womens"]).optional(),
    teams: z.array(z.unknown()).max(200).optional(),
} as const;

export const initializeBigEastTournamentHttpSchema = z.preprocess(
    (v) => v ?? {},
    z.strictObject(conferenceInitShape),
);

export const initializeBig12TournamentHttpSchema = z.preprocess(
    (v) => v ?? {},
    z.strictObject(conferenceInitShape),
);

export type InitializeBigEastTournamentHttpInput = z.infer<typeof initializeBigEastTournamentHttpSchema>;
export type InitializeBig12TournamentHttpInput = z.infer<typeof initializeBig12TournamentHttpSchema>;
