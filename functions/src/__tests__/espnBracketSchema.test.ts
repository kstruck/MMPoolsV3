import { describe, it, expect } from "vitest";
import {
    importTournamentFromESPNSchema,
    adminInitTournamentSchema,
    syncBracketTournamentSchema,
    importConferenceTournamentFromESPNSchema,
    syncPlayInPicksSchema,
} from "../schemas/espnBracket";

const okImport = (d: unknown) => importTournamentFromESPNSchema.safeParse(d).success;
const okInit = (d: unknown) => adminInitTournamentSchema.safeParse(d).success;
const okSync = (d: unknown) => syncBracketTournamentSchema.safeParse(d).success;
const okConfImport = (d: unknown) => importConferenceTournamentFromESPNSchema.safeParse(d).success;
const okPlayIn = (d: unknown) => syncPlayInPicksSchema.safeParse(d).success;

describe("importTournamentFromESPNSchema", () => {
    // The exact payload the handler destructures: { tournamentId, seasonYear }.
    it("accepts tournamentId and seasonYear", () => {
        expect(okImport({ tournamentId: "mens-2026", seasonYear: 2026 })).toBe(true);
    });

    it("rejects missing fields, a string seasonYear, and an unknown field", () => {
        expect(okImport({ tournamentId: "mens-2026" })).toBe(false);
        expect(okImport({ tournamentId: "mens-2026", seasonYear: "2026" })).toBe(false);
        expect(okImport({ tournamentId: "mens-2026", seasonYear: 2026, evil: 1 })).toBe(false);
    });
});

describe("adminInitTournamentSchema", () => {
    // The real "Re-Initialize Skeleton" button payload (TournamentManager.tsx):
    // { tournamentId, seasonYear, gender, teams: [], overwrite: true }. The
    // handler never reads `overwrite` — it must still be ACCEPTED or the
    // button breaks (same class as createBracketEntry's tiebreakerScore).
    it("accepts the real re-init button payload including the handler-ignored overwrite flag", () => {
        expect(okInit({ tournamentId: "mens-2026", seasonYear: 2026, gender: "mens", teams: [], overwrite: true })).toBe(true);
    });

    it("accepts a full team list and omitted optional fields", () => {
        expect(okInit({ tournamentId: "mens-2026", seasonYear: 2026, gender: "womens" })).toBe(true);
        expect(okInit({
            tournamentId: "mens-2026",
            seasonYear: 2026,
            gender: "mens",
            teams: [{ id: "t1", name: "Duke", seed: 1, region: "East", logoUrl: "https://x/y.png" }],
        })).toBe(true);
    });

    it("rejects a missing required field, a bad gender, and an unknown top-level field", () => {
        expect(okInit({ tournamentId: "mens-2026", seasonYear: 2026 })).toBe(false);
        expect(okInit({ tournamentId: "mens-2026", seasonYear: 2026, gender: "ADMIN" })).toBe(false);
        expect(okInit({ tournamentId: "mens-2026", seasonYear: 2026, gender: "mens", evil: 1 })).toBe(false);
    });

    it("rejects a malformed team entry", () => {
        expect(okInit({
            tournamentId: "mens-2026",
            seasonYear: 2026,
            gender: "mens",
            teams: [{ id: "t1", name: "Duke", seed: 1 }], // missing region
        })).toBe(false);
    });
});

describe("syncBracketTournamentSchema", () => {
    it("accepts an empty payload (defaults to 'mens-2025' in-handler) and an explicit tournamentId", () => {
        expect(okSync({})).toBe(true);
        expect(okSync({ tournamentId: "mens-2026" })).toBe(true);
    });

    it("rejects an unknown field", () => {
        expect(okSync({ tournamentId: "mens-2026", evil: 1 })).toBe(false);
    });
});

describe("importConferenceTournamentFromESPNSchema", () => {
    // The exact payload TournamentManager.tsx sends for a conference import.
    it("accepts tournamentId, seasonYear, and conferenceName", () => {
        expect(okConfImport({ tournamentId: "bigeast-2026", seasonYear: 2026, conferenceName: "Big East" })).toBe(true);
    });

    it("rejects a missing conferenceName and an unknown field", () => {
        expect(okConfImport({ tournamentId: "bigeast-2026", seasonYear: 2026 })).toBe(false);
        expect(okConfImport({ tournamentId: "bigeast-2026", seasonYear: 2026, conferenceName: "Big East", evil: 1 })).toBe(false);
    });
});

describe("syncPlayInPicksSchema", () => {
    // The exact payload dbService/TournamentManager sends: { tournamentId }.
    it("accepts a tournamentId", () => {
        expect(okPlayIn({ tournamentId: "mens-2026" })).toBe(true);
    });

    it("rejects a missing/empty tournamentId and an unknown field", () => {
        expect(okPlayIn({})).toBe(false);
        expect(okPlayIn({ tournamentId: "" })).toBe(false);
        expect(okPlayIn({ tournamentId: "mens-2026", evil: 1 })).toBe(false);
    });
});
