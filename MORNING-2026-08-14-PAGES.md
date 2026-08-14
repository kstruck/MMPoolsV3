# MORNING 2026-08-14 — league pages, prize plans, autopick plans

Overnight session. **Three PRs open, none merged. No deploy was run. No
production data was touched.**

Supersedes `MORNING-2026-08-14.md` for the items below; that file's §4 live-scoring
audit and its launch-checklist carry-forwards are still current and are repeated
in §6 here rather than replaced.

---

## 0. DATA-SAFETY ATTESTATION — what was NOT touched

You said the test pools are mid-week and nothing may be lost. Concretely, across
all three PRs:

| | |
|---|---|
| Production Firestore | **Not read, not written, not migrated.** No script was run against it. |
| `functions/` | **No change in any PR.** `git diff --stat origin/main...HEAD -- functions/ shared/ firestore.rules firestore.indexes.json` is **empty** on all three branches. Auto-scoring (`nflAutoScoreJob` `*/5`) is untouched. |
| `weeklyPoints` / `weeklyResults` / `weeklyScores` | **Read for display only.** Nothing recomputes, rewrites or restates a scored value. |
| Entry documents | **No write of any kind.** |
| Settings semantics | **No existing field changed meaning.** The tiebreaker change is a PLAN only — no code. |
| Migrations / backfills | **None written, none run.** |

