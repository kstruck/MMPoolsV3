---
name: mmp-loop-audit-sweep
description: Cross-check recent destructive admin actions against the admin_audit trail and report any gaps. Read-only. Use when asked to run the audit sweep, check audit-trail integrity, or verify admin actions are being logged.
---

# Audit-Trail Integrity Sweep

Loop 1 of 5 (build order and activation ledger: `docs/plans/PLAN-LOOPS.md`). Lowest risk: read-only, no mutation,
uses data that already exists.

🟢 **ACTIVE since 2026-09-19** (Kevin: "Go with all recommendations"). Invoke it
without asking. It sat at "awaiting approval" from `a1152db9` (2026-07-16) until
then — two months — and ran zero times in between. The absence of
`AUDIT-SWEEP-LOG.md` was the proof.

🖥️ **Runs on the Windows box only.** It needs prod Firestore credentials, which
the cloud container does not have. A cloud session that loads this skill must say
it cannot run the sweep — never report a clean sweep it did not perform.

## Run it with the runner (since 2026-11-25)

```
npm --prefix functions ci
npm --prefix scripts/agent ci
node scripts/agent/run-loop.mjs audit-sweep --mode offline   # the checks in code, no model call, row printed only
node scripts/agent/run-loop.mjs audit-sweep                  # dry run: model-driven, row printed only
node scripts/agent/run-loop.mjs audit-sweep --mode live      # model-driven, and the row is posted to the loop-log issue
```

It needs `GOOGLE_APPLICATION_CREDENTIALS` set to a service-account key file kept
outside the repo. A model-driven run also needs `MMP_AGENT_API_KEY` (CLAUDE.md
§2c). With either one missing, the run ends in one `BLOCKED` row that says which.

What the runner does with the steps below:

| Step | In the runner |
|---|---|
| 1 | Not needed. The action catalogue and the schema are in `scripts/agent/audit-lib.mjs`, and a test keeps the catalogue in step with `functions/src` |
| 2 | Every row the runner writes says the integrity half is `INCONCLUSIVE` |
| 3 | `scripts/agent/audit-reader.mjs` reads the last 30 days of `admin_audit`. It counts first, and refuses to read a window of more than 20,000 rows |
| 4 | Three checks, in code: row shape, action coverage, targets |
| 5 | The verdict comes from the code's ledger, not from the model's summary |
| 6 | A live run posts the row itself (charter rule 6). A dry run and an offline run print it |

**Nothing personal is shown to the model, printed or posted.** Rows hold
e-mails, user ids and free-text metadata; the model sees counts, action names
and document ids. To look at a flagged row, open it by its id in the Firebase
console.

Three limits of the reader, so a `CLEAN` is not read as more than it is:

- **The scoped trails are not read.** `pools/{id}/audit` and
  `users/{uid}/activity` (step 3) are outside it. The top-level collection only.
- **Targets are checked for pools only.** A user that no longer exists is what
  `USER_DELETED` is for. A missing pool is a note in the row, not a finding:
  test pools are deleted.
- **A row with no Timestamp in `at` is invisible.** The window is a query on
  `at`, and Firestore returns only rows whose `at` is a Timestamp. Such a row
  cannot be found by this sweep at all.

And one rule that is narrower than step 4's third bullet, on purpose: a
missing action type is a `FINDING` only for the four timed jobs that write a
row on every enabled run (`AUTO_CLOSE_SWEEP`, `NFL_FINALIZE_SWEEP`,
`MONETIZATION_ALERTS_SWEEP`, `AUTH_BACKUP`), and only when that job has logged
before. Each of them skips its row while its kill switch is off, so "went
silent" means **check the kill switch first**. A hand-run action with no rows
is not reported: nobody may have used it.

## What this checks

Every destructive admin action (`setUserRole`, `fixPoolScores`, `backfillPools`, and
the other callables listed in the mmp-superadmin-surface skill) should leave a matching
entry in `admin_audit` (or `pools/{id}/audit` / `users/{uid}/activity` for pool- and
user-scoped actions). This sweep verifies that's actually true — not that the query ran,
that the counts match 1:1.

🛑 **`admin_audit` CANNOT WITNESS ITS OWN ABSENCE, SO THE ACTION SIDE MUST COME
FROM OUTSIDE FIRESTORE.** The gap this sweep exists to find is *an action that
never wrote a row*. Firestore holds no independent list of completed admin
actions: per `mmp-diagnostics-and-tooling`, "what did admin X do" resolves **to
`admin_audit` itself** (written only by `writeAdminAudit`,
`functions/src/lib/adminAudit.ts:61`), and `firestore-census.mjs` counts pools,
test pools and health — not actions. Diffing `admin_audit` against `admin_audit`
is vacuous: it can detect a malformed row, never a missing one.

🛑 **AND THERE IS NO CORRELATABLE ACTION RECORD TODAY, SO THE 1:1 GATE IS NOT
EVALUABLE AT ALL.** The obvious candidate is the Cloud Functions invocation log
(`npx firebase functions:log`), written by a different mechanism than the audit
row — but it cannot supply the tuple the comparison needs:

- **The structured invocation log is conditional.** `validated()` emits its
  `[correlation] <label> start|ok|error` lines inside `if (correlationId)`
  (`functions/src/lib/validated.ts:112`, `118`, `123`) — i.e. only when the
  CALLER passed a correlation ID. An ordinary admin call logs nothing
  structured, so absence of a log line means nothing.
