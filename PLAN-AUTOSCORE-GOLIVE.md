# PLAN — arm automated NFL scoring (`nflAutoScoreJob`) in production

**Classification: plan-gated.** Production config + scoring, two of
`mmp-change-control` §1's four triggers. The kill-switch flip itself is Kevin's
action; nothing in this repo can perform it.

**Why now.** Kevin, 2026-08-08: *"manual scoring is a launch blocker… scoring
should be no older than 5 to 10 minutes… commissioners manually score only as a
fallback."* The machinery has existed and been deployed since PR-B1/PR-B′/PR-B2.
**It has never run live.**

---

## 1. What is already true, measured

| thing | state |
|---|---|
| `nflAutoScoreJob` | deployed, wrapped in `withHeartbeat`, gated on `system/config.nflAutoScore` |
| `system/config.nflAutoScore` | **UNSET** → `readJobGate` returns `{enabled: false, dryRun: true}` (fail-safe) |
| `syncNFLScoresJob` | **LIVE**, `'*/5 * * * *'`, no kill switch — ESPN *ingestion* is already automatic |
| `nflFinalize`, `nflSpreadLock` | `{enabled: true, dryRun: true}` |
| `nflDeepSweep` | **UNSET** → disabled. See §5, this is the one open prerequisite |

The gate is `readJobGate` (`nflSchedule.ts:1301`): `enabled` must be **exactly**
`true`, and `dryRun` is true unless **explicitly** `false`. A missing config, a
garbage config, or a config the job could not read all mean OFF.

## 2. Audit of the live path, end to end

`syncNFLScoresJob` → `nfl_games` → `nflAutoScoreJob` → `scoreNFLWeekInternal` →
`scoreWeekPass`. Everything below was read in the code, not recalled.

### 2a. The mid-game experience is the provisional pass, and it works

`scoreSlateOnce` calls the scorer with
`provisional: !isWeekComplete(pool, week, games, now)` (`nflAutoScore.ts:318`),
so an IN_PROGRESS slate is scored provisionally rather than skipped. A
provisional pass (contract at `nflPools.ts:931-943`):

- **writes `standings/current`** — "live standings are the point";
- withholds `scoredWeeks` / `scoredThroughWeek` and never calls
  `maybeFinalizeNFLPool`, so a mid-week pass cannot finalize a season;
- writes **no weekly recap** and no `SCORE_FINALIZED` audit;
- grades only `revealed` games — terminal **and** lock-closed.

So the "watch my score move through the afternoon" experience is real, and it
arrives per pool type as follows:

| pool type | what a member sees mid-Sunday |
|---|---|
| **Pick'em** | points accrue game by game as each finishes and its lock has closed (`gradableGames = games.filter(revealed)`) |
| **Margin** | their own week appears when **their picked game** ends; a `-14` no-show penalty lands at the **weekly lock** |
| **Survivor** | same shape — a made pick is untouched until its own game concludes; a strike lands at the weekly lock |

**The Margin/Survivor hold is correct, not a bug**, and it is worth knowing
before someone reports it: `weeklyPickReady` (`nflPools.ts:1094`) refuses to
publish a made pick whose game is not terminal, because
`computeSurvivorWeekUpdate` would report `survived: true` and `scoreMarginWeek`
would return a 0 that flips later. It also refuses **any** write before the
weekly lock, which stops a pre-kickoff `CANCELLED` game revealing a member's pick
while they can still change it.

### 2b. Findings — things that would surprise an operator on day one

**F1 — A queued Survivor rescore of an already-published week is DEFERRED, not
performed, and nothing is unhealthy about it.** `survivorAllowedForGroup`
(`rescoreQueue.ts:255`) refuses to re-run a Survivor week once `scoredWeeks` or
`publishedWeeks` is marked at or after that week, because
`computeSurvivorWeekUpdate` rewrites `eliminatedWeek` to the re-run week and
corrupts the elimination ordering. The run logs a warning, increments
`survivorQueuedDeferred`, and stays `ok: true` — deliberately, since there is no
automatic repair to trigger. **Operational consequence: a late ESPN correction to
a scored Survivor week will not self-heal. Watch `survivorQueuedDeferred` in the
heartbeat and repair by hand.** The reset-and-replay path is unbuilt.

