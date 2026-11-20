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

