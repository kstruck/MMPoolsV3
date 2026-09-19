---
name: mmp-loop-pr-pruner
description: Flag and eventually close stale open PRs on kstruck/MMPoolsV3. Comment/close only, reversible. Use when asked to run the PR pruner or clean up stale PRs.
---

# Stale PR Pruner

Loop 2 of 5 (build order and activation ledger: `docs/plans/PLAN-LOOPS.md`). Comment/close only — fully reversible,
a closed PR reopens with one click. **Not yet activated** — manual invoke only until
Kevin approves scheduling.

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
5. Append one row per action to `LOOP-LOG.tsv` at the repo root — one tab-separated row per run
   (`date loop commit verdict metric idea lesson`, spec in
   `docs/plans/PLAN-LOOPS.md`). Append only; never rewrite an earlier row.
   **A run that could not evaluate its verifier logs `INCONCLUSIVE`, never
   `CLEAN`**, and `metric` carries the number the verifier produced.

## Rules

- Never close a PR on the first pass it's found stale — always warn first, close only on
  the next confirmed-still-stale pass.
- Never touch a PR with a `keep` label, regardless of age.
- Retry cap: 2 attempts per PR action (comment or close) if a `gh` call fails, then skip
  that PR and flag it — don't retry indefinitely.
- Cheap-model task — this is pure age/label triage, no judgment call about PR content.
- **Still parked** — manual invoke only until Kevin approves scheduled/unattended
  activation. What changed on 2026-09-19 is portability, not activation: it can
  now run in the cloud once it is turned on. Loop 1 gets two weeks first.
