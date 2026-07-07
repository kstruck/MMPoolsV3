# Test Suite — parked bugs (from live "Run All 15", 2026-07-07)

Context: live Test Suite run surfaced 2 pass / 8 fail / 5 error. None caused by the
Phase-0 crash-fix deploy (proven: the "Full 2025 E2E" bracket sim passes — creates
+ scores entries — under the same deployed rules, so entry writes work).

## ✅ Fixed — PR #141 (`fix/pool-schema-drift`), needs functions deploy
Schema drift rejecting valid create payloads:
- `shared/schemas/squares.ts` gameId `.optional()` → `.nullish()` (rejected explicit null).
  Fixes: Basic Quarters, Every Score Wins, Partial Fill.
- `shared/schemas/bracket.ts` scoringSystem enum missing ESPN/FIBONACCI (engine
  implements both, `functions/src/bracketScoring.ts:71-72`) → union of all 5.
  Fixes: Bracket Fibonacci Scoring, Bracket ESPN Scoring.

## ⛔ Parked — pre-existing sim/scoring bugs (NOT deploy-blocking)

### 1. bracketSimulator writes 0 entries (biggest cluster — 6 tests)
Fails: Bracket Basic, Custom Scoring, Max Possible Score, Tiebreaker Resolution,
Incomplete Picks, Zero Correct Picks. Pool creates + reaches COMPLETED, but the
sim's entry write yields 0 entries → every scoring assertion reads 0.
- Site: `src/utils/testing/simulators/bracketSimulator.ts:166-190` (addDoc to
  `pools/{poolId}/entries` with fake ownerUid `test-user-<name>`, wrapped in a
  try/catch that swallows the error into an "Entry Error" step).
- Localized to bracketSimulator specifically — `bracketE2ESimulator` uses a
  different path and passes. So it's NOT the entries firestore rule (isSuperAdmin
  allows it; E2E proves writes work). Investigate why the addDoc silently fails /
  the read-back finds 0 (timing? pool slug? entry shape? the swallowed errMsg).
- Next step: instrument the swallowed `errMsg`, or reproduce the exact addDoc live
  and capture the error.

### 2. Props Basic — off-by-one scoring (1 test)
"Top score should be 5 (2+1+1+1), got 6". `propsSimulator` / props scoring adds an
extra point somewhere.

### 3. Playoff Basic — wrong winner (1 test)
"Alice should win (ranked KC #1), got Carol". Playoff ranking/scoring tiebreak bug
in `playoffSimulator` or the playoff scoring engine.

### 4. UPSET scoring offered but unimplemented (separate contract gap)
`src/components/wizard/create/CreateBracketPool.tsx:32` offers "Upset bonus"
(UPSET) but `functions/src/bracketScoring.ts` has no UPSET branch → scores as
CLASSIC silently. Product/engine decision: implement UPSET, or drop it from the
wizard.

## Also flagged (not test-suite): more scenarios needed
No NFL Pick'em / Survivor / Margin scenarios exist yet — the segmented Test Suite
groups render only once scenarios + simulator support are authored.
