# PLAN — Real-time game-by-game NFL scoring (G1)

**Written 2026-07-24. Target: HOF game 2026-08-06 (~13 days).** Plan-gated
(touches **scoring**) per `mmp-change-control` §1. Companion review trail:
`PLAN-REALTIME-SCORING-REVIEW-LOG.md`.

## 1. The requirement (Kevin, explicit critical path)

> Scoring per pool on a game-by-game basis. Participants must see their scores
> DURING active games. As each game ends, that game is scored — do not wait for
> the week / MNF.

Today scoring is a **manual per-pool button** (`scoreNFLWeek` callable, wired to
a SuperAdmin/commissioner action). Nothing scores on a schedule; the finalize
sweep only *finalizes* pools already scored. So for a live preseason day, a
member sees no movement until a human clicks "Score Week N" — the gap G1 closes
(readiness-checklist G1).

## 2. What already exists (verified 2026-07-24, do not re-derive)

- **The scoring engine is already game-granular and idempotent.**
  `functions/src/nflScoringEngine.ts`: `gradePickemGames` / `gradeSurvivorWeekGame`
  / `gradeMarginWeekGame` grade only `FINAL`/`CANCELLED` games and **skip
  in-progress ones**. `scorePickemEntry` sums completed games. So re-running the
  engine repeatedly through a game day scores each game the moment it finalizes,
  incrementally — the core of G1 is *invoking the existing engine on a schedule*,
  not new scoring math.
- **`scoreNFLWeek` (`nflPools.ts:737`) is idempotent** via `resultsVersion` and
  already writes the reveal-safe, allowlist-built `pools/{id}/standings/current`
  (`buildStandingsRows`, engine:585 → nflPools.ts:983). Its `ACTIVE_GAMES`
  precondition (nflPools.ts:774-777) blocks only **non-**SUPER_ADMIN callers —
  it already permits mid-week provisional scoring by an admin/system path.
- **`nfl_games` is kept live** by `syncGameStatus` (every 1 min) and
  `syncNFLScoresJob` (every 5 min). The auto-scorer reads `nfl_games` and makes
  **no ESPN call** of its own.
- **Active-window query pattern**: `syncScoresWindow` (`nflSchedule.ts:445`) —
  `startTime >= now - lookback AND <= now + 2h`. The auto-scorer reuses it to
  decide when there is anything to do.
- **House safety pattern**: `readJobGate(cfg)` (nflSchedule.ts:674, fail-safe
  `enabled:false` / `dryRun` unless explicitly `false`), `withHeartbeat`
  (heartbeat.ts:135), `configReadFailedVerdict`, `onSchedule({ timeZone:
  'America/New_York' })`. `nflDeepScoreSweepJob` (nflSchedule.ts:622) is the
  reference job to copy.

## 3. Two invariants that must not break

**The lock authority is `effectiveLock.ts`, not terminal status.** Locks are
per-game or per-week (`settings.lockMode: 'PER_GAME' | 'WEEKLY'`), and a
commissioner `weekLockOverride` can push a game's `effectiveGameLockAt` **later
than its kickoff** (`Math.max(base, override)`, effectiveLock.ts:20 — proxy picks
honor the extension). So a game being `FINAL` does **not** by itself prove its
pick window is closed (codex r2). Both gates below key off `effectiveGameLockAt`,
never off kickoff or terminal status alone.

Helper the live scorer computes per game from the full-week slate:
`gameLockClosed(g) := now >= effectiveGameLockAt(g.startTime, week, pool.settings)`.

### 3a. Reveal-safety — grade a game only once its own lock has closed

`standings/current` is already reveal-safe in shape (`buildStandingsRows` is
allowlist-built, drops picks/confidence/tiebreakers/usedTeams). The added rule:
the live scorer contributes a game's result to standings **only when the game is
terminal AND `gameLockClosed(g)`** — so an override that extends a finalized
game's pick window cannot surface that game's outcome before the deadline.

