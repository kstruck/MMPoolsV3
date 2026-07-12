import { describe, it, expect } from "vitest";
import {
    createClaimCodeSchema,
    claimByCodeSchema,
    setPaidStatusSchema,
} from "../schemas/participantOps";

describe("createClaimCodeSchema", () => {
    it("accepts the real { poolId, guestDeviceKey } payload", () => {
        expect(createClaimCodeSchema.safeParse({ poolId: "p1", guestDeviceKey: "dev-uuid" }).success).toBe(true);
    });
    it("rejects missing fields (old code threw) and unknown fields", () => {
        expect(createClaimCodeSchema.safeParse({ poolId: "p1" }).success).toBe(false);
        expect(createClaimCodeSchema.safeParse({ guestDeviceKey: "d" }).success).toBe(false);
        expect(createClaimCodeSchema.safeParse({ poolId: "p1", guestDeviceKey: "d", uses: 99 }).success).toBe(false);
    });
});

describe("claimByCodeSchema", () => {
    it("accepts the real { claimCode } payload", () => {
        expect(claimByCodeSchema.safeParse({ claimCode: "AB12CD" }).success).toBe(true);
    });
    it("rejects blank/oversized codes and unknown fields", () => {
        expect(claimByCodeSchema.safeParse({ claimCode: "  " }).success).toBe(false);
        expect(claimByCodeSchema.safeParse({ claimCode: "x".repeat(33) }).success).toBe(false);
        expect(claimByCodeSchema.safeParse({ claimCode: "AB12CD", poolId: "p1" }).success).toBe(false);
    });
});

describe("setPaidStatusSchema", () => {
    it("accepts the real authoritative payload { poolId, memberUid, isPaid }", () => {
        expect(setPaidStatusSchema.safeParse({ poolId: "p1", memberUid: "u2", isPaid: true }).success).toBe(true);
        expect(setPaidStatusSchema.safeParse({ poolId: "p1", memberUid: "u2", isPaid: false }).success).toBe(true);
    });
    it("accepts the reserved claim-mode payload", () => {
        expect(setPaidStatusSchema.safeParse({ poolId: "p1", memberUid: "u2", claim: true }).success).toBe(true);
    });
    it("rejects non-boolean isPaid/claim (old code coerced truthy — now strict)", () => {
        expect(setPaidStatusSchema.safeParse({ poolId: "p1", memberUid: "u2", isPaid: "yes" }).success).toBe(false);
        expect(setPaidStatusSchema.safeParse({ poolId: "p1", memberUid: "u2", claim: 1 }).success).toBe(false);
    });
    it("rejects missing memberUid and unknown fields", () => {
        expect(setPaidStatusSchema.safeParse({ poolId: "p1", isPaid: true }).success).toBe(false);
        expect(setPaidStatusSchema.safeParse({ poolId: "p1", memberUid: "u2", isPaid: true, paidAt: 0 }).success).toBe(false);
    });

    it("requires exactly one mode — neither or both isPaid/claim rejected (qodo PR #165)", () => {
        // neither: used to fall into the authoritative branch as isPaid=undefined → UNPAID write
        expect(setPaidStatusSchema.safeParse({ poolId: "p1", memberUid: "u2" }).success).toBe(false);
        expect(setPaidStatusSchema.safeParse({ poolId: "p1", memberUid: "u2", isPaid: true, claim: true }).success).toBe(false);
    });
});