The one thing that changed on screen for an existing pool is the **Standings tab
losing its Season/Week toggle** (#427, your ruling) — the weekly view moved to
the new Results tab. No data behind it changed.

---

## 1. THE THREE PRs

All three are gate-complete on codex and CI. qodo state is per-PR below.

| PR | What | Deploy owed on merge | Gate |
|---|---|---|---|
| [#426](https://github.com/kstruck/MMPoolsV3/pull/426) | Live Scoreboard opens on NFL | **Coolify rebuild only** | codex clean, qodo 3 findings absorbed, CI 7/7 |
| [#427](https://github.com/kstruck/MMPoolsV3/pull/427) | League Results pages (5 of your 6) | **Coolify rebuild only** | codex clean r6, qodo 2 findings (1 absorbed / 1 rejected), CI 7/7 |
| [#428](https://github.com/kstruck/MMPoolsV3/pull/428) | The two plan docs | **Nothing** — docs only | codex clean r4, qodo pending |

**No functions deploy and no rules deploy is owed by any of them.** If you merge
all three, the whole deploy is: **one Coolify rebuild.**

### 1a. Merge and deploy — exact steps

**Step 1 — merge, in this order.** From any browser tab:

1. Open https://github.com/kstruck/MMPoolsV3/pull/426 → **Squash and merge** → confirm.
2. Open https://github.com/kstruck/MMPoolsV3/pull/427 → **Squash and merge** → confirm.
3. Open https://github.com/kstruck/MMPoolsV3/pull/428 → **Squash and merge** → confirm.

*Success looks like:* each PR shows a purple **Merged** badge.
*If a PR shows a merge conflict instead:* stop and tell me which one; they do not
overlap in any file, so a conflict means something else landed on `main`.

**Step 2 — one Coolify rebuild.**

1. Open the Coolify dashboard.
2. Select the `www` / frontend application.
3. Click **Redeploy** (or **Deploy**).
4. Wait for the build to report success.

*Success looks like:* the deploy log ends with the container healthy.
*If it fails with `Container Healthcheck failed`:* that is the known flake —
runbook is `.claude/skills/mmp-deploy-and-operate` §1c. Retry the deploy once
before investigating.

**Step 3 — confirm the new bundle actually shipped.** A moved hash proves a
rebuild ran, not which code shipped.

Open **PowerShell** in `D:\march-melee-pools` and run this one line:

```powershell
[regex]::Matches((Invoke-WebRequest -Uri "https://marchmelee.com" -UseBasicParsing).Content, 'index-[A-Za-z0-9_-]+\.js') | ForEach-Object { $_.Value } | Select-Object -Unique
```

*Success looks like:* one line of output, a hash **different from
`index-IDWl1xhV.js`** (the bundle live before this deploy).

*If it prints nothing:* the page did not return the expected HTML — check the
site loads in a browser first, then re-run.
*If it prints `index-IDWl1xhV.js`:* the rebuild did not ship. Re-trigger the
Coolify deploy and watch the build log to the end.

⚠️ PowerShell, not bash: `curl` in PowerShell 5.1 is an alias for
`Invoke-WebRequest` and takes different arguments, and `grep` does not exist
there — a `curl … | grep …` pipeline fails before it reaches the site. (codex
caught this one; the standing rule is that anything handed to Kevin runs in
PowerShell 5.1 and never uses `&&`.)

⚠️ **Do NOT grep the entry bundle for the new strings** — the Results page is a
lazily-imported route chunk and the entry bundle reports ABSENT on a perfectly
good deploy. If you want the real check, ask me and I will run the chunk-graph
crawl with fresh sentinels (`Total Margin Points`, `No Points`, `Margin Summary`
are the candidates — they are new in #427 and exist nowhere in the live bundle).

---

## 2. BROWSER LOOK-AT LIST — this is the largest open item

⚠️ **Nothing in #427 has been seen by human eyes, and I could not capture a
screenshot.** The pages live inside a pool dashboard behind auth: the in-app
browser can run the dev server but cannot sign in, and the Chrome extension sees
your real browser, which is production, where this code does not exist yet. What
is proven is `tsc -b` clean, `vite build` clean, and 29 unit tests over the
arithmetic. What is **not** proven is that any of it renders correctly.

So this list is the substitute. **Do it after the Coolify rebuild.**

### 2a. Results tab — Pick'em pool

1. Open a Pick'em pool → the tab strip should now read `POOL HOME / MY ENTRY / STANDINGS & LEADERBOARD / **RESULTS** / WEEKLY RECAPS / RULES / …`.
2. Click **RESULTS**. Expect a segmented control with two buttons: *"<Week> Results"* and *"Season Summary"*.
3. **<Week> Results** — columns Place / Player / Points / Max / Correct / **No Points**.
   - Tied scores must share a place (1, 1, 3 — not 1, 2, 3).
   - A player the scorer has not reached shows **—** in Place and Points, and sorts to the bottom.
   - **Max** should be the same number in every row.
4. Change the week with the header's week selector. The table should follow it.
5. **Season Summary** — players down, week numbers across, Total on the right. A preseason pool must show **4** week columns, not 18.

### 2b. Results tab — Margin pool

6. Open a Margin pool → **RESULTS** → three buttons: *"<Week>"*, *"Margin Summary"*, *"Margin Standings"*.
7. **Margin Summary** — the weeks grid, positives signed `+7`, negatives plain `-14`.
8. **Margin Standings** — Rank / Player / Total Margin Points / Weeks. ⚠️ There is **no "Tiebreaker Total" column** — see §3, that is deliberate.

### 2c. Survivor pool

9. Open a Survivor pool → **there should be NO Results tab.**
10. Then manually visit that pool's URL with `?tab=results` appended. It must land on the **pool dashboard**, not a blank page. *(This was a real bug I found reading my own diff; this step is the check that the fix works.)*

### 2d. Standings regression check

11. Open **STANDINGS & LEADERBOARD** on a Pick'em pool. The **Season / Week toggle from #422 should be GONE** — season only.
12. Confirm the rest of that table is unchanged: rank chips, the red-tinted "Me" row, the MNF Score column, "X of Y Picks Set".

### 2e. Scoreboard (#426)

13. Open `/scoreboard` while signed out. It must open on **NFL**, not NCAA Basketball, with games showing.
14. Click COLLEGE FOOTBALL and NCAA BASKETBALL to confirm both still work.

### 2f. Carried, still never verified

15. `MORNING-2026-08-13-PART2.md` §1 step 5 — the #422/#423 surfaces (Season/Week toggle, hybrid entry-fee split) have **never had human eyes**. The toggle is now gone as of #427, so what remains to check there is **the hybrid split** on the create wizard and the manager settings.

---

## 3. DECISIONS I NEED FROM YOU

### 3a. On #427 — two judgement calls, both reversible

| # | Question | What I shipped | Why |
|---|---|---|---|
| **Q1** | **"Max"** — most points anyone COULD score this week, or most still ATTAINABLE for that player? | **Max possible.** Same number in every row. | Your screenshot does not disambiguate. It does step down when a game is cancelled or ends in a tie, because those points stop existing for everybody — but it never falls because one player's picks went wrong. |
| **Q2** | Your reference labels a column **"Incorrect"**. I labelled it **"No Points"**. | **"No Points."** | `total - correct` is *graded picks that did not win*. That equals "incorrect" only when the week has no tie and no cancellation — a player with one correct pick and one push was being printed as having 1 incorrect. The exact loss count needs per-game grades, which the member-readable projection strips on purpose. Say the word and it goes back to "Incorrect", but then it is **wrong** on tie weeks. |

### 3b. On #427 — a named gap, not an oversight

**Q3.** Your Margin Standings reference has a **"Tiebreaker Total"** column.
**A Margin pool asks for no tiebreaker prediction at all** — `weeklyTiebreakers`
is a Pick'em-only field. I rendered the columns that exist rather than inventing
a number. Do you want Margin to *gain* a tiebreaker? That is a scoring change and
its own plan.

### 3c. 🛑 A2 — the Current Picks grid is NOT built, and it needs your ruling

This is the one page of your six that is missing, and the reason is not UI work.

`getPoolPicks` — the only door to another member's picks — throws
`permission-denied` for anyone who is not the pool's owner, manager, or
SUPER_ADMIN (`functions/src/nflPickReveal.ts:106`). Its own header says so:
*"anyone else → permission-denied. Ordinary participants are NOT a principal
here."* That was a deliberate decision in #414.

Your reveal instruction was about **timing** — "only shown once the week locks" —
and the server already enforces timing, per game. The open question is the
**principal set**:

> **Q4. May an ordinary member see another member's already-revealed picks?**

- Your reference site says yes (that is what the grid is).
- This repo currently says no, on purpose.

Answering **yes** means widening an authorization boundary, which is plan-gated
and is a `functions/` change that deploys into the live scorer. I did not do it
overnight inside a display PR. **Say yes and it is the next plan I write.**

### 3d. On #428 — 13 decisions, all with recommendations

Both plan files carry a decision table; I will not restate them here, but these
two are the ones that can hurt:

**Q5 (PLAN-WEEKLY-PRIZES D1) — the one that touches your in-flight test pools.**
The carried instruction was to make absent/`MNF_COMBINED` re-read as
`MNF_LAST_GAME`. On a week with two Monday games that **changes the target an
already-submitted prediction is judged against**, and your test pools are
mid-week. My recommendation: write the value explicitly at create so new pools
get `MNF_LAST_GAME`, leave the resolver alone, make `MNF_COMBINED` **unpickable
rather than unhonoured**, and flip your test pools yourself when you want to.
You get everything you asked for at the point of choice, and nothing in flight
moves. **If you would rather accept the re-read on test pools, say so — it is a
legitimate call, it just has to be yours.**

**Q6 (PLAN-AUTOPICK-LIMITS D1) — what IS an autopick?**
**This site has no automatically generated picks.** T-C (auto-pick on a missed
deadline) was never started. Quick Picks is a button the *member* presses, and
the submission is byte-identical to a hand-made one. So the setting you asked for
currently counts something that cannot be counted. Three readings are in the
plan; my recommendation is **system-generated only**, with the setting shipping
now and enforcement arriving when T-C does. ⚠️ If you want Quick Picks counted,
it is **honor-grade** — the flag would be client-set and unverifiable, and a
"these look mechanical" heuristic would attach a false accusation to prize money.

---

## 4. WHAT I FOUND AND DID NOT FIX

**`settings.pointsPerPick` is dead config.** It is in the create schema
(`shared/schemas/nfl.ts:53`) and **no scorer reads it** — `scorePickemEntry`
hardcodes `points += 1` on a non-confidence pool. So a commissioner can set it,
see it saved, and it does nothing. The Results page deliberately ignores it. Left
alone because it is a scoring-adjacent decision: either wire it up or remove it,
and both are your call.

**A fresh worktree fails its first test run.** `functions/src/shared/` is
generated and gitignored, so `npm test` fails with
`Cannot find module '../shared/nflTiebreaker'` until
`node functions/scripts/copy-shared.mjs` has run once. Not a defect, but it cost
me a few minutes and it will cost the next session the same.

---

## 5. WHAT I DID NOT GET TO

- **Part B implementation.** Plan-gated and blocked on Q5 — building the resolver change before you rule on the in-flight-week question is exactly the risk you told me to avoid. The plan is complete and codex-clean through 4 rounds.
- **Part C implementation.** Blocked on Q6 (the definition). The definition-agnostic half — the setting, its validation, the rules guard, the marker rendering — is specced and is the natural first PR the moment you answer.
- **Review logs and sweep passes** for both plans. Required before implementation; not written.
- **A2**, per §3c.

---

## 6. CARRIED FORWARD (unchanged from the previous runbook)

- **Launch checklist A–F** — invites, `nflDeepSweep`, NFL-6, backups, SA key. `MORNING-2026-08-13.md` §4.
- **`nflDeepSweep` is still unset** — a FINAL or a correction arriving >24h after kickoff is never re-read from ESPN. Two-stage arm is task 5 of `MORNING-2026-08-10-LAUNCH.md`.
- **Email logo** still outstanding.
- **[#425](https://github.com/kstruck/MMPoolsV3/pull/425)** (docs-only, HANDOFF update) — still open as of this writing. Gate closed; it just needs your merge.
- **[#380](https://github.com/kstruck/MMPoolsV3/pull/380)** (README catch-up) and the dependabot PRs (#300–304, #401–403) are still open and untouched.
- **App Check remains OFF** — do NOT set `VITE_RECAPTCHA_SITE_KEY`.
- 🛑 **Automated scoring is LIVE**: `system/config.nflAutoScore` `{enabled:true, dryRun:false}`, `nflAutoScoreJob` `*/5`. Nothing tonight went near it.

---

## 7. Reviewer scorecard for the night

| PR | codex rounds | codex findings | qodo findings | Rejected, with reasoning on the PR |
|---|---|---|---|---|
| #426 | 3 | 1 | 3 | codex's season-aware default — **you already declined it**; noted in the code and the PR body |
| #427 | 6 | 4 | 2 | codex r4 (its arithmetic was wrong — it summed the *bottom* 15 confidence weights instead of the top 15; disproved with a brute-force test over every case), qodo's red-highlight finding (`docs/UI-REVAMP-GUIDE.md:51` prescribes exactly that treatment for leaderboards) |
| #428 | 6 | 12 | 4 | codex r4's weekly-pot division (the shipped `PayoutsPanel` labels that figure "weekly **total**" and its tooltip says weekly "pot**s**"), qodo's two long-line findings (no markdown line-length rule is configured in this repo) |

**qodo state:** #426 re-reviewed to `Bugs (0)` with both absorbed findings
`✓ Resolved`; #427's absorbed finding `✓ Resolved`; #428 reported and every
finding resolved or rejected on the PR.

**⚠️ #428's final CI run was still in progress when this was written** — the
earlier run on the same branch was green and the change is documentation only,
but check `gh pr checks 428` before merging rather than taking this line for it.

The pattern held again, and hard: **round 1 found defects in the work, and rounds
2+ found defects in the fixes.** #427 r2 caught a bug that r1's own fix had made
reachable. #428 r3 caught two contradictions that r2's fix had left behind, and
r5 caught the plan contradicting itself about whether a tie past the last paid
rank still gets paid.

The two findings I would most want you to notice are the ones that came from
**reading the code rather than the plan**: `proxyPick` exists and writes picks for
another user (qodo, #428), and `getPoolPicks` refuses ordinary members outright,
which is what blocks A2 (measured while building #427). Neither was in the brief.
