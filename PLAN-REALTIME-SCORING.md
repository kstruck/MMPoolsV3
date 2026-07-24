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

### 3b. Never apply a missing-pick penalty while any pick is still open

**Correctness core (codex P1c/r2).** In `PER_GAME` mode a member may legitimately
submit a later game's pick *after* an earlier game is `FINAL`. The existing
full-week engine penalizes an absent pick immediately — `evaluateSurvivorWeek`
strikes on `!pick` (engine:195-198), Margin books `-14` (nflPools.ts:914). Running
it the moment the first game finalizes would **strike/penalize members whose pick
window is still open**, and can eliminate a Survivor entry before their valid
submission arrives.

**Rule:** apply missing-pick penalties (Survivor no-pick strike, Margin `-14`)
only when **every game in the week is terminal AND `now >= max(effectiveGameLockAt)`
over all week games** — i.e. the last possible pick window has closed and there is
nothing left to grade. Pick'em needs no deferral (an unmade pick scores 0, no
penalty); only Survivor and Margin are gated. Terminality and the max-lock **must
be computed from the full `(season, seasonType, week)` slate** the scorer reads
(nflPools.ts:762-766), **not** from the `now + 2h` active-window query — a Friday
final can be the only game in that window while Sunday games sit outside it
(codex r2).

## 4. PR-A — Extract `scoreNFLWeekInternal` (behavior-preserving refactor)

The scoring logic lives inline inside the `scoreNFLWeek` callable. To reuse it
from a scheduled job without duplicating it, extract the body into a pure-ish
internal:

```ts
export async function scoreNFLWeekInternal(
  db: Firestore,
  poolId: string,
  week: number,
  opts: { dryRun?: boolean; deferMissingPenalties?: boolean } = {},
): Promise<ScoreWeekResult>   // { pickemScored, survivorScored, marginScored, standingsWritten, ... }
```

- The callable `scoreNFLWeek` keeps its auth/RBAC/`ACTIVE_GAMES` gate and its
  schema, then delegates to `scoreNFLWeekInternal` with **both options at their
  defaults (`false`)** — i.e. the existing full-week, penalty-applying behavior.
  **Zero behavior change** for the existing button — proven by the existing
  emulator fixtures (`nfl-pickem-preseason-lifecycle` et al.) passing unchanged.
- `opts.dryRun` (default `false`): when true, compute grades + standings and
  **return the counts, writing nothing** (the deep-sweep dry-run contract).
- `opts.deferMissingPenalties` (default `false`): when true, Survivor entries
  with no pick this week are left untouched (no strike, no this-week write) and
  Margin entries with no pick are left unscored for the week (no `-14`) — see §3b.
  Only the live scorer (§5) sets it, and only while the week has non-terminal
  games. Default `false` keeps every current caller identical.
- No new persisted fields in this PR; it ships **no scheduled job** — only the
  extraction plus the deferral option, so a codex round on it is cheap and the
  blast radius is a refactor the fixtures already cover.

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

1. Read + gate via `readJobGate` / `configReadFailedVerdict` (copy deep-sweep).
2. **Cheap early-out**: query `nfl_games` in the active window
   (`syncScoresWindow`'s pattern). If empty → `return { detail: { activeSlates: 0 } }`.
   This is what keeps a 10-minute all-day cadence essentially free outside game
   windows (one indexed query, no pool reads).
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
   - exclude already-finalized pools (`isFinal !== true` / `scoredThroughWeek`
     past the slot) to bound the set.
   Reuse the finalize-sweep candidate pattern; the `pools(type, scoredThroughWeek)`
   composite index is already deployed+Enabled. **Any NEW composite index must be
   deployed AND built BEFORE this code ships** (the #219/#223 silent
   `FAILED_PRECONDITION` lesson). The scored `week` is the live slot's week,
   passed to `scoreNFLWeekInternal` — not read from the pool.
5. **Change-detection skip (cost guard, codex P2)**: a bare `FINAL` **count** is
   unchanged when ESPN restates a final score and does not grow when a game flips
   to `CANCELLED` — both change grades, so a count would skip the pool forever
   and leave standings stale. Instead store and compare a **grading-input
   fingerprint** over the week's terminal games: a hash of sorted
   `(gameId, status, home, away, spread.value)` tuples
   (`pool.autoScore.fingerprintByWeek[week]`). `spread.value` is included because
   ATS Pick'em grades on it (engine:71-75) and a SuperAdmin correction to a
   locked spread can change winners without touching the score (codex r2).
   **Fingerprint unchanged → skip the pool, no writes.** Changed → call
   `scoreNFLWeekInternal(...)`.
   - **Dry-run persists nothing (codex r2):** the fingerprint is written
     **only after a successful LIVE scoring pass**. A dry run computes it in
     memory for the report only — writing it on a dry run both breaks the
     dry-run-writes-nothing contract and, worse, would leave the fingerprint
     "already current" so the first live run *skips the pool and never scores it*.
6. `deferMissingPenalties` and the reveal gate are computed from the **full
   `(season, seasonType, week)` slate** the scorer reads, per §3a/§3b:
   `deferMissingPenalties = NOT (every week game terminal AND now >= max
   effectiveGameLockAt)`. Once that condition clears, the run scores the full
   week with penalties applied — the same pass that fires `maybeFinalizeNFLPool`.
7. Per-run safety cap (mirror `MAX_*_PER_RUN`) so one run can't fan out
   unbounded; overflow rolls to the next run and is reported.
8. Return a `scoreSyncHeartbeat`-style verdict: `{ ok, detail: { activeSlates,
   poolsScored, poolsSkipped, overflow } }`. Dry-run reports the same counts
   with `poolsScored` meaning "would score".

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
- a partially-final week scores only the finished games;
- a Survivor entry with **no pick** on a week that still has non-terminal games
  is **not struck** (deferral), and **is** struck once every game is terminal;
- a Margin entry with no pick is unscored while the week is live, `-14` once
  terminal;
- a second run with an unchanged terminal fingerprint writes nothing;
- an ESPN score **correction** (same FINAL count, changed score) re-scores;
- an ATS locked-**spread** correction after a final re-scores (fingerprint
  includes `spread.value`);
- a game flipping to **CANCELLED** re-scores;
- a `FINAL` game whose `weekLockOverride` still extends its lock is **not**
  graded/revealed until the override passes;
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

1. **PR-A** extract `scoreNFLWeekInternal` — behavior-preserving, isolated.
2. **PR-B** `nflAutoScoreJob` — scheduled, gated, deployed OFF.
3. **(PR-C1 / PR-C2)** optional projection, only if time remains.

One PR at a time. Each: all five gates green → `codex exec review --base
origin/main`, absorb/reject every finding with written evidence, report to
Kevin, then start the next (CLAUDE.md §2c/§2d). Nothing deploys — Kevin's gate.
The job ships inert; Kevin arms it dry-run, watches, then flips live.

## 8. Explicitly NOT in scope

- No change to the scoring *math* (grades, tiebreakers, survivor/margin rules).
- No change to `scoreNFLWeek`'s auth or the manual button's behavior.
- No ESPN fetch in the new job (reads `nfl_games`, which the sync jobs own).
- No prod-data mutation and no deploy by Claude (Kevin's gates).
