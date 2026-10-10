# Test Suite — backlog (RESOLVED 2026-07-07: suite 15/15)

Every item from the original "Run All 15" backlog is closed. History + root
causes, for archaeology:

## ✅ Schema drift (5 create errors) — PR #141, deployed 2026-07-07
- `shared/schemas/squares.ts` gameId → `.nullish()`; `shared/schemas/bracket.ts`
  scoringSystem enum gained ESPN/FIBONACCI.

## ✅ bracketSimulator "0 entries" cluster (8 tests) — PR #148 + #149
NOT an entry-write/rules problem. `simpleTestRunner`'s bracket mapping renamed
the scenarios' `tiebreakerPrediction` field to `tiebreaker`; bracketSimulator
read `entry.tiebreakerPrediction` = undefined; Firestore `addDoc` rejects any
document containing an undefined field → every entry write failed (swallowed
into an unrendered step). PR #148 made the dashboard render failed simulator
steps (the diagnostic); PR #149 fixed the mapping, made the simulator strip
undefined fields, and added scenario data-contract tests.

## ✅ Props Basic off-by-one — PR #146
Scenario bug: `props-basic.json` gave q4 two points while its own assertion
message said "2+1+1+1". Engine was correct.

## ✅ Playoff Basic wrong winner — PR #146
Scenario bug: Rank'Em awards `rankings[team] × round multiplier` (higher value
= more points); Carol legitimately beat Alice. Engine and docs agreed all along.

## ✅ Bracket E2E flaky winner — PR #146
The 'AllChalk' control entry duplicated PerfectBracket's picks AND its exact
tiebreaker (128) — winner came down to unstable sort order. Controls are now
seed-based; AllChalk tiebreaker 130; regression tests added.

## ✅ (discovered) Squares $0 payouts — PR #147, real product bug
`payouts` is a stripped privileged create field and the post-buyflow wizard
collects none → every new squares pool paid $0/period. createPool now seeds
DEFAULT_SQUARES_PAYOUTS (25/25/25/25). OPEN follow-up: pre-fix wizard-created
squares pools in prod still lack a payouts map (Rule-1 gated backfill decision).

## ⏭ UPSET scoring gap — plan item 18 (Phase 3, March runway)
Wizard still offers UPSET as a scoringSystem with no engine branch. Decision on
record (PLAN-TEST-SUITE.md): retire UPSET, expose Upset Bonus toggle+multiplier.

## Next
NFL scenario coverage (Pick'em / Survivor / Margin) per PLAN-TEST-SUITE.md
Phase 2 — items 8-16, including the submitNFLPicks membership gate, seasonType
through the create path, dual-MNF combined-score fix + scoreNFLWeek
idempotency, and ATS scoring (decided: implement).
