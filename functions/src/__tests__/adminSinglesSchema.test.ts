import { describe, it, expect } from "vitest";
import {
    lockPoolSchema,
    logAdminActionSchema,
    recomputeConsensusSchema,
    recomputeRevenueSchema,
} from "../schemas/adminSingles";

const okLock = (d: unknown) => lockPoolSchema.safeParse(d).success;
const okLog = (d: unknown) => logAdminActionSchema.safeParse(d).success;
const okCons = (d: unknown) => recomputeConsensusSchema.safeParse(d).success;
const okRev = (d: unknown) => recomputeRevenueSchema.safeParse(d).success;

describe("lockPoolSchema", () => {
    // dbService.lockPool sends { poolId, forceAxis }.
    it("accepts the real client payload, with and without forceAxis", () => {
        expect(okLock({ poolId: "p1", forceAxis: true })).toBe(true);
        expect(okLock({ poolId: "p1", forceAxis: false })).toBe(true);
        expect(okLock({ poolId: "p1" })).toBe(true);
        expect(okLock({ poolId: "p1", forceAxis: null })).toBe(true);
    });

    it("rejects a missing poolId, wrong types, and unknown fields", () => {
        expect(okLock({})).toBe(false);
        expect(okLock({ poolId: "p1", forceAxis: "yes" })).toBe(false);
        expect(okLock({ poolId: "p1", axis: [1, 2] })).toBe(false);
    });
});

describe("logAdminActionSchema", () => {
    it("accepts a bare action and the full entry object", () => {
        expect(okLog({ action: "RECALC" })).toBe(true);
        expect(
            okLog({
                action: "RECALC",
                targetType: "stats",
                targetId: "global",
                status: "error",
                error: "boom",
                metadata: { count: 3, nested: { a: true }, list: [1, 2] },
            }),
        ).toBe(true);
    });

    // metadata is caller-supplied audit annotation forwarded verbatim; every
    // admin action attaches a different shape, so it must stay an open record.
    it("accepts arbitrary metadata keys and value types", () => {
        expect(okLog({ action: "X", metadata: { anything: "goes", n: 1, b: false } })).toBe(true);
        expect(okLog({ action: "X", metadata: {} })).toBe(true);
    });

    it("rejects a missing/empty action, a bad status, and unknown fields", () => {
        expect(okLog({})).toBe(false);
        expect(okLog({ action: "" })).toBe(false);
        expect(okLog({ action: "X", status: "warn" })).toBe(false);
        expect(okLog({ action: "X", actorUid: "spoofed" })).toBe(false);
    });
});

describe("recomputeConsensusSchema", () => {
    // The handler coerces via String()/Number(), so numeric strings are valid.
    it("accepts numbers and numeric strings", () => {
        expect(okCons({ season: 2026, seasonType: 2, week: 5 })).toBe(true);
        expect(okCons({ season: "2026", seasonType: "2", week: "5" })).toBe(true);
    });

    it("rejects missing fields and unknown fields", () => {
        expect(okCons({ season: 2026, seasonType: 2 })).toBe(false);
        expect(okCons({ season: 2026, seasonType: 2, week: 5, force: true })).toBe(false);
    });
});

describe("recomputeRevenueSchema", () => {
    it("accepts empty and no-arg payloads, rejects any field", () => {
        expect(okRev({})).toBe(true);
        expect(okRev(null)).toBe(true);
        expect(okRev({ dryRun: true })).toBe(false);
    });
});
