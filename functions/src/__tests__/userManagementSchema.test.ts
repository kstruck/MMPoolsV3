import { describe, it, expect } from "vitest";
import {
    deleteUserAccountSchema,
    sendAdminPasswordResetSchema,
    sendSecuritySMSAlertSchema,
    sendUserEmailSchema,
} from "../schemas/userManagement";

describe("deleteUserAccountSchema", () => {
    it("accepts the real { targetUid } payload", () => {
        expect(deleteUserAccountSchema.safeParse({ targetUid: "u1" }).success).toBe(true);
    });
    it("rejects missing/blank targetUid and unknown fields", () => {
        expect(deleteUserAccountSchema.safeParse({}).success).toBe(false);
        expect(deleteUserAccountSchema.safeParse({ targetUid: "  " }).success).toBe(false);
        expect(deleteUserAccountSchema.safeParse({ targetUid: "u1", force: true }).success).toBe(false);
    });
});

describe("sendAdminPasswordResetSchema", () => {
    it("accepts the real { email } payload", () => {
        expect(sendAdminPasswordResetSchema.safeParse({ email: "kevin@example.com" }).success).toBe(true);
    });
    it("rejects missing/blank email and unknown fields", () => {
        expect(sendAdminPasswordResetSchema.safeParse({}).success).toBe(false);
        expect(sendAdminPasswordResetSchema.safeParse({ email: " " }).success).toBe(false);
        expect(sendAdminPasswordResetSchema.safeParse({ email: "a@b.co", cc: "x@y.z" }).success).toBe(false);
    });
});

describe("sendSecuritySMSAlertSchema", () => {
    it("accepts the real no-payload call (null on the wire) and {}", () => {
        expect(sendSecuritySMSAlertSchema.safeParse(null).success).toBe(true);
        expect(sendSecuritySMSAlertSchema.safeParse(undefined).success).toBe(true);
        expect(sendSecuritySMSAlertSchema.safeParse({}).success).toBe(true);
    });
    it("rejects any actual payload (nothing is accepted)", () => {
        expect(sendSecuritySMSAlertSchema.safeParse({ phone: "+15555555555" }).success).toBe(false);
    });
});

describe("sendUserEmailSchema", () => {
    const msg = { targetUid: "u1", subject: "Hello", body: "Line1\nLine2" };
    it("accepts the real { targetUid, subject, body } payload", () => {
        expect(sendUserEmailSchema.safeParse(msg).success).toBe(true);
    });
    it("rejects blank subject/body after trim (old hand check) and unknown fields", () => {
        expect(sendUserEmailSchema.safeParse({ ...msg, subject: "  " }).success).toBe(false);
        expect(sendUserEmailSchema.safeParse({ ...msg, body: "\n" }).success).toBe(false);
        expect(sendUserEmailSchema.safeParse({ ...msg, html: "<b>x</b>" }).success).toBe(false);
    });
});
