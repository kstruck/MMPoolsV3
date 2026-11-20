# PLAN-AUTO-DEPLOY: review log

Sweeps: `PLAN-AUTO-DEPLOY-SWEEPS.md`.

## Review rounds

### Round X1: codex (`gpt-5.6-terra`), on `6c74b43`

VERDICT: REVISE. 2 findings, both P1, both accepted.

| # | Finding | Verdict |
|---|---|---|
| X1.1 | The gate job reads the required checks once. `ci.yml` and `security-scan.yml` start at the same time as the deploy workflow, so the checks are still pending, the gate stops, and nothing retriggers it: green merges would never deploy. | **Valid, fixed.** §4.1 now has the gate poll every required context to a final state with a time limit, and treats a failure, a missing context or the time limit as a stop. |
| X1.2 | A staging image inherits `nginx.conf`, whose CSP allows only the production functions host and whose `/join` proxy is pinned to production. Staging's browser calls would be blocked and its join previews would hit production. | **Valid, fixed, and wider than reported.** Verified in `nginx.conf` (7 hits). The same sweep found the production domain in `functions/src` (including `stripe.ts`), `shared` and `src`. Added §4.10, sweep S8, Phase 1a (its own plan-gated change) and a risk entry. |

### Round X2: codex (`gpt-5.6-terra`), on `3454e5b`

VERDICT: REVISE. 2 findings, both accepted.

| # | Finding | Verdict |
|---|---|---|
| X2.1 (P1) | After the branch switch, pushes to `develop` never pass the gate: `ci.yml` and `security-scan.yml` only run on pushes to `main` and `master`, so the six contexts never exist on a `develop` commit. | **Valid, fixed.** Verified in both workflow files. Phase 4 now extends the triggers in the same PR; sweep S9 lists every branch-named trigger. |
| X2.2 (P2) | Listing scheduled jobs after the first staging deploy is too late: deploying all functions starts every scheduler job at once, including `runReminders` (every 15 minutes, bound to Courier). | **Valid, fixed.** §4.9 now has staging deploy from a committed include/exclude list with a test for completeness, scheduled exports excluded by default. Added D6. |

### Round X3: codex (`gpt-5.6-terra`), on `f8e2de6`

VERDICT: REVISE. 2 findings, both accepted.

| # | Finding | Verdict |
|---|---|---|
| X3.1 (P1) | `npm --prefix functions ci` does not install `firebase-tools`, which is a root devDependency. On a clean runner `npx firebase` would fetch an unpinned current release. | **Valid, fixed.** Verified in the root `package.json`. §4.2 now installs root dependencies first and deploys with the lockfile's CLI. |
| X3.2 (P2) | `functions:list` shows the same name whether the new revision or the previous one is serving, so it cannot prove the approved commit landed, which is the §1c failure mode. | **Valid, fixed.** §4.8 now adds a per-function check that the serving revision was created during the run. The query itself is marked UNVERIFIED for staging. |

### Round X4: codex (`gpt-5.6-terra`), on `13e7e36`

VERDICT: REVISE. 1 finding, accepted.

| # | Finding | Verdict |
|---|---|---|
| X4.1 (P1) | The manual run that finishes a rules release executes the ref selected when it is clicked, not the commit that stopped. If `main` has advanced, it deploys rules and frontend for a different commit while claiming to be the same release. | **Valid, fixed.** §4.3 now pins the manual run to a required SHA input, checked against `main` and the recorded pending release, and stops later push-triggered runs while a release is pending. |

### Round X5: codex (`gpt-5.6-terra`), on `c39d26b`

VERDICT: REVISE. 2 findings, both accepted.

| # | Finding | Verdict |
|---|---|---|
| X5.1 (P1) | A manual run may name a newer SHA, but the gate was specified only for the pushed commit, so a manual run could deploy a commit with red, missing or pending checks. | **Valid, fixed.** §4.3 now states the gate runs on the SHA being deployed in every run, manual runs included. |
| X5.2 (P2) | S8 says staging must serve a deny-all `robots.txt` and no sitemap, but no phase did that work; the image copies `public/` unchanged. | **Valid, fixed.** Phase 1a now carries it, with a `noindex` header added. |

### Round X6: codex (`gpt-5.6-terra`), on `81de765`

VERDICT: REVISE. 2 findings, both accepted.

| # | Finding | Verdict |
|---|---|---|
| X6.1 (P1) | The first deploy to an environment has no deployment record to diff against, so the changed-surface calculation selects nothing and staging can never get its first deploy. | **Valid, fixed.** §4.2 now defines the first run: everything on staging, and an explicit baseline SHA supplied by Kevin on production. |
| X6.2 (P2) | "Rollback is deploy the previous SHA" contradicts §4.4: without `--force`, an older SHA cannot remove functions or indexes added since. | **Valid, fixed.** New §4.11 states what a rollback does and does not undo per surface, including that a rules rollback needs an order chosen. §4.6 no longer claims more than the frontend. |

### Round X7: codex (`gpt-5.6-terra`), on `92f81bf`

VERDICT: REVISE. 1 finding, accepted.

| # | Finding | Verdict |
|---|---|---|
| X7.1 (P1) | The §4.2 table gives one unconditional `--only functions` command, which on staging deploys every export and bypasses the include/exclude list §4.9 requires. | **Valid, fixed.** The table now gives the two commands separately; staging deploys by name from the committed list. |

### Round X8: codex (`gpt-5.6-terra`), on `e4b1d0b`

VERDICT: REVISE. 2 findings, both P1, both accepted.

| # | Finding | Verdict |
|---|---|---|
| X8.1 | The production baseline SHA added for X6.1 cannot be verified: §1 says the functions checkout can be stale and Coolify builds current `main`, and `functions:list` proves names, not revisions. A wrong baseline makes the first diff skip surfaces that are missing from production. | **Valid, fixed.** No baseline is trusted. The first run in every environment deploys every surface, as a manual run with the rules order chosen. |
| X8.2 | A manual run started from `main` that checks out an older SHA would have GitHub's environment record carry `main`'s SHA, so the next diff starts from the wrong commit and omits changes. | **Valid, fixed.** §4.2: the workflow writes its own record of the SHA it checked out, at the end of a fully successful run, and diffs only from that. |

### Round X9: codex (`gpt-5.6-terra`), on `1536229`

VERDICT: REVISE. 2 findings, both accepted.

| # | Finding | Verdict |
|---|---|---|
| X9.1 (P1) | The first-run rule added for X8.1 says "all functions" in every environment, which on staging contradicts §4.9 and would start the scheduled jobs on the very first staging deploy. | **Valid, fixed.** §4.2 now says the first staging run deploys the committed staging list only, like every other staging run. |
| X9.2 (P2) | A change to `firebase.json` alone does not select the functions surface, although that file sets the functions source, ignore list and predeploy build. | **Valid, fixed.** `firebase.json` is now part of the functions change rule. |

## Resolution status

**NOT CONVERGED. Stopped at 9 of the 10 rounds CLAUDE.md §2c allows.** 9
rounds, 17 findings (11 P1, 6 P2 or unlabelled), 17 accepted, 0 rejected.
No round came back clean: findings per round ran 2, 2, 2, 1, 2, 2, 1, 2, 2.
Later rounds mostly found gaps in the fixes for earlier ones (X7.1, X8.1,
X9.1), which is the pattern §2c predicts.

The two X9 fixes have not been reviewed. One round remains under the cap;
past that needs Kevin's say-so with a reason. The plan is PROPOSED and
builds nothing, so the open risk is a design gap carried into Phase 1a, not
a defect in production.
