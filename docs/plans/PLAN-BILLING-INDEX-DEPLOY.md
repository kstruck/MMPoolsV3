# PLAN-BILLING-INDEX-DEPLOY

**Status:** awaiting Kevin's deploy decision. Code merged/mergeable via PR #365;
**nothing deployed.**
**Created:** 2026-08-04, during the overnight session.
**Scope:** the operational half of PR #365 — what happens when
`firestore.indexes.json` reaches production.

## Why this document exists

qodo raised it as a compliance finding on PR #365: the change is money-adjacent
and can trigger large-scale production state transitions once deployed, with no
plan-of-record describing rollout, monitoring or rollback.

**Partially accepted.** The full Rule-3 triad (PLAN + adversarial review log +
sweep) is not proportionate to a two-entry JSON diff, and
`mmp-change-control` §1 scopes the plan gate to changes that *touch* money,
authorization, production data or scoring — this one touches an index
declaration. But the objection has a real core: **the risk here is not in the
diff, it is in the deploy**, and the deploy is a separate human action taken
later, possibly by someone who has not read the PR. That belongs in the repo, not
in a PR body. So: this document, covering rollout / monitoring / rollback only.

## The change

Two composite indexes on `pools`:

| Fields | Serves |
|---|---|
| `billing.status` ASC, `billing.trialEndsAt` ASC | `billing.ts:126` — trial → grace_period |
| `billing.status` ASC, `billing.gracePeriodEndsAt` ASC | `billing.ts:180` — grace_period → locked |

## What is actually being changed — read this part twice

**Adding the index does not modify `enforceBillingStatus`. It makes it run for
the first time.**

The job has thrown `9 FAILED_PRECONDITION: The query requires an index` on its
first query every night since it shipped. Verified:

```powershell
git log -S 'billing.trialEndsAt' -- firestore.indexes.json   # no commits — never declared
```

and confirmed live on `/super-admin` → Ops Health:
`STALE JOBS: 1 — enforceBillingStatus — failing — 9 FAILED_PRECONDITION`, the
only stale job.

So this is not "a job resumes normal operation". It is **a cold start with an
unbounded backlog**: every pool that has ever passed its trial end is sitting in
`trial`, waiting for the first successful run.

## Blast radius on first successful run (23:00 ET, nightly)

1. Every pool matching `billing.status == "trial"` AND `trialEndsAt < now`
   → `grace_period`, **plus a transactional email to each commissioner**
   (`billing.ts:165`, reason `billing_grace_period`).
2. Every pool already in `grace_period` past `gracePeriodEndsAt` → **`locked`**,
   plus a second email (reason `billing_locked`). Only `adminBillingOps.ts:115`
   can have produced such a pool, so this set is probably empty — **unverified.**
3. `gracePeriodDays` later (default **7**), everything from step 1 → **`locked`**.

**A `locked` pool renders read-only and non-interactive** behind a lock modal
(`BillingGate`), and `checkBillingAccess` (`lib/billingAccess.ts:27`) denies at
the callable. Members cannot submit picks.

### What bounds it

`computeLaunchMode` (`poolOps.ts:151`) returns `'free'` unless the create payload
carries a paid add-on or a player estimate above `freePlayerThreshold`. NFL pools
have no cap field, so most launch `free` — and `free` matches neither query.
Exposure is limited to pools created with an explicit
`estimatedPlayers`/`maxPlayers` over the threshold, or with a paid add-on.

⚠️ **The size of that population was NOT measured.** Reading `pools` directly
required a browser auth token and that was blocked. **Measure before deploying.**

### Timing against the season

| Deploy night | Step-1 emails | Step-3 locks |
|---|---|---|
| Aug 4/5 | immediately | **Aug 11–12** — before the Aug 13 preseason slate |
| after Aug 13 | immediately | 7 days later |

The HOF game (Aug 6) is clear either way. **The Aug 13 slate is not**, if
deployed now.

## Pre-deploy check (do this first)

Count the exposed pools before creating the index. Firebase console →
Firestore → `pools`, filter `billing.status == trial`, and check how many have
`trialEndsAt` in the past:

