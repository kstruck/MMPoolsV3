import { describe, it, expect } from "vitest";
import { isTournamentStale, staleAfterMs } from "../lib/tournamentStaleness";

// Found 2026-07-21 from the Firestore usage graph: reads pinned at ~1.4M/day
// since early July. Cause: scheduledBracketSync re-syncing three 2025 March
// Madness tournaments every 10 minutes, because `isFinalized` is set to false by
// every creator and set to true by nothing. These pin the guard that stops it.

const JULY_2026 = Date.UTC(2026, 6, 21);   // when this was found
const MARCH_2026 = Date.UTC(2026, 2, 20);  // mid-tournament, must NOT be skipped

describe("isTournamentStale", () => {
    it("skips the dead 2025 brackets that caused the read burn", () => {
        expect(isTournamentStale(2025, JULY_2026)).toBe(true);
    });

    it("does NOT skip the current season during the tournament itself", () => {
        // The failure that would matter: skipping a live bracket stops score
        // updates during the event. Far worse than wasted reads.
        expect(isTournamentStale(2026, MARCH_2026)).toBe(false);
    });

    it("does not skip a current-season tournament before the cutoff", () => {
        expect(isTournamentStale(2026, Date.UTC(2026, 5, 29))).toBe(false);
        // ...and does once the cutoff passes.
        expect(isTournamentStale(2026, Date.UTC(2026, 6, 1))).toBe(true);
    });

    it("fails OPEN on a missing or unparseable seasonYear", () => {
        // Unknown year must keep syncing, never silently stop scoring.
        expect(isTournamentStale(undefined, JULY_2026)).toBe(false);
        expect(isTournamentStale(null, JULY_2026)).toBe(false);
        expect(isTournamentStale("not-a-year", JULY_2026)).toBe(false);
        expect(isTournamentStale(NaN, JULY_2026)).toBe(false);
        expect(isTournamentStale(1999, JULY_2026)).toBe(false);
        expect(isTournamentStale(9999, JULY_2026)).toBe(false);
    });

    it("accepts a numeric string, since Firestore fields are not typed", () => {
        expect(isTournamentStale("2025", JULY_2026)).toBe(true);
    });

    it("cuts off at end of June, ~3 months after the last possible game", () => {
        expect(staleAfterMs(2025)).toBe(Date.UTC(2025, 5, 30));
    });
});