**F2 — Only `poolsFailed > 0` makes a run unhealthy.** `autoScoreHeartbeat`
(`autoScoreDecisions.ts:278`). `overflow` (per-run cap), `poolsSkipped` (which
includes lease-busy) and `survivorQueuedDeferred` are all reported in `detail`
and none of them flips `ok`. That is the right call — none is actionable in the
moment — but it means **`ok: true` is not "everything got scored"**. Read the
counters, not the colour.

**F3 — A dry run writes NOTHING, including the fingerprint, and that is
load-bearing.** Documented at `nflAutoScore.ts:46-49`. If a dry run banked
fingerprints, every pool would look current and the first LIVE run would skip
them all. This is why the dry-run stage in §4 is a genuine rehearsal rather than
a state-changing one.

**F4 — The withheld-lock (`lockPending`) path is queued-tier only.** When a game
is terminal but held behind a still-open `weekLockOverride`, a live pass enqueues
a `lockPending` reminder for the instant the override expires, and the drain
reschedules it if the deadline moves again (`nflAutoScore.ts:283-301`). A **dry
run writes no reminder at all**, so this mechanism is one of the few things the
dry-run stage cannot exercise.

**F5 — Sim pools are excluded, and that exclusion is this job's own.**
`findCandidatePools` filters `isSimPool`; the comment records that this job was
once the odd one out. Worth knowing because the Test Suite creates sim pools in
the same collections as real ones.

### 2c. What is NOT a finding

- **Idempotence holds when auto and manual interleave.** Every writing pass takes
  the fenced scoring lease inside `scoreNFLWeekInternal`, and every write asserts
  that lease in its own committing transaction. A pass that finds the lease held
  returns `leaseBusy: true` having read and written nothing. Proven by
  `autoScore.emulator.test.ts` → `scoring lease — the mutex between scorers`:
  *"a second pass does nothing at all while the first holds the lease"*,
  *"the auto-scorer counts a lease-held pool as skipped, not scored"*,
  *"a pass that lost the lease to another owner commits nothing"*, and
  *"grades from the pool as it is AFTER the lease, not the caller snapshot"*.
  **The commissioner Score & Recap button stays as the documented fallback** and
  is safe to use at any time, including mid-slate.
- **A new pool is not missed.** `findCandidatePools` deliberately avoids
  `isLocked`, a `scoredThroughWeek` inequality, a `seasonType` equality and a
  `scoredWeeks` filter — each of which drops live pools — and rides the existing
  `pools(type, season)` composite index, so it cannot die on a missing index.
- **A submission that lands mid-pass is not skipped forever.** The fingerprint
  folds in `entryRevisionSum`, and `readEntryRevisionSum` returning `null` scores
  rather than guessing.

## 3. Freshness — why the cadence changes in this PR

Staleness a member experiences is the **sum** of two jobs:

```
ESPN → nfl_games      syncNFLScoresJob   '*/5 * * * *'   ≤ 5 min
nfl_games → standings nflAutoScoreJob    '*/10 * * * *'  ≤ 10 min
                                          worst case      15 min
```

15 minutes misses Kevin's 5–10 minute target outright. Moving the scorer to
`'*/5'` gives **≤ 10 minutes worst case and ~7.5 typical**, which meets it.

**The doubling is affordable because idle runs are nearly free.** With the
fingerprint unchanged, a pool costs one aggregate read of its entry-revision sum
and **zero writes** — `poolsSkipped++` and `continue`, before the lease is even
taken. A slate with no live games ends after one windowed `nfl_games` query. The
cost that scales is scoring work, and that only happens when something changed.
The NFL fleet is currently **seven** preseason pools, four with entries.

