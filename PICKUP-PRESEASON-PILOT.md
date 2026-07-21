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

## 2. Live state (verified 2026-07-21, ~06:30Z)

**Prod matches `main` @ `e84dfa3`** for functions; frontend deployed via Coolify
after #237. Deploy queue is EMPTY except anything merged after this was written —
always re-check `git log origin/main` against the last deploy.

Armed in prod, all **dry-run**: `nflSpreadLock`, `nflLockWatch`,
`nflFeedSnapshots` (`retentionDays: 45`). `nflFinalize` is
`enabled:true, dryRun:true` and still needs `liveSeasonTypes` to actually arm.

**PITR is ON** (7-day window, 1-minute granularity) and a **daily backup
schedule already existed**. That closes the single biggest exposure. Firebase
**Auth** still has no export — that is the remaining backup gap
(`PLAN-BACKUPS-PHASE3.md` step 6).

**Deployed but NOT armed** (both default OFF, fail-safe):
- `nflDeepScoreSweepJob` — needs `system/config.nflDeepSweep.enabled = true`.
  In `dryRun` it still DETECTS and REPORTS stat corrections and only suppresses
  the `nfl_games` write, so it can be watched for a week before arming writes.
- `replayFeedSnapshot` — SUPER_ADMIN callable, dry-run default, break-glass only.

**Read burn fixed.** `scheduledBracketSync` was re-syncing three dead 2025
March Madness brackets every 10 minutes year-round, pinning Firestore at
~1.4M reads/day since early July. Root cause: `isFinalized` is write-only-false
— every creator sets it `false`, nothing ever sets it `true` except a human via
`updateTournamentData`. Guard shipped in #239 and deployed. **Verify the drop on
the Firestore usage graph** — if reads are still ~1.4M/day, the guard is not
working and that is a real regression.

## 3. What is PROVEN vs what is NOT

