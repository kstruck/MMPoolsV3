---
name: mmp-loop-babysit-deps
description: Build/test dependabot PRs in an isolated worktree and auto-merge only patch/minor bumps that go green. Use when asked to babysit dependabot PRs or check dependency-bump PRs.
---

# Dependabot Babysitter

Loop 4 of 5 (build order per PLAN-LOOPS.md). The first loop that can merge code —
build last of the four scheduled loops, most scrutiny before trusting it. **Not yet
activated** — manual invoke only, and auto-merge disabled by default even when
manually run, until Kevin approves.

## Steps

1. `gh pr list --repo kstruck/MMPoolsV3 --state open --author app/dependabot --json number,title,headRefName`
2. For each PR, determine the semver bump type from the title (patch/minor/major).
3. **Isolate the checkout — non-negotiable.** Create or reuse a dedicated git worktree
   for this PR's branch (per mmp-change-control worktree-isolation rule and the
   documented clobber incident). Never build/test against the shared main working tree.
4. In the isolated worktree, in THIS order: `npm ci` (root), `npm --prefix
   functions ci`, `node functions/scripts/copy-shared.mjs`, then `npm run
   build:static`, then `npm test`, then `npm --prefix functions test`.

   ⚠️ **The functions-ci and copy-shared steps are load-bearing for the ROOT
   suite, not just the functions one** (measured 2026-08-10, three false
   failure reads in one night): several root test files import `functions/src`
   code, which resolves `../shared/*` from the `functions/src/shared` MIRROR
   (created only by `copy-shared.mjs`) and `@sentry/node` from
   `functions/node_modules`. A fresh worktree has neither, so root vitest
   reports N test FILES failed-to-load with zero assertion failures — a
   signature that reads as breakage from the dep bump and is actually the
   harness. If you see "N failed | M passed" with 0 failing assertions, fix
   the harness before blaming the bump.
5. **Verify (real gate):** build exit code + test exit code. This is the actual check —
   not "the commands were run."
6. Decision:
   - **Patch/minor + green:** comment the result on the PR. **Do not auto-merge** while
     this skill is in pre-approval status (see Rules) — post the result and stop.
   - **Major bump, any result:** comment the result, never propose auto-merge regardless
     of green/red — major bumps always need a human decision.
   - **Red build/tests:** comment the specific failure (not just "failed"), do not
     attempt a fix inside this skill — that's separate, explicit work.
7. Remove the worktree after the run (or leave it if Kevin wants to inspect a failure —
   note which in the PR comment).

## Rules

- Retry cap: 1 retry on a failure that looks flaky (e.g. a timeout, not a real assertion
  failure), then stop and report — no persisting.
- Never build/test in the shared working tree. This repo has a documented incident of a
  fleet of parallel sessions clobbering uncommitted work by sharing a tree — isolated
  worktree per PR avoids repeating it.
- Model: cheap/fast pass for the mechanical run-and-report. If Kevin later asks this
  skill to attempt a fix for a failing minor bump, that's heavier judgment work and
  should not be the default action.
- **Auto-merge is off by default even in manual-invoke mode.** This skill reports
  pass/fail; it does not merge anything until Kevin explicitly turns that on (separate
  from the general loop-activation approval, since this is the highest-consequence of
  the five).
- **Do not wire this to `/loop` or `CronCreate` yet.** Manual invoke only until Kevin
  explicitly approves scheduled/unattended activation — and auto-merge is a further,
  separate approval on top of that.
