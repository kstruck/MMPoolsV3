# TOMORROW-TASKS.md — Kevin's morning checklist (2026-07-18 → 2026-07-19)

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

## 1. Audit prod for backfillPools damage (READ-ONLY — do this first)

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

Read them in order — **item 1 is a genuine pilot blocker** and the rest are
smaller.

---

## 🔴 1. DECISION NEEDED — preseason games have no betting lines, which blocks pick'em entirely

**This is the single most likely way preseason week 1 fails, and it is not a bug
in our code.**

I pulled the live ESPN feed for the preseason window while building A5:

```
https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260803-20260817
→ 17 events, all season 2026 / seasonType 1  (confirms the plan's A1 gate)
→ exactly 1 of those 17 carries an odds line: the HOF game, "CAR -1.5"
→ the other 16 games have NO spread at all
```

Why that matters: `submitNFLPicks` refuses **every** pick for a week unless
**every** game that week has `spread.locked === true`
(`functions/src/nflPools.ts:351-355`, thrown as `SPREADS_NOT_LOCKED`). A game
with no spread value can never be locked. So as things stand today, an
**ATS/spread pick'em pool covering preseason weeks 1-3 would be blocked for
every member, all week.**

Re-running the lock job will not help — you cannot lock a line that does not
exist. This is a data-availability fact about preseason, not something A2 fixed.

**Your options (pick one — this is a product call, not an engineering one):**

- **(a) Run the preseason pilot on straight-up pick'em, not ATS.** Most robust —
  no spreads needed at all. Check whether the pool settings already allow a
  non-ATS pick'em mode before committing to this.
- **(b) Set the preseason lines by hand.** ~16 games/week. Tedious but total
  control, and the A3 tripwire will tell you when you have missed one.
- **(c) Wait and see.** Books often post preseason lines only a few days out, so
  the feed may fill in closer to 2026-08-13. Risky as the *only* plan — if they
  do not appear you find out the week of.
- **(d) Relax the all-or-nothing gate** so a week can open with partial spreads.
  I did **not** do this: it changes scoring semantics for every pool type and is
  well beyond an overnight call. Say the word and it gets its own plan.

**My recommendation: (a) as the primary, (c) as the thing you monitor, (b) as the
fallback for the HOF game week.** But this is yours to decide.

**Check it yourself before deciding** (30 seconds, no auth needed) — paste the
URL above into a browser and count how many events have a `competitions[0].odds`
array. Re-check a few days before 2026-08-13; the answer may improve on its own.

---

## 🔴 2. DECISION NEEDED — alarm A3(b), the synthetic pick probe, was not built

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

## 3. Arm the three new kill-switches (Firestore console, ~5 minutes total)

Everything I shipped is fail-safe **OFF**. It does nothing until you write these
config values. **Do this only after the PRs are deployed** — see item 4.

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
14. **Prerequisite: the composite index must be Enabled first** (step 4 item 8).
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

## 4. Deploy the six merged PRs (functions only — your gate)

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
   **You should see** commits for #205, #206, #207, #208, #209 and #210. If
   `git pull` says "Already up to date" and those commits are missing, **stop** —
   the merges did not land and a deploy would silently skip everything.
3. Install functions deps first, or the deploy fails with stripe/fft TS2307:
   ```
   npm --prefix functions install
   ```
4. Deploy. **Functions before rules** (no rules change tonight, so functions
   only). The new/changed functions from tonight:
   ```
   npx firebase deploy --only functions:lockNFLSpreadsJob,nflLockWatchJob,syncNFLScoresJob,nflFinalizeSweepJob --project gridiron-gamble-uzuqo
   ```
5. **What you should see:** four functions listed as `create` or `update`, then
   `Deploy complete!`. `lockNFLSpreadsJob` and `nflLockWatchJob` are **new
   functions** — they have never existed in prod, so expect `create` for those
   two and `update` for the other two.
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

## 5. Import the preseason schedule (prod data — your gate)

Needed before any preseason pool can exist. Do this **after** step 4.

1. Go to the live site → **SuperAdmin** → the panel with the NFL schedule import
   (it calls the `importNFLSchedule` callable).
2. Import **season `2026`, seasonType `1` (preseason), weeks 1-3**.
3. **What you should see:** roughly **17 games** land in the `nfl_games`
   collection with `season: "2026"` and `seasonType: 1`. I verified this count
   directly against ESPN tonight — 17 events across 2026-08-03 to 2026-08-17.
4. **If you get 2025 games instead:** the importer's calendar date-range guard
   failed and it fell back to the naive URL, which silently serves the prior
   season during the off-season. Check the function logs for
   `Failed to resolve dates via calendar`. Do not proceed with a 2025 import —
   delete and retry.
5. **Immediately after importing, check how many games have spreads.** This is
   item 1 above. If it is still 1-of-17, decide item 1 before recruiting
   commissioners.

---

## 6. Arm the finalize sweep for preseason (prod config — your gate)

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

## 7. A7 — Chaos drill runbook (run this DURING a preseason week, not now)

The board's cheapest disproof experiment. **Depends on A3(a) being deployed and
armed live (`dryRun: false`) — steps 3b and 4 above.** Do not run this until the
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

## 8. Smaller flags from tonight

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
