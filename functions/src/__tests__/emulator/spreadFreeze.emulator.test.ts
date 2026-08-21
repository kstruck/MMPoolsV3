import { describe, it, expect, beforeEach } from "vitest";
import * as admin from "firebase-admin";
import "./setup";
import { freezeSlateOnce } from "../../nflSpreadFreeze";
import { FROZEN_SPREADS_COLLECTION, type FrozenSpread } from "../../shared/frozenSpread";
import { SLATE_LEASES, acquireSlateLease } from "../../lib/slateLease";
import { slateDocId } from "../../lib/spreadFreeze";
import { importNFLSeason } from "../../nflSchedule";

/**
 * `freezeSlateOnce` write-path coverage (PLAN-NFL-SPREAD-FREEZE Phase 1).
 *
 * WHY THIS EXISTS, in the words of the file it replaces: before `spreadLock.emulator.test.ts`
 * the only tests touching spread locking were pure ones, and the transition
 * itself had never been executed. The same argument applies harder now — this
 * pass writes a collection that becomes the canonical grading input for every ATS
 * pool, and R2 of the plan says the dry run rehearses nothing that matters
 * because it writes nothing by design. This is the test that exercises the
 * transaction, the write, and the state the slate is left in.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SLATE = { season: "2026", seasonType: 1 as const, week: 4 };

/**
 * A FIXED clock, and it has to be: a live freeze is refused before the slate's
 * stated Tuesday-09:00-ET cutoff, so a test that used the real `Date.now()` would
 * pass on a Wednesday and fail on a Monday.
 *
 * 2026-08-25 14:00Z is Tuesday 10:00 ET — an hour past the cutoff, which is the
 * real rehearsal instant R2 of the plan names.
 */
const NOW = Date.UTC(2026, 7, 25, 14, 0, 0);

