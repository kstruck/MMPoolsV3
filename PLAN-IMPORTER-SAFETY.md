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

### Sweeps

The deterministic enumerations feeding this plan (every `nfl_games` delete
and write site, every `spread.locked` writer, every pick-reference reader)
live in `PLAN-IMPORTER-SAFETY-SWEEPS.md` (moved to the standalone artifact
per codex r2 #3). Headline result: **the importer is the only deleter that
can touch a REAL season's documents**, and it is the only `nfl_games` writer
with no locked-spread preservation.

## Approach

Three phases; each is independently shippable and independently reviewable.
Phase order is safety-first: gate the destructive path before improving it.

### Phase 0 — Gate the destructive path (Critical, small)

0.1 **Add `dryRun` defaulting to TRUE to `importNFLSchedule` /
    `importNFLSeason`.** A dry run performs the fetches, computes what would be
    deleted and written per week, and returns the full report (phase 2 shape)
    with **zero mutations to `nfl_games`** — stated that way, not "without
    touching Firestore", because computing the would-delete set requires
    READING the existing docs, and both dry and live runs persist an
    actor-attributed audit record so the operator review has durable evidence
    (broadened per codex r1 #5). Live deletion requires an explicit
    `dryRun: false`. This intentionally changes behavior for the existing
    SuperAdmin UI caller (it will start dry-running until it passes the flag) —
    that is the fail-safe direction, and the UI update ships in the same PR.
    The schema note that optional-field defaults are load-bearing
    (`schemas/nflSchedule.ts:17-20`) stays true: `dryRun` is added as another
    optional field whose absence means the SAFE value.
0.2 **Kill-switch config gate: `system/config.nflImport.enabled`.** A live run
    (`dryRun: false`) refuses unless the flag reads exactly `true`; a config
    read FAILURE also refuses (fail-closed, the `configReadFailedVerdict`
    shape the scheduled jobs already use — `nflSchedule.ts:1005-1015`). Dry
    runs are permitted regardless — they mutate nothing. Added per codex r2
    #2: rule 1 requires both layers, and the flag is the global halt lever an
    incident responder can flip without racing a SUPER_ADMIN's click
    (see Key decisions).

### Phase 1 — Scope the delete to what was actually fetched (Critical, medium)

1.1 **Per week: check EVERYTHING, then write, then (only if explicitly asked)
    purge.** The pipeline for each requested week: fetch; run ALL
    preconditions — the 1.2 integrity and week-identity checks, the 1.6
    reference scan over the computed stale-id set, the 1.3 caps — **before
    any mutation commits** (checks-before-writes per codex r3 #3: a refusal
    discovered after the upserts would leave a re-keyed duplicate fixture
    live); if every check passes, write the fetched games (`merge: true`
    keeps the id-keyed overwrite semantics, subject to 1.5); stale docs
    (`.where('week','==',week)` added to the query, ids absent from the
    fetched set) are deleted LAST, and **only when the call carries an
    explicit `purgeStale: true`** — a default live run is upsert-only and
    deletes nothing (restructured per codex r3 #1: no automatic signal can
    distinguish "ESPN re-keyed this game" from "ESPN's response was
    truncated", so removing stored games is always an operator decision made
    against a dry-run report). A `purgeStale` week commits its writes and
    deletes in ONE atomic `WriteBatch` — an NFL week is ≤16 games each way,
    far under Firestore's 500-op batch limit, and if a week's combined ops
    ever exceeded it the run refuses rather than splitting (codex r4 #1:
    a write commit followed by a failed delete commit leaves both the old
    and re-keyed fixture live, and week queries would score the matchup
    twice). Upsert-only runs keep plain write-before-nothing ordering — a
    failure at ANY point leaves the week no worse than before the run
    (codex r1 #1). The implementing PR must include a test that an injected
    commit failure preserves the prior slate. A week whose fetch failed is
    not touched at all.
1.2 **A usable slate, not just a 200 response, gates the delete.**
    `fetchNFLWeekSchedule`'s catch-all `[]` return (`nflSchedule.ts:182-185`)
    erases the failed/empty distinction, and a non-null `raw`
    (`fetchNFLWeekScheduleWithRaw`, `nflSchedule.ts:193-206`) only proves JSON
    arrived — `parseScoreboardResponse` also returns `[]` for malformed
    payloads and when the PR #219 season guard filters every event (the
    wrong-season fallback shape documented at `nflSchedule.ts:443-458`).
    Deletion for a week therefore requires ALL of (broadened per codex r1 #2
    and r2 #1 — a non-empty parse is still not a usable slate, because the
    parser drops malformed events individually and one surviving event would
    pass a non-empty check while the subtraction deletes every other stored
    game as "stale"):
    - the fetch succeeded (non-null raw);
    - the parsed set is non-empty;
    - **fail-closed slate completeness**: every ELIGIBLE event in the raw
      payload parsed successfully — eligible meaning it passes the same
      season/seasonType filter the parser applies (`eventMatchesSeason`,
      `nflSchedule.ts:227-232`, the PR #219 guard). The comparison is
      parsed count == eligible-event count, NOT raw-event count: a calendar
      date range is documented to legitimately include a neighboring
      season's opener (the regular-season opener caught by the preseason
      week-3 range — `nflSchedule.ts:252-265`), and counting that
      correctly-filtered event as a parse loss would reject a valid
      response (codex r4 #2). Any eligible event that fails to parse =
      refuse. This detects PARSER loss only — it cannot detect a
      syntactically valid feed the upstream truncated (codex r3 #1), which
      is why stale deletion is never automatic (1.1's `purgeStale` flag);
    - **week identity**: every parsed game's kickoff falls inside the
      calendar-resolved date range for the requested week — the range
      `resolveScoreboardUrl` already fetches from ESPN's own calendar
      (`nflSchedule.ts:115-160`). The parser deliberately stamps the
      REQUESTED week onto whatever events arrive
      (`nflSchedule.ts:252-265` and the test at
      `__tests__/feedSnapshot.test.ts:165`), so if ESPN's positional
      calendar mapping drifts, a coherent WRONG week would otherwise be
      stamped as the requested one and its purge would delete the real slate
      (codex r3 #2). When the calendar lookup itself failed (the naive-URL
      fallback), this check cannot run — refuse the live replacement;
    - the would-delete set is small (bounded by the 1.3 cap) — a delete list
      larger than a handful of ids on one week is a mis-scope signal, not a
      cleanup.
    A genuinely game-less week ("delete everything, feed says empty") is
    never inferred — it needs an explicit per-call operator flag, and a dry
    run first like everything else.
1.3 **Cap TOTAL mutations per run, and chunk deletes at ≤400 ops per batch.**
    The chunking removes the unguarded 500-op ceiling; the run-level cap
    (deletes + writes, checked BEFORE the first live mutation, failing with an
    overflow report) bounds the blast radius of a mis-scoped query the way
    `MAX_SPREAD_LOCKS_PER_RUN` does for the spread job
    (`nflSchedule.ts:976-985`) (broadened per codex r1 #6).
1.4 **A cleanup failure aborts that week loudly** instead of the current
    catch-warn-continue (`nflSchedule.ts:378-380`).
1.5 **Preserve locked spreads on re-import — including across a re-key.**
    The parser emits every game with `spread: { value, locked: false }`
    (`nflSchedule.ts:342`), so the `merge: true` write would silently UNLOCK
    a locked ATS slate and block pick submission behind `SPREADS_NOT_LOCKED`
    — the exact bug class #235 fixed in the sync path, which now retains
    `spread.locked` (`nflSchedule.ts:746-750`). The importer write must apply
    the same preservation (codex r1 #4). The same-id lookup has a hole the
    sync path never faces (codex r3 #4): on a purge-and-replace re-key, the
    NEW id has no existing doc to preserve from, and the OLD locked doc is
    the one being purged. A `purgeStale` run must therefore match each
    to-be-purged locked game against its replacement (same teams + kickoff,
    different id) and carry the locked spread value onto it — or refuse that
    week's purge.
1.6 **A stored id that is referenced by picks is never deleted blind.**
    Pick'em scoring reads `entry.picks[game.id]`
    (`functions/src/nflScoringEngine.ts:108`), so deleting a game id that
    entries reference — ESPN re-keying an event is the motivating case —
    strands those picks ungradable. The stale-id set and its reference scan
    are computed BEFORE any write commits (1.1's ordering — codex r3 #3);
    if any stale id is referenced, the run REFUSES that week before touching
    it and reports the ids, leaving reference migration as an explicit
    operator decision (codex r1 #3). Only Pick'em entries key picks by game
    id (see Sweep 3) — Survivor/Margin are structurally immune. No automatic
    pick migration in this plan.
1.7 **A score-bearing import enqueues rescoring the way the sync path does.**
    The importer writes ESPN statuses and scores, so re-importing an
    already-scored week can correct a final or flip a game terminal — and
    because the importer overwrites the document, the NEXT sync sees no
    transition and pool standings stay stale (codex r4 #3). The sync path
    already solves this: it diffs prior state and rides the rescore handoff
    IN the same batch as the game writes
    (`nflSchedule.ts:776-790`, `lib/rescoreQueue.ts`). The importer must
    reuse that same prior-state comparison and enqueue mechanism for any
    write that changes a score-relevant field on a previously-stored game.
    (The queue's CONSUMER staying armed or not remains Kevin's — enqueueing
    is inert until the rescore path is armed, same as for the sync path.)
1.8 **Every new control rides through the strict schema.**
    `importNFLScheduleSchema` is `z.strictObject` — an unlisted field
    REJECTS the request before the handler runs (codex r4 #4). The
    implementing PR adds `dryRun`, `purgeStale`, and the 1.2 empty-week
    override as named optional fields with safe-when-absent defaults, in
    the schema, the service-layer types, and the SuperAdmin UI contract
    together.

### Phase 2 — Truthful completeness reporting (High, small)

2.1 **Return per-week outcomes.** Result shape gains
    `weeks: { week, fetched, written, staleIds, purged, refused, failed }[]`
    and `success` is true only when every requested week imported (or was
    skipped under the explicit empty-week flag of 1.2) — a refused or failed
    week forces `success: false`. "Verifiably empty-from-feed" is not a
    success state; 1.2 forbids inferring it.
2.2 **Audit event says what actually happened.** Severity `WARNING` when any
    week failed; message names the failed weeks, not just the total count
    (`nflSchedule.ts:404-410`).

### Phase 3 — Operator surface (Medium, small)

3.1 **SuperAdmin import UI shows the dry-run report before offering the live
    run.** Dry-run first, then a confirm that restates the per-week
    delete/write counts. Follows the Operations blast-radius-copy conventions
    (`docs/UI-REVAMP-GUIDE.md`).

## Key decisions & tradeoffs

- **Dry-run-by-default AND a `system/config` kill-switch — both layers.** The
  first draft rejected the config gate on "a human is present" grounds; codex
  r2 #2 is right that rule 1 (`mmp-change-control`) requires both, and the
  config gate is what lets an incident responder halt live imports globally
  without racing a SUPER_ADMIN's click. Phase 0 therefore also adds
  `system/config.nflImport.enabled` — default OFF/absent = live runs refused
  (dry runs still permitted, they mutate nothing). Kevin flips it once when
  the implementing PR deploys; the flag is a halt lever, not a per-run
  ceremony.
- **Per-week scoped delete over delete-nothing.** The cleanup exists for a
  real reason (purging orphaned ids when ESPN re-keys an event — the doc
  comment at `nflSchedule.ts:362` and the season-lookup-key note in
  `schemas/nflSchedule.ts:22-25`). Removing it would trade a destructive bug
  for a slow-leak orphan bug. Scoping it to successfully-fetched weeks keeps
  the purpose and removes the blast radius.
- **No schema-required changes.** All new fields optional with safe defaults,
  per the load-bearing-defaults note already in the schema file.
- **Refuse-and-report over automatic pick migration (1.6).** Migrating
  `entry.picks` keys across an ESPN re-key touches scoring data for live
  entries — a bigger blast radius than the importer itself. Rejected here;
  if a real re-key ever strands picks, that migration gets its own plan.

## Risks / open questions

- **Week-1 restoration is an execution question, not a plan question.** After
  Phase 0–2 land, re-importing seasonType 2 week 1 (and re-measuring the whole
  season's per-week counts first) is a prod-data action — Kevin's call, run
  dry first, per the standing rule. Nothing in this plan performs it.
- **ESPN calendar drift.** `resolveScoreboardUrl` (`nflSchedule.ts:115-160`)
  maps `weeks[i]` to calendar entries positionally (HOF week = importer
  preseason week 1 — see `PICKUP-PRESEASON-PILOT.md`). This is guarded at
  RUNTIME by 1.2's week-identity check, which fails closed when the calendar
  lookup is unavailable (codex r3 #2 — a build-time test of today's mapping
  proves nothing about the mapping on import day). Residual: a drifted
  mapping still wastes an operator's time on refused runs; that is the
  intended failure mode.
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
