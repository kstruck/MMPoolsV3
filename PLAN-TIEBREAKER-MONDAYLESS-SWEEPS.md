# PLAN-TIEBREAKER-MONDAYLESS — sweeps

Deterministic instance lists for the two things
[PLAN-TIEBREAKER-MONDAYLESS.md](PLAN-TIEBREAKER-MONDAYLESS.md) claims to cover.
Built by grep at `origin/main` `a85c6fbf`, re-run after implementation.

Commands are given so a later session can re-derive rather than trust this.

---

## Sweep 1 — every site that hand-rolls `frozen ?? resolved` (D1)

```
grep -rn "resolveTiebreakTargetIds\|frozenTiebreakTargetFor" \
  --include=*.ts --include=*.tsx . \
  | grep -v node_modules | grep -v "functions/src/shared/"
```

`functions/src/shared/` is excluded because it is gitignored
(`functions/.gitignore:3`) and regenerated verbatim by
`functions/scripts/copy-shared.mjs`. It is a copy, not a site.

| # | Site | Before | After |
|---|---|---|---|
| 1 | `src/components/NFLPoolDashboard/PickemPickEntry.tsx` (the sheet) | `frozenTiebreakTargetFor(...) ?? resolveTiebreakTargetIds(...)` | `weekTiebreakTargetIds(castPool, week, games, tiebreakerRule)` |
| 2 | `functions/src/nflPools.ts` (the submit path) | `frozenTarget ?? canonicalTarget` | `applyFrozenTarget(frozenTarget, games, tiebreakRule)` |
| 3 | `functions/src/nflScoringEngine.ts` (`computeMNFTiebreakerTotal`) | `frozenTargetIds !== undefined ? frozenTargetIds : resolveTiebreakTargetIds(...)` | `applyFrozenTarget(frozenTargetIds, games, rule)` |

**Three, and only three.** Three different spellings of one rule, and all three
had to independently get right that an EMPTY frozen list is a real state rather
than absence — `[]` is not nullish, so the two `??` sites were correct by
accident of the operator they reached for.

### Sites that survived the sweep and are NOT changed

| Site | Why it stays |
|---|---|
| `functions/src/nflPools.ts` (submit path, `frozenTarget`) | Answers "does a freeze EXIST?", the only input to the write decision. A different question from "what is this week's target". Fusing them would hide it. |
| `functions/src/nflPools.ts:1539` (`scoreNFLWeek`) | Already reads `frozenTiebreakTargetFor` and hands the list to `computeMNFTiebreakerTotal`, which now applies the shared precedence internally. No hand-rolled `??` here. |
| `computeMNFTiebreakerTotal`'s `frozenTargetIds` parameter | Kept. It is a pure schedule-and-list function with twenty-plus unit tests calling it directly; a `pool` parameter would be a signature change with no correctness gain. It routes precedence through `applyFrozenTarget`, so there is still ONE definition. |
| `src/components/NFLPoolDashboard/NFLStandings.tsx:95` | Asks a POOL-level question. `tiebreakerAsksForPrediction` is the right predicate. |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:1139` | Same. |

---

## Sweep 2 — every surface that states the Monday-less behaviour (A, copy)

```
grep -rn "no Monday game\|Monday game\|Monday total\|MNF" \
  --include=*.ts --include=*.tsx src/ shared/ functions/src/ \
  | grep -v "functions/src/shared/"
