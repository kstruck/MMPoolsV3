# PLAN-PAYMENT-LEDGER — sweeps

Deterministic greps run 2026-08-15 on `origin/main` @ `3574e54e`. Re-run
before T1 and after T2.

## S1 — Every consumer of `settings.payouts.places` (D1's back-compat surface)

```
grep -rn "payouts?.places\|payouts.places" src functions/src shared --include=*.ts --include=*.tsx | grep -v __tests__ | grep -v "\.test\."
```

| file:line | pool types | reads it as | under D1 |
|---|---|---|---|
| `src/components/PayoutsPanel.tsx:290` | all with `payouts` | places → `dollarFor(pct)` per pot | **T2** — HYBRID/WEEKLY read `weeklyPayouts` for the weekly pot when present, else fall back |
| `src/components/NFLPoolDashboard/RecordPayoutsCard.tsx:62` | NFL | `castPool.payoutSettings?.places \|\| castPool.payouts?.places` — **wrong path** (persisted shape is `settings.payouts.places`) and `p.place ?? idx+1` (field is `rank`) | **T5** replaces the card for NFL; live prefill defect |
| `src/components/JoinPool.tsx:206` | all | `length > 0` gate for the panel | unchanged (season list) |
| `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx:761,777,1363,1367`, `BracketRulesPanel.tsx:49`, `functions/src/bracketScoring.ts:425` | Bracket | season places | untouched (out of scope) |
| `src/components/PlayoffPool/PlayoffPayoutCard.tsx:36-37` | Playoff | season places | untouched |

`weeklyPayouts` today: `grep -rn weeklyPayouts src functions/src shared` → 0. New field.

## S2 — `recordPoolPayouts`: callers and the settlement gate

```
grep -rn "recordPoolPayouts\|POOL_NOT_SETTLED" src functions/src --include=*.ts --include=*.tsx | grep -v __tests__
→ functions/src/payoutRecords.ts:37 (callable), :78 (POOL_NOT_SETTLED — FINAL/COMPLETED/finalizedAt/isFinal only)
  src/services/dbService.ts:1679-1680 (client wrapper)
  src/components/NFLPoolDashboard/RecordPayoutsCard.tsx:102 (the only UI caller)
  src/utils/testing/simulators/nflSeasonSimulator.ts:215 (sim harness — golden path, must keep working)
  functions/src/migrations/backfillProfileData.ts:28 (comment)
```

D4's per-week relaxation touches `:76-79` only; the sim harness call (season
award, no `week`) must still pass the unchanged season gate — assert in the
emulator test.

## S3 — Where `weeklyWinners` is consumed (the ledger reads `weeklyPlaces`, WEEKLY-PRIZES, not this)

```
grep -rln weeklyWinners src functions/src shared | grep -v __tests__
→ functions/src/nflScoringEngine.ts (compute + recap), functions/src/nflPools.ts:1644 (call),
  functions/src/nflPoolTypes.ts + src/types/nflPoolTypes.ts (type, hand-duplicated),
  src/utils/recapHighlight.ts (label gating), src/components/NFLPoolDashboard/NFLPoolDashboard.tsx (render)
```

`weeklyPlaces`: 0 hits — it is WEEKLY-PRIZES §3a's additive recap key and does
not exist yet. **The ledger cannot be built before it does** (R1).

## S4 — Item 5: who imports `HybridSplitFields`

```
grep -rn "HybridSplitFields" src --include=*.tsx | grep import
→ src/components/wizard/create/CreateNFLPickemPool.tsx:11
  src/components/wizard/create/CreateNFLMarginPool.tsx:8
```

Both render it inside their RULES step content (`CreateNFLPickemPool.tsx:68`
after the `payoutMode` select at `:51-56`). D0 moves the render into
`StepFeeAndPayment.tsx` (`src/components/wizard/steps/`), which is shared by
five wizards — so the move must be gated on `payoutMode === 'HYBRID'` (already
is, inside the component at `HybridSplitFields.tsx:22`) AND on the wizard
having a `payoutMode` at all (Bracket/Playoff/Survivor do not; the component
returns null when the mode is not HYBRID, so they are unaffected — assert in
`wizard-invariants`).

## S5 — Payment write paths the ledger must NOT bypass

- `setPaidStatus` (`functions/src/setPaidStatus.ts`) — fee paid; the ONLY
  Member Record money writer. Ledger fee checkbox = today's toggle, unchanged.
- `recordPoolPayouts` — prizes; extended per D4.
- `updateEntryPayment` — Bracket only; `tests/nfl-settings-lockdown.test.ts`
  asserts it does not appear in `NFLManagerView.tsx`. The new ledger component
  must not import it either — extend that assertion to the new file (T5).

## Re-verification

After T2: S1's `PayoutsPanel` row reads both lists; after T5:
`RecordPayoutsCard` is no longer mounted for NFL pools (grep its import in
`NFLManagerView.tsx`).
