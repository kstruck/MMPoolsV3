import { describe, it, expect } from "vitest";
import {
    joinNFLPoolSchema,
    executeSurvivorRebuySchema,
    scoreNFLWeekSchema,
} from "../schemas/nflPools";

const okJoin = (d: unknown) => joinNFLPoolSchema.safeParse(d).success;
const okRebuy = (d: unknown) => executeSurvivorRebuySchema.safeParse(d).success;
const okScore = (d: unknown) => scoreNFLWeekSchema.safeParse(d).success;

describe("joinNFLPoolSchema", () => {
    // The exact payload dbService.joinNFLPool sends: { poolId }.
    it("accepts a poolId", () => {
        expect(okJoin({ poolId: "p1" })).toBe(true);
    });

    it("rejects a missing/empty poolId and an unknown field", () => {
        expect(okJoin({})).toBe(false);
        expect(okJoin({ poolId: "" })).toBe(false);
        expect(okJoin({ poolId: "p1", evil: 1 })).toBe(false);
    });
});

describe("executeSurvivorRebuySchema", () => {
    // The exact payload dbService.executeSurvivorRebuy sends: { poolId, week }.
    it("accepts poolId and week", () => {
        expect(okRebuy({ poolId: "p1", week: 5 })).toBe(true);
    });

    it("rejects missing/invalid week and unknown fields", () => {
        expect(okRebuy({ poolId: "p1" })).toBe(false);
        expect(okRebuy({ poolId: "p1", week: 0 })).toBe(false);
        expect(okRebuy({ poolId: "p1", week: 24 })).toBe(false);
        expect(okRebuy({ poolId: "p1", week: "5" })).toBe(false);
        expect(okRebuy({ poolId: "p1", week: 5, extra: true })).toBe(false);
    });
});

describe("scoreNFLWeekSchema", () => {
    // The exact payload dbService.scoreNFLWeek sends: { poolId, week }.
    it("accepts poolId and week", () => {
        expect(okScore({ poolId: "p1", week: 1 })).toBe(true);
        expect(okScore({ poolId: "p1", week: 23 })).toBe(true);
    });

    it("rejects missing/invalid week and unknown fields", () => {
        expect(okScore({ poolId: "p1" })).toBe(false);
        expect(okScore({ poolId: "p1", week: 0 })).toBe(false);
        expect(okScore({ poolId: "p1", week: 5, force: true })).toBe(false);
    });
});
