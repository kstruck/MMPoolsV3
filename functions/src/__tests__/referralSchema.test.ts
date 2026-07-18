import { describe, it, expect } from "vitest";
import {
    generateReferralTokenSchema,
    resolveReferralTokenSchema,
} from "../schemas/referral";

const okGen = (d: unknown) => generateReferralTokenSchema.safeParse(d).success;
const okResolve = (d: unknown) => resolveReferralTokenSchema.safeParse(d).success;

describe("generateReferralTokenSchema", () => {
    // referralService.ts sends { userId }. The handler ignores it (the token
    // owner is request.auth.uid), but rejecting it would break the real call.
    it("accepts the dead userId field the real client sends", () => {
        expect(okGen({ userId: "u1" })).toBe(true);
    });

    it("accepts an empty and a no-arg payload", () => {
        expect(okGen({})).toBe(true);
        expect(okGen(null)).toBe(true);
        expect(okGen(undefined)).toBe(true);
    });

    it("rejects genuinely unknown fields", () => {
        expect(okGen({ userId: "u1", uid: "other" })).toBe(false);
        expect(okGen({ evil: 1 })).toBe(false);
    });
});

describe("resolveReferralTokenSchema", () => {
    it("accepts a token", () => {
        expect(okResolve({ token: "abc123" })).toBe(true);
    });

    // token is used directly as a Firestore document id, matched exactly.
    it("preserves the token verbatim (lookup key, not trimmed)", () => {
        const parsed = resolveReferralTokenSchema.parse({ token: " abc " });
        expect(parsed.token).toBe(" abc ");
    });

    it("rejects a missing/empty token and unknown fields", () => {
        expect(okResolve({})).toBe(false);
        expect(okResolve({ token: "" })).toBe(false);
        expect(okResolve({ token: "abc", referrer: "x" })).toBe(false);
    });
});
