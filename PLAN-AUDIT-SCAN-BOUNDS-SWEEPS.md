# Sweeps — PLAN-AUDIT-SCAN-BOUNDS

_Built 2026-08-23, worktree at `origin/main` = `e726be7e`. Grep-derived,
COMPLETE lists._

## S1 — every send/side-effect gate reachable from the runReminders scan

Command: `grep -n "checkPaymentReminders\|checkLockReminders\|checkPlayoffReminders\|checkBracketReminders\|checkNFLNonPickerReminders" functions/src/reminders.ts`

| Dispatch (reminders.ts) | Pool types | Gate | Covered by union query |
|---|---|---|---|
| `:174` checkPaymentReminders | SQUARES only | `reminders.payment?.enabled` (explicit) | q2 |
| `:175` checkLockReminders | SQUARES or legacy no-type | `reminders.lock?.enabled` (explicit) | q3 |
| `:180` checkPlayoffReminders | NFL_PLAYOFFS | `lockDate` 0–2h window (`:220-228`), no flag — fires for any playoff pool near lock | q1 (type fetched wholesale) |
| `:185` checkBracketReminders | BRACKET | `auto24h`/`auto1h` flags BUT `'locked'` trigger fires flag-free (`:694-697`) | q1 |
| `:190` checkNFLNonPickerReminders | NFL_PICKEM/SURVIVOR/MARGIN | default ON (`:881`), opt-out only; ALSO writes the hard-lock freeze (`ensureHardLockFreezeForPoolDoc`) | q1 |

PROPS pools: enter the `:171` branch but neither send fires for them
(`:174` requires SQUARES, `:175` requires SQUARES/no-type) — fetched-and-
skipped today, correctly absent from the union unless flags are set (q2/q3
still fetch flagged PROPS pools; loop then skips them, unchanged).

Winner reminders (`:550`) are `onWinnerComputed` (Firestore trigger), not the
scan — unaffected.

## S2 — every `collection("pools")` query in functions/src (is anything else unbounded?)

Command: `grep -rn 'collection("pools")' functions/src/*.ts` (query sites only)

| Site | Bounded? | Verdict |
|---|---|---|
| `reminders.ts:159` | ❌ full scan | **fixed by this plan (1.1)** |
| `scoreUpdates.ts:1107,1114` | ⚠️ `gameStatus != post` grows with dead pools | guards added (1.2); query fix deferred to Phase 2 |
| `scoreUpdates.ts:1399` (`fixPoolScores` path) | admin-invoked | out of scope (accepted) |
| `autoLock.ts:59,66` | `isLocked == false` + time-window filters | bounded — OK |
| `billing.ts:126,180` | status + trialEndsAt filters | bounded — OK |
| `nflFinalize.ts:557` | filtered (season/type) | bounded — OK |
| `nflLockWatch.ts:93` | filtered | bounded — OK |
| `poolOps.ts:796,903` | admin-invoked backfill ops | out of scope (accepted) |

## S3 — scheduled ESPN fetchers and their season guards

| Job | Guard today | After this plan |
|---|---|---|
| `checkPlayoffScores` (playoffPools.ts:387) | none | Jan1–Feb20 window + `playoffSync.forceActive` override (1.3) |
| `syncGameStatus` per-pool fetches | future-'pre' skip, 36h-post skip | + CLOSED skip, + dead-'pre' (>7d past start) skip (1.2) |
| `syncNFLScoresJob` / bracket sync | own staleness guards (espnBracket.ts:1019 precedent) | unchanged |
