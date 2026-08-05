# PLAN-BILLING-ENFORCEMENT — a kill-switch and a dry-run for `enforceBillingStatus`

**Status:** PROPOSED, 2026-08-04 (overnight session). **Nothing here is
implemented.** This document exists so Kevin can decide; it is not a change.

**Gate if approved:** plan-gated (`mmp-change-control` §1, **money** trigger) and
a **functions deploy**. That is why it was not built the same night the gap was
found — the job is currently working correctly, and a functions deploy two days
before the Hall of Fame game is not a free action.

**Related:** `PLAN-BILLING-INDEX-DEPLOY.md` (the missing composite indexes, PR
#365, merged and deployed 2026-08-04) carries the population figures and the
blast-radius reasoning this plan builds on.

---

## 1. The gap

`enforceBillingStatus` (`functions/src/billing.ts:81`, nightly 23:00 ET) moves
pools between billing states and emails commissioners about it:

| Phase | Query | Write | Side effect |
|---|---|---|---|
| 1 | `billing.status == "trial"` AND `billing.trialEndsAt < now` | `status = grace_period`, sets `gracePeriodEndsAt` | "Action needed: pool locks in N days" email |
| 2 | `billing.status == "grace_period"` AND `billing.gracePeriodEndsAt < now` | `status = locked` | "Pool locked" email |

`status = locked` makes `BillingGate` render the pool read-only behind a lock
modal for **every participant**. This is a production-data write on a money path
with an outbound email attached.

**It has no `enabled` flag and no `dryRun` flag.** Every other risky scheduled
job in this repo has both, defaulting off:

| Job (exported name) | Gate | Reader |
|---|---|---|
| `autoClosePools` (`autoClosePools.ts:28`) | `system/config.autoClose` | `autoClosePools.ts` |
| `nflFinalizeSweepJob` (`nflFinalize.ts:423`) | `system/config.nflFinalize` | `readSweepGate`, `nflFinalize.ts:375` |
| **`lockNFLSpreadsJob`** (`nflSchedule.ts:999`) | `system/config.nflSpreadLock` | `readJobGate`, `nflSchedule.ts:911` |
| `nflDeepScoreSweepJob` (`nflSchedule.ts:859`) | `system/config.nflDeepSweep` | `readJobGate` |
| `nflLockWatchJob` (`nflLockWatch.ts:38`) | `system/config.nflLockWatch` | `readJobGate` |
| **`enforceBillingStatus`** | **none** | — |

⚠️ **The config key and the job name are different words for the spread lock**,
and this table said `nflSpreadLockJob` — which does not exist — until qodo
caught it. The config is `nflSpreadLock`; the exported function and its
`system/heartbeats` key are `lockNFLSpreadsJob`. `nflLockWatch` was likewise
missing its `Job` suffix. Every name in the column above is now the exported
symbol, with the line it is exported on, because the point of the table is that
a reader can go find these.

This is the same fix that landed in `MORNING-2026-08-04.md` §B2 by self-review,
and it did not get applied here at the time — the third instance tonight of
correcting one document and leaving its twin standing.

Measured: eleven files under `functions/src` read `system/config`, including
`stripe.ts` and `monetizationAlerts.ts`. `billing.ts` is not one of them.

**Three independent reviewers converged on this**, which is the reason it is
written down rather than filed as a nice-to-have: a parallel overnight session
proposed a default-off gate in its own morning doc, the #365 session measured
the eleven-file fact, and qodo raised it unprompted from the #365 diff alone.

## 2. Why it matters *now* rather than in the abstract

Until 2026-08-04 the job **had never completed a single run** — it threw
`FAILED_PRECONDITION` on its first query every night because the two composite
indexes it needs were never declared. The breakage was, accidentally, the
kill-switch.

PR #365 deployed those indexes. So the job's first-ever successful run is
imminent, and the operator's only way to stop it is to delete the scheduler job
or redeploy functions.

⚠️ **As of this writing the job has still not had a successful run.** The
indexes were merged at 2026-08-04T08:53:53Z; the 23:00 ET run happened at
03:00Z the same morning, ~6 h earlier. The `system/heartbeats` beat visible on
the SuperAdmin Ops Health card at 09:18Z still reads
`enforceBillingStatus — failing 6h ago — 9 FAILED_PRECONDITION`, which is that
pre-deploy run. **The first post-index run is 23:00 ET on 2026-08-04.**

## 3. Proposed shape

Follow the existing gates rather than inventing a third pattern.

### 3a. The gate itself — reuse `readSweepGate`'s two-key idea

```ts
// functions/src/lib/billingGate.ts
export interface BillingGateState {
    enabled: boolean;
    dryRun: boolean;
    /** Which transitions may WRITE. null when dry. */
    liveTransitions: Array<'trialToGrace' | 'graceToLocked'> | null;
    forcedDryReason?: string;
}

export function readBillingGate(cfg): BillingGateState
```

Read from `system/config.billingEnforce`, with the same fail-safe defaults as
`readJobGate`:

* `enabled: cfg?.enabled === true` — absent config means **disabled**
* `dryRun: cfg?.dryRun !== false` — anything but an explicit `false` means dry

**Borrow `nflFinalize`'s refusal-to-arm-unscoped rule.** `readSweepGate`
(`nflFinalize.ts:386-394`) will not go live on `dryRun: false` alone: it also
requires `liveSeasonTypes`, and without it forces dry-run and records
`forcedDryReason`. That is the single best pattern in this repo's job fleet,
because it makes "I armed it" and "I said what I armed" the same action.

The billing equivalent is `liveTransitions`. The two phases have very different
blast radii — phase 1 sends a warning email and changes a status participants
never see; phase 2 **locks the pool for everyone**. An operator should be able
to arm the warning without arming the lock, and arming both should require
saying both.

```
{ enabled: true, dryRun: false, liveTransitions: ['trialToGrace'] }
```

⚠️ **`readJobGate` alone is NOT sufficient here** and copying it would be the
lazy wrong answer. A single `dryRun: false` on this job arms a participant-facing
lock on every pool in the repo in one edit, with no statement of scope.

### 3b. What dry-run must actually do

Dry-run is worthless if it only skips the write. It has to answer the question
the operator has: *what would happen tonight?*

* Run both queries exactly as today (they are reads; harmless).
* For each match, log the pool id, name, owner, current status, and the target
  status.
* **Send no email.** The emails are the irreversible part — a status can be
  written back, an email cannot be unsent. Every `sendEmail` call must sit
  behind the same gate as the `update`, not behind a separate one.
* **Persist the dry-run report somewhere it actually survives — and NOT in
  `admin_audit` metadata.** Two separate holes were found here, both by codex,
  and together they are the most important correction in this document, because
  §4 step 3 ("read the report") is the step the whole sequence exists for.

  ⚠️ **Hole 1 — `admin_audit` cannot HOLD a per-pool candidate list.**
  `writeAdminAudit` passes every record through `capMetadata`
  (`functions/src/lib/adminAudit.ts:32-54`), which replaces any array or object
  value with the literal marker `[array]` / `[object]`, truncates strings past
  200 characters, and stops adding keys once the payload exceeds **1 KB**. A
  list of candidate pools is an array, so it would be stored as the five
  characters `[array]`. Scalar counts survive; evidence does not.

  ⚠️ **Hole 2 — `AdminAuditViewer` would not render it even if it fit.** It
  draws five columns — When, Actor, Action, Target, Status
  (`src/components/admin/AdminAuditViewer.tsx:58-62`) — and nothing from
  `metadata`. An earlier draft of this bullet claimed the report would be
  "readable from the SuperAdmin surface"; that was the third claim in this
  document set about a UI capability that does not exist, and codex found all
  three.

  **The shape that works**, and the plan's recommendation:

  1. **Summary counts → `admin_audit`.** Scalars only
     (`candidates`, `emailResolvable`, `emailMissing`, per phase). These fit
     inside `capMetadata` and give the audit trail a durable "a dry run happened
     and here is its size".
  2. **The per-pool detail → its own document**, e.g.
     `system/billingEnforceLastDryRun` or `billingEnforceReports/{runId}`,
     written whole and read from the Firestore console. Not
     `admin_audit`, which is deliberately a capped append-only trail rather than
     a report store.
  3. **Cloud Logging is the fallback, not the plan.** It has the detail, but the
     retention window is exactly why this repo started writing reports to
     Firestore in the first place.

  Whatever is chosen, **it must be settled before the gate ships** — a report
  nobody can find is the same as no dry run at all, and a report silently
  truncated to `[array]` is worse, because it looks like evidence.
* Return the same heartbeat verdict shape as today so
  `billingEnforceVerdict` keeps grading it.

### 3c. Heartbeat

`billingEnforceVerdict` already reports `trialToGrace`, `graceToLocked` and
`failedTransitions`. Add `dryRun` and `enabled` to the detail so the beat says
which mode produced the counts. A dry-run beat reporting
`trialToGrace: 4` must not be readable as "four pools moved".

⚠️ **Do not grade a disabled job as unhealthy.** `configReadFailedVerdict`
(`lib/heartbeat.ts:165`) exists precisely because a config that could not be READ
is different from a switch someone deliberately turned off. A monitor that cries
wolf over a deliberate configuration is a monitor that gets muted — the rejection
reasoning recorded on the 2026-07-21 review rounds.

## 4. The ordering that produces evidence

This is the part worth arguing about, and it is the reason the plan recommends
building the gate at all rather than just watching the job.

1. **Build the gate, default OFF, and deploy it.** The job stops running.
2. **Set `{ enabled: true, dryRun: true }`.** One nightly run produces the
   report: exactly which pools *would* transition.

   ⚠️ **The report is a TRANSITION-candidate count, not an email count**, and
   the plan must not promise otherwise — the same conflation codex caught in the
   morning doc's §B0. Today a pool transitions whether or not an email follows:
   `resolveCommissionerEmail` can find no address on the pool or the owner
   record, and `sendEmail` failures are caught and logged without affecting the
   count (`functions/src/billing.ts:145`, `:166-172`). If the gate is built, the
   dry-run report should record **email-resolution outcomes separately** —
   resolvable / not resolvable, per candidate — because "four pools will lock"
   and "four commissioners will be warned first" are different facts and only
   the second one is reassuring.
3. **Read the report.** `PLAN-BILLING-INDEX-DEPLOY.md` predicted ~4 pools in
   `trial`. Confirm against reality before any pool moves.
4. **Arm phase 1 only** —
   `{ enabled: true, dryRun: false, liveTransitions: ['trialToGrace'] }`.
   Trials move to grace period; commissioners get a warning; nothing locks.
   ⚠️ **Write the WHOLE map, `enabled` included.** The gate treats an absent
   `enabled` as `false` (that is the fail-safe), so an edit that replaces the
   map with only `dryRun` and `liveTransitions` **disables the job** — the exact
   opposite of arming it — and it would look armed in the config. Alternatively
   edit only the individual fields in place; do not replace the map.
5. **Arm phase 2 after the grace period has actually elapsed for someone** —
   `{ enabled: true, dryRun: false, liveTransitions: ['trialToGrace', 'graceToLocked'] }`.

Step 2 is the whole point: **it is the only sequence that produces the transition
counts before any pool moves.** Deploying the index without the gate — which is
what happened — skips straight to step 5 for every pool at once.

## 5. Blast radius of NOT doing this

Stated plainly, because "the job is working correctly" is a real argument for
leaving it alone:

* The transitions are **reversible by an admin** (`adminUpdatePoolBilling`) and
  the pool's data is untouched — `locked` is a display state, not a deletion.
* The **emails are not reversible.** A commissioner told their pool is locked
  cannot be untold.
* The current trial population is small and is **all Kevin's own pools**, per the
  2026-08-04 census. So tonight's first live run is close to a free dry-run by
  accident.
* That stops being true the moment a real commissioner starts a trial, which is
  the point of the Hall of Fame launch.

So the honest reading is: **the risk is low this week and rises the moment the
product works.** That argues for building the gate soon and not tonight, which
is what this plan proposes.

## 6. What this plan deliberately does NOT propose

* **Changing any transition rule, duration, or email copy.** Gate only.
* **Touching `settings/billing_config`.** The trial/grace durations and their
  fail-open-to-defaults behaviour stay exactly as they are.
* **A SuperAdmin UI for the new flag.** ⚠️ **An earlier draft of this line said
  `system/config` "is already editable from the SuperAdmin System tab". That is
  FALSE and codex caught it.** The tab writes a small, hardcoded subset — one
  control per key, no generic editor: `enableBracketPools`
  (`src/components/SuperAdmin.tsx:2980`), `maintenanceMode` (`:3002`),
  `tickerDurationSec` (`:3027`), `autoClose` (`:3045`) and `poolTypeFlags`
  (`:3083`). **`billingEnforce` would not be among them**, which is why the NFL
  gates in `MORNING-2026-08-04.md` §B2 are armed from the Firebase console.
  (An intermediate draft said "exactly three things" and was wrong about the
  list — qodo caught that one. The negative claim is what carries the argument.)

  So arming `billingEnforce` means **editing
  `system/config` → `billingEnforce` in the Firestore console** at
  <https://console.firebase.google.com/project/gridiron-gamble-uzuqo/firestore/data/~2Fsystem~2Fconfig>,
  editing the map's fields **in place** rather than replacing the map (§4 step 4
  explains why replacing it disables the job). #362's `onSystemConfigWritten` is
  a document trigger, so a console edit lands in the Admin Audit Log the same as
  a UI one — that is what makes the console route acceptable rather than a hole
  in the audit trail.

  A toggle is still not in scope for THIS change, but it is the obvious
  follow-up: it would sit beside the existing `autoClose` control, which is the
  identical `{enabled, dryRun}` shape, and the same follow-up would cover the
  three NFL gates.
