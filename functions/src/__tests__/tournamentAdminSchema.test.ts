import { describe, it, expect } from "vitest";
import { updateTournamentDataSchema, updateGlobalPlayoffResultsSchema } from "../schemas/tournamentAdmin";

const okTourn = (d: unknown) => updateTournamentDataSchema.safeParse(d).success;
const okResults = (d: unknown) => updateGlobalPlayoffResultsSchema.safeParse(d).success;

describe("updateTournamentDataSchema", () => {
    it("accepts a partial tournament merge", () => {
        expect(okTourn({ tournamentId: "mens-2026", tournamentData: { isFinalized: true } })).toBe(true);
    });

    it("rejects a missing/empty tournamentId, non-object data, unknown envelope field", () => {
        expect(okTourn({ tournamentData: {} })).toBe(false);
        expect(okTourn({ tournamentId: " ", tournamentData: {} })).toBe(false);
        expect(okTourn({ tournamentId: "mens-2026", tournamentData: "nope" })).toBe(false);
        expect(okTourn({ tournamentId: "mens-2026", tournamentData: {}, extra: 1 })).toBe(false);
    });
});

// The exact payload PlayoffResultsManager sends — all four rounds, save and reset.
const results = {
    WILD_CARD: ["KC", "BUF"],
    DIVISIONAL: [],
    CONF_CHAMP: [],
    SUPER_BOWL: [],
};

describe("updateGlobalPlayoffResultsSchema", () => {
    it("accepts the real save + reset payloads", () => {
        expect(okResults({ results })).toBe(true);
        expect(okResults({ results: { WILD_CARD: [], DIVISIONAL: [], CONF_CHAMP: [], SUPER_BOWL: [] } })).toBe(true);
    });

    it("strips a legacy key echoed back from the stored doc (not rejected)", () => {
        const r = updateGlobalPlayoffResultsSchema.safeParse({ results: { ...results, LEGACY_ROUND: ["X"] } });
        expect(r.success).toBe(true);
        if (r.success) expect("LEGACY_ROUND" in r.data.results).toBe(false);
    });

    it("rejects a missing round key and non-string winners", () => {
        const { SUPER_BOWL: _s, ...missing } = results;
        expect(okResults({ results: missing })).toBe(false);
        expect(okResults({ results: { ...results, WILD_CARD: [1] } })).toBe(false);
    });

    it("rejects missing results (old code threw)", () => {
        expect(okResults({})).toBe(false);
    });
});
