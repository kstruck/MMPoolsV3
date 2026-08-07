import { describe, it, expect, beforeEach } from "vitest";
import * as admin from "firebase-admin";
import "./setup";
import { importNFLSeason, isWeekInImportScope, fetchNFLWeekSchedule } from "../../nflSchedule";
import type { NFLGame } from "../../types";

/**
 * importNFLSeason's cleanup delete must not reach outside the requested weeks.
 *
 * WHY THIS EXISTS. The cleanup query filtered on `season` + `seasonType` only
 * and then batch-deleted every match, regardless of which weeks the call asked
 * for — so `importNFLSeason('2026', 1, [2])` deleted the entire preseason and
 * re-imported one week. Nothing downstream could tell that apart from a week
 * that never existed, the deletes commit BEFORE the first fetch, and there are
 * no backups (PLAN-BACKUPS-PHASE3.md), so the loss was unrecoverable from inside
 * the app.
 *
 * It is tested HERE, against a real Firestore, rather than as a unit test of
 * `isWeekInImportScope`, because the predicate being correct proves nothing
 * about the call site using it — and a guard that looks like it guards and does
 * not is the exact failure this repo keeps rediscovering. These run the actual
 * exported function and then read the collection back.
 *
 * `fetchWeek` is stubbed so no ESPN call happens; that injection exists for this
 * test and production always uses the default.
 */

const SEASON = "2026";
const PRESEASON = 1 as const;

function game(id: string, week: number, over: Record<string, unknown> = {}) {
  return {
    id,
    espnGameId: id.replace(/^espn_/, ""),
    week,
    season: SEASON,
    seasonType: PRESEASON,
    homeTeam: { id: "1", name: "Home", abbreviation: "HOM", logoUrl: "" },
    awayTeam: { id: "2", name: "Away", abbreviation: "AWY", logoUrl: "" },
    startTime: 1_760_000_000_000 + week * 86_400_000,
    status: "SCHEDULED",
    clock: "0:00",
    period: 0,
    isMonday: false,
    ...over,
  } as unknown as NFLGame;
}

/**
 * Wipe what these cases write. `nfl_games` is the subject; the audit docs are
 * residue — `importNFLSeason` closes with a `writeAuditEvent` under
 * `pools/system/audit`, and this file is the only emulator suite that calls it.
 * Suites run sequentially (`fileParallelism: false`), so leaving that behind
 * would hand later ops/readiness suites documents they did not create.
 */
async function clearGames() {
  const db = admin.firestore();
  const [games, audit] = await Promise.all([
    db.collection("nfl_games").get(),
    db.collection("pools").doc("system").collection("audit").get(),
  ]);
  await Promise.all([...games.docs, ...audit.docs].map((d) => d.ref.delete()));
}

async function seed(games: NFLGame[]) {
  const db = admin.firestore();
  await Promise.all(
    games.map((g) => db.collection("nfl_games").doc(g.id).set(JSON.parse(JSON.stringify(g)))),
  );
}

/** Every stored id, so an assertion can name what survived AND what did not. */
async function storedIds(): Promise<string[]> {
  const db = admin.firestore();
  const snap = await db.collection("nfl_games").get();
  return snap.docs.map((d) => d.id).sort();
}

/**
 * A stub feed that serves a fixed slate per week and records what was asked for.
 *
 * Deliberately typed, not cast. An `as never`/`as any` here would let the stub
 * drift out of shape with `fetchNFLWeekSchedule` and still compile — and the
 * injection point exists precisely so this test drives the real signature.
 */
function stubFeed(byWeek: Record<number, NFLGame[]>) {
  const asked: number[] = [];
  const fetchWeek: typeof fetchNFLWeekSchedule = async (week) => {
    asked.push(week);
    return byWeek[week] ?? [];
  };
  return { fetchWeek, asked };
}

