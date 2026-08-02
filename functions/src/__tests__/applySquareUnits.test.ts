import { describe, it, expect } from "vitest";
import { applySquareUnits } from "../migrations/backfillMemberRecords";

// The authorization boundary: square ownership ENRICHES a member, it never
// INTRODUCES one. `claimMySquares` can set `squares[].reservedByUid` on proof of
// a key readable from the world-readable pool doc, so minting a Member Record
// from it would promote an unverified signal into roster truth — and a Member
// Record is what `setPaidStatus` and reminder targeting trust.

describe("applySquareUnits", () => {
    const collect = (units: Map<string, number>, members: string[]) => {
        const applied: Array<[string, number]> = [];
        const skipped = applySquareUnits(
            units,
            (uid) => members.includes(uid),
            (uid, n) => applied.push([uid, n]),
        );
        return { applied, skipped };
    };

    it("REFUSES to introduce a uid that no other signal established", () => {
        // The defect. This uid's only evidence is a square it claimed.
        const { applied, skipped } = collect(new Map([["guest-claimer", 3]]), []);

        expect(applied).toEqual([]);
        expect(skipped).toBe(1);
    });

    it("applies units to a uid another signal already established", () => {
        const { applied, skipped } = collect(new Map([["real-member", 3]]), ["real-member"]);

        expect(applied).toEqual([["real-member", 3]]);
        expect(skipped).toBe(0);
    });

    it("admits and refuses independently in the same pool", () => {
        const { applied, skipped } = collect(
            new Map([["real-member", 2], ["guest-claimer", 5]]),
            ["real-member"],
        );

        expect(applied).toEqual([["real-member", 2]]);
        expect(skipped).toBe(1);
    });

    it("counts every refusal, so the dry run can report it", () => {
        // Silent truncation is the failure mode: a job that covers less than it
        // used to must say so, or its report reads as "covered everything".
        const { skipped } = collect(new Map([["a", 1], ["b", 1], ["c", 1]]), []);

        expect(skipped).toBe(3);
    });

    it("is a no-op for a pool with no squares", () => {
        const { applied, skipped } = collect(new Map(), ["someone"]);

        expect(applied).toEqual([]);
        expect(skipped).toBe(0);
    });

    it("preserves the unit COUNT, not merely membership", () => {
        // Units drive SQUARES dues; passing the gate but losing the number would
        // understate what a member owes.
        const { applied } = collect(new Map([["m", 7]]), ["m"]);

        expect(applied[0][1]).toBe(7);
    });
});

// codex r1 [P1]: the gate was bypassable one hop along. syncParticipantIndices
// is a pool-write TRIGGER that creates `participants/{uid}` from
// `s.reservedByUid || s.paidByUid`, so a claimMySquares claim materialises a
// participants doc automatically — and the migration read that as a membership
// signal. Same trust problem, same gate.
describe("applySquareUnits is generic over the enrichment it gates", () => {
    it("refuses a squares-derived participants doc for a non-member", () => {
        const applied: string[] = [];
        const skipped = applySquareUnits(
            new Map([["guest-claimer", "Mallory"]]),
            () => false,
            (uid) => applied.push(uid),
        );

        expect(applied).toEqual([]);
        expect(skipped).toBe(1);
    });

    it("applies a name to an established member", () => {
        const applied: Array<[string, string | undefined]> = [];
        applySquareUnits(
            new Map<string, string | undefined>([["real", "Ada"]]),
            (uid) => uid === "real",
            (uid, name) => applied.push([uid, name]),
        );

        expect(applied).toEqual([["real", "Ada"]]);
    });

    it("lets the caller drop an undefined value rather than wiping a good one", () => {
        // qodo: the migration's `add` SPREADS its source over the existing
        // record, so `{ userName: undefined }` wipes a name that entries had
        // already supplied. Gating the enrichment moved it after the entries
        // read, which made squares the last writer — so the callback must be
        // free to skip. This pins that the seam passes the value through
        // untouched and leaves that judgement to the caller.
        const applied: Array<[string, string | undefined]> = [];
        applySquareUnits(
            new Map<string, string | undefined>([["a", undefined], ["b", "Bo"]]),
            () => true,
            (uid, name) => { if (name) applied.push([uid, name]); },
        );

        expect(applied).toEqual([["b", "Bo"]]);
    });

    it("carries an undefined value through without inventing one", () => {
        const applied: Array<[string, string | undefined]> = [];
        applySquareUnits(
            new Map<string, string | undefined>([["real", undefined]]),
            () => true,
            (uid, name) => applied.push([uid, name]),
        );

        expect(applied).toEqual([["real", undefined]]);
    });
});
