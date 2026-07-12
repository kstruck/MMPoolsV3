import { describe, it, expect } from "vitest";
import { sendPoolInvitesSchema, submitBracketEntrySchema } from "../schemas/poolEngagement";

const okInvites = (d: unknown) => sendPoolInvitesSchema.safeParse(d).success;
const okSubmit = (d: unknown) => submitBracketEntrySchema.safeParse(d).success;

describe("sendPoolInvitesSchema", () => {
    it("accepts the real client payload", () => {
        expect(okInvites({ poolId: "p1", emails: ["a@b.com"] })).toBe(true);
        expect(okInvites({ poolId: "p1", emails: ["a@b.com", "junk-no-at"], personalNote: "join us!" })).toBe(true);
    });

    it("keeps junk addresses at the gate (per-address validity is the send loop's job)", () => {
        // one bad address must not reject the whole batch — it becomes `invalid`
        expect(okInvites({ poolId: "p1", emails: ["not-an-email"] })).toBe(true);
    });

    it("enforces the old hand-check caps (50 addresses, 500-char note)", () => {
        expect(okInvites({ poolId: "p1", emails: Array(51).fill("a@b.com") })).toBe(false);
        expect(okInvites({ poolId: "p1", emails: ["a@b.com"], personalNote: "x".repeat(501) })).toBe(false);
    });

    it("rejects an empty list, missing poolId, non-string element, unknown field", () => {
        expect(okInvites({ poolId: "p1", emails: [] })).toBe(false);
        expect(okInvites({ emails: ["a@b.com"] })).toBe(false);
        expect(okInvites({ poolId: "p1", emails: [42] })).toBe(false);
        expect(okInvites({ poolId: "p1", emails: ["a@b.com"], bcc: ["c@d.com"] })).toBe(false);
    });

    it("normalizes a null personalNote to undefined (Firebase serializer, C2)", () => {
        const r = sendPoolInvitesSchema.safeParse({ poolId: "p1", emails: ["a@b.com"], personalNote: null });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.personalNote).toBeUndefined();
    });
});

describe("submitBracketEntrySchema", () => {
    // The exact dbService payload.
    const submit = {
        poolId: "p1",
        entryId: "e1",
        picks: { "R1-W1": "team-12", "R1-W2": "team-4" },
        tieBreakerPrediction: 145,
        name: "My Bracket",
    };

    it("accepts the real client payload (+ empty picks map)", () => {
        expect(okSubmit(submit)).toBe(true);
        expect(okSubmit({ poolId: "p1", entryId: "e1", picks: {} })).toBe(true);
    });

    it("normalizes null optionals to undefined (Firebase serializer, C2)", () => {
        const r = submitBracketEntrySchema.safeParse({ ...submit, tieBreakerPrediction: null, name: null });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.tieBreakerPrediction).toBeUndefined();
            expect(r.data.name).toBeUndefined();
        }
    });

    it("rejects non-string pick values and empty ids", () => {
        expect(okSubmit({ ...submit, picks: { "R1-W1": 12 } })).toBe(false);
        expect(okSubmit({ ...submit, picks: { "R1-W1": "" } })).toBe(false);
        expect(okSubmit({ ...submit, entryId: " " })).toBe(false);
    });

    it("caps picks at 200 keys (txn-amplification guard, qodo PR #164)", () => {
        const big: Record<string, string> = {};
        for (let i = 0; i < 201; i++) big[`S-${i}`] = "team";
        expect(okSubmit({ ...submit, picks: big })).toBe(false);
        const fine: Record<string, string> = {};
        for (let i = 0; i < 67; i++) fine[`S-${i}`] = "team";
        expect(okSubmit({ ...submit, picks: fine })).toBe(true);
    });

    it("rejects a missing picks map and an unknown field", () => {
        expect(okSubmit({ poolId: "p1", entryId: "e1" })).toBe(false);
        expect(okSubmit({ ...submit, paidStatus: "PAID" })).toBe(false);
    });
});
