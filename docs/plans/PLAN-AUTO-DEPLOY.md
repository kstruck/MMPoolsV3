# PLAN: deploys run from GitHub Actions, to staging first and then production

> **STATUS: PROPOSED. Nothing is built, nothing is deployed, and no setting
> has been changed.** This PR is the plan only. Implementation starts after
> Kevin rules on the DECISION NEEDED items in §7.
> Review log: `PLAN-AUTO-DEPLOY-REVIEW-LOG.md`. Sweeps: `PLAN-AUTO-DEPLOY-SWEEPS.md`.

Kevin, 2026-11-19, on the `www` app's dead "Deploy on push" setting: *"I want
auto-deploy for this."* Same day, on whether a merge should deploy with no
further click: *"GO with your recommendation for now"* (the recommendation:
a one-click approval now, fully automatic once staging exists).

**Classification (`mmp-change-control` §1): PLAN-GATED: authorization and
production.** It gives a new principal (a GitHub Actions identity) the right
to deploy functions, rules and indexes to `gridiron-gamble-uzuqo`, and it
replaces the Rule 2 deploy ritual's human steps with a machine. No change to
money, scoring, or what any user may read or write.

---

## 1. What is wrong today (verified on `origin/main` @ `b04f6b0b`)

1. **Functions, rules and indexes deploy from one Windows checkout.**
   `firebase deploy` packages local files, and CLAUDE.md §3 records that a
   stale checkout has reported `Deploy complete!` while shipping old code,
   twice.
2. **The frontend deploys by a manual click in Coolify.** Read from Kevin's
   Coolify pages on 2026-11-19: build strategy `Dockerfile` (built from source
   on the server), Auto deploy set to "Deploy on push (webhooks)", API access
   off, and the instance has no domain (the webhook URL renders as
   `:///api/v1/deploy...`). GitHub's webhook list for the repo is empty
   (Kevin, 2026-11-19). So the push setting is on and cannot fire.
3. **There is no staging.** A change to rules, billing or scoring first runs
   for real in production.
4. **Coolify "Redeploy" builds current `main` HEAD**, not a chosen commit
   (`mmp-deploy-and-operate` §2b). The frontend that goes live is whatever
   `main` is at build time, which need not be the commit the functions came
   from.

## 2. The constraint that shapes the design

The order of a release is not fixed. `mmp-deploy-and-operate` §1a:

| Rules change | Order |
|---|---|
| none, or only grants | functions → rules → frontend |
| revokes a read the live frontend still makes | functions → frontend → rules |
| both | no order works: split into two rules deploys, planned before the branch is cut |

Functions go first in every case. The 2026-11-17 squares deploy used the
second row (functions, `www`, rules), after a full Firestore export.

A pipeline that always runs one order will, on the wrong release, blank a
page for every commissioner for the length of a build. So the pipeline must
not guess the rules order.

How often this matters, measured on `origin/main` since 2026-09-20: 35
commits, of which 2 touch `firestore.rules`, 0 touch
`firestore.indexes.json`, 13 touch `functions/` or `shared/`, 22 touch the
frontend. A rules release is about one in seventeen.

## 3. Decisions already made

| # | Decision | Source |
|---|---|---|
| A1 | GitHub Actions is the only thing that deploys. Coolify's own Auto deploy is set to "Manual deployments only". | Kevin, 2026-11-19 |
| A2 | Production waits for a one-click approval in GitHub until staging has proven itself, then becomes automatic. | Kevin, 2026-11-19 |
| A3 | Branch model across Kevin's projects: `develop` deploys to staging, `main` deploys to production. | Kevin, 2026-11-19 |
| A4 | MarchMelee's Coolify server is separate from `coolify.versistai.net`. | Kevin, 2026-11-19 |

## 4. Proposed design

### 4.1 One workflow, `.github/workflows/deploy.yml`

- **Trigger:** push to `main`, and a manual "Run workflow" button.
- **Gate job:** waits for the six required contexts (`build-and-test`,
  `emulator-tests`, `nginx-validate`, `lint`, `secrets-scan`,
  `security-audit`) on the pushed commit. `ci.yml` and `security-scan.yml`
  start at the same moment as this workflow, so the gate polls until every
  context reaches a final state, with a time limit. It continues only if all
  six succeeded; a failure, a missing context or the time limit stops the
  run. The ruleset's admin bypass can merge a red commit; this job means a
  red commit still does not deploy. (codex X1.1: the first draft read the
  checks once and would have stopped almost every green merge.)
- **Concurrency:** one deploy at a time per environment, never cancelled
  mid-run.
- **Stages:** staging runs with no approval. Production runs the same steps
  on the same commit after the approval (A2).
- **Third-party actions pinned to commit SHAs.** The repo is public and this
  workflow holds deploy rights.