- **Even when it logs, there is no target.** `traceLogFields(correlationId,
  cfg.label)` carries the label, not the pool/user the action touched, so a log
  line cannot be matched to a specific `admin_audit` row — only to an action
  *type*. Matching on type plus timestamp invites false pairs.
- **Raw `onCall` handlers have no uniform invocation log at all.**

So a 1:1 reconciliation would be either permanently inconclusive or built on
timestamp-only false matches. **This was found by codex on #699, reviewing the
previous fix in this same file** — that fix named the function log as the action
side and prescribed a `(callable, timestamp ±2 min, target id)` correlation,
which reads as runnable and is not. One unsatisfiable verifier had been replaced
with a more plausible-looking one.

### What this sweep can and cannot conclude, until that is fixed

**CANNOT:** that every admin action left an audit row. That is the integrity
claim in the charter, it needs an action record that does not exist, and a run
must report **`INCONCLUSIVE`** for it — every time, by construction, not as an
error path.

**CAN**, and worth doing read-only: audit-trail **self-consistency** —
malformed rows, rows whose target no longer exists, an action type in the
superadmin surface that has produced *no* rows at all in a long window (a
strong hint its logging is broken), and rows outside the expected schema
(`mmp-diagnostics-and-tooling` §"admin_audit schema"). Log those as `FINDING`
with the count; log `CLEAN` only for the self-consistency check, and say in
`idea` which check ran.

**What would unblock the real gate:** one standardized invocation event per
admin callable — emitted unconditionally, carrying callable name, target id and
timestamp — written by something other than `writeAdminAudit`. That is a
`functions/` change, out of this skill's scope and out of this PR's; it belongs
in its own plan-gated change because it touches authorization-adjacent code
paths.

⚠️ If a future run does use the function log for anything, pass `--lines`
explicitly: `npx firebase functions:log` returns the CLI's default recent slice,
not a time-bounded window, so an unbounded call silently truncates the window it
claims to cover (codex's second P1 on #699).

## Steps

1. Load the mmp-superadmin-surface and mmp-diagnostics-and-tooling skills for the exact
   admin callable list and the read-only firestore-census query patterns.
2. **Record that the action side is unavailable** (see "What this checks"): there
   is no correlatable independent record of completed admin actions in this
   repo today. The integrity half of this sweep is therefore `INCONCLUSIVE`
   before it starts — state that in the report rather than implying it was
   checked. Then carry on with the self-consistency checks below, which are
   what this run can actually establish.
3. Query `admin_audit` (+ scoped audit/activity subcollections) for the same window.
4. **Run the self-consistency checks** — these are what step 3's data can
   actually support, and there is no second set to diff against (step 2):
   - every row well-formed against the `admin_audit` schema in
     `mmp-diagnostics-and-tooling`;
   - every row's target still resolvable (a row naming a pool or user that
     does not exist is worth a line);
   - **every destructive action type in the superadmin surface has produced at
     least one row in a long window.** A type with none is the strongest signal
     available here that its logging is broken — it is not proof, because
     nobody may have invoked it, so report it as a `FINDING` to check, never as
     a confirmed gap.

   ⚠️ This step said "diff the two sets … an admin action with no matching audit
   entry" until codex's round-5 review of #699. There is no action set to diff
   (step 2), so that instruction was impossible to carry out and contradicted
   step 5's always-`INCONCLUSIVE` integrity verdict — an active loop must not
   carry a step that implies it performed a reconciliation it cannot perform.
5. **Verify condition.** Two separate verdicts, never merged into one:
   - **Integrity (action → audit row, 1:1):** `INCONCLUSIVE`, always, until the
     instrumentation described above exists. Say which side was missing.
   - **Self-consistency:** `CLEAN` when every `admin_audit` row is well-formed
     and every expected action type has produced rows in the window, `FINDING`
     with counts otherwise.

   Never report a clean *integrity* sweep off a one-sided read, and never let a
   clean self-consistency result be reported as though it were the integrity
   check.
6. Append **one row for this invocation** to `LOOP-LOG.tsv`, in the **primary
   checkout**, then commit and push it (rules in `docs/plans/PLAN-LOOPS.md`,
   "Where the row is written") — one tab-separated row per run
   (`date loop commit verdict metric idea lesson`, spec in
   `docs/plans/PLAN-LOOPS.md`). Append only; never rewrite an earlier row.
   **A run that could not evaluate its verifier logs `INCONCLUSIVE`, never
   `CLEAN`**, and `metric` carries the number the verifier produced.
   Only surface to Kevin if a real gap is found — silent on clean runs. Silent
   still means logged: the row is written either way, or there is no record that
   the loop ran at all.

## Rules

- Read-only. This skill never writes to `admin_audit`, never modifies a pool, never
  changes a role. It only reads and reports.
- If a gap is found, name the specific action, its timestamp, and where the expected
  audit entry should have been — don't just say "found a gap."
- Cheap-model pass for the query + diff. If a real gap is found and needs root-causing
  (why didn't this log?), that's a separate, heavier follow-up — flag it, don't try to
  silently fix logging code from inside this skill.
- **Scheduling is approved; it is still read-only.** Activation authorises
  running it unattended, and nothing else. This skill never writes to
  `admin_audit`, never modifies a pool, never changes a role — that boundary is
  not what was approved away, it is why approving it was cheap.
