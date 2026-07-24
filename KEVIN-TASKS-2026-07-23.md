# 🔧 KEVIN — tasks for 2026-07-23

**Target: the Hall of Fame game, 2026-08-06.** 14 days out.

**No production data was touched. Nothing was deployed.** Two PRs are open from
today's session.

---

## 0. The 60-second version

| # | Task | Why it can't be mine | Section | Time |
|---|---|---|---|---|
| 1 | **Coolify rebuild** — still owed from #261, and NOT done | Manual dashboard trigger | §1 | 5 min |
| 2 | Merge [#262](https://github.com/kstruck/MMPoolsV3/pull/262) — the Firestore reads fix | Merge is yours | §2 | 3 min |
| 3 | **Deploy functions** after #262 merges | Deploys are yours | §3 | 10 min |
| 4 | Verify the reads actually dropped, next day | Console access | §4 | 3 min |
| 5 | Merge the docs PR (stats plan answers) | Merge is yours | §5 | 1 min |
| 6 | Decide 3 open questions (Q2/Q3/Q4 + reminder cadence) | Yours to call | §6 | 5 min |

**Headline: I found the 1.4M reads/day driver, and it was not what the docs
said.** Measured, fixed, reviewed, PR open. It is `runReminders` scanning the
whole NFL season once per pool every five minutes. Details in §2.

---

## 1. Coolify rebuild ⚠️ STILL OWED — do this first

**I verified this morning that the #261 rebuild never ran.** This is not a
guess. I loaded your exact URL with a cache-buster and read the DOM:

```
url:       https://www.marchmeleepools.com/profile/6C09waBoqiSavoBnPZrMkhxWt7x2?cachebust=20260722
hasHeader: false
hasFooter: false
navLinks:  []
bundle:    /assets/index-kdwNJdvH.js
```

The fix IS merged on `main` (`src/App.tsx:398` wraps `/profile/:uid` in
`<Header>`/`<Footer>`). It is simply not deployed.

1. Open the **Coolify dashboard**.
2. Select the **`www`** application.
3. Confirm **Source** is `main` — not `feat/pool-homepage-v2`, not any other
   branch. If it is anything else, stop and tell me.
4. Click **Redeploy**.
5. Wait for the container healthcheck to go green / "running". Usually 2–4 min.
6. **Verify:** open
   https://www.marchmeleepools.com/profile/6C09waBoqiSavoBnPZrMkhxWt7x2
   You should see the site header across the top (with **LOG IN** and
   **GET STARTED**, since you'll likely be logged out in a fresh tab) and the
   four-column footer below the profile.
7. If the header is still missing: hard-refresh with **Ctrl+F5** first. If it is
   *still* missing after that, tell me — that would mean the build picked up the
   wrong commit, and I'll check the bundle hash.
8. When it passes, tell me. The deploy-state marker in HANDOFF.md and
   PICKUP §2 needs to move to `a3f6296`, and that is a PR I write, not a file
   you hand-edit.

---

## 2. Merge PR #262 — the Firestore reads fix

https://github.com/kstruck/MMPoolsV3/pull/262

### What it is

Your graphs showed reads flat at **~1.4–1.5M/day since Jul 2**, with no drop
after the bracket-sync fix. `MORNING-2026-07-23.md` §4 said that driver was
"provably dead". **It was not, and the premise was wrong.**

I killed two confident wrong hypotheses with Cloud Logging before finding it —
`syncGameStatus` and `autoLockPools` both read **zero** pools on all 60 of their
runs in the sampled hour. Then Firestore Query Insights named it directly:

```
nfl_games WHERE (season = ? AND startTime > ?)
  780 executions / 6h   ·   305 docs scanned each   =   237,900 reads / 6h
```

That is `runReminders`, which runs **every 5 minutes** and, **once per NFL
pool**, pulls the entire remaining season — 305 documents — to compute a single
integer that does not depend on the pool. ~966K reads/day. The comment above it
called it "the cheap bail-out path".

The fix memoizes that lookup per run. Same queries, same result, ~11 executions
per run become 1.

**Projected: this removes ~920K reads/day, landing around 475–575K/day.**

⚠️ An earlier draft of this file said "~133K/day". That was wrong and I've
corrected it — caught by codex review. 133K was the sum of the contributors I
had *identified*; Query Insights only shows the top 10 of 15 queries, so roughly
340–440K/day of the 1.4–1.5M baseline is from queries I have not attributed and
which memoization does not touch. **Judge the deploy on the SIZE OF THE DROP
(~900K), not on hitting an absolute number** — the 133K figure would have made
you read a completely successful deploy as a failure.

### Steps

1. Open the PR, confirm the **seven CI checks are green**.
2. **Squash and merge** → **Confirm**.
3. Do NOT skip §3 — this is a functions change and does not deploy on merge.

### What I verified, so you don't have to take it on faith

- Every guard asserts the **query count**, not just "does it still work".
- Each guard was confirmed to **FAIL** when the defect is reintroduced — six
  separate mutations, listed in the PR body. Including the ones that catch a
  memo keyed on the wrong thing.
- **codex round 1 found 2 real regressions I introduced** (a cache key that
  conflated `2026` with `'2026'`, and a cached *rejected* promise that would
  suppress a whole season's reminders after one transient error). Both fixed,
  both now guarded. **codex round 2 came back clean.**
- Gates: functions typecheck 0 · functions vitest **956** · root vitest **291** ·
  root build ✓ · root lint 0 errors.
- qodo: all three surfaces checked once, all empty (billing-blocked, as
  expected). Not waited on.

---

## 3. Deploy functions ⚠️ AFTER #262 merges

Nothing in `src/**` changed, so **no Coolify rebuild is needed for #262**. (§1's
rebuild is a separate, older debt.)

1. Open a terminal in the **main checkout**: `D:\march-melee-pools`
   (not a worktree).
   ⚠️ **Your terminal is Windows PowerShell 5.x — `&&` is a syntax error there**
   (`The token '&&' is not a valid statement separator`). Every command below is
   ONE line, run separately; do not chain them.
2. Pull — two commands, run in order:
   ```powershell
   git checkout main
   ```
   ```powershell
   git pull
   ```
   Confirm the top commit is the #262 squash-merge.
3. Install functions deps — **`ci`, not `install`** (`install` rewrites the
   lockfile and dirties the tree that `firebase deploy` packages):
   ```powershell
   npm --prefix functions ci
   ```
4. Confirm the tree is clean — expect **no output**:
   ```powershell
   git status --short
   ```
   If anything appears, stop and tell me.
5. Deploy — **bare `--only functions`**, never a comma-separated list.
   `--only functions:a,b,c` deploys only `a` and silently drops the rest, then
   prints `✔ Deploy complete!` (PICKUP §1):
   ```powershell
   npx firebase deploy --only functions --project gridiron-gamble-uzuqo
   ```
   **The `--project` flag is not optional.** `.firebaserc` is not tracked in
   this repo, so a checkout has no committed default project — without the flag
   the deploy either fails with no active project or silently follows whatever
   project your CLI last used.
6. **What success looks like:** a line per function, and specifically
   `runReminders` with **"Successful update operation"**. Then
   `✔ Deploy complete!`.
7. **If it fails:** copy the full error and send it to me. Do not retry blindly —
   a partial functions deploy is how this repo has been bitten before.

No `firestore:rules` deploy needed. No index deploy needed — I deliberately kept
the composite-index version of this fix out of this PR precisely so you would
not have to sequence an index build before a code deploy.

---

## 4. Verify the reads dropped — next day, 3 minutes

**Do not skip this.** "Deployed" and "working" are separate claims, and this
whole task exists because a previous fix was recorded as working without being
measured.

1. Open https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore/usage
2. Range: **Last 30 days**.
3. Look at the day **after** the deploy.
4. **Expected: a visible step DOWN of roughly 900K/day** — from ~1.4–1.5M to
   somewhere around **475–575K/day**. Judge it on the size of the drop, not on
   an absolute target: about 340–440K/day comes from queries I have not
   attributed, and this fix does not touch them.
5. **The decisive check, and the one to trust** — GCP → Firestore → **Query
   insights**, 6-hour window, ~1 hour after deploy. The row
   `nfl_games WHERE (season = ? AND startTime > ?)` should fall from **~780
   executions per 6h to ~72**. That row is exactly what this PR changes, so it
   is a clean signal; the total-reads graph mixes in everything else.
6. **If step 5 does not drop**, tell me — that would mean the fix did not take
   effect, which is a different problem from "the total is still high".
7. **If step 5 drops but the total stays near 1.4M**, that is not a failure of
   this PR. It means the unattributed ~400K is larger than measured and there is
   a second driver to hunt. Tell me and I'll re-run Query Insights rather than
   guess — guessing from code is what produced two wrong hypotheses this
   morning.

---

## 5. Merge the docs PR — stats plan answers

A docs-only PR recording your Q1/Q5/Q6 answers into `PLAN-STATS-INTEGRITY.md`
and re-sequencing the work around them. No code, no deploy.

**Your answers deleted more work than they added:**

- **Q1 "No"** → Platform Revenue is uncontaminated. Step 5 deleted.
- **Q5 `scoredThroughWeek >= 1`** → the recompute's selection rule is now decided.
- **Q6 "Week 1, Sept 9 2026"** → **steps 0a and 0b are deleted entirely.**

That last one is the big simplification and it's worth understanding why. The
hardest part of that plan was that legacy Squares/Props/Playoff test pools carry
**no durable marker**, so no filter could ever find them — which meant inventing
a marker scheme and running a production tagging pass over historical data.

**A creation-date cutoff doesn't need to find them.** They were all created
before 2026-09-09, so the date predicate excludes them with no marker, no
backfill, and no production-data mutation at all. The riskiest step in the plan
is now gone because you picked the simpler line.

I've built the cutoff as **config** (`system/config.stats.countFromDate`), not a
constant, so if the date ever needs to move it's an edit, not a release.

Noted and applied: **preseason pools are your testing and do not count.** The
2026-09-09 cutoff excludes the HOF game and the whole preseason by design.

---

## 6. Decisions I need from you

Not blocking — I have working assumptions for all four and will proceed on them
if you'd rather not spend the time. But three touch a **world-readable money
document**, so I'd rather you saw them.

**a. `runReminders` cadence — free 3× on top of #262.**
It runs **every 5 minutes**, but its reminder tiers are **T-36h** and **T-4h** —
hour-granularity windows. Polling them every 5 minutes buys nothing and costs
3× the reads of every-15-minutes. I did not change it because **it changes
delivery timing on the path that pages your members**, and that is your call.
Say "make it 15" and it's a two-line PR.

**b. Q2 — all-time totals, or season-scoped?** Arguably settled in effect by the
2026-09-09 cutoff (which makes them season-scoped in practice). Confirm rather
than let me assume it.

**c. Q3 — should `stats/global` stay world-readable?** It currently is
(`firestore.rules:470`, `allow read: if true`). Fine if these are marketing
numbers. Not fine if they aren't.

**d. Q4 — should `totalUsers` / `totalPools` respect the cutoff too?** My
working assumption is **yes for both**, as the conservative reading of "start
keeping track for the NFL season". Pool count is obvious. User count is less
so — you may want the raw registered-user figure regardless of date.

---

## 7. Still on my queue, not blocked on you

1. **Stats integrity implementation** — steps 1–3 of the revised plan. Money +
   world-readable doc, so it goes one careful PR at a time.
2. **`sendEmail` / `sendCourierSMS` outcome plumbing** — `runReminders` cannot
   see delivery failures its helpers swallow; a run where every email failed to
   queue still reports zero failed pools.
3. **The bounded-query follow-up to #262** — composite index +
   `orderBy(startTime).limit(1)`, taking reads from ~133K/day to ~10K/day. Needs
   an index deployed **and fully built** before the code ships, and it changes
   `min(week)` semantics for postponed games. Own PR, own argument, and it needs
   you for the index deploy.

---

## 8. ⚠️ BOTH REVIEWERS ARE NOW DOWN — this needs a decision

This changed **during** today's session and it affects everything after it.

| Reviewer | State | Since |
|---|---|---|
| **qodo** | Billing-blocked. Posts `Qodo reviews are paused because your trial has ended`. Zero findings. | 2026-07-21 |
| **codex** | **Hit its usage limit mid-session.** `You've hit your usage limit… try again at Jul 28th, 2026 11:06 AM` | 2026-07-23, today |

**What that means concretely:**

- #262 got the full treatment — codex round 1 found 2 real regressions, round 2
  came back **clean**. That PR is properly reviewed.
- #263 got **round 1 only** (6 findings, all absorbed). **Round 2 could not
  run.** CLAUDE.md §2c says iterate until a round comes back clean; that did not
  happen. It is docs-only, but you should know it is one round short.
- **Until Jul 28, any further PR has NO cross-model review at all.** CLAUDE.md
  §2c exists because a single 2026-07-21 session produced 12 self-inflicted
  defects and **every one was caught by an external reviewer, none by
  self-review.** That safety net is currently gone.

**Today's session is itself the argument.** codex caught, in my own work: two
regressions I introduced in #262, a deploy command that could have hit the wrong
Firebase project, a deleted plan step that would have re-opened the stats hole
mid-season, and a forecast error that would have made a successful deploy look
like a failure. Self-review caught none of those.

**Your options, and I'd take the first:**

1. **Add codex credits** (https://chatgpt.com/codex/settings/usage). Cheapest fix,
   restores the gate that is demonstrably working. 14 days to the HOF game.
2. **Restore qodo billing.** Its *defect* findings on this repo are 17/17 valid;
   its style findings are 7/7 noise you can ignore.
3. **Accept unreviewed PRs until Jul 28** — viable only for docs and low-blast-
   radius work. **I would not ship the stats work under this**, since it writes
   money figures to a world-readable document and has already needed three review
   rounds to stop being wrong.

Tell me which, and I'll pace the queue accordingly. Absent an answer I will keep
building but will hold anything touching money, authz, prod data or scoring
until a reviewer is back.

---

## 9. Reminder — yours, calendar-bound

**A8 pricing is due 2026-08-06.** 14 days. It is the only calendar-bound item
on the board and it is not something I can do for you.
