# SWEEPS — PLAN-SURVIVOR-EXEMPTION-RESERVATIONS

Deterministic grep-built COMPLETE instance lists. Commands are reproducible from
repo root; re-run them before implementation if the branch has moved.

> ✅ **RE-RUN FROM SCRATCH 2026-08-10** by the implementing session against
> `origin/main` @ `8a1d110`, with the shape-proofs rule 5/6 demands executed
> first: the S2 declaration command finds the 4 JSON fixture rows
> (`--include=*.json` alone → 4) and the 3 TS seeds in `survivorRescore.test.ts`;
> the S2 call-site command finds all 12 call sites including the two the
> property-name grep cannot see. Deltas against the tables below:
>
> 1. **One NEW file**: `functions/src/__tests__/emulator/survivorParitySettings.emulator.test.ts`
>    (#399) seeds entries with `usedTeams` + `picks` (`:133`, `:146` —
>    `usedTeams ['KC']` with picks whose team SET matches, so not divergent).
>    It exercises the settings-reduction validator through `updatePoolSettings`
>    and never reaches `checkAutoSurviveExemption`. **Unaffected**, and it must
>    stay green untouched — it pins #399 behaviour this plan does not change.
> 2. **Line drift only** elsewhere: the tri-mode call sites in
>    `survivorRescore.test.ts` are now `:273`/`:274` (no-context form),
>    `:277`–`:283` (the maxTeamUses-1 divergence pin that INVERTS),
>    `:305`–`:323` (the future-reservation pin that INVERTS), `:326` (toggle).
>    `poolExceptions.ts` writer rows are now `:375`/`:380`/`:389`/`:445`.
> 3. Everything else matches the tables.

## S1 — every writer of `usedTeams` (is it submit-time everywhere?)

Command (**`grep -E`** — see the note at the foot of this file):

```bash
grep -rEn 'usedTeams = |usedTeams:' --include=*.ts src functions/src shared   | grep -Ev 'functions/src/shared|__tests__|\.test\.'
```

| Site | Role | Submit-time? |
|---|---|---|
| `functions/src/nflPools.ts:633` | Survivor submit ledger write | **YES** — written the moment a pick is submitted, for whatever week |
| `functions/src/nflPools.ts:693` | Margin submit ledger write | YES (no exemption exists for Margin — out of scope) |
| `functions/src/nflPools.ts:555,651` | Entry init `usedTeams: []` | n/a |
| `functions/src/poolExceptions.ts:445` | `proxyPick` ledger write | **YES** — same, via the commissioner path |
| `src/utils/testing/simulators/nflSeasonSimulator.ts:330` | Sim seeding | n/a (test harness) |

**Conclusion: `usedTeams` is submit-time on EVERY write path, with no scored-time
variant anywhere.** So it cannot answer "which teams had this entry used *by*
week N" even in principle — it has no week information at all. The repo already
states the timing half of this at `functions/src/nflScoringEngine.ts:668`, where
`usedTeams` is excluded from the standings projection because it "is updated at
SUBMIT time, so it reveals the current week's un-scored pick"; that comment stops
one step short of the consequence this plan is about.

## S2 — entries whose `usedTeams` diverges from `picks`

⚠️ **CORRECTED, codex r2 #3.** The first command was
`grep -rln 'usedTeams' --include=*.json src functions` — JSON ONLY. It therefore
searched none of the TypeScript seeds, which is where most of this repo's
divergent entries live, and the "complete inventory" it produced was nothing of
the kind. Corrected command:

```bash
grep -rEn '"?usedTeams"?:' --include=*.ts --include=*.tsx --include=*.json src functions/src tests   | grep -Ev 'functions/src/shared|nflPoolTypes|survivorReuse|: string\[\]'
```

**S2 NEEDS TWO SEARCHES, NOT ONE** (codex r8). The pattern above finds SEED
DECLARATIONS. It cannot find a divergent ledger passed straight into the helper
as an argument — those are call sites, and they reach the exemption just as
directly:

```bash
grep -rEn 'checkAutoSurviveExemption\(' --include=*.ts functions/src tests   | grep -v 'export function'
```

(12 call sites at the time of writing.)

⚠️ **The `"?` is load-bearing** — JSON writes `"usedTeams":`, TypeScript writes
`usedTeams:`. A bare `usedTeams:` matches **zero** of the four scenario fixtures
in the table below while the command's own `--include=*.json` advertises that it
covers them (measured: `0` vs `4`). Do not "simplify" it back.

