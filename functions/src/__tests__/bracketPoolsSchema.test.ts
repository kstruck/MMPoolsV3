import { describe, it, expect } from "vitest";
import { publishBracketPoolSchema, joinBracketPoolSchema } from "../schemas/bracketPools";

const okPublish = (d: unknown) => publishBracketPoolSchema.safeParse(d).success;
const okJoin = (d: unknown) => joinBracketPoolSchema.safeParse(d).success;

describe("publishBracketPoolSchema", () => {
    it("accepts minimal + full payloads", () => {
        expect(okPublish({ poolId: "p1", slug: "office-madness" })).toBe(true);
        expect(okPublish({ poolId: "p1", slug: "Office-Madness", password: "hunter2", isListedPublic: true })).toBe(true);
    });

    it("accepts a mixed-case slug (charset is validated in-handler after lowercasing)", () => {
        // The schema must NOT reject mixed case — the handler lowercases first.
        expect(okPublish({ poolId: "p1", slug: "My-Cool-Pool" })).toBe(true);
    });

    it("normalizes null optionals to undefined", () => {
        const r = publishBracketPoolSchema.safeParse({ poolId: "p1", slug: "s", password: null, isListedPublic: null });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.password).toBeUndefined();
            expect(r.data.isListedPublic).toBeUndefined();
        }
    });

    it("rejects missing poolId/slug, blank slug, over-long password, wrong types, unknown fields", () => {
        expect(okPublish({ slug: "s" })).toBe(false);
        expect(okPublish({ poolId: "p1" })).toBe(false);
        expect(okPublish({ poolId: "p1", slug: "   " })).toBe(false);
        expect(okPublish({ poolId: "p1", slug: "s", password: "x".repeat(201) })).toBe(false);
        expect(okPublish({ poolId: "p1", slug: "s", isListedPublic: "yes" })).toBe(false);
        expect(okPublish({ poolId: "p1", slug: "s", evil: true })).toBe(false);
    });
});

describe("joinBracketPoolSchema", () => {
    it("accepts { poolId } and { poolId, password }", () => {
        expect(okJoin({ poolId: "p1" })).toBe(true);
        expect(okJoin({ poolId: "p1", password: "hunter2" })).toBe(true);
    });

    it("rejects missing poolId, over-long password, and unknown fields", () => {
        expect(okJoin({})).toBe(false);
        expect(okJoin({ poolId: "p1", password: "x".repeat(201) })).toBe(false);
        expect(okJoin({ poolId: "p1", sneak: 1 })).toBe(false);
    });
});
