import { describe, it, expect } from "vitest";
import { sendManualReminderSchema, joinWaitlistSchema } from "../schemas/reminderWaitlist";

describe("sendManualReminderSchema", () => {
    it("accepts the real payloads (with and without targetUids)", () => {
        expect(sendManualReminderSchema.safeParse({ poolId: "p1", kind: "PICKS" }).success).toBe(true);
        expect(sendManualReminderSchema.safeParse({ poolId: "p1", kind: "PAYMENT", targetUids: ["u1", "u2"] }).success).toBe(true);
        expect(sendManualReminderSchema.safeParse({ poolId: "p1", kind: "PICKS", targetUids: null }).success).toBe(true);
    });
    it("rejects a bad kind / non-string targetUids (old hand checks)", () => {
        expect(sendManualReminderSchema.safeParse({ poolId: "p1", kind: "NUDGE" }).success).toBe(false);
        expect(sendManualReminderSchema.safeParse({ poolId: "p1", kind: "PICKS", targetUids: [42] }).success).toBe(false);
        expect(sendManualReminderSchema.safeParse({ poolId: "p1", kind: "PICKS", cc: [] }).success).toBe(false);
    });
});

describe("joinWaitlistSchema", () => {
    it("accepts the real { poolId, name, email } payload", () => {
        expect(joinWaitlistSchema.safeParse({ poolId: "p1", name: "Carol", email: "c@x.com" }).success).toBe(true);
    });
    it("rejects missing fields (old code threw) and unknown fields", () => {
        expect(joinWaitlistSchema.safeParse({ poolId: "p1", name: "Carol" }).success).toBe(false);
        expect(joinWaitlistSchema.safeParse({ poolId: "p1", email: "c@x.com" }).success).toBe(false);
        expect(joinWaitlistSchema.safeParse({ poolId: "p1", name: "C", email: "c@x.com", userId: "u1" }).success).toBe(false);
    });
});
