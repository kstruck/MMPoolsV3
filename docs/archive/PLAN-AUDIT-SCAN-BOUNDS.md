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
| 2.x denormalized sync flag + backfill | **SKIP recommended** — measured 2026-08-25, see "Phase 2 decision gate" |

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
- terminal status (`CANCELED`/`COMPLETED` — the values the app persists;
  `CLOSED` is a derived label nothing writes, codex r2) or
  `closedVia === 'ADMIN_CLOSE'` → skip (closed pools must not resync scores).
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
  the dead-'pre' predicate, and the terminal/admin-close skip.
- Invariant test: `reminders.ts` contains no bare
  `collection("pools").get()` (the union helper is the only pool fetch).

## Phase 2 — query-level read bound for syncGameStatus (NOT this PR)

Denormalize `scores.syncActive` (true from lock/first-live until 36h-post or
CLOSE), maintained by the existing writers, plus a one-time backfill for
existing pools. Backfill = prod-data mutation → kill-switch + dry-run per
Rule 1, own plan section + Kevin sign-off. **DECISION: measured 2026-08-25 —
SKIP. See "Phase 2 decision gate" below** for the numbers, the cost formula, and
the three thresholds that would flip it back to BUILD.

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

## Phase 2 decision gate — measured 2026-08-25

_Read-only production measurement (project `gridiron-gamble-uzuqo`), taken to
settle the "DECISION NEEDED" above. No prod data was written, no config changed._

**Recommendation: SKIP Phase 2.** The read set it would bound is empty, and has
been effectively empty for as long as the job has kept records.

### What could NOT be measured, and why

The task asked for ~a week of Phase 1 `SYNC_GAME_STATUS` summary records
including `skippedDead`. **Those records do not exist.** `syncGameStatus`
writes its summary doc only when the scan finds at least one pool — the
`allPools.length === 0` branch (`functions/src/scoreUpdates.ts`) returns after
the heartbeat write and logs nothing. The newest `SYNC_GAME_STATUS` doc in
`system_logs` is **2026-07-31T21:45Z**; there are none after it, i.e. every run
since has found zero pools. Phase 1 shipped 2026-08-24, so **`skippedDead` has
never been written to prod even once** (`skippedDead_phase1Counter: null` in the
census output). This is a fact about the data, not a failed access attempt.

Two independent measurements were used instead:

1. **Live replay** of the two queries `syncGameStatus` issues, with the returned
   docs classified by the same `isDeadSyncPool` predicate the job uses.
2. **1,559 historical runs** that did carry `details` (2026-07-07 → 2026-07-31),
   plus 10,440 `status:"idle"` docs from an older code revision that logged
   zero-pool runs (2026-05-17 → 2026-05-26).

Re-run command (repo root, PowerShell — the key stays outside the repo):

```
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\mmp-census.json"
node scripts/syncScanCensus.mjs
```

### Measured

| Quantity | Value | Source |
|---|---|---|
| Runs/day (`every 1 minutes`) | 1,440 scheduled; heartbeat `system/scoreSync` 51 s old, `"No active pools to sync"` | live |
| `activePools` — the `!= "post"` query Phase 2 targets | n=1,559 runs: min 0, **p50 0, p95 0, max 1**, mean 0.007; nonzero on **11 of 1,559** runs | log history |
| `completedPools` — the recent-post 6 h window | p50 3, p95 9, max 9, mean 4.38; nonzero on 1,557 of 1,559 | log history |
| `totalPoolsFound` | p50 3, p95 9, max 9 | log history |
| `!= "post"` query **right now** | **0 docs returned** | live replay |
| Recent-post query right now | 0 docs returned | live replay |
| Dead/skippable docs in the current read set | **0** | live replay |
| Run duration | p50 119 ms, p95 379 ms, max 10.06 s (timeout is 120 s) | log history |
| Total pools in prod | **23** | live scan |
| Pools with `scores.gameStatus` | 6 — all `"post"`, all `COMPLETED` + `closedVia: ADMIN_CLOSE` (Feb 2026 squares) | live scan |
| Pools with **no** `scores.gameStatus` field | 17 (NFL season, bracket, props) | live scan |

Two structural facts that matter more than the counts:

- **Firestore `!=` excludes documents where the field is missing.** 17 of 23
  pools have no `scores.gameStatus` at all, so they can never be returned by
  this query — no flag is needed to keep them out. The dead population the
  audit imagined is not in the read set to begin with.
