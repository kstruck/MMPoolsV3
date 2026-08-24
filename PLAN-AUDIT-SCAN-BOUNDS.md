# Plan: Bound the scheduled full-collection scans (reminders, score sync, playoff sync)

_Compiled 2026-08-23 (overnight audit-remediation session) from the cloud/compute
and backend-API audits Kevin ran 2026-08-20/21, re-verified claim-by-claim
against the repo at `origin/main` = `e726be7e`. Terms per CONTEXT.md.
Plan-gated: touches **scoring** (syncGameStatus feeds processGameUpdate; the
reminders scan carries the NFL hard-lock freeze side effect). No money, no
authorization, no prod-data mutation (query/guard changes only — no new
writers)._

## Implementation status

| Item | State |
|---|---|
| 1.1 reminders type/flag-bounded queries | ✅ built — this PR |
| 1.2 syncGameStatus dead-pool guards | ✅ built — this PR |
| 1.3 checkPlayoffScores season window | ✅ built — this PR |
| 2.x denormalized sync flag + backfill | NOT STARTED — DECISION NEEDED (see Risks) |

## The findings (audit, verified)

| Job | Cadence | Today | Cost shape |
|---|---|---|---|
| `runReminders` (`reminders.ts:159`) | every 15 min | `db.collection("pools").get()` — no filter | 96 × total-pools-ever reads/day, forever |
| `syncGameStatus` (`scoreUpdates.ts:1087`) | every 1 min | `where("scores.gameStatus","!=","post")` + recent-post query | grows with dead never-started pools; each gets an ESPN fetch attempt too |
| `checkPlayoffScores` (`playoffPools.ts:387`) | every 30 min | unconditional ESPN scoreboard fetch, year-round | ~17,500 fetches/yr, useful ~3 weeks |

