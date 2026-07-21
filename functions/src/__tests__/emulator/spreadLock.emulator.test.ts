import { describe, it, expect, beforeEach } from "vitest";
import * as admin from "firebase-admin";
import "./setup";
import { lockSpreadsOnce } from "../../nflSchedule";

/**
 * lockNFLSpreadsJob write-path coverage.
 *
 * WHY THIS EXISTS. Before it, the ONLY tests touching spread locking were pure
 * unit tests of `shouldLockSpread` and `readJobGate`, and every emulator fixture
 * seeded spreads as already `locked: true`. So the unlocked→locked transition —
 * the query window, the per-run cap, and the dry-run-writes-nothing guarantee —
 * had never been executed by any test.
 *
 * That matters because this is the job Kevin arms for preseason, and the SAME
 * field already shipped one undetected bug: PR #235, where score sync silently
 * unlocked and re-priced spreads for games later in the week.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function clearGames() {
    const db = admin.firestore();
    const snap = await db.collection("nfl_games").get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

/**
 * A game the job should consider: in-window, unlocked, has a line.
 *
 * Passing `spread: undefined` OMITS the field rather than writing undefined —
 * Firestore rejects undefined values outright, and "no spread field at all" is
 * the real preseason shape (only 1 of 49 preseason games has a betting line).
 */
function game(id: string, over: Record<string, unknown> = {}) {
    const g: Record<string, unknown> = {
        id,
        season: "2026",
        seasonType: 1,
        week: 1,
        status: "SCHEDULED",
        homeTeam: { abbreviation: "KC" },
        awayTeam: { abbreviation: "DET" },
        spread: { value: -3.5, locked: false },
        ...over,
    };
    for (const k of Object.keys(g)) if (g[k] === undefined) delete g[k];
    return g as { id: string } & Record<string, unknown>;
}

async function seed(games: Array<ReturnType<typeof game>>) {
    const db = admin.firestore();
    await Promise.all(games.map((g) => db.collection("nfl_games").doc(g.id).set(g)));
}

async function lockedState(id: string) {
    const db = admin.firestore();
    const d = await db.collection("nfl_games").doc(id).get();
    return (d.data() as { spread?: { value?: number; locked?: boolean } } | undefined)?.spread;
}

describe("lockSpreadsOnce (emulator) — the write path", () => {
    const NOW = Date.now();

    beforeEach(clearGames);

    it("locks an eligible upcoming game, and says so", async () => {
        await seed([game("g1", { startTime: NOW + 2 * DAY })]);

        const result = await lockSpreadsOnce(admin.firestore(), NOW, { dryRun: false });

        expect(result.locked).toBe(1);
        expect(result.overflow).toBe(0);
        // The value must survive the lock — locking freezes the line, it does
        // not reprice it.
        expect(await lockedState("g1")).toEqual({ value: -3.5, locked: true });
    });

    it("DRY RUN reports what it would do and writes NOTHING", async () => {
        await seed([game("g1", { startTime: NOW + 2 * DAY })]);

        const result = await lockSpreadsOnce(admin.firestore(), NOW, { dryRun: true });

        expect(result.wouldLock).toBe(1);
        expect(result.locked).toBe(0);
        // The actual guarantee: the document is untouched.
        expect(await lockedState("g1")).toEqual({ value: -3.5, locked: false });
    });

    it("ignores games outside the 7-day window, in both directions", async () => {
        await seed([
            game("past", { startTime: NOW - HOUR }),
            game("far", { startTime: NOW + 8 * DAY }),
            game("inside", { startTime: NOW + 6 * DAY }),
        ]);

        const result = await lockSpreadsOnce(admin.firestore(), NOW, { dryRun: false });

        expect(result.locked).toBe(1);
        expect((await lockedState("inside"))?.locked).toBe(true);
        expect((await lockedState("past"))?.locked).toBe(false);
        expect((await lockedState("far"))?.locked).toBe(false);
    });

    it("skips games with no line and games already locked", async () => {
        await seed([
            game("noline", { startTime: NOW + DAY, spread: undefined }),
            game("already", { startTime: NOW + DAY, spread: { value: -7, locked: true } }),
            game("lockme", { startTime: NOW + DAY }),
        ]);

        const result = await lockSpreadsOnce(admin.firestore(), NOW, { dryRun: false });

        // Only the one genuinely lockable game counts — an already-locked game
        // must not be re-counted, or the log overstates what happened.
        expect(result.locked).toBe(1);
        expect((await lockedState("lockme"))?.locked).toBe(true);
        // Untouched: its frozen value must not be rewritten.
        expect(await lockedState("already")).toEqual({ value: -7, locked: true });
        expect(await lockedState("noline")).toBeUndefined();
    });

    it("locks a pick'em (value 0) — 0 is a real line, not a missing one", async () => {
        await seed([game("pickem", { startTime: NOW + DAY, spread: { value: 0, locked: false } })]);

        const result = await lockSpreadsOnce(admin.firestore(), NOW, { dryRun: false });

        expect(result.locked).toBe(1);
        expect(await lockedState("pickem")).toEqual({ value: 0, locked: true });
    });

    it("is idempotent — a second run finds nothing left to do", async () => {
        await seed([game("g1", { startTime: NOW + DAY })]);

        await lockSpreadsOnce(admin.firestore(), NOW, { dryRun: false });
        const second = await lockSpreadsOnce(admin.firestore(), NOW, { dryRun: false });

        expect(second.locked).toBe(0);
        expect(await lockedState("g1")).toEqual({ value: -3.5, locked: true });
    });

    it("returns an empty result when there are no upcoming games at all", async () => {
        const result = await lockSpreadsOnce(admin.firestore(), NOW, { dryRun: false });
        expect(result).toEqual({ locked: 0, wouldLock: 0, overflow: 0 });
    });
});
