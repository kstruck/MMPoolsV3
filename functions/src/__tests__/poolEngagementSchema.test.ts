import { describe, it, expect } from "vitest";
import {
    sendPoolInvitesSchema,
    submitBracketEntrySchema,
    createBracketEntrySchema,
    updateBracketEntrySchema,
    deleteBracketEntrySchema,
    updateEntryPaymentSchema,
    adminUpdateEntryOverridesSchema,
    adminDeleteEntrySchema,
} from "../schemas/poolEngagement";

const okInvites = (d: unknown) => sendPoolInvitesSchema.safeParse(d).success;
const okSubmit = (d: unknown) => submitBracketEntrySchema.safeParse(d).success;
const okCreate = (d: unknown) => createBracketEntrySchema.safeParse(d).success;
const okUpdate = (d: unknown) => updateBracketEntrySchema.safeParse(d).success;
const okDelete = (d: unknown) => deleteBracketEntrySchema.safeParse(d).success;
const okPay = (d: unknown) => updateEntryPaymentSchema.safeParse(d).success;
const okOverrides = (d: unknown) => adminUpdateEntryOverridesSchema.safeParse(d).success;
const okAdminDel = (d: unknown) => adminDeleteEntrySchema.safeParse(d).success;

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

describe("createBracketEntrySchema", () => {
    it("accepts the real client payload { poolId, name } and the optional tiebreakerScore", () => {
        expect(okCreate({ poolId: "p1", name: "My Bracket" })).toBe(true);
        // tiebreakerScore is ignored by the handler but MUST stay accepted —
        // dbService.createBracketEntry can send it (verify-before-strict).
        expect(okCreate({ poolId: "p1", name: "My Bracket", tiebreakerScore: 145 })).toBe(true);
    });

    it("normalizes a null tiebreakerScore to undefined (Firebase serializer, C2)", () => {
        const r = createBracketEntrySchema.safeParse({ poolId: "p1", name: "n", tiebreakerScore: null });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.tiebreakerScore).toBeUndefined();
    });

    it("rejects missing name, blank name, missing poolId, and unknown fields", () => {
        expect(okCreate({ poolId: "p1" })).toBe(false);
        expect(okCreate({ poolId: "p1", name: "   " })).toBe(false);
        expect(okCreate({ name: "n" })).toBe(false);
        expect(okCreate({ poolId: "p1", name: "n", evil: true })).toBe(false);
    });
});

describe("updateBracketEntrySchema", () => {
    const upd = { poolId: "p1", entryId: "e1", picks: { "R1-W1": "team-3" }, tieBreakerPrediction: 12, name: "Renamed" };

    it("accepts the real client payload", () => {
        expect(okUpdate(upd)).toBe(true);
        expect(okUpdate({ poolId: "p1", entryId: "e1", picks: {} })).toBe(true);
    });

    it("normalizes null optionals to undefined", () => {
        const r = updateBracketEntrySchema.safeParse({ ...upd, tieBreakerPrediction: null, name: null });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.tieBreakerPrediction).toBeUndefined();
            expect(r.data.name).toBeUndefined();
        }
    });

    it("requires picks and rejects unknown fields / non-string pick values", () => {
        expect(okUpdate({ poolId: "p1", entryId: "e1" })).toBe(false);
        expect(okUpdate({ ...upd, picks: { "R1-W1": 3 } })).toBe(false);
        expect(okUpdate({ ...upd, paidStatus: "PAID" })).toBe(false);
    });
});

describe("deleteBracketEntrySchema", () => {
    it("accepts the real client payload { poolId, entryId }", () => {
        expect(okDelete({ poolId: "p1", entryId: "e1" })).toBe(true);
    });

    it("rejects missing ids, blank ids, and unknown fields", () => {
        expect(okDelete({ poolId: "p1" })).toBe(false);
        expect(okDelete({ poolId: "p1", entryId: " " })).toBe(false);
        expect(okDelete({ poolId: "p1", entryId: "e1", force: true })).toBe(false);
    });
});

describe("updateEntryPaymentSchema", () => {
    const base = { poolId: "p1", entryId: "e1", paidStatus: "PAID" as const };

    it("accepts minimal + full real payloads", () => {
        expect(okPay(base)).toBe(true);
        expect(okPay({ ...base, paymentMethod: "Venmo", paidAt: 1730000000000, paymentNote: "paid in full" })).toBe(true);
    });

    it("PRESERVES explicit null for paidAt/paymentNote (clear semantics — must NOT map to undefined)", () => {
        const r = updateEntryPaymentSchema.safeParse({ ...base, paidAt: null, paymentNote: null });
        expect(r.success).toBe(true);
        // The whole point of .nullable() over nullish(): null survives so the
        // handler can clear the field. If this ever reads undefined, the
        // field-clear feature is silently broken.
        if (r.success) {
            expect(r.data.paidAt).toBeNull();
            expect(r.data.paymentNote).toBeNull();
        }
    });

    it("rejects bad paidStatus, unknown paymentMethod, non-finite paidAt, over-long note, unknown field", () => {
        expect(okPay({ ...base, paidStatus: "MAYBE" })).toBe(false);
        expect(okPay({ ...base, paymentMethod: "Crypto" })).toBe(false);
        expect(okPay({ ...base, paidAt: Infinity })).toBe(false);
        expect(okPay({ ...base, paymentNote: "x".repeat(501) })).toBe(false);
        expect(okPay({ ...base, evil: true })).toBe(false);
    });
});

describe("adminUpdateEntryOverridesSchema", () => {
    const base = { poolId: "p1", entryId: "e1" };

    it("accepts an allowlisted, finite-number, non-empty overrides map", () => {
        expect(okOverrides({ ...base, overrides: { score: 10, payout: 250 } })).toBe(true);
        expect(okOverrides({ ...base, overrides: { tieBreakerPrediction: 3 } })).toBe(true);
    });

    it("rejects empty overrides, non-allowlisted keys, non-finite values, and non-number values", () => {
        expect(okOverrides({ ...base, overrides: {} })).toBe(false);
        expect(okOverrides({ ...base, overrides: { hacked: 1 } })).toBe(false);
        expect(okOverrides({ ...base, overrides: { score: Infinity } })).toBe(false);
        expect(okOverrides({ ...base, overrides: { score: "10" } })).toBe(false);
    });
});

describe("adminDeleteEntrySchema", () => {
    it("accepts { poolId, entryId }, rejects blanks/unknown", () => {
        expect(okAdminDel({ poolId: "p1", entryId: "e1" })).toBe(true);
        expect(okAdminDel({ poolId: "p1", entryId: "" })).toBe(false);
        expect(okAdminDel({ poolId: "p1", entryId: "e1", cascade: true })).toBe(false);
    });
});
