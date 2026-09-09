# PLAN-TEST-SUITE — Sweeps (deterministic instance lists)
_Built 2026-07-07 on main @ 9e6b032 (post buy-flow merge #144). Greps re-runnable;
re-run before implementing each item — these lists go stale with every merge._

## Sweep 1 — Every raw Firestore write in the testing harness (item 8f migration inventory)
`grep -rn "addDoc\|setDoc\|updateDoc\|deleteDoc\|writeBatch" src/utils/testing --include=*.ts`

| Site | Write | Target | 8f disposition |
|---|---|---|---|
| `bracketE2ESimulator.ts:149` | setDoc | **`tournaments/mens-2025` (REAL doc ID)** | guarded callable + sim-namespaced tournament ID |
| `bracketE2ESimulator.ts:185` | addDoc | `pools/{id}/entries` | guarded callable (entry fabrication) |
| `bracketE2ESimulator.ts:207` | updateDoc | pool doc (status) | guarded callable |
| `bracketE2ESimulator.ts:234` | setDoc | **`tournaments/mens-2025` (REAL doc ID)** | guarded callable + sim-namespaced ID |
| `bracketE2ESimulator.ts:262` | updateDoc | entry doc (scores) | guarded callable |
| `bracketE2ESimulator.ts:334` | updateDoc | pool doc (status COMPLETED) | guarded callable |
| `bracketSimulator.ts:148` | setDoc | `tournaments/{tournamentId}` | guarded callable + sim-namespaced ID |
| `bracketSimulator.ts:183` | addDoc | `pools/{id}/entries` (the 0-entries bug site) | guarded callable |
| `bracketSimulator.ts:212` | updateDoc | entry doc (scores) | guarded callable |
| `bracketSimulator.ts:231` | updateDoc | pool doc (status COMPLETED) | guarded callable |
| `playoffSimulator.ts:146` | updateDoc | pool doc (`entries` array + isLocked) | guarded callable |
| `playoffSimulator.ts:194` | updateDoc | pool doc (`entries` array) | guarded callable |
| `propsSimulator.ts:140` | updateDoc | pool doc (props results) | guarded callable |
| `propsSimulator.ts:160` | updateDoc | prop card doc (score) | guarded callable |
| `propsSimulator.ts:173` | updateDoc | pool doc (isLocked) | guarded callable |
| `tournamentTestUtils.ts:24` | setDoc | `tournaments/{tournamentId}` | guarded callable + sim-namespaced ID |
| `tournamentTestUtils.ts:51` | setDoc | `tournaments/{tournamentId}` | guarded callable + sim-namespaced ID |
| `tournamentTestUtils.ts:64` | deleteDoc | `tournaments/{tournamentId}` | superseded by cleanupSimPool |

Notes: playoff + props store entries INSIDE the pool doc (array field), not a
subcollection — the guarded-callable API must support both entry models.
squaresSimulator has NO raw writes (all via dbService) — confirms it as the
most-migrated sim.

## Sweep 2 — Indirect writes via dbService (real product paths; stay as-is per ADR-0001)
`grep -rn "dbService\.\w*" -o src/utils/testing --include=*.ts`
- createPool: squares:63, props:87, playoff:109, bracket:102, bracketE2E:139
- Mutations: squares reserveSquare(211,453), lockPool(223,459);
  props purchasePropCard(99), updatePool(133,135,171); playoff updatePool(144,192);
  bracket updateBracketPool(229)
- Cleanup (current, broken-by-rules): common.ts deletePool(110), deleteUser(121)
- Read-back: simpleTestRunner getPoolById(143), getPropCards(148),
  getBracketEntries(152), getWinners(156)

`dbService.updatePool` / `updateBracketPool` from the harness are still client
writes to pool docs — they ride the same SUPER_ADMIN allowance and move behind
the 8f guard with the raw writes.

## Sweep 3 — scoreNFLWeek non-idempotent state writes (item 13 rescore-safety inventory)
`grep -n "exemptWeeks\|strikesUsed\|SURVIVOR_AUTO_STRIKE\|SCORE_FINALIZED\|weekly_recaps" functions/src/nflPools.ts` @ 9e6b032
- `:671-672` exemptWeeks: `[...(entry.exemptWeeks||[]), week]` — APPENDS (dup on rerun)
- `:677-680` strikesUsed: `entry.strikesUsed + (strikeLogged?1:0)` — INCREMENTS (dup on rerun)
- `:692` strikesUsed carried into elimination check off mutated value
- `:699` audit `SURVIVOR_AUTO_STRIKE` — emitted per run (dup on rerun)
- `:765` `weekly_recaps/week_{week}` set() — overwrite, idempotent ✓
- `:779` audit `SCORE_FINALIZED` — emitted per run (dup on rerun)
Fix shape: recompute exemptWeeks/strikesUsed from scratch per (poolId, week)
set-semantics; audit writes keyed/deduped per (poolId, week).

## Sweep 4 — UPSET + ATS contract-gap surface (items 14, 18)
UPSET (`grep -rn "'UPSET'" src shared functions/src`):
- `src/components/wizard/create/CreateBracketPool.tsx:44` — wizard offer (REMOVE)
- `shared/schemas/bracket.ts:12` — enum (KEEP for back-compat)
- `functions/src/shared/schemas/bracket.ts:12` — GENERATED copy (do not edit)
- Prod-data audit for `scoringSystem=='UPSET'` pools still pending (item 18).

ATS / pickMode (`grep -rn "pickMode" ...`):
- `shared/schemas/nfl.ts:29` + generated copy — schema accepts ATS
- `src/types/nflPoolTypes.ts:61` — "ATS reserved for V2" comment (stale once implemented)
- `functions/src/nflPoolTypes.ts:64` — type
- `src/components/NFLPoolDashboard/PickemPickEntry.tsx:362` — UI already renders spread when ATS
- `src/components/wizard/create/CreateNFLPickemPool.tsx:62` — default STRAIGHT
- `functions/src/nflScoringEngine.ts` — NO pickMode reference (the gap; item 14)

upsetBonus existing surface (item 18 reuses, does not duplicate):
- Dashboard edit UI exists: `BracketPoolDashboard.tsx:137-138,358,1347` (toggle +
  multiplier, default 5); rules panel `BracketRulesPanel.tsx:42-44`; client
  scorer `BracketPoolDashboard/bracketScoring.ts:100-140`; server scorer
  `functions/src/bracketScoring.ts`. Wizard field should default multiplier 5
  to match the dashboard edit surface.

## Sweep 5 — `nfl_games` blast radius (item 9 data isolation)
Files touching `nfl_games`: `src/components/admin/SuperAdminNFLSpreads.tsx`,
`src/services/dbService.ts`, `src/services/nflStatusService.ts`,
`functions/src/aiCommissioner.ts`, `functions/src/nflPools.ts`,
`functions/src/nflSchedule.ts`, `functions/src/poolExceptions.ts`,
`functions/src/reminders.ts`.
Consequence: synthetic sim games in `nfl_games` are visible to spreads admin,
status service, reminders, and AI commissioner queries unless the sim
namespace is filtered or games live under per-run IDs real queries never match
(season value no real import produces + `sim-<runId>-` IDs). Reminders/status
queries filter by season/week — a synthetic season value keeps sim games out
of their result sets. Verify per-query during item 9 implementation.

## Sweep verdicts folded into the plan
1. Round-4 finding "raw writes to real tournaments doc" is CONFIRMED and worse:
   `mens-2025` is hardcoded twice in bracketE2ESimulator.
2. Guarded-callable API needs THREE write shapes: subcollection entries,
   in-pool-doc entry arrays (playoff/props), tournament docs.
3. scoreNFLWeek idempotency fix has exactly 4 non-idempotent sites (above).
4. Item 18's wizard Upset Bonus control mirrors an existing dashboard edit
   surface — reuse its shape and default (multiplier 5).