- **The cost is dominated by the recent-post query** (mean 4.38 docs/run vs
  0.007), which is already bounded by a 6-hour `updatedAt` window and which
  Phase 2 as scoped does not touch.

This revises the cloud re-audit's item-14 framing ("still bills a read per dead
pool per minute"): at current prod state it bills **zero** reads for dead pools,
because there are none in the result set.

### Cost arithmetic

Let `R` = runs/day (1,440), `A` = docs returned by the `!= "post"` query, `C` =
docs returned by the recent-post query, `D` = the subset of `A` that
`isDeadSyncPool` would skip. Firestore bills a **minimum of one read for a query
that matches nothing**, so:

```
billed reads/day   = R × ( max(A,1) + max(C,1) )
Phase 2 saving/day = R × D                       (Phase 2 only shrinks A)
```

At the list price of **$0.06 per 100,000 document reads** (published Firestore
rate — quoted, not measured):

```
Phase 2 saving/yr ($) = D × 1440 × 365 × 0.0000006 ≈ $0.315 × D
```

| `D` (dead pools persistently in the active query) | Reads/day saved | Saving/yr |
|---|---|---|
| **0 (measured today)** | **0** | **$0.00** |
| 1 (historical max of `A`, and it was not even dead) | 1,440 | $0.32 |
| 100 | 144,000 | $32 |
| 500 | 720,000 | $158 |
| 1,000 | 1,440,000 | $315 |

Current total spend on this job: `1440 × (1 + 1) = 2,880` reads/day ≈ **$0.0017
/day, $0.63/yr** — that is the empty-query minimum, and no flag can reduce it.

Against that, Phase 2 costs: a denormalized field maintained by every lock /
first-live / close writer (extra document writes at $0.18/100k), a one-time
backfill that is a **prod-data mutation** (kill-switch + dry-run + Kevin
sign-off per Rule 1), and a new invariant — a pool whose `syncActive` flag is
wrong silently stops being scored, which is a scoring-path failure with no
error. **At `D = 0` the change is net-negative: real risk, zero saving.**

### Threshold that would flip this to BUILD

Build Phase 2 when **any** of these holds; re-measure with the command above
before deciding:

1. **Cost:** 7-day p50 of `details.skippedDead` **≥ 500** (≈ $158/yr and rising
   — the first point where the saving exceeds a couple of hours of work). A
   softer watch line is `≥ 100` (≈ $32/yr): worth re-checking monthly, not
   worth building for.
2. **Latency:** p95 `durationMs` **> 60,000 ms** (half the 120 s timeout) with
   the scan size, not ESPN, as the driver. Today it is 379 ms.
3. **Scan size:** `activePools` p50 **> 1,000** docs/run for a week, whether
   dead or live — at that point the unbounded-collection-scan shape is a
   problem independently of the dead fraction.

None is within two orders of magnitude of the current numbers. The realistic
path to any of them is a large, sustained population of live **SQUARES** pools
(the only type that carries `scores.gameStatus`); NFL season, bracket and props
pools do not enter this query at all, so the first live NFL season does not move
this line.

**Re-measure trigger, not a calendar item:** run `scripts/syncScanCensus.mjs`
after the first full squares-heavy weekend of the 2026 season and compare
`activePools` against threshold 3.

### Tooling note

`scripts/syncScanCensus.mjs` was added for this measurement. The existing
`firestore-census.mjs` (in `.claude/skills/mmp-diagnostics-and-tooling/scripts/`)
does not fit: it answers lifecycle questions over `/pools` (stuck-open, missing
`billing`, test pools) and never reads `system_logs` or replays the
`syncGameStatus` queries. The new script is read-only, adds no dependency, and
carries its own re-run instructions. Two incidental findings from writing it:

- A `system_logs` query filtering `type` **and** ranging `timestamp` throws
  `FAILED_PRECONDITION` (code 9) — no composite index exists. The script scans
  newest-first and filters in memory instead. Do not create the index; that is a
  prod change and this read does not justify one.
- `system_logs.timestamp` is **mixed-typed** — server jobs write `Timestamp`,
  `logClientError` writes epoch-ms numbers. Firestore orders numbers before
  timestamps, so `orderBy("timestamp","desc")` happens to return the
  server-written docs first. Anything that ranges on this field must account for
  it.

## Out of scope

- `poolOps.ts:796/903` admin-triggered full scans (rare, human-invoked).
- GCP budget alert (Kevin console action — morning runbook).
- maxInstances caps (separate PR, #548).
