---
name: mmp-qodo-cycle
description: >
  DORMANT — Kevin removed the qodo check entirely on 2026-07-25 (CLAUDE.md
  §2b). Do NOT load this skill and do NOT check qodo on a PR. It is kept only
  so the absorption loop is recoverable if Kevin restores qodo; if he does,
  it covers watching the PR, pulling ALL three comment surfaces, making a
  validity call on every finding BEFORE fixing, rerunning the full gate set,
  and reporting a per-finding verdict table. codex (CLAUDE.md §2c) is the
  only reviewer in the meantime.
---

# mmp-qodo-cycle — absorb a qodo.ai PR review autonomously

> 🛑 **DORMANT as of 2026-07-25.** Kevin removed the qodo check until further
> notice. Nothing below runs unless he restores it. See CLAUDE.md §2b.

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

> 🛑 **QODO IS BILLING-BLOCKED — 2026-07-22. DO NOT WAIT AT ALL.**
>
> qodo posted "Qodo reviews are paused because your trial has ended" on #253 and
> returned ZERO findings on all four PRs opened overnight 07-21/22, across all
> three surfaces. **The ~10-minute window and the background watcher below are
> SUSPENDED.** Check the three surfaces ONCE, in a single pass, and move on.
>
> This matches CLAUDE.md §2b, which is authoritative. Everything below describes
> how to absorb a report IF one appears; none of it justifies waiting for one.
> Kevin will say when billing is restored.

### 1. Watch for the report

qodo posts to THREE surfaces; check all of them (a report is often review +
inline comments with an empty issue-comment list):

```bash
cd D:/march-melee-pools
gh pr view <N> --json comments,reviews -q '(.comments | length) + (.reviews | length)'
gh api repos/kstruck/MMPoolsV3/pulls/<N>/comments -q 'length'   # inline findings
```

Background watcher — **SUSPENDED while qodo is billing-blocked; kept for when
it is restored.** (Bash run_in_background; harness re-invokes on exit; note tool
timeout caps ~10 min — re-arm on wake if still empty):

```bash
for i in $(seq 1 12); do
  C=$(gh pr view <N> --json comments,reviews -q '(.comments|length)+(.reviews|length)')
  R=$(gh api repos/kstruck/MMPoolsV3/pulls/<N>/comments -q 'length')
  [ "${C:-0}" -gt 0 ] || [ "${R:-0}" -gt 0 ] && { echo "QODO POSTED"; exit 0; }
  sleep 45
done; echo TIMEOUT
```

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

**While qodo is billing-blocked (2026-07-22) there is no round 2** — it is not
reviewing at all, so do NOT re-arm the watcher; the cycle ends after the single
check in step 1. The rest of this step applies only once billing is restored.

qodo re-reviews on push (incremental). Re-arm the watcher. Cycle ends when:
a round produces zero findings, OR every remaining finding is INVALID /
below the severity stop rule, OR 5 rounds (MAX_ROUNDS convention) — whichever
first. Deadlock ≠ silence: if stopping with open disputed findings, say so.

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
