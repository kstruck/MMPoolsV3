# SWEEPS — PLAN-SURVIVOR-PARITY-SCORING

Deterministic grep-built COMPLETE instance lists. Commands are reproducible from repo root; run them again before implementation if the branch has moved.

## S1 — every reader/writer of `usedTeams`

Command: `grep -rn 'usedTeams' --include=*.ts --include=*.tsx src functions/src shared`

| Site | Role | Change required |
|---|---|---|
| `functions/src/nflPools.ts:572-579` | Survivor submit reuse guard | **YES** — authority moves to counting `picks` map vs `maxTeamUses` |
| `functions/src/nflPools.ts:608` | Survivor submit `usedTeams` write | **YES — CORRECTED r2 #2** (first pass said "no change"): remove-then-re-add breaks under reuse; when `maxTeamUses ≠ 1` derive `usedTeams` from `values(nextPicks)`; absent/1 keeps today's rewrite |
| `functions/src/nflPools.ts:554,624` | Entry init `usedTeams: []` | No |
| `functions/src/nflPools.ts:641,666` | **Margin** twin guard + write | **NO — explicitly out of scope** (named in plan) |
| `functions/src/nflPools.ts:1420` | Comment (leak rationale) | No |
| `functions/src/poolExceptions.ts:~409-421` (`proxyPick`) | **Third reuse guard** — commissioner proxy path has its own `usedTeams.includes(teamPicked)` + rewrite | **YES — found by this sweep, missed by the plan draft.** Must use the same counting helper or a commissioner proxy pick rejects a legal reuse the member could submit themselves |
| `functions/src/nflScoringEngine.ts:343,359` (`checkAutoSurviveExemption`) | Exemption eligibility filter | **YES** — eligibility becomes `useCount(t) < maxTeamUses` (0 = unlimited ⇒ never exempt via reuse-exhaustion) |
| `functions/src/nflScoringEngine.ts:529` | Exemption caller in `computeSurvivorWeekUpdate` | **YES** — pass picks/count map |
| `src/components/NFLPoolDashboard/SurvivorPickEntry.tsx:63,65,105,118,319,320` | Client advisory gating + used badges | **YES** — per-team use counts |
| `src/components/NFLPoolDashboard/MarginPickEntry.tsx:58,60,91,105,275,276` | Margin client gating | NO — out of scope |
| `src/types/nflPoolTypes.ts:220,234` / `functions/src/nflPoolTypes.ts:216,237` | Type + comment | Comment update: "set of teams ever picked (derived; guard counts `picks`)" |
| `shared/simGen.ts:133` + `functions/src/shared/simGen.ts:133` | Sim pick generator avoids used teams | No — staying conservative (never reusing) remains valid under every `maxTeamUses` |
| `src/utils/testing/scenarios/index.ts:209`, `nflSeasonSimulator.ts:330` | Test seeding | No |
| Tests touching usedTeams (12 files): `autoScore`, `fixtureMatrix`, `goldenArc`, `hofChaosDrill`, `hofDressRehearsal`, `memberRecord`, `phase3Arc`, `resubmitSameTeam`, `scenarioRunner`, `settingsMatrix` (emulator), `perPickResults`, `survivorRescore` | Existing coverage | Extend `survivorRescore` + `resubmitSameTeam` for the two new settings; others assert default behavior which is unchanged |

## S2 — every site encoding survivor tie semantics

Command: `grep -rn 'teamTied|tie counts|tied' --include=*.ts --include=*.tsx src functions/src shared | grep -iv tiebreak`

**CORRECTED in review round 1 — two sites, not one.** The first pass called `simOracle.ts` "pick'em only" off its header comment; codex r1 #5 disproved it: `shared/simOracle.ts:96-117` (mirrored at `functions/src/shared/simOracle.ts`) independently hard-codes tie=strike for survivor in BOTH modes, and `settingsMatrix.emulator.test.ts:151-173` uses it for survivor expected results.

| Site | Change |
|---|---|
| `functions/src/nflScoringEngine.ts:292-310` (`evaluateSurvivorWeek`) | **YES** — the engine branch |
| `shared/simOracle.ts:96-117` (+ `functions/src/shared/simOracle.ts` mirror) | **YES** — extend oracle with `tieCountsAs`, keep it independent of the engine |
| `src/components/NFLPoolDashboard/SurvivorPickEntry.tsx:293-295` (rules copy) | **YES — CORRECTED r3 #1** (second S2 miss): copy claims ties survive in both modes — wrong against today's engine, wrong for half the new matrix. Derive from `tieCountsAs × pickLosersMode` |
| `src/components/NFLPoolDashboard/NFLPoolRules.tsx:224` (Rules page) | **YES — CORRECTED r4 #3** (third S2 miss): states a team can never be selected twice; must render effective reuse limit + tie outcome |
| `docs/NFL_POOLS_README.md:12,30,52-59` | **YES — CORRECTED r4 #3**: asserts tie=strike + single-use; document the new settings and defaults |

Other matches are bracket tiebreakers or prose. Lesson: grep by semantics-bearing identifiers (`teamTied`, `strike`), not prose words — the oracle's tie logic doesn't say "tied".

## S3 — every validator/allowlist that must admit the new fields

| Site | Finding | Change |
|---|---|---|
| `shared/schemas/nfl.ts:38` `survivorCreateInputSchema.settings` | `z.object` **strips unknown keys** — without adding the fields, the wizard would silently drop them at create | **YES — mandatory** |
| `functions/src/schemas/poolCore.ts:22` `updatePoolSettingsSchema` | `updates: z.record(z.string(), z.unknown())` — permissive, passes new fields | No schema change; verify handler's protected-field filter (`poolOps.ts:45`) doesn't block them (it lists identity fields only) |
| `src/components/wizard/create/buildNFLPayload.ts:43-48` | Spreads `v.settings` through | No change; fields flow once schema admits them |

## S4 — client copies of survivor evaluation logic

Command: `grep -rln 'evaluateSurvivorWeek|strikeLogged' src/`

**None.** The engine lives only in `functions/src/nflScoringEngine.ts`; client renders persisted results. Sim/e2e arcs exercise the real engine via emulator.

## Corrections fed back into the plan

1. `proxyPick` guard added to Phase 2 (S1). Shared helper `countTeamUses(picks, excludeWeek)` used by both guards — one definition, per the PR #384 lesson already cited in the code.
2. S3 confirms `updatePoolSettingsSchema` needs nothing; plan's Phase 3 item downgraded to a verify.