* **Deleting or pausing the Cloud Scheduler job as an alternative.** It works,
  but it leaves no record in `system/config`, no heartbeat, and nothing for the
  Ops Health card to report — which is how a job silently stops doing its work
  and keeps looking fine forever.

## 7. Cost and gates if approved

| Item | Detail |
|---|---|
| Files | `functions/src/lib/billingGate.ts` (new), `functions/src/billing.ts`, `functions/src/lib/heartbeatVerdicts.ts` |
| Tests | pure gate matrix (enabled × dryRun × liveTransitions, incl. the refuse-to-arm case), and that no `sendEmail` is reachable while dry |
| Gate | plan (this doc) + review log + sweep, per Rule 3 |
| Deploy | **functions** — `npx firebase deploy --only functions --project gridiron-gamble-uzuqo`, Kevin's action |
| Rules/indexes | none |
| Frontend | none |

## 8. Decision requested from Kevin

1. Build it, or leave the job ungated and rely on the heartbeat?
2. If build: two-key arming (`liveTransitions`) as proposed, or plain
   `{enabled, dryRun}` like `readJobGate`?
3. Before or after the Hall of Fame game (2026-08-06)?

The recommendation is: **build it, two-key, and deploy it with the next
functions deploy that is already happening for another reason** — not a
dedicated deploy this week. Until then the job runs live, and tonight's
heartbeat (§2) is the thing to watch.
