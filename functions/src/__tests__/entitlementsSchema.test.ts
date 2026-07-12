import { describe, it, expect } from "vitest";
import { adminGrantEntitlementSchema, adminRevokeEntitlementSchema } from "../schemas/entitlements";

const okGrant = (d: unknown) => adminGrantEntitlementSchema.safeParse(d).success;
const okRevoke = (d: unknown) => adminRevokeEntitlementSchema.safeParse(d).success;

// The exact payload shapes dbService.adminGrantEntitlement / adminRevokeEntitlement send.
const bundleGrant = {
    targetUid: "u1",
    productKind: "CREDIT_BUNDLE",
    reason: "comp for outage",
    creditsTotal: 3,
};
const passGrant = {
    targetUid: "u1",
    productKind: "UNLIMITED_PASS",
    reason: "partner comp",
    termDays: 365,
};

describe("adminGrantEntitlementSchema", () => {
    it("accepts the real bundle + pass payloads", () => {
        expect(okGrant(bundleGrant)).toBe(true);
        expect(okGrant(passGrant)).toBe(true);
    });

    it("accepts the optional snapshot fields the panel conditionally adds", () => {
        expect(okGrant({ ...bundleGrant, name: "VIP Grant", price: 0, poolType: "squares", maxPlayersPerPool: 50 })).toBe(true);
        // poolType is deliberately lenient (handler folds unknowns to ALL).
        expect(okGrant({ ...bundleGrant, poolType: "ALL" })).toBe(true);
    });

    it("rejects a CREDIT_BUNDLE without creditsTotal (old code threw)", () => {
        const { creditsTotal: _c, ...rest } = bundleGrant;
        expect(okGrant(rest)).toBe(false);
        expect(okGrant({ ...bundleGrant, creditsTotal: 0 })).toBe(false);
    });

    it("rejects an UNLIMITED_PASS without termDays (old code threw)", () => {
        const { termDays: _t, ...rest } = passGrant;
        expect(okGrant(rest)).toBe(false);
        expect(okGrant({ ...passGrant, termDays: 0 })).toBe(false);
    });

    it("rejects a missing/blank reason (audit requirement)", () => {
        expect(okGrant({ ...bundleGrant, reason: "  " })).toBe(false);
        const { reason: _r, ...rest } = bundleGrant;
        expect(okGrant(rest)).toBe(false);
    });

    it("rejects an unknown productKind and cross-kind fields", () => {
        expect(okGrant({ ...bundleGrant, productKind: "FREE_STUFF" })).toBe(false);
        // termDays does not belong on a CREDIT_BUNDLE envelope (strict).
        expect(okGrant({ ...bundleGrant, termDays: 30 })).toBe(false);
        expect(okGrant({ ...passGrant, creditsTotal: 3 })).toBe(false);
    });

    it("rejects an unknown field", () => {
        expect(okGrant({ ...bundleGrant, evil: true })).toBe(false);
    });
});

describe("adminRevokeEntitlementSchema", () => {
    it("accepts the real bundle / credit / pass payloads", () => {
        expect(okRevoke({ scope: "bundle", bundleId: "b1", reason: "fraud" })).toBe(true);
        expect(okRevoke({ scope: "credit", bundleId: "b1", creditId: "c1", reason: "fraud" })).toBe(true);
        expect(okRevoke({ scope: "pass", bundleId: "b1", reason: "expired early" })).toBe(true);
    });

    it("rejects scope 'credit' without creditId (old code threw)", () => {
        expect(okRevoke({ scope: "credit", bundleId: "b1", reason: "fraud" })).toBe(false);
    });

    it("rejects a creditId on non-credit scopes (strict envelope)", () => {
        expect(okRevoke({ scope: "bundle", bundleId: "b1", creditId: "c1", reason: "fraud" })).toBe(false);
    });

    it("rejects a blank reason, missing bundleId, unknown scope", () => {
        expect(okRevoke({ scope: "bundle", bundleId: "b1", reason: " " })).toBe(false);
        expect(okRevoke({ scope: "bundle", reason: "fraud" })).toBe(false);
        expect(okRevoke({ scope: "everything", bundleId: "b1", reason: "fraud" })).toBe(false);
    });
});