**Scoping note that makes this tractable.** The blast radius is not "every seed
whose ledgers diverge" — it is "every seed that reaches
`checkAutoSurviveExemption` with divergent ledgers". Most divergent seeds below
never touch the exemption, and saying so per row is the point of the table.

🛑 **THIS SWEEP CORRECTS THE PLAN. Read it before implementing.**

| Fixture | `usedTeams` | `picks` | Consequence |
|---|---|---|---|
| `src/utils/testing/scenarios/nfl-survivor-autosurvive.json` `testEntries[0]` | `['KC','BUF','SF','DAL']` | `survivorPicks {}` → persisted `picks {}` | exemption fires today off the seeded ledger alone; would **NEVER fire** under a picks-derived default path |
| `src/utils/testing/scenarios/nfl-survivor-autosurvive.json` `testEntries[1]` | `['KC']` | `survivorPicks {"1":"SF"}` → persisted `picks {1:'SF'}` (codex r7) | Divergent (`usedTeams` says KC, the pick is SF) but not exempt either way. ⚠️ Its week-1 reservation is real and must not be dropped when the scenario is rebuilt |
| `src/utils/testing/scenarios/nfl-survivor-autosurvive-off.json` `testEntries[0]` | `['KC','BUF','SF','DAL']` | `survivorPicks {}` → persisted `picks {}` | control case — exemption disabled, so unaffected |
| `src/utils/testing/scenarios/nfl-survivor-autosurvive-off.json` `testEntries[1]` | `['KC']` | `survivorPicks {"1":"SF"}` → persisted `picks {1:'SF'}` | Same shape; exemption disabled in this control, so unaffected |
| `functions/src/__tests__/perPickResults.test.ts:114` | `[]` | populated | **diverges the OTHER way** — exercises `gradeSurvivorWeekGame`, never the exemption. Unaffected |
| `functions/src/__tests__/emulator/resubmitSameTeam.emulator.test.ts:287` | `['ARI']` | `{}` | Added by #399 to pin the SUBMIT GUARD's ledger authority. Guards are out of scope (decision 3), so unaffected — but it is the closest thing to a trap in this list and must be re-read, not assumed |
| `functions/src/__tests__/emulator/memberRecord.emulator.test.ts:111` | `[]` | `{}` | Member-record latch; no exemption. Unaffected |
| `functions/src/__tests__/emulator/hofChaosDrill.emulator.test.ts:365` | `[]` | `{}` | Void-week / no-pick path, exemption explicitly cannot fire (`teamsPlaying.size === 0`). Unaffected |
| `functions/src/__tests__/survivorRescore.test.ts:357` | `['KC','BUF']` | `{1:'KC', 9:'KC'}` | ⚠️ **DIVERGENT *AND* REACHES THE EXEMPTION** — added by #399 to assert that at `maxTeamUses: 2` the picks map wins over a stale ledger. Under the change its verdict must be RESTATED: with `countTeamUsesBefore(picks, 9)` KC has one use before week 9, so it stays eligible and the exemption still does not fire — same outcome, different reason. **Re-derive it rather than assume it; it is the one seed in this table that exercises the path being changed.** |
| `functions/src/__tests__/survivorRescore.test.ts:277` (**CALL SITE**, codex r8) | `['KC','BUF']` passed as an argument | `{}` passed alongside | 🛑 **ITS ASSERTION REVERSES.** "maxTeamUses 1 keeps usedTeams authority even when picks DISAGREE" — it exists to pin the exact behaviour this plan removes. Invert it, do not delete it, exactly as `:357`'s sibling was handled in #399 |
| `functions/src/__tests__/survivorRescore.test.ts:272` (**CALL SITE**) | `['KC','BUF']` / `['KC']` | none passed | "no reuse context: usedTeams stays the authority" — 3-arg form. Its verdict changes with the default path; restate |
| `functions/src/__tests__/survivorRescore.test.ts:98` | `['KC','BUF']` | `{}` (none) | ⚠️ **DIVERGENT AND REACHES THE EXEMPTION** — "exemption weeks use set semantics across reruns". With no picks at all, a picks-derived default path counts zero uses and the exemption STOPS FIRING, so this test breaks exactly as the autosurvive fixtures do. Same repair as the fixtures — and per codex r6 that is a REBUILD (a bare `picks`/`survivorPicks` addition cannot create a week earlier than the one being scored), not a one-line seed edit |
| `autoScore` / `goldenArc` / `hofChaosDrill` / `fixtureMatrix` / `phase3Arc` / `scenarioRunner` / `settingsMatrix` emulator seeds | consistent with `picks` | consistent | Non-divergent by construction. Unaffected |

