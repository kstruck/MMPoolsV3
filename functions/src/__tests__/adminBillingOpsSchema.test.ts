import { describe, it, expect } from "vitest";
import {
    adminSaveBillingConfigSchema,
    adminUpdatePoolBillingSchema,
    adminAdjustUserCreditsSchema,
} from "../schemas/adminBillingOps";

const okSave = (d: unknown) => adminSaveBillingConfigSchema.safeParse(d).success;
const okPool = (d: unknown) => adminUpdatePoolBillingSchema.safeParse(d).success;
const okCredits = (d: unknown) => adminAdjustUserCreditsSchema.safeParse(d).success;

describe("adminSaveBillingConfigSchema", () => {
    // The billing branch delegates config validation to BillingConfigSchema
    // (own coverage). We assert only that it is WIRED IN — an invalid config on
    // a kind:"billing" envelope is rejected by the union, not passed through.
    it("rejects kind:'billing' with an invalid config (BillingConfigSchema wired in)", () => {
        expect(okSave({ kind: "billing", config: {} })).toBe(false);
    });

    it("accepts kind:'referral' as an unmodeled passthrough object", () => {
        expect(okSave({ kind: "referral", config: { referralBonus: 5, anythingGoes: true } })).toBe(true);
    });

    it("rejects an unknown kind", () => {
        expect(okSave({ kind: "bogus", config: {} })).toBe(false);
    });

    it("rejects an unknown envelope field", () => {
        expect(okSave({ kind: "referral", config: {}, extra: 1 })).toBe(false);
    });

    it("rejects a missing config", () => {
        expect(okSave({ kind: "referral" })).toBe(false);
    });
});

describe("adminUpdatePoolBillingSchema", () => {
    // The exact payloads SuperAdminBillingPanel.tsx sends (override / extendTrial / resetGrace).
    it("accepts the real override payload", () => {
        expect(okPool({ poolId: "pool123", action: "override", data: { status: "active", trialEndsAt: 1 } })).toBe(true);
    });

    it("accepts extendTrial with no data", () => {
        expect(okPool({ poolId: "pool123", action: "extendTrial" })).toBe(true);
    });

    it("accepts resetGrace with { gracePeriodDays } and without data", () => {
        expect(okPool({ poolId: "pool123", action: "resetGrace", data: { gracePeriodDays: 7 } })).toBe(true);
        expect(okPool({ poolId: "pool123", action: "resetGrace" })).toBe(true);
    });

    it("rejects override missing its data (old code threw)", () => {
        expect(okPool({ poolId: "pool123", action: "override" })).toBe(false);
    });

    it("rejects extendTrial carrying a data blob (unknown field)", () => {
        expect(okPool({ poolId: "pool123", action: "extendTrial", data: {} })).toBe(false);
    });

    it("rejects an empty poolId and an unknown action", () => {
        expect(okPool({ poolId: "  ", action: "extendTrial" })).toBe(false);
        expect(okPool({ poolId: "pool123", action: "nuke" })).toBe(false);
    });

    it("rejects an unknown gracePeriodDays sibling on resetGrace data", () => {
        expect(okPool({ poolId: "pool123", action: "resetGrace", data: { gracePeriodDays: 7, evil: 1 } })).toBe(false);
    });
});

describe("adminAdjustUserCreditsSchema", () => {
    // The exact payload SuperAdminBillingPanel.tsx sends — both numbers always present.
    it("accepts the real client payload (both numeric fields)", () => {
        expect(okCredits({ targetUid: "u1", referralCredits: 3, freePoolsAvailable: 2 })).toBe(true);
    });

    it("accepts just one numeric field", () => {
        expect(okCredits({ targetUid: "u1", referralCredits: 3 })).toBe(true);
        expect(okCredits({ targetUid: "u1", freePoolsAvailable: 2 })).toBe(true);
    });

    it("rejects neither numeric field (nothing to adjust)", () => {
        expect(okCredits({ targetUid: "u1" })).toBe(false);
    });

    it("rejects an empty targetUid, a non-number, and an unknown field", () => {
        expect(okCredits({ targetUid: "  ", referralCredits: 3 })).toBe(false);
        expect(okCredits({ targetUid: "u1", referralCredits: "3" })).toBe(false);
        expect(okCredits({ targetUid: "u1", referralCredits: 3, evil: true })).toBe(false);
    });
});
