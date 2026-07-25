# HANDOFF — Session entry point (updated 2026-07-24: functions + frontend both current)

> ## ✅ STOP POINT 2026-07-24 — #265 functions deployed; frontend rebuilt and caught up
>
> **Functions are deployed from <!-- deploy-state:current --> `main` @ `49c12a9`.**
> Deployed 2026-07-23 (bare `--only functions --project gridiron-gamble-uzuqo`,
> confirmed `✔ Deploy complete!`). Carries #261, #262 and #265 — the
> public-profile header/footer fix, the `runReminders` read-amplification fix
> (~966K Firestore reads/day removed; verify the drop via Query Insights), and
> the 15-minute reminder cadence. `createCheckoutSession` / `handleStripeWebhook`
> each needed an isolated redeploy to clear a secret/plain env-var overlap after
> a stray `functions/.env` (now comment-only) — both landed clean.
>
> ✅ **The FRONTEND is now CURRENT.** Kevin merged #266 and triggered the Coolify
> rebuild on 2026-07-24; the #261 profile fix is live — verified against
> `/profile/:uid` (header + footer render for a logged-out viewer, bundle
> `index-BhilVMpo.js`). No frontend rebuild owed. The FUNCTIONS queue is empty.
>
> ⚠️ The SHA appears **once** in this file, in the tagged claim above. Every
> other mention says "the tagged SHA" on purpose: `docs-state-invariants` only
> guards the tagged deploy-state construction, so a bare copy of the hash is
> invisible to it and rots on the next deploy while the suite stays green.
> (This note deliberately does not reproduce that construction — doing so makes
> the scanner read the example as a third claim, which failed the suite once
> already while writing this very paragraph.)
>
> ### What shipped since the morning
>
> **2026-07-23:** #261 (frontend — profile header/footer, **now live** after the
> 2026-07-24 Coolify rebuild),
> [#262](https://github.com/kstruck/MMPoolsV3/pull/262) (functions —
> `runReminders` read fix, **deployed**) and
> [#265](https://github.com/kstruck/MMPoolsV3/pull/265) (functions — 15-min
> reminder cadence + bracket-window widening, **deployed**) landed on top of the
> list below.
>
> The three morning PRs plus three more, all merged and now deployed:
>
> | PR | What |
> |---|---|
> | [#255](https://github.com/kstruck/MMPoolsV3/pull/255) | BANNED owner rejected on `recordPoolPayouts` / `simulateGameUpdate` / `simFillSquares` — the live authz gap, now CLOSED in prod |
> | [#256](https://github.com/kstruck/MMPoolsV3/pull/256) | Heartbeat verdicts extracted to `lib/heartbeatVerdicts.ts` + unit tests |
> | [#257](https://github.com/kstruck/MMPoolsV3/pull/257) | Emulator coverage: finalize sweep + `replayFeedSnapshot` |
> | [#243](https://github.com/kstruck/MMPoolsV3/pull/243) | `functions/` body-parser 1.20.5 → 1.20.6 |
> | [#259](https://github.com/kstruck/MMPoolsV3/pull/259) | Every wall-clock job pinned to `America/New_York` — see §4 for the schedule |
> | [#260](https://github.com/kstruck/MMPoolsV3/pull/260) | PLAN gate scoped to money/authz/prod-data/scoring (docs) — did NOT need a deploy |
>
> Kevin's two rulings (2026-07-22): **pin all wall-clock jobs to ET** (#259), and
> **scope the PLAN gate to blast radius, not file count** (#260). Both live.
>
> Test counts now: functions vitest **962** (+9 from #262's
> `reminderWeekContext` guards, +6 from #265's `reminderBracketCadence`),
> emulator **132**, root vitest **291**.
>
> **qodo is billing-blocked** as of 2026-07-21 and reviewed none of these six.
> codex (CLAUDE.md §2c) is the only working reviewer. See CLAUDE.md §2b.
>
> ### The evening's second effort (overnight of 2026-07-22)
>
> Kevin queued four product items — profile-page header/footer, SuperAdmin
> Overview stats (reset + exclude test pools), a filterable Stats tab, and a
> Sentry error triage. See **MORNING-2026-07-23.md** (if present) for what got
> built and what needs Kevin.
>
> ---
>
> ## ✅ STOP POINT 2026-07-21 (~17:00Z / 13:00 ET) — historical
>
> **Deployed <!-- deploy-state:ignore --> `main` @ `6ca9e7f`.** Functions
> deployed 2026-07-21 ~16:40Z (12:40 ET); Coolify rebuilt the frontend on the
> same commit and its container passed healthcheck at 16:54Z (12:54 ET). This
> box is kept for the verification pattern it records; the deploy state above
> supersedes it.
>
> ### 1. What shipped
>
> Six PRs merged overnight — #245 and #250 (heartbeats across the whole
> scheduled fleet, and making them report failure honestly), #247 (spread-lock
> write-path coverage), #248 (docs-state invariant), #249 (CI audits
> `functions/` too), #251 (the morning runbook +
> `SECURITY-BARE-ONCALL-CLASSIFICATION.md`).
>
> The deploy also carried six PRs pending since before that run — **#239, the
> Firestore-reads fix** — plus #240, #237, #238, #241, #244.
>
> ### 2. The finding that mattered — the deep-sweep schedule is alive
>
> `nflDeepScoreSweepJob` stamped `system/heartbeats` at **11:30:08 ET on
> 2026-07-21** — about 70 minutes before the 12:40 ET deploy that same day — and that stamp carried **no `detail`
> field**. The post-#245 code always writes `detail: { enabled: false }` on the
> disabled path, so its absence proves the stamp came from the PRE-deploy build.
>
> **Cloud Scheduler fires this job on time.** That is the question that went
> unanswered for ten days on the finalize sweep, and it is now answered.
>
> ### 3. First production evidence for the new heartbeat code
>
> Read off `system/heartbeats` ~15 minutes after the deploy:
>
> | Job | Evidence |
> |---|---|
> | `syncNFLScoresJob` | all six counters present, all zero, `ok: true` — **#245** |
> | `autoLockPools` | `detail.duePools: 0` — #250 |
> | `runReminders` | `detail.failedPools: 0` — #250 |
>
> That is **two of #250's nine** handlers, plus one of #245's.
> `syncNFLScoresJob` lives in `nflSchedule.ts` and was changed by #245, not #250
> — worth keeping straight so #250's coverage is not overstated.
>
> Note what `syncNFLScoresJob` did: `slates: 0` — no games in the active window,
> correct for July — and it reported that as **healthy, not degraded**. The
> cry-wolf case behaves.
>
> ### 4. Heartbeat timing — every wall-clock job is pinned to ET
>
> **Kevin's ruling 2026-07-22: pin them all to `America/New_York`.** Previously
> seven daily-or-slower jobs declared no `timeZone`, so Cloud Scheduler ran them
> in UTC and they landed in the small hours ET — which is how this box came to
> document `nflFinalizeSweepJob` as an 08:30 job when it ran at 04:30 ET.
>
> **The five clock-scheduled jobs keep their current (EDT) run time** — the
> declaration moved from a UTC hour to the equivalent ET hour. Be precise about
> what that trades, though: an unpinned job is fixed in UTC and its ET hour
> moves across DST; a pinned job is fixed in ET and its **UTC** hour moves. So
> in winter these fire an hour later in UTC than they used to. That is the point
> of the ruling — stability in the zone everyone actually reads — not a
> side-effect.
>
> The two that used `every 24 hours` changed more: an interval anchored to the
> last run cannot carry a timeZone, so they became explicit nightly crons.
>
> No schedule sits in 02:00-02:59 ET (does not exist on spring-forward) or
> 01:00-01:59 ET (happens twice on fall-back).
>
> | Job | Schedule (all ET) | Changed? |
> |---|---|---|
> | `aggregateRevenueDaily` | `30 0 * * *` | was `every 24 hours` — now a fixed time |
> | `gradeExpertProfilesJob` | `0 3 * * *` | same time, was `0 7 * * *` UTC |
> | `siteAveragesJob` | `30 3 * * *` | same time, was `30 7 * * *` UTC |
> | `autoClosePools` | `0 4 * * *` | same time, was `every day 08:00` UTC |
> | `nflFinalizeSweepJob` | `30 4 * * *` | same time, was `every day 08:30` UTC |
> | `webhookDurabilitySweep` | `15 5 * * *` | was `every 24 hours` — now a fixed time |
> | `lockNFLSpreadsJob` | `0 9 * * 2` | already pinned |
> | `nflDeepScoreSweepJob` | `30 11 * * *` | already pinned |
> | `enforceBillingStatus` | `0 23 * * *` | same time, was `every day 03:00` UTC |
>
> `functions/src/__tests__/scheduleTimezones.test.ts` now fails if any
> wall-clock schedule omits `timeZone` or pins a zone other than ET. Interval
> schedules are deliberately out of scope — a timeZone means nothing on them.
>
> ⚠️ **`lockNFLSpreadsJob` will read `never-ran` for a FULL WEEK.** 2026-07-21
> was a Tuesday and its 09:00 ET run happened *before* the wrapping deployed, so
> its first heartbeat is 2026-07-28. Ops Health showing it never-ran until then
> is expected, not an outage.
>
> ### 5. Still to verify — cheap, and not yet done
>
> **5a. Firestore reads.** #239 went live *with* this deploy, so the graph could
> not have moved before it. Console → Firestore → Usage, **on 2026-07-23**, so a
> full post-deploy day (2026-07-22) has elapsed and been ingested. Expect a step change down from ~1.4M
> reads/day. A missing step change *then* is a real regression worth chasing
> that day — largest cost item on the project. Immediate evidence meanwhile: the
> Functions log for `scheduledBracketSync` should show it skipping the stale
> tournaments.
>
> **5b. Two mid-frequency jobs.** `checkPlayoffScores` (30 min) and
> `nflLockWatchJob` (60 min) had not stamped as of 12:55 ET. If they still have
> no `system/heartbeats` entry, the wrapper has a problem on those two — check
> their Functions logs. Everything else missing was legitimately hours or a week
> away.
>
> ### 6. Kevin-only, in priority order
>
> 1. **A8 — publish the 2026 price and free-period end date. DUE 2026-08-06.**
>    The only calendar-bound item. **The target is the Hall of Fame game,
>    2026-08-06** (Thu, 8:00pm ET) — set by Kevin on 2026-07-21, one week
>    earlier than the 2026-08-13 these docs previously carried. The first
>    16-game preseason slate is 2026-08-13.
>
>    The HOF date was wrong here until 2026-07-21: ESPN reports kickoff as
>    `2026-08-07T00:00Z` (8:00pm ET = midnight UTC next day) and the UTC date
>    was copied down as the calendar date. See `PICKUP-PRESEASON-PILOT.md` §0.
> 2. **NFL-6 — arm the finalize sweep.** Firestore → `system` → `config` →
>    `nflFinalize`. Read a `NFL_FINALIZE_SWEEP` entry in SuperAdmin → Admin Audit
>    Log first: want candidates under `"1"` and **zero** under `"2"` in
>    `bySeasonType`. Then add `liveSeasonTypes`, type **array**, containing the
>    number `1`. **`dryRun:false` alone does nothing** — deliberate. Full steps:
>    `TOMORROW-TASKS.md` → NFL-6.
> 3. **Arm `nflDeepSweep`** (safe): `system/config.nflDeepSweep` →
>    `{ enabled: true, dryRun: true }`. Dry-run still DETECTS and REPORTS stat
>    corrections; it only suppresses the `nfl_games` write.
> 4. **Backups — the biggest exposure, and unverified.**
>    `PLAN-BACKUPS-PHASE3.md` still says "No PITR, no scheduled backups, no
>    exports, no Auth export." **Database location is `nam5`**, which supports
>    PITR — no blocker.
>    - **PITR first**: Firestore → `(default)` → Disaster Recovery → Edit. One
>      checkbox, no `gcloud` install, buys a 7-day recovery floor.
>    - **Then the Auth export** (`PLAN-BACKUPS-PHASE3.md` step 6). Firestore and
>      Auth are the half that cannot be recreated; the VPS is snapshotted daily
>      and the frontend rebuilds from git.
>    - If PITR is already on and the plan doc is stale, update that doc so the
>      next session stops re-raising it.
> 5. **`claimMySquares` timing decision.** ⚠️ Repo is PUBLIC, hole is unfixed,
>    documented in `SECURITY-CLAIM-SQUARES.md`. On file: accept through the
>    pilot, fix before the regular season.
> 6. **Retire the 3 stale tournaments** (optional — #239 already skips them).
>
> Standing: **leave `nflLockWatch.dryRun: true`** — only 1 of 49 preseason games
> has a betting line, so arming it pages nightly about a known condition.
>
> ### 7. What is still NOT proven
>
> - **The per-job heartbeat verdicts are not individually tested.** The guard is
>   a source-level check that a job *can* report failure; it cannot prove each
>   path is wired. Verified rather than assumed: deleting `autoLock`'s failure
>   count, or reverting the `playoffPools` `resp.ok` verdict, produces **no build
>   error and no test failure**. Extracting each verdict into a pure helper — as
>   `sweepRunVerdict` and `lockWatchVerdict` already are — is the follow-up.
> - **#250's nine rewritten handlers have no emulator coverage.** Its only test
>   addition is the source-level invariant. **Two of the nine** have produced
>   correct heartbeats in production (§3) — better evidence than CI gave, but two
>   of nine, on their healthy path only. No failure path has run in prod.
> - **`runReminders` cannot see failures its nested helpers swallow** —
>   `sendEmail` catches queue failures, `sendCourierSMS` returns a boolean nobody
>   reads. A run where every reminder email failed to queue still reports zero
>   failed pools.
> - **Eight files wrap a job that cannot report failure at all** — `adminHealth`,
>   `consensus`, `espnBracket`, `expertPicks`, `expertProfiles`,
>   `revenueAggregates`, `stripe`, `winProbability`. Shrink-only list.
>   `adminHealth` is the pointed one: a health check that cannot report its own
>   ill health.
> - **`nflFinalizeSweepJob` has still never completed a run in production**, and
>   its scheduled sweep path still has no emulator coverage.
> - **`replayFeedSnapshot` has still never been invoked against production.**
> - **`spread.locked` has still never been exercised end-to-end in prod**,
>   because `lockNFLSpreadsJob` has always been dry-run.
> - **The chaos drill (NFL-7) has not been run.** Needs a live preseason week.

> ## ✅ DEPLOY STATE 2026-07-21 — prod matches the SHA tagged in the STOP POINT box
>
> **Deployed 2026-07-21 ~16:40Z** (functions, bare `--only functions`) and
> **~16:54Z** (Coolify frontend, same commit, healthcheck passed). The queue is
> EMPTY — see the STOP POINT box at the top for what shipped and what still
> needs verifying. The box below describes the *2026-07-21* deploy and is kept
> for the verification pattern it records, not as current state.
>
> Two things learned doing it, both now folded into the runbook above:
>
> - **Use `npm --prefix functions ci`, not `install`.** `install` rewrites
>   `functions/package-lock.json`, dirtying the very tree `firebase deploy`
>   packages — so a clean-tree gate after it can never pass, and one before it
>   never sees the rewrite. `ci` installs strictly from the committed lockfile
>   and mutates nothing (verified 2026-07-21, exit 0, tree clean). The full
>   recipe is in `PICKUP-PRESEASON-PILOT.md` §4.
> - **The deploy hit HTTP 429 `Per project mutation requests per minute`** on
>   ~14 functions. firebase-tools retried each and all landed; `Deploy
>   complete!` at the end is the signal that matters. Not an error to chase.
>
> ---
>
> ### Historical: DEPLOY STATE 2026-07-21 <!-- deploy-state:ignore --> `main` @ `84e080c`
>
> **Deployed 2026-07-21 ~04:30Z**, full-fleet `--only functions`. The queue was
> empty as of that date. Verified from the deploy output, not assumed:
>
> - `nflDeepScoreSweepJob` — **Successful create**
> - `replayFeedSnapshot` — **Successful create**
> - `syncNFLScoresJob` — **Successful update** (this is the spread-unlock fix)
>
> Everything from PRs #231-#236 is live: the deep score sweep, the snapshot
> replay callable, the backups runbook, the security writeup, the doc-precedence
> fix, and the `brace-expansion` CI pin.
>
> **Both new functions are INERT until armed** — see "What is armed" below.
>
> ### ⚠️ The bug that shipped fixed, and why it did no damage
> `syncNFLScoresJob` was silently unlocking and re-pricing spreads for games
> later in the week: the ESPN fetch returns the whole week and every game is
> written back, but lock preservation only consulted the docs inside the
> `[now-24h, now+2h]` query window. The parser emits `spread.locked: false`, so
> any game outside that window had its lock reset AND its frozen line replaced.
>
> **No production data was harmed**, because the only writer of
> `spread.locked: true` is `lockNFLSpreadsJob`, which has been `dryRun: true`
> throughout and returns before its batch (`nflSchedule.ts`, the `if (gate.dryRun)`
> early return). No locks existed to destroy. The fix landed *before* spread
> locking is armed for preseason — which is exactly when it would have begun
> quietly eating locked lines. Found by qodo on PR #235, not by reading the code.
>
> ---
>
> ### Historical: DEPLOY STATE 2026-07-20 (superseded by the box above)
> The long-standing "merged but NOT deployed" backlog was **CLEARED as of
> `5e481c0`**. A
> full-fleet `--only functions` deploy plus `--only firestore:indexes` landed
> everything: the 33 callable-sweep batches, sweep batch 17, the NFL pilot work
> (A2/A3a/A4/A5p1/A6/A10), the spread-gate fix, the importer season filter, and
> both missing composite indexes. A subsequent bare deploy reported *every*
> function "Skipped (No changes detected)" — that is the confirmation.
>
> **Armed in prod, all dry-run:** `nflSpreadLock`, `nflLockWatch`,
> `nflFeedSnapshots` (+ `retentionDays: 45`). `nflFinalize` is
> `enabled:true, dryRun:true` and still needs `liveSeasonTypes` — see NFL-6.
>
> **Prod data:** 49 preseason games (2026 / seasonType 1) imported.
>
> **Smoke test PASSED:** `recalculateGlobalStats` (batch 17 changed it from a
> soft-return to a thrown permission-denied) returns an identical result pre-
> and post-deploy — 35 pools, totalPrizes 5535, 0 errors.
>
> ### THE LESSON FROM 2026-07-19/20 — read before trusting any "armed" claim
> **Two features were armed, deployed, and completely dead, both from missing
> Firestore composite indexes, both silent:**
> 1. **A5 feed snapshots** — `nfl_feed_snapshots(slate, fetchedAt)` was missing;
>    the `catch` that stops a snapshot failure breaking score sync swallowed it
>    on every run.
> 2. **`nflFinalizeSweepJob`** — `pools(type, scoredThroughWeek)` was missing, so
>    its `in`+inequality candidate query threw FAILED_PRECONDITION **every day
>    from 2026-07-10 to 2026-07-20** and produced ZERO audit entries.
>
> Neither was findable by reading code. Both surfaced from asking *"has this
> actually produced anything?"* **Treat "armed" and "working" as separate
> claims.** Any scheduled job should write something on EVERY run so
> "never fired" and "never ran" cannot be confused — `nflLockWatchJob` does this
> by design, and #223 retrofitted it onto the finalize sweep. The other
> schedulers still lack it.
>
> **Deploy hygiene (three silent-success incidents in two days):**
> `--only functions:a,b,c` deploys ONLY `a` — repeat `functions:` per name, or
> use a bare `--only functions`. And ALWAYS `git log --oneline -1` plus confirm
> the change is in the file on disk before deploying; a stale checkout will
> deploy old config and still print "Deploy complete!".

**Start every new session with: "Review HANDOFF.md and pick up where we left off."**
This file + auto-memory carry the full state. Older narrative lives in git history.

---

## 🌅 MORNING TAKEOVER — overnight NFL preseason-pilot run (2026-07-18, ~03:50–05:00)

**Read `TOMORROW-TASKS.md` first — it has TWO halves.** The sweep session's
sections are numbered `1`-`10`; this session's are `NFL-1`-`NFL-8`, below the
divider. In the top half, §1 is done (prod audit, no damage) and §2/§6 are
superseded/done — banners are in place. Everything needing Kevin lives there
with full numbered steps; this section is the engineering state.

### What shipped — all 6 engineering items from `PLAN-NFL-PRESEASON-PILOT.md`

| Item | What | PR | State |
|---|---|---|---|
| **A2** | Kill-switch + dry-run gate on `lockNFLSpreadsJob`, then exported it from index.ts (it had **never been deployed**) | [#205](https://github.com/kstruck/MMPoolsV3/pull/205) `d3dba97` | merged |
| **A4** | New `emulator-tests` CI job — the 45-fixture NFL matrix now gates every PR | [#206](https://github.com/kstruck/MMPoolsV3/pull/206) `7b9e08b` | merged |
| **A3a** | Pre-kickoff spread-lock tripwire (`nflLockWatchJob`) that pages ops via the Phase 2 dispatcher | [#207](https://github.com/kstruck/MMPoolsV3/pull/207) `869911b` | merged |
| **A10** | Finalizer/postponed-game investigation + surfaced the blocked reasons | [#208](https://github.com/kstruck/MMPoolsV3/pull/208) `87c46bd` | merged |
| **A5** (part 1) | ESPN feed snapshots + stat-correction detection | [#209](https://github.com/kstruck/MMPoolsV3/pull/209) `7d842a3` | merged |
| **A6** | `liveSeasonTypes` scope guard so the finalize sweep can be armed **preseason-only** | [#210](https://github.com/kstruck/MMPoolsV3/pull/210) `a1f3569` | merged |
| **NFL-1** | scope `SPREADS_NOT_LOCKED` to spread-consuming pools (follow-up, 2026-07-18 daytime) | [#214](https://github.com/kstruck/MMPoolsV3/pull/214) `8c8e9c5` | merged |

**Baselines moved — re-measured on merged <!-- deploy-state:ignore --> `main` @ `dd93629`, not summed from
PRs**: functions unit **685 → 771** (+86 tests), root vitest **257** (unchanged),
emulator **97 pass / 10 skipped** (unchanged), both typechecks clean. Every PR
ran all five gates before commit, and all five were re-run against merged main.

**qodo**: 16 findings across the run. 12 valid and absorbed, 4 rejected with
written evidence (a `firebase-tools` dependency-placement suggestion that
contradicted the repo's existing root-install pattern, an `: any`-count rule
aimed at pre-existing lines this PR only relocated, and snake_case naming twice —
which does not apply to this camelCase TypeScript codebase).

**Its best catch of the night, worth recording:** A5's snapshot query needed a
Firestore composite index that did not exist, and the `catch` that keeps a
snapshot failure from breaking score sync would have swallowed that error on
every run — the feature would have shipped silently dead, hidden by its own
safety net. Two other real saves: the finalize sweep applied its per-run cap
BEFORE the season-type scope filter (so a preseason-only arm could have
finalized nothing while reporting a full run), and `safeInt()` made "ESPN
dropped the score field" indistinguishable from "the team scored 0", which
would have paged a false `21-17 → 0-0` stat correction.

### Decisions: one resolved, one still open

1. ✅ **RESOLVED — the spread gate blocked pools that do not use spreads.**
   `SPREADS_NOT_LOCKED` ran unconditionally, 30 lines before the pool-type
   dispatch, so it blocked straight-up pick'em (the wizard's only mode — it
   hardcodes `pickMode: 'STRAIGHT'` with no ATS control), plus survivor and
   margin, none of which read a spread. Production was gating pick submission on
   data no production pool consumed; preseason (1 betting line across 49 games)
   merely exposed it. Fixed in **PR #214 (`8c8e9c5`, merged, NOT deployed)** by
   scoping the gate to `nflScoringEngine.poolUsesSpreads`, with the A3 tripwire
   scoped identically so it cannot page about pools that are no longer blocked.
   Zero behavior change for existing pools. qodo reviewed and raised no defects.
2. ⏳ **OPEN — alarm A3(b) (synthetic pick probe) was deliberately not built.**
   Doing it honestly needs a probe identity + probe pool in prod (Kevin's gate);
   doing it in-process would only duplicate A3(a)'s predicate. Recommendation
   and options in TOMORROW-TASKS **NFL-2**.

### Deploy state — NOTHING from tonight is deployed

Five functions change/appear: `lockNFLSpreadsJob` (**new**), `nflLockWatchJob`
(**new**), `syncNFLScoresJob`, `nflFinalizeSweepJob`, `submitNFLPicks` — **plus a Firestore index
deploy** (`firestore.indexes.json` gained a `nfl_feed_snapshots` composite
index; A5's snapshot writes fail silently without it). This queue sits **on top of**
the 33 undeployed callables below. Deploy command + verification steps are
TOMORROW-TASKS **NFL-4**. No frontend change tonight, so no Coolify trigger needed.

**Everything shipped is fail-safe OFF.** Three new config maps
(`nflSpreadLock`, `nflLockWatch`, `nflFeedSnapshots`) do nothing until armed —
console steps in TOMORROW-TASKS **NFL-3**.

### Behavior change worth knowing before you touch `nflFinalize`

A6 made arming **stricter**: setting `dryRun: false` *without* also setting
`liveSeasonTypes` now **keeps the sweep dry** and logs a refusal. There is no
unscoped way to arm the finalizer any more. This changes the long-standing open
loop "flip nflFinalize dryRun to false" — the flip now needs a third field.
See TOMORROW-TASKS **NFL-6**.

### Not built, deliberately (all recorded in TOMORROW-TASKS **NFL-8**)

- **A5 part 2**, the snapshot replay callable — prod-data mutator, wants its own PR.
- **The plan's "approve gate before payouts"** — already satisfied; finalization
  never touches money (`nflFinalize.ts:24-25`). The plan's premise was wrong here.
- **The "recalculated" banner** — frontend, and only meaningful once replay exists.
- **A7 chaos drill** — a runbook for Kevin to execute during a preseason week, not
  code. Written out in TOMORROW-TASKS **NFL-7**.

---

## ✅ SWEEP-LATER worklist CLOSED 2026-07-19 (batch 17, PR #220) — but read the caveat

The 10 callables HANDOFF listed as "actionable remaining" are wrapped. That
closes the SWEEP-LATER worklist **as written**.

⚠️ **It does NOT mean every callable is wrapped.** ⚠️ **The count below is
STALE — it is 26, not 25, and `searchUsersByEmail` has since been migrated to
`validated()`. See `SECURITY-BARE-ONCALL-CLASSIFICATION.md` (2026-07-21) for the
verified per-callable breakdown; this paragraph is kept for history.** A grep of
`main` was said at the time to find
**25 bare `onCall(`** exports: ~16 sim-harness (own `requireAuth`/SUPER_ADMIN
gates, never SWEEP-LATER rows), 3 aiTesting, `createBracketPool` (deliberately
deferred — `...settings` passthrough), plus `getServerTime`, `logClientError`,
`recordPoolPayouts`, `getProfilePoolDetail`, `refreshExpertProfiles`,
`backfillProfileData`, `simulateGameUpdate` (mix of PUBLIC-EXEMPT and rows
wanting re-classification). None is a regression. **Do not quote "the sweep is
complete" without this qualifier** — PR #220's own title overclaims it.

Batch 17 carries ONE deliberate behavior change: `recalculateGlobalStats` now
THROWS permission-denied instead of soft-returning `{success:false}`. Smoke-test
the SuperAdmin stats surface after deploying.

## Prior state: **11 SWEEP-LATER callables remain** (10 actionable + createBracketPool deferred) — batches 1-4 deployed, batches 5-13 + 3 fixes merged to main but UNDEPLOYED

The trust-boundary `validated()` sweep of the parked SWEEP-LATER callables is underway. Kickoff/recipe doc: `PICKUP-CALLABLE-SWEEP.md`; classification authority: `PLAN-SECURITY-OBSERVABILITY-SWEEPS.md`.

> **Count caveat — trust the grep, not the fraction.** The SWEEPS matrix header says 51 SWEEP-LATER rows, but 43 swept + 11 still-unwrapped = 54, so the header or the row classifications are off by ~3. Don't quote an "N/51" fraction. The authoritative check is:
> ```
> grep -rn "export const <name> = " functions/src --include=*.ts
> ```
> — `= onCall(` means unwrapped, `= validated(` means done. The 11 remaining are listed at the bottom of this section.

**Fully swept files:** `bracketEntries.ts` (6/6), `adminClaims.ts` (4/4), `poolOps.ts` (3/3), `nflPools.ts` (3/3 SWEEP-LATER; `calculatePlayoffScores`-style legacy noop N/A here), `billing.ts` (2/2 SWEEP-LATER), `couponTemplates.ts` (2/2 SWEEP-LATER; 3 others already TARGET-NOW), `espnBracket.ts` (5/5), the 4 no-input SUPER_ADMIN callables (`getAdminHealthSnapshot`/`backfillPools`/`refreshExpertPicks`/`syncPlayoffPools`, one each in 4 different files). `bracketPools.ts` at 2/3 (`createBracketPool` deliberately deferred, see below).

> ⚠️ **The "Deploy state" column below is HISTORICAL and no longer accurate.**
> Every batch in this table was deployed by the 2026-07-20 full-fleet deploy and
> again on 2026-07-21. Rows reading "merged, NOT deployed" reflect the state at
> the time each row was written, not today. Prod still matches
> <!-- deploy-state:ignore --> `main` @ `84e080c` **but the deploy queue is NO
> LONGER EMPTY** — that sentence was true on 2026-07-21 and is not true now.
> See the STOP POINT box at the top of this file. The table is kept for the
> PR/batch mapping, which is still useful.

| Batch | PR | Callables | Deploy state |
|---|---|---|---|
| 1 | #176 | `createBracketEntry` / `updateBracketEntry` / `deleteBracketEntry` | deployed |
| 2 | #177 | `updateEntryPayment` / `adminUpdateEntryOverrides` / `adminDeleteEntry` (admin two upgraded claim-only → C5 claim+doc) | deployed |
| 3 | #179 | `publishBracketPool` / `joinBracketPool` | deployed |
| 4 | #180 | `syncMyClaims` / `backfillUserRoles` (+ null-input fix) | deployed |
| 5 | #183 | `poolOps.ts`: `recalculatePoolWinners` / `toggleWinnerPaid` / `fixParticipantIds` | **merged, NOT deployed** |
| 6 | #184 | `nflPools.ts`: `joinNFLPool` / `executeSurvivorRebuy` / `scoreNFLWeek` | **merged, NOT deployed** |
| 7 | #185 | `billing.ts`: `validateBillingAccess` / `getPoolQuote` | **merged, NOT deployed** |
| 8 | #186 | no-input quartet: `getAdminHealthSnapshot` / `backfillPools` / `refreshExpertPicks` / `syncPlayoffPools` | **merged, NOT deployed** |
| 9 | #187 | `couponTemplates.ts`: `deleteCouponTemplate` / `acknowledgeMonetizationAlert` | **merged, NOT deployed** |
| 10 | #188 | `espnBracket.ts`: `importTournamentFromESPN` / `adminInitTournament` / `syncBracketTournament` / `importConferenceTournamentFromESPN` / `syncPlayInPicks` (closes a C5 auth-fallback finding for all 5) | **merged, NOT deployed** |
| 11 | #191 | `bracketScoring.ts`: `scoreBracketEntries` / `finalizeTournamentPayouts` (both claim-only → C5 claim+doc) | **merged, NOT deployed** |
| 12 | #192 | `conferenceTournaments.ts`: `initializeBigEastTournamentHttp` / `initializeBig12TournamentHttp` (both were **doc-only** role checks — last two in the fleet) | **merged, NOT deployed** |
| 13 | #194 | `squares.ts`: `updatePlayer` / `releaseSquares` | **merged, NOT deployed** |
| — | #190 | `backfillPools` dry-run gate (defaults true, `plannedWrites` report, FE dry/live button pair) | **merged, NOT deployed** |
| — | #193 | `backfillPools` status-clobber fix + per-entry fold marker | **merged, NOT deployed** |
| — | #195 | squares lookup-key `.trim()` regression fix (follow-up to #194) | **merged, NOT deployed** |
| 14 | #197 | `propBets.ts`: `gradeProp` / `updatePropCard` | **merged, NOT deployed** |
| 15 | #199 | `referral.ts`: `generateReferralToken` / `resolveReferralToken` (public) | **merged, NOT deployed** |
| 16 | #200 | admin singles: `lockPool` / `logAdminAction` / `recomputeConsensus` / `recomputeRevenue` | **merged, NOT deployed** |

Batches 1-4 deployed 2026-07-17/18 (see prior narrative below). **Batches 5-13 plus the three fix PRs (2026-07-18) are merged to `main` but explicitly NOT deployed** — deploy is Kevin's gate per `mmp-change-control`; nothing has run `firebase deploy`. Before deploying, verify every merge landed (`git log origin/main --oneline -20`), then follow the functions-first ritual:

> ⚠️ **`functions:` MUST be repeated before EVERY name.** `--only functions:a,b,c`
> deploys **only `a`** — firebase-tools splits on `,` and silently discards any
> segment that does not start with `functions:` (`functionsDeployHelper.js`,
> `getEndpointFilters`). It then prints `✔ Deploy complete!`, so the failure is
> invisible. This bit us for real on 2026-07-18: a 33-name deploy shipped 1
> function and reported success.

```
npm --prefix functions ci
npx firebase deploy --only functions:recalculatePoolWinners,functions:toggleWinnerPaid,functions:fixParticipantIds,functions:joinNFLPool,functions:executeSurvivorRebuy,functions:scoreNFLWeek,functions:validateBillingAccess,functions:getPoolQuote,functions:getAdminHealthSnapshot,functions:backfillPools,functions:refreshExpertPicks,functions:syncPlayoffPools,functions:deleteCouponTemplate,functions:acknowledgeMonetizationAlert,functions:importTournamentFromESPN,functions:adminInitTournament,functions:syncBracketTournament,functions:importConferenceTournamentFromESPN,functions:syncPlayInPicks,functions:scoreBracketEntries,functions:finalizeTournamentPayouts,functions:initializeBigEastTournamentHttp,functions:initializeBig12TournamentHttp,functions:updatePlayer,functions:releaseSquares,functions:gradeProp,functions:updatePropCard,functions:generateReferralToken,functions:resolveReferralToken,functions:lockPool,functions:logAdminAction,functions:recomputeConsensus,functions:recomputeRevenue --project gridiron-gamble-uzuqo
```

**The frontend also has undeployed changes** (`OperationsPanel.tsx` gained a "Backfill Pools (dry run)" button in #190) — that needs the manual Coolify trigger, which does NOT happen on push to `main`.

### ⚠️ `backfillPools` behavior change — read before running it
PR #190 changed `backfillPools` to **default to dry-run**. The existing "Backfill Pools" button now sends `dryRun: false` explicitly, so it still writes — but any *other* caller that omits the flag now reports instead of writing. PR #193 then fixed two real defects in it:
- It used to reset **COMPLETED pools to DRAFT** (it recomputed `status` from `isLocked`/`isFinal`, ignoring the existing value). If this backfill has ever been run against prod, **finished pools may already have been un-completed** — worth an audit query before running it again.
- The historical-stats fold (`FieldValue.increment` on `users/{uid}.historicalStats`) is now guarded per-entry so it can't double-count. **Limitation:** entries folded by a run predating that marker carry none and would fold again. Dry-run first and read `plannedWrites`.

### ✅ PROD backfillPools damage audit — RAN 2026-07-18, NO DAMAGE FOUND

Read-only Firestore queries against prod (Firebase console; nothing written).
The pre-#193 bug wrote `status = isLocked ? 'LOCKED' : (isFinal ? 'FINAL' : 'DRAFT')`.
The load-bearing claim is narrow and was re-verified after review: **`backfill.ts:55` is
the only production path that WRITES a pool `status: 'FINAL'`** — so that stored value is
a fingerprint for the bug. (It is NOT true that every other `'FINAL'` is an nfl_games
status: `'FINAL'` is in the pool status type unions and is read at `payoutRecords.ts:60`.
Nor are `'LOCKED'`/`'OPEN'` the only other writes — the create paths write `'DRAFT'`,
which is why the 28 DRAFT pools need no special explanation.)

`status=='FINAL'` → **0 pools**. `DRAFT`∩`isFinal:true` → **0**. `LOCKED`∩`isFinal:true` → **0**.
Positive control `status=='OPEN'` → 15 ✓. Verdict: the clobber never hit prod; the 28
DRAFT pools carry no finished-pool signals. PR #193 still ships as prevention, but there
is **no remediation task and no pool IDs to repair**. Detail in TOMORROW-TASKS §1.

⚠️ **Console-audit gotcha learned the hard way:** the Firestore filter panel reopens
COLLAPSED, so edits to the value box silently don't register and the PREVIOUS query
re-runs looking like a new one. Three readings were bogus before a positive control
caught it. Always verify the `.where(...)` preview string before Apply, and always
include a control query that must return rows.

### Backfill / migration audit (2026-07-18, report only — no fixes applied)

Ran after the `backfillPools` defects, to check whether the same two bug classes appear in sibling
batch operations. **Both classes turned out to be unique to `backfillPools`.** Nothing else needs fixing;
recorded so this isn't re-derived.

*Class A — deriving a field from inputs that cannot express all its states, ignoring the stored value.*
`grep -rn "isLocked ?.*'LOCKED'\|isFinal ?.*'FINAL'"` over `functions/src` + `src` returns exactly one
write site: `backfill.ts:55` (now guarded by `if (!pool.status)`). Every other hit is display-only JSX.

*Class B — non-idempotent `FieldValue.increment` in a re-runnable batch op.* Ten files use `increment`.
Classified:
- `backfill.ts` — was the only re-runnable batch offender; now guarded per entry (#193).
- `statsTrigger.ts` `recalculateGlobalStats` — **safe**: recomputes and writes ABSOLUTE totals (`set`, not
  increment), so re-running is idempotent by construction. This is the pattern the other backfills should
  copy.
- `bracketEntries.ts` / `bracketPools.ts` / `participant.ts` / `propBets.ts` / `billing.ts` — per-user-action
  counters (`entryCount` etc.), one increment per real event, not batch ops.
- `stripe.ts` — webhook path, already de-duped by event id (PR #166 durability work).

*One genuine pre-existing risk found, NOT fixed (needs a decision):* `statsTrigger.ts`'s
`onDocumentUpdated` trigger increments `stats/global.totalPrizes` / `.totalDonated` on the
`!before.isLocked && after.isLocked` edge. Cloud Functions triggers are **at-least-once**, so a duplicate
delivery of the same event re-runs the guard with identical before/after and increments twice. Low
probability, silent when it happens, and self-correcting only if someone runs `recalculateGlobalStats`
(which overwrites with absolute values). Options if it ever matters: stamp the pool with a
`statsFoldedAt` marker and check it in the trigger, or rely on periodic `recalculateGlobalStats` as the
reconciler. Not urgent — flagged so it's on record.

**Verify-before-strict lessons banked** (all now encoded in the PICKUP recipe):
1. `createBracketEntry` accepts a handler-*ignored* `tiebreakerScore` — must stay accepted or real calls break.
2. `updateEntryPayment`'s `paidAt`/`paymentNote` use explicit `null` to CLEAR the field → schema uses `.nullable()` NOT `nullish()` (nullish maps null→undefined and silently kills the clear feature). A test pins null-preservation.
3. **No-input callables must `z.preprocess((v) => v ?? {}, z.strictObject({}))`** — a no-arg `httpsCallable(fn)()` delivers `request.data` as `null`, which a bare strict object rejects. Shipped as a real bug in batch 4 (`syncMyClaims`), caught in review, fixed in #180. Batch 8 (#186) promoted this to a shared `noInputSchema` helper in `lib/zodHelpers.ts` (5th occurrence) and used it for all 4 remaining no-input callables — that gotcha is now fully closed across the fleet.
4. **A prod batch-mutation callable's `dryRun` flag must fail SAFE (default true) at the SCHEMA layer, not the handler.** qodo caught this on PR #183: `fixParticipantIds`'s pre-existing handler logic (`dryRunInput === true`) silently ran LIVE when the flag was omitted — contradicted the schema's own "default true" doc comment and the repo's dry-run-by-default convention (PRs #127/#129/#180). Fixed with `z.boolean().optional().default(true)` at the schema layer instead of a handler-side truthy check. Check any other dryRun-flag callable you retrofit for the same footgun. (`backfillPools` had NO dry-run at all — since fixed in #190, which also uncovered two real defects in it; see the warning box above.)
5. **Shared cross-boundary schemas (anything under `shared/schemas/`, generated into `functions/src/shared/`) are OUT OF SCOPE for `.strict()`-ifying** even when a SWEEP-LATER row uses one — `getPoolQuote`'s `poolQuoteInputSchema` was deliberately left non-strict (batch 7, PR #185): it's consumed by both the callable and the checkout flow, and the matrix documents its current shape as intentional. Move the auth+parse gate onto `validated()` using the existing schema as-is; don't tighten a shared contract on a drive-by.
6. **The C5 finding (some admin callables read a spoofable Firestore `users/{uid}.role` as a fallback when the JWT claim is absent) resolves for free** when you retrofit with `validated()`'s `role:` option — it calls `assertCallerRole`, which requires claim AND doc to agree, not claim-OR-doc. Batch 10 (#188, `espnBracket.ts`) closed 5 instances in one pass; batch 12 (#192, `conferenceTournaments.ts`) closed the last two, which were **doc-only** (weaker still — the JWT claim was never consulted at all). **No admin callable in the fleet now authorizes off a Firestore doc alone.**
7. **NEVER `.trim()` a string the handler uses as a LOOKUP KEY.** Regression shipped in batch 13 (#194), caught by qodo, fixed in #195. `updatePlayer.originalName` / `releaseSquares.ownerName` are matched with `===` against the stored `squares[].owner`; `reserveSquare` stores names untrimmed, so `" Alice "` is reachable. Trimming at the boundary made that player un-editable and silently un-releasable (released nothing, still returned success). Rule: `.trim()` is safe on server-generated identifiers (`poolId`, `tournamentId`), never on user-supplied strings used to match stored data. Normalizing at a trust boundary is only correct if the stored side was normalized identically.
8. **Some optional fields are load-bearing — omission can be a MEANING, not a mistake.** `scoreBracketEntries`'s `tournamentId` is optional because omitting it is the *global* form (score every pool-linked tournament), which is exactly what the OperationsPanel button does. A required schema would have broken it. Check what a *missing* field does in the handler before making it required.
9. **A callable can have more than one caller sending different shapes.** Batch 12's two callables are hit by OperationsPanel (`{}`) *and* TournamentManager (five fields, three of which those handlers ignore). Grep every call site, not the first one.
10. **An idempotency marker must be written in the SAME batch as the write it guards.** qodo caught this on #193: a per-pool marker written after the entry loop is not safe, because a pool with >400 entries flushes mid-loop and can commit increments before the marker exists. Marker moved per-entry, staged alongside its own increment, with the flush check after both — batch commits are atomic, so an applied increment can never be unmarked.
7. **A handler that soft-returns `{success:false, message}` instead of throwing on missing input** can still get a `.strict()`+required-field schema — just verify the FE always sends those fields (never omits them) and already wraps the call in try/catch, so a thrown `invalid-argument` surfaces the same way to the user as the old soft-return did. Two espnBracket.ts callables hit this in batch 10; both verified safe via the FE call site before tightening.

**Next on the fleet — 10 actionable remaining, grep-verified as still `= onCall(`:**

`markEntryPaidStatus` (bracketOps.ts), `calculatePlayoffScores` (playoffPools.ts, legacy noop),
`backfillMemberRecords` (migrations/), `importNFLSchedule` (nflSchedule.ts), `searchUsersByEmail`
(userManagement.ts — declared `functions.https.onCall`, a bare `grep onCall(` misses it),
`recomputeMyProfile` (userProfile.ts), `fixPoolScores` (scoreUpdates.ts), `syncAllUsers`
(userSync.ts), `recalculateGlobalStats` (statsTrigger.ts), `claimMySquares` (participant.ts).

Two carry a wrinkle worth knowing BEFORE you wrap them:

- `recalculateGlobalStats` — its SUPER_ADMIN check **`return`s a `{success:false}` object instead of
  throwing**, deliberately (a comment says it avoids CORS masking the message). `validated()`'s `role:`
  gate THROWS `permission-denied`. Wrapping it therefore changes the failure contract for that endpoint;
  check the SuperAdmin caller handles a thrown error before flipping it.
- `syncAllUsers` — **the matrix note claiming it has no role gate is STALE.** It already calls
  `assertCallerRole(request, "SUPER_ADMIN")` (the C4 sweep fixed it). Wrapping is a straight
  like-for-like; the in-handler call becomes redundant and can go.

Same recipe, runnable unattended.

### 🔴 Security finding: `claimMySquares` treats a readable field as a bearer secret (NOT fixed)

Found while triaging the remaining rows. **Not a schema problem — wrapping it in `validated()` will not
fix it, so it was left alone.**

`claimMySquares` (participant.ts) claims squares by matching a client-supplied `guestDeviceKey` against
`squares[].guestDeviceKey`. Knowing the key IS the proof of ownership. But `reserveSquare` stores that key
**on the square inside the pool document**, and `firestore.rules` has `allow get: if true` for
`/pools/{poolId}` — so anyone with a pool id can read every guest square's device key.

Net effect: any authenticated user who can read a pool can claim that pool's **unclaimed** guest squares
to their own uid. Partly mitigated — the handler refuses to take a square already bound to a different
`reservedByUid`, so registered owners can't be robbed; the exposure is guest-reserved squares that the
guest has not claimed yet (i.e. someone who paid but hasn't made an account).

Fixing it needs a data-model or rules change (move `guestDeviceKey` out of the public pool doc, or require
a different proof), not a drive-by — and firestore.rules write/read-path changes are a separate parked
effort per PICKUP's hard don'ts. Flagged for a decision.

**Deliberately deferred:** `createBracketPool` (SWEEPS row 7) — rich nested `settings` with a `...settings` passthrough spread that stores arbitrary client fields; a flat `.strict()` would reject data it currently persists. Needs a passthrough envelope or client cutover, same treatment as the ADR-0001 PERMISSIVE creates. Its own careful batch, not a drive-by.

Baselines measured on merged `main` at 0a7b9b6 (2026-07-18): root vitest **257** (unchanged all session), functions unit **685**, emulator **97 pass / 10 skipped**, frontend `tsc -b` clean. Counts rise with every batch — re-measure, don't trust a stale number.

---

## Phase 2 observability (#8–14) — SHIPPED, merged, deployed, prod-verified

PR [#171](https://github.com/kstruck/MMPoolsV3/pull/171) (all 7 plan items — Sentry FE spine, correlation id, business-failure→Sentry wiring, ops alert dispatcher, readiness endpoint, in-app Ops Health card, SLOs) merged `7b2a522`, functions + frontend deployed, qodo's 4 findings fixed pre-merge. **One post-deploy bug found+fixed**: `readiness` was configured at 128MiB and OOM'd at cold start (Admin SDK + Node 22 alone use ~131MiB) — Kevin's live GCP Uptime Check test caught it as a 503, fixed in a same-day follow-up PR #173 (bumped to 256MiB, merged, redeployed) — Uptime Check now green. Firestore `system/config.opsAlerts` populated (Kevin). Sentry confirmed live in prod (`window.__SENTRY__` present, real DSN baked into the bundle, verified via direct browser check against `marchmeleepools.com`).

**Not done (optional, not urgent):**
- GCP Cloud Monitoring SLO objects + burn-rate alerting policies (uptime check alone is done; the other 3 SLOs — checkout success, webhook error rate, latency p95 — still need console setup). Target numbers in `PLAN-SECURITY-OBSERVABILITY.md`'s Phase 2 SLO section.
- Cosmetic: the Sentry lazy-load (dynamic `import('@sentry/react')` in `src/sentry.ts`) didn't actually get code-split into its own chunk by Vite's bundler in the prod build — it got merged into the main bundle. Functionally harmless (Sentry works), just didn't achieve the "defer off initial load" perf intent. Kevin said fix "when it makes sense" — not urgent.
- `SENTRY_DSN` functions secret (optional — activates backend Sentry events for Stripe webhook failures; Firestore alerts + ops email/SMS already work without it).

Below this: prior narrative (sim harness — still COMPLETE, deployed, prod-verified; unrelated to Phase 2).

**NFL Sim Harness (PLAN-NFL-SIM-HARNESS.md) — ALL PHASES SHIPPED.**
Core (0/1/2/3/4-core/6) 2026-07-10 via PR #156 + qodo PRs #157-159. **Phase 4
(matrix, items 25-27) + Phase 5 (legacy migration + rules-backdoor removal, items
28-30) shipped 2026-07-11 via PRs #161/#162**, expectations human-verified
(PHASE4-EXPECTATIONS.md, signed-margin rule confirmed), qodo cycle absorbed (3
findings: 4 surviving raw entry writes migrated onto new `updateEntryPayment`/
`adminUpdateEntryOverrides`/`adminDeleteEntry` callables; slug fix; audit-comment
honesty). Functions (7 new) + **firestore.rules (both backdoors DROPPED)** +
Coolify deployed 2026-07-11 evening, functions-first. **Prod smoke: 45/45 NFL
scenarios + squares/playoff/props/bracket-E2E + Tournament Simulator + Fill Grid
all green through the migrated guarded-callable path.** 45-fixture matrix runs in
emulator CI; `simRuns` manifests carry per-assertion run history (`simReportRun`).
No client can raw-create pool docs or raw-write entries anymore — including
SUPER_ADMIN sessions.

## ⚡ Kevin's pending 5-minute item

**Arm the finalize sweep** (safe — deployed stack has all guards):
1. Firestore console → `system` collection → `config` doc.
2. Add field `nflFinalize`, type **map**, containing `enabled` (boolean) = `true` and
   `dryRun` (boolean) = `true`.
3. Sweep runs daily 08:30, REPORTS ONLY while dryRun. After 1-2 days check
   SuperAdmin → Admin Audit Log for `NFL_FINALIZE_SWEEP` entries; when candidate
   lists look sane, ask Claude for the flip-to-live step.

## Phase 2 observability — CLOSED 2026-07-17

PR #171 merged+deployed, PR #173 (readiness OOM fix) merged+deployed, Firestore
`opsAlerts` populated, GCP Uptime Check green, Sentry confirmed live in prod.
Remaining optional items (SLO objects, cosmetic chunk-splitting) listed in the
"Current state" section above — not blocking, not time-sensitive.

## Next-effort menu (pick one to start a session)

1. **Security/Observability plan — Phase 1 COMPLETE (callables + webhook durability) and DEPLOYED.**
   Webhook durability (PR #166, merge 6c87891, deployed 2026-07-17): handleStripeWebhook
   no longer deletes failure state — a failed event flips to status:"failed" + attemptCount,
   de-dupes on Stripe's retry, and alerts ops once (=== threshold) via monetization_alerts/
   WEBHOOK_FAILED_<id>; claimEvent() re-claims failed docs (set/merge, safe on raced delete);
   added handlers for checkout.session.async_payment_failed + payment_intent.payment_failed
   (were falling through the silent default). Pure decideEventClaim/shouldAlertOnFailure in
   lib/webhookDurability.ts, 9 unit tests. qodo: 3 findings (2 fixed, 1 rejected w/ evidence).
   NOTE (deploy gotcha, 2026-07-17): a first merge attempt silently didn't take — git pull
   said "Already up to date" and deploy skipped every function as "No changes detected"
   because main never advanced. ALWAYS verify `gh pr view <N> --json state` == MERGED and
   `git log origin/main` shows the merge commit BEFORE trusting a deploy; a no-op skip on a
   change you expect to ship means the merge/pull didn't land.
   CLOSED SECURITY ITEM: npm critical websocket-driver<=0.7.4 (GHSA-mp7j-qc5w-4988 +
   GHSA-xv26-6w52-cph6) — fixed PR #170 (merge c95edb4, 2026-07-17). Transitive via
   firebase-admin AND the root firebase client SDK → @firebase/database → faye-websocket.
   Added "websocket-driver":">=0.7.5" to the overrides block in BOTH package.json (root +
   functions) — the CI security-audit runs `npm audit --audit-level=high` at ROOT, so a
   functions-only fix left it red (qodo + CI both caught this). App is Firestore-only so the
   WS path never loads; low real risk, but it's a critical + blocked CI. Lockfiles regen'd
   --package-lock-only (only websocket-driver moved). NOT merged as a functions deploy — the
   change is a lockfile-only bump of an unused transitive; rides with the next functions deploy.
   REMAINING (low-pri backlog): 2 moderate npm advisories below the high gate —
   @opentelemetry/core (via @google-cloud/pubsub→firebase-tools, DEV) and morgan (log-forging).
   Neither blocks CI. firebase-admin pinned ^12.7.0 (latest 14.2.0) — a future major-bump task
   would clear these + the whole transitive chain naturally.

   Prior wave (callables): 
   Wave 1: PR #164 (16 callables, deployed 2026-07-11 night). Wave 2: PR #165
   (remaining 25, merged f4df975 + functions deployed by Kevin 2026-07-12 late
   night; functions:list + post-deploy log sweep clean — zero invalid-argument
   or Invalid-request rejections). Every TARGET-NOW callable now runs through
   validated() (App Check monitor → auth → role claim+doc → strict zod);
   schemas in functions/src/schemas/* with unit tests pinning real client
   payloads. qodo lifetime on this plan: 3 findings, 3 VALID, all absorbed.
   Baselines now: functions unit 545, root vitest 244, emulator 84+10 skipped.
   Note: root tests mock onCall in tests/mocks/firebase-functions-v2-https.ts
   — it now supports the two-arg onCall(options, handler) form validated()
   uses, and onboarding-flow assertions pin the NEW gate error messages.
   Phase 2 (observability, #8-14) is now SHIPPED+DEPLOYED — see "Current
   state" at the top of this file, PR #171 + #173.
   Remaining Phase-1-adjacent follow-ups (pick one): (a) App Check
   monitor→enforce flips per endpoint (PLAN #5) after a
   coverage-measurement window; (b) firestore.rules write-path sweep (the
   pools allow-update isSuperAdmin() rule + playoff/props raw writes
   deliberately parked for it); (c) SWEEP-LATER callable fleet (63, includes
   the correlation-id sweep's ~13 remaining direct-httpsCallable files);
   (d) tighten the two PERMISSIVE create envelopes (ADR-0001); (e) Phase 3
   (backups #15-19).
   Note from Phase 5: the general pools `allow update: isSuperAdmin()` rule + playoff/props
   pool-doc/propCards raw writes were deliberately left for THIS plan's write-path sweep.
2. **Player Profiles follow-ups** — flip `profileBackfill`/`nflFinalize` dry-runs after
   reports look right; Achievements engine requirements (Kevin gathering); Expert Picks
   UI surface (`nfl_games/{id}.expertPredictions` is ingesting, nothing displays it yet).
3. **Small follow-ups parked from Phase 4/5:** settingsMatrix test uses wrong key
   `autoSurviveExemption` (engine reads `autoSurviveExemptionEnabled`; inert, 1-line);
   `profileField` assertion implemented but unwired (needs a `simRecomputeProfile`
   callable if a browser golden ever wants profile asserts); optional margin/survivor
   "season teams strip" UI (all 32 teams, used ones crossed out — pick sheets already
   gray out used teams per game).

## Key documents

| Doc | What |
|---|---|
| `HANDOFF.md` | THIS FILE — session entry point |
| `PLAN-NFL-SIM-HARNESS.md` + `-REVIEW-LOG.md` | Locked harness plan + Codex trail |
| `TAKEOVER-NFL-SIM-HARNESS.md` | Overnight-build narrative + deploy runbook (historical) |
| `PLAN-SECURITY-OBSERVABILITY.md` + `-SWEEPS.md` + `-REVIEW-LOG.md` | Security/observability plan — Phase 1 + Phase 2 both shipped+deployed (PR #171, #173); Phase 3 not started |
| `PROMPT-GRILL-PLAYER-PROFILES.md` | Consumed — profiles shipped via PR #153 |
| `CONTEXT.md` | Glossary (Sim Run, Test Pool, Scenario, Golden Scenario, Scenario Oracle, …) |
| `docs/adr/0006-*.md` | Real-path fidelity via extracted internals |

## Environment / deploy facts (unchanged)

- Deploy: `npm --prefix functions ci` first (NOT `install` — it rewrites the lockfile and dirties the tree the deploy packages), then `npx firebase deploy --only functions:… --project gridiron-gamble-uzuqo`. Functions before rules. Frontend = Coolify — **manual trigger only**, pushing to `main` does NOT auto-deploy it (corrects a stale claim that lived here; matches CLAUDE.md + the mmp-deploy-and-operate skill).
- Emulator tests need Java on PATH: `JAVA_HOME=/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot`; run `npm --prefix functions run test:emulator`. Unit: `npm --prefix functions test` (410 tests; emulator suite 39).
- **PR review = `codex exec review --base origin/main`, 5 rounds max** (CLAUDE.md §2c). **qodo is OFF** — Kevin removed the check on 2026-07-25 (§2b); codex is its temporary replacement. Validate every finding before fixing; a rejection needs written reasoning on the PR.
- Untracked strays at root: `PLAN-LOOPS.md`, `PLAN-SECURITY-OBSERVABILITY*.md` (copies of branch-committed files). Harmless; don't commit blindly.

## Do NOT re-do

Plans are locked + adversarially reviewed (Codex ×4 for the harness; ×5 for profiles/security). Don't re-grill. Don't author Phase-4 edge fixtures without Kevin verifying expectations. Don't arm `nflFinalize.dryRun:false` without dry-run reports. The `sim-` rules backdoors stay until Phase 5 (supervised).