Precedent: `espnBracket.ts:1019` fixed this exact class once ("~1.4M reads/day
for three dead 2025 brackets").

## Why the obvious fixes are wrong (constraints found in code)

1. **A `.limit()` on the reminders scan is REJECTED.** A limit silently drops
   pools past the cap — a lost reminder (or lost hard-lock freeze, below) with
   no error. The bound must come from filters that provably exclude only pools
   the loop would skip anyway.
2. **A reminder-flag-only filter is WRONG for NFL and BRACKET pools:**
   - `checkNFLNonPickerReminders` is **default ON** — "pools without a
     reminders config still get these" (`reminders.ts:881`), opt-out is
     `reminders.lock.enabled === false`.
   - The same function performs the **hard-lock freeze**
     (`ensureHardLockFreezeForPoolDoc`) for every NFL season pool —
     "enforcement state, not a notification". Excluding an NFL pool from the
     scan removes one of its freeze writers. This is the scoring-path tie that
     plan-gates this change.
   - `bracketReminderTrigger` returns `'locked'` with **no flag check**
     (`reminders.ts:694-697`), so bracket lock notices fire for pools with no
     reminders config.
   - Squares/props ARE flag-gated in-loop: `if (!pool.reminders) continue`
     then `payment?.enabled` / `lock?.enabled` (`reminders.ts:171-177`).
3. **`status` is not a safe query key for syncGameStatus.** The raw `status`
   field is written inconsistently by era (`DRAFT`/`OPEN`/`ALIVE`…); lifecycle
   is derived. Firestore also forbids a second inequality on a different field
   alongside `!= "post"`. So the read-set fix at query level needs a
   denormalized flag + backfill — Phase 2, gated separately (prod-data
   mutation).

## Phase 1 — behavior-preserving bounds (this PR)

### 1.1 runReminders: replace the full scan with a 3-query union

```
q1: where("type", "in", ["NFL_PICKEM","NFL_SURVIVOR","NFL_MARGIN","NFL_PLAYOFFS","BRACKET"])
q2: where("reminders.payment.enabled", "==", true)
q3: where("reminders.lock.enabled", "==", true)
```
Merge by doc id (same pattern as `searchUsersByEmail`). Every pool the loop
does anything with today is in the union:
- NFL season + playoff + bracket pools: all fetched (q1) — default-ON
  behaviors and the hard-lock freeze keep every writer they have today.
- SQUARES/PROPS/legacy no-type: the loop's first line skips
  `!pool.reminders`, and each send requires `payment.enabled` or
  `lock.enabled` — q2/q3 fetch exactly those. A pool with a reminders map but
  neither flag true was fetched-then-skipped before; now it is not fetched.
  Same outcome, zero reads.
No composite index needed (each query is a single equality / `in`; no orderBy).
The read bill stops scaling with dead squares pools — the dominant, unbounded
population (one pool per game hosted, forever).

### 1.2 syncGameStatus: two in-loop guards (no query change in this phase)

Before the ESPN fetch:
- `pool.status === 'CLOSED'` → skip (closed pools must not resync scores).
- `gameStatus === 'pre'` AND `startTime` more than 7 days PAST → skip — the
  game never went live; the existing guard only skips 'pre' games far in the
  FUTURE (`scoreUpdates.ts:1136-1141`), so a dead pool with a stale gameId is
  fetched from ESPN every minute forever.
This bounds the ESPN traffic and per-pool work; Firestore reads for the query
itself shrink only in Phase 2. Log a per-run `skippedDead` count so the effect
is visible in the job log.

### 1.3 checkPlayoffScores: season window + escape hatch

NFL postseason lives in Jan–early Feb. Guard the fetch:
```
inWindow = (month === 0) || (month === 1 && day <= 20)   // Jan 1 – Feb 20 UTC
override: system/config.playoffSync.forceActive === true
```
Off-window: return early WITH a heartbeat detail ("off-season skip") — the
job stays healthy in monitors (a monitor that cries wolf all summer gets
ignored in January; same reasoning as the two rejected findings on record).
Config read is fail-open to the DATE WINDOW (a read error in-window still
syncs; out-of-window it skips) — the job's correctness matters most exactly
when the window says it should run.

### Tests (same PR, per the standing rule)

- Unit-test the extracted window predicate (`playoffSyncWindow(now, cfg)`),
  the dead-'pre' predicate, and the CLOSED skip.
- Invariant test: `reminders.ts` contains no bare
  `collection("pools").get()` (the union helper is the only pool fetch).

## Phase 2 — query-level read bound for syncGameStatus (NOT this PR)

Denormalize `scores.syncActive` (true from lock/first-live until 36h-post or
CLOSE), maintained by the existing writers, plus a one-time backfill for
existing pools. Backfill = prod-data mutation → kill-switch + dry-run per
Rule 1, own plan section + Kevin sign-off. **DECISION NEEDED: do we want
Phase 2 at all?** Phase 1 already removes the ESPN fan-out; remaining cost is
Firestore reads of dead-pool docs once a minute. Recommendation: measure after
Phase 1 (the job logs its query sizes) and only build Phase 2 if the read line
is still material.

## Risks / open questions

- **R1**: If any reminder send for SQUARES/PROPS exists that does NOT require
  an enabled flag, q2/q3 would drop it. Sweep S1 enumerates every send gate to
  close this (see PLAN-AUDIT-SCAN-BOUNDS-SWEEPS.md).
- **R2**: `type "in"` maxes at 30 values (fine at 5); adding a pool type must
  add it to q1 — invariant test cross-checks the union list against the
  loop's type dispatch.
- **R3**: Firestore `in` + no orderBy needs no composite index; verified
  against existing single-field index behavior. If deploy throws
  FAILED_PRECONDITION anyway, add the index before enabling (the
  enforceBillingStatus lesson).
- **R4 (rejected)**: audit's `.limit()` — see "Why the obvious fixes are
  wrong" #1.

## Out of scope

- `poolOps.ts:796/903` admin-triggered full scans (rare, human-invoked).
- GCP budget alert (Kevin console action — morning runbook).
- maxInstances caps (separate PR, #548).
