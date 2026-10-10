# PLAN-WEEKLY-PRIZES — SWEEPS

Deterministic enumeration feeding `PLAN-WEEKLY-PRIZES.md` §8 ("complete instance
lists for `MNF_COMBINED`, `weeklyTiebreaker`, `WEEKLY_TIEBREAKER_VALUES`,
`showTiebreaker`, `payouts.places`"). Run from the repo root. Every sweep states
its command, a **known instance it must find** (a sweep that finds nothing is
worthless until it has proved it can find something), and the complete result as
of **2026-08-16, `origin/main` @ `42906ecc`** (post-#450), worktree
`weekly-prizes`.

`functions/src/shared/` is a build-time copy of `shared/` and is excluded from
every sweep — it is not a second instance, it is the same file.

Baseline command used for every sweep:

```bash
grep -rnE "<pattern>" src functions/src shared firestore.rules tests \
  | grep -v 'functions/src/shared'
```

---

## S1 — `MNF_COMBINED` (45 hits): every place the legacy value is named

**Must find:** `shared/nflTiebreaker.ts:38` — the resolver's fallback. If it does
not, the grep is wrong.

Classification for B1 (§0/§2a: MNF_COMBINED becomes **unpickable, still
honoured**):

| Class | Instances | B1 action |
|---|---|---|
| **Resolver / type / value list** | `shared/nflTiebreaker.ts:16` (type), `:18` (`WEEKLY_TIEBREAKER_VALUES`), `:21`, `:38` (fallback) | Type and value list KEEP the value (legacy). Add `MNF_FIRST_GAME`. Fallback for absent stays `MNF_COMBINED` (D1). |
| **Scorer** | `functions/src/nflScoringEngine.ts:490,494,511,517` (`computeMNFTiebreakerTotal` default + branch) | Keep the branch. Add `MNF_FIRST_GAME` mirror + Monday-less fallback (§2b) + frozen-target list path. |
| **Copy** | `shared/nflTiebreaker.ts:54` (`tiebreakerCopy`), `tests/weekly-tiebreaker-contract.test.ts:70-71` (pins the "both" wording) | Keep the legacy copy block; add copy for `MNF_FIRST_GAME`, and the "final game of the week" phrasing for Monday-less weeks. |
| **Pickable lists (UI)** — MUST LOSE the option | `src/components/wizard/create/CreateNFLPickemPool.tsx:75` (wizard option), `:141` (wizard DEFAULT `'MNF_COMBINED'`), `src/components/NFLPoolDashboard/NFLManagerView.tsx:1063` (manager `<option>`), `:183-184` (state seeded from the resolved value) | Wizard default → `MNF_LAST_GAME`; remove the option from both lists; manager select must still RENDER a legacy pool's stored `MNF_COMBINED` (disabled option or read-only line) so an unchanged save is not a change. |
| **Update gate** | `functions/src/lib/weeklyTiebreakerGate.ts:20,49,118,132-141` + `functions/src/__tests__/weeklyTiebreakerGate.test.ts:67-134` | Gate validates against `WEEKLY_TIEBREAKER_VALUES` — must accept `MNF_FIRST_GAME`; the "undefined -> MNF_COMBINED is not a change" test stays true under D1. |
| **Read-only consumers (resolve, never raw)** | `src/components/NFLPoolDashboard/PickemPickEntry.tsx:366-369,660`, `NFLPoolRules.tsx:132`, `NFLStandings.tsx:74`, `functions/src/nflPools.ts:1349-1353`, `functions/src/nflPoolTypes.ts:91-95`, `src/types/nflPoolTypes.ts:96-101` | Unchanged — they call `effectiveWeeklyTiebreaker`. |
| **Tests pinning the default** | `functions/src/__tests__/weeklyWinners.test.ts:135-173`, `tests/weekly-tiebreaker-contract.test.ts:28-57` | Stay green under D1 (absent ⇒ combined). New cases for `MNF_FIRST_GAME`, Monday-less fallback, frozen list. |

## S2 — `weeklyTiebreaker` (39 hits): who reads or writes the setting

**Must find:** `firestore.rules:348` (`callableOnlySettingsUnchanged`). Found.

| Instance | Role |
|---|---|
| `firestore.rules:317,348` | Client may not write it directly — callable-only key. **Unchanged.** |
| `shared/schemas/nfl.ts:53` | create schema `z.enum(WEEKLY_TIEBREAKER_VALUES).optional()` — becomes NON-optional-in-practice for new pools: the wizard sends `MNF_LAST_GAME` explicitly (D1); schema stays optional so legacy payloads still parse. |
| `functions/src/lib/weeklyTiebreakerGate.ts:38,55-56,85,144-164` | update gate — new value accepted; freeze-with-submissions rule unchanged. |
| `functions/src/nflPools.ts:1349-1353` | scorer resolves the rule → now ALSO reads `pool.frozenTiebreakTargets[week]` first (§2b). |
| `src/components/wizard/create/CreateNFLPickemPool.tsx:72,141` | wizard field + default. **Only Pick'em has the field** — Margin's wizard has no `weeklyTiebreaker` (Margin ties break by its own cascade). |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:184,494,1059` | manager select + save. |
| `tests/nfl-settings-lockdown.test.ts:206` | lockdown key list — unchanged. |
| `tests/weekly-tiebreaker-contract.test.ts:*` | contract suite — extend for the new value. |
| types: `functions/src/nflPoolTypes.ts:95`, `src/types/nflPoolTypes.ts:101` | hand-duplicated type — both must gain `MNF_FIRST_GAME` (the contract test at `:155` checks both files). |

## S3 — `WEEKLY_TIEBREAKER_VALUES` (9 hits): the enumerations that must grow

`shared/nflTiebreaker.ts:18` (definition) · `shared/schemas/nfl.ts:6,53` ·
`functions/src/lib/weeklyTiebreakerGate.ts:34,141,146` ·
`tests/weekly-tiebreaker-contract.test.ts:8,38` (`it.each` over the values —
auto-extends) · `functions/src/__tests__/weeklyTiebreakerGate.test.ts` (indirect).

**One definition; every consumer imports it.** Adding `MNF_FIRST_GAME` in one
place is sufficient for validation; the two hand-duplicated `WeeklyTiebreaker`
types (S2) are the only manual mirrors.

## S4 — `showTiebreaker` (8 hits): the gate that must stop requiring `isMonday`

`src/components/NFLPoolDashboard/PickemPickEntry.tsx:329,374,654` — the memo
that decides whether the prediction input renders. **§2b(1): must be true
whenever `tiebreakerAsksForPrediction(rule)` and the week has any game**, not
only when a Monday game exists. `NFLStandings.tsx:75,232,346`
(`showTiebreakerColumn`) is rule-driven already and needs no change.
`tests/weekly-tiebreaker-contract.test.ts:143-144` pins the standings column.

## S5 — `payouts.places` (11 hits): every consumer of the payout list

**Must find:** `src/components/PayoutsPanel.tsx:290`. Found.

| Instance | Reads | Affected by this plan? |
|---|---|---|
| `src/components/PayoutsPanel.tsx:290` | `payouts.places` filtered `percentage > 0`, then `dollarFor(pct)` per pot | **Yes** — the weekly pot maths must match it (§3b charityFactor + floor); shares `shared/prizePot.ts` (LEDGER T3). |
| `src/components/NFLPoolDashboard/RecordPayoutsCard.tsx:62` | `payoutSettings?.places \|\| payouts?.places` — wrong path (live prefill defect, LEDGER §1) | Replaced by the ledger (LEDGER T5), not touched here. |
| `functions/src/bracketScoring.ts:425` | Bracket season awards | Unaffected (Bracket has no weekly prize). |
| `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx:761,777,1363,1367`, `BracketRulesPanel.tsx:49`, `PlayoffPool/PlayoffPayoutCard.tsx:36-37`, `JoinPool.tsx:206` | display | Unaffected. |

Persisted shape everywhere is `{ rank, percentage }` (`shared/schemas/common.ts`
`payoutPlaceSchema`) — `splitPrizes` (§4b) takes it verbatim; **no consumer uses a
`place` key** except `RecordPayoutsCard.tsx:73` (`p.place ?? idx+1`), which is
the defect noted above.

## S6 — `weeklyWinners` (26 hits): the recap key that stays as-is

Writers: `functions/src/nflPools.ts:1726-1729` (`computeWeeklyWinners` → recap
param), `functions/src/nflScoringEngine.ts:895-912` (`buildWeeklyRecap` omits the
key when empty — the "omit, never `undefined`" convention §3a copies for
`weeklyPlaces`). Readers: `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:1001-1018`,
`src/utils/recapHighlight.ts:34` (+ tests). Types: `functions/src/nflPoolTypes.ts:310`,
`src/types/nflPoolTypes.ts:328` (hand-duplicated; `tests/weekly-tiebreaker-contract.test.ts:159-161`
pins both). **`weeklyPlaces` is added beside it in both type files; nothing here changes.**

## S7 — `poolSeasonWeeks` (15 hits): the client weeks helper — DEPENDENCY RESOLVED

`src/utils/nflPending.ts:75` exists on `main` (#427 merged) with tests at
`src/utils/nflPending.test.ts:146-162`; consumers `NFLPoolDashboard.tsx:228`,
`NFLResults.tsx:86`, `NFLWeeklyPicksGrid.tsx:66`. §3b's "DEPENDENCY, not an
existing fact" paragraph is now satisfied for the CLIENT. **The server still has
no equivalent** — `grep -rn "weeksInSeason\|poolSeasonWeeks" functions/src` = 0
hits — so the server helper in §3b is new code.

## S8 — negative sweeps (0 hits each, must stay 0 until this plan builds them)

`weeksInSeason` · `frozenTiebreakTargets` · `prizeSplit` · `weeklyPlaces` ·
`charityFactor` — none exist anywhere. Anything that appears under these names
was written by this plan's PRs.

## S9 — `hybridSplit` (60 hits) — read but not changed

The weekly pot formula (§3b) READS `settings.hybridSplit.weeklyPerEntry`. Its
validation lives at `shared/schemas/nfl.ts:28-31`, `functions/src/lib/hybridSplitGate.ts`,
`firestore.rules:348`, and `PayoutsPanel.tsx` (#423). None of it moves in this
plan; LEDGER T0 relocates only the wizard control.

---

## S10 — entry identity (added 2026-08-16, plan §9 A1): what keys a weekly winner today

```bash
grep -rn "WeeklyWinnerCandidate\|winnerCandidates.push" functions/src --include=*.ts | grep -v functions/src/shared
```

**Must find:** `functions/src/nflPools.ts:1587` (`userId: entry.ownerUid`). Found.

| Instance | Key today | A1 action |
|---|---|---|
| `functions/src/nflScoringEngine.ts:545` (`WeeklyWinnerCandidate`), `:591` (`computeWeeklyWinners`), `:608` (`toWinner`) | `userId` | Add `entryId`; `weeklyWinners` keeps `userId`+`userName` (unchanged shape) and gains `entryId` |
| `functions/src/nflPools.ts:1347,1432,1587` (candidates pushed from `entries/{docId}`) | `userId: entry.ownerUid` | Push `entryId: entryDoc.id` |
| `functions/src/__tests__/weeklyWinners.test.ts:24` (fixture) | `userId` | Fixture gains `entryId`; add a two-entries-one-owner case (the known multi-entry fixture the sweep must keep finding) |
| `shared/payoutRecords.ts` (`entryId?` on a Payout Record) | `entryId` already in the contract | Ledger binds on it — no change here |

Nothing else keys a weekly result: `weeklyPoints`/`weeklyResults` are stored ON
the entry document (`nflPoolTypes.ts`), so they are entry-keyed by construction.

## S11 — every submit path that must carry `displayedTiebreakTargetIds` (plan §9 A6)

```bash
grep -rln "submitNFLPicks\b" src functions/src shared tests --include=*.ts --include=*.tsx | grep -v functions/src/shared
```

**Must find:** `functions/src/schemas/poolCore.ts` (the strict schema). Found.

| Class | Files | A6 action |
|---|---|---|
| **Contract** | `functions/src/schemas/poolCore.ts:29-50` (`submitNFLPicksSchema`, strict — an unknown key is REFUSED, so the field must be added here first), `functions/src/nflPools.ts:382-387` (internal payload type + destructure), `functions/src/index.ts` (export) | add optional `displayedTiebreakTargetIds` |
| **Client caller** | `src/services/dbService.ts:1488` | add to the arg type + pass-through |
| **UI that renders the sheet** | `src/components/NFLPoolDashboard/PickemPickEntry.tsx` (the only sheet that asks a prediction — Margin/Survivor have no tiebreaker input; they send nothing and A6 says nothing is accepted when a frozen target exists or the rule asks nothing) | send the ids of the game(s) the sheet displayed |
| **Proxy / rebuy** | `functions/src/nflPools.ts` proxyPick path (`entryIndex` added in T2), `functions/src/lib/multiEntry.ts` | proxy sends no list → accepted only when frozen (A6 last clause) |
| **Sim / harness** | `functions/src/simHarness.ts`, `shared/simGen.ts`, `functions/src/__tests__/emulator/*.emulator.test.ts` (6 files), `functions/src/__tests__/nflPickMembership.test.ts`, `spreadGateScope.test.ts`, `tests/spread-gate-parity.test.ts` | unchanged — the field is optional and an absent list freezes the CANONICAL target (A6), so every existing caller keeps working; add ONE emulator case that sends a stale list and expects `TIEBREAK_TARGET_STALE` |
| **Non-callers that match the grep** | `lib/autoScoreDecisions.ts`, `lib/effectiveLock.ts`, `lib/entryRevision.ts`, `lib/nflLockWatch.ts`, `lib/scoringLease.ts`, `nflLockWatch.ts`, `poolExceptions.ts`, `reminders.ts`, `shared/multiEntry.ts`, `shared/schemas/nfl.ts`, `shared/survivorReuse.ts`, `MarginPickEntry.tsx`, `SurvivorPickEntry.tsx`, `CreateNFLPickemPool.tsx`, `tests/wizard-invariants.test.ts` | mention the name in comments/error codes only — unaffected |
