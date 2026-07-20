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

## 2. Live state (verified 2026-07-21)

**Prod matched `main` as of `5e481c0`.** Everything merged since then is
**NOT deployed** — see §4.

Armed in prod, all **dry-run**: `nflSpreadLock`, `nflLockWatch`,
`nflFeedSnapshots` (`retentionDays: 45`). `nflFinalize` is
`enabled:true, dryRun:true` and still needs `liveSeasonTypes` to actually arm.

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
- **`nflFinalizeSweepJob` has never completed a run in production.** Its index
  only went Enabled 2026-07-20. The finalize *path* is covered by CI; the
  *scheduled sweep* is not.
- Nothing has been exercised against production, only the emulator.
- The **chaos drill (NFL-7)** has not been run — it needs a live preseason week.
- Heartbeats (PR #227) are merged but **undeployed**, so `system/heartbeats`
  does not exist yet.

---

## 4. Merged but NOT deployed — Kevin's gate

**Merged, awaiting deploy:** `#225` preseason fixture · `#226` morning brief ·
`#227` scheduler heartbeats · `#228` docs · `#229` full preseason arc ·
`#230` this doc

**Open, awaiting your review/merge (opened overnight 2026-07-21):**
`#231` `replayFeedSnapshot` — A5 part 2, the snapshot replay callable (code) ·
`#232` `PLAN-BACKUPS-PHASE3.md` — the zero-backup gap, runbook (docs) ·
`#233` `SECURITY-CLAIM-SQUARES.md` — open `guestDeviceKey` finding (docs)

Merge #232 and #233 without ceremony — they are documents, they change no code.
#231 adds one SUPER_ADMIN callable; all five gates green (852 unit, up from
845).

Only #227 changes runtime behavior (8 jobs + `getOpsHealthSummary`). Deploy:

```
cd D:\march-melee-pools
git checkout main && git pull origin main
git log --oneline -1
node -e "const fs=require('fs');console.log(fs.readFileSync('functions/src/consensus.ts','utf8').includes('withHeartbeat')?'present':'MISSING - do not deploy')"
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
npx firebase deploy --only functions --project gridiron-gamble-uzuqo
```

⚠️ **`functions:` must be repeated before EVERY name** if using a filtered
deploy. A bare `--only functions` avoids the trap entirely and is what has
worked. `FUNCTIONS_DISCOVERY_TIMEOUT` is in **seconds** and works around a 10s
source-analysis timeout on Windows.

No index or rules deploy needed for the current queue.

---

## 4b. Morning order of operations (2026-07-22)

1. Merge #232 and #233 (docs, zero risk). Review and merge #231.
2. Deploy the queue — §4 commands. Nothing above is live until you do.
3. **Enable PITR** — `PLAN-BACKUPS-PHASE3.md` steps 0–2. Right now this
   application has **no backup of any kind**; that is a larger exposure than
   anything on the preseason list, because every other risk is recoverable.
4. Then the calendar-bound item: **A8 pricing, due 2026-08-13.**

## 5. What Kevin must do (nobody else can)

1. **NFL-6 — arm the finalize sweep.** Read a `NFL_FINALIZE_SWEEP` entry in
   SuperAdmin → Admin Audit Log first. Want candidates under `"1"` and **zero**
   under `"2"` in `bySeasonType`. Then set `nflFinalize.liveSeasonTypes` to an
   array containing the number **1** — `dryRun:false` **alone does nothing**,
   that guard is deliberate. Full steps: `TOMORROW-TASKS.md` → NFL-6.
2. **Deploy** (§4).
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
4. **`syncNFLScoresJob` only re-reads games from the last 24h**
   (`nflSchedule.ts`). A stat correction arriving later is never picked up,
   which bounds what A5 can protect. Widening it has cost implications — this
   is now the top *undecided* engineering item.
5. **25 callables still use bare `onCall(`** — mostly sim-harness and aiTesting
   with their own role gates, plus the deliberately-deferred `createBracketPool`.
   None is a regression. Wants a re-classification pass, not a sweep.

---

## 7. Gates — run ALL FIVE before every commit

```
npm --prefix functions run build
npm --prefix functions test
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" npm --prefix functions run test:emulator
npx tsc -b
npm test
```

Baselines on `main` @ `16746b8`: functions unit **845**, emulator **98 pass /
10 skipped**, root vitest **257**, both typechecks clean. **Counts only go up —
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
- qodo reviews PRs. Its **defect** findings have been consistently good (12/12
  valid). Its **style/compliance** findings are miscalibrated to this repo
  (5/5 rejected: snake_case ×2, import order, `:any` counts, dependency
  placement). Judge on evidence, reply either way.
