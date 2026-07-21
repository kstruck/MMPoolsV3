import { describe, it, expect } from "vitest";
import { buildReplayPlan, isoOrMarker } from "../lib/feedReplayDiff";
import type { NFLGame } from "../types";

const game = (over: Partial<NFLGame> & { id: string }): NFLGame => ({
    season: "2026",
    seasonType: 1,
    week: 1,
    homeTeam: "KC",
    awayTeam: "DET",
    startTime: 1_755_000_000_000,
    status: "SCHEDULED",
    ...over,
} as NFLGame);

describe("buildReplayPlan", () => {
    it("writes every snapshot game and reports a status regression", () => {
        // The recovery case: the live feed wrongly flipped a FINAL game back to
        // IN_PROGRESS and zeroed the score. Replaying the good snapshot restores it.
        const snapshot = [game({ id: "g1", status: "FINAL", scores: { home: 24, away: 17 } })];
        const current = new Map([["g1", game({ id: "g1", status: "IN_PROGRESS", scores: { home: 0, away: 0 } })]]);

        const plan = buildReplayPlan(snapshot, current);

        expect(plan.writes).toHaveLength(1);
        expect(plan.writes[0].status).toBe("FINAL");
        expect(plan.changes).toEqual(expect.arrayContaining([
            { gameId: "g1", field: "status", from: "IN_PROGRESS", to: "FINAL" },
            { gameId: "g1", field: "score", from: "0-0", to: "17-24" },
        ]));
        expect(plan.orphanGameIds).toEqual([]);
    });

    it("never unlocks a locked spread, and keeps the locked VALUE", () => {
        // Members already picked against -3.5. A snapshot taken before the lock
        // must not reopen that line.
        const snapshot = [game({ id: "g1", spread: { value: -7, locked: false } })];
        const current = new Map([["g1", game({ id: "g1", spread: { value: -3.5, locked: true } })]]);

        const plan = buildReplayPlan(snapshot, current);

        expect(plan.writes[0].spread).toEqual({ value: -3.5, locked: true });
    });

    it("takes the snapshot spread when the current one is unlocked", () => {
        const snapshot = [game({ id: "g1", spread: { value: -7, locked: false } })];
        const current = new Map([["g1", game({ id: "g1", spread: { value: -3.5, locked: false } })]]);

        expect(buildReplayPlan(snapshot, current).writes[0].spread).toEqual({ value: -7, locked: false });
    });

    it("reports orphans without scheduling any delete", () => {
        // g2 exists live but not in the snapshot — could be a genuinely new
        // fixture added after the snapshot. Report, never destroy.
        const snapshot = [game({ id: "g1" })];
        const current = new Map([["g1", game({ id: "g1" })], ["g2", game({ id: "g2" })]]);

        const plan = buildReplayPlan(snapshot, current);

        expect(plan.orphanGameIds).toEqual(["g2"]);
        expect(plan.writes.map((g) => g.id)).toEqual(["g1"]);
    });

    it("flags a game absent from the current slate as new", () => {
        const plan = buildReplayPlan([game({ id: "g9", status: "SCHEDULED" })], new Map());

        expect(plan.changes).toEqual([{ gameId: "g9", field: "new", from: "(absent)", to: "SCHEDULED" }]);
        expect(plan.writes).toHaveLength(1);
    });

    it("reports no changes when the snapshot already matches live state", () => {
        const g = game({ id: "g1", status: "FINAL", scores: { home: 24, away: 17 } });
        const plan = buildReplayPlan([g], new Map([["g1", { ...g }]]));

        expect(plan.changes).toEqual([]);
        // Writes are still produced — a no-op replay is idempotent, not empty.
        expect(plan.writes).toHaveLength(1);
    });

    it("detects a rescheduled kickoff", () => {
        const snapshot = [game({ id: "g1", startTime: 1_755_000_000_000 })];
        const current = new Map([["g1", game({ id: "g1", startTime: 1_755_010_000_000 })]]);

        const change = buildReplayPlan(snapshot, current).changes.find((c) => c.field === "startTime");
        expect(change).toBeDefined();
        expect(change!.to).toBe(new Date(1_755_000_000_000).toISOString());
    });

    // qodo #2: parseScoreboardResponse derives startTime as `new Date(x).getTime()`,
    // which is NaN when ESPN omits or mangles the date. `new Date(NaN).toISOString()`
    // throws RangeError, which would abort the whole replay — in the one situation
    // (a corrupt feed) this tool exists to recover from.
    it("does not throw when a kickoff timestamp is NaN, and marks it in the report", () => {
        const snapshot = [game({ id: "g1", startTime: NaN })];
        const current = new Map([["g1", game({ id: "g1", startTime: 1_755_000_000_000 })]]);

        const plan = buildReplayPlan(snapshot, current);

        const change = plan.changes.find((c) => c.field === "startTime");
        expect(change).toBeDefined();
        expect(change!.to).toBe("(invalid)");
        expect(change!.from).toBe(new Date(1_755_000_000_000).toISOString());
        // The game is still written — recovery continues past a bad timestamp.
        expect(plan.writes).toHaveLength(1);
    });

    it("marks an invalid CURRENT kickoff too, so a corrupt live row can still be replayed over", () => {
        const snapshot = [game({ id: "g1", startTime: 1_755_000_000_000 })];
        const current = new Map([["g1", game({ id: "g1", startTime: NaN })]]);

        const change = buildReplayPlan(snapshot, current).changes.find((c) => c.field === "startTime");
        expect(change!.from).toBe("(invalid)");
        expect(change!.to).toBe(new Date(1_755_000_000_000).toISOString());
    });
});

describe("isoOrMarker", () => {
    it("formats a finite epoch and refuses everything else", () => {
        expect(isoOrMarker(1_755_000_000_000)).toBe(new Date(1_755_000_000_000).toISOString());
        expect(isoOrMarker(0)).toBe(new Date(0).toISOString());
        expect(isoOrMarker(NaN)).toBe("(invalid)");
        expect(isoOrMarker(Infinity)).toBe("(invalid)");
        expect(isoOrMarker(undefined)).toBe("(invalid)");
        expect(isoOrMarker(null)).toBe("(invalid)");
        expect(isoOrMarker("1755000000000")).toBe("(invalid)");
    });
});
