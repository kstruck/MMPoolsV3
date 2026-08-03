# Plan: Importer Safety — a week re-import must never destroy the rest of the season

_Compiled 2026-08-03 from code reading at `0f548bf` (the deployed application
source) plus the prod measurement recorded in `MORNING-2026-07-30.md` Task 3.
Terms per CONTEXT.md. Plan-gated under `mmp-change-control` §1: the importer
batch-deletes production `nfl_games` documents, which are scoring inputs._

> ⛔ **This document is the plan only. No code in this PR, and NO import was
> run while writing it — not even a dry run (there is no dry run; that absence
> is defect 4).** Executing any phase below is a separate, later PR with its
> own review. Re-importing production data remains Kevin's call.

## Implementation status (2026-08-03)

**NOT STARTED — plan locked, no phase implemented.**

## Goal

`importNFLSchedule` (SUPER_ADMIN callable) can be pointed at any week of any
season without risking data it was not asked to touch. Concretely: a re-import
scoped to week N deletes nothing outside week N; a fetch failure never converts
into a silent permanent hole; the callable's return value and audit event state
truthfully which weeks landed and which did not; and the destructive path is
behind the repo's standard kill-switch + dry-run-default gate.

## Evidence — the confirmed defects

All line numbers verified at `0f548bf`.

1. **(Critical) The cleanup delete ignores the `weeks` argument.**
   Evidence: `functions/src/nflSchedule.ts:362-380` — the "auto-cleanup" query
   filters on `season` + `seasonType` only, then batch-deletes every match,
   even when the call asked for a subset (`importNFLSeason(season, type,
   weeks=[3])` deletes weeks 1–18 and re-imports only week 3).
   `functions/src/schemas/nflSchedule.ts:11-15` already documents the behavior
   as "DESTRUCTIVE AND UNGATED" — the schema sweep (batch 17) tightened the
   envelope but deliberately left the behavior for its own review; this plan is
   that review.
   Why it matters: this is the mechanism by which **regular-season (seasonType
   2) week 1 held ZERO documents in prod** when measured on 2026-07-30
   (point-in-time count; re-measure before acting). It does not affect the HOF
   pilot (preseason, seasonType 1 — 49 games imported and intact), but the
   regular season begins in September and week 1 must exist by then.

2. **(Critical) A fetch failure after the delete leaves a silent hole.**
   Evidence: `fetchNFLWeekSchedule` catches every error and returns `[]`
   (`functions/src/nflSchedule.ts:182-185`); the import loop treats `[]` as
   "No games fetched … Skipping" and continues (`nflSchedule.ts:384-387`). The
   season-wide delete has already committed before the first fetch, so a
   transient ESPN failure on week N converts into week N ceasing to exist,
   with a log line as the only witness.
   Why it matters: the deletion is unrecoverable from within the app (no
   backups exist yet — `PLAN-BACKUPS-PHASE3.md`), and nothing downstream
   distinguishes "bye-ish empty week" from "week the importer lost".

3. **(High) No completeness check; the result always claims success.**
   Evidence: `importNFLSeason` returns `{ success: true, importedCount }`
   unconditionally (`nflSchedule.ts:412`); the audit event reports only the
   total count (`nflSchedule.ts:404-410`); the callable wraps it and reports
   `success: true` (`nflSchedule.ts:1056-1058`). A run that deleted 272
   documents and re-imported 30 reports success.
   Why it matters: the operator's only honest signal is reading function logs.
   The sync path already models the fix: `ScoreSyncResult` counts
   `slatesNotReconciled` as an explicit anomaly field with a documented
   rationale (`nflSchedule.ts:443-458`); the importer has no analogue.

4. **(High) No kill-switch, no dry run.** The repo's own non-negotiable rule
   (`mmp-change-control` rule 1, the `autoClosePools` pattern —
   `functions/src/autoClosePools.ts:11-15`) is: no prod-data mutation without
   kill-switch + dry-run-default. The importer predates the rule and has
   neither.

Sub-findings folded into phases below:

- **(Medium)** A cleanup **failure** is caught and the import proceeds anyway
  (`nflSchedule.ts:378-380`) — the one case where the delete is arguably
  wanted (purging orphaned/mismatched ids) silently degrades to a merge-only
  import.
- **(Low)** The delete uses a single `WriteBatch` (`nflSchedule.ts:371-375`);
  Firestore batches cap at 500 operations. A full regular-season slate is ~272
  docs today, so it fits, but nothing guards the margin.

### Sweep — every DELETE path against `nfl_games` (2026-08-03)

Ran `grep -rn "collection('nfl_games')" functions/src --include="*.ts"`
(30 non-test sites; most are reads) and cross-checked each hit's file for
`.delete(`. Deleters, exhaustively:

| Site | Operation | In scope? |
|---|---|---|
| `nflSchedule.ts:364-375` (`importNFLSeason` cleanup) | batch **delete**, season-wide | **YES — the defect** |
| `simHarness.ts:433-436` | batch delete, but the query is pinned to `simSeason(runId)` — synthetic sim seasons only | No — cannot match a real season |

Writers (all `merge: true` or sim-scoped, no deletes): the importer's own
write (`nflSchedule.ts:396-400`), the sync/deep-sweep path
(`nflSchedule.ts:662-729`, reviewed under PLAN-NFL7 / realtime-scoring),
`replayFeedSnapshot` (`feedReplay.ts:176`), `simHarness.ts:287` (sim ids),
and `migrations/backfillProfileData.ts:73`.