### 4.2 What each run deploys

The run diffs the commit against the last commit that deployed successfully
to that environment (read from GitHub's deployment record for the
environment) and deploys only the surfaces that changed:

| Surface | Changed when | Step |
|---|---|---|
| Functions | `functions/**` or `shared/**` | `npm --prefix functions ci`, then `npx firebase deploy --only functions --project <id>` |
| Rules | `firestore.rules` | `npx firebase deploy --only firestore:rules --project <id>` |
| Indexes | `firestore.indexes.json` | `npx firebase deploy --only firestore:indexes --project <id>` |
| Frontend | anything the image is built from | build image, push, tell Coolify to pull that tag |

`--project` is always explicit. The checkout is the commit itself, so the
stale-tree failure in §1.1 cannot occur.

### 4.3 The rules order is chosen by a person, not guessed

- **No rules change in the range:** functions → indexes → frontend, with no
  question asked.
- **Rules changed:** the push-triggered run deploys functions, then stops
  with a summary that names the rules diff and the three cases in §2. Kevin
  finishes the release with "Run workflow" and picks `rules-first` or
  `frontend-first`. The mixed case stays a two-PR split, as today.

This costs one extra click on roughly one release in seventeen, and keeps
the §1a classification with a human who can read the diff.

### 4.4 Nothing destructive happens unattended

- The workflow never passes `--force`. Deleting a deployed function (an
  export was removed) and deleting a production index that is absent from
  `firestore.indexes.json` both need a confirmation the CLI cannot get in
  CI, so they stay manual actions for Kevin. **UNVERIFIED:** the exact
  non-interactive behaviour of each (skip or abort) must be observed on the
  staging project before production is connected.
- The workflow does not flip any kill-switch or `system/config` field, and
  does not run a Firestore export. A release that wants an export first, as
  on 2026-11-17, starts with that manual step and then uses "Run workflow".

### 4.5 The Cloud Run healthcheck flake

`mmp-deploy-and-operate` §1c: on a mass deploy a random subset can fail the
startup probe while the last good revision keeps serving. The workflow
follows that procedure: on failure it retries only the failed functions once
after a ten-minute wait, with the same bundle, then fails the run and names
them. It does not retry further.

### 4.6 Frontend: an image per commit

GitHub Actions builds the `www` image from the commit, with the eight
`VITE_*` build arguments (S4) read from the GitHub environment's variables,
and pushes it to GHCR tagged with the commit SHA. Coolify pulls that tag.
This closes §1.4: the frontend that goes live is the commit that was
approved, and rollback is "deploy the previous SHA" for functions and
frontend alike.

`tests/dockerfile-build-parity.test.ts` and `tests/dockerfile-sentry-env.test.ts`
keep pinning the Dockerfile; the workflow builds that same file.

### 4.7 Signing in to Firebase with no stored key

Workload Identity Federation: GitHub's short-lived token is exchanged for a
Google service account. The trust condition is the repository **and** the
GitHub environment name, so only a job that has passed the environment's
rules can obtain production credentials. No long-lived key exists to leak
from a public repo.

**UNVERIFIED:** the minimal role list for the deploy service account
(functions, Cloud Run, Cloud Scheduler for the scheduled jobs, rules,
indexes, read access to the four secrets in S5). It is to be taken from
Firebase's current documentation and proven on staging, not written from
memory.

### 4.8 Proof that it landed

- **Functions:** the deploy's exit status, then `functions:list` compared
  with the exports of `functions/src/index.ts`. CLAUDE.md §3: the tell of a
  bad deploy is an absence.
- **Frontend:** the image writes the commit SHA into a small static file,
  and the workflow fetches it from the live site until it matches or times
  out.

### 4.9 Staging

- A second Firebase project, on the same plan as production.
- A second `www` app. Proposed home: `coolify.versistai.net`, which already
  has a domain, API access and a working deploy webhook.
- Its own secrets: Stripe test keys, and no live Courier token, so staging
  cannot charge a card or email a real person.
- Staging is where every UNVERIFIED item in this plan gets observed.
- **Scheduled jobs are decided before the first staging deploy, not after.**
  `firebase deploy --only functions` creates and starts the Cloud Scheduler
  job of every scheduled export at once (`runReminders` runs every 15
  minutes and is bound to Courier). So staging never deploys "all
  functions". It deploys from a committed list: every export is named either
  as deployed to staging or as excluded, with a reason, and a test fails
  when an export is in neither. Scheduled exports start in the excluded
  list. (codex X2.2.)

### 4.10 Production hosts are written into the code today

Sweep S8: the production project id and site domain are hard-coded in
`nginx.conf` (the Content-Security-Policy, the CSP report endpoint and the
`/join` crawler proxy), in `functions/src` (including `stripe.ts`), and in
`src`. A staging image built from this tree would have its function calls
blocked by its own CSP, would proxy join previews to production, and its
functions would send users and emails to the production site. (codex X1.2.)

