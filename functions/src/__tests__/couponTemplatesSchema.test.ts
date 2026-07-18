import { describe, it, expect } from "vitest";
import {
    createCouponTemplateSchema,
    updateCouponTemplateSchema,
    mintCouponFromTemplateSchema,
    deleteCouponTemplateSchema,
    acknowledgeMonetizationAlertSchema,
} from "../schemas/couponTemplates";

const okCreate = (d: unknown) => createCouponTemplateSchema.safeParse(d).success;
const okUpdate = (d: unknown) => updateCouponTemplateSchema.safeParse(d).success;
const okMint = (d: unknown) => mintCouponFromTemplateSchema.safeParse(d).success;
const okDelete = (d: unknown) => deleteCouponTemplateSchema.safeParse(d).success;
const okAck = (d: unknown) => acknowledgeMonetizationAlertSchema.safeParse(d).success;

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

describe("deleteCouponTemplateSchema", () => {
    // The exact payload dbService.deleteCouponTemplate sends: { templateId }.
    it("accepts a templateId", () => {
        expect(okDelete({ templateId: "t1" })).toBe(true);
    });

    it("rejects a missing/empty templateId and an unknown field", () => {
        expect(okDelete({})).toBe(false);
        expect(okDelete({ templateId: "" })).toBe(false);
        expect(okDelete({ templateId: "t1", evil: 1 })).toBe(false);
    });
});

describe("acknowledgeMonetizationAlertSchema", () => {
    // The exact payload dbService.acknowledgeMonetizationAlert sends: { alertId, status }.
    it("accepts alertId with and without status", () => {
        expect(okAck({ alertId: "a1" })).toBe(true);
        expect(okAck({ alertId: "a1", status: "acked" })).toBe(true);
        expect(okAck({ alertId: "a1", status: "open" })).toBe(true);
    });

    it("rejects a missing/empty alertId, a bad status, and an unknown field", () => {
        expect(okAck({})).toBe(false);
        expect(okAck({ alertId: "" })).toBe(false);
        expect(okAck({ alertId: "a1", status: "closed" })).toBe(false);
        expect(okAck({ alertId: "a1", evil: 1 })).toBe(false);
    });
});
