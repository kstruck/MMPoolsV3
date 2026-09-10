# PLAN-CONFIDENCE-PER-GAME-LOCK — sweeps (grep-derived, complete at the commit named)

Base: `origin/main` @ `59deb790`, measured 2026-09-10 ~09:40 MDT. Re-run every
command before relying on a list; these are snapshots.

## A. Every non-test reader of `lockMode` (what the rule change can reach)

```
grep -rn "lockMode" src shared functions/src --include=*.ts --include=*.tsx | grep -v "__tests__\|\.test\." | grep -v "^functions/src/shared/"
```

| File:line | What it does with it | Disposition |
|---|---|---|
| `shared/nflLockMode.ts:62` | THE rule | T1 rewrite |
| `functions/src/nflPools.ts:626` | submit — hand copy | T2 import |
| `functions/src/nflPools.ts:859`, `:937` | Survivor / Margin weekly lock (`usesWeeklyHardLock(type) \|\| lockMode === 'WEEKLY'`) | unchanged — hard-lock types |
| `functions/src/lib/pickReveal.ts:71` | reveal — hand copy | T2 import |
| `functions/src/poolExceptions.ts:338` | proxyPick Pick'em — hand copy | T2 import |
| `functions/src/poolExceptions.ts:451` | proxyPick Survivor/Margin | unchanged — hard-lock types |
| `functions/src/lib/poolUpdate.ts:111`, `:172-175` | LOCK_AFFECTING list; hard-lock types forced WEEKLY | unchanged (comment at `:106-108` updated) |
| `shared/schemas/nfl.ts:55` | create schema enum | unchanged |
| `functions/src/nflPoolTypes.ts:87`, `src/types/nflPoolTypes.ts:103` | type; the client one carries the stale comment "WEEKLY is forced if confidenceMode is true" | T7 comment |
| `src/components/NFLPoolDashboard/PickemPickEntry.tsx:95`, `:192` | via `nflLockMode` | T6 (comment at `:93-94` stale) |
| `src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx:368-386` | via `nflLockMode` | no change |
| `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:681` | comment only | no change |
| `src/components/NFLPoolDashboard/WeekChecklist.tsx:86-183` | via `nflLockMode` | no change |
| `src/services/nflStatusService.ts:67-72` | via `nflLockMode` | no change |
| `src/utils/nflPending.ts:134-239` | takes the mode as a parameter | no change |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:375`, `:866`, `:1431-1441` | settings form state; forced WEEKLY under confidence | T7 |
| `src/components/NFLPoolDashboard/NFLPoolRules.tsx:122` | label | T7 |
| `src/components/NFLPoolDashboard/NFLPicksGrid.tsx:125-126` | comment only | T7 comment |
| **`src/components/JoinPool.tsx:261`, `:288-292`** | **reads `s.lockMode` DIRECTLY, not via `nflLockMode`, and prints "Weekly (required by Confidence Mode)"** — a seventh copy, not in the plan's §1 list | **T7 — route through `nflLockMode`, drop the confidence clause** |
| `src/components/wizard/create/CreateNFLPickemPool.tsx:40`, `:125` | wizard control + default | T7 copy only |
| `src/help/content/nfl-pickem.ts:40`, `:221-259` | help topic + placements | T7 copy |
| `src/help/content/nfl-shared.ts:28`, `:83`; `pool-pages.ts:138-143`; `coverage-allowlist.ts:112-113` | comments / related links | no change |
| `src/pages/DevDashboardPreview.tsx:138` | fixture | no change |

## B. Every non-test reader of `confidenceMode` outside the T6/T7 files

```
grep -rn "confidenceMode" src shared functions/src --include=*.ts --include=*.tsx | grep -v "__tests__\|\.test\.\|^functions/src/shared/\|^src/help/\|PickemPickEntry\|NFLManagerView"
```

| File:line | Role | Disposition |
|---|---|---|
| `functions/src/nflPools.ts:626`, `:736`, `:771` | lock rule (T2) · validator call (T3) · entry write (unchanged) | T2 / T3 |
| `functions/src/nflScoringEngine.ts:168-174` | scoring — 1 pt vs weight | unchanged (proves §0 "scoring untouched") |
| `functions/src/lib/pickReveal.ts:31`, `:58-71` | type + rule | T2 |
| `functions/src/lib/poolUpdate.ts:106-111` | LOCK_AFFECTING membership | kept; comment updated |
| `functions/src/lib/autoScoreDecisions.ts:191` | settings fingerprint | unchanged |
| `functions/src/poolExceptions.ts:338` | rule | T2 |
| `shared/nflLockMode.ts:33`, `:62`, `:112` | type + rule | T1 |
| `shared/schemas/nfl.ts:54`; `shared/poolTypes.ts:5`; `shared/simOracle.ts:61-85` | schema / comment / sim oracle scoring | unchanged |
| `src/components/JoinPool.tsx:260` | join-page copy | T7 |
| `src/components/NFLPoolDashboard/NFLPoolRules.tsx:121`, `:144`, `:201`, `:210-216` | rules page: lock label (T7), general-rules copy ("Rank each game 1 to N"), tie copy, mode card ("All games must have unique confidence ranks assigned") | `:121` T7; `:216` T7 (D2 changes "all games" to "every game you pick") |
| `src/components/NFLPoolDashboard/NFLPicksGrid.tsx:78`, `:279`, `:358`; `EntryWeekPicks.tsx:68`; `NFLResults.tsx:81-413`; `utils/picksGrid.ts:50-60`; `utils/nflResults.ts:111-307`; `utils/poolTypeLabel.ts:49` | rendering weights / max points / labels | unchanged |
| `src/components/wizard/create/CreateNFLPickemPool.tsx:70`, `:133` | checkbox copy + default | T7 copy |
| `src/types/nflPoolTypes.ts:102-103`; `functions/src/nflPoolTypes.ts:86` | types | comment T7 |
| `src/pages/DevDashboardPreview.tsx:138` | fixture | unchanged |

## C. Every test that pins the OLD rule (must flip with it, not be deleted)

```
grep -rn "confidenceMode" tests functions/src/__tests__ src --include=*.test.ts --include=*.test.tsx | grep -i "weekly\|WEEK\b\|'WEEK'\|WEEK_LOCKED\|force"
```

| Test | Assertion | New assertion |
|---|---|---|
| `tests/nfl-lockmode-invariants.test.ts:41` | confidence + PER_GAME → WEEKLY | → PER_GAME |
| `tests/nfl-lockmode-invariants.test.ts:111-139` | the literal expression is PRESENT in 3 server files | the literal is ABSENT and `nflLockMode(` is imported/used in each |
| `tests/help-content-nfl-pickem.test.ts:228-229` | same rule assertion, quoting the help copy | flip with the copy |
| `functions/src/__tests__/pickReveal.test.ts:44-45` | confidence → 'WEEK' | confidence + PER_GAME → 'PER_GAME'; confidence + WEEKLY → 'WEEK' |
| `functions/src/__tests__/poolUpdate.test.ts:234-237` | `confidenceMode` ∈ LOCK_AFFECTING "because it converts to weekly" | membership kept; reason text updated |
| `functions/src/__tests__/emulator/hofDressRehearsal.emulator.test.ts:245-280` | confidence pool seeded `lockMode: 'WEEKLY'` | unchanged — explicit WEEKLY |
| `functions/src/__tests__/emulator/settingsMatrix.emulator.test.ts:118-138` | confidence cells | check seeded `lockMode`; if absent, the cell now plays PER_GAME — verify the matrix still passes or seed WEEKLY explicitly |
| `src/__tests__/helpRoutePublish.test.tsx:250` | settings readout | unchanged |

Emulator fixtures seeding `confidenceMode: true` (any lock assumptions?):

```
grep -rln "confidenceMode: true" functions/src/__tests__
```
→ `hofDressRehearsal` (WEEKLY explicit), `settingsMatrix` (check), `nflAutoScore.test.ts`, `pickReveal.test.ts`, `simGenOracle.test.ts` (unit; no lock).

## D. Every caller of `validateConfidenceValues`

```
grep -rn "validateConfidenceValues" functions/src src shared --include=*.ts --include=*.tsx | grep -v "^functions/src/shared/"
```

| Site | Disposition |
|---|---|
| `functions/src/nflPools.ts:737` (WEEKLY branch) | unchanged |
| `functions/src/nflScoringEngine.ts:188` (definition) | unchanged; `validatePerGameConfidence` added beside it |
| `functions/src/__tests__/emulator/hofDressRehearsal.emulator.test.ts:225` (comment) | — |
| `src/help/content/nfl-pickem.ts:64` (comment), `src/utils/nflResults.ts:101` (comment) | — |

## E. Every user-facing string that says confidence forces weekly

```
grep -rln -i "forced weekly\|forces weekly\|force weekly\|strictly weekly\|locks the whole week\|whole week at one deadline\|required by Confidence Mode" src tests functions/src CONTEXT.md
```

| Location | String | Disposition |
|---|---|---|
| `src/help/content/nfl-pickem.ts:46` | "Confidence points force weekly whatever this says…" | rewrite |
| `src/help/content/nfl-pickem.ts:63` | "Turning it on also locks the whole week at one deadline…" | rewrite: per-game lock of pick+weight; missed game forfeits the highest weight |
| `src/help/glossary.ts:269` | "In confidence mode, weekly-lock mode, survivor and margin, the whole week reveals…" | drop "confidence mode" |
| `src/components/NFLPoolDashboard/NFLPoolRules.tsx:121` | 'Strictly Weekly' | derive from `nflLockMode` |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:1441` | "* Forced Weekly in Confidence Mode" | replace |
| `src/components/wizard/create/CreateNFLPickemPool.tsx:70` | "(rank picks; forces weekly lock)" | "(rank picks)" |
| `src/components/JoinPool.tsx:290` | 'Weekly (required by Confidence Mode)' | derive from `nflLockMode` |
| `CONTEXT.md:149` | "Pick'em in confidence or weekly-lock mode, Survivor, Margin → the whole WEEK" | drop "confidence or" |
| `src/types/nflPoolTypes.ts:103` | comment "WEEKLY is forced if confidenceMode is true" | delete |
| `shared/nflLockMode.ts:3-17`, `:41-56`; `functions/src/lib/pickReveal.ts:55-66`; `functions/src/lib/poolUpdate.ts:106-108`; `src/components/NFLPoolDashboard/PickemPickEntry.tsx:93-94`, `:262-267`, `:436-438`; `NFLPicksGrid.tsx:123-127`; `src/help/content/nfl-pickem.ts:32`, `:96` | code comments restating the old rule | update in the ticket that touches the file |

## F. Readers of the weekly tiebreaker prediction (D3 scope)

```
grep -rn "tiebreakerPrediction\|weeklyTiebreakers" functions/src --include=*.ts | grep -v "__tests__\|^functions/src/shared/"
```

| Site | Disposition |
|---|---|
| `functions/src/nflPools.ts:441-446` (payload), `:772-775` (write) | T4 adds the lock check between them, PER_GAME branch only |
| scorer / `computeWeeklyWinners` readers of `weeklyTiebreakers[week]` | unchanged |

## G. Backfill wiring precedent (T5 must mirror every row)

| Piece | Precedent |
|---|---|
| Handler | `functions/src/migrations/backfillPublishedWeeks.ts` |
| Schema | `functions/src/schemas/migrations.ts:66-75` (`dryRun` default TRUE at schema layer, `limit ≤ 200`, null-as-first-page `startAfter`) |
| Export | `functions/src/index.ts:133` |
| Panel runner + dry/live cards | `src/components/admin/OperationsPanel.tsx:211-228`, `:413-431` |
| Tests that pin the shape | `functions/src/__tests__/sweepBatch17Schema.test.ts:70-74` (null cursor), `tests/ops-panel-report-coverage.test.ts` (counters derived from source — the new report's numeric counters must all be aggregated by the runner) |
| Audit | `writeAdminAudit({ action: 'BACKFILL_CONFIDENCE_LOCK_MODE', … })` |
