# 🌅 MORNING TAKEOVER — 2026-07-25, PART 2 (late overnight of 2026-07-24)

Continues [MORNING-2026-07-25.md](MORNING-2026-07-25.md), which covered the
earlier part of the night (the G1 plan + PR-0). Since then **PR-A (#274) and the
qodo-removal doc (#275) merged**, and this session built the next PR in the
sequence.

**Everything below is finished, codex-reviewed, and CI-green. Nothing is
deployed. Nothing is armed. No prod data was touched.**

**➡️ PR: https://github.com/kstruck/MMPoolsV3/pull/276**

---

## 1. TL;DR

Built **G1 PR-B1** — the `provisional` scoring contract plus the
`nflAutoScoreJob` scheduled scorer, **shipped OFF**. This is the split of PR-B
you approved (B1 = provisional + job; B2 = rescore queue).

- All five gates green, GitHub CI **7/7**.
- **Codex: 5 rounds, ended clean.** 9 findings — 7 fixed, 2 rejected with written
  evidence. Stopped at 5 per your standing cost cap.
- **No new composite index needed** — both queries use indexes that already
  exist, so there is no index build to wait on.

Test counts: functions **972 → 1001**, emulator **133 → 177**, root **291**
(unchanged).

---

## 2. TASK 1 — Review and merge PR #276

**~10 minutes.**

1. Open **<https://github.com/kstruck/MMPoolsV3/pull/276>**.
2. Read the PR body. Pay particular attention to **section 3, "Out of scope — and
   the arming prerequisites"** — it names three things deliberately NOT in this
   PR that gate arming the job later.
3. Click **Files changed**. Expect **10 files** — 6 source/wiring, 3 test files,
   and this handoff doc:
   - `functions/src/nflPools.ts` — the `provisional` contract
   - `functions/src/nflAutoScore.ts` — the job
   - `functions/src/lib/autoScoreDecisions.ts` — pure decision helpers
   - `functions/src/lib/weekCompletion.ts` — pure completeness predicate
   - `functions/src/index.ts`, `functions/src/lib/heartbeat.ts` — wiring
4. Scroll to the checks box at the bottom; confirm **all 7 green**.
   **If any check is red: STOP, tell me which one, do not merge.**
5. Click **Merge pull request** → **Confirm merge**.
6. **You should see:** the PR header turn purple, reading "Merged".
7. **If the merge button is greyed out:** `main` has moved and GitHub wants a
   rebase. Tell me — I will rebase it. Do not force it.

---

## 3. TASK 2 — Deploy functions (only after Task 1)

**~5 minutes.** This deploys the new job **in its OFF state**. On its own it
changes no behaviour.

1. Open a terminal in the **main checkout** — not a worktree:

```bash
cd D:/march-melee-pools
```

2. Pull the merge:

```bash
git checkout main && git pull
```

**You should see:** `Fast-forward`, and the PR #276 commits in the output.

3. Install functions dependencies. **`ci`, not `install`** — `install` rewrites
   the lockfile and dirties the tree that `firebase deploy` packages:

```bash
npm --prefix functions ci
```

**You should see:** a package count, then no errors. Moderate audit warnings are
expected and fine.

4. Deploy. There is **no rules change** in this PR, so functions is the only
   deploy needed:

```bash
npx firebase deploy --only functions --project gridiron-gamble-uzuqo
```

**You should see:** `✔ Deploy complete!`, and **`nflAutoScoreJob`** listed as a
new scheduled function.

- **If `nflAutoScoreJob` is NOT in the output:** stop and tell me. That is the
  `syncPlayInPicks` trap — a job that deploys but was never registered.
- **If it fails with `TS2307 cannot find module 'stripe'`:** you skipped step 3.
  Run it, then retry.

5. Confirm the schedule registered:

```bash
npx firebase functions:list --project gridiron-gamble-uzuqo
```

**You should see:** a line naming `nflAutoScoreJob`.

---

## 4. TASK 3 — Confirm it is genuinely OFF

**~2 minutes. Do this a few hours after the deploy**, once the job has had a
chance to fire (it runs every 10 minutes).

1. Firebase console → Firestore → document **`system/config`**.
   **You should see:** either **no `nflAutoScore` field at all**, or one with
   `enabled: false`. Both mean OFF — the gate is fail-safe, so a missing config
   is a disabled job.
2. Firebase console → Firestore → document **`system/heartbeats`**.
   **You should see:** an `nflAutoScoreJob` entry with `ok: true` and
   `detail: { enabled: false }`. That is the job running, reading its switch,
   correctly doing nothing, and saying so.
3. **If `nflAutoScoreJob` is missing from heartbeats after a few hours:** the job
   is not running. Tell me.

**Do not arm it yet** — see the next section.

---

## 5. ⛔ Do NOT arm the job yet — prerequisites outstanding

Arming means setting `system/config.nflAutoScore.enabled = true`. These must land
first:

1. **PR-B2** — the `nfl_rescore_queue` durable tier. Without it, an ESPN
   correction or a final landing more than 24h after kickoff is never picked up.
2. **PR-B′** — the per-entry submission revision watermark. Without it, a pick
   committing just after the scorer reads entries can be skipped by an unchanged
   fingerprint.
3. **PR-B′** — the `extendWeekDeadline` publish guard. This PR *writes*
   `publishedWeeks`; nothing reads it yet, so a Pick'em commissioner can still
   extend a deadline after a result has been shown. Enabling that guard also
   needs a cold-start backfill for weeks scored before this rollout.
4. **K2 · `nflDeepSweep` live with writes** (not dry-run) — unchanged from the
   earlier handoff. A dry-run deep sweep does not write `nfl_games`, so it cannot
   surface a late final to the scorer.

---

## 6. ❓ Decision I need from you

**Which PR next?** Per your one-PR-at-a-time cadence I did not start anything
else. Candidates:

- **PR-B′** — watermark + publish guard + settings path. **My recommendation:**
  it carries two of the three arming prerequisites above.
- **PR-B2** — the rescore queue.

Tell me which and I will start it.

There is also a **background-task chip** waiting: a small guard extending the
export-surface test to cover *scheduled* jobs, so "defined but never exported"
is caught mechanically instead of by hand. Unrelated to the deadline; it can wait.

---

## 7. What the PR actually changes (short version)

- Mid-week passes publish **live standings** but withhold everything
  finalization-sensitive: no `scoredWeeks`, no `maybeFinalizeNFLPool`, no weekly
  recap, no `SCORE_FINALIZED` audit.
- Survivor/Margin penalties fire **at the weekly lock**, not merely because a
  pass ran; a made pick stays untouched until its own game concludes.
- Only concluded, lock-closed games are graded — **including the per-week summary
  counts**, which otherwise leak how many still-open picks each rival has
  submitted.
- The job derives live slates from the 24h window, **re-reads each week in full**
  so completeness is not judged from the windowed subset, and uses a
  grading-input fingerprint so an unchanged pool costs one skip check.
- The `scoreNFLWeek` **button** now derives `provisional` too, so a SUPER_ADMIN
  scoring mid-week gets the same safeguards. On a normal end-of-week score it is
  unchanged.

Four bugs codex caught and I fixed, worth knowing because they are the
interesting ones:

1. A pass that scored **nothing** still banked a fingerprint — so a pool that
   gained its first entry after that pass would be skipped forever.
2. The per-run cap counted **successes**, so pools that legitimately bank no
   fingerprint could pin the cap and starve every pool behind them.
3. Simulation pools were candidates — a scheduled pass would have corrupted sim
   runs and left residue `cleanupSimPool` does not expect.
4. A game ESPN marks **CANCELLED before kickoff** is terminal while picks are
   still open; grading it published a member's pick into standings for a week
   they could still change.

---

## 8. Housekeeping

- Work is in worktree `.claude/worktrees/nfl-auto-score-job`, branch
  `claude/nfl-auto-score-job`. Removable once #276 merges.
- The branch was rebased onto `origin/main` after #274/#275 merged, so the push
  was a force-update and printed **"Bypassed rule violations"** — the documented,
  expected output. `PICKUP-G1-PRB1.md` is byte-identical across the rebase;
  nothing was discarded.
- qodo was **not** checked — removed 2026-07-25. Codex was the only reviewer.
- **Hall of Fame game: 2026-08-06 — 12 days out.**
