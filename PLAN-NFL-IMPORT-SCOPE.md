# PLAN — the schedule importer files games by ESPN's week, and touches only the weeks it was asked for

**Status: CODE COMPLETE, awaiting review. The DEPLOY and the follow-up data repair are gated on Kevin.**
Written overnight after the Hall of Fame game (which was **2026-08-06**, Thu
8:00pm ET), while diagnosing the mis-filed HOF week.

## 0. Why this is plan-gated

`mmp-change-control` §1 plan-gates a change touching **money, authorization,
production data, or scoring**. This is squarely **production data**: `importNFLSeason`
writes and DELETES `nfl_games` documents outside any user's normal flow, which is
the trigger's own wording. It is also the repair path for a live data defect, so
the plan doubles as the runbook.

Not money, not authorization, and it touches no scoring code — but what it writes
is the input every scoring path reads.

## 1. The defect, reproduced live

A commissioner's HOF Weekend Pick'em pool asked members to pick **seven** games.
Only one game is played that weekend.

Measured in production 2026-08-06, `nfl_games` season 2026 seasonType 1:

| week | stored | correct |
|---|---|---|
| 1 | **7** | 1 |
| 2 | **10** | 16 |
| 3 | 16 | 16 |
| 4 | 16 | 16 |

`10 + 6 = 16`. Six games kicking off **Aug 13–14** were filed into week 1:
`espn_401873272` (DET@CIN), `espn_401873275` (GB@PIT), `espn_401873273` (IND@NE),
`espn_401873274` (LAC@HOU), `espn_401873640` (ARI@LV), `espn_401874392` (TEN@SF).

The giveaway was ARI appearing twice on one sheet — against CAR and against LV.
A team cannot play twice in a week.

### Root cause

`importNFLSeason` does not query ESPN by week number. `resolveScoreboardUrl`
looks the week up in **ESPN's own calendar** and queries a DATE RANGE instead,
because the naive `week/season/seasontype` form silently falls back to the prior
season during the off-season.

Those calendar entries **overlap at the boundary**. Fetched live:

```
entries[0] "Hall of Fame Weekend"  2026-08-06 .. 2026-08-13
entries[1] "Preseason Week 1"      2026-08-13 .. 2026-08-20
```

So the week-1 import issues `dates=20260806-20260813` and gets **7 events** back.
Confirmed by replaying that exact URL:

Kickoffs below are ESPN's **UTC** timestamps, not calendar dates — the HOF game
is 2026-08-06 8:00pm ET, i.e. `2026-08-07T00:00Z`:

```
2026-08-07T00:00Z  espn week 1  CAR @ ARI
2026-08-13T23:00Z  espn week 2  DET @ CIN
2026-08-13T23:00Z  espn week 2  GB @ PIT
2026-08-13T23:30Z  espn week 2  IND @ NE
2026-08-14T00:00Z  espn week 2  ARI @ LV
2026-08-14T00:00Z  espn week 2  LAC @ HOU
2026-08-14T01:00Z  espn week 2  TEN @ SF
```

`parseScoreboardResponse` then stamped every one `week: week` — the **requested**
week. **ESPN reports the correct week on each event and we ignored it.**

Every calendar boundary overlaps, so this is systemic, not a one-off.

### The inconsistency that allowed it

`eventMatchesSeason`, twenty lines above the stamp, already had the right rule and
says so in its docblock: *"FAIL-OPEN on a MISSING field, fail-closed on a MISMATCH…
when the field IS present and disagrees, we trust it over our own arguments."*

Season and seasonType were validated against ESPN's answer. **Week was not.** That
asymmetry is the bug.

## 2. Two further defects found while diagnosing it

Both made re-import unusable as a repair tool — which matters, because
re-importing weeks 1 and 2 **is** the repair.

### 2a. The cleanup deleted the whole season type

```ts
.where('season','==',season).where('seasonType','==',seasonType).get()
… deleteBatch.delete(doc.ref)
```

`weeks` was ignored. So `importNFLSchedule(2026, 1, weeks:[2])` would have
**deleted all 49 preseason games** — including the Hall of Fame game, hours before
kickoff — then re-imported only week 2. Nothing in the signature hints at it;
`weeks` reads like a filter.

### 2b. It unlocked every spread

`parseScoreboardResponse` always emits `locked: false`, and the doc was deleted
first so `merge: true` could not save it. A re-import silently unlocked every line
a commissioner had locked — and an **ATS pool with an unlocked line refuses every
pick** with `SPREADS_NOT_LOCKED`. That is a pool nobody can enter.

## 3. The change