async function clearAll() {
    const db = admin.firestore();
    for (const col of ["nfl_games", FROZEN_SPREADS_COLLECTION, SLATE_LEASES]) {
        const snap = await db.collection(col).get();
        await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
}

/**
 * Passing `spread: undefined` OMITS the field rather than writing undefined —
 * Firestore rejects undefined outright, and "no spread field at all" is the real
 * preseason shape.
 */
function game(id: string, over: Record<string, unknown> = {}) {
    const g: Record<string, unknown> = {
        id,
        ...SLATE,
        startTime: NOW + 2 * DAY,
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

/** A stand-in for the ESPN fetch, so no test here touches the network. */
const feed = (lines: Record<string, number | null>) => async () =>
    Object.entries(lines).map(([id, value]) => ({
        id, ...SLATE, spread: value === null ? undefined : { value },
    }));

async function frozenRecords(): Promise<FrozenSpread[]> {
    const snap = await admin.firestore().collection(FROZEN_SPREADS_COLLECTION).get();
    return snap.docs.map((d) => d.data() as FrozenSpread).sort((a, b) => a.gameId.localeCompare(b.gameId));
}

describe("freezeSlateOnce (emulator) — the write path", () => {
    beforeEach(clearAll);

    it("freezes the whole slate from the feed and stamps source=freeze", async () => {
        await seed([game("g1"), game("g2", { startTime: NOW + 3 * DAY })]);
        const result = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false,
            fetchWeek: feed({ g1: -6.5, g2: 2 }),
        });

        expect(result).toMatchObject({ ok: true, slate: "2026/1/4", frozen: 2 });
        const records = await frozenRecords();
        expect(records.map((r) => [r.gameId, r.value, r.source])).toEqual([
            ["g1", -6.5, "freeze"],
            ["g2", 2, "freeze"],
        ]);
        // The slate key rides on every record: the client subscribes by `season`,
        // selection queries the triple, and a delete trigger can only recover it
        // from the record's own copy.
        expect(records[0]).toMatchObject({ season: "2026", seasonType: 1, week: 4 });
        expect(records[0].frozenAt).toBeGreaterThan(0);
    });

    it("LEAVES nfl_games.spread ALONE — the working line is not the freeze's business", async () => {
        await seed([game("g1", { spread: { value: -3.5, locked: false } })]);
        await freezeSlateOnce(admin.firestore(), NOW, { dryRun: false, fetchWeek: feed({ g1: -6.5 }) });
        const stored = (await admin.firestore().collection("nfl_games").doc("g1").get()).data();
        expect(stored?.spread).toEqual({ value: -3.5, locked: false });
    });

    it("dry run writes NOTHING and reports every value it would write", async () => {
        await seed([game("g1"), game("g2")]);
        const result = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: true,
            fetchWeek: feed({ g1: -6.5, g2: 2 }),
        });
        expect(result).toMatchObject({ ok: true, dryRun: true, frozen: 0, wouldFreeze: 2 });
        expect(result.writes).toEqual([
            { gameId: "g1", value: -6.5, from: "feed" },
            { gameId: "g2", value: 2, from: "feed" },
        ]);
        expect(await frozenRecords()).toEqual([]);
    });

    it("falls back to the stored working line, which is the manual backstop", async () => {
        await seed([game("g1"), game("g2", { spread: { value: 1.5, locked: false } })]);
        const result = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false,
            fetchWeek: feed({ g1: -6.5, g2: null }),
        });
        expect(result.frozen).toBe(2);
        expect((await frozenRecords()).map((r) => r.value)).toEqual([-6.5, 1.5]);
    });

    it("REFUSES A PARTIAL SLATE AND WRITES NOTHING AT ALL", async () => {
        await seed([game("g1"), game("g2", { spread: undefined })]);
        const result = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false,
            fetchWeek: feed({ g1: -6.5, g2: null }),
        });
        expect(result.ok).toBe(false);
        expect(result.noLine).toEqual(["g2"]);
        // Not "g1 is frozen and g2 is not" — nothing.
        expect(await frozenRecords()).toEqual([]);
    });

    it("IS A NO-OP ON THE SECOND RUN — a slate is freezable exactly once", async () => {
        await seed([game("g1"), game("g2")]);
        const first = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false, fetchWeek: feed({ g1: -6.5, g2: 2 }),
        });
        expect(first.frozen).toBe(2);

        // A second pass, with the lines MOVED. If selection ever regressed, this is
        // what it would look like: the same week re-frozen at a second instant.
        const second = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false, fetchWeek: feed({ g1: -1, g2: 9 }),
        });
        expect(second.frozen).toBe(0);
        expect(second.reason).toContain("no slate is due");
        expect((await frozenRecords()).map((r) => r.value)).toEqual([-6.5, 2]);
    });

    it("does not walk forward to the next week when the due slate is already frozen", async () => {
        // Codex round 8's defect, end to end: week 4 frozen, week 5 nine days out.
        // The horizon is what keeps the pass from freezing week 5 a week early.
        await seed([game("g1"), game("wk5", { week: 5, startTime: NOW + 9 * DAY })]);
        await freezeSlateOnce(admin.firestore(), NOW, { dryRun: false, fetchWeek: feed({ g1: -6.5 }) });
        const second = await freezeSlateOnce(admin.firestore(), NOW, { dryRun: false, fetchWeek: feed({ wk5: -4 }) });
        expect(second.frozen).toBe(0);
        expect((await frozenRecords()).map((r) => r.gameId)).toEqual(["g1"]);
    });

    it("REFUSES when a game joins the slate between the fetch and the commit", async () => {
        // Codex r3 on this PR. The lease serialises the freeze against the
        // IMPORTER; `syncScoresWindow` takes no lease and must not be made to, so
        // it can still create a spillover game inside a slate — and a manual retry
        // of a refused freeze can legitimately run inside its 2-hour window. The
        // transaction re-reads the stored slate and refuses rather than freezing
        // the old game set and leaving the newcomer blocking ATS submission.
        await seed([game("g1")]);
        const racingFeed = async () => {
            await seed([game("newcomer")]);
            return [{ id: "g1", ...SLATE, spread: { value: -6.5 } }];
        };

        await expect(
            freezeSlateOnce(admin.firestore(), NOW, { dryRun: false, fetchWeek: racingFeed }),
        ).rejects.toThrow(/SLATE_CHANGED/);
        expect(await frozenRecords()).toEqual([]);
    });

    it("steps aside when another pass holds the slate lease", async () => {
        await seed([game("g1")]);
        const held = await acquireSlateLease(admin.firestore(), SLATE, Date.now());
        expect(held).not.toBeNull();

        const result = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false, fetchWeek: feed({ g1: -6.5 }),
        });
        // ok:false, because the schedule fires once a week: a contended run that
        // reported success would record a healthy heartbeat and leave the slate
        // unfrozen until the following Tuesday, past kickoff for the whole week.
        expect(result).toMatchObject({ ok: false, leaseBusy: true, frozen: 0 });
        expect(await frozenRecords()).toEqual([]);
    });

    it("releases the lease afterwards, so the next run is not locked out by its predecessor", async () => {
        await seed([game("g1")]);
        await freezeSlateOnce(admin.firestore(), NOW, { dryRun: false, fetchWeek: feed({ g1: -6.5 }) });
        const lease = (await admin.firestore().collection(SLATE_LEASES).doc(slateDocId(SLATE)).get()).data();
        expect(lease?.until).toBe(0);
    });

    it("releases the lease even when the pass REFUSES", async () => {
        await seed([game("g1", { spread: undefined })]);
        const result = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false, fetchWeek: feed({ g1: null }),
        });
        expect(result.ok).toBe(false);
        const lease = (await admin.firestore().collection(SLATE_LEASES).doc(slateDocId(SLATE)).get()).data();
        expect(lease?.until).toBe(0);
    });

    it("REFUSES A LIVE FREEZE BEFORE THE SLATE'S STATED CUTOFF, but still rehearses it", async () => {
        // Codex r6 on this PR. 1.6 promises members Tuesday 09:00 ET. Without this
        // gate a live manual run on the Sunday before would commit the slate
        // permanently, and the Tuesday job would then skip it as already frozen —
        // the stated instant quietly not honoured, by the tool built to repair it.
        const SUNDAY = Date.UTC(2026, 7, 23, 18); // 14:00 ET, two days before the cutoff
        const THURSDAY = Date.UTC(2026, 7, 27, 23);
        await seed([game("g1", { startTime: THURSDAY })]);

        const live = await freezeSlateOnce(admin.firestore(), SUNDAY, {
            dryRun: false, fetchWeek: feed({ g1: -6.5 }),
        });
        expect(live.ok).toBe(false);
        expect(live.reason).toContain("stated cutoff");
        expect(await frozenRecords()).toEqual([]);

        // A DRY run on the same Sunday is exactly what R2's rehearsal asks for and
        // is unrestricted — it writes nothing.
        const dry = await freezeSlateOnce(admin.firestore(), SUNDAY, {
            dryRun: true, fetchWeek: feed({ g1: -6.5 }),
        });
        expect(dry).toMatchObject({ ok: true, wouldFreeze: 1 });
        expect(await frozenRecords()).toEqual([]);
    });

    it("FORCE skips the stated cutoff and freezes for real", async () => {
        // Kevin, 2026-08-21: regular-season week 1 has no games before it, so the
        // Tuesday cadence — which exists to let the previous week finish — buys
        // nothing there, and the 2026 opener is a Wednesday (a 35-hour pick window
        // against ~59 for every other week).
        const SUNDAY = Date.UTC(2026, 7, 23, 18); // two days BEFORE the cutoff
        const THURSDAY = Date.UTC(2026, 7, 27, 23);
        await seed([game("g1", { startTime: THURSDAY })]);

        const result = await freezeSlateOnce(admin.firestore(), SUNDAY, {
            dryRun: false, force: true, fetchWeek: feed({ g1: -6.5 }),
        });
        expect(result).toMatchObject({ ok: true, frozen: 1 });
        expect((await frozenRecords())[0]).toMatchObject({ value: -6.5, source: "freeze" });
    });

    it("force skips the cutoff and NOTHING ELSE — a frozen slate stays refused", async () => {
        await seed([game("g1")]);
        await freezeSlateOnce(admin.firestore(), NOW, { dryRun: false, fetchWeek: feed({ g1: -6.5 }) });
        const second = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false, force: true, fetchWeek: feed({ g1: -1 }),
        });
        expect(second.frozen).toBe(0);
        expect((await frozenRecords())[0].value).toBe(-6.5);
    });

    it("force alone does NOT reach past the horizon — that is what a named slate is for", async () => {
        // The horizon is part of "is this slate due", so a forced run with no target
        // still cannot reach a slate more than 7 days out. This is the constraint
        // that made `target` necessary rather than optional.
        const FAR = { ...SLATE, week: 9 };
        await seed([game("far", { ...FAR, startTime: NOW + 20 * DAY })]);
        const forced = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false, force: true, fetchWeek: feed({ far: -3 }),
        });
        expect(forced.frozen).toBe(0);
        expect(await frozenRecords()).toEqual([]);

        const targeted = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false, force: true, target: FAR,
            fetchWeek: (async () => [{ id: "far", ...FAR, spread: { value: -3 } }]) as never,
        });
        expect(targeted).toMatchObject({ ok: true, frozen: 1, slate: "2026/1/9" });
    });

    it("a NAMED slate that cannot be frozen reports ok:false, not idle", async () => {
        // An auto-selected run finding nothing due is the normal state of a Tuesday
        // in February. An operator naming a slate and not getting it is a request
        // that failed, and it should read as one.
        await seed([game("gone", { startTime: NOW - DAY })]);
        const res = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false, force: true, target: SLATE, fetchWeek: feed({ gone: -3 }),
        });
        expect(res).toMatchObject({ ok: false, slate: "2026/1/4", frozen: 0 });
        expect(res.reason).toContain("first kickoff has passed");
    });

    it("does nothing, and says so, when no slate is inside the horizon", async () => {
        await seed([game("far", { startTime: NOW + 30 * DAY })]);
        const result = await freezeSlateOnce(admin.firestore(), NOW, { dryRun: false, fetchWeek: feed({}) });
        expect(result).toMatchObject({ ok: true, slate: null, frozen: 0 });
    });

    it("will not freeze a slate whose first kickoff has already passed", async () => {
        await seed([
            game("thu", { startTime: NOW - HOUR }),
            game("sun", { startTime: NOW + 3 * DAY }),
        ]);
        const result = await freezeSlateOnce(admin.firestore(), NOW, {
            dryRun: false, fetchWeek: feed({ thu: -3, sun: -3 }),
        });
        expect(result.frozen).toBe(0);
        expect(await frozenRecords()).toEqual([]);
    });
});

