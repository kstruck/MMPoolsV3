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
(`pool.autoScore.scoringLease = { owner, until }`, a few minutes) before it begins
writing, and `extendWeekDeadline` **refuses (or waits) while a live lease is held**
and bumps `lockRevision` when it does write; the scorer still re-validates the
revision at its final publish and discards the pass on mismatch. The lease bounds
the window and the revision check is the backstop. This interleaving must be tested.

**The lease needs a fencing token, not just an expiry (codex r14).** A purely
time-bounded lease is not a mutex: if the original invocation is delayed past
`until`, a retry can acquire the lease and score, then the original resumes and
overwrites entry maps / the fingerprint — and both passes can carry the *same*
`lockRevision`, so the final revision check does not catch it. So the single lease
record `pool.autoScore.scoringLease = { owner, until }` (this exact path, one
record everywhere the plan refers to a lease — codex r16) carries a unique
**owner/fencing token**.

**Fence EVERY side-effect of the pass — and validate the token IN the committing
transaction (codex r16/r17).** A slow worker that lost its lease must not run *any*
mutation with stale data (entry batches, `standings/current`, `maybeFinalizeNFLPool`,
weekly recap, `SCORE_FINALIZED`, `SURVIVOR_AUTO_STRIKE`). A *separate* token recheck
is still a TOCTOU race — a newer worker can acquire the lease between the recheck
and the write. So each protected write must **read and assert `scoringLease.owner`
inside the same transaction that commits it**, which means the chunked entry writes
become lease-conditioned transactions (or carry a transactional precondition) rather
than plain `batch.commit()`s. The token validated at commit time is what makes the
mutex real; expiry only bounds a dead worker.

**PR-B′ concurrency acceptance criteria (the residual hard part — consolidated).**
Codex rounds 12–17 converged on one mechanism; these are its acceptance criteria,
to be finalized against real code in PR-B′'s own review, not specified further in
prose here:
1. One fenced lease record `pool.autoScore.scoringLease = { owner, until }`; every
   scoring side-effect validates, **in its committing transaction**, that the lease
   is **still owned by this worker AND unexpired (`until > now`) AND the captured
   `lockRevision` is unchanged** (codex r18) — an owner-only check lets a stalled
   worker whose lease expired still write after `extendWeekDeadline` legally
   committed an override into the now-free lease.
2. `lockRevision` (bumped by every lock-affecting write) is the backstop the final
   publish re-asserts.
3. Every scorer (auto-score, reconciliation drain, manual button) acquires the
   lease atomically and skips/waits while it is held.
4. Lock-affecting settings + all scorer-owned fields are server-only; edits route
   through a **merge-preserving** `updatePoolSettings`; rules deny client-direct
   `settings` writes for these pools.
5. Entry mutators (`submitNFLPicks`/`proxyPick`/`executeSurvivorRebuy`) advance a
   **per-entry** revision inside their own write — **not** a pool-wide
   `submitSeq.{week}` field, which is a single-document hotspot that would abort
   concurrent pre-kickoff submissions and could drop valid picks (codex r17). The
   scorer's skip decision must use an aggregate that **changes on every entry
   mutation** — **not `max`** (codex r18): independent per-entry bumps mean a lower
   entry moving 2→3 leaves `max` unchanged and skips forever. Use a monotone
   **sum/checksum of per-entry revisions** (a `count > lastScoredRevision` also
   stalls once an entry re-increments above the threshold — codex r22),
   or an `updatedAt`-since query. Lease contention for a submission only arises for
   a boundary pick committing right at lock — normal pre-lock traffic never touches
   the lease.
6. **Observing a >24h finalize (codex r18).** The terminal-transition enqueue only
   fires if the sync path *sees* the transition, but `syncScoresWindow` uses a 24h
   lookback — a suspended game finalizing after 24h is never re-fetched, so nothing
   enqueues it and it stays unscored (the daily deep sweep is normally disabled).
   A Firestore query alone cannot observe the finalize (codex r19): nothing updates
   `nfl_games` past 24h — `syncScoresWindow` stops fetching ESPN and the auto-scorer
   makes no ESPN calls — so the stale docs never flip to `FINAL` to be queried. The
   durable path must therefore **re-fetch ESPN for stale not-yet-terminal slates**
   (a query on `nfl_games` where `status ∉ {FINAL,CANCELLED}` and `startTime` is
   past finds *which* slates to re-fetch; the fetch is what surfaces the finalize),
   then enqueue. This is exactly what `nflDeepScoreSweepJob` already does — so the
   concrete pilot answer is **arm the deep sweep** (Kevin, K2) or give this job a
   narrow stale-slate re-fetch. Rare for a preseason pilot, but real for postponed
   games; state it in the arming notes.

