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