describe("importNFLSeason (emulator) — the importer's half of the mutex", () => {
    beforeEach(clearAll);

    /** The importer's fetch shape: full NFLGame-ish documents, not just a line. */
    const importFeed = (ids: string[]) => (async () =>
        ids.map((id) => game(id))) as unknown as typeof import("../../nflSchedule").fetchNFLWeekSchedule;

    it("SKIPS a week whose slate lease a freeze is holding, and reports it", async () => {
        // Codex r1 on this PR: a read-only "is it held?" check serialised nothing —
        // an import that observed no lease could still be fetching when the freeze
        // acquired one, and commit its batch afterwards. If that batch ADDS a game,
        // the freeze has already reconciled without it and the newcomer stays
        // unfrozen, which is the partial slate the lease exists to prevent. The
        // importer takes the lease for the whole fetch-and-write instead.
        const held = await acquireSlateLease(admin.firestore(), SLATE, Date.now());
        expect(held).not.toBeNull();

        const res = await importNFLSeason(SLATE.season, SLATE.seasonType, [SLATE.week], {
            fetchWeek: importFeed(["newcomer"]),
        });
        expect(res.leaseBusyWeeks).toEqual([SLATE.week]);
        expect(res.importedCount).toBe(0);
        expect((await admin.firestore().collection("nfl_games").get()).empty).toBe(true);
    });

    it("SKIPS the whole fetch when the response SPILLS into a slate a freeze holds", async () => {
        // Codex r4 on this PR. `parseScoreboardResponse` lets the event's own week
        // win over the requested one, and ESPN's scoreboard is unreliable about
        // which slate it returns — so a lease on the requested week alone leaves a
        // concurrent freeze of the NEIGHBOURING slate free to commit against its
        // old game set while this import adds a game to it.
        const heldNext = await acquireSlateLease(
            admin.firestore(), { ...SLATE, week: SLATE.week + 1 }, Date.now(),
        );
        expect(heldNext).not.toBeNull();

        const res = await importNFLSeason(SLATE.season, SLATE.seasonType, [SLATE.week], {
            fetchWeek: (async () => [
                game("thisWeek"),
                game("spillover", { week: SLATE.week + 1 }),
            ]) as unknown as typeof import("../../nflSchedule").fetchNFLWeekSchedule,
        });

        expect(res.leaseBusyWeeks).toEqual([SLATE.week]);
        // NOTHING, not just the spillover game: all-or-nothing, same philosophy as
        // the freeze itself.
        expect((await admin.firestore().collection("nfl_games").get()).empty).toBe(true);
    });

    it("imports a spillover slate when nothing holds it", async () => {
        const res = await importNFLSeason(SLATE.season, SLATE.seasonType, [SLATE.week], {
            fetchWeek: (async () => [
                game("thisWeek"),
                game("spillover", { week: SLATE.week + 1 }),
            ]) as unknown as typeof import("../../nflSchedule").fetchNFLWeekSchedule,
        });
        expect(res.leaseBusyWeeks).toEqual([]);
        expect(res.importedCount).toBe(2);
    });

    it("imports normally once the lease is free, and hands it back", async () => {
        const res = await importNFLSeason(SLATE.season, SLATE.seasonType, [SLATE.week], {
            fetchWeek: importFeed(["g1"]),
        });
        expect(res.leaseBusyWeeks).toEqual([]);
        expect(res.importedCount).toBe(1);
        const lease = (await admin.firestore().collection(SLATE_LEASES).doc(slateDocId(SLATE)).get()).data();
        expect(lease?.until).toBe(0);
    });
});
