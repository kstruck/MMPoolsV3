---
name: mmp-loop-babysit-deps
description: Build/test dependabot PRs in an isolated worktree and auto-merge only patch/minor bumps that go green. Use when asked to babysit dependabot PRs or check dependency-bump PRs.
---

# Dependabot Babysitter

Loop 4 of 5 (build order and activation ledger: `docs/plans/PLAN-LOOPS.md`). The first loop that can merge code —
build last of the four scheduled loops, most scrutiny before trusting it. **Not yet
activated** — manual invoke only, and auto-merge disabled by default even when
manually run, until Kevin approves.

## Steps

1. List dependabot's open PRs. **In the cloud there is no `gh`** — use
   `mcp__github__list_pull_requests` (`owner: kstruck`, `repo: MMPoolsV3`,
   `state: open`) and keep the ones whose author login is **`dependabot[bot]`**.
   On the Windows box: `gh pr list --repo kstruck/MMPoolsV3 --state open
   --author app/dependabot --json number,title,headRefName`.

   ⚠️ **THE TWO FILTERS ARE NOT THE SAME STRING, AND SWAPPING THEM SILENTLY
   MATCHES NOTHING.** `app/dependabot` is `gh`'s CLI **app-filter** syntax for
   `--author`; it is not an author login and never appears in an API response.
   The MCP and REST payloads carry `user.login == "dependabot[bot]"` (with
   `user.type == "Bot"`). This step said "authored by `app/dependabot`" on the
   MCP path until 2026-11-18: measured against the live repo that day, **0** of
   the 18 open dependabot PRs matched `app/dependabot` and all 18 matched
   `dependabot[bot]`, so the cloud loop would have filtered every PR out, built
   nothing, and reported a successful run over an empty set. qodo's finding on
   #699. A filter that matches nothing looks exactly like a clean sweep.

   ⚠️ Steps 3–4 need a real checkout and a Node-capable host. The cloud container
   can do the listing and the commenting; whether it can run this repo's build is
   a per-run question, and **if the build cannot run the verdict is
   `INCONCLUSIVE`, never a green comment.**
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
   ⚠️ **A PR under `scripts/agent/` is a THIRD dependency tree, and the commands
   above never install it** (qodo's finding on #800, which added that
   manifest). The root and functions gates do not import the Claude Agent SDK,
   so they stay green whatever the bump did, and a green comment would certify
   a package nobody loaded. When the PR's changed files include
   `scripts/agent/package.json` or `scripts/agent/package-lock.json`, ALSO run,
   in the same isolated worktree:

   ```
   npm --prefix scripts/agent ci
   node --input-type=module -e "const m = await import('./scripts/agent/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'); if (typeof m.query !== 'function') process.exit(1)"
   npx vitest run tests/agent-pre-review.test.ts
   node scripts/agent/probe.mjs        # only if MMP_AGENT_API_KEY is set on this host
   ```

   The first three prove the bumped package installs, loads and still exports
   `query`. Only the probe proves it still talks to the API. **No key on the
   host means the probe did not run, and the verdict for a `scripts/agent` bump
   is then `INCONCLUSIVE`, never green** — say which half ran.
5. **Verify (real gate):** build exit code + test exit code. This is the actual check —
   not "the commands were run."
6. Decision:
   - **Patch/minor + green:** comment the result on the PR. **Do not auto-merge** while
     this skill is in pre-approval status (see Rules) — post the result and stop.
   - **Major bump, any result:** comment the result, never propose auto-merge regardless
     of green/red — major bumps always need a human decision.
   - **Red build/tests:** comment the specific failure (not just "failed"), do not
     attempt a fix inside this skill — that's separate, explicit work.
7. **Log the run — BEFORE any teardown.** Append **one row for this invocation**
   to `LOOP-LOG.tsv`, in the **primary checkout**, then commit and push it. Full
   rules in `docs/plans/PLAN-LOOPS.md` ("One row per INVOCATION" and "Where the
   row is written"); the short version:
   - one tab-separated row per run (`date loop commit verdict metric idea lesson`),
     append only, never rewriting an earlier row;
   - **a run that listed zero dependabot PRs still writes a row** — `CLEAN` with
     metric `0 PRs`. Silence is indistinguishable from the loop never firing;
   - **a run that could not evaluate its verifier logs `INCONCLUSIVE`, never
     `CLEAN`**, and `metric` carries the number the verifier produced;
   - `idea` names the bumps this run covered (`3 PRs: bump vitest 3.1→3.2, …`),
     and `commit` is the repo SHA the run observed — per-PR head SHAs go in the
     PR comments the loop already posts, not in extra rows.

   ⚠️ **The order of 7 and 8 was reversed until 2026-11-18**, so the worktree was
   removed before anything was logged — and the append, made in that worktree,
   went with it. An append is not a record until it is committed and pushed
   (qodo's finding on #699).
8. Remove the worktree (or leave it if Kevin wants to inspect a failure — note
   which in the PR comment). The row from step 7 is already committed, so
   whatever happens here, the run left evidence.

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
- **Still parked**, and it is the last of the five to be trusted, by design.
  Manual invoke only until Kevin approves scheduled/unattended activation — and
  **auto-merge is a further, separate approval on top of that**, unchanged on
  2026-09-19.