The importer is the only deleter that can touch a REAL season's documents.

## Approach

Three phases; each is independently shippable and independently reviewable.
Phase order is safety-first: gate the destructive path before improving it.

### Phase 0 — Gate the destructive path (Critical, small)

0.1 **Add `dryRun` defaulting to TRUE to `importNFLSchedule` /
    `importNFLSeason`.** A dry run performs the fetches, computes what would be
    deleted and written per week, and returns the full report (phase 2 shape)
    without touching Firestore. Live deletion requires an explicit
    `dryRun: false`. This intentionally changes behavior for the existing
    SuperAdmin UI caller (it will start dry-running until it passes the flag) —
    that is the fail-safe direction, and the UI update ships in the same PR.
    The schema note that optional-field defaults are load-bearing
    (`schemas/nflSchedule.ts:17-20`) stays true: `dryRun` is added as another
    optional field whose absence means the SAFE value.

### Phase 1 — Scope the delete to what was actually fetched (Critical, medium)

1.1 **Fetch first, delete after, per week.** Reorder: fetch all requested
    weeks; for each week whose fetch SUCCEEDED, delete only that week's
    existing docs (`.where('week','==',week)` added to the query) whose ids do
    not appear in the fetched set, then write the fetched games (`merge: true`
    keeps the existing id-keyed overwrite semantics). A week whose fetch
    failed is not touched at all — defect 2 becomes structurally impossible,
    not just less likely.
1.2 **Distinguish "fetch failed" from "week is genuinely empty".**
    `fetchNFLWeekSchedule`'s catch-all `[]` return (`nflSchedule.ts:182-185`)
    erases that distinction, and 1.1's "succeeded" needs it. Use a result that
    carries failure explicitly (the `fetchNFLWeekScheduleWithRaw` shape already
    distinguishes via `raw: null` — `nflSchedule.ts:193-206`) rather than
    inferring from emptiness.
1.3 **Chunk deletes at ≤400 ops per batch** while touching the code —
    removes the unguarded 500 ceiling for free.
1.4 **A cleanup failure aborts that week loudly** instead of the current
    catch-warn-continue (`nflSchedule.ts:378-380`).

### Phase 2 — Truthful completeness reporting (High, small)

2.1 **Return per-week outcomes.** Result shape gains
    `weeks: { week, fetched, deleted, written, failed }[]` and `success` is
    true only when every requested week either imported or was verifiably
    empty-from-feed. The callable surfaces the same shape.
2.2 **Audit event says what actually happened.** Severity `WARNING` when any
    week failed; message names the failed weeks, not just the total count
    (`nflSchedule.ts:404-410`).

### Phase 3 — Operator surface (Medium, small)

3.1 **SuperAdmin import UI shows the dry-run report before offering the live
    run.** Dry-run first, then a confirm that restates the per-week
    delete/write counts. Follows the Operations blast-radius-copy conventions
    (`docs/UI-REVAMP-GUIDE.md`).

## Key decisions & tradeoffs

- **Dry-run-by-default over a `system/config` kill-switch.** The importer is a
  manual SUPER_ADMIN callable, not a scheduled job — there is a human present
  on every invocation, so the explicit `dryRun:false` handshake is the right
  gate and a config document would be a second thing to forget. The
  `autoClosePools` config gate exists because nobody is present when a
  schedule fires; that rationale does not transfer.
- **Per-week scoped delete over delete-nothing.** The cleanup exists for a
  real reason (purging orphaned ids when ESPN re-keys an event — the doc
  comment at `nflSchedule.ts:362` and the season-lookup-key note in
  `schemas/nflSchedule.ts:22-25`). Removing it would trade a destructive bug
  for a slow-leak orphan bug. Scoping it to successfully-fetched weeks keeps
  the purpose and removes the blast radius.
- **No schema-required changes.** All new fields optional with safe defaults,
  per the load-bearing-defaults note already in the schema file.

## Risks / open questions

- **Week-1 restoration is an execution question, not a plan question.** After
  Phase 0–2 land, re-importing seasonType 2 week 1 (and re-measuring the whole
  season's per-week counts first) is a prod-data action — Kevin's call, run
  dry first, per the standing rule. Nothing in this plan performs it.
- **ESPN calendar drift.** `resolveScoreboardUrl` (`nflSchedule.ts:115-160`)
  maps `weeks[i]` to calendar entries positionally; if ESPN renumbers preseason
  weeks (HOF week = importer preseason week 1 — see
  `PICKUP-PRESEASON-PILOT.md`), a scoped delete scoped to the WRONG week is
  still scoped damage, vastly smaller than today's, but the mapping deserves a
  test in the implementing PR.
- **The importing PR must mutation-test the gate.** Per the standing rule:
  every guard added here gets a mutant that proves the test would catch its
  removal (e.g. delete the `dryRun` check, expect the dry-run test to fail).

## Out of scope

- **Running any import against prod** — tracked as the execution step above,
  owner-gated.
- **The sync/deep-sweep write paths** — reviewed under
  `PLAN-REALTIME-SCORING` / `PLAN-NFL7-CHAOS-FIXES`; the sweep table shows
  they delete nothing.
- **Backups/PITR** — `PLAN-BACKUPS-PHASE3.md`. Backups would soften defect 2
  but do not replace fixing it.
- **`replayFeedSnapshot`** — merge-only, separate review (A5).
