# PLAN-SQUARES-SERVER-FIELDS — sweeps

Deterministic greps, run 2026-11-11 on `claude/squares-server-fields`
(after the qodo round on #765). Re-run each command before relying on a
table: these are point-in-time lists, and the commands are the source of truth.

Classification, as in `PLAN-SQUARES-REOPEN-SWEEPS.md`: **changed** (this PR
edits it), **consistent** (the new rule already allows what it does),
**out of scope** (the rule does not apply to it, and why), **finding**
(something the sweep surfaced that review had not).

**What the sweeps found that review had not:** nothing. Every browser write of
a field the rule freezes is either on a page for another pool type, made by a
SUPER_ADMIN, already read-only once the rule would refuse it, or a user action
inside a control this PR disables.

---

## SF1 — every browser write of a field the rule freezes

```
for f in quarterlyNumbers isLocked randomWinner gameId gameTime league homeTeam awayTeam \
         payouts charity ruleVariations costPerSquare scoreChangePayoutAmount numberSets includeOvertime; do
  git grep -nE "(\b|['\"])$f['\"]?\s*:" -- 'src/**/*.ts' 'src/**/*.tsx' \
    ':!*.test.*' ':!src/__tests__/**' ':!src/types/**' ':!src/utils/testing/**'
done
```

Type declarations, reads (`const x = settings.payouts`), display-only objects
and other pool types' own fields (`settings.payouts` on brackets, `props.payouts`)
are left out of the table below. Each one was looked at.

| Site | What it writes | Classification |
|---|---|---|
| `src/components/admin/WizardStepRules.tsx:35`, `:59` | `costPerSquare`, `numberSets` on the squares manage page | **changed** — read-only once the grid locks (`locked` prop), with the reason shown |
| `src/components/admin/WizardStepPayouts.tsx` (all `payouts`, `charity`, `ruleVariations`, `includeOvertime` writes, incl. `:30` "random draw" confirm) | prize terms on the squares manage page | **changed** — the whole step is inside `<fieldset disabled={gridLocked}>` in `AdminPanel`. Every write is a user action; none runs on render |
| `src/components/admin/WizardStepMatchup.tsx:141`, `:161` | `awayTeam`, `homeTeam` | consistent — both inputs are `disabled={true}` in every state; names come from the game picker, which now calls `linkSquaresPoolGame` |
| `src/components/AdminPanel.tsx` score inputs → `AdminRoute.tsx:185` `updateScores` | `scores` (the whole map, spread over the live pool's) | **changed** — read-only exactly where the rule refuses (locked, linked, Manual Score Override off) |
| `src/components/AdminPanel.tsx:1018` | `manualScoreOverride` | consistent — not frozen (decision S2) |
| `src/components/WizardStepGame.tsx:117–124` | `gameId`, `gameTime`, `league`, `homeTeam`, `awayTeam` | out of scope — imported only by `PropsWizard` (`git grep -n "WizardStepGame\b" -- src`); the rule applies to SQUARES only |
| `src/components/WizardStepReminders.tsx:356–401` | `charity` | out of scope — imported only by `PropsWizard` |
| `src/components/PropsWizard/PropsWizard.tsx:145`, `:150` | `isLocked`, `costPerSquare` | out of scope — Props pools |
| `src/components/PlayoffPool/PlayoffDashboard.tsx:559` | `isLocked` | out of scope — Playoff pools |
| `src/components/SuperAdmin.tsx:910`, `:1010`, `:1014`, `:193` | `isLocked`, `quarterlyNumbers`, `costPerSquare` | consistent — SUPER_ADMIN; `isSuperAdmin()` is its own branch of the update rule (decision S3) |
| `src/components/SimulationDashboard.tsx:71` | `ruleVariations` | consistent — the Test Suite, mounted only inside `SuperAdmin.tsx` (`:3002`). A SUPER_ADMIN's write passes `isSuperAdmin()`; anyone else reaching it is held to the manager branch like any other write |
| `src/components/wizard/create/buildSquaresPayload.ts` | the create payload | consistent — creation is the `createPool` callable (`allow create: if false`); the server now takes teams and kickoff from the feed |

## SF2 — every way a squares pool's document is written from the browser

```
git grep -nE "updateDoc\(|setDoc\(|\.update\(|writeBatch|runTransaction" -- src ':!src/**/*.test.*' ':!src/__tests__' | grep -i pool
```

| Site | Classification |
|---|---|
| `src/services/dbService.ts:392` `updatePool` | the squares manage page's only path. `AdminRoute` passes ONE field per save (`updateConfig({ x })`) against the live pool, so a stale copy cannot carry an old `isLocked` or old scores. (The wizards that send a whole object are Props/Playoff — out of scope.) |
| `src/services/dbService.ts:487` `archivePool`, `:504` `addToWaitlist` | consistent — `status`, `waitlist`; not frozen |
| `src/services/dbService.ts:772` `updateBracketPool` | out of scope — brackets |
| `src/components/admin/TournamentManager.tsx:231` | out of scope — brackets |
| `src/utils/testing/simulators/*` | out of scope — Props/Playoff simulators |

## SF3 — the server paths the rule hands these fields to

```
git grep -nE "squaresGameLink\(|squaresGameHasStarted\(|squaresScoresShowPlay\(" -- functions/src ':!functions/src/__tests__'
```

| Site | Classification |
|---|---|
| `functions/src/squaresAdmin.ts` `linkSquaresPoolGame` | **changed** — the only writer of a link after creation |
| `functions/src/poolOps.ts` `createPool` | **changed** — the feed's teams and kickoff |
| `functions/src/squaresAdmin.ts` `unlockSquaresPool` | **changed** (qodo #765, 2) — "started" now also reads the pool's server-owned `gameTime` |
| `functions/src/squares.ts:130` reserve check for non-owners | **changed** by the same edit — a non-owner's square is refused once `gameTime` has passed, even if the scores were typed back to "not started" |
| `functions/src/poolParams.ts` `lockSquaresPool` | consistent — keeps numbers a grid has; draws once for a grid with none (the documented recovery). Only `unlockSquaresPool` can discard numbers, so only it needed the stricter check |