describe("importNFLSeason — the cleanup delete is scoped to the requested weeks", () => {
  beforeEach(async () => {
    await clearGames();
  });

  it("a single-week import does not remove another week's games", async () => {
    await seed([
      game("espn_w1_a", 1),
      game("espn_w1_b", 1),
      game("espn_w2_old", 2),
      game("espn_w3_a", 3),
    ]);

    const { fetchWeek, asked } = stubFeed({ 2: [game("espn_w2_new", 2)] });
    const res = await importNFLSeason(SEASON, PRESEASON, [2], { fetchWeek });

    expect(asked).toEqual([2]);
    expect(res).toEqual({ success: true, importedCount: 1 });
    // Week 2's stale doc is gone and its replacement is in. Weeks 1 and 3 are
    // untouched — before the scoping fix, all four ids were deleted and only
    // espn_w2_new came back.
    expect(await storedIds()).toEqual(["espn_w1_a", "espn_w1_b", "espn_w2_new", "espn_w3_a"]);
  });

  it("still purges stale ids INSIDE the requested week — the cleanup keeps its purpose", async () => {
    // ESPN re-keying an event is why the delete exists at all. Scoping it must
    // not turn the importer into an append-only merge.
    await seed([game("espn_stale", 2), game("espn_w1_keep", 1)]);

    const { fetchWeek } = stubFeed({ 2: [game("espn_rekeyed", 2)] });
    await importNFLSeason(SEASON, PRESEASON, [2], { fetchWeek });

    expect(await storedIds()).toEqual(["espn_rekeyed", "espn_w1_keep"]);
  });

  it("a multi-week import deletes exactly those weeks and no more", async () => {
    await seed([game("espn_w1", 1), game("espn_w2", 2), game("espn_w3", 3), game("espn_w4", 4)]);

    const { fetchWeek } = stubFeed({
      2: [game("espn_w2new", 2)],
      3: [game("espn_w3new", 3)],
    });
    await importNFLSeason(SEASON, PRESEASON, [2, 3], { fetchWeek });

    expect(await storedIds()).toEqual(["espn_w1", "espn_w2new", "espn_w3new", "espn_w4"]);
  });

  it("leaves another season and another seasonType alone", async () => {
    // The season+seasonType filter is still the outer bound; this pins that the
    // week scoping did not replace it.
    await seed([
      game("espn_preseason_w2", 2),
      game("espn_regular_w2", 2, { seasonType: 2 }),
      game("espn_2025_w2", 2, { season: "2025" }),
    ]);

    const { fetchWeek } = stubFeed({ 2: [game("espn_preseason_w2_new", 2)] });
    await importNFLSeason(SEASON, PRESEASON, [2], { fetchWeek });

    expect(await storedIds()).toEqual([
      "espn_2025_w2",
      "espn_preseason_w2_new",
      "espn_regular_w2",
    ]);
  });

  it("a week whose fetch returns nothing still deletes only that week", async () => {
    // Defect 2 in PLAN-IMPORTER-SAFETY.md is NOT fixed here: the delete commits
    // before the fetch, so an empty slate still leaves week 2 empty. What this
    // pins is that the hole is one week deep instead of a whole season.
    await seed([game("espn_w1", 1), game("espn_w2", 2)]);

    const { fetchWeek } = stubFeed({});
    const res = await importNFLSeason(SEASON, PRESEASON, [2], { fetchWeek });

    expect(res.importedCount).toBe(0);
    expect(await storedIds()).toEqual(["espn_w1"]);
  });

  it("an empty weeks list deletes nothing", async () => {
    await seed([game("espn_w1", 1), game("espn_w2", 2)]);

    const { fetchWeek, asked } = stubFeed({});
    await importNFLSeason(SEASON, PRESEASON, [], { fetchWeek });

    expect(asked).toEqual([]);
    expect(await storedIds()).toEqual(["espn_w1", "espn_w2"]);
  });

  it("matches a stored week written as a string, so a coercion gap cannot spare a doc", async () => {
    // A doc the import is about to overwrite must be deleted, not skipped —
    // otherwise a re-key inside the week leaves both fixtures live and ATS
    // submission blocks on the unlocked one.
    await seed([game("espn_str_w2", 2, { week: "2" })]);

    const { fetchWeek } = stubFeed({ 2: [game("espn_w2new", 2)] });
    await importNFLSeason(SEASON, PRESEASON, [2], { fetchWeek });

    expect(await storedIds()).toEqual(["espn_w2new"]);
  });
});

describe("isWeekInImportScope", () => {
  it("compares numerically across the string/number boundary", () => {
    expect(isWeekInImportScope({ week: 2 } as NFLGame, [1, 2])).toBe(true);
    expect(isWeekInImportScope({ week: "2" } as unknown as NFLGame, [2])).toBe(true);
    expect(isWeekInImportScope({ week: 2 } as NFLGame, ["2" as unknown as number])).toBe(true);
  });

  it("excludes weeks the run did not ask for", () => {
    expect(isWeekInImportScope({ week: 1 } as NFLGame, [2, 3])).toBe(false);
    expect(isWeekInImportScope({ week: 2 } as NFLGame, [])).toBe(false);
  });

  it("leaves a doc whose week is unusable alone", () => {
    // An unparseable week coerces to NaN and no comparison against NaN succeeds,
    // so the doc survives — the safe direction on a delete path. Asserted
    // because it is behaviour the call site depends on, not because a guard
    // implements it: a `Number.isFinite` guard written here first was removed
    // after a mutant proved its absence changed nothing.
    expect(isWeekInImportScope(undefined, [1, 2])).toBe(false);
    expect(isWeekInImportScope({} as NFLGame, [1, 2])).toBe(false);
    expect(isWeekInImportScope({ week: "wk2" } as unknown as NFLGame, [2])).toBe(false);
  });

  it("a week of 0 is only in scope when 0 was actually requested", () => {
    // `Number('')` and `Number(null)` are 0, not NaN. The schema forbids week 0
    // (`.positive()`), so this is unreachable from the callable — pinned so a
    // future internal caller passing 0 gets a defined answer rather than a
    // surprise.
    expect(isWeekInImportScope({ week: "" } as unknown as NFLGame, [1, 2])).toBe(false);
    expect(isWeekInImportScope({ week: "" } as unknown as NFLGame, [0])).toBe(true);
  });
});