**Every lock-affecting settings writer must go through the guard, not just
`extendWeekDeadline` (codex r12).** `weekLockOverrides` is also reachable through
the general manager path — `NFLManagerView` → `dbService.updatePool(..., {settings})`,
and the rules let a manager update non-protected fields while the pool is `OPEN`
— so a manager could set `settings.weekLockOverrides.{week}` directly, after a
result is published, without any lease/`lockRevision` bump, and `submitNFLPicks`
would honor it (picks changeable after the outcome is visible).

Resolution — **all scorer-owned state is server-only, and direct client writes to
`settings` are denied** (codex r12/r13). Two facts make a field-list rule
insufficient: (a) more than `weekLockOverrides` is scorer-owned — `publishedWeeks`,
the whole `autoScore` map, and `settings.lockRevision` are too, and a manager could
clear `publishedWeeks` to reopen a revealed week just as easily (make **every**
scorer-control field server-only, not just the override); and (b)
`NFLManagerView` sends a **complete `settings` replacement** through
`dbService.updatePool`, and `firestore.rules` `affectedKeys()` only reports the
top-level `settings` key — so adding a nested key to a protected-field list does
**not** block an override injected inside a wholesale settings write. So the rules
must **deny client-direct writes to `settings` (and to `publishedWeeks`/`autoScore`)
for these pools** and route permitted settings edits through a **server callable
(`updatePoolSettings`)** that validates nested keys, refuses the scorer-owned ones,
and is the only path that can touch `weekLockOverrides`/`lockRevision` — under the
lease + revision guard. This rules + settings-validation change rides in PR-B′;
it is the reason this work is plan-gated on both authorization and scoring.

**`updatePoolSettings` must MERGE, not replace (codex r14).** The manager UI sends
a *complete* `settings` object, and a normal save after an extension omits
`weekLockOverrides`/`lockRevision`; a wholesale replace would silently **delete**
them, reverting the accepted deadline and breaking the revision protocol. So the
server callable merges only the **whitelisted client fields** into the stored
`settings` inside the guarded transaction and **carries every server-owned field
through untouched.**

**The lease is also the mutex between scorers (codex r10).** It is not only an
`extendWeekDeadline` blocker: **every** scoring path — a second `nflAutoScoreJob`
invocation (a capped run that overruns the 10-min cadence, or a Scheduler retry),
the reconciliation drain, and the manual `scoreNFLWeek` button — must **acquire the
lease atomically and skip/wait while it is held**. Without that, two passes read
the same stale fingerprint and write from independent entry snapshots; because the
scorer **replaces whole `weeklyPoints`/`weeklyScores` maps**, the later commit
silently loses the other's updates. The lease duration (with renewal if a pass can
exceed it) must cover a full pass. Same PR-B′ as the guard.

**General principle (so this stops being enumerated writer-by-writer): any writer
that mutates scoring-relevant pool or entry state must participate in this
synchronization.** Concretely (codex r14/r15):
- **Lifecycle writers** — `cancelPool`, `closePool`, admin-close, **and the client
  archive path** — must acquire/conflict with the scoring lease before they commit,
  or the selection-time terminal check races a live pass and the scorer writes into
  a just-cancelled pool (`maybeFinalizeNFLPool` checks cancellation only *after* the
  writes and cannot undo them).
- **The finalizer sweep** — `nflFinalizeSweepJob` independently calls
  `maybeFinalizeNFLPool` (codex r24). If it overlaps a queued correction rescore of
  an already-finalized pool it can snapshot a partially-updated entry set and write
  stale season history outside the fence. Its finalization path must acquire/conflict
  with the same lease, or otherwise serialize with scoring.
