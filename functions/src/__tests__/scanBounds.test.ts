import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeadSyncPool, playoffSyncInWindow } from "../lib/scanBounds";

/** PLAN-AUDIT-SCAN-BOUNDS Phase 1 predicates + source invariants. */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-23T12:00:00Z");

describe("isDeadSyncPool (1.2)", () => {
    it("skips CLOSED pools regardless of scores", () => {
        expect(isDeadSyncPool({ status: "CLOSED" }, NOW)).toBe(true);
        expect(isDeadSyncPool({ status: "CLOSED", scores: { gameStatus: "in" } }, NOW)).toBe(true);
    });

    it("skips a 'pre' pool whose start passed more than 7 days ago", () => {
        const stale = new Date(NOW - 8 * DAY).toISOString();
        expect(isDeadSyncPool({ scores: { gameStatus: "pre", startTime: stale } }, NOW)).toBe(true);
    });

    it("keeps live, recent-pre, and future-pre pools", () => {
        const recent = new Date(NOW - 2 * DAY).toISOString();
        const future = new Date(NOW + 2 * DAY).toISOString();
        expect(isDeadSyncPool({ scores: { gameStatus: "pre", startTime: recent } }, NOW)).toBe(false);
        expect(isDeadSyncPool({ scores: { gameStatus: "pre", startTime: future } }, NOW)).toBe(false);
        expect(isDeadSyncPool({ scores: { gameStatus: "in", startTime: new Date(NOW - 8 * DAY).toISOString() } }, NOW)).toBe(false);
        expect(isDeadSyncPool({ status: "OPEN", scores: { gameStatus: "post" } }, NOW)).toBe(false);
    });

    it("never skips on missing or unparseable startTime", () => {
        expect(isDeadSyncPool({ scores: { gameStatus: "pre" } }, NOW)).toBe(false);
        expect(isDeadSyncPool({ scores: { gameStatus: "pre", startTime: "garbage" } }, NOW)).toBe(false);
        expect(isDeadSyncPool({}, NOW)).toBe(false);
    });
});

describe("playoffSyncInWindow (1.3)", () => {
    it("is open through January and until Feb 20", () => {
        expect(playoffSyncInWindow(new Date(Date.UTC(2027, 0, 1)))).toBe(true);
        expect(playoffSyncInWindow(new Date(Date.UTC(2027, 0, 31)))).toBe(true);
        expect(playoffSyncInWindow(new Date(Date.UTC(2027, 1, 20)))).toBe(true);
    });

    it("is closed the rest of the year", () => {
        expect(playoffSyncInWindow(new Date(Date.UTC(2027, 1, 21)))).toBe(false);
        expect(playoffSyncInWindow(new Date(Date.UTC(2026, 7, 23)))).toBe(false);
        expect(playoffSyncInWindow(new Date(Date.UTC(2026, 11, 31)))).toBe(false);
    });

    it("forceActive overrides the window; anything else does not", () => {
        expect(playoffSyncInWindow(new Date(Date.UTC(2026, 7, 23)), true)).toBe(true);
        expect(playoffSyncInWindow(new Date(Date.UTC(2026, 7, 23)), false)).toBe(false);
        expect(playoffSyncInWindow(new Date(Date.UTC(2026, 7, 23)), undefined)).toBe(false);
    });
});

describe("source invariants (1.1)", () => {
    const SRC = join(__dirname, "..");

    it("runReminders has no bare full-collection pools scan", () => {
        const text = readFileSync(join(SRC, "reminders.ts"), "utf8");
        expect(text).not.toMatch(/collection\("pools"\)\.get\(\)/);
    });

    it("the union query's type list matches the loop's type dispatch", () => {
        const text = readFileSync(join(SRC, "reminders.ts"), "utf8");
        // Every type the dispatch handles beyond flag-gated squares/legacy
        // must be fetched wholesale by q1 (default-ON reminders + the
        // hard-lock freeze side effect). See PLAN-AUDIT-SCAN-BOUNDS R2.
        for (const t of ["NFL_PICKEM", "NFL_SURVIVOR", "NFL_MARGIN", "NFL_PLAYOFFS", "BRACKET"]) {
            const dispatched = new RegExp(`pool\\.type === '${t}'`).test(text);
            const queried = new RegExp(`"${t}"`).test(text);
            expect(dispatched && queried, `${t} must be both dispatched and in the q1 union`).toBe(true);
        }
    });
});