```

51 hits. After discarding unrelated MNF mentions (Squares marketing copy,
`weeklyTiebreakers` the entry-prediction field, comments about the standings
column), the sites that ASSERT what happens on a Monday-less week are:

| # | Site | Verdict | Action |
|---|---|---|---|
| 1 | `shared/nflTiebreaker.ts` — `resolveTiebreakTargetIds` doc block | **WRONG after A** — "Deliberately NO fallback" | Rewritten; now explains why the §0 invariant is upheld by the freeze instead. |
| 2 | `shared/nflTiebreaker.ts` — `tiebreakerCopy('MNF_COMBINED').hint` | **WRONG by omission** — the only one of three hints lacking the sentence | Sentence added. Pinned: all three hints must contain `no Monday game`. |
| 3 | `functions/src/nflScoringEngine.ts` — `computeMNFTiebreakerTotal` doc block | **WRONG after A** — "no Monday game → no target" | Rewritten. |
| 4 | `src/components/NFLPoolDashboard/NFLPoolRules.tsx:181` | 🔴 **THE SURFACE THAT LIED.** A third branch whose only difference was the missing fallback sentence — and the branch an unset setting renders | Branch deleted; one sentence for every asking rule. Pinned by a test that also counts the occurrences, so a re-added branch fails. |
| 5 | `src/help/content/wizard-shared.ts:471` — `settings.weeklyTiebreaker` long template, `MNF_COMBINED` | 🔴 **WRONG after A** — "On a week with no Monday game nothing is predicted" | Replaced with the same sentence the other two rules carry. **Not named in the original brief — found by this sweep.** |
| 6 | `src/help/content/wizard-shared.ts:486` — the same topic's `long.fallback` | **WRONG after A** — "Those ask for nothing on a week with no Monday game" | Rewritten. Also found by this sweep. |
| 7 | `src/components/NFLPoolDashboard/PickemPickEntry.tsx:526,820` — code comments | **WRONG after A** — "the sheet asks nothing" | Rewritten to describe the frozen-`[]` case, the only one left. |
| 8 | `src/help/content/nfl-pickem.ts:166` — `pickem.tiebreakerPrediction` | **STILL CORRECT.** "the Monday game, or the last game of the week when there is no Monday game. Some older pools ask about every Monday game together." Never claimed COMBINED asks nothing; A makes it more true, not less | No change. |
| 9 | `shared/nflTiebreakerOptions.ts` — the three select labels | **NOT A CLAIM.** None of the three names the fallback, so the legacy label is not inconsistent with its siblings; the help topic carries the detail | No change. |
| 10 | `src/types/nflPoolTypes.ts:108` | About the ABSENT ⇒ `MNF_COMBINED` resolution, which is unchanged | No change. |
| 11 | `src/components/NFLPoolDashboard/NFLManagerView.tsx:1554` | The read-only legacy option label. Same reasoning as #9 | No change. |

**Sites 5 and 6 are what the sweep bought.** Both are member-facing help copy
that would have kept asserting the old behaviour after the code changed — the
same class of drift as #4, on a surface the brief did not name.

---

## Sweep 3 — tests that PIN the old behaviour

```
grep -rn "MNF_COMBINED" --include=*.ts tests/ functions/src/__tests__/
```

| # | Test | Pinned | Action |
|---|---|---|---|
| 1 | `tests/weekly-tiebreaker-contract.test.ts:230` | `resolveTiebreakTargetIds([sun, early], 'MNF_COMBINED')` → `[]` | Updated to `['sun']`, with the reason. **Not deleted.** |
| 2 | `functions/src/__tests__/weeklyWinners.test.ts:169` | `computeMNFTiebreakerTotal(..., 'MNF_COMBINED')` → `null` | Updated to `17`; `NONE` and the frozen-`[]` case added beside it. |
| 3 | `functions/src/__tests__/survivorRescore.test.ts:148` | default rule, Monday-less → `null` | Updated to the fallback total. |
| 4 | `tests/help-content-nfl-pickem.test.ts:384` | help long copy contains `no Monday game nothing is predicted` | Updated to require the fallback sentence and to REFUSE the old one. |
| 5 | `functions/src/__tests__/emulator/tiebreakFreeze.emulator.test.ts` — 5b | a legacy Monday-less week freezes `[]` | Split. 5b now pins the FINAL-game freeze; **new 5c** pins the qodo #9 guarantee where it now lives — a week that already froze `[]` keeps it. |

Every one of these was a test asserting the behaviour this plan changes, which
is what a pinned contract is for. None was deleted.

---

## Sweep 4 — mutation testing (every guard broken on purpose)

`mmp-validation-and-qa`: a test that passes because it matches source text
rather than behaviour is the failure mode this repo keeps shipping. Each guard
was broken, the test observed to go red, and the code restored.

| # | Mutation | Result |
|---|---|---|
| 1 | Move the `MNF_COMBINED` return back above the Monday-less fallback | 🔴 3 tests red |
| 2 | `applyFrozenTarget`: `frozen !== undefined` → `frozen && frozen.length` (the `??` bug) | 🔴 2 red in `tests/`, 2 red in `functions/` |
| 3 | `tiebreakerAskedButUnavailable` → `return false` | 🔴 1 red |
| 4 | Delete the D2 card's "No tiebreaker this week" copy | 🔴 1 red |
| 5 | Remove the fallback sentence from `tiebreakerCopy('MNF_COMBINED').hint` | 🔴 1 red |
| 6 | Restore the old help long-template sentence | 🔴 3 red |
| 7 | Re-add the `MNF_COMBINED` branch to the rules page tie copy | 🔴 1 red |

Seven for seven. No guard was inert.
