# Importer Safety — Completeness Sweeps (2026-08-03)

Deterministic grep sweeps at `0f548bf`, run to close the enumeration-gap
pattern. These are the COMPLETE instance lists that feed
`PLAN-IMPORTER-SAFETY.md` items 1.1, 1.5 and 1.6. Test files excluded
throughout (`grep -v __tests__`).

## Sweep 1 — every `nfl_games` access site (feeds 1.1)

`grep -rn "collection('nfl_games')\|collection(\"nfl_games\")" functions/src
--include="*.ts" | grep -v __tests__` → **30 sites.** Classified:

| Site | Class | Note |
|---|---|---|
| `nflSchedule.ts:364` | **DELETE** (via `deleteBatch.delete`, :373) | **the defect — season-wide, ignores `weeks`** |
| `simHarness.ts:433` | **DELETE** (via `gamesBatch.delete`, :435) | query pinned to `simSeason(runId)` — synthetic seasons only, cannot match a real season |
| `nflSchedule.ts:396` | write (`batch.set(..., {merge:true})`) | the importer's own write — in scope (1.5) |
| `nflSchedule.ts:662`, `:729` | write | sync/deep-sweep path — preserves locks (:746-750), reviewed under PLAN-NFL7 / realtime-scoring |
| `feedReplay.ts:176` | write (`merge:true`) | replay path — preserves locks via `feedReplayDiff.ts:70` |
| `simHarness.ts:287` | write | sim ids only |
| `aiCommissioner.ts:258`, `consensus.ts:46,106`, `expertPicks.ts:94`, `expertProfiles.ts:60,124`, `feedReplay.ts:130`, `migrations/backfillProfileData.ts:73`, `nflAutoScore.ts:111,130,202`, `nflFinalize.ts:151`, `nflLockWatch.ts:71,112`, `nflPools.ts:373,1518`, `nflSchedule.ts:523,574,965`, `poolExceptions.ts:65`, `reminders.ts:847,863`, `winProbability.ts:33` | read | no mutation |

> **Result: `importNFLSeason` is the only deleter that can touch a REAL
> season's documents.** All other writers are `merge: true` or sim-scoped.

## Sweep 2 — every `spread.locked = true` writer (feeds 1.5)

`grep -rn "'spread.locked'\|locked: true" functions/src --include="*.ts" |
grep -v __tests__` → 3 code sites (+1 comment):

| Site | What |
|---|---|
| `nflSchedule.ts:991` | `lockNFLSpreadsJob` — the lock's origin |
| `nflSchedule.ts:746-750` | sync path retains an existing lock on refresh (the #235 fix) |
| `lib/feedReplayDiff.ts:70` | replay path retains an existing lock |

> **Result: the importer write (`nflSchedule.ts:396`) is the ONLY `nfl_games`
> writer with no locked-spread preservation** — the parser it writes from
> emits `locked: false` unconditionally (`nflSchedule.ts:342`). This is plan
> item 1.5.

## Sweep 3 — every pick-reference reader (feeds 1.6)

`grep -rn "picks\[" functions/src --include="*.ts" | grep -v __tests__` →
14 sites. What they key on decides who a game-id re-key strands:

| Keyed by | Sites | Stranded by a re-key? |
|---|---|---|
| **`game.id`** | `nflScoringEngine.ts:108` (Pick'em grading), `shared/consensus.ts:37` (Pick'em branch), `reminders.ts:972` (per-game completeness) | **YES** — pick becomes unreadable |
| week index (values are TEAM ids) | `nflPools.ts:540,570-571,598,626-627,1260`, `nflScoringEngine.ts:241,578`, `shared/consensus.ts:37` (non-Pick'em branch) | No — Survivor/Margin picks reference teams, not game ids |
| bracket slot / sim | `scoring.ts:48`, `shared/simOracle.ts:71` | Not NFL weekly pools |

> **Result: 1.6's refuse-and-report guard must consider Pick'em entries on
> the affected slate; Survivor/Margin entries are structurally immune.**

Pick WRITERS (the paths 1.6's import gate must be checked in — found by
tracing `picks[...] =` assignments and entry `set/update` sites, not just
readers): `submitNFLPicksInternal` (`nflPools.ts`, slate loaded at
`:373-377` before its transaction) and `proxyPick`
(`poolExceptions.ts:316-345`, writes `entry.picks[gameId]` in its own
transaction without calling `submitNFLPicksInternal`). Two paths, both
gated, per codex r7 #3.

## HARD DEPENDENCY carried into the implementing PR

**Mutation-test every guard added from these sweeps and ANCHOR the mutant**
(standing rule): the 0.2 config gate, the 1.2 fail-closed completeness check,
the 1.3 run cap, the 1.5 lock preservation, and the 1.6 reference refusal
each need a mutant that proves its test fails when the guard is removed.
