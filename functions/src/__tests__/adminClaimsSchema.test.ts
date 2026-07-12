import { describe, it, expect } from "vitest";
import { setUserRoleSchema, setSuperAdminClaimSchema } from "../schemas/adminClaims";
import { CANONICAL_ROLES } from "../lib/roles";

const okRole = (d: unknown) => setUserRoleSchema.safeParse(d).success;
const okClaim = (d: unknown) => setSuperAdminClaimSchema.safeParse(d).success;

describe("setUserRoleSchema", () => {
    // The exact payload dbService.setUserRole sends: { targetUid, role }.
    it("accepts every canonical role", () => {
        for (const role of CANONICAL_ROLES) {
            expect(okRole({ targetUid: "u1", role })).toBe(true);
        }
    });

    it("rejects legacy/unknown roles (old hand check did too)", () => {
        expect(okRole({ targetUid: "u1", role: "PARTICIPANT" })).toBe(false);
        expect(okRole({ targetUid: "u1", role: "POOL_MANAGER" })).toBe(false);
        expect(okRole({ targetUid: "u1", role: "god" })).toBe(false);
    });

    it("rejects a missing/empty targetUid and an unknown field", () => {
        expect(okRole({ role: "MEMBER" })).toBe(false);
        expect(okRole({ targetUid: "  ", role: "MEMBER" })).toBe(false);
        expect(okRole({ targetUid: "u1", role: "MEMBER", evil: 1 })).toBe(false);
    });
});

describe("setSuperAdminClaimSchema", () => {
    it("accepts grant and revoke", () => {
        expect(okClaim({ targetUid: "u1", isSuperAdmin: true })).toBe(true);
        expect(okClaim({ targetUid: "u1", isSuperAdmin: false })).toBe(true);
    });

    it("rejects non-boolean isSuperAdmin (old hand check did too)", () => {
        expect(okClaim({ targetUid: "u1", isSuperAdmin: "true" })).toBe(false);
        expect(okClaim({ targetUid: "u1" })).toBe(false);
    });

    it("rejects an unknown field", () => {
        expect(okClaim({ targetUid: "u1", isSuperAdmin: true, role: "SUPER_ADMIN" })).toBe(false);
    });
});