| # | Fix |
|---|---|
| 1 | **`eventWeekNumber(event, requestedWeek)`** — trusts `event.week.number`, falls back to the requested week when absent or nonsensical. Same fail-open convention as `eventMatchesSeason`. The parser now files by it. |
| 2 | **Cleanup scoped to the requested weeks** — filtered in memory from the same read, so no new composite index. |
| 3 | **Locked spreads preserved** — the stored doc is read first; if `spread.locked === true` the key is dropped from the payload so `merge: true` keeps what is stored. |
| 4 | **Orphan sweep runs only for weeks that actually returned a slate**, and only AFTER the writes. |
| 5 | **The existing-docs read fails CLOSED** — without it we can tell neither an orphan from another week's game nor which spreads are locked, so the import aborts rather than guessing. |
| 6 | **`opts.fetchWeek` injected**, so the write path is testable without a network call — the arrangement `syncScoresWindow.fetchSlate` already uses. |

## 4. Evidence

**`nflWeekStamping.test.ts` (9)** replays the real HOF-window payload — 1 week-1
event plus 6 week-2 events — and asserts they file into weeks 1 and 6.

**Mutation-checked.** Reverting only `week: eventWeekNumber(event, week)` back to
`week: week` fails exactly 3 of the 9, including *"never files a team twice in one
week"* — the symptom that exposed the bug in the UI.

**`importScope.emulator.test.ts` (6)** exercises the real write path against the
emulator: a week-2 import leaves weeks 1/3/4 intact; a locked spread survives;
an unlocked one still refreshes; a cancelled fixture is cleaned up but only in
scope; and an empty fetch does not empty the stored week.

> ⚠️ **That last case caught a bug in this very change.** The first revision
> swept orphans for every requested week including ones whose fetch returned
> nothing — so an ESPN outage would have emptied a stored week. The comment above
> it claimed that could not happen. The test disagreed and was right.

| Gate | Result |
|---|---|
| `npx tsc -b` | clean |
| `npm run lint` | 0 errors |
| root `vitest run` | 817 / 817 |
| `functions` typecheck | clean |
| `functions` `vitest run` | **1343 / 1343** (+9) |
| `functions` `test:emulator` | **312 passed** (+6), 2 expected-fail, 10 skipped |

## 5. Deploy — GATED ON KEVIN

This is a `functions/` change with **no `shared/` change**, so it owes a functions
deploy and **no rules deploy and no Coolify rebuild**.

It can ship in the same deploy as [#384](https://github.com/kstruck/MMPoolsV3/pull/384).
Steps are in `MORNING-2026-08-06.md` §3 — `npm --prefix functions ci` (**`ci`, not
`install`**), then `npx firebase deploy --only functions`, certified by a second
all-`Skipped` run.

## 6. The data repair, AFTER the deploy — GATED ON KEVIN

Deploying alone fixes nothing already stored. The six mis-filed games stay in week
1 until an import rewrites them.

**Once the hardened importer is live**, from SuperAdmin → NFL Schedule, run an
import for **season 2026, seasonType 1 (Preseason), weeks 1 and 2**.

With the fix in place that is now safe and sufficient:

- week 1's over-returning query still yields 7 events, but each is filed by
  ESPN's own number → 1 in week 1, 6 in week 2;
- weeks 3 and 4 are untouched, because the cleanup is scoped;
- the HOF game's locked **−1.5** survives, because locked spreads are preserved.

**Expected after:** week1 = 1, week2 = 16, week3 = 16, week4 = 16.

**Verify** by re-reading the counts before declaring it fixed, and by confirming
`espn_401873271` still has `spread.locked === true`.

⚠️ **Do NOT run this against the OLD importer.** It would delete all 49 preseason
games and wipe the locked spread.

### 6a. Re-score weeks 1 and 2 — the step the import does not do

Counts are not the finish line. Re-filing a game changes which slate a week is
scored against, and **nothing re-scores on its own**: `system/config.nflAutoScore`
is unset and `nflFinalize` / `nflSpreadLock` are `{enabled:true, dryRun:true}`, so
score INGESTION is automatic (`syncNFLScoresJob`, every 5 min, no kill switch) but
GRADING is not.

So after the import, from the pool's COMMISSIONER surface (the gear-icon button in
the pool header, right of INVITE LINK — there is no "Manager" tab), run **Score &
Recap for week 1 and then week 2** on every affected pool. Scoring is idempotent —
the Survivor `strikeWeeks` ledger has set semantics and `computeSurvivorWeekUpdate`
recomputes per `(entry, week)` — so re-clicking is safe.

Week 1 is the one that visibly changes: it holds a single FINAL game afterwards, so
`isWeekComplete` is satisfied and the pass stops being provisional. **"Week 1 scored
successfully." replacing "scored provisionally" is the confirmation the repair
landed**, and it is a stronger signal than the counts because it depends on slate
membership rather than on a number we could also have read wrong.

### 6b. Member picks — MEASURED, exposure is ZERO

_Measured against production <!-- hof-date:ignore --> 2026-08-07 ET, before the
repair. The tag is there because that is the measurement date, not the game date —
the Hall of Fame game is 2026-08-06._

