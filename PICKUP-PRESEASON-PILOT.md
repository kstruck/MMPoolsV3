# PICKUP — NFL 2026 preseason pilot (new-session entry point)

**Paste this to start a new session:**

> Read `PICKUP-PRESEASON-PILOT.md`, then `HANDOFF.md` and the `NFL-*` sections
> of `TOMORROW-TASKS.md`. Continue the preseason-readiness work. Kevin may be
> away — run autonomously per the overnight-autonomy protocol: code + tests +
> PRs are yours, deploy and prod-data mutations are his. Leave a morning
> takeover note.

Written 2026-07-21. Preseason week 1 is **2026-08-13**; the HOF game is
**2026-08-07**. That is the clock.

---

## 1. The one thing to internalise before touching anything

**"Armed" and "working" are separate claims. Verify by asking whether the thing
has actually PRODUCED something.**

In one week, four things were broken while appearing healthy, and *none* was
findable by reading code:

| What | How it hid |
|---|---|
| A deploy command | `--only functions:a,b,c` deploys **only `a`** — the rest are silently dropped, then it prints `✔ Deploy complete!` |
| `syncPlayInPicks` | A hardened callable never exported from `index.ts`, so a SuperAdmin button called a function that did not exist |
| A5 feed snapshots | Missing composite index; the error was swallowed by the `catch` that protects score sync |
| `nflFinalizeSweepJob` | Missing composite index → `FAILED_PRECONDITION` **every day for ten days**, zero audit entries |

Two of those I caused myself by assuming a verified state matched the actual
state. Concretely:

- Before any deploy: `git log --oneline -1` **and** confirm the change is in the
  file on disk. Not "the PR merged" — the bytes about to ship.
- Prefer a content hash over a line count when checking a file (`git hash-object`).
- Assert concrete values in tests, never just "no error thrown".
- After adding a guard, **verify it fails** when the bug is reintroduced.

---

## 2. Live state (verified 2026-07-22)