**Accompanying guard on `extendWeekDeadline` (codex r4).** That callable
(poolExceptions.ts:104) lets a commissioner write `settings.weekLockOverrides.{week}`
**after** the original lock. Once the live scorer has published a game's result to
`standings/current`, a later extension cannot retract what members already saw —
the reveal guarantee would fail retroactively. So `extendWeekDeadline` **must
reject an extension for a week whose results the auto-scorer has already
published**, read from the **immutable per-week marker `pool.publishedWeeks.{week}`**
(§4, stamped set-once on first reveal). It must **not** use
`standings.current.lastScoredWeek` (codex r5): that field is overwritten every
pass (nflPools.ts:986), so a late Week-1 correction resets it to `1` and a
`lastScoredWeek >= week` check would then wrongly permit a Week-2 extension even
though Week 2 was already revealed. This is a small guard on a *different*
function; it ships as its own PR alongside PR-B (it touches authorization-adjacent
lifecycle, so classify it against the plan gate). Note poolExceptions.ts:101
already records that honoring the override in `nflPools.ts` is an unfinished
follow-up — so the override path is not yet load-bearing, which is the safe moment
to add this guard.

**The check must be transactional, not read-only (codex r6).** A plain read of
`publishedWeeks` races the scorer: `extendWeekDeadline` could read the marker
unset and write the override in the same instant the scorer publishes the first
result, leaving an accepted extension *after* the outcome was exposed. So (a) the
scorer **stamps `publishedWeeks.{week}` in the same write (batch/transaction) as —
or strictly before — the first visible `standings/current` write for that week**,
and (b) `extendWeekDeadline` performs its marker check **and** override write
inside a Firestore transaction that reads `publishedWeeks.{week}`, so the two
serialize and one always loses cleanly.

Serializing only the marker is still not enough (codex r7): the scorer could read
old settings, compute a grade, and *then* `extendWeekDeadline` commits an override
while the marker is unset, after which the scorer batch-writes the stale grade —
exposing a result while picks are newly open. Close it with optimistic
concurrency: `extendWeekDeadline` bumps a monotonic `pool.settings.lockRevision`
when it writes an override; the scorer captures `lockRevision` at grade time and
**validates it is unchanged before *any* write of the pass — the entry batches and
`SURVIVOR_AUTO_STRIKE` audits included, not only the standings publish** (codex
r8). The entry/audit writes precede the standings write, so guarding only the
publish would let an extension land after a false strike audit was already written
(which a retry cannot un-write) and leave an entry transiently eliminated while its
newly-extended window is open.

**A single up-front revision check is still not a reservation (codex r9):** an
extension can commit *after* the check but *before* the first chunked entry batch
(the scorer commits in ≤400-op batches, nflPools.ts:787-803). Serialize the
**whole pass**, not an instant: the scorer takes a short **durable lease**
(`pool.autoScore.scoringLeaseUntil`, a few minutes) before it begins writing, and
`extendWeekDeadline` **refuses (or waits) while a live lease is held** and bumps
`lockRevision` when it does write; the scorer still re-validates the revision at
its final publish and discards the pass on mismatch. The lease bounds the window
and the revision check is the backstop. This interleaving must be tested.

**Every lock-affecting settings writer must go through the guard, not just
`extendWeekDeadline` (codex r12).** `weekLockOverrides` is also reachable through
the general manager path — `NFLManagerView` → `dbService.updatePool(..., {settings})`,
and the rules let a manager update non-protected fields while the pool is `OPEN`
— so a manager could set `settings.weekLockOverrides.{week}` directly, after a
result is published, without any lease/`lockRevision` bump, and `submitNFLPicks`
would honor it (picks changeable after the outcome is visible). Resolution: make
`weekLockOverrides` a **protected settings field** — writable **only** via
`extendWeekDeadline` (which carries the guard + revision bump) and **rejected** by
the general settings-update path (`updatePoolSettings`/`buildPoolSettingsUpdate`
and the corresponding `firestore.rules` protected-field list). This is a rules +
settings-validation change and rides in PR-B′.

**The lease is also the mutex between scorers (codex r10).** It is not only an
`extendWeekDeadline` blocker: **every** scoring path — a second `nflAutoScoreJob`
invocation (a capped run that overruns the 10-min cadence, or a Scheduler retry),
the reconciliation drain, and the manual `scoreNFLWeek` button — must **acquire the
lease atomically and skip/wait while it is held**. Without that, two passes read
the same stale fingerprint and write from independent entry snapshots; because the
scorer **replaces whole `weeklyPoints`/`weeklyScores` maps**, the later commit
silently loses the other's updates. The lease duration (with renewal if a pass can
exceed it) must cover a full pass. Same PR-B′ as the guard.

### 3b. Never apply a missing-pick penalty while any pick is still open