Re-filing games can strand picks, and the counts in §6 would not show it. Two
mechanisms, both real, both measured against production before the repair:

1. **Confidence values are validated only at submit.**
   `validateConfidenceValues` runs inside `submitNFLPicks`
   (`functions/src/nflPools.ts:475`) and nowhere else; the legal set is
   `[17-N .. 16]`, unique, for N games in the week
   (`functions/src/nflScoringEngine.ts:183-186`). Scoring simply sums the stored
   values (`functions/src/nflScoringEngine.ts:165`) with no revalidation. Changing
   N can therefore leave a stored value out of range, or colliding with one already
   used in the destination week.
2. **Survivor and Margin picks are keyed by WEEK and hold a TEAM abbreviation**
   (`functions/src/nflPools.ts:546`, `:604`) — never a game id, so a pick does not
   follow its game across weeks. A stranded Survivor pick grades `survived: true`
   with no strike (`functions/src/nflScoringEngine.ts:266-267`); a stranded Margin
   pick returns `null` and the entry is `continue`d entirely — no `weeklyScores`
   write and no `-14` (`functions/src/nflScoringEngine.ts:377-382`,
   `functions/src/nflPools.ts:1271`, `:1289`).

**Measured with `.claude/skills/mmp-diagnostics-and-tooling/scripts/confidence-exposure-census.mjs`
and `…/confidence-exposure-detail.mjs`** (read-only; both refuse to run without
credentials rather than printing a zero, because an empty read from a
rules-restricted collection is not evidence of absence — an unauthenticated REST
read of `pools` returns 403 while `nfl_games` returns 200):

```
pools scanned: 134   NFL preseason pools: 7
games  week1 7 -> 1    week2 10 -> 16     six moving ids found in week 1: 6/6
legal confidence  week1 [10..16] -> [16..16]     week2 [7..16] -> [1..16]

(a) NFL_PICKEM pools with confidenceMode === true ......... 3
(b) confidence entries holding week 1 or 2 picks ........... 4
    of those, stored value out of range after the move .... 0
    of those, colliding value inside week 2 after ......... 0
(c) Survivor/Margin pools with a stranded week 1 pick ...... 0
```

Why each is zero, so the zeros can be read rather than trusted:

- **Confidence.** All four entries hold exactly one week-1 pick, on
  `espn_401873271`, at confidence **16** — with `0 MISSING` values, so the count is
  not the predicate skipping gaps. 16 is the only legal value in a one-game week,
  so every sheet is legal both before and after. Week 2 only *widens*
  (`[7..16]` → `[1..16]`), so nothing arriving there can fall out of range either.
- **Survivor / Margin.** The single surviving week-1 game is `espn_401873271`
  **CAR@ARI**, and the Margin entry in question picked **ARI** — which also plays
  the moving `espn_401873640` ARI@LV. ARI still has a week-1 game after the repair,
  so the pick resolves. The Survivor entry picked CAR, likewise still in week 1.
- **Nothing has been scored yet.** Every affected pool reads `scoredWeeks` unset,
  `publishedWeeks` unset, `scoredThroughWeek` unset, `weeklyScores` empty,
  `seasonTotal` 0. This matters because a stale per-week value **survives** a
  re-score: the scorer `continue`s a stranded entry and writes nothing, while
  `seasonTotal` re-sums the whole map (`functions/src/nflPools.ts:1302`). With
  nothing banked, there is nothing to go stale.

⚠️ **A first version of the census reported (c) = 1 and that was a FALSE POSITIVE.**
It tested "is this team in a moving game", which flags ARI. The correct test is
"is this team in a moving game **and** left with no game in the week afterwards".
Recorded because the same trap is waiting for anyone who re-runs this analysis for
a different re-file.

**Re-run both scripts before any FUTURE re-file** — in particular the regular-season
week-1 restoration that `PLAN-IMPORTER-SAFETY.md` defect 1 describes, where
`seasonType 2` week 1 held zero documents. That one lands mid-season with picks and
scores already banked, and none of the three reasons above will hold.

### 6c. One ambiguity the repair silently FIXES

Week 1 currently contains **both** `espn_401873271` CAR@**ARI** and
`espn_401873640` **ARI**@LV. `scoreMarginWeek` resolves a pick with
`gamesInWeek.find(g => g.homeTeam.abbreviation === pick || g.awayTeam.abbreviation === pick)`
(`functions/src/nflScoringEngine.ts:376-378`) — a *first match by array order*. So a
Margin pick of ARI is, today, graded against whichever of the two games the query
happened to return first. There is one such entry.

After the repair week 1 holds one ARI game and the ambiguity is gone. No action
needed; noted so that a grade which changes across the repair is not mistaken for a
regression.

## 7. Rollback

Revert the merge and redeploy functions. The code change is pure logic — no
migration, no schema change. Data already repaired by §6 stays repaired and is
correct regardless; the old importer would simply be capable of re-breaking it.
