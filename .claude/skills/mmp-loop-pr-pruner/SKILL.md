---
name: mmp-loop-pr-pruner
description: Flag and eventually close stale open PRs on kstruck/MMPoolsV3. Comment/close only, reversible. Use when asked to run the PR pruner or clean up stale PRs.
---

# Stale PR Pruner

Loop 2 of 5 (build order and activation ledger: `docs/plans/PLAN-LOOPS.md`). Comment/close only — fully reversible,
a closed PR reopens with one click.

🟢 **ACTIVE since 2026-11-24** (Kevin: "Approve all picks"). It runs every night
in GitHub Actions (`.github/workflows/loop-pr-pruner.yml`) through the loop
runner, `scripts/agent/run-loop.mjs`, on the Claude plan's API credit. A
scheduled run happens only while the repository variable `MMP_LOOP_PR_PRUNER`
is `on`.

## How the scheduled run differs from the steps below

The steps describe the procedure. In the runner, the model that follows them
holds **no shell and no `gh`**: this repository is public, and a PR title is
text a stranger controls. It holds four tools, and the tools carry the rules:

| Step | In the runner |
|---|---|
| 1, 2 | `list_open_prs` returns each PR's number, last-activity date, days idle and whether it has the `keep` label. No titles |
| 3 | `inspect_pr` reads one PR fresh and says which action is allowed. `warn_pr` and `close_pr` re-check that and **refuse** anything else. The tools write the comment text |
| 4 | `close_pr` re-reads the PR after closing it and reports the state |
| 5 | The runner builds the row from what the tools recorded and a separate job posts it. The model does not write it |

Two rules are stricter in code than in the prose below, on purpose:

- **A warning counts only when this loop wrote it.** The marker text alone is
  not enough: anyone can post a comment that contains it.
- **"Still stale" means nothing has touched the PR since the warning.** A PR
  that was warned, worked on, and went idle again is warned again, not closed.
  The warning records the branch head it saw; a different head, a later
  comment, or any later timeline event (review, label, rename) means warn
  again. Every doubt resolves to a comment, never to a close.
- **The comment that says "Closed" is posted after the close is verified**, not
  before, and a comment is never retried blind.

To run it by hand (a dry run unless you type `--mode live`):

```
npm --prefix scripts/agent ci
node scripts/agent/run-loop.mjs pr-pruner
```

## Steps

1. List open PRs. **In the cloud (the default home for this loop) there is no
   `gh`** — use `mcp__github__list_pull_requests` (`owner: kstruck`,
   `repo: MMPoolsV3`, `state: open`) and read `updated_at` and `labels` off each
   result. On the Windows box the equivalent is
   `gh pr list --repo kstruck/MMPoolsV3 --state open --json number,title,updatedAt,labels`.
2. Filter to PRs where `updatedAt` is more than 14 days old and there's no `keep` label.
3. For each stale PR, check whether this skill already commented a warning on a prior
   run (search PR comments for the pruner's own marker text).
   - **No prior warning:** post a comment noting the PR has been inactive 14+ days and
     will be closed if untouched for another cycle. Do not close yet.
   - **Prior warning exists and still stale:** close the PR with a comment explaining why
     and how to reopen.
4. **Verify (real gate):** after closing, re-read the PR
   (`mcp__github__pull_request_read` with `method: "get"`, or `gh pr view <PR#>`)
   and confirm `state` actually changed to `CLOSED`. Never report success off the
   close call's own exit code — a 200 on the write is not the state afterwards.
5. Append **one row for this invocation** to `LOOP-LOG.tsv` — in the **primary
   checkout**, then commit and push it. (A GitHub Actions run, scheduled or
   manual, cannot push to `main`; its row goes to the loop-log issue instead — rule 5 of
   "Where the row is written".) Full rules in
   `docs/plans/PLAN-LOOPS.md` ("One row per INVOCATION" and "Where the row is
   written"); the short version: one tab-separated row per run
   (`date loop commit verdict metric idea lesson`), append only, never
   rewriting an earlier row. **A run that found nothing stale still writes a
   row** — `CLEAN` with metric `0 stale`; it said "one row per action" until
   2026-11-18, so an idle run left no record at all (qodo's finding on #699).
   **A run that could not evaluate its verifier logs `INCONCLUSIVE`, never
   `CLEAN`**, and `metric` carries the number the verifier produced. The PRs
   acted on go in `idea` (`closed 3: #612, #655, #661`), not in extra rows.

## Rules

- Never close a PR on the first pass it's found stale — always warn first, close only on
  the next confirmed-still-stale pass.
- Never touch a PR with a `keep` label, regardless of age.
- Retry cap: 2 attempts per PR action (comment or close) if a `gh` call fails, then skip
  that PR and flag it — don't retry indefinitely.
- Cheap-model task — this is pure age/label triage, no judgment call about PR content.
- Scheduling was approved on 2026-11-24. That approval covers comment and close
  on stale PRs, and nothing else: this loop never merges, never pushes, never
  edits a PR's code or labels.
