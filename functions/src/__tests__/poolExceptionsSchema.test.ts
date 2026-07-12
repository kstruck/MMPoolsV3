import { describe, it, expect } from "vitest";
import {
    extendWeekDeadlineSchema,
    proxyPickSchema,
    cancelPoolSchema,
    closePoolSchema,
} from "../schemas/poolExceptions";

const okExtend = (d: unknown) => extendWeekDeadlineSchema.safeParse(d).success;
const okProxy = (d: unknown) => proxyPickSchema.safeParse(d).success;
const okCancel = (d: unknown) => cancelPoolSchema.safeParse(d).success;
const okClose = (d: unknown) => closePoolSchema.safeParse(d).success;

describe("extendWeekDeadlineSchema", () => {
    const req = { poolId: "p1", week: 5, extraMinutes: 60, reason: "late kickoff confusion" };
    it("accepts the real client payload", () => {
        expect(okExtend(req)).toBe(true);
    });
    it("enforces the old hand checks: week 1-23, extraMinutes 0<x<=1440, reason 3-200", () => {
        expect(okExtend({ ...req, week: 0 })).toBe(false);
        expect(okExtend({ ...req, week: 24 })).toBe(false);
        expect(okExtend({ ...req, week: 5.5 })).toBe(false);
        expect(okExtend({ ...req, extraMinutes: 0 })).toBe(false);
        expect(okExtend({ ...req, extraMinutes: 1441 })).toBe(false);
        expect(okExtend({ ...req, reason: "ok" })).toBe(false);
        expect(okExtend({ ...req, reason: "x".repeat(201) })).toBe(false);
    });
    it("rejects an unknown field", () => {
        expect(okExtend({ ...req, force: true })).toBe(false);
    });
});

describe("proxyPickSchema", () => {
    const pickem = { poolId: "p1", week: 3, targetUid: "u2", picks: { g1: "KC", g2: "BUF" }, reason: "member hospitalized" };
    const survivor = { poolId: "p1", week: 3, targetUid: "u2", picks: { "3": "KC" }, reason: "member hospitalized" };
    it("accepts pickem (gameId keys) and survivor/margin (week-string keys) payloads", () => {
        expect(okProxy(pickem)).toBe(true);
        expect(okProxy(survivor)).toBe(true);
    });
    it("rejects missing picks / non-object picks / oversized picks (old code threw)", () => {
        const { picks: _p, ...rest } = pickem;
        expect(okProxy(rest)).toBe(false);
        expect(okProxy({ ...pickem, picks: "KC" })).toBe(false);
        const big: Record<string, string> = {};
        for (let i = 0; i < 51; i++) big[`g${i}`] = "KC";
        expect(okProxy({ ...pickem, picks: big })).toBe(false);
    });
    it("rejects short reason and unknown fields", () => {
        expect(okProxy({ ...pickem, reason: "no" })).toBe(false);
        expect(okProxy({ ...pickem, paidStatus: "PAID" })).toBe(false);
    });
});

describe("cancelPoolSchema / closePoolSchema", () => {
    it("accepts the real payloads", () => {
        expect(okCancel({ poolId: "p1", reason: "pool is dead" })).toBe(true);
        expect(okClose({ poolId: "p1" })).toBe(true);
    });
    it("cancel requires a 3-200 char reason; close takes NO reason", () => {
        expect(okCancel({ poolId: "p1" })).toBe(false);
        expect(okCancel({ poolId: "p1", reason: "xx" })).toBe(false);
        expect(okClose({ poolId: "p1", reason: "done" })).toBe(false);
    });
});
