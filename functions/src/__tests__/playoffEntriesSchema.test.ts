import { describe, it, expect } from "vitest";
import { submitPlayoffPicksSchema, managePlayoffEntrySchema } from "../schemas/playoffEntries";

describe("submitPlayoffPicksSchema", () => {
    // The exact RankingForm payload: entryId null = new entry.
    const submit = {
        poolId: "p1",
        rankings: { KC: 14, BUF: 13, BAL: 12 },
        tiebreaker: 45,
        entryId: null,
        entryName: "Kevin's Picks",
    };
    it("accepts the real new-entry and edit payloads", () => {
        expect(submitPlayoffPicksSchema.safeParse(submit).success).toBe(true);
        expect(submitPlayoffPicksSchema.safeParse({ ...submit, entryId: "u1_123" }).success).toBe(true);
    });
    it("rejects non-integer / negative / huge ranking values at the gate", () => {
        expect(submitPlayoffPicksSchema.safeParse({ ...submit, rankings: { KC: 1.5 } }).success).toBe(false);
        expect(submitPlayoffPicksSchema.safeParse({ ...submit, rankings: { KC: -1 } }).success).toBe(false);
        expect(submitPlayoffPicksSchema.safeParse({ ...submit, rankings: { KC: 100000 } }).success).toBe(false);
    });
    it("rejects a missing rankings map and unknown fields", () => {
        const { rankings: _r, ...rest } = submit;
        expect(submitPlayoffPicksSchema.safeParse(rest).success).toBe(false);
        expect(submitPlayoffPicksSchema.safeParse({ ...submit, totalScore: 999 }).success).toBe(false);
    });
});

describe("managePlayoffEntrySchema", () => {
    it("accepts the real togglePaid and delete payloads", () => {
        expect(managePlayoffEntrySchema.safeParse({ poolId: "p1", entryId: "e1", action: "togglePaid", value: true }).success).toBe(true);
        expect(managePlayoffEntrySchema.safeParse({ poolId: "p1", entryId: "e1", action: "delete" }).success).toBe(true);
    });
    it("togglePaid requires a strict boolean value (was written raw to the entry)", () => {
        expect(managePlayoffEntrySchema.safeParse({ poolId: "p1", entryId: "e1", action: "togglePaid" }).success).toBe(false);
        expect(managePlayoffEntrySchema.safeParse({ poolId: "p1", entryId: "e1", action: "togglePaid", value: "yes" }).success).toBe(false);
    });
    it("rejects an unknown action (old code threw) and stray fields on delete", () => {
        expect(managePlayoffEntrySchema.safeParse({ poolId: "p1", entryId: "e1", action: "promote" }).success).toBe(false);
        expect(managePlayoffEntrySchema.safeParse({ poolId: "p1", entryId: "e1", action: "delete", value: true }).success).toBe(false);
    });
});
