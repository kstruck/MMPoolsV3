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

**The action side is the Cloud Functions invocation log** (`npx firebase
functions:log`, §1 of `mmp-diagnostics-and-tooling`) — each admin callable logs
its own invocation, and that record is written by a different mechanism than the
audit row, which is what makes the comparison meaningful. Correlate on
*(callable name, invocation timestamp ±2 min, target id)* against the
`admin_audit` row's `action`, `at` and target fields.

⚠️ **Until that correlation has actually been performed, the only honest verdict
is `INCONCLUSIVE`.** This skill described itself as establishing audit integrity
while prescribing no source for the action side (qodo's finding on #699). A run
that reads only `admin_audit` has checked that the audit trail is
self-consistent, which is a weaker and different claim — say that, and say
`INCONCLUSIVE`, rather than reporting a clean integrity sweep.

## Steps

1. Load the mmp-superadmin-surface and mmp-diagnostics-and-tooling skills for the exact
   admin callable list and the read-only firestore-census query patterns.
2. **Get the ACTION side from the function logs**, not from Firestore:
   `npx firebase functions:log --only <callable> --project gridiron-gamble-uzuqo`
   for each admin callable in the lookback window (default: since last run, or
   last 24h if no prior run recorded). If the logs are not reachable from this
   host, stop and report `INCONCLUSIVE` — there is no substitute source, and
   Firestore cannot stand in for one (see "What this checks").
3. Query `admin_audit` (+ scoped audit/activity subcollections) for the same window.
4. Diff the two sets. A gap is: an admin action with no matching audit entry, or an audit
   entry that doesn't correspond to any real action (the latter is lower priority but
   still worth a line).
5. **Verify condition (the real gate):** every invocation found in step 2 has a
   matching `admin_audit` row from step 3 — 1:1, or every mismatch individually
   explained (e.g. a known no-op action type not required to log). **This gate is
   only evaluable if step 2 produced a real action list from the function logs.**
   If it did not, the gate was not evaluated: report `INCONCLUSIVE, needs review`
   and say which side was missing. Never report "clean" off a one-sided read.
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