So staging needs one preparatory change before it can exist: the project id
and the site origin become per-environment values, with production's values
as the defaults so that production's output is byte-for-byte unchanged.
That change touches `stripe.ts`, so it is **plan-gated (money) in its own
right** and gets its own classification, tests and review when it is
written. It is Phase 1a below.

## 5. Phases

Each phase is its own PR and is shippable alone.

| Phase | What | Touches production? |
|---|---|---|
| 0 | Kevin: set the `www` app's Auto deploy to "Manual deployments only". | A setting that is already dead |
| 1a | Code: project id and site origin become per-environment values (§4.10, S8), defaults equal to production. Proven by tests that production's rendered `nginx.conf` and URLs are unchanged. | Yes, as an ordinary release that must change nothing observable |
| 1b | Staging Firebase project and staging `www` app. The workflow deploys `main` to staging on every merge, with no approval. All UNVERIFIED items observed and recorded here. | No |
| 2 | Production: the service account and trust, the `production` environment with Kevin as required reviewer, Coolify domain, API access and token, and the switch to pulling the image. The workflow gains the production stage. | Yes, first use is a release with no rules change |
| 3 | Docs and skills: every file in sweep S1 is corrected in one PR, including CLAUDE.md §3 and the Rule 2 ritual. The manual ritual stays documented as the fallback. | No |
| 4 | Branch switch (A3): `develop` deploys to staging, `main` to production, the ruleset names both branches, and the approval is dropped (A2). In the same PR, `ci.yml` and `security-scan.yml` gain `develop` in their `push` triggers (and `security-scan.yml` in its `pull_request` branches): both name only `main` and `master` today, so without this the gate in §4.1 would wait for six contexts that never start on `develop` (codex X2.1). Dependabot's target branch moves to `develop` with it. | Yes |

## 6. Risks

- **Staging is not free to stand up.** Phase 1a edits code on the money
  path (`stripe.ts` return URLs) and the CSP. It is small, but it is a real
  release to production before staging exists to test it. Its safety rests on
  tests that pin production's output as unchanged.
- **Scheduled jobs in staging.** 30 source files define `onSchedule` jobs.
  In a second project they would run on their own data, call ESPN, send
  through Courier and cost money. §4.9 keeps them out of staging by default;
  each one added later is a deliberate, named choice.
- **A partly finished release.** Functions deploy, then the run stops (a
  rules release, or a failure). Production then has new functions with the
  old frontend. This is the state every manual deploy already passes
  through, and functions-first is safe by the §1a rule, but it can now last
  until Kevin clicks.
- **The approver is the author.** With one developer the approval is a
  pause, not a second opinion. Its value is the moment to check the rules
  order and whether an export is wanted.
- **Coolify cutover.** Changing the production `www` app from "build from
  source" to "pull an image" is a change to the live app. Phase 2 does it on
  a release that changes nothing else, with the Coolify rollback in
  `mmp-deploy-and-operate` §2b ready.
- **Public repository.** The workflow must never run on `pull_request_target`
  or on fork code. The trust condition in §4.7 is the control; the trigger
  list is the second.

## 7. DECISION NEEDED

| # | Question | Recommendation | On "approve as recommended" |
|---|---|---|---|
| D1 | When a release changes `firestore.rules`, who picks the order? | The pipeline stops after functions and Kevin picks (§4.3). | Rules releases need one "Run workflow" click with an order chosen. |
| D2 | Staging before production, or production first? | Staging first (Phases 1a and 1b before Phase 2). | Production auto-deploy arrives after staging has run real releases. Until then deploys stay manual. |
| D3 | Frontend: image per commit from GHCR, or keep Coolify building from source? | Image per commit (§4.6). | The production `www` app changes build strategy in Phase 2. |
| D4 | Function deletions and index deletions: manual only? | Yes (§4.4). | Removing an export or an index still ends with a manual command by Kevin. |
| D5 | Staging `www` on `coolify.versistai.net`? | Yes (§4.9). | No change to MarchMelee's own Coolify server until Phase 2. |
| D6 | Which functions run in staging? | Callables and triggers yes; every scheduled job excluded until named (§4.9). | Staging cannot test a scheduled job until Kevin adds it to the list. |

## 8. Out of scope

- Any change to what is deployed: no function, rule, index or frontend code
  changes in this plan beyond the workflow and the version file in §4.8.
- App Check enforcement, which stays blocked (`mmp-change-control` §6).
- Automating Firestore exports, kill-switch flips or backfills.
- The repository ruleset changes (zero approvals, no bypass, branches by
  name). Those are settings Kevin changes, tracked with Phase 4.
