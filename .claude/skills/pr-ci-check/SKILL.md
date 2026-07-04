---
name: pr-ci-check
description: Check GitHub Actions CI status for a march-melee-pools PR and report pass/fail. Use when Kevin pastes a PR number or a failing Actions run URL and asks to check it.
---

# PR CI Check

Kevin's recurring move: paste a PR number or a failing GitHub Actions URL, ask "is this ok" / "check this" / report status. Codify the exact sequence instead of improvising it each time.

## Steps

1. Get the branch for the PR: `gh pr view <PR#> --json headRefName -q .headRefName` (skip if Kevin already gave the branch name).
2. List recent runs: `gh run list --branch <branch> --limit 3`
3. For any failing run: `gh run view <run-id> --log-failed`
4. Report pass/fail per check, and for failures, the specific failing step/line from the log — don't just say "it failed."

## Rules

- Don't merge, re-run, or push anything from this skill — report only. Merging/fixing is a separate explicit step.
- If all checks are green, say so plainly and stop — don't go looking for something to flag.