⚠️ **This table is the corrected sweep's OUTPUT, not its completion.** Each
"unaffected" verdict above is a reading of the seed's purpose, and the ones that
matter must be re-verified by running the suites after the change — the guards
in `resubmitSameTeam` especially. Sweep S2 is complete as an INVENTORY; the
per-instance verdicts are claims to be tested, not evidence.

**What this means.** The plan's proposed default-path change — stop reading
`usedTeams`, read `countTeamUsesBefore(picks, week)` — would make
`nfl-survivor-autosurvive.json` **assert the opposite of what it was written to
prove**. Its whole purpose is an entry that has exhausted the slate and therefore
receives an exemption; with no `picks` map at all, a picks-derived count is zero,
every team stays eligible, and the exemption never fires. The scenario would not
fail loudly — it would quietly stop testing the feature.

These scenarios are reachable from the live SuperAdmin **Test Suite** tab and run
against production Firestore (see `mmp-validation-and-qa` §7), so this is not
confined to CI.

**Correction fed back into the plan:** question 1 resolved to "change both
paths", so these fixtures must be repaired **in the same PR**. ⚠️ Per codex r6/r7
that repair is a REBUILD, not a seed edit — the scenario schema has no `picks`
field (entries carry `survivorPicks`, converted by `nflSeasonSimulator.ts:331`),
and `scoreWeeks: [1]` leaves no earlier week for a prior use to live in. Earlier
`nflGames`, `survivorPicks` in those weeks, and `scoreWeeks` moved later.
Implementing the engine change without it is the failure mode this sweep exists
to catch — the same shape as the sim-backdoor discovery that resequenced
`PLAN-SUPERADMIN-CONTROL` Phase 0.3.

## S3 — every consumer of the exemption

Command:

```bash
grep -rEn 'checkAutoSurviveExemption|exemptWeeks|autoSurviveExemptionEnabled'   --include=*.ts --include=*.tsx src functions/src shared
```

