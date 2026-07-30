---
name: mmp-qodo-cycle
description: >
  LIVE again as of 2026-07-30 — Kevin's qodo subscription is active and he
  asked for the check on every PR (CLAUDE.md §2b). Load this when a qodo
  report lands on a PR you authored: it covers watching the PR, pulling ALL
  three comment surfaces (any one can be empty, so a report is not absent
  until all three are), making a validity call on every finding BEFORE
  fixing, rerunning the full gate set, and reporting a per-finding verdict
  table. Runs ALONGSIDE codex (CLAUDE.md §2c), not instead of it.
---

# mmp-qodo-cycle — absorb a qodo.ai PR review autonomously

> ✅ **LIVE as of 2026-07-30.** Kevin's subscription is active again and he asked
> for the check on every PR. This skill was DORMANT from 2026-07-25 while the
> trial was lapsed; that pause is over and everything below applies. It runs
> ALONGSIDE codex, not instead of it — see CLAUDE.md §2b for the joint stopping
> rule.

Repo: `D:\march-melee-pools`. qodo.ai reviews PRs on this GitHub repo
(kstruck/MMPoolsV3; 14-day trial started 2026-07-10). Standing authorization
from Kevin (2026-07-11): when a qodo report lands on a PR I authored, run this
loop WITHOUT asking, then notify with results.

## Track record + the stop rule (calibration)

Across PRs #156-159 (sim harness): **6/6 findings valid**, but severity fell
monotonically each round (prod bug → invariant holes → ordering → response
shape). HANDOFF rule: findings are presumed worth validating, NEVER worth
auto-fixing unverified. If a round's findings are all below
"observable-behavior wrong" (style, hypothetical perf, restating documented
tradeoffs), REJECT with reasons and end the cycle — do not chase the tail.

## The loop

### 0. Posting behavior (observed on PR #162, 2026-07-11)

- qodo SKIPS DRAFT PRs — mark ready-for-review to trigger it (30 min of
  silence on a draft is expected, not slowness).
- It posts a "Qodo is busy working" placeholder issue comment first, then a
  separate PR-summary comment, then the FINDINGS as INLINE review comments
  (`/pulls/<N>/comments`), often with an empty top-level review body.
