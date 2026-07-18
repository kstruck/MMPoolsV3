import { describe, it, expect } from "vitest";
import {
    scoreBracketEntriesSchema,
    finalizeTournamentPayoutsSchema,
} from "../schemas/bracketScoring";

const okScore = (d: unknown) => scoreBracketEntriesSchema.safeParse(d).success;
const okFinalize = (d: unknown) => finalizeTournamentPayoutsSchema.safeParse(d).success;

describe("scoreBracketEntriesSchema", () => {
    // Omitting tournamentId is the GLOBAL form (score every pool-linked
    // tournament) — the OperationsPanel button relies on it, so it must parse.
    it("accepts both the targeted and the global form", () => {
        expect(okScore({ tournamentId: "t1" })).toBe(true);
        expect(okScore({})).toBe(true);
    });

    it("accepts a no-arg call (null/undefined) — the httpsCallable(fn)() quirk", () => {
        expect(okScore(null)).toBe(true);
        expect(okScore(undefined)).toBe(true);
    });

    it("rejects an empty-string tournamentId and unknown fields", () => {
        expect(okScore({ tournamentId: "" })).toBe(false);
        expect(okScore({ tournamentId: "t1", force: true })).toBe(false);
    });
});

describe("finalizeTournamentPayoutsSchema", () => {
    // Required here, unlike scoreBracketEntries — the old hand check threw
    // invalid-argument on a missing id.
    it("accepts a tournamentId", () => {
        expect(okFinalize({ tournamentId: "t1" })).toBe(true);
    });

    it("rejects a missing/empty tournamentId and unknown fields", () => {
        expect(okFinalize({})).toBe(false);
        expect(okFinalize({ tournamentId: "" })).toBe(false);
        expect(okFinalize({ tournamentId: "t1", dryRun: true })).toBe(false);
    });
});
