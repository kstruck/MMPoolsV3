import { describe, it, expect } from "vitest";
import { adminManageCouponSchema } from "../schemas/adminManageCoupon";

const ok = (data: unknown) => adminManageCouponSchema.safeParse(data).success;

// The exact payload SuperAdminBillingPanel.tsx:317-332 sends for op:"create".
const clientCreate = {
    op: "create",
    data: {
        code: "BLACKFRIDAY",
        discountType: "percentage",
        discountValue: 20,
        isActive: true,
        usesCount: 0,
        createdAt: 1752000000000,
        usageLog: [],
    },
};

describe("adminManageCouponSchema", () => {
    it("accepts the real client create payload", () => {
        expect(ok(clientCreate)).toBe(true);
    });

    it("accepts create with the optional fields the panel conditionally adds", () => {
        expect(ok({
            ...clientCreate,
            data: { ...clientCreate.data, maxUses: 100, perUserLimit: 1, expiresAt: 1753000000000, allowedPoolTypes: ["squares"] },
        })).toBe(true);
    });

    it("normalizes null optionals to undefined (Firebase serializer, C2)", () => {
        const r = adminManageCouponSchema.safeParse({
            ...clientCreate,
            data: { ...clientCreate.data, maxUses: null, expiresAt: null },
        });
        expect(r.success).toBe(true);
        if (r.success && r.data.op === "create") {
            expect(r.data.data.maxUses).toBeUndefined();
            expect(r.data.data.expiresAt).toBeUndefined();
        }
    });

    it("rejects an unknown field in the coupon body (no blind spread into Firestore)", () => {
        expect(ok({ ...clientCreate, data: { ...clientCreate.data, evil: true } })).toBe(false);
    });

    it("rejects an unknown field on the envelope", () => {
        expect(ok({ ...clientCreate, couponId: "should-not-be-here" })).toBe(false);
    });

    it("rejects a pre-seeded usageLog (reservation ledger must start empty)", () => {
        expect(ok({ ...clientCreate, data: { ...clientCreate.data, usageLog: [{ userId: "u1" }] } })).toBe(false);
    });

    it("rejects create with an empty code", () => {
        expect(ok({ ...clientCreate, data: { ...clientCreate.data, code: "  " } })).toBe(false);
    });

    it("rejects an unknown discountType", () => {
        expect(ok({ ...clientCreate, data: { ...clientCreate.data, discountType: "bogus" } })).toBe(false);
    });

    it("accepts the real delete + toggle payloads", () => {
        expect(ok({ op: "delete", couponId: "abc123" })).toBe(true);
        expect(ok({ op: "toggle", couponId: "abc123", data: { isActive: false } })).toBe(true);
    });

    it("rejects delete carrying a data blob, and toggle without isActive", () => {
        expect(ok({ op: "delete", couponId: "abc123", data: { isActive: true } })).toBe(false);
        expect(ok({ op: "toggle", couponId: "abc123", data: {} })).toBe(false);
    });

    it("rejects an unknown op", () => {
        expect(ok({ op: "nuke", couponId: "abc123" })).toBe(false);
    });
});