⚠️ **`timeoutSeconds` moves with it, 540 → 270.** The 540 was not chosen for
itself — its comment says it "stays inside the 10-minute cadence, so two runs
cannot overlap". Halving the schedule without halving the timeout drops that
invariant silently. 270s is still far more than a real pass needs, and a run that
does exhaust its budget is self-healing (fingerprints are banked per pool, so the
next run resumes). An overlap would be *safe* rather than corrupting — the
scoring lease sees to that — but a run whose pools are all lease-held holds its
queue acknowledgements, which is churn for nothing.

**And `SCHEDULED_JOB_EXPECTATIONS` moves with it, 10 → 5.** That registry decides
when a job is reported dead, against 3× the registered interval. Nothing kept it
in step with the cron strings, so this PR adds
`SCHEDULED_JOB_EXPECTATIONS matches each job's actual cron string` to
`heartbeat.test.ts`: it parses every `onSchedule(...)` in `functions/src`,
converts the cron to minutes, and fails on any disagreement — or on any form its
parser does not recognise, so a new schedule shape cannot become a silent hole.

## 4. The flip sequence — Kevin's steps, in order

Numbered, copy-paste steps are in `MORNING-2026-08-08.md`. The shape and its
gates:

**Stage 0 — deploy this PR's functions.** `'*/5'` and the timeout change do not
take effect until then. No rules deploy.

**Stage 1 — arm DRY.** Set `system/config.nflAutoScore` to
`{ enabled: true, dryRun: true }`.
Observe for **at least 30 minutes** (six runs) on a day with no live games, then
for **one full slate** on a game day.

What good looks like, in `system/heartbeats.nflAutoScoreJob`:

- `ok: true`, `at` moving every 5 minutes;
- `detail.dryRun: true`;
- `detail.activeSlates` = 0 when nothing is in the 24h window, ≥ 1 during one;
- `detail.poolsScored` = how many pools **would** have been scored;
- `detail.poolsFailed` = **0**. Anything else stops the rollout.

**Nothing in Firestore changes during this stage** — no entries, no standings, no
fingerprints (F3). That is what makes it a rehearsal.

**Stage 2 — go live.** Set `dryRun: false`, leaving `enabled: true`.
Watch the first three runs, then one full slate.

What good looks like:

- `detail.dryRun: false`, `detail.poolsScored` > 0 on a live slate;
- `pools/{id}/standings/current` gains a fresh `lastScoredAt` within ~10 minutes
  of a game going FINAL;
- `pools/{id}` gains `autoScore.fingerprintByWeek.{week}` — the proof a live pass
  banked its work;
- `detail.poolsFailed` = 0, `detail.overflow` = 0.

**Rollback is one config write** at any point: set
`system/config.nflAutoScore.enabled` to `false`. The next run reads it, logs
`disabled`, and returns `{ detail: { enabled: false } }`. Setting `dryRun` back
to `true` is the softer half-step — the job keeps reporting but stops writing.

**Every flip is audited.** `onSystemConfigWritten` (`systemConfigAudit.ts:17`)
writes a `SYSTEM_CONFIG_CHANGED` entry to `admin_audit` with `nflAutoScore.from`
and `nflAutoScore.to`, for **every** writer — console, UI or script. Checking
that entry is how the flip is confirmed to have landed.

⚠️ **Edit the nested fields in place; do not paste a replacement map.** Firestore
`updateDoc` REPLACES a nested map rather than merging it, so writing
`{ nflAutoScore: { dryRun: false } }` from a script would delete `enabled`. The
Firebase console edits field by field and is safe. There is no SuperAdmin UI for
this flag today — `nflAutoScore` appears nowhere under `src/`.

## 5. ⛔ The one open prerequisite

`MORNING-2026-07-25-PART2.md` §5 listed four things that had to land before
arming. Three have:

| prerequisite | state |
|---|---|
| PR-B2 — the `nfl_rescore_queue` durable tier | ✅ shipped (`lib/rescoreQueue.ts`, `drainRescoreQueue`) |
| PR-B′ — per-entry submission revision watermark | ✅ shipped (`lib/entryRevision.ts`, folded into the fingerprint) |
| PR-B′ — the `extendWeekDeadline` publish guard | ✅ shipped — `extensionRefusal` → `WEEK_ALREADY_PUBLISHED` (`poolExceptions.ts:162`) |
| **K2 — `nflDeepSweep` live with writes** | ❌ **still UNSET, i.e. disabled** |

**The cold-start backfill that prerequisite mentioned is not owed, and the reason
is dates rather than code.** `publishedWeeks.{week}` is stamped by **any**
revealing pass, provisional or complete, including the manual commissioner button
(`nflPools.ts:1455`) — but only since PR-B′ deployed on 2026-07-26. A week scored
before that would carry no marker. **No NFL 2026 week was scored before that
date**: the season's first game was the Hall of Fame opener on 2026-08-06, and it
was scored the following day, <!-- hof-date:ignore --> 2026-08-07. So every
scored week in this season already carries the
marker, and there is nothing to backfill. That reasoning stops holding if an
older season is ever replayed through this path.

**What the `nflDeepSweep` gap actually costs.** `syncNFLScoresJob` re-reads only games that
kicked off within `HOT_WINDOW_LOOKBACK_MS` = 24h. `nflDeepScoreSweepJob`
(`'30 11 * * *'`) is what widens that to a configurable 1–30 days and feeds
`detectStatCorrections`, which is what enqueues rescore events. With it disabled,
**a game that reaches FINAL, or has its score corrected, more than 24 hours after
kickoff is never re-read from ESPN, so the scorer never learns and the rescore
queue never receives the event.** Suspended games and next-day stat corrections
are the real cases.

**Recommendation: arm `nflDeepSweep` dry first, then live, BEFORE stage 2 above —
or accept the gap in writing.** It is a separate flip with the same
`{enabled, dryRun}` shape and its own `lookbackDays` (clamped to 1–30, default in
`DEFAULT_DEEP_SWEEP_DAYS`). It is not blocking for preseason, where suspended
games are rare and the pools are small enough to repair by hand — but it should
be a deliberate decision, not an oversight, and it is Kevin's to make.

## 6. Evidence

The emulator suite already pins the go-live behaviour; this plan cites it rather
than restating it. `functions/src/__tests__/emulator/autoScore.emulator.test.ts`,
**77 cases**, including:

- `provisional Pick'em` (7) — reveal gating, live standings with no finalization
  markers, the `publishedWeeks` stamp, and the `weekLockOverride` withhold;
- `provisional Survivor` (6) and `provisional Margin` (4) — penalties wait for
  the weekly lock, made picks wait for their own game;
- `provisional never finalizes a season` (1);
- `autoScoreOnce — candidate selection, skip and dry-run` (7) — including
  **`DRY RUN writes nothing AND leaves the fingerprint unset`**, which is F3;
- `fingerprint gate — the guard fails when removed` (4);
- `entry-revision watermark` (2);
- `scoring lease — the mutex between scorers` (7) — §2c's idempotence claim;
- `rescore queue` (17) — including the Survivor deferral of F1.

This PR adds to `heartbeat.test.ts` (20 → 26 cases): `scheduleToMinutes` and the
registry-vs-cron agreement check of §3. **Mutation-checked** — restoring
`everyMinutes: 10` under a `'*/5'` schedule fails with
`nflAutoScoreJob: runs every 5min ('*/5 * * * *') but is registered as 10min`.

## 7. What this PR does NOT do

- **It does not arm anything.** `system/config` is untouched; that is Kevin's
  flip and the repo cannot make it.
- **It does not build reset-and-replay** for the Survivor deferral of F1.
- **It does not add a SuperAdmin UI** for the `nflAutoScore` flag. The console is
  the surface today; if the flip becomes routine, a UI is a follow-up.
