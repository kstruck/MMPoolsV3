import { describe, it, expect } from "vitest";
import {
    initializeBigEastTournamentHttpSchema,
    initializeBig12TournamentHttpSchema,
} from "../schemas/conferenceTournaments";

const SCHEMAS = {
    initializeBigEastTournamentHttp: initializeBigEastTournamentHttpSchema,
    initializeBig12TournamentHttp: initializeBig12TournamentHttpSchema,
} as const;

describe.each(Object.entries(SCHEMAS))("%s schema", (_name, schema) => {
    const ok = (d: unknown) => schema.safeParse(d).success;

    // Call site 1: OperationsPanel one-click button sends {} and relies on the
    // handler's built-in default tournament id.
    it("accepts the empty payload the OperationsPanel button sends", () => {
        expect(ok({})).toBe(true);
        expect(ok(null)).toBe(true);
        expect(ok(undefined)).toBe(true);
    });

    // Call site 2: TournamentManager "Re-Initialize Skeleton" sends the full
    // adminInitTournament-shaped payload. seasonYear/gender/teams are dead
    // fields for THESE handlers, but rejecting them would break that button.
    it("accepts the full five-field TournamentManager payload incl. dead fields", () => {
        expect(
            ok({
                tournamentId: "bigeast-2026",
                seasonYear: 2026,
                gender: "mens",
                teams: [],
                overwrite: true,
            }),
        ).toBe(true);
    });

    it("accepts a targeted id and an explicit overwrite", () => {
        expect(ok({ tournamentId: "big12-2026" })).toBe(true);
        expect(ok({ overwrite: false })).toBe(true);
    });

    it("rejects an empty-string id, wrong types, and genuinely unknown fields", () => {
        expect(ok({ tournamentId: "" })).toBe(false);
        expect(ok({ overwrite: "yes" })).toBe(false);
        expect(ok({ gender: "coed" })).toBe(false);
        expect(ok({ tournamentId: "t1", evil: 1 })).toBe(false);
    });
});
