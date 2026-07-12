import { describe, it, expect } from "vitest";
import {
    createCouponTemplateSchema,
    updateCouponTemplateSchema,
    mintCouponFromTemplateSchema,
} from "../schemas/couponTemplates";

const okCreate = (d: unknown) => createCouponTemplateSchema.safeParse(d).success;
const okUpdate = (d: unknown) => updateCouponTemplateSchema.safeParse(d).success;
const okMint = (d: unknown) => mintCouponFromTemplateSchema.safeParse(d).success;

// The exact template payload the Monetization tab sends (top-level, per dbService).
const template = {
    name: "Black Friday",
    discountType: "percentage",
    discountValue: 20,
    isActive: true,
};

describe("createCouponTemplateSchema", () => {
    it("accepts the real client template payload (+ optional constraints)", () => {
        expect(okCreate(template)).toBe(true);
        expect(okCreate({ ...template, notes: "seasonal", maxUses: 100, perUserLimit: 1, expiresAt: 1753000000000, allowedPoolTypes: ["SQUARES"] })).toBe(true);
    });

    it("rejects a non-canonical pool type in allowedPoolTypes", () => {
        expect(okCreate({ ...template, allowedPoolTypes: ["squares"] })).toBe(false);
    });

    it("strips unknown keys rather than persisting them (non-strict shared schema)", () => {
        const r = createCouponTemplateSchema.safeParse({ ...template, evil: true });
        expect(r.success).toBe(true);
        if (r.success) expect("evil" in r.data).toBe(false);
    });

    it("rejects a missing name / bad discount", () => {
        const { name: _n, ...noName } = template;
        expect(okCreate(noName)).toBe(false);
        expect(okCreate({ ...template, discountType: "bogus" })).toBe(false);
        expect(okCreate({ ...template, discountValue: 0 })).toBe(false);
    });
});

describe("updateCouponTemplateSchema", () => {
    it("accepts the real { templateId, template } payload", () => {
        expect(okUpdate({ templateId: "t1", template })).toBe(true);
    });

    it("rejects the legacy top-level-fields shape (fallback removed; no caller used it)", () => {
        expect(okUpdate({ templateId: "t1", ...template })).toBe(false);
    });

    it("rejects a missing templateId or template", () => {
        expect(okUpdate({ template })).toBe(false);
        expect(okUpdate({ templateId: "t1" })).toBe(false);
    });
});

describe("mintCouponFromTemplateSchema", () => {
    it("accepts the real { templateId, code } payload", () => {
        expect(okMint({ templateId: "t1", code: "blackfriday" })).toBe(true);
    });

    it("rejects a blank code, missing templateId, unknown field", () => {
        expect(okMint({ templateId: "t1", code: "   " })).toBe(false);
        expect(okMint({ code: "X" })).toBe(false);
        expect(okMint({ templateId: "t1", code: "X", usesCount: 5 })).toBe(false);
    });
});
