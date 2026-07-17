---
name: mmp-loop-pr-pruner
description: Flag and eventually close stale open PRs on kstruck/MMPoolsV3. Comment/close only, reversible. Use when asked to run the PR pruner or clean up stale PRs.
---

# Stale PR Pruner

Loop 2 of 5 (build order per PLAN-LOOPS.md). Comment/close only — fully reversible,
a closed PR reopens with one click. **Not yet activated** — manual invoke only until
Kevin approves scheduling.

## Steps

1. `gh pr list --repo kstruck/MMPoolsV3 --state open --json number,title,updatedAt,labels`
2. Filter to PRs where `updatedAt` is more than 14 days old and there's no `keep` label.
3. For each stale PR, check whether this skill already commented a warning on a prior
   run (search PR comments for the pruner's own marker text).
   - **No prior warning:** post a comment noting the PR has been inactive 14+ days and
     will be closed if untouched for another cycle. Do not close yet.
   - **Prior warning exists and still stale:** close the PR with a comment explaining why
     and how to reopen.
4. **Verify (real gate):** after closing, `gh pr view <PR#>` and confirm `state` actually
   changed to `CLOSED` — don't report success off the close command's exit code alone.
5. Append one line per action to `PRUNE-LOG.md` at repo root (create if missing).

## Rules

- Never close a PR on the first pass it's found stale — always warn first, close only on
  the next confirmed-still-stale pass.
- Never touch a PR with a `keep` label, regardless of age.
- Retry cap: 2 attempts per PR action (comment or close) if a `gh` call fails, then skip
  that PR and flag it — don't retry indefinitely.
- Cheap-model task — this is pure age/label triage, no judgment call about PR content.
- **Do not wire this to `/loop` or `CronCreate` yet.** Manual invoke only until Kevin
  explicitly approves scheduled/unattended activation.