**Correctness core (codex P1c/r2).** In `PER_GAME` mode a member may legitimately
submit a later game's pick *after* an earlier game is `FINAL`. The existing
full-week engine penalizes an absent pick immediately — `evaluateSurvivorWeek`
strikes on `!pick` (engine:195-198), Margin books `-14` (nflPools.ts:914). Running
it the moment the first game finalizes would **strike/penalize members whose pick
window is still open**, and can eliminate a Survivor entry before their valid
submission arrives.

**Rule (Pick'em vs Survivor/Margin split, codex r11).** These two pool families
have different pick shapes, and only one is safe to score live:

- **Pick'em** has one immutable-once-locked pick *per game* — `submitNFLPicks`
  refuses to change a pick whose game has locked (nflPools.ts:419). So a locked,
  finished game's pick is final and can be graded live, per game. **Pick'em is the
  provisional/live path.**
- **Survivor and Margin** have a single *weekly* pick that is **mutable across
  games**: `submitNFLPicks` only checks the *newly selected* team's game lock
  (nflPools.ts:490-493 / 542-545), so a member may replace a locked/finished
  Thursday selection with a Sunday team right up until the week's **last** game
  locks. Grading their Thursday game early could strike/eliminate or score an entry
  whose pick is still legitimately changeable. **Therefore Survivor and Margin are
  NOT scored provisionally at all — they are scored only on the COMPLETE pass**
  (every game terminal AND `now >= max(effectiveGameLockAt)` over the full slate),
  when no replacement can occur and the missing-pick penalty is genuine. This also
  makes the earlier provisional-subset hazards (false auto-survive exemption,
  survived/zero writes for a pending pick) moot for S/M — they simply never run
  mid-week.

Terminality and the max-lock **are computed from the full `(season, seasonType,
week)` slate** the scorer reads (nflPools.ts:762-766), **not** the `now + 2h`
active-window query — a Friday final can be the only game in that window while
Sunday games sit outside it (codex r2). *(Alternative to enable live S/M later: add
a submit-side guard that freezes a weekly pick once its selected game locks — a
product change to `submitNFLPicks`, out of scope here.)*

## 4. PR-A — Extract `scoreNFLWeekInternal` (behavior-preserving refactor)

The scoring logic lives inline inside the `scoreNFLWeek` callable. To reuse it
from a scheduled job without duplicating it, extract the body into a pure-ish
internal:

```ts
export async function scoreNFLWeekInternal(
  db: Firestore,
  poolId: string,
  week: number,
  opts: {
    dryRun?: boolean;
    provisional?: boolean;
    actor?: { uid: string; role: string; label: string };
  } = {},
): Promise<ScoreWeekResult>   // { pickemScored, survivorScored, marginScored, standingsWritten, ... }
```

- The callable `scoreNFLWeek` keeps its auth/RBAC/`ACTIVE_GAMES` gate and its
  schema, then delegates to `scoreNFLWeekInternal` with `dryRun:false`, `actor` =
  its authenticated caller (`{ uid, role:'ADMIN', label:'Host' }`), and
  **`provisional` computed from full-slate completion, NOT hard-coded `false`**
  (codex r11). The callable lets a SUPER_ADMIN score while games are still active
  (the `ACTIVE_GAMES` gate exempts them); hard-coding `provisional:false` there
  would apply Survivor strikes / Margin `-14` / finalization artifacts while later
  pick windows are open — the exact hazard the flag exists to prevent. So both the
  button and the job derive `provisional` the same way. **Zero behavior change for
  the button on a normal end-of-week score** (all games terminal, locks passed →
  `provisional:false` → identical); the only change is that an admin scoring
  *mid-week* now gets the same safeguards. Proven by the existing emulator fixtures
  (`nfl-pickem-preseason-lifecycle` et al.) passing unchanged.
- `opts.dryRun` (default `false`): compute grades + standings and **return the
  counts, writing nothing** (the deep-sweep dry-run contract).
- `opts.provisional` (default `false`) — **one flag, the whole "this is a live
  mid-week pass" behavior** (codex r2/r4). When true:
  1. **Provisional is Pick'em-only; Survivor/Margin are skipped until the complete
     pass** (§3b, codex r11). Because a Survivor/Margin weekly pick stays mutable
     across games until the week's last lock, a provisional pass **writes nothing**
     for those two types — no strike, no `-14`, no survived/zero, no standings row
     change. It grades only Pick'em, whose per-game picks are immutable once
     locked. (This dissolves the earlier provisional-subset hazards — false
     auto-survive exemption, survived/zero writes for a pending pick — since S/M
     never run mid-week.) The complete pass scores all three types normally.
  2. **Reveal gate** — only games that are terminal AND `gameLockClosed(g)` are
     graded into standings (§3a). **Also recompute every per-week SUMMARY over
     that lock-closed set only** (codex r8): the inline scorer sets
     `weeklyResults[week].total` from *all* picked games in the slate
     (nflPools.ts:832), and `buildStandingsRows` copies it into member-readable
     `standings/current` — so a raw `total` would leak **how many still-open picks
     each other entry has already submitted**, a reveal hole even though the
     grades themselves are lock-safe. On a provisional pass, `total` (and any
     pick-count summary) must count only lock-closed terminal games, or the week
     summary is omitted until complete.
  3. **No finalization-sensitive markers** — it does **not** write
     `scoredWeeks.{week}` / `scoredThroughWeek` and does **not** call
     `maybeFinalizeNFLPool` (codex r4). Otherwise a provisional pass on a
     season's last slate would write `finalizedAt` + season-history while picks
     are still open, because `maybeFinalizeNFLPool` (nflFinalize.ts) keys off
     `scoredWeeks` + terminal status, **not** effective locks. It still writes
     the reveal-safe `standings/current` (that is the whole point — live
     standings).
  4. **No weekly-recap creation, no `SCORE_FINALIZED` audit** (codex r5). The
     inline scorer unconditionally creates `weekly_recaps/week_{week}`, which
     fires `onWeeklyRecapCreated` → AI trash-talk generated from *incomplete*
     standings; and because the authoritative pass only *updates* that existing
     doc, the create trigger would never refire on complete data. A provisional
     pass must skip recap creation and the "scoring concluded" audit; the
     complete pass creates the recap once, from final standings.
  Note the publication marker below is **not** provisional-only.

- **Publication marker on every result-publishing pass (provisional AND
  complete).** Set-once `pool.publishedWeeks.{week} = true` the first time *any*
  live pass reveals a lock-closed result for the week (never cleared) — the
  durable evidence the `extendWeekDeadline` guard reads (§3a). It must **not** live
  inside the `provisional` branch (codex r7): a one-game slate like the HOF game
  finishes in a single **complete** pass (all terminal, lock passed), which would
  otherwise publish `standings/current` without ever stamping the marker and leave
  the week reopenable after its result was exposed.
  The live scorer (§5) sets `provisional = NOT (every week game terminal AND
  now >= max effectiveGameLockAt over the full slate)`. When it clears, the run
  is the authoritative complete pass (penalties applied, markers written,
  finalize checked). Default `false` keeps every current caller identical.
- `opts.actor` (default the callable's `Host`): threads audit attribution so
  `SCORE_FINALIZED` / `SURVIVOR_AUTO_STRIKE` keep the caller's identity, and
  `nflAutoScoreJob` passes a **`SYSTEM`** actor (codex r4). Without this the
  extraction would lose the `request.uid` the inline scorer uses.
- **Persisted-state contract (codex r11).** The feature adds exactly these new
  fields, and every reference above must use these paths: `pool.autoScore`
  (fingerprint-by-week, final-count/marker bookkeeping, `scoringLeaseUntil`),
  **`pool.publishedWeeks.{week}`** (immutable per-week publication marker, §3a/§4),
  and **`pool.settings.lockRevision`** (monotonic, bumped by `extendWeekDeadline`,
  §3a). PR-A itself writes none of these — they arrive with PR-B / PR-B′ — but the
  contract is declared here so an implementation cannot quietly omit the
  `publishedWeeks` marker `extendWeekDeadline` must read. It ships **no scheduled
  job** — only the extraction + these options, so a codex round on it is cheap and
  the blast radius is a refactor the fixtures already cover.

**Gates:** all five + `codex exec review --base origin/main`. This PR is the
risk-bearing one (it moves scoring code); keep it isolated.

## 5. PR-B — `nflAutoScoreJob` (the scheduled scorer) — deployed OFF

A new scheduled job in `nflSchedule.ts` (or a new `nflAutoScore.ts`), modeled
line-for-line on `nflDeepScoreSweepJob`:

```
system/config.nflAutoScore = { enabled: false, dryRun: true }   // fail-safe OFF
onSchedule({ schedule: '*/10 * * * *', timeZone: 'America/New_York' }, withHeartbeat('nflAutoScoreJob', ...))
```

Run body:

0. **Register the heartbeat expectation** (codex r8): add
   `nflAutoScoreJob: { everyMinutes: 10 }` to `SCHEDULED_JOB_EXPECTATIONS`
   (heartbeat.ts:228). The heartbeat contract test scans every `withHeartbeat()`
   call and **fails if the job is absent from that map** — so the gates cannot go
   green without it, and skipping it would leave the scorer unmonitored.
1. Read + gate via `readJobGate` / `configReadFailedVerdict` (copy deep-sweep).
2. **Active-window query + control flow (codex r6)**: query `nfl_games` in the
   active window using the existing **`HOT_WINDOW_LOOKBACK_MS` (24h)**
   (nflSchedule.ts:363), **not** a 2h lookback — a slate must stay eligible until
   its games actually finalize, and a single-game slate (**the HOF pilot**) or any
   game running past 2h would otherwise be dropped before its normal final and
   never scored (a normal final does not enqueue the reconciliation queue). If the
   window is **non-empty → process steps 3–8** (the live path). Only when the live
   window **and** the reconciliation queue (§5b) are both empty does the run
   `return { detail: { activeSlates: 0 } }`. The 24h lower bound + the fingerprint
   skip keep a 10-minute cadence cheap: outside game days the window is empty; on a
   game day an unchanged slate costs one skip check.
3. Derive the live `(season, seasonType, week)` slot(s) from the active games —
   the `week` comes from the game docs, it is **not** a pool field (see below).
4. **Candidate pools** (codex P1a/P1b): NFL pool docs are **season-long** — they
   carry `season` and `seasonType` but **no `week`** field, and they are created
   `isLocked: false` with per-week/per-game locks computed via `effectiveLock.ts`
   rather than a pool-wide flag. So candidate selection must:
   - match `type` ∈ `NFL_PICKEM`/`NFL_SURVIVOR`/`NFL_MARGIN` **and the full
     `(season, seasonType)`** of the live slot — matching a bare week number
     would pull regular-season pools into a preseason slot (both have a "week 1")
     and score them prematurely;
   - **not** filter on `pool.isLocked` (it stays `false` on live pools — filtering
     on it excludes exactly the pools to score);
   - **not** reuse the finalizer's `scoredThroughWeek`-inequality candidate query
     (codex r3): newly created pools have **no `scoredThroughWeek` field** until
     their first successful score, and a Firestore inequality **omits
     missing-field docs** — so that query would exclude every brand-new pool and
     its first game would never score.
   - **not** filter `seasonType` in the query (codex r6): the create schema allows
     an **omitted `seasonType`**, and scoring treats missing/legacy-string values
     as regular season via `Number(pool.seasonType || 2)`. A `seasonType == 2`
     equality omits those valid docs. Query the **superset `(type, season)`** and
     normalize `Number(pool.seasonType || 2)` **in memory** to match the live
     slot's seasonType.
   - The in-memory post-filter excludes pools in any **terminal lifecycle state**,
     using an **explicit backend predicate over the statuses actually persisted**,
     not `normalizePhase` (codex r6 corrected r5): `normalizePhase`
     (`shared/editability.ts:43`) maps only `ARCHIVED`/`COMPLETED` → `archived`
     and sends **`CANCELED` → `open`**, so it would NOT exclude a cancelled pool.
     `cancelPool` persists `status: "CANCELED"` (poolExceptions.ts:336) and
     admin-close persists `COMPLETED`; finalized pools carry `isFinal`/`finalizedAt`.
     Exclude when `isFinal === true` **or** `finalizedAt` set **or**
     `status` (compared **case-insensitively**) ∈ `{CANCELED, COMPLETED,
     ARCHIVED}`. `nflFinalize.ts` uses `status === 'CANCELED'` (:247/:474);
     `ARCHIVED` is added because `dbService.archivePool` persists `status:
     'archived'` while leaving `isFinal`/`finalizedAt` unset (codex r7), and the
     casing across these write paths is inconsistent. Scoring a voided/archived
     pool would otherwise write entry scores, standings, recaps and audit for a
     pool the manager has retired.
   - It must **not** filter on `scoredWeeks.{week}` (codex r8): provisional passes
     deliberately do **not** write that marker (§4 point 3) and the complete pass
     that does is already excluded by the terminal predicate above, so filtering
     on it adds nothing and risks dropping an active pool. The **fingerprint
     (step 5) is the sole decider** of whether a still-active pool needs another
     pass. (A finalized pool with a late correction re-enters only via the
     reconciliation queue, §5b, which bypasses the terminal exclusion.)
   **Any NEW composite index must be deployed AND built BEFORE this code ships**
   (the #219/#223 silent `FAILED_PRECONDITION` lesson). The scored `week` is the
   live slot's week, passed to `scoreNFLWeekInternal` — not read from the pool.
5. **Change-detection skip (cost guard, codex P2)**: a bare `FINAL` **count** is
   unchanged when ESPN restates a final score and does not grow when a game flips
   to `CANCELLED` — both change grades, so a count would skip the pool forever
   and leave standings stale. Instead store and compare a **grading-input
   fingerprint** over the week's terminal games: a hash of sorted
   `(gameId, status, home, away, spread.value)` tuples
   (`pool.autoScore.fingerprintByWeek[week]`). `spread.value` is included because
   ATS Pick'em grades on it (engine:71-75) and a SuperAdmin correction to a
   locked spread can change winners without touching the score (codex r2). The
   tuple **also includes each terminal game's current reveal-eligibility bit**
   `gameLockClosed(g)` (§3a) — otherwise a game finalized under a still-open
   `weekLockOverride` is withheld on one run, and because the raw game data is
   unchanged after the override expires the fingerprint would match and the pool
   would take the skip path forever, never revealing it (codex r3). Encoding the
   eligibility bit makes the hash change the moment the lock opens, forcing the
   rescore. It **also hashes the pool's scoring-relevant settings** (codex r9) —
   `pickMode`/`confidenceMode` (Pick'em), `maxStrikes`/`pickLosersMode`/
   `autoSurviveExemptionEnabled` (Survivor), and any grading-affecting Margin
   setting — since the engine's output changes when these change even with
   identical game data; without them a mid-week STRAIGHT→ATS or `maxStrikes` edit
   would leave the tuple unchanged and skip the pool forever.
   **Fingerprint unchanged → skip the pool, no writes.** Changed → call
   `scoreNFLWeekInternal(...)`.
   - **Dry-run persists nothing (codex r2):** the fingerprint is written
     **only after a successful LIVE scoring pass**. A dry run computes it in
     memory for the report only — writing it on a dry run both breaks the
     dry-run-writes-nothing contract and, worse, would leave the fingerprint
     "already current" so the first live run *skips the pool and never scores it*.
6. `provisional` is computed from the **full `(season, seasonType, week)` slate**
   the scorer reads, per §3/§4: `provisional = NOT (every week game terminal AND
   now >= max effectiveGameLockAt)`. While `provisional`, penalties are deferred,
   only lock-closed terminal games are revealed, and no finalization markers are
   written. Once it clears, the run is the authoritative complete pass (penalties
   applied, `scoredWeeks` written, `maybeFinalizeNFLPool` checked).
7. Per-run safety cap (mirror `MAX_*_PER_RUN`) so one run can't fan out
   unbounded; overflow rolls to the next run and is reported.
8. Return a `scoreSyncHeartbeat`-style verdict: `{ ok, detail: { activeSlates,
   poolsScored, poolsSkipped, overflow } }`. Dry-run reports the same counts
   with `poolsScored` meaning "would score".

### 5b. Reconciliation tier — late ESPN corrections (codex r3)

The active-window early-out means a slate is invisible to the LIVE tier once its
games are >2h past kickoff. But `syncNFLScoresJob` / `nflDeepScoreSweepJob`
reconcile ESPN stat corrections **days later** (`detectStatCorrections`, A5) — a
Sunday score restated on Tuesday. Those corrected `nfl_games` writes would never
reach the fingerprint comparison, so standings (and finalized projections) would
go stale. The auto-scorer must therefore also rescore **recently-corrected
terminal slates**, not only the kickoff window.

Durable handoff (reuse what already detects corrections, don't widen the frequent
scan): the sync paths **enqueue `(season, seasonType, week)`** into a small
`nfl_rescore_queue` on **two** triggers (codex r7): (1) `syncScoresWindow` reports
`corrections > 0` (a late restatement of an already-`FINAL` game), and (2) a game
**first transitions to `FINAL`** — because a suspended/postponed game can finalize
**more than 24h after kickoff**, dropping out of the live window, and
`detectStatCorrections` only fires on games that were *already* `FINAL`, so **any
nonterminal → terminal transition (`FINAL` *or* `CANCELLED`)** beyond the hot
window would otherwise never be scored — a game postponed and later `CANCELLED`
past 24h must enqueue too (codex r10), or its void, its deferred penalties, and the
week's completion never run. Each `nflAutoScoreJob` run drains the queue as a second candidate
source alongside the active window; a slate whose fingerprint is genuinely
unchanged still costs only the skip check. This keeps the live path cheap and makes
both late corrections and late finals self-healing.

Two more cases the queue must cover (codex r8):

- **Override-pending slates near the 24h edge.** A commissioner can extend a lock
  up to ~24h; a terminal game whose override expires at ~kickoff+23h55m can be seen
  `gameLockClosed=false` on one run and then fall outside the 24h live window
  before the next — and nothing terminal happens *at expiry* to re-enqueue it, so
  the eligibility bit is never re-evaluated and the complete pass never runs. When
  a pass defers a terminal game solely because its lock has not closed, it must
  **enqueue that slate for re-examination at/after the override's expiry** (store
  the expiry with the queue entry).
- **Finalized pools with a late correction.** The LIVE-tier terminal predicate
  excludes `finalizedAt` pools, but a correction after finalization must still
  rescore them. The queued reconciliation path **bypasses the finalization
  exclusion ONLY** (`isFinal`/`finalizedAt`) and re-finalizes afterward — it must
  **still apply the CANCELED/COMPLETED/ARCHIVED exclusions** (codex r9): a slate
  queued while active can be canceled or archived before the drain, and
  `maybeFinalizeNFLPool` only checks cancellation *after* the writes, so it cannot
  undo entry/standings/recap/audit writes into a voided pool.

**Correcting week N requires a Survivor state RESET, not sequential rescores
(codex r5/r6).** Simply calling the scorer for weeks N..latest does **not**
re-derive Survivor state: `computeSurvivorWeekUpdate` (a) retains later
`strikeWeeks`, and (b) once the entry is eliminated in the corrected earlier week,
**skips every later week** (the `status==='ELIMINATED' && eliminatedWeek < week`
early-return, engine:433) — so a Week-3 strike stays in the ledger and never gets
cleaned up after a Week-1 correction changes the picture. The reconciliation path
therefore needs a **replay mode that first strips the entry's entire
strike/exempt/elimination ledger from week N forward to a clean slate, then
replays weeks N..latest in order** (`scoredWeeks` gives the set) — a genuine
addition to the survivor recompute contract, not a loop over the existing call.
Pick'em and Margin are per-week additive and need no forward replay. **This is
exactly why the reconciliation tier is a separate, carefully-designed sub-PR** —
it changes survivor recompute semantics and must not ride along with the LIVE
tier.

**For the pilot** this tier may ship as a distinct follow-up sub-PR (the LIVE tier
is the real-time requirement). The manual-fallback caveat is **type-specific**
(codex r12): a manual `scoreNFLWeek` re-score of a corrected week is correct for
**Pick'em and Margin** (both replace that week's map and recompute the season total
additively — idempotent), but **NOT for Survivor** — re-scoring week N leaves later
`strikeWeeks` in place and skips later-week recomputation once eliminated, so it
cannot repair downstream elimination ordering. Therefore, until the reset-and-replay
support ships: **exclude Survivor pools from the reconciliation queue** (Pick'em and
Margin late corrections self-heal or manual-heal safely), and state in the arming
notes that a late Survivor correction has **no safe manual repair** and must wait
for the reset-replay sub-PR — do not tell Kevin to manually re-score a Survivor
week.

**Idempotent + kill-switched + dry-run-first**, exactly like the deep sweep:
Kevin arms `{ enabled: true, dryRun: true }`, watches the audit/heartbeat detail
for a day, then flips `dryRun: false`. Deployed inert.

**Why a scheduled poll, not an `onDocumentUpdated(nfl_games)` trigger** (rejected
alternative): a status→FINAL trigger is at-least-once and 16 games finalizing in
an afternoon would stampede the same pools 16×; the poll is naturally debounced,
matches every other job in this fleet, and carries one kill-switch. The 10-min
latency (a game ending at 4:12 is scored by ~4:27) meets "as each game ends".

**Gates:** all five + codex. Emulator coverage (assert concrete values, verify
each guard fails when removed — PICKUP §1):
- a **Pick'em** partially-final week scores only the finished (lock-closed)
  games, and its `weeklyResults.total` counts only those (no leak of open-pick
  counts, §4);
- a **Survivor** pool is **not written at all** on a provisional pass (no strike,
  no exemption) while the week has open games; it is struck/scored only on the
  complete pass (all terminal, locks passed) — including the swap case: a member
  who replaces a locked Thursday pick with a Sunday team before the last lock is
  scored on the Sunday result, not eliminated on the Thursday one;
- a **Margin** pool is likewise unscored provisionally and scored (incl. `-14`
  for a genuine miss) only on the complete pass;
- an admin `scoreNFLWeek` call **mid-week** (active games) behaves provisionally
  (no premature S/M penalties), and on a fully-terminal week is identical to today;
- a second run with an unchanged terminal fingerprint writes nothing;
- a mid-week pool **settings** change (STRAIGHT→ATS, `maxStrikes`) re-scores
  (fingerprint includes settings, §5);
- an ESPN score **correction** (same FINAL count, changed score) re-scores;
- an ATS locked-**spread** correction after a final re-scores (fingerprint
  includes `spread.value`);
- a game flipping to **CANCELLED** re-scores;
- a `FINAL` game whose `weekLockOverride` still extends its lock is **not**
  graded/revealed until the override passes;
- a `provisional` pass on a season's **last** slate does **not** write
  `scoredWeeks` / `finalizedAt` (no premature finalization); the complete pass
  does;
- the scheduled job's writes carry the **`SYSTEM`** actor in the audit log;
- a regular-season pool is **not** scored during a preseason slot of the same
  week number;
- dry-run writes nothing **and leaves the fingerprint unset**, so the first live
  run scores the pool (dry-run must not poison the live flip).

## 6. PR-C — Live in-progress projection (OPTIONAL, fast-follow if time allows)

PR-B satisfies the stated requirement: standings move through the day as games
end. PR-C is the enhancement — a score that ticks **while a game is still being
played**, before it is `FINAL`.

Two independent pieces, cheapest first:

- **C1 — own projected score, client-side (no backend).** A member already sees
  their own picks and can read live `nfl_games` scores. Compute their own
  projected week score in the client by grading in-progress games at the current
  live score. Zero reveal risk (own picks), zero new server code. **Recommended
  first** if any C work is done.
- **C2 — full provisional standings for everyone (server).** A projection that
  grades in-progress games at current score into a **separate**
  `pools/{id}/standings/provisional` doc (never overwrites the authoritative
  `standings/current`), written by the same `nflAutoScoreJob` pass. Because it
  grades *non-terminal* games, it must include **only games whose own
  `effectiveGameLockAt` has passed** (that game's pick window is closed) — never
  a game still open for picks — and be clearly labeled provisional in the UI.
  More work; only justified if members must see *others'* live movement mid-game.
  Decide during preseason.

Recommendation: ship A + B before HOF (they are G1 proper). Do C1 if there is a
day to spare; defer C2 unless Kevin asks for live cross-member movement.

## 7. Sequencing & gates

1. **PR-A** extract `scoreNFLWeekInternal` (with `dryRun` / `provisional` /
   `actor` options) — behavior-preserving, isolated.
2. **PR-B** `nflAutoScoreJob` — scheduled, gated, deployed OFF (LIVE tier; the
   reconciliation tier §5b may be a distinct follow-up sub-PR).
3. **PR-B′** `extendWeekDeadline` publish guard (§3a) — small, ships alongside B.
4. **(PR-C1 / PR-C2)** optional live in-progress projection, only if time remains.

One PR at a time. Each: all five gates green → `codex exec review --base
origin/main`, absorb/reject every finding with written evidence, report to
Kevin, then start the next (CLAUDE.md §2c/§2d). Nothing deploys — Kevin's gate.
The job ships inert; Kevin arms it dry-run, watches, then flips live.

## 8. Explicitly NOT in scope

- No change to the scoring *math* (grades, tiebreakers, survivor/margin rules).
- No change to `scoreNFLWeek`'s auth or the manual button's behavior.
- No ESPN fetch in the new job (reads `nfl_games`, which the sync jobs own).
- No prod-data mutation and no deploy by Claude (Kevin's gates).