- It did NOT re-review after a fix push on the same PR (observed once; the
  #157-159 "rounds" were separate PRs).

> ✅ **BILLING RESTORED — 2026-07-30. Wait for the report.**
>
> The 2026-07-22 "DO NOT WAIT AT ALL" override is gone. It applied while the
> trial had lapsed and qodo posted only "Qodo reviews are paused because your
> trial has ended". Kevin's subscription is active again, so the window and the
> background watcher below are **LIVE**, and a single empty pass is **not** a
> clean result.
>
> ⚠️ **Do not count comments — look for FINDINGS.** Per the observed behaviour
> directly above, qodo posts a *"Qodo is busy working"* placeholder issue comment
> **first**. A watcher that exits as soon as `comments + reviews > 0` therefore
> stops on the placeholder, before the summary and before the inline findings
> exist, and reports a false clean. Poll until the **inline** comment endpoint
> (`/pulls/<N>/comments`) is non-empty or the window expires.

### 1. Watch for the report

qodo posts to THREE surfaces; check all of them (a report is often review +
inline comments with an empty issue-comment list):

```bash
cd D:/march-melee-pools
gh pr view <N> --json comments,reviews -q '(.comments | length) + (.reviews | length)'
gh api repos/kstruck/MMPoolsV3/pulls/<N>/comments -q 'length'   # inline findings
```

Background watcher — **LIVE again as of 2026-07-30.** (Bash run_in_background;
harness re-invokes on exit; note tool timeout caps ~10 min — re-arm on wake if
still empty):

**Its author login is `qodo-code-review[bot]`** on the REST endpoints and
`qodo-code-review` via `gh pr view` — the `[bot]` suffix is present in one and
absent in the other, which is why the filters below differ. Confirmed empirically
against #231, #235 and #240, the PRs where its findings were valid; do not guess
this from memory.

```bash
Q='qodo-code-review'
for i in $(seq 1 12); do
  # Inline findings (REST: login carries the [bot] suffix)
  R=$(gh api repos/kstruck/MMPoolsV3/pulls/<N>/comments \
        -q "[.[] | select(.user.login | startswith(\"$Q\"))] | length")
  # Review-surface report with a real body (gh pr view: no [bot] suffix)
  S=$(gh pr view <N> --json reviews \
        -q "[.reviews[] | select(.author.login | startswith(\"$Q\")) | select(.body != \"\")] | length")
  # A CLEAN summary can land as an issue comment — count it, but never the placeholder
  C=$(gh pr view <N> --json comments \
        -q "[.comments[] | select(.author.login | startswith(\"$Q\")) | select(.body | test(\"busy working\"; \"i\") | not)] | length")
  [ "${R:-0}" -gt 0 ] || [ "${S:-0}" -gt 0 ] || [ "${C:-0}" -gt 0 ] && { echo "QODO REPORTED"; exit 0; }
  sleep 45
done; echo TIMEOUT
```

⚠️ **Two things this filtering is for, both of which broke earlier versions.**

1. **Author.** An earlier version counted *every* inline comment and non-empty
   review body regardless of who wrote them, so a human comment landing before
   qodo finished would fire the watcher and start the absorption flow with no
   qodo result at all.
2. **The placeholder vs. a clean report.** qodo posts *"Qodo is busy working"* as
   an issue comment **first**, so a watcher that exits on any activity returns
   seconds in and records a review that never happened. But the opposite
   over-correction is also wrong: ignoring issue comments outright would miss a
   qodo summary that reports **no findings**, which is exactly the clean result
   the stopping rule needs. So issue comments count — with the placeholder
   excluded by content.

**TIMEOUT is not clean.** If the window expires with nothing, say so explicitly —
"qodo did not report within N minutes" — rather than treating silence as a pass.
Silence and approval look identical, and this repo has been bitten three times by
reading a missing signal as a good one.

### 2. Pull the full report

```bash
gh pr view <N> --json reviews -q '.reviews[] | {author: .author.login, state, body}'
gh api repos/kstruck/MMPoolsV3/pulls/<N>/comments -q '.[] | {path, line, body}'
gh pr view <N> --json comments -q '.comments[] | {author: .author.login, body}'
```

### 3. Validity call per finding (BEFORE any edit)

For each finding: read the actual code at the cited site; classify —

- **VALID**: reproducible defect or broken invariant → fix.
- **VALID-BUT-DEFERRED**: real, out of the PR's bounded scope → log it in the
  PR reply + (if standing) spawn/note a follow-up; do not scope-creep the PR.
- **INVALID**: cite the line(s) proving why; rejection with evidence goes in
  the notification and (optionally) a PR reply. Never weaken a test or
  assertion to satisfy a finding (clobber-guard rule).

### 4. Fix + gates (every round, no skipping)

One commit per finding-cluster, message crediting the source:
`fix(<area>): <what> (qodo review of PR #<N>)`.

Gates before push — ALL of them, with counts (evidence bar, see
mmp-validation-and-qa):

```powershell
npx tsc -b                              # frontend typecheck
npm --prefix functions run typecheck    # + `npm --prefix functions run build` if functions/tsconfig or index exports changed
npm test                                # root (baseline 244 as of 2026-07-11)
npm --prefix functions test             # functions (baseline 410)
# if functions/emulator surface touched (Java required):
npm --prefix functions run test:emulator   # baseline 83 passed / 10 skipped
# if firestore.rules touched — all six suites:
npx firebase emulators:exec --only firestore --project gridiron-gamble-uzuqo "node functions/scripts/simBackdoors.rules.test.mjs && node functions/scripts/entriesStandings.rules.test.mjs && node functions/scripts/squarePrivate.rules.test.mjs && node functions/scripts/monetization.rules.test.mjs && node functions/scripts/payoutRecords.rules.test.mjs && node functions/scripts/profileAchievements.rules.test.mjs"
```

`git show --stat HEAD` after committing (bad-git-add lesson). Push; CI must
go green (`gh pr checks <N>`).

### 5. Repeat until dry

**Round 2 is back on** (billing restored 2026-07-30) — but read the next
paragraph before you make a clean round 2 a *requirement*.

⚠️ **DO NOT gate on a second qodo pass. It may never come.** The observed-behaviour
list above records that qodo **did not re-review after a fix push on the same
PR** — the #157–159 "rounds" were separate PRs. So a stopping rule of the form
"keep going until a fresh qodo round is clean" can be **unsatisfiable**: you fix
its finding, re-arm, and the watcher simply times out. That would deadlock the
joint gate in CLAUDE.md §2b on every PR where qodo actually finds something,
which is precisely the PRs that matter most.

**What "qodo is clean" means for the §2b stopping rule:**

> qodo has **REPORTED**, and every finding it raised is either fixed or rejected
> with written reasoning on the PR.

That is the bar — a per-finding resolution, not a fresh empty pass. qodo marks
absorbed findings `✓ Resolved`, and that mark is the confirmation. If it *does*
re-review on your push, treat a clean result as corroboration and a new finding
as a new round; just never *wait* on one.

The observation is from a single PR, so it may not hold universally. Re-arm the
watcher if you like — it costs nothing but wall-clock — but record TIMEOUT as
"qodo did not re-review", never as "qodo is clean".

Cycle ends when: every finding is fixed or rejected with reasoning, OR every
remaining one is INVALID / below the severity stop rule, OR 5 rounds (MAX_ROUNDS
convention) — whichever first. Deadlock ≠ silence: if stopping with open disputed
findings, say so.

### 6. Notify Kevin

One message: per-finding table (finding → verdict VALID/INVALID/DEFERRED →
action + commit SHA), gate evidence with counts, rounds consumed, and whether
the PR is ready to merge. No "done" without the counts.

## Boundaries

- This loop NEVER merges the PR, deploys, or flips kill-switches — those stay
  Kevin's (mmp-change-control §6).
- Scope stays inside the PR's plan phase; new work qodo suggests goes to the
  deferred list, not the diff.
- If qodo flags something in code the PR didn't touch, treat as VALID-BUT-
  DEFERRED by default.
