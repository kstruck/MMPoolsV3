# Super-Admin Control — Completeness Sweeps (2026-07-06)

Deterministic grep sweeps to close the enumeration-gap pattern Codex kept surfacing one-at-a-time.
These are the COMPLETE instance lists that feed plan items 0.1, 0.3, 2.1, 2.4, 2.6.

---

## Sweep 1 — Privileged client writes in `src/` (feeds 2.4 + 0.3)

### A. Admin-surface direct writes → must move server-side (Phase 2.4)
| Site | Write | What |
|---|---|---|
| `SuperAdmin.tsx:156` | updateDoc(poolRef, updates) | admin pool settings save |
| `SuperAdmin.tsx:170` | updateDoc(entryRef) | entry paid-status toggle |
| `SuperAdmin.tsx:191` | deleteDoc(entryRef) | entry delete |
| `SuperAdmin.tsx:198` | updateDoc(poolRef,{entryCount}) | **stale-client count — races `FieldValue.increment` in `bracketEntries.ts:96/390`** |
| `SuperAdmin.tsx:229` | updateDoc(entryRef, updates) | entry overrides save |
| `SuperAdmin.tsx:3248` | updateDoc(poolRef, …) | pool write in detail modal |
| `admin/TournamentManager.tsx:211` | updateDoc(tournaments/{id}) | lock-date save |
| `services/dbService.ts:118,135,292,297,337,350` | update/delete pool/entry/propCard | admin service layer (called from above) |

### B. Test/simulator direct writes → route via test-only callables OR confine to emulator (Phase 0.3)
UI-reachable in PROD (the real risk once `sim-` rule closes):
- `TournamentSimulator.tsx:157,178,274,406,410,425` (tournaments + pools + entries + status)
- `utils/testing/tournamentTestUtils.ts:24,51,64` (setDoc/deleteDoc tournaments) — called by TournamentSimulator load paths
- `utils/simulationUtils.ts:53,112,184` (Settings-tab "Simulation Tools", tournaments/2025 + pool squares)

**CORRECTED — ALL simulators are PROD-UI-reachable, not vitest-only.** `SimpleTestingDashboard` ("Run Selected"/"Run All (15)") → `simpleTestRunner.ts` which statically imports and RUNS against real Firestore (`db`/`dbService`): squares (`squaresSimulator`), bracket (`bracketSimulator`), props (`propsSimulator`), playoff (`playoffSimulator`), bracketE2E (`bracketE2ESimulator`). `SimulationDashboard` → `simulationUtils.simulatePoolGame`. So:
- `utils/testing/simulators/bracketE2ESimulator.ts:149,185,207,234,262,334`
- `utils/testing/simulators/bracketSimulator.ts:148,183,212,231`
- `utils/testing/simulators/playoffSimulator.ts:146,194`
- `utils/testing/simulators/propsSimulator.ts:140,160,173`
- `utils/testing/simulators/squaresSimulator.ts` (run via simpleTestRunner:8)
> **HARD DEPENDENCY:** the entire Test Suite creates sim pools/tournaments/entries client-side, which ONLY works because of the `slug ^sim-` rules backdoor. Closing that rule (naive Phase-0) BREAKS THE WHOLE TEST SUITE, not just TournamentSimulator. See revised 0.3 sequencing.

### C. Client telemetry write (feeds 0.3 `logClientError`)
- `services/errorHandler.ts:95` addDoc(system_logs) — the `[ErrorHandler] CRITICAL` path; must repoint to the App-Check-gated `logClientError` callable before locking the rule.

### D. Legit user-flow writes — OUT OF SCOPE (rules-guarded, normal flows)
authService, referralService, emailService, shareTrackingService, AICommissioner, AnnouncementManager, NFL dashboards, BaseRepository, settingsService.

---

## Sweep 2 — Non-bracket `.squares` / `GameState` assumptions (feeds 0.1)

Crash / misrender sites in `SuperAdmin.tsx`:
| Site | Issue | Fix |
|---|---|---|
| `:3786` | `(pool as GameState).squares.filter(...)` — **UNGUARDED**, throws for PROPS/PICKEM/SURVIVOR/MARGIN in card view | per-type render branch |
| `:1413` | matchup `${awayTeam} @${homeTeam}` → "undefined @undefined" for non-squares | `formatPoolMatchup(pool)` |
| `:3772` | matchup `${awayTeam} vs ${homeTeam}` — same, card view | `formatPoolMatchup(pool)` |
| `:328,:1433` | `pool.squares?.filter` — already `?`-guarded (OK, but count is wrong for non-squares) | include in per-type audit |
| `SimulationDashboard.tsx:155,256` (from walkthrough) | `.squares.filter` → the reproduced app-wide crash | `?? []` + SQUARES-only selector |

Correct patterns already present (leave): `:1466` `pool.type==='SQUARES'` guard; `:2731` filter-to-squares.
Common root: everything non-BRACKET is assumed to be a squares `GameState`. NFL season pools (PICKEM/SURVIVOR/MARGIN) and PROPS break this.

---

## Sweep 3 — Duplicated destructive ops across tabs (feeds 2.1 + 2.6)

| Capability | Operations tab | Other surfaces (to remove after replacement) | Gap |
|---|---|---|---|
| `recalculateGlobalStats` | ✅ `OperationsPanel:42` | Members tab `SuperAdmin:1623`; `AdminStatsDashboard:39` | dup — remove Members copy |
| `syncAllUsers` | ✅ `OperationsPanel:51` | Members tab `SuperAdmin:1601` | dup — remove Members copy |
| `fixParticipantIds` | ✅ `OperationsPanel:78/87` (dry+live) | System tab `SuperAdmin:1009` | dup — remove System copy |
| `initializeBig12` | ✅ `OperationsPanel:96` | Tournament banner `SuperAdmin:644`; `TournamentManager:184` | 3 places |
| `initializeBigEast` | ✅ `OperationsPanel:105` | System tab `SuperAdmin:987`; `TournamentManager:183` | 3 places |
| `fixPoolScores` (global) | ❌ **none** | System tab `SuperAdmin:2774` | **add Operations card BEFORE removing** |
| `scoreBracketEntries` | ❌ **none** | Tournament tab `SuperAdmin:666` | **add Operations card BEFORE removing** |
| `importNFLSchedule` | ❌ **none** | NFL Schedule tab `SuperAdmin:1026` | keep in NFL tab OR add Operations card — decide |
| Export Emails | ❌ (not destructive) | System tab `SuperAdmin:2762` | relocate to Members/marketing (2.1) |
| Per-pool `fixPoolScores` | n/a (pool-scoped, stays on pool) | `AdminPanel:427`, `PropsPoolDashboard:160/296`, row `SuperAdmin:961` | OK — pool-scoped, leave |

Missing entirely from Operations (Phase 2.2): **Re-init March Madness** + other pool-type re-inits.
