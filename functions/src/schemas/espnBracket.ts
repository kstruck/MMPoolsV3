/**
 * Input schemas for the espnBracket.ts SWEEP-LATER callables:
 * importTournamentFromESPN, adminInitTournament, syncBracketTournament,
 * importConferenceTournamentFromESPN, syncPlayInPicks. PURE: zod only, no
 * firebase imports.
 */

import { z } from "zod";

const tournamentId = z.string().trim().min(1).max(200);
const seasonYear = z.number().int().min(2000).max(2100);

/** importTournamentFromESPN — { tournamentId, seasonYear }. */
export const importTournamentFromESPNSchema = z.strictObject({
    tournamentId,
    seasonYear,
});

const teamSchema = z.strictObject({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    seed: z.number().int().min(1).max(16),
    region: z.string().trim().min(1).max(100),
    logoUrl: z.string().trim().max(2000).optional(),
});

/**
 * adminInitTournament — { tournamentId, seasonYear, gender, teams? }. The
 * "Re-Initialize Skeleton" button also sends `overwrite: true` — the handler
 * never reads it (dead field, same class as createBracketEntry's
 * tiebreakerScore), but a `.strict()` schema must still accept it or that
 * real button breaks.
 */
export const adminInitTournamentSchema = z.strictObject({
    tournamentId,
    seasonYear,
    gender: z.enum(["mens", "womens"]),
    teams: z.array(teamSchema).max(200).optional(),
    overwrite: z.boolean().optional(),
});

/** syncBracketTournament — { tournamentId? }; defaults to 'mens-2025' in-handler. */
export const syncBracketTournamentSchema = z.strictObject({
    tournamentId: tournamentId.optional(),
});

/** importConferenceTournamentFromESPN — { tournamentId, seasonYear, conferenceName }. */
export const importConferenceTournamentFromESPNSchema = z.strictObject({
    tournamentId,
    seasonYear,
    conferenceName: z.string().trim().min(1).max(100),
});

/** syncPlayInPicks — { tournamentId }. */
export const syncPlayInPicksSchema = z.strictObject({
    tournamentId,
});

export type ImportTournamentFromESPNInput = z.infer<typeof importTournamentFromESPNSchema>;
export type AdminInitTournamentInput = z.infer<typeof adminInitTournamentSchema>;
export type SyncBracketTournamentInput = z.infer<typeof syncBracketTournamentSchema>;
export type ImportConferenceTournamentFromESPNInput = z.infer<typeof importConferenceTournamentFromESPNSchema>;
export type SyncPlayInPicksInput = z.infer<typeof syncPlayInPicksSchema>;