**Proven in CI** (fixture `nfl-pickem-preseason-lifecycle`, PRs #225/#229):
create → join → submit → score → **finalize**, on a `seasonType 1` slate with
**no betting lines**, asserting concrete values (alice 3 pts / finalRank 1, bob
1 pt / finalRank 2 in `seasonHistory`). Verified non-vacuous: reverting the
PR #214 spread-gate fix makes this fixture — and only it, of 46 — fail.

**NOT proven — this list IS the preseason risk register:**
- **`nflFinalizeSweepJob` has never completed a run in production.** The finalize
  *path* is covered by CI; the *scheduled sweep* is not.
- **`lockNFLSpreadsJob` has no emulator coverage at all.** Only its pure helpers
  (`shouldLockSpread`, `readJobGate`) are unit-tested. Fixtures seed spreads as
  already `locked: true`, so the unlocked→locked transition — the query, the
  200-per-run cap, the batch write, the audit entry — has never been executed by
  a test. **Kevin is about to arm this for preseason**, and #235 already found
  one spread bug that no test caught. Highest-value remaining test work.
- Nothing has been exercised against production, only the emulator.
- The **chaos drill (NFL-7)** has not been run — it needs a live preseason week.
- **`nflDeepScoreSweepJob` has never run in production.** First fire 11:30 ET.
- **`replayFeedSnapshot` has never been invoked against production.**
- **`spread.locked` has never been exercised end-to-end in prod**, because
  `lockNFLSpreadsJob` has always been dry-run. The #235 fix is *preventive*.

---

## 4. Deploy queue — EMPTY

**§2 is the authoritative current state. This section records HOW the deploys
went, not what is live** — if the two ever disagree about a SHA, §2 wins and
this block is stale.

**Everything through `e84dfa3` is merged and deployed.** Two deploys:

| When | Carried | Confirmed from deploy output |
|---|---|---|
| 2026-07-21 ~04:30Z, `main` @ `84e080c` | #231-#236 | `nflDeepScoreSweepJob` + `replayFeedSnapshot` **Successful create**; `syncNFLScoresJob` **Successful update** (the spread-unlock fix) |
| 2026-07-21 ~06:00Z, `main` @ `e84dfa3` | #237-#241, #244 | `scheduledBracketSync` **Successful update** (the read-burn guard) |

Frontend deployed via Coolify after #237 (client SDK bumped, so it needed one).

⚠️ The second deploy hit repeated **HTTP 429 "Per project mutation requests"**
errors — a per-minute rate limit from pushing ~170 functions at once. All twelve
affected functions retried and reported success. **Check that individually next
time**: a 429 that does NOT recover looks identical in the tail of the log and
still prints `Deploy complete!`.

Kept because it is the command that works, for the next time:

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

1. **A8 — publish the 2026 price + free-period end date. DEADLINE 2026-08-13.**
   The only calendar-bound item. Preseason week 1 is 2026-08-13; the HOF game is
   2026-08-07. Everything else on this list can slip; this cannot.
2. **NFL-6 — arm the finalize sweep.** Read a `NFL_FINALIZE_SWEEP` entry in
   SuperAdmin → Admin Audit Log first. Want candidates under `"1"` and **zero**
   under `"2"` in `bySeasonType`. Then set `nflFinalize.liveSeasonTypes` to an
   array containing the number **1** — `dryRun:false` **alone does nothing**,
   that guard is deliberate. Full steps: `TOMORROW-TASKS.md` → NFL-6.
3. **Arm `nflDeepSweep`** — `{ enabled: true, dryRun: true }`. Safe: dry-run
   still detects and reports corrections, it only suppresses the write.
4. **Retire the 3 stale tournaments** (optional cleanup). The #239 guard already
   skips them; setting `isFinalized:true` via `updateTournamentData` drops them
   from the query entirely.
5. **Firebase Auth export** — the one remaining backup gap.
   `PLAN-BACKUPS-PHASE3.md` step 6, ~1 minute in Cloud Shell.
6. **`claimMySquares` timing decision.** ⚠️ The repo is PUBLIC and the hole is
   unfixed. Exploit detail was reduced in #233 but the source was always public.
   On file: accept through the pilot, fix before the regular season — the
   public-repo fact is a reason to revisit that.
7. **NFL-2 decision** — build or skip alarm A3(b), the synthetic pick probe.
   Recommendation: skip for the pilot.
8. **Leave `nflLockWatch.dryRun: true`** — only 1 of 49 preseason games has a
   betting line, so arming it pages nightly about a known condition.

---

## 6. Next engineering work (no Kevin needed)

**Ranked by preseason value.**

1. **`lockNFLSpreadsJob` emulator coverage — DO THIS FIRST.** See §3. The job
   Kevin is about to arm has never had its body executed by a test. Needs a
   fixture that seeds unlocked spreads, runs the job, and asserts the
   transition, the per-run cap, and that dry-run writes nothing.
2. **Burn down `KNOWN_UNWRAPPED` in `heartbeat.test.ts`.** Nine scheduled jobs
   still have no heartbeat: autoClosePools, autoLock, billing,
   monetizationAlerts, playoffPools, reminders, scoreUpdates, siteAverages,
   webhookDurabilitySweep. Mechanical, but several are money-adjacent — do it
   in daylight, and delete each entry from the list as you go.
3. **CI audit step for `functions/`.** The `security-audit` job runs `npm ci` +
   `npm audit` at the ROOT only, which is exactly why a vulnerable
   `brace-expansion` sat in the deployed `functions/` tree through #236 and
   needed #240 to fix. qodo suggested this; it is a few lines of workflow YAML.
4. **25 callables still use bare `onCall(`** — mostly sim-harness and aiTesting
   with their own role gates. None is a regression. Wants re-classification.
5. **Stale worktree cleanup.** `.claude/worktrees/nfl-preseason-pilot-overnight-08b7b3`
   sits on a merged+deleted branch with a stale HANDOFF copy. Harmless but
   confusing; `git worktree remove` it.
6. **Untracked strays in the main checkout** — `HARNESS-MODEL-AUDIT-2026-07-16.md`,
   `PLAN-LOOPS.md`, `before-deploy.txt`, `design-showcase/`, and five
   `src/pages/DesignAlternatives*` files. The DesignAlternatives ones sit inside
   app source where a future session could import one thinking it is real —
   gitignore or move them. The two docs look like real work products that were
   never committed; check before losing them. **Kevin's call, not a drive-by.**

---

## 7. Gates — run ALL FIVE before every commit

```
npm --prefix functions run build
npm --prefix functions test
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" npm --prefix functions run test:emulator
npx tsc -b
npm test
```

Baselines on `main` @ `e84dfa3`: functions unit **868**, emulator **98 pass /
10 skipped**, root vitest **257**, both typechecks clean. With PR #245 merged the
functions unit count becomes **872**. **Counts only go up —
re-measure, do not trust a stale number** (I reported 828 once from a mid-merge
measurement; it was 831).

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
- **WAIT FOR QODO on every PR before calling it done** — now a top-level rule in
  `CLAUDE.md` §2b, promoted there on 2026-07-21 after being dropped. Check ALL
  THREE surfaces (`--json comments`, `pulls/<n>/comments`, `pulls/<n>/reviews`);
  a report is not absent until all three are. Its **defect** findings have been
  consistently good (19/19 valid). Its **style/compliance** findings are miscalibrated to this repo
  (5/5 rejected: snake_case ×2, import order, `:any` counts, dependency
  placement). Judge on evidence, reply either way.