> **Deploy state: HANDOFF.md's STOP POINT box is authoritative and CURRENT.**
> Both files agree — prod is `84e080c`, `main` has moved to `17fa291`, and
> **there IS a deploy queue.**
>
> `tests/docs-state-invariants.test.ts` (PR #248) enforces **only** that the
> tagged deployed-SHA claims agree and name a real commit on `origin/main`. It
> does **not** compare deploy-QUEUE prose and does not know what `main` currently
> is — so "the queue is empty" is still a human claim that a test cannot catch
> going stale. That limit is stated in the test file itself; do not read a green
> suite as agreement about the queue.

**Prod matches <!-- deploy-state:current --> `main` @ `84e080c`, but `main` is
now `17fa291` — three merged PRs are AWAITING DEPLOY.** Runbook in HANDOFF's
STOP POINT box.

Armed in prod, all **dry-run**: `nflSpreadLock`, `nflLockWatch`,
`nflFeedSnapshots` (`retentionDays: 45`). `nflFinalize` is
`enabled:true, dryRun:true` and still needs `liveSeasonTypes` to actually arm.

**Deployed but NOT armed** (both default OFF, fail-safe):
- `nflDeepScoreSweepJob` — needs `system/config.nflDeepSweep.enabled = true`.
  Runs 11:30 ET daily. In `dryRun` it still DETECTS and REPORTS stat
  corrections and only suppresses the `nfl_games` write, so it can be watched
  for a week before the writes are armed. `lookbackDays` optional, default 7,
  clamped to [1, 30].
- `replayFeedSnapshot` — SUPER_ADMIN callable, `dryRun` defaults true at the
  schema layer. Nothing runs it on a schedule; it is a break-glass tool.

**Free liveness check available tomorrow:** `nflDeepScoreSweepJob` is wrapped in
`withHeartbeat`, and the wrapper stamps on every completed run *including* the
early return when the job is disabled. So after 11:30 ET tomorrow,
`system/heartbeats.nflDeepScoreSweepJob` should exist with a fresh `at`. If it
does not, the schedule itself never fired — which is precisely the distinction
that took ten days to notice on the finalize sweep.

Prod data: **49 preseason games** (`season 2026`, `seasonType 1`). One
mislabeled regular-season game was deleted by hand; PR #219 stops it recurring.

Both previously-missing composite indexes are deployed and **Enabled**:
`nfl_feed_snapshots(slate, fetchedAt)` and `pools(type, scoredThroughWeek)`.

---

## 3. What is PROVEN vs what is NOT

**Proven in CI** (fixture `nfl-pickem-preseason-lifecycle`, PRs #225/#229):
create → join → submit → score → **finalize**, on a `seasonType 1` slate with
**no betting lines**, asserting concrete values (alice 3 pts / finalRank 1, bob
1 pt / finalRank 2 in `seasonHistory`). Verified non-vacuous: reverting the
PR #214 spread-gate fix makes this fixture — and only it, of 46 — fail.

**NOT proven:**
- **Nothing merged on 2026-07-22 has run in production** — #245, #247 and #250
  are emulator- and CI-proven only, and not yet deployed.
- **The per-job heartbeat verdicts added in #250 are not individually tested.**
  The guard is a source-level check that a job *can* report failure; it cannot
  prove each path is wired. Verified rather than assumed: deleting `autoLock`'s
  failure count, or reverting the `playoffPools` `resp.ok` verdict, produces no
  build error and no test failure.
- **`runReminders` cannot see failures its nested helpers swallow** — `sendEmail`
  catches queue failures, `sendCourierSMS` returns a boolean nobody reads. A run
  where every reminder email failed to queue still reports zero failed pools.
- **Eight files wrap a job that cannot report failure at all** (`adminHealth`,
  `consensus`, `espnBracket`, `expertPicks`, `expertProfiles`,
  `revenueAggregates`, `stripe`, `winProbability`), on a shrink-only list.
- **`nflFinalizeSweepJob` has never completed a run in production.** Its index
  only went Enabled 2026-07-20. The finalize *path* is covered by CI; the
  *scheduled sweep* is still not.
- Nothing has been exercised against production, only the emulator.
- The **chaos drill (NFL-7)** has not been run — it needs a live preseason week.
- **`nflDeepScoreSweepJob` has never run in production.** Deployed 2026-07-21,
  disabled. First scheduled fire is 11:30 ET; check `system/heartbeats` after
  that before believing anything about it.
- **`replayFeedSnapshot` has never been invoked against production.** Its diff
  logic is unit-tested; the full callable path is not.
- **`spread.locked` has never been exercised end-to-end in prod**, because
  `lockNFLSpreadsJob` has always been dry-run. The PR #235 fix is therefore
  *preventive* — verified by reasoning and tests, never by production behavior.

---

## 4. Deploy queue — NOT EMPTY (3 PRs, 13 job bodies)

**#245, #247 and #250 change deployed function code and are merged but NOT
deployed.** #248 (tests + CLAUDE.md) and #249 (CI) need no deploy.

Thirteen scheduled job bodies changed. Nothing is armed or disarmed; the
behaviour change is that a job which fails now REPORTS it instead of stamping a
healthy heartbeat. Full runbook with the pre-deploy byte-check is in HANDOFF's
STOP POINT box — use that, not this summary.

The command, which is the one that has worked every time:

```
cd D:\march-melee-pools
git checkout main && git pull origin main
git log --oneline -1
npm --prefix functions install
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
npx firebase deploy --only functions --project gridiron-gamble-uzuqo
```

⚠️ **`functions:` must be repeated before EVERY name** if using a filtered
deploy. A bare `--only functions` avoids the trap entirely and is what has
worked every time. `FUNCTIONS_DISCOVERY_TIMEOUT` is in **seconds** and works
around a 10s source-analysis timeout on Windows.

Always confirm the change is in the file on disk before deploying — not that
"the PR merged". A stale checkout deploys old code and still prints
`Deploy complete!`.

## 5. What Kevin must do (nobody else can)

1. **NFL-6 — arm the finalize sweep.** Read a `NFL_FINALIZE_SWEEP` entry in
   SuperAdmin → Admin Audit Log first. Want candidates under `"1"` and **zero**
   under `"2"` in `bySeasonType`. Then set `nflFinalize.liveSeasonTypes` to an
   array containing the number **1** — `dryRun:false` **alone does nothing**,
   that guard is deliberate. Full steps: `TOMORROW-TASKS.md` → NFL-6.
2. ~~**Deploy**~~ — **DONE 2026-07-21 ~04:30Z**, queue empty (§4).
3. **NFL-2 decision** — build or skip alarm A3(b), the synthetic pick probe.
   Needs a prod probe identity + probe pool. Recommendation on file: skip for
   the pilot, revisit before charging money in September.
4. **A8 — publish the 2026 price + free-period end date. Deadline 2026-08-13.**
   The only calendar-bound item on the list.
5. **Leave `nflLockWatch.dryRun: true`** until the preseason-lines question is
   settled — only 1 of 49 games has a betting line, so going live pages nightly
   about a known condition.

---

## 6. Next engineering work (no Kevin needed)

Roughly in value order:

1. ~~**A5 part 2 — the snapshot replay callable.**~~ **DONE — PR #231.**
2. ~~**Phase 3 — backups.**~~ **Written up — PR #232.** The plan exists; the
   *work* is now yours, and step 0 is installing `gcloud` (it is not on this
   machine, and the Firebase CLI cannot configure PITR or backup schedules).
   **`--enable-pitr` is one command and buys a 7-day recovery floor. If you do
   one thing from that document, do that one.**
3. ~~**`claimMySquares` security finding.**~~ **Written up — PR #233.** Verified
   real against `firestore.rules`, and confirmed **not preseason-blocking**
   (Squares is not part of the NFL pilot). Recommendation on file: accept
   through the pilot, fix before the regular season. Needs your decision.
4. ~~**`syncNFLScoresJob` only re-reads games from the last 24h.**~~
   **DONE — PR #235**, `nflDeepScoreSweepJob`. Deployed, not yet armed.
   Deliberately a second daily job rather than a wider window on the 5-minute
   one, which would have multiplied ESPN fetches across 288 runs a day.
5. ~~**Heartbeat coverage is incomplete.**~~ **DONE — PRs #245 and #250.**
   Every `onSchedule()` in the codebase is now wrapped, with no exemptions, and
   an invariant fails if a new one is added unwrapped. The follow-up that came
   out of it is sharper and is now the top open item: **wrapping a job does not
   make its heartbeat honest.** Extract each job's verdict into a pure helper
   (as `sweepRunVerdict` and `lockWatchVerdict` already are) so the failure
   paths are individually tested, and plumb an outcome through `sendEmail` /
   `sendCourierSMS` so `runReminders` can see delivery failures.
6. **26 callables still use bare `onCall(`** — NOT 25; the count in the older
   docs was wrong, and `searchUsersByEmail` has already been migrated to
   `validated()`, so the warning about it needing a special grep is stale.
   Classification: 13 genuinely fine, 12 want `validated()`, 1 deferred by
   design (`createBracketPool`). Highest risk, in order: `simulateGameUpdate`
   (`scoreUpdates.ts`) — auth is "is anyone logged in", the role check is
   claim-only and buried inside a transaction, and an arbitrary `scores` object
   gets one truthiness check before deciding winners; `backfillProfileData`
   (`migrations/`) — a 540s mass mutation behind a claim-only gate;
   `recordPoolPayouts` (`payoutRecords.ts`) — the money ledger, claim-only role
   half. Still a re-classification pass, not a sweep.

---

## 7. Gates — run ALL FIVE before every commit

```
npm --prefix functions run build
npm --prefix functions test
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" npm --prefix functions run test:emulator
npx tsc -b
npm test
```

Baselines on <!-- deploy-state:ignore --> `main` @ `17fa291`: functions unit
**913**, emulator **105 pass / 10 skipped**, root vitest **273**, both
typechecks clean. **Counts only go up — re-measure, do not trust a stale
number** (I reported 828 once from a mid-merge measurement; it was 831).

`functions/node_modules` and root `node_modules` may be missing in a fresh
worktree — run `npm --prefix functions install` and `npm install` first or the
build fails confusingly.

**Known flaky:** `opsAlertDispatcher.test.ts` → *"no-ops when system/config has
no opsAlerts field"* fails intermittently. It uses a module-level
`vi.stubGlobal("fetch")` asserted with `not.toHaveBeenCalled()`, which a
floating promise from another test file can trip. Re-run before investigating.

---

## 8. Conventions that are NOT negotiable

- **One PR per logical item.** All five gates green before commit.
- **Kill-switch + dry-run** on anything scheduled or batch-mutating, fail-safe
  OFF (`enabled === true` required, `dryRun !== false` default).
- **Never deploy** — Kevin's gate, always.
- **Never `.trim()` a string used as a LOOKUP KEY** against stored data
  (regression shipped in #194, fixed in #195).
- **Check what a MISSING optional field MEANS** — omission is often a feature
  (`fixPoolScores.poolId` absent = "fix every pool").
- **`dryRun` defaults true at the SCHEMA layer**, never a handler-side check.
- **Every scheduled job should write something on every run** so "never fired"
  and "never ran" are distinguishable — `withHeartbeat()` in
  `functions/src/lib/heartbeat.ts` does this; use it for any new job.
- qodo reviews PRs. Its **defect** findings have been consistently good (12/12
  valid). Its **style/compliance** findings are miscalibrated to this repo
  (5/5 rejected: snake_case ×2, import order, `:any` counts, dependency
  placement). Judge on evidence, reply either way.
