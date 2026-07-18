import { describe, it, expect } from "vitest";
import { updatePlayerSchema, releaseSquaresSchema } from "../schemas/squares";

const okUpdate = (d: unknown) => updatePlayerSchema.safeParse(d).success;
const okRelease = (d: unknown) => releaseSquaresSchema.safeParse(d).success;

describe("updatePlayerSchema", () => {
    // AdminPanel always sends the full details object via dbService.updatePlayer.
    it("accepts the full four-field details payload the AdminPanel sends", () => {
        expect(
            okUpdate({
                poolId: "p1",
                originalName: "Alice",
                details: { name: "Alice B", email: "a@b.com", phone: "555", notes: "vip" },
            }),
        ).toBe(true);
    });

    // Clearing a field in that form sends "" — a .min(1) would reject a
    // legitimate "remove my phone number" edit.
    it("accepts empty-string detail fields (clearing a value)", () => {
        expect(
            okUpdate({
                poolId: "p1",
                originalName: "Alice",
                details: { name: "Alice", email: "", phone: "", notes: "" },
            }),
        ).toBe(true);
    });

    it("accepts a partial details object", () => {
        expect(okUpdate({ poolId: "p1", originalName: "Alice", details: {} })).toBe(true);
    });

    it("rejects missing required fields and unknown keys", () => {
        expect(okUpdate({ poolId: "p1", originalName: "Alice" })).toBe(false);
        expect(okUpdate({ poolId: "p1", details: {} })).toBe(false);
        expect(okUpdate({ poolId: "p1", originalName: "", details: {} })).toBe(false);
        expect(
            okUpdate({ poolId: "p1", originalName: "A", details: { name: "x" }, evil: 1 }),
        ).toBe(false);
        expect(
            okUpdate({ poolId: "p1", originalName: "A", details: { nickname: "x" } }),
        ).toBe(false);
    });
});

describe("releaseSquaresSchema", () => {
    // dbService.releaseSquares spreads { squareIds? , ownerName? } onto poolId.
    it("accepts either selector", () => {
        expect(okRelease({ poolId: "p1", squareIds: [1, 2, 3] })).toBe(true);
        expect(okRelease({ poolId: "p1", ownerName: "Alice" })).toBe(true);
    });

    // An empty array counts as "provided" — the old hand check tested
    // Array.isArray, not length, and the handler returns [] for it.
    it("accepts an empty squareIds array, matching the old hand check", () => {
        expect(okRelease({ poolId: "p1", squareIds: [] })).toBe(true);
    });

    it("rejects a payload with neither selector", () => {
        expect(okRelease({ poolId: "p1" })).toBe(false);
        expect(okRelease({ poolId: "p1", ownerName: "" })).toBe(false);
    });

    it("rejects wrong types and unknown fields", () => {
        expect(okRelease({ poolId: "p1", squareIds: ["1"] })).toBe(false);
        expect(okRelease({ poolId: "p1", squareIds: [1.5] })).toBe(false);
        expect(okRelease({ poolId: "p1", squareIds: [1], force: true })).toBe(false);
    });
});