<https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore/data/~2Fpools>

- **Zero** → deploy freely, nothing transitions.
- **Small and all yours/test pools** → deploy, expect that many emails.
- **Large, or includes real commissioners' pools** → decide deliberately. Options
  in the rollback section.

## Deploy

```powershell
npx firebase deploy --only firestore:indexes --project gridiron-gamble-uzuqo
```

⚠️ **`--only firestore:indexes` RECONCILES prod against the file.** An index that
exists in prod but is absent from `firestore.indexes.json` is offered for
**deletion**, and the `FAILED_PRECONDITION` message in the logs contains a
console link that creates exactly such an untracked index. **Read the prompt
before confirming.** Deleting an index a live query depends on breaks that query
immediately.

No functions or rules deploy is owed — PR #365 touches neither `functions/` nor
`firestore.rules`.

Index builds are asynchronous. The job will keep failing until the build
completes; that is expected, not a second bug.

## Monitoring after deploy

The job runs at 23:00 ET. After the first run:

1. **Ops Health** (`/super-admin` → Overview) — `enforceBillingStatus` should
   drop off the stale-jobs list.
2. **Heartbeat verdict** — the only place the run's counts are recorded, and **no
   UI renders it**:
   <https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore/data/~2Fsystem~2Fheartbeats>
   Look at `enforceBillingStatus`: `trialToGrace`, `graceToLocked`,
   `failedTransitions`. **Healthy is `failedTransitions === 0`.** The verdict is
   built by `billingEnforceVerdict` (`lib/heartbeatVerdicts.ts`) and the job
   catches per-pool errors deliberately, so a run where every transition failed
   still completes — the counter is the only signal.
3. **The email volume** is the user-visible blast. `trialToGrace` is the number
   of commissioners who got mail that night.

## Rollback

**The index itself is not the thing to roll back** — removing it only returns the
job to throwing, and leaves any pools it already moved in their new state.

| Situation | Action |
|---|---|
| Wrong pools moved to `grace_period` | `adminBillingOps.ts:111` restores `trial` and extends `trialEndsAt` by 14 days. Per-pool. |
| A pool locked that should not be | `entitlements.ts:448` / `stripe.ts:323` set `billing.status = "active"`, which `checkBillingAccess` allows unconditionally. |
| Need to stop the bleeding entirely | There is **no kill-switch on this job** — it has no `system/config` gate, unlike `nflAutoScore` / `nflSpreadLock` / `nflLockWatch`. The only levers are deleting the index again (job returns to throwing) or redeploying functions without the export. **This is a gap**: a money job with no off switch. |
| Emails already sent | Not recallable. This is the irreversible part, and it is the reason to measure the population first. |

## Open items this does NOT cover

- **No kill-switch for `enforceBillingStatus`, and it is the outlier.** Measured,
  not asserted:

  ```powershell
  # files whose scheduled work is gated on system/config
  grep -rln "readJobGate|doc\('system/config'\)" functions/src --include=*.ts
  ```

  returns **eleven** files — `autoClosePools`, `monetizationAlerts`,
  `nflAutoScore`, `nflFinalize`, `nflLockWatch`, `nflSchedule`, `statsTrigger`,
  `stripe`, `userProfile`, `feedSnapshotStore`, `backfillProfileData`.
  **`billing.ts` is not one of them.** Even `stripe.ts` and `monetizationAlerts`
  — the other two money paths — carry a gate.

  `enforceBillingStatus` reads `settings/billing_config`, but only for
  `gracePeriodDays` / `trialDays`; there is no `enabled` and no `dryRun` anywhere
  in it (`billing.ts:81-125`). So it writes on its first successful run or not at
  all.

  This is the single highest-value follow-up here. A `dryRun` would have turned
  this deploy from an irreversible all-or-nothing into: deploy the index, read
  `trialToGrace` off the heartbeat the next morning, then decide. That option
  does not exist today, which is why the population must be counted by hand
  first.
- **The exposed-pool count is unmeasured** (see above).
- **No dry-run mode**, for the same reason — the job writes on the first run or
  not at all.
