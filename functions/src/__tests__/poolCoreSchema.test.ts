import { describe, it, expect } from "vitest";
import {
    createPoolPermissiveSchema,
    updatePoolSettingsSchema,
    submitNFLPicksSchema,
} from "../schemas/poolCore";

describe("createPoolPermissiveSchema (ADR-0001 permissive envelope)", () => {
    it("accepts any object payload (field-level work stays in the handler)", () => {
        expect(createPoolPermissiveSchema.safeParse({ name: "My Pool", type: "SQUARES", costPerSquare: 5 }).success).toBe(true);
        expect(createPoolPermissiveSchema.safeParse({}).success).toBe(true);
    });
    it("rejects non-object payloads", () => {
        expect(createPoolPermissiveSchema.safeParse("pool").success).toBe(false);
        expect(createPoolPermissiveSchema.safeParse(null).success).toBe(false);
    });
});

describe("updatePoolSettingsSchema", () => {
    it("accepts the real { poolId, updates } payload", () => {
        expect(updatePoolSettingsSchema.safeParse({ poolId: "p1", updates: { "settings.entryFee": 10 } }).success).toBe(true);
    });
    it("rejects missing/array updates (old hand checks) and unknown envelope fields", () => {
        expect(updatePoolSettingsSchema.safeParse({ poolId: "p1" }).success).toBe(false);
        expect(updatePoolSettingsSchema.safeParse({ poolId: "p1", updates: [] }).success).toBe(false);
        expect(updatePoolSettingsSchema.safeParse({ poolId: "p1", updates: {}, force: 1 }).success).toBe(false);
    });
});

describe("submitNFLPicksSchema", () => {
    // The exact dbService payload.
    const submit = {
        poolId: "p1",
        week: 5,
        picks: { g1: "KC", g2: "BUF" },
        confidence: { g1: 16, g2: 15 },
        tiebreakerPrediction: 45,
        requestId: "req-1",
    };
    it("accepts full and minimal payloads (optionals nullish)", () => {
        expect(submitNFLPicksSchema.safeParse(submit).success).toBe(true);
        expect(submitNFLPicksSchema.safeParse({ poolId: "p1", week: 1, picks: { "5": "KC" } }).success).toBe(true);
        expect(submitNFLPicksSchema.safeParse({ ...submit, confidence: null, tiebreakerPrediction: null, requestId: null }).success).toBe(true);
    });
    it("rejects missing poolId/week/picks (old code threw)", () => {
        expect(submitNFLPicksSchema.safeParse({ poolId: "p1", picks: {} }).success).toBe(false);
        expect(submitNFLPicksSchema.safeParse({ poolId: "p1", week: 0, picks: { g1: "KC" } }).success).toBe(false);
        expect(submitNFLPicksSchema.safeParse({ poolId: "p1", week: 1 }).success).toBe(false);
    });
    it("rejects non-integer confidence, oversized maps, unknown fields", () => {
        expect(submitNFLPicksSchema.safeParse({ ...submit, confidence: { g1: 1.5 } }).success).toBe(false);
        const big: Record<string, string> = {};
        for (let i = 0; i < 51; i++) big[`g${i}`] = "KC";
        expect(submitNFLPicksSchema.safeParse({ ...submit, picks: big }).success).toBe(false);
        expect(submitNFLPicksSchema.safeParse({ ...submit, totalScore: 99 }).success).toBe(false);
    });
});
