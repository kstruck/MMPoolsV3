---
name: mmp-loop-audit-sweep
description: Cross-check recent destructive admin actions against the admin_audit trail and report any gaps. Read-only. Use when asked to run the audit sweep, check audit-trail integrity, or verify admin actions are being logged.
---

# Audit-Trail Integrity Sweep

Loop 1 of 5 (build order per PLAN-LOOPS.md). Lowest risk: read-only, no mutation,
uses data that already exists. **Not yet activated** — manual invoke only until
Kevin approves scheduling.

## What this checks

Every destructive admin action (`setUserRole`, `fixPoolScores`, `backfillPools`, and
the other callables listed in the mmp-superadmin-surface skill) should leave a matching
entry in `admin_audit` (or `pools/{id}/audit` / `users/{uid}/activity` for pool- and
user-scoped actions). This sweep verifies that's actually true — not that the query ran,
that the counts match 1:1.

## Steps

1. Load the mmp-superadmin-surface and mmp-diagnostics-and-tooling skills for the exact
   admin callable list and the read-only firestore-census query patterns.
2. Query recent admin actions in the lookback window (default: since last run, or last
   24h if no prior run recorded).
3. Query `admin_audit` (+ scoped audit/activity subcollections) for the same window.
4. Diff the two sets. A gap is: an admin action with no matching audit entry, or an audit
   entry that doesn't correspond to any real action (the latter is lower priority but
   still worth a line).
5. **Verify condition (the real gate):** counts match 1:1, or every mismatch is
   individually explained (e.g. a known no-op action type not required to log). If this
   can't be confirmed, don't report "clean" — report "inconclusive, needs review."
6. Append findings to `AUDIT-SWEEP-LOG.md` at repo root (create if missing, one dated
   entry per run). Only surface to Kevin if a real gap is found — silent on clean runs.

## Rules

- Read-only. This skill never writes to `admin_audit`, never modifies a pool, never
  changes a role. It only reads and reports.
- If a gap is found, name the specific action, its timestamp, and where the expected
  audit entry should have been — don't just say "found a gap."
- Cheap-model pass for the query + diff. If a real gap is found and needs root-causing
  (why didn't this log?), that's a separate, heavier follow-up — flag it, don't try to
  silently fix logging code from inside this skill.
- **Do not wire this to `/loop` or `CronCreate` yet.** This skill is manual-invoke only
  until Kevin explicitly approves scheduled/unattended activation.
