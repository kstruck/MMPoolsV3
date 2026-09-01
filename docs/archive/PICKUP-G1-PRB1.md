# PICKUP — G1 PR-B1: `nflAutoScoreJob` (the LIVE tier)

Entry point for a fresh session building **PR-B1** of
[PLAN-REALTIME-SCORING.md](PLAN-REALTIME-SCORING.md). Written 2026-07-25 ET at
the end of the session that shipped PR-A.

Read this, then plan §4 (the `provisional` contract), §5 (the job), and §7
(sequencing). You do **not** need to re-read §5b — that is PR-B2, not yours.

---

## 0. Where things stand

| Piece | State |
|---|---|
| **PR-0** — Survivor/Margin weekly hard lock | **MERGED** (#272). `usesWeeklyHardLock`, `weekLockDecision`, `ensureHardLockFreeze` are live in `lib/effectiveLock.ts`. |
| **PR-A** — `scoreNFLWeekInternal` | [#274](https://github.com/kstruck/MMPoolsV3/pull/274), CI green, awaiting Kevin's merge. Extraction + `actor` + `dryRun`. **No `provisional` — that is yours.** |
| **qodo removal** | [#275](https://github.com/kstruck/MMPoolsV3/pull/275), docs-only. |
| **PR-B1** — this doc | Branch `claude/nfl-auto-score-job` exists, **off PR-A's branch**, no code yet. |

**Branch note.** `claude/nfl-auto-score-job` is branched off
`claude/score-week-internal-ec52d4`, not `origin/main`, because it needs
`scoreNFLWeekInternal`. If Kevin has merged #274 by the time you start, rebase
onto `origin/main` (`git rebase origin/main`) and open the PR against `main`. If
he has not, open it against `claude/score-week-internal-ec52d4` and retarget
after the merge. **Never `git checkout -B`** — it would discard commits
(CLAUDE.md §2c).

## 1. Scope — decided with Kevin, do not re-litigate

PR-B as written in §5+§5b is ~4× PR-A, so Kevin approved splitting it
(2026-07-25):

**IN — PR-B1 (you):**
- `provisional` semantics inside `scoreNFLWeekInternal` (plan §4 points 1–4).
- The `nflAutoScoreJob` scheduled job, **deployed OFF**.
- Emulator coverage for both.

**OUT — PR-B2 (next):** the `nfl_rescore_queue` durable tier (§5b) — enqueue on
nonterminal→terminal transitions, corrections, and manual spread edits; lossless
drain; dry-run reads read-only. It is an **arming prerequisite**, but the job
ships inert, so it does not gate you.

**OUT — PR-B′:** the per-entry **submission revision watermark**. Plan §5 step 5
folds it into the fingerprint; plan §7 item 3 assigns it to PR-B′. **Kevin ruled
it stays in B′** (2026-07-25). Consequence to write into your PR body: without
it, a submission that commits *after* the scorer reads entries can be skipped by
an unchanged fingerprint. Only reachable once the job is armed, and §7 already
requires B′'s guards before arming — so it is safe, but say so explicitly rather
than leaving it implicit.

**OUT — Survivor reset-and-replay** (§5b) — its own sub-PR, changes survivor
recompute semantics.

## 2. What PR-A already gives you

```ts
export async function scoreNFLWeekInternal(
  db: admin.firestore.Firestore,
  poolId: string,
  week: number,
  opts: {
    pool: any;                    // already-read pool doc — you pass it
    games: NFLGame[];             // already-read week slate — you pass it
    actor: AuditOptions['actor']; // pass a SYSTEM actor from the job
    dryRun?: boolean;
  },
): Promise<ScoreWeekResult>
```

`ScoreWeekResult` carries `{ success, message, dryRun, pickemScored,
survivorScored, marginScored, aliveCount, standings, standingsWritten,
recapWritten }`. **`standings` is the rows the pass would publish** — populated
on dry runs too, deliberately, so a dry-run trial is verifiable. Use it in the
job's verdict detail.

Add `provisional?: boolean` to that `opts` object. Everything else is in place.

Two PR-A details that matter to you:
- **`dryRun` writes nothing at all** — no entry writes, no `standings/current`,
  no `scoredWeeks`/`scoredThroughWeek`/`lastScoredAt`, no recap, no audit, no
  `maybeFinalizeNFLPool`. It stages writes in memory so the two mid-scoring
  re-reads (Margin rank pass, standings projection) report *this* week's numbers.
- **`SURVIVOR_AUTO_STRIKE` keeps a hard-coded `Scoring Engine` actor.** Only
  `SCORE_FINALIZED` takes `opts.actor`. Plan §4 mentions threading the actor into
  both; PR-A deliberately did not, because the strike is the engine's action
  whoever triggered the pass. Leave it unless you have a reason.

## 3. The `provisional` contract (plan §4, points 1–4)

One flag, four behaviors. Default `false` keeps every current caller identical.

1. **All three types score live per-game.** But a **no-pick penalty is gated on
   `now >= effectiveWeekLockAt`, not on the pass running** — the active window
   reaches 2h before kickoff, so a pass can fire before the weekly lock, and
   striking a no-pick Survivor entry then eliminates a member whose window is
   still open (`submitNFLPicks` would then reject their valid pick as
   `ELIMINATED`). Separately, **a made pick stays PENDING until its own picked
   game is terminal**: the engine helpers do *not* skip a non-`FINAL` picked game
   — `computeSurvivorWeekUpdate` reports `survived: true` and `scoreMarginWeek`
   returns `null` → `0` — so write a Survivor/Margin entry only when its picked
   team's game is terminal. Test the locked-but-unfinished pick case explicitly.
2. **Reveal gate** — grade only games that are terminal **and** `gameLockClosed`.
   **Also recompute every per-week summary over that lock-closed set only**: the
   scorer sets `weeklyResults[week].total` from all picked games in the slate, and
   `buildStandingsRows` copies it into member-readable `standings/current` — a raw
   `total` leaks how many still-open picks each entry has submitted.
3. **No finalization-sensitive markers** — do not write `scoredWeeks.{week}` /
   `scoredThroughWeek`, do not call `maybeFinalizeNFLPool`. Still writes
   `standings/current` — that is the point.
4. **No recap, no `SCORE_FINALIZED` audit.** The recap doc's *create* trigger
   fires AI trash-talk; a provisional create would fire it on incomplete
   standings and the later complete pass only *updates*, so it would never refire.

**`pool.publishedWeeks.{week}` is NOT provisional-only** (plan §4). Set it
set-once on **every** result-publishing pass, provisional or complete — a
one-game slate like the HOF game finishes in a single *complete* pass and would
otherwise publish standings with no marker, leaving the week reopenable after its
result was exposed.

## 4. The job (plan §5)

New `functions/src/nflAutoScore.ts`. Model it on `nflDeepScoreSweepJob`
(`nflSchedule.ts:622`).

```
system/config.nflAutoScore = { enabled: false, dryRun: true }   // fail-safe OFF
onSchedule({ schedule: '*/10 * * * *', timeZone: 'America/New_York' }, withHeartbeat('nflAutoScoreJob', ...))
```

**Both wiring steps or the job is silently dead:**
1. Export `nflAutoScoreJob` from `functions/src/index.ts` — Firebase only deploys
   what the entry point exports. This is the `syncPlayInPicks` trap. Now enforced
   by `callableExportSurface.test.ts` ("scheduled job export surface"), which
   scans every `onSchedule()` declaration and fails if index.ts never names it —
   so, like step 2, the gates cannot go green without it.
2. Add `nflAutoScoreJob: { everyMinutes: 10 }` to `SCHEDULED_JOB_EXPECTATIONS`
   (`lib/heartbeat.ts:228`). The heartbeat contract test scans every
   `withHeartbeat()` call and fails if the job is absent — so the gates cannot go
   green without it.

Reuse `readJobGate` / `configReadFailedVerdict` (`nflSchedule.ts:674` / `lib/heartbeat`).

**Active window:** use the existing `HOT_WINDOW_LOOKBACK_MS` (24h,
`nflSchedule.ts:363`) — **not** 2h. A single-game slate (the HOF pilot) or any
game running long would otherwise drop out before its normal final and never
score.

**Candidate pools — five traps, all from codex rounds on the plan:**
- Match `type` ∈ the three NFL types **and the full `(season, seasonType)`** —
  a bare week number pulls regular-season pools into a preseason slot (both have
  a week 1).
- Do **not** filter on `pool.isLocked` — it stays `false` on live pools.
- Do **not** reuse the finalizer's `scoredThroughWeek`-inequality query — new
  pools have no such field and a Firestore inequality omits missing-field docs,
  so every brand-new pool's first game would never score.
- Do **not** filter `seasonType` **in the query** — the create schema allows it
  omitted and scoring treats missing as regular season via
  `Number(pool.seasonType || 2)`. Query the superset `(type, season)` and
  normalize in memory.
- Exclude terminal pools with an **explicit predicate**, not `normalizePhase`
  (which maps `CANCELED` → `open`): exclude when `isFinal === true` **or**
  `finalizedAt` set **or** `status` (compared **case-insensitively**) ∈
  `{FINAL, CANCELED, COMPLETED, ARCHIVED}`.

Do **not** filter on `scoredWeeks.{week}` — provisional passes deliberately do
not write it. The fingerprint is the sole decider.

**Any new composite index must be deployed AND built BEFORE this ships** — the
#219/#223 silent `FAILED_PRECONDITION` lesson.

**Fingerprint** (`pool.autoScore.fingerprintByWeek[week]`) — hash of sorted
`(gameId, status, home, away, spread.value, gameLockClosed(g))` tuples over the
week's terminal games, **plus** the pool's scoring-relevant settings
(`pickMode`/`confidenceMode`; `maxStrikes`/`pickLosersMode`/
`autoSurviveExemptionEnabled`; any grading-affecting Margin setting), **plus** a
"weekly lock has passed" bit (`now >= effectiveWeekLockAt`) for Survivor/Margin.
Each term exists because without it some real change leaves the hash unchanged
and the pool is skipped **forever**: a restated score (count unchanged), a
CANCELLED flip, a corrected locked spread, a mid-week STRAIGHT→ATS or
`maxStrikes` edit, an override expiring, or the lock passing with no game yet
final. Unchanged → skip, no writes.

- **Dry run persists no fingerprint.** Computing it in memory is fine; writing it
  would leave it "already current" so the first live run skips the pool and never
  scores it.
- **A complete pass whose finalize FAILED must not be skipped.**
  `maybeFinalizeNFLPool` is best-effort, so fold finalization completion into the
  skip state: a complete-but-not-`finalizedAt` pool is never skipped, and the
  idempotent finalize retries each pass.

`provisional = NOT (every game in the slate terminal AND every terminal game
gameLockClosed)`.

Per-run safety cap (mirror `MAX_*_PER_RUN`), overflow rolls to the next run and is
reported. Verdict: `{ ok, detail: { activeSlates, poolsScored, poolsSkipped,
overflow } }`; dry-run reports the same counts with `poolsScored` = "would score".

## 5. Emulator coverage plan §5 asks for

Assert concrete values, and verify each guard fails when removed (PICKUP §1).
The full list is at plan §5 "Gates". The load-bearing ones:

- Pick'em partially-final week scores only lock-closed finished games, and
  `weeklyResults.total` counts only those (no open-pick-count leak).
- Weekly-locked Survivor: no-pick struck on the first pass **after** the lock; a
  made-pick entry graded when its game finalizes; standings move as games finish.
- Weekly-locked Margin likewise (`-14` after lock, live grading).
- A `FINAL` game whose `weekLockOverride` still extends its lock is **not**
  revealed until the override passes.
- A provisional pass on a season's last slate does **not** write `scoredWeeks` /
  `finalizedAt`; the complete pass does.
- Second run, unchanged fingerprint → writes nothing.
- Settings change / score correction / spread correction / CANCELLED flip → each
  re-scores.
- A regular-season pool is **not** scored during a preseason slot of the same week
  number.
- Dry-run writes nothing **and leaves the fingerprint unset**, so the first live
  run still scores.
- The job's writes carry the **`SYSTEM`** actor.

## 6. Gates + review

All five, every PR:

```
npm --prefix functions run build
npm --prefix functions test
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" npm --prefix functions run test:emulator
npx tsc -b
npm test
```

Baselines after PR-A: functions **972**, emulator **133**, root **291**. Also
`npm audit --audit-level=high` in root **and** `functions/` — CI audits them
separately.

**Review: `codex exec review --base origin/main`, judgement up to 10 rounds;
past 10, ask Kevin with a reason** (CLAUDE.md §2c, his 2026-07-27 ruling — it was
5). Stop on EVIDENCE — a clean round your own read of the diff agrees with — not
on the counter. If you do stop with findings still open, name them in the PR body
as unresolved and say plainly that the PR carries them. **CHECK QODO TOO — it was
RESTORED 2026-07-30** (§2b); this line used to say "Do NOT check qodo", which held
only while the trial had lapsed. Self-review the diff yourself as well: codex,
qodo and your own read are three opinions, and stopping needs all three.

Classification: **plan-gated (scoring)**. The gate is already satisfied —
PLAN-REALTIME-SCORING.md is written, 31-round reviewed, and approved.

## 7. Environment facts — do not re-derive

- **Deploy is Kevin's, always.** This job ships inert; he arms
  `{enabled: true, dryRun: true}`, watches a day, then flips `dryRun: false`.
- The app **cannot boot in a worktree** (no Firebase env — blank page,
  `auth/invalid-api-key`) on any branch including `main`. Don't chase it.
- npm advisories land daily. A branch not rebased onto current `main` fails
  `security-audit` on a stale lockfile. Rebase before assuming a failure is yours.
- `git diff --stat origin/main...HEAD` — **three dots**. Two-dot lies.
- Force-pushing an open PR branch prints "Bypassed rule violations". It works;
  flag it when you do it.
- `docs/decision-log` is checked out in worktree `vet-youtube-video-f0130c`, so
  `git checkout` of it fails here.

## 8. Still open for Kevin (not yours)

K7 A8 pricing (due 2026-08-06 — the only hard deadline), K1 arm `nflFinalize`,
K2 arm `nflDeepSweep` — note a dry-run deep sweep does **not** write `nfl_games`,
so it must go live-with-writes before the auto-scorer is armed (plan §3a crit. 6,
§7 arming prerequisite) — K6 create preseason test pools, K12/K13 stats census +
sign-offs. #133 (tailwind dependabot) still open and red — close or defer.