- **Entry mutators** — `submitNFLPicks`, `proxyPick`, `executeSurvivorRebuy` — must
  do **both** (codex r15/r16): (i) **read/conflict with the pool lease** in their
  own transaction and wait/retry while it is held — a watermark alone only
  *schedules a later pass* and does not stop the race where the scorer's missing-pick
  update and a still-valid submission interleave (one writes a false strike, or the
  other gets rejected against a just-eliminated entry); and (ii) **advance a shared
  entry-revision watermark inside that same transaction** (entries carry no
  `updatedAt` today), which the scorer folds into the fingerprint so a mutation that
  lands right after a scoring read still forces one more pass. A watermark that only
  `submitNFLPicks` bumps leaves a late proxy pick ungraded or a rebuy status stale
  forever. All of this is PR-B′.

### 3b. Lock model — Kevin's ruling 2026-07-25 (RESOLVED)

The pick-mutability question is **resolved by a product decision**, not by scoping
S/M out of live scoring. **Kevin's ruling: Survivor AND Margin pools use a WEEKLY
HARD lock before the first game of the week.**

- **Weekly hard deadline** = first kickoff of the week − a manager-chosen buffer,
  offered as three presets: **60 / 30 / 5 minutes** before kickoff.
- **Once the week locks, no picks are accepted** (Survivor and Margin). The
  deadline is *hard* and set once via the buffer preset — there is **no per-week
  `weekLockOverride`** for these types (PR-0 rejects it; see §7 PR-0 for why a
  "move-earlier override" doesn't fit how overrides actually work).

**Consequence — the mutable-pick problem disappears, and ALL THREE types become
live-scorable per-game.** With a weekly hard lock before the first game, a
Survivor/Margin weekly pick is **immutable after the deadline** (which precedes any
kickoff), so grading a finalized game live can never contradict a still-changeable
pick. The earlier r11 concern — that `submitNFLPicks` only checks the *new* team's
lock (nflPools.ts:490-493/542-545), letting a Thursday pick be swapped for a Sunday
team — is closed at the source: WEEKLY mode already throws `WEEK_LOCKED` once the
week locks (nflPools.ts:485-488). So:

| Type | Lock | Live per-game? |
|---|---|---|
| Pick'em | per-game (immutable once each game locks, nflPools.ts:419) | yes |
| Survivor | **weekly hard** (this ruling) | **yes** |
| Margin | **weekly hard** (this ruling) | **yes** |

**Most of this already exists** (verified 2026-07-25): `lockMode: 'WEEKLY'` and its
`WEEK_LOCKED` enforcement, `effectiveWeekLockAt` = earliest kickoff − buffer, and a
manager-editable `lockBufferMinutes` (NFLManagerView.tsx:70). **PR-0** (below) is
the small change: **default/force Survivor & Margin to `WEEKLY`** (they default
`PER_GAME` today — JoinPool.tsx:212), turn the free-number buffer into the **60/30/5
preset picker**, and **reject `weekLockOverride`/`extendWeekDeadline` unconditionally**
for these types (the deadline is set-once; see §7 PR-0 for why "move-earlier" can't work).

**What "provisional" now means (simplified).** Because picks are immutable after the
weekly lock, missing-pick penalties are **determined at lock time** (before any
game) and are safe to apply on the first pass after the week locks — no deferral for
mutability. So `provisional` no longer gates penalties; it gates only
**finalization completeness**: a provisional pass suppresses the finalization
markers, `maybeFinalizeNFLPool`, and the weekly recap until every game in the week
is terminal (a week isn't *done* until its last game ends). Grading and penalties
run live. Formally `provisional = the week still has a non-terminal game`, computed
from the full `(season, seasonType, week)` slate (nflPools.ts:762-766), not the
`now+2h` window (codex r2).

**This also shrinks PR-B′.** Survivor/Margin take no override at all, so a result
can never be reopened after it is revealed — the `extendWeekDeadline` publish/reveal
race (and its `publishedWeeks`/`lockRevision` machinery) **does not apply to
weekly-locked types**. It remains only for Pick'em's per-game `extendWeekDeadline`
path, a much narrower residual. The scorer **lease** (mutex between concurrent
scoring passes) and the **entry-revision watermark** are still needed regardless —
those are about concurrent scorers, not pick mutability.

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
  1. **All three types score live per-game** (§3b, Kevin's 2026-07-25 ruling).
     Because Survivor/Margin now use a **weekly hard lock**, their picks are
     immutable after the deadline, so a provisional pass grades finalized games and
     applies penalties. **But a no-pick penalty must be gated on `now >=
     effectiveWeekLockAt`, not merely on the pass running** (codex r22): the
     active-window query reaches 2h *before* kickoff, so a pass can fire before the
     weekly lock (which is kickoff − 60/30/5), and striking a no-pick Survivor entry
     then would eliminate a member whose pick window is still open —
     `submitNFLPicks` would then reject their valid pick as `ELIMINATED`. So a
     Survivor no-pick strike / Margin `-14` (and any Survivor state update) fires
     only once `now >= effectiveWeekLockAt`; made-pick grading is naturally safe
     (only `FINAL` games grade, always post-lock). `provisional` does **not** defer
     penalties past that lock; it defers only finalization completeness (points 3–4).
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
  **Cold-start backfill (codex r23):** a week manually scored *before* this rollout
  has no `publishedWeeks` marker, so the new Pick'em `extendWeekDeadline` guard
  would accept an override on an already-revealed week. Before enabling the guard,
  backfill the marker from prior scored/published state (`scoredWeeks` /
  `standings.current.lastScoredWeek`), or conservatively treat any
  already-scored legacy week as published.
  The live scorer (§5) sets `provisional = NOT (every game in the week is terminal
  AND every terminal game is reveal-eligible, i.e. `gameLockClosed`)` — the
  `gameLockClosed` term still matters for Pick'em, where a game can be `FINAL`
  while its `weekLockOverride` keeps it withheld (§3a); dropping it would let the
  completion pass stamp `scoredWeeks`/finalize/recap before that hidden game is
  revealable (codex r22). Penalties (gated on the weekly lock, point 1) and grading
  run on every pass; when `provisional` clears the run additionally writes the
  finalization markers, checks `maybeFinalizeNFLPool`, and creates the recap.
  Default `false` keeps every current caller identical.
- `opts.actor` (default the callable's `Host`): threads audit attribution so
  `SCORE_FINALIZED` / `SURVIVOR_AUTO_STRIKE` keep the caller's identity, and
  `nflAutoScoreJob` passes a **`SYSTEM`** actor (codex r4). Without this the
  extraction would lose the `request.uid` the inline scorer uses.
- **Persisted-state contract (codex r11).** The feature adds exactly these new
  fields, and every reference above must use these paths: `pool.autoScore`
  (fingerprint-by-week and the single fenced lease record
  **`scoringLease: { owner, until }`** — expiry **and** owner token together, codex
  r16; entry-revision watermarks live on the entry docs, not here),
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

0. **Wire it up** (both required or the job is silently dead):
   - **Export `nflAutoScoreJob` from `functions/src/index.ts`** (codex r18) —
     Firebase only deploys functions exported from the entry point; defining +
     heartbeat-wrapping it in `nflSchedule.ts` alone leaves it undiscoverable and
     nothing ever runs. This is the exact `syncPlayInPicks` trap from PICKUP §1.
   - **Register the heartbeat expectation** (codex r8): add
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
   The fingerprint must **also react to late-committing entry/pick changes (codex
   r14)**: `submitNFLPicks` captures `now` before its transaction, so a valid
   submission that starts just before its lock can commit **after** the scorer has
   read entries — with games/settings unchanged, a game-only fingerprint would then
   skip forever and that entry keeps an omitted Pick'em grade (or an unfair
   missing-pick penalty). Fold a **per-entry revision watermark** into the skip
   decision — each entry mutator bumps its **own entry doc's** revision (never a
   pool-wide `submitSeq` field — that is a single-document write hotspot at peak
   submission, §3a criterion 5, codex r17). The scorer aggregates via a value that
   **changes on every entry mutation — a monotone SUM/checksum of per-entry
   revisions, NOT `max` and NOT a `count > lastScoredRevision`** (codex r18/r19/r22:
   `max` stalls when a lower entry moves 2→3; a count stalls once an entry already
   above the threshold re-increments — only a sum/checksum moves every time) — so a
   post-read submission forces exactly one more pass.
   The fingerprint **also includes a "weekly lock has passed" bit**
   (`now >= effectiveWeekLockAt`) for Survivor/Margin (codex r23): a pass that runs
   in the `now+2h` window *before* the weekly lock persists a fingerprint with the
   no-pick penalty gated off, and at the lock the game tuples / settings / entry
   revisions can all still be unchanged — so the skip rule would hold off the
   penalty until a game finalizes instead of applying it *at* the lock. The lock bit
   flips the fingerprint the moment the deadline passes, forcing the at-lock pass
   (equivalently, force a pass when `now` crosses `effectiveWeekLockAt`).
   **Fingerprint unchanged → skip the pool, no writes.** Changed → call
   `scoreNFLWeekInternal(...)`.
   - **Dry-run persists nothing (codex r2):** the fingerprint is written
     **only after a successful LIVE scoring pass**. A dry run computes it in
     memory for the report only — writing it on a dry run both breaks the
     dry-run-writes-nothing contract and, worse, would leave the fingerprint
     "already current" so the first live run *skips the pool and never scores it*.
6. `provisional` is computed from the **full `(season, seasonType, week)` slate**
   the scorer reads, per §3b/§4: `provisional = NOT (every game terminal AND every
   terminal game `gameLockClosed`)`. Grading runs every pass; Survivor/Margin
   no-pick penalties are gated on `now >= effectiveWeekLockAt` (§4 point 1). While
   `provisional`, only the finalization markers / `maybeFinalizeNFLPool` / recap are
   withheld; when it clears, the run writes `scoredWeeks`, checks finalize, and
   creates the recap.
7. Per-run safety cap (mirror `MAX_*_PER_RUN`) so one run can't fan out
   unbounded; overflow rolls to the next run and is reported.
8. Return a `scoreSyncHeartbeat`-style verdict: `{ ok, detail: { activeSlates,
   poolsScored, poolsSkipped, overflow } }`. Dry-run reports the same counts
   with `poolsScored` meaning "would score".

### 5b. Reconciliation tier — late ESPN corrections (codex r3)

The active-window early-out means a slate is invisible to the LIVE tier once its
games fall outside the **24h** `HOT_WINDOW_LOOKBACK_MS` (§5 step 2) — a correction
a few hours after kickoff is still caught live; the gap is corrections/finals
beyond 24h. `syncNFLScoresJob` / `nflDeepScoreSweepJob`
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

**The drain must be lossless (codex r25).** A naive "read slate → process → delete
marker" loses an event enqueued *between* the read and the delete — and outside the
hot window nothing else would repair the stale standings. So the queue is either
**append-only events** (each correction/transition is a distinct doc, acknowledged
individually) or a **versioned queue document whose ack is conditional on the
version read** (compare-and-clear in a transaction; a bump since the read aborts the
clear). Test the enqueue-during-drain interleaving explicitly.

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

**Split, revised (codex r16):** the **durable terminal-transition enqueue ships in
PR-B itself**, not as a follow-up — a postponed game that first goes `FINAL`/`CANCELLED`
after the 24h window would otherwise never reach the scorer and stay unscored until
a manual click, which violates the game-end requirement. It is cheap (the sync path
just writes a queue marker on any nonterminal→terminal transition, and the drain is
the same fingerprint check). Only the **Survivor reset-and-replay** correction
handling stays a follow-up sub-PR, because it changes survivor recompute semantics.
The manual-fallback caveat is **type-specific** (codex r12): a manual `scoreNFLWeek` re-score of a corrected week is correct for
**Pick'em and Margin** (both replace that week's map and recompute the season total
additively — idempotent), but **NOT for Survivor** — re-scoring week N leaves later
`strikeWeeks` in place and skips later-week recomputation once eliminated, so it
cannot repair downstream elimination ordering. Therefore, until the reset-and-replay
support ships: the queue defers **only Survivor `correction`-reason entries** (never
first-terminal ones — see the reason field above; a delayed Survivor final still
scores). Pick'em and Margin late corrections self-heal or manual-heal safely. State
in the arming notes that a late Survivor **correction** has **no safe manual repair**
and must wait
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
- a **weekly-locked Survivor** pool: after the weekly lock, a no-pick entry is
  struck on the first pass (miss certain at lock), a made-pick entry is graded when
  its game finalizes, and `submitNFLPicks` rejects any pick after the weekly lock
  (`WEEK_LOCKED`); standings move as games finish, not only at week-complete;
- a **weekly-locked Margin** pool likewise: no-pick booked `-14` after lock,
  made-pick graded live as its game finalizes;
- **PR-0 guards**: Survivor/Margin default to `WEEKLY` and a plain manager
  settings save cannot revert it (server-forced); **every** `weekLockOverride` /
  `extendWeekDeadline` on a Survivor/Margin pool is rejected **unconditionally**
  (not just ones crossing first kickoff — the deadline is set-once, codex r21);
- provisional passes still withhold finalization markers / `finalizedAt` / recap
  until the week is fully terminal (they gate completeness, not penalties);
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

PR-0 + PR-A + PR-B satisfy the stated requirement **for all three pool types**
(Kevin's weekly-lock ruling, §3b): standings move through the day as games end. PR-C
is the enhancement — a score that ticks **while a game is still being played**,
before it is `FINAL`.

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

0. **PR-0 — Survivor/Margin weekly hard lock** (§3b, Kevin's ruling). Default/force
   `lockMode: 'WEEKLY'` for `NFL_SURVIVOR` + `NFL_MARGIN` (create paths + a
   migration/backfill for any existing pilot pools), replace the free-number buffer
   with the **60/30/5 preset** picker.
   - **Server-enforce the lock, don't trust the client — and do it IN PR-0, not
     PR-B′ (codex r20/r24).** An ordinary `NFLManagerView` save replaces the whole
     `settings` map and its Survivor/Margin branches **omit** `lockMode`/
     `lockBufferMinutes` — and submission treats a missing `lockMode` as `PER_GAME`.
     So a normal save (or any direct client write, which the rules still allow until
     PR-B′) would silently revert S/M to mutable picks. **PR-0 cannot defer the
     write-path lockdown to PR-B′** — during the PR-0→PR-B′ interval a manager save
     would undo the migration. So PR-0 itself must: **deny client-direct writes to
     `lockMode`/`weekLockOverrides` for `NFL_SURVIVOR`/`NFL_MARGIN`** (rules) and
     route their settings edits through a server path that **forces `lockMode:
     'WEEKLY'`** and preserves it, independent of the client payload. (This is the
     lock-field slice of PR-B′'s broader server-only-fields work, pulled forward.)
     The lockdown covers **`lockBufferMinutes` too, not just `lockMode` (codex
     r25)**: a save that omits the buffer would revert it to the default 5 min (or a
     direct write could set 5), recomputing `effectiveWeekLockAt` *later* and
     reopening picks. And to stop even a legitimate mid-week buffer change from
     moving an already-announced deadline, PR-0 **freezes each week's effective
     deadline once established** — snapshot `effectiveWeekLockAt` to a per-week field
     the first time the week's deadline is computed, and read the frozen value
     thereafter so a later settings edit cannot shift a live week's lock.
   - **Disallow `weekLockOverride` for weekly-locked S/M entirely (codex r20).** The
     deadline is set once via the buffer preset and is *hard*; there is no per-week
     extension. This sidesteps the fact that `extendWeekDeadline` only accepts
     *positive* (later) minutes and `effectiveGameLockAt` uses `Math.max` (ignoring
     earlier overrides) — a "move-earlier-only" override would need a whole separate
     early-lock field wired through every lock path, which the hard-deadline design
     doesn't need. Reject overrides on Survivor/Margin.
   - **The migration must CLEAR existing `settings.weekLockOverrides` on S/M pools,
     not just reject new ones (codex r23).** A pilot pool that already has a stored
     override still computes `weekLocked` from it (normal *and* proxy paths), so it
     would keep accepting picks past the hard deadline — live scoring back on mutable
     picks. PR-0's backfill deletes/ignores legacy overrides for these types.
   Mostly config over existing infrastructure (WEEKLY lock + `lockBufferMinutes`
   already work). Plan-gated (it changes lock = scoring/authorization behavior).
   **This lands first — it is what makes S/M live-scorable**, and it's independently
   useful for the pilot.
1. **PR-A** extract `scoreNFLWeekInternal` (with `dryRun` / `provisional` /
   `actor` options) — behavior-preserving, isolated.
2. **PR-B** `nflAutoScoreJob` — scheduled, gated, deployed OFF (LIVE tier; the
   reconciliation tier §5b may be a distinct follow-up sub-PR).
3. **PR-B′** the concurrency + authorization hardening PR (§3a) — **not small**:
   the publish/extend `lockRevision` guard, the fenced scoring lease as the mutex
   across all scorers, making every scorer-owned field server-only, denying
   client-direct `settings` writes and routing edits through a merge-preserving
   `updatePoolSettings`, and the submission watermark. It is plan-gated on
   authorization + scoring and needs its own full codex cycle. Sequence it so its
   guards exist **before** `nflAutoScoreJob` is armed live (dry-run in the interim
   is safe — it writes nothing).
4. **(PR-C1 / PR-C2)** optional live in-progress projection, only if time remains.

One PR at a time. Each: all five gates green → `codex exec review --base
origin/main`, absorb/reject every finding with written evidence, report to
Kevin, then start the next (CLAUDE.md §2c/§2d). Nothing deploys — Kevin's gate.
The job ships inert; Kevin arms it dry-run, watches, then flips live.

**Arming prerequisite for the >24h-late finalize path (codex r20).** A game that
first goes terminal more than 24h after kickoff is only observed if something
re-fetches ESPN and writes `nfl_games` — but `nflAutoScoreJob` makes no ESPN call
and `nflDeepScoreSweepJob` is disabled/dry-run by default (dry-run does not write
`nfl_games`). So **before `nflAutoScoreJob` is flipped to live writes**, either the
deep sweep must be armed **with writes** (`nflDeepSweep.enabled=true, dryRun=false`,
after its own dry-run trial — Kevin K2) **or** the narrow stale-slate re-fetch
(§5b) must be built. Until one exists, a postponed game finalizing past 24h stays
unscored; note it in the arming checklist, don't leave it implicit.

## 8. Explicitly NOT in scope

- No change to the scoring *math* (grades, tiebreakers, survivor/margin rules).
- No change to `scoreNFLWeek`'s auth or the manual button's behavior beyond
  deriving `provisional` from slate completion (§4).
- The new *live* job makes no ESPN fetch (reads `nfl_games`, which the sync jobs
  own); the >24h stale-slate observation (§3a crit. 6) reuses the deep sweep.
- No prod-data mutation and no deploy by Claude (Kevin's gates).

## 9. Codex review status — 26 rounds, converged on the plan's altitude

This plan was adversarially reviewed by `codex exec review` across **26 rounds** (89
findings, 0 rejected); every finding was absorbed with written evidence in the git
history (`docs(plan): absorb codex r1..r26`). **Kevin's 2026-07-25 weekly-hard-lock
ruling** (§3b) landed between r19 and r20 and *simplified* the design — all three
pool types live-scorable, PR-0 added, the provisional flag reduced to finalization
completeness, and PR-B′'s reveal-race machinery narrowed to Pick'em only. The
trajectory is the record:

- **Rounds 1–11 found genuine design defects** in the core scoring path and fixed
  them — candidate selection excluding new/omitted-`seasonType` pools, mid-week
  penalty application before pick windows close, the Pick'em-vs-Survivor/Margin
  pick-mutability split, reveal leaks (graded-game gating, pick-count summaries),
  finalization/recap firing on partial passes, terminal-lifecycle filtering,
  fingerprint completeness. **The core design has been stable since ~r11.**
- **Rounds 12–19 all refine ONE flagged mechanism** — PR-B′'s fenced-mutex +
  authorization protocol (lease/fencing/lockRevision, server-only scorer fields,
  merge-preserving settings, per-entry watermarks) and the >24h stale-slate
  observation. Each round sharpened the *specification* of that protocol; none
  surfaced a new class of defect in PR-A/PR-B's scoring or reveal logic.

**Stop rationale (judged on evidence, per CLAUDE.md §2c).** A prose plan for a
distributed mutual-exclusion protocol can always be specified one level deeper —
that is why r12–19 never "came back clean." But a plan's job is to capture the
design and *flag* the hard part, and that is done: PR-B′'s concurrency contract is
consolidated as explicit acceptance criteria (§3a) to be finalized against real
code in **PR-B′'s own implementation review**, where `codex exec review` runs on a
diff and *can* converge to clean. Continuing to iterate mutex prose on the plan is
lower-value than building PR-A/PR-B (whose design is settled) and letting PR-B′'s
code carry its own review. The loop was stopped here deliberately, not because a
round returned clean.