| Site | Role | Change required |
|---|---|---|
| `functions/src/nflScoringEngine.ts:365` | the helper itself | **YES** — the whole change |
| `functions/src/nflScoringEngine.ts:571` | caller in `computeSurvivorWeekUpdate` | passes `picks` + `week` already (#399); confirm it still satisfies the new signature |
| `functions/src/nflScoringEngine.ts:244` | `evaluateSurvivorWeek` early-returns on `exemptWeeks.includes(week)` | No — consumes the recorded result, not the eligibility |
| `functions/src/nflPools.ts:1282` | comment: full slate passed on purpose | Comment only |
| `functions/src/lib/autoScoreDecisions.ts:194` | fingerprint term `autoSurviveExemptionEnabled` | **VERIFY** — the setting is hashed, the eligibility inputs are not directly; see the plan's fingerprint note |
| `tests/nfl-scoring.test.ts:272` | calls the 3-arg form | **YES** — signature/behaviour change |
| `src/components/NFLPoolDashboard/NFLPoolRules.tsx:230` | member copy "Exempt when 0 eligible teams left" | Copy still true; no change |
| `src/components/wizard/create/CreateNFLSurvivorPool.tsx:56,75` | wizard control + default | No |
| `src/types/nflPoolTypes.ts:227` / `functions/src/nflPoolTypes.ts:223` | `exemptWeeks` type | No |
| `src/utils/testing/simulators/nflSeasonSimulator.ts:332` | sim seeding `exemptWeeks: []` | No |

## S4 — can a member really pre-submit a future week?

| Site | Finding |
|---|---|
| `functions/src/schemas/poolCore.ts:30` | `week: z.number().int().min(1).max(23)` — **any** week in range is accepted |
| `functions/src/nflPools.ts` survivor branch | the weekly hard lock is evaluated for the SUBMITTED week, so a later week is unlocked and accepted |
| `functions/src/poolExceptions.ts` `proxyPick` | same — a commissioner can proxy a future week |

**Confirmed: pre-submitting later weeks is a supported action on both paths**, so
the defect's precondition is ordinary usage rather than a corrupt state.

## Corrections fed back into the plan

1. **S2 is a plan-changing correction** — the autosurvive scenario fixtures carry
   `usedTeams` with **no `picks` at all**, so a picks-derived default path
   silently disables the exemption they exist to prove. Fixtures must change in
   the same PR, or open question 1 must be answered "keep `usedTeams` on the
   default path".
2. S1 establishes that `usedTeams` has no week information on any write path, so
   "make the default path answer the by-week question using `usedTeams`" is not
   an available third option. The choice really is the two in open question 1.
3. **S2's first pass was JSON-only and its "complete" claim was false** (codex r2
   #3). Recorded rather than quietly fixed, because the lesson generalises and
   this repo has paid for it before: a sweep is only as complete as its
   `--include` list, and "grep found nothing" is not evidence when the grep could
   not have looked. The same failure produced the S2 miss in
   PLAN-SURVIVOR-PARITY-SCORING (the oracle's tie logic does not contain the word
   "tie").
4. **The documented commands were NOT REPRODUCIBLE, and that is worse here than
   almost anywhere else** (qodo, PR #404). They were written with `|` alternation
   but plain `grep`, which is BRE — `|` is a LITERAL PIPE there. The commands as
   published returned **zero** matches; the ones actually run used `\|`. Measured:

   ```bash
   grep -rn  'usedTeams = |usedTeams:'  --include=*.ts functions/src | wc -l   # -> 0
   grep -rEn 'usedTeams = |usedTeams:'  --include=*.ts functions/src | wc -l   # -> 39
   ```

   A sweep document exists so the next session can RE-RUN it and get the same
   list. One that silently returns nothing would have handed them an empty
   inventory and the confidence of a completed sweep — the precise failure this
   file's own correction #3 warns about ("grep found nothing is not evidence when
   the grep could not have looked"), reproduced in the fix for it. All commands
   now use `grep -E` / `grep -Ev`, which is also more legible than escaping.

   ⚠️ The same unescaped-alternation pattern appears in **already-merged** sweep
   docs, `PLAN-SURVIVOR-PARITY-SCORING-SWEEPS.md` among them. Out of scope for
   this PR and left alone deliberately; worth a sweep of its own.
5. **The corrected S2 was ALSO incomplete — it was truncated by `head -25`**
   (codex r3). Two divergent seeds that reach the exemption were cut off the
   bottom: `survivorRescore.test.ts:98` and `:357`. Both are now in the table, and
   `:98` is a second instance of the autosurvive-fixture problem hiding in a unit
   test.

   **That is the THIRD failure of the same family on this one sweep** — first the
   `--include` list was JSON-only, then `|` alternation was literal under plain
   `grep`, now the output was truncated. Each time the command "worked", returned
   something plausible, and was written up as COMPLETE. The generalisable rule,
   earned three times: **a sweep's output is not evidence until the command has
   been shown capable of finding everything it claims to cover** — no `head`, no
   narrowed `--include`, no untested regex flavour. Run it wide, then filter for
   reading.
6. **And a FOURTH: the pattern could not match JSON keys at all** (codex r5). The
   corrected command still searched for `usedTeams:` while advertising
   `--include=*.json`, and JSON writes `"usedTeams":` — so it matched **0** of the
   four scenario fixtures that the table's own first four rows are about
   (`grep -rEn '"?usedTeams"?:' --include=*.json src` finds 4). The rows were right;
   the command that claimed to produce them could not have.

   Four failures, one sweep, every one of them a command that ran clean and
   returned something. **Treat rule 5 above as mandatory rather than aspirational:
   before writing a sweep up as complete, prove the command finds a known instance
   of every shape it claims to cover.** For this sweep that means: one TypeScript
   seed, one JSON fixture, one match that must be excluded.
7. **A FIFTH shape failure — S2 searched only DECLARATIONS, never CALL SITES**
   (codex r8). A divergent ledger handed straight to `checkAutoSurviveExemption`
   as an argument reaches the helper just as directly as a seeded entry does, and
   `survivorRescore.test.ts:272` and `:277` do exactly that — `:277` exists
   specifically to pin the behaviour this plan removes, so its assertion reverses.
   A property-name grep cannot see either.

   S2 now carries **two** commands, declarations and call sites. And the rule
   earns one more clause: **enumerate the SHAPES a thing can take before writing
   the command** — a seed literal, a JSON key, a function argument — not just the
   files it can live in.
