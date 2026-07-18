# TOMORROW-TASKS.md — Kevin's morning checklist (2026-07-18 → 2026-07-19)

> ## 📍 THIS FILE HAS TWO HALVES — read this map first
>
> | Half | Sections | From | Status |
> |---|---|---|---|
> | **Top** | `1`–`10` (below) | the callable-sweep session | sweep deploy still **TO DO**; §1 is **DONE (no damage)**; §2 and §6 are **SUPERSEDED**, see below |
> | **Bottom** | `NFL-1`–`NFL-8` (line ~290, after the `---` divider) | the NFL preseason-pilot session | **all current** |
>
> The NFL session finished. Its section is the second half of this file — if you
> scrolled only to the divider, you have not seen it.
>
> **Two sections in the top half are now stale and must not be actioned as
> written:**
> - **§2 (nflFinalize dry-run flip) — SUPERSEDED by NFL-6.** The flip changed on
>   2026-07-18. Setting `dryRun: false` on its own now *keeps the sweep dry*;
>   arming also requires `liveSeasonTypes`. Following §2 as written will look
>   like it silently did nothing. Use **NFL-6**.
> - **§6 (pick up the NFL session's output) — DONE.** That session finished; its
>   output is the bottom half of this file plus the HANDOFF takeover note.
>
> **Suggested order:** ~~§1~~ (done — no damage found) → **NFL-2** (the one open
> decision; NFL-1 is resolved and fixed) → §3-§5 (deploy the 33 sweep callables)
> → **NFL-3**…**NFL-8** → §7-§10 (business items, no code risk).

Two things ran overnight: (1) the callable-sweep session, which merged 12 PRs
(#190–#201) — nothing deployed; (2) an NFL 2026 preseason pilot session may
still be running or may have finished by the time you read this, using
`PLAN-NFL-PRESEASON-PILOT.md`. This file lists everything that needs YOUR
action, in the order to do it in, plus how to safely pick up whatever the NFL
session produced without conflicting with the undeployed sweep work.

**Do the numbered sections in order.** Each one says where to be, what to run
or click, what you should see, and what to do if you don't.

---

## Why this order

1. **Data audit first** (Section 1) — read-only, zero risk, tells you whether
   prod damage already happened. Do this before anything else touches data.
2. **Standing decision** (Section 2) — independent of tonight's work, been
   open since 2026-07-10, quick to close out.
3. **Deploy the sweep** (Sections 3–5) — ships 12 PRs worth of security
   hardening that's been sitting merged-but-live-unprotected. Uses a
   **targeted function list** (not a bare `npx firebase deploy` — always use
   `npx firebase`, never a global `firebase` install, and always with
   `--only`), which is why
   it's safe to run regardless of what the NFL session is doing in parallel
   — see the conflict note in Section 3.
4. **Pick up the NFL session's output** (Section 6) — do this after the sweep
   deploy, not before, so you're reviewing NFL work against a codebase that
   already has last night's security fixes live.
5. **Business decisions** (Sections 7–10) — no code risk, can happen anytime
   this week, but A8 has a real deadline (before preseason week 1, 2026-08-13).

---

## 1. ✅ Audit prod for backfillPools damage — DONE 2026-07-18, NO DAMAGE FOUND

> ### ✅ RAN IT. Verdict: no evidence of status-clobber damage in production.
> Read-only queries against prod Firestore via the Firebase console, 2026-07-18.
> Nothing was written.
>
> **The decisive test.** The pre-#193 bug wrote
> `status = isLocked ? 'LOCKED' : (isFinal ? 'FINAL' : 'DRAFT')`. A grep of the
> whole repo shows **no production code path writes a pool `status: 'FINAL'`** —
> every other `'FINAL'` in the codebase is an *nfl_games* status, and the only
> other pool-status writes are `'LOCKED'` (bracket dashboard) and `'OPEN'`
> (create). So `backfill.ts` is the **only** thing that can produce a pool with
> `status: 'FINAL'`, which makes it a unique fingerprint.
>
> | Query (each preview-verified before running) | Result |
> |---|---|
> | `status == 'FINAL'` | **0 pools** ← the backfill-only fingerprint |
> | `status == 'DRAFT'` | 28 pools |
> | `status == 'LOCKED'` | 1 pool |
> | `isFinal == true` | 22 pools |
> | `DRAFT` ∩ `isFinal:true` | **0** ← no "finished pool marked draft" |
> | `LOCKED` ∩ `isFinal:true` | **0** ← no "finished pool marked locked" |
> | `status == 'OPEN'` (positive control) | 15 pools ✓ |
>
> **Conclusion:** `backfillPools` has never clobbered a pool status in prod —
> most likely it was never run against pools lacking `createdByUid`. The 28
> DRAFT pools show no finished-pool signals; they look like ordinary abandoned
> drafts.
>
> **This does NOT change the deploy plan.** PR #193's fix should still ship — it
> prevents the bug, it just turns out there is no historical mess to clean up.
> No remediation task, no pool IDs to repair.
>
> ⚠️ **Methodology note worth keeping.** Three intermediate readings in this
> audit were WRONG: the console's filter panel reopens collapsed, so edits to
> the value box silently didn't register and the *previous* query re-ran while
> appearing to be a new one. A positive control (`status == 'OPEN'`, which the
> create path definitely writes) caught it — it returned "no results" when it
> must return many. **Any future console audit should verify the query preview
> string before applying, and include a control that must return rows.**
>
> Original instructions kept below for provenance.

### Original instructions (superseded by the result above)

**Why:** `backfillPools` has had a bug since it was first deployed (unrelated
to last night's work — this predates the sweep): it recomputes a pool's
`status` from `isLocked`/`isFinal` whenever `createdByUid` is missing,
**ignoring whatever status the pool already had**. Since `isLocked`/`isFinal`
can't express `COMPLETED` or `ARCHIVED`, any pool that got touched by a past
`backfillPools` run may have been silently reset to `DRAFT`. The fix is
written and merged (PR #193) but **not deployed yet** — so this audit tells
you the current damage, if any, before the fix ships.

1. Open the Firebase console: https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore
2. Click the **Firestore Database** tab, then click **Query** (or use the
   query builder / "Start collection" search at the top).
3. Build this query: collection `pools`, filter `status == "DRAFT"`.
4. For each result, look at the pool's `entries` subcollection (or the
   `entryCount` field) — if a pool shows `status: DRAFT` but clearly has
   completed entries, real payout data, or an old `createdAt` from a past
   season, it's a likely victim of the clobber bug.
5. **If you find suspects:** don't fix them by hand yet — note the pool IDs
   in a scratch doc. Once PR #193 (status-clobber fix) is deployed (Section
   3), a future one-off could recompute correct status for those specific
   IDs. This audit is just "how bad is it," not "fix it now."
6. **If you find nothing suspicious:** good — `backfillPools` may never have
   been run against real completed pools, or none survived long enough to be
   visibly wrong. Move to Section 2.

---

## 2. Decide on the nflFinalize dry-run flip (standing item since 2026-07-10)

> ### ⛔ SUPERSEDED 2026-07-18 by NFL-6 — do not follow step 5 as written.
> PR #210 (item A6) changed how this job arms. `dryRun: false` **alone now keeps
> the sweep dry** and logs a refusal; arming additionally requires naming
> `liveSeasonTypes` (use `[1]` for preseason-only). The reading-the-reports part
> of this section is still valid and the report now also carries a
> `bySeasonType` breakdown. **Go to NFL-6 for the current steps.**

**Why:** `nflFinalizeSweepJob` has been armed `dryRun:true` since 2026-07-10,
reporting only, never writing. This is unrelated to last night's sweep work.

1. Open the app: https://www.marchmeleepools.com — sign in as SuperAdmin.
2. Go to **SuperAdmin → Admin Audit Log**.
3. Filter or search for entries of type `NFL_FINALIZE_SWEEP`.
4. Read through however many days of reports have accumulated. Check: do the
   candidate pool lists look sane (only pools that should actually finalize,
   correct payout amounts)?
5. **If the reports look right:** message me (or the next session) "flip
   nflFinalize to live" and I'll do the one-line Firestore console edit
   (`system/config.nflFinalize.dryRun` → `false`) with you watching.
6. **If anything looks off:** don't flip it — note what looked wrong and
   we'll dig into it together.
7. **If there aren't enough reports yet** (less than ~2 days of daily runs):
   just wait, check again tomorrow. No action needed today.

---

## 3. Deploy the 33 sweep callables (functions-first ritual)

**⚠️ Conflict check — read before running:** this deploy uses `--only
functions:<exact names>`, a **targeted list of 33 specific function names**.
It does **not** touch any function the NFL overnight session might add
(`lockNFLSpreadsJob` export, new alerting jobs, etc.) — those aren't in the
list below, so this command is safe to run **whether or not the NFL session
has finished**. The one thing to avoid: do **not** run a bare `npx firebase
deploy` (no `--only`) until you've reviewed and merged the NFL session's PRs
yourself — a bare deploy ships everything on `main`, including any
half-reviewed work.

1. Open a terminal. Navigate to the repo:
   ```
   cd D:\march-melee-pools
   ```
2. Make sure you're on `main` and it's genuinely current — don't trust "it
   said it worked," verify it (this repo has had a deploy silently skip
   everything once already because a pull looked successful but hadn't
   actually moved — see HANDOFF.md's deploy-gotcha note):
   ```
   git status --porcelain
   ```
   **Expect:** no output. If anything prints, you have local changes —
   stop and figure out what they are before continuing (don't discard them
   blindly).
   ```
   git checkout main
   git fetch origin main
   git rev-parse HEAD
   git rev-parse origin/main
   ```
   **Expect:** the two hashes printed by those last two commands are
   **identical**. If they differ:
   ```
   git pull origin main
   ```
   then re-run both `git rev-parse` commands and confirm they now match.
3. Confirm the specific merges you're about to deploy are actually present
   — a short commit hash goes stale the moment anyone else pushes, so check
   by **commit message**, not by hash:
   ```
   git log origin/main --oneline -25
   ```
   **Expect:** you can find, somewhere in that list, commits whose messages
   start with `feat(sweep): batch 5` through `feat(sweep): batch 16`, plus
   `fix(backfill): gate backfillPools behind a dry-run defaulting to true`
   and `fix(backfill): stop backfillPools resetting COMPLETED pools to
   DRAFT`. If any of those are missing from the log, **stop** — you are not
   looking at the code you think you're deploying.
4. Install functions dependencies (always do this before deploying — avoids
   the `stripe`/`fft` TS2307 build error):
   ```
   npm --prefix functions install
   ```
   **Expect:** finishes with no red `npm error` lines. Warnings about
   deprecated packages or `allow-scripts` are normal and safe to ignore.
5. Run the deploy — copy this **exact command**, don't retype it by hand
   (one typo in the function list silently drops a function from the
   deploy):
   ```
   npx firebase deploy --only functions:recalculatePoolWinners,toggleWinnerPaid,fixParticipantIds,joinNFLPool,executeSurvivorRebuy,scoreNFLWeek,validateBillingAccess,getPoolQuote,getAdminHealthSnapshot,backfillPools,refreshExpertPicks,syncPlayoffPools,deleteCouponTemplate,acknowledgeMonetizationAlert,importTournamentFromESPN,adminInitTournament,syncBracketTournament,importConferenceTournamentFromESPN,syncPlayInPicks,scoreBracketEntries,finalizeTournamentPayouts,initializeBigEastTournamentHttp,initializeBig12TournamentHttp,updatePlayer,releaseSquares,gradeProp,updatePropCard,generateReferralToken,resolveReferralToken,lockPool,logAdminAction,recomputeConsensus,recomputeRevenue --project gridiron-gamble-uzuqo
   ```
6. **Expect:** it prints a list of 33 functions, each moving through
   `updating...` → a green checkmark. Takes a few minutes. Ends with
   `✔ Deploy complete!`.
7. **If it fails partway** (one function shows a red ✖ instead of a
   checkmark): note which function name failed and the error text, then
   message me — do not re-run the whole command blindly, since some
   functions may have already updated successfully. If it's a transient
   network/quota error, re-running the same command is usually safe (it's
   idempotent — Firebase just re-deploys the same code).
8. Once it says `✔ Deploy complete!`, go to Section 4.

## 4. Verify the deploy landed clean

1. Still in `D:\march-melee-pools`, list the deployed functions:
   ```
   npx firebase functions:list --project gridiron-gamble-uzuqo
   ```
   **Expect:** all 33 names from the deploy command appear in the list, each
   showing a recent "Updated" timestamp (today's date).
2. Open the Cloud Functions logs — either:
   ```
   npx firebase functions:log --project gridiron-gamble-uzuqo
   ```
   or the console: https://console.cloud.google.com/functions/list?project=gridiron-gamble-uzuqo
3. **Expect:** no wall of `invalid-argument` or `Invalid request` errors
   appearing right after deploy. A few isolated ones from real user typos are
   normal; a *pattern* of the same function rejecting every call means a
   schema is too strict and needs a look — message me with the function name
   and the exact error text if you see that.
4. This step matters more than usual tonight: batch 5 (poolOps.ts) is the
   first of last night's PRs to go live, and it's the one qodo caught a real
   bug in (the dry-run default) — so a clean log here confirms that fix is
   working, not just that it compiles.

## 5. Deploy the frontend (Coolify — manual trigger, does NOT auto-deploy)

**Why:** PR #190 added a new "Backfill Pools (dry run)" button to
OperationsPanel. Without this step, the backend accepts the new `dryRun`
parameter but the UI never sends it — not broken, just half-shipped.

1. Open the Coolify dashboard (your usual URL/bookmark for it).
2. Find the `marchmeleepools.com` / `www` service.
3. Click the deploy / redeploy button for that service (exact label depends
   on your Coolify version — look for "Deploy" or "Redeploy" on the service
   page, not a generic "Restart").
4. **Expect:** a build log opens, runs through `npm ci` → `vite build` →
   container restart. Takes a few minutes.
5. Once it shows the deployment as successful, open
   https://www.marchmeleepools.com in a fresh/incognito tab and confirm the
   site loads normally (any page is fine — this just confirms the container
   came back up, not a full feature test).
6. **If the build fails:** copy the error from the build log and message me
   before retrying — don't click deploy repeatedly on a failing build.

---

## 6. Pick up the NFL preseason session's output

> ### ✅ DONE 2026-07-18 — nothing to do here.
> That session finished. All six engineering items shipped (PRs #205-#210, all
> merged, nothing deployed). Its output is **the bottom half of this file
> (`NFL-1`-`NFL-8`)** plus the MORNING TAKEOVER section at the top of
> `HANDOFF.md`. Kept below for provenance.

By the time you read this, the NFL session (started from
`PLAN-NFL-PRESEASON-PILOT.md`) may have finished, be still running, or not
have started yet depending on when you're reading this.

1. In a terminal:
   ```
   cd D:\march-melee-pools
   git fetch origin
   git log origin/main --oneline -15
   ```
2. Look for commits with messages starting `feat(nfl-pilot):` or similar
   (the session should follow the same PR-per-item convention as the sweep).
   Compare against `PLAN-NFL-PRESEASON-PILOT.md`'s action items (A2–A10) to
   see which ones landed.
3. Check `HANDOFF.md`'s top section for a morning-takeover note the NFL
   session should have left — it'll say which A-items shipped as which PR#
   and what's still open.
4. **If new items got added to THIS file (TOMORROW-TASKS.md) below this
   line** by that session — do those in the order they're listed there, they
   take priority over Sections 7-10 below since they may be time-sensitive
   (e.g., a design decision on A5's snapshot storage that blocks further
   work).
5. **Before deploying anything the NFL session produced:** those PRs add
   *new* functions (`lockNFLSpreadsJob` export, new alert jobs) rather than
   modifying the 33 you just deployed in Section 3 — so there's no overlap
   risk. Still, read each PR's description for its own "Test plan" section
   and gate-check results before merging/deploying, same as any other PR.
6. If the session is **still running** when you check: no action needed,
   just check back later. It's operating autonomously per the overnight
   protocol and will leave its own takeover note when it stops.

---

## 7. A8 — Publish the 2026 regular-season price + free-preseason end date

**Why:** board decision (5–0): a free preseason pilot only works as a real
test of willingness-to-pay if the price and the free-period end date are
public from day one. Free-with-no-published-price anchors expectations at
zero.

1. Decide the regular-season price point (your call — no one else can make
   this decision).
2. Decide the exact free-preseason end date (suggestion: tie it to regular
   season week 1, 2026-09-09, per the timeline in
   `PLAN-NFL-PRESEASON-PILOT.md` §1 — but that's a suggestion, not a
   requirement).
3. Update wherever pricing is displayed/communicated (site copy, any
   commissioner-facing messaging) to state both explicitly.
4. **Deadline:** before preseason week 1 begins, **2026-08-13**. Doesn't need
   to happen tonight or even this week — just needs to land before that date.

## 8. A9 — Recruit ~10 commissioners for the preseason pilot

1. Pick commissioners **you personally support/know** — the board's guidance
   was explicitly "not a hundred strangers." Quality of relationship over
   volume, since this is a dress rehearsal you want honest feedback from.
2. No specific deadline noted beyond "before the pilot" — earlier is better
   so they have pools set up before preseason week 1 (2026-08-13).

## 9. A11 — Fix the "test every pool type" messaging claim

1. Wherever the preseason pilot gets described (marketing copy, commissioner
   outreach, internal docs) — make sure nothing claims it tests every pool
   type. It can't: there are no NCAA brackets or conference tournaments in
   August. This is an NFL-pools-only test.
2. Quick pass, no deadline pressure — just don't let the overclaim ship
   anywhere.

## 10. A12 — Board admin (NOT urgent — before the 2027 pricing decision only)

1. No action needed now. Noted for later: seat an indie-SaaS-distribution
   advisor (candidate on file: Marc Lou) before the 2027 pricing decision.
2. Also noted, no owner yet: incident-comms / consumer-trust-recovery is a
   gap on the board with nobody covering it. Something to think about when
   you have bandwidth, not tonight.

---

_Anything the NFL session adds below this line takes priority over 7-10 above
if it's time-sensitive — check for a "---" divider and a timestamp._

---

# Overnight NFL-pilot session — 2026-07-18 (added ~04:40)

All six engineering action items from `PLAN-NFL-PRESEASON-PILOT.md` are done and
in PRs. **Nothing is deployed.** The items below are the ones that need you.

Read them in order — **NFL-1 is a genuine pilot blocker** and the rest are
smaller. (Sections are prefixed `NFL-` so they cannot be confused with the
sweep session's `1`-`10` in the top half of this file.)

---

## ✅ NFL-1. RESOLVED — the spread gate blocked pools that do not use spreads

> ### ✅ DECIDED AND FIXED 2026-07-18 — PR #214, merged (`8c8e9c5`). Not deployed.
> Kevin chose to apply the fix. The `SPREADS_NOT_LOCKED` precondition is now
> scoped to pools whose scoring actually consumes spreads
> (`nflScoringEngine.poolUsesSpreads` — ATS pick'em only). The A3 tripwire is
> scoped identically so it cannot page about pools that are no longer blocked.
> **Behavior change for existing pools: none** — no pool is ATS.
>
> **What this means for the pilot:** preseason pools can now accept picks with
> no betting lines at all, so the 1-of-49 line coverage below is no longer a
> blocker. It still means an **ATS** preseason pool would not work — do not
> create one.
>
> The readiness doubt I raised is closed: submission deadlines are enforced by
> `effectiveWeekLockAt` / `isGameLockedAt` and the `games.length === 0` throw,
> not by the spread gate.
>
> **Deploy note:** this adds `submitNFLPicks` to the NFL-4 deploy list.
>
> Original analysis kept below for provenance.

**RE-VERIFIED 2026-07-18 16:53 UTC in the browser, and the overnight write-up of
this item was wrong in two ways. Corrected below. The problem is bigger than
"preseason has no lines" — and the fix is smaller.**

### What the live feed actually says

| Slate | Games | With a betting line | Days out |
|---|---|---|---|
| HOF Weekend (2026-08-07) | 1 | **1** (`CAR -1.5`) | 19 |
| Preseason Week 1 (08-13) | 16 | **0** | 25 |
| Preseason Week 2 (08-21) | 16 | **0** | 33 |
| Preseason Week 3 (08-27) | 16 | **0** | 39 |
| **Preseason total** | **49** | **1** | |
| Regular season week 1 (09-09) | 16 | **16** | 53 |

*Correction 1:* preseason is **49 games across 4 calendar segments**, not the 17
games / 3 weeks the overnight note said. That 17 was an artifact of the date
window I sampled.

*Correction 2 — this kills option (c):* regular-season week 1 is **53 days out
and has lines on all 16 games**, while preseason week 1 is **25 days out with
none**. So the missing lines are **not** "books have not posted yet because it is
far off." Further-out games have lines; the nearer preseason games do not. This
is a property of preseason, not of lead time. Waiting is not a plan.

*(The one exception, the HOF game, is the marquee standalone — so it is still
possible that ordinary preseason lines appear a few days out. It is not
something to bet the pilot on.)*

### The bigger finding: no pool in your product uses spreads at all

Chasing the "run straight-up instead" option turned up something that changes
the whole item:

- `pickMode` already exists with two values, `'STRAIGHT'` and `'ATS'`
  (`shared/schemas/nfl.ts:33`).
- The create wizard **hardcodes `pickMode: 'STRAIGHT'`**
  (`src/components/wizard/create/CreateNFLPickemPool.tsx:72`) and there is **no
  UI control anywhere to choose ATS**. So every pool ever created through the
  product is straight-up.
- Straight-up scoring **never reads `spread`**
  (`functions/src/nflScoringEngine.ts:53` — the spread branch is gated on
  `pickMode === 'ATS'`; ATS even falls back to straight-up when a spread is
  missing).
- **But the gate is unconditional.** `functions/src/nflPools.ts:351-355` runs
  `games.every(g => g.spread?.locked === true)` with no reference to `pickMode`
  or pool type. The type dispatch does not start until line 381 — 30 lines
  later. Verified directly.
- Therefore `NFL_SURVIVOR` (pick a winner) and `NFL_MARGIN` (margin of victory)
  are blocked identically, and **neither of those uses spreads under any
  setting**.

**So this is not really a preseason problem. Production blocks pick submission
on spread data that no pool in production consumes.** Preseason is just where it
finally becomes visible, because preseason is the first time the lines are
absent.

### Revised options

- **(a) "Run straight-up instead" — DOES NOT WORK as a config choice.** Struck.
  Everything is already straight-up and still blocked. My overnight
  recommendation was wrong.
- **(b) Set ~48 preseason lines by hand** — still available, but you would be
  inventing spread numbers purely to satisfy a check that nothing then reads.
- **(c) Wait and see** — much weaker than I wrote. See the table.
- **(d) Scope the gate to pools that actually use spreads — NOW THE
  RECOMMENDATION.** I described this overnight as "changes scoring semantics for
  every pool type," which was wrong. It is **one conditional** at
  `functions/src/nflPools.ts:352`: apply the spread check only when
  `pool.settings?.pickMode === 'ATS'`. It changes behavior for **zero existing
  pools**, because no existing pool is ATS. ATS pools keep the gate exactly as
  it is.

**Recommendation: (d).** Not as a preseason workaround — as a correctness fix
that preseason exposed.

**What I did not do:** I did not make the change. It removes a guard on the pick
path, which is your call, not mine. Say the word and it is a small PR with tests
(gate applies for ATS, does not for STRAIGHT/survivor/margin).

**One thing to weigh before saying yes:** the gate may have been doing
double duty as a crude "this week is ready for picks" signal, since
`lockNFLSpreadsJob` flips `spread.locked` every Tuesday. Removing it for
straight pools leans entirely on the existing kickoff/lock-deadline logic
(`effectiveWeekLockAt` / `isGameLockedAt`, step 2 of the same function) plus the
`games.length === 0` not-found check. I believe that is sufficient and that
readiness was never really the spread gate's job — but it is the one thing worth
a second look before removing it.

---

## 🔴 NFL-2. DECISION NEEDED — alarm A3(b), the synthetic pick probe, was not built

The plan asked for two alarms. **A3(a) — the pre-kickoff lock tripwire — is
built and merged (PR #207).** A3(b), the synthetic pick submission probe, is not,
and I want you to choose rather than have me guess.

**Why I stopped:** building it in-process would have been nearly free, but it
would then re-check the *exact same predicate* A3(a) already checks — duplicate
code that catches nothing new. A3(b)'s only independent value is exercising
**auth / rules / App Check**, which needs a genuinely authenticated round trip.
Scheduled functions run with admin credentials and bypass callable auth
entirely, so there is no cheap honest version.

**A real probe needs, in prod:**
1. A dedicated probe user (a real Firebase Auth uid, no special privileges).
2. A permanent throwaway probe pool that the probe is a member of.
3. Either a minted custom token or a service account making a real HTTPS
   callable request to `submitNFLPicks`, then asserting it is not
   `SPREADS_NOT_LOCKED` / 403.

Items 1 and 2 are **prod data**, which is your gate — that is why I stopped.

**Options:**
- **(a) Approve the probe identity + probe pool**, and I build A3(b) properly
  next session. Roughly half a day. This is what makes A7 (the chaos drill) a
  real test of the operator loop rather than a test of one alarm.
- **(b) Skip A3(b) for the pilot.** A3(a) already covers the failure mode the
  board actually named (spreads not locked). Accept that an auth/rules
  regression would be caught by a commissioner rather than an alarm.

**My recommendation: (b) for the preseason pilot, revisit before charging money
in September.** A3(a) covers the named risk, and the pilot is precisely the
low-stakes window where a slower detection path is acceptable. But if you want
the full operator loop proven before the regular season, say so and I will build
it.

---

## NFL-3. Arm the three new kill-switches (Firestore console, ~5 minutes total)

Everything I shipped is fail-safe **OFF**. It does nothing until you write these
config values. **Do this only after the PRs are deployed** — see NFL-4.

All three live in the same document.

1. Go to https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore/data
2. In the left panel click the **`system`** collection, then the **`config`**
   document. You should see existing fields including `autoClose`, `nflFinalize`,
   and `opsAlerts`.

### 3a. Spread-lock job (A2) — start it in dry-run

3. Click **+ Add field**. Field name: `nflSpreadLock`. Type: **map**.
4. Inside that map add two fields:
   - `enabled` — type **boolean** — value **true**
   - `dryRun` — type **boolean** — value **true**
5. Save.
6. **What you should see:** the job runs Tuesdays 09:00 America/New_York. In
   Cloud Logging, filter for `lockNFLSpreadsJob` and you should get a line like
   `DRY-RUN: would lock N spread(s): espn_..., espn_...`. It writes nothing.
7. **If you see nothing at all:** the function is not deployed yet (item 4), or
   it is not Tuesday. To test immediately, trigger it from
   https://console.cloud.google.com/cloudscheduler?project=gridiron-gamble-uzuqo
   — find the `lockNFLSpreadsJob` entry and click **Force run**.
8. **Once the dry-run list looks right**, come back and change `dryRun` to
   **false**. That is what makes spreads lock automatically, which is the whole
   reliability story of the pilot.

### 3b. Lock tripwire (A3a) — the alarm that pages you

9. **+ Add field**. Name: `nflLockWatch`. Type: **map**. Inside:
   - `enabled` — **boolean** — **true**
   - `dryRun` — **boolean** — **true**
10. **What you should see:** it runs hourly. Every run writes an
    `NFL_LOCK_WATCH` entry to the admin audit log (SuperAdmin → Admin Audit Log),
    so you can confirm *the alarm itself is alive* even when nothing is wrong —
    that is deliberate, because a tripwire that has never fired and a tripwire
    that is dead look identical otherwise. While `dryRun` is true it logs
    `DRY-RUN: would page for ...` instead of paging.
11. **After you have seen a day of sane audit entries**, set `dryRun` to
    **false**. Then it really pages. It sends **SMS as well as email** (I put it
    in the high-priority set — the window closes at kickoff, so email alone is
    too slow).
12. **Prerequisite:** `opsAlerts` must already have your email/phone in it. It
    does — you populated it 2026-07-17 for Phase 2. Worth re-checking the phone
    number is current before you rely on it.

### 3c. Feed snapshots (A5) — the evidence trail

13. **+ Add field**. Name: `nflFeedSnapshots`. Type: **map**. Inside:
    - `enabled` — **boolean** — **true**
    - `retentionDays` — **number** — **45**
14. **Prerequisite: the composite index must be Enabled first** (NFL-4 step 8).
    If it is not, every snapshot silently fails and this switch appears to do
    nothing.
15. **What you should see:** a new `nfl_feed_snapshots` collection appears,
    gaining a document each time the ESPN response for an active slate actually
    *changes* (identical responses are deduped by content hash, so it will not
    grow every 5 minutes). Each doc is roughly 9 KB.
16. **Cost sanity check:** the real preseason payload measured 96,583 bytes raw
    → **8,617 bytes gzipped**, about 0.8% of Firestore's 1 MiB per-document
    limit. With dedupe, expect single-digit MB across a whole season. If you
    ever want it cheaper, lower `retentionDays`; the job prunes automatically.
17. **This one is worth turning on before preseason starts**, not after. Its
    entire purpose is to have a record of what the feed said *before* something
    goes wrong. Turned on after an incident, it is worthless for that incident.

---

## NFL-4. Deploy the seven merged PRs (functions only — your gate)

Nothing from tonight is deployed. This queue is now **on top of** the 33
undeployed callables already listed in HANDOFF.md.

1. Open a terminal at `D:\march-melee-pools` (the main checkout, not a worktree).
2. Confirm every PR actually merged — a silent non-merge has burned this repo
   before (see the 2026-07-17 deploy gotcha in HANDOFF.md):
   ```
   git checkout main
   git pull
   git log --oneline -8
   ```
   **You should see** commits for #205, #206, #207, #208, #209, #210 and #214. If
   `git pull` says "Already up to date" and those commits are missing, **stop** —
   the merges did not land and a deploy would silently skip everything.
3. Install functions deps first, or the deploy fails with stripe/fft TS2307:
   ```
   npm --prefix functions install
   ```
4. Deploy. **Functions before rules** (no rules change tonight, so functions
   only). The new/changed functions from tonight:
   ```
   npx firebase deploy --only functions:lockNFLSpreadsJob,nflLockWatchJob,syncNFLScoresJob,nflFinalizeSweepJob,submitNFLPicks --project gridiron-gamble-uzuqo
   ```
5. **What you should see:** five functions listed as `create` or `update`, then
   `Deploy complete!`. `lockNFLSpreadsJob` and `nflLockWatchJob` are **new
   functions** — they have never existed in prod, so expect `create` for those
   two and `update` for the other three. `submitNFLPicks` carries the NFL-1
   spread-gate fix (PR #214) — until it deploys, preseason pools stay blocked.
6. **If you see "No changes detected"** for a function you expect to change: the
   merge or the pull did not land. Go back to step 2. Do not assume it worked.
7. **Note on `syncNFLScoresJob`:** its signature changed to bind the
   `COURIER_AUTH_TOKEN` secret (it can now page you about stat corrections). If
   the deploy complains that the secret is not accessible, check it exists:
   ```
   npx firebase functions:secrets:access COURIER_AUTH_TOKEN --project gridiron-gamble-uzuqo
   ```
   The secret already exists — Phase 2 uses it.
8. **Deploy the Firestore index too — the A5 snapshot feature is dead without
   it.** `firestore.indexes.json` gained a composite index for
   `nfl_feed_snapshots` (`slate` ASC + `fetchedAt` DESC). Without it, every
   snapshot write fails, and because that code deliberately swallows errors so a
   snapshot failure cannot break score sync, **it would fail silently forever**.
   Deploy indexes AFTER functions:
   ```
   npx firebase deploy --only firestore:indexes --project gridiron-gamble-uzuqo
   ```
   **What you should see:** `firestore: deployed indexes`. Index builds are
   asynchronous — check
   https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore/indexes
   and wait for the `nfl_feed_snapshots` entry to read **Enabled** rather than
   *Building* before you turn on step 3c. On an empty collection this is
   near-instant.
   *(Note: this is `firestore:indexes`, not `firestore:rules`. No rules changed
   tonight.)*
9. **No frontend deploy needed.** Nothing tonight touched `www`. (Reminder: the
   Coolify frontend deploy is still a manual trigger and does not happen on push
   to `main`.)

---

## NFL-5. Import the preseason schedule (prod data — your gate)

Needed before any preseason pool can exist. Do this **after** step 4.

1. Go to the live site → **SuperAdmin** → the panel with the NFL schedule import
   (it calls the `importNFLSchedule` callable).
2. Import **season `2026`, seasonType `1` (preseason), weeks 1-4**.

   ⚠️ **Off-by-one trap — read this.** The importer indexes ESPN's calendar
   positionally (`segment.entries[week - 1]`, `nflSchedule.ts:54`), and ESPN's
   preseason calendar has **four** segments where the first is *Hall of Fame
   Weekend*. So importer week **1** = HOF Weekend, week **2** = the slate
   labelled "Preseason Week 1", week **3** = "Preseason Week 2", week **4** =
   "Preseason Week 3". Importing "weeks 1-3" gets you only 33 of the 49 games
   and silently omits the last preseason week.
3. **What you should see:** **49 games** land in the `nfl_games` collection with
   `season: "2026"` and `seasonType: 1` — 1 + 16 + 16 + 16. Verified against
   ESPN's calendar 2026-07-18.
4. **If you get 2025 games instead:** the importer's calendar date-range guard
   failed and it fell back to the naive URL, which silently serves the prior
   season during the off-season. Check the function logs for
   `Failed to resolve dates via calendar`. Do not proceed with a 2025 import —
   delete and retry.
5. **Immediately after importing, check how many games have spreads.** This is
   NFL-1 above. As of 2026-07-18 it is **1 of 49**. Decide item 1 before
   recruiting commissioners — as things stand, every one of these pools is
   blocked from accepting a single pick.

---

## NFL-6. Arm the finalize sweep for preseason (prod config — your gate)

This closes the standing open loop *"nflFinalize armed dryRun:true since
2026-07-10."* **A6 changed how this works — read this even if you think you know
the steps.**

**What changed:** you can no longer arm the sweep without saying *which* season
types it may finalize. Setting `dryRun: false` alone now **keeps it dry** and
logs a refusal. That is intentional: arming the finalizer settles real seasons
for real members, and the plan requires preseason-only.

1. Firestore console → `system` → `config` → the existing **`nflFinalize`** map.
2. **First, read a dry-run report.** SuperAdmin → Admin Audit Log, filter for
   `NFL_FINALIZE_SWEEP`. The dry-run entry now includes a **`bySeasonType`**
   breakdown, e.g. `{"1": 4, "2": 0}`.
3. **What you should see:** candidates under `"1"` (preseason) and **zero** under
   `"2"`. If `"2"` is non-zero, you have real regular-season pools that would be
   in scope — stop and tell me before arming.
4. Once the report looks right, edit the `nflFinalize` map to contain **all
   three**:
   - `enabled` — **boolean** — **true**
   - `dryRun` — **boolean** — **false**
   - `liveSeasonTypes` — **array** of **number** — containing the single value
     **1**
5. **What you should see** on the next 08:30 run: an `NFL_FINALIZE_SWEEP` audit
   entry with `dryRun: false`, `liveSeasonTypes: [1]`, and an `outOfScope` count
   for anything it deliberately did not touch.
6. **If you see** `STAYING DRY: dryRun:false was set but liveSeasonTypes is
   missing or empty` in the logs — you added `dryRun: false` without step 4's
   third field. Add `liveSeasonTypes` and it will arm on the next run. Nothing
   was finalized in the meantime; that is the guard working.
7. **Do NOT set `liveSeasonTypes` to `[1, 2]`** until after the regular-season
   pilot decision. `[1]` is preseason only, which is the whole point.

---

## NFL-7. A7 — Chaos drill runbook (run this DURING a preseason week, not now)

The board's cheapest disproof experiment. **Depends on A3(a) being deployed and
armed live (`dryRun: false`) — steps NFL-3b and NFL-4 above.** Do not run this until the
tripwire is really paging.

**The experiment:** deliberately skip one spread lock and find out whether your
operator loop notices before a member does.

1. Pick a preseason week where you have at least one live pool with real
   members. Preseason week 2 (~2026-08-20) is a good candidate — week 1 has
   enough novelty problems already.
2. On the Tuesday of that week, **before** 09:00 America/New_York, set
   `system/config.nflSpreadLock.enabled` to **false**. This stops the automatic
   lock from running at all. Note the exact time you did it.
3. Leave it. Do nothing else. **Do not tell your commissioners.**
4. **The thing you are measuring:** does an `NFL_SPREADS_NOT_LOCKED` alert reach
   your phone before a commissioner emails you?
   - The tripwire runs hourly and fires once kickoff is within **36 hours**, so
     for a Thursday-night game expect the first page around **Wednesday
     morning**.
   - Write down which arrived first, and how long after the missed lock.
5. **Whatever the outcome, restore immediately after the measurement** — set
   `nflSpreadLock.enabled` back to **true** and confirm the spreads lock (the
   audit log will show it). Do not let a real pool stay blocked to prove a point.
6. **Interpreting it:**
   - **Alarm fired first** → the operator loop works. This is the evidence that
     it is safe to charge money for the regular season *provided* you also have a
     refund policy written down.
   - **Nothing fired, or a commissioner beat it** → the free period just taught
     you in August what you would otherwise have learned in January with real
     money on the table. That is the experiment succeeding, not failing. Fix the
     loop before September.
7. Either way, write the result down somewhere durable — it is the input to the
   "do we charge for the regular season" decision.

---

## NFL-8. Smaller flags from tonight

- **Make `emulator-tests` a required check.** A4 (PR #206) added the job and it
  passes, but it is not yet *required*, so a red run would not block a merge.
  GitHub → repo **Settings** → **Branches** → the `main` protection rule →
  **Require status checks to pass** → add **`emulator-tests`**. You should see it
  in the list of available checks now that it has run at least once.
- **A5 part 2 (the replay callable) is not built.** Tonight shipped snapshot
  *capture* + stat-correction detection. The replay endpoint — SUPER_ADMIN,
  dry-run default, re-applies a chosen snapshot into `nfl_games` so a week can be
  rebuilt from known-good feed state — is a prod-data mutator and wants its own
  PR and review. It is only useful once capture has been running for a while
  anyway, so turning on 3c is the real prerequisite.
- **The plan's "manual approve gate before payouts" was already satisfied.** I
  did not build it. `nflFinalize.ts:24-25` — money is never touched by
  finalization; payouts are already a separate manual commissioner action. The
  gate the plan asked for already exists.
- **The plan's "per-pool recalculated banner"** was not built — it is a frontend
  change and nothing tonight touched `www`. Worth doing once A5 part 2 exists,
  since the banner's job is to explain a replay to members.
- **`syncNFLScoresJob` only re-reads games from the last 24 hours**
  (`nflSchedule.ts:245`). A stat correction that arrives more than a day after a
  game will therefore **never** be picked up, and the A5 detector cannot see what
  the job never fetches. Not fixed tonight — widening that window has cost and
  correctness implications worth thinking about separately. Flagging it because
  it bounds how much A5 can actually protect you.
