import { describe, it, expect } from "vitest";
import {
    recalculatePoolWinnersSchema,
    toggleWinnerPaidSchema,
    fixParticipantIdsSchema,
} from "../schemas/poolOps";

const okRecalc = (d: unknown) => recalculatePoolWinnersSchema.safeParse(d).success;
const okToggle = (d: unknown) => toggleWinnerPaidSchema.safeParse(d).success;
const okFix = (d: unknown) => fixParticipantIdsSchema.safeParse(d).success;

describe("recalculatePoolWinnersSchema", () => {
    // The exact payload recalculatePoolWinners destructures: { poolId }.
    it("accepts a poolId", () => {
        expect(okRecalc({ poolId: "p1" })).toBe(true);
    });

    it("rejects a missing/empty poolId and an unknown field", () => {
        expect(okRecalc({})).toBe(false);
        expect(okRecalc({ poolId: "" })).toBe(false);
        expect(okRecalc({ poolId: "p1", evil: 1 })).toBe(false);
    });
});

describe("toggleWinnerPaidSchema", () => {
    // The exact payload dbService.toggleWinnerPaid sends: { poolId, winnerId }.
    it("accepts poolId and winnerId", () => {
        expect(okToggle({ poolId: "p1", winnerId: "final" })).toBe(true);
    });

    it("rejects missing poolId/winnerId and an unknown field", () => {
        expect(okToggle({ poolId: "p1" })).toBe(false);
        expect(okToggle({ winnerId: "final" })).toBe(false);
        expect(okToggle({ poolId: "p1", winnerId: "final", extra: true })).toBe(false);
    });
});

describe("fixParticipantIdsSchema", () => {
    // dbService.fixParticipantIds always sends { dryRun }, but the handler
    // tolerates absent dryRun (`=== true` check) — keep it optional.
    it("accepts absent dryRun and explicit boolean dryRun", () => {
        expect(okFix({})).toBe(true);
        expect(okFix({ dryRun: true })).toBe(true);
        expect(okFix({ dryRun: false })).toBe(true);
    });

    it("rejects a non-boolean dryRun and unknown fields", () => {
        expect(okFix({ dryRun: "yes" })).toBe(false);
        expect(okFix({ dryRun: true, force: true })).toBe(false);
    });
});
