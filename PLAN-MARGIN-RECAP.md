# PLAN — the Margin weekly recap renders empty

**Classification: plan-gated (scoring).** `mmp-change-control` §1 lists scoring as
a trigger, so this carries a plan even though the change is small. It touches no
money, no authorization and no production data. Deployment is **functions only**;
no rules deploy, and the frontend change needs a Coolify rebuild.

**Status: implemented.** Reported by Kevin on <!-- hof-date:ignore --> 2026-08-07
with a screenshot of an empty recap card on a Margin pool.

---

## 1. The defect

A Margin pool's weekly recap card renders its header — `HOF Weekend Recap
Summary` and a date — and then nothing at all.

Not a rendering bug. The recap **document** is empty:

```
{ id: 'week_1', poolId: '2mv4pKI734hHeQHzQVTP', week: 1, createdAt: 1754… }
```

`buildWeeklyRecap` (`functions/src/nflScoringEngine.ts:721-746`) adds exactly
three optional fields, and on a Margin pool none of them is ever populated:

| field | populated when | Margin? |
|---|---|---|
| `sharpOfWeek` | `sharpUser` is non-null | **never** — `sharpUser` is assigned only inside the `NFL_PICKEM` branch of `scoreWeekPass` (`functions/src/nflPools.ts:1232`) |
| `closestTiebreaker` | `closestTie` is non-null | never — the MNF tiebreaker is a Pick'em concept |
| `attritionCount` | `poolType === 'NFL_SURVIVOR'` | never, by construction |

So the Margin branch computes `weekScore`, `seasonTotal`, `negativeBurden`,
`positiveWeeks` and `bestWeek`, writes all of them onto the entry — and
contributes nothing to the recap. Survivor and Pick'em recaps render fine and are
not touched by this change.

## 2. What the fix is

**One recap row, and a client that does not render an empty box.**

1. **`functions/src/nflPools.ts`** — the `NFL_MARGIN` branch now tracks
   `sharpUser` as the largest `weekScore` of the week, mirroring the Pick'em
   branch a hundred lines above it.

   **Only entries that actually submitted a pick are eligible.** A no-show scores
   `-14`, which is a larger number than any loss by more than two touchdowns, so
   without that guard a week where several members forgot would crown the
   least-punished absentee "Sharp of the Week". A member who picked and lost by
   20 is genuinely the sharpest of a bad week; a member who did not play is not
   in the running.

2. **`src/utils/recapHighlight.ts`** (new, with colocated tests, matching the
   `pickHighlight.ts` pattern already in that folder) — two pure functions:

   - `formatSharpScore(poolType, score)` — `sharpOfWeek.score` is one field
     carrying two different quantities. In Pick'em it is a POINT TOTAL; in Margin
     it is a signed MARGIN OF VICTORY. The card rendered `({score} pts)`
     unconditionally, which would print a three-point loss as `-3 pts`. Margin
     now reads `+20 margin` / `-3 margin`.
   - `recapHasHighlights(recap)` — a recap can legitimately carry no content
     field at all (a Margin week where every member no-showed). The card now says
     so instead of rendering an empty body. Uses `!== undefined` on
     `attritionCount`, because `0` alive is a real and dramatic answer.

3. **`NFLPoolDashboard.tsx`** — uses both.

### What was deliberately NOT added

Kevin's brief offered "closest-to-zero burden or biggest margin as the plan sees
fit". **One row is the whole fix**, and that is consistent rather than thin: a
Survivor recap also renders exactly one row (`attritionCount`). A second Margin
metric would be a new field, a new type change, a new client row and new tests
for a card nobody has yet seen populated. If Kevin wants a burden row after
watching a real week, it is an additive follow-up.

## 3. Blast radius

- **Scoring output is unchanged.** No entry field, no standings row, no rank, no
  `weeklyScores` value differs. The only new write is one optional field on the
  `weekly_recaps/week_N` document.
- **Recaps are written only on a COMPLETE pass** (`recapWritten = !dryRun &&
  !provisional`, `nflPools.ts:1426`), so nothing here fires mid-week.
- **The AI Commissioner trash-talk trigger** (`aiCommissioner.ts:366`) receives
  the recap document as `facts.recapData`. It already fires for Margin recaps
  today — on the empty ones — and is gated on
  `billing.featuresUnlocked.aiCommissioner`. It will now have actual material.
  `computeFactsHash` covers `recapData`, so a re-score that changes the sharp
  produces a new artifact rather than reusing a stale one.
- **Scoring is idempotent**, so re-scoring a week already scored regenerates the
  recap document with the new field. That is how HOF Weekend gets a populated
  recap after this deploys.

## 4. Evidence

- **`src/utils/recapHighlight.test.ts`** — 9 cases, including the signed-margin
  cases and `attritionCount: 0`.
- **`functions/src/__tests__/emulator/autoScore.emulator.test.ts`** — a new
  `Margin weekly recap — sharp of the week` block, 5 cases. Emulator rather than
  unit because the claim is about what is PERSISTED: a test on
  `buildWeeklyRecap`'s return value passes against a scorer that never calls it
  with a sharp user.
- **Mutation-checked, both halves, and the first attempt was holed:**

  | mutation | result |
  |---|---|
  | delete the whole sharp block | 3 tests fail |
  | drop the `pick &&` guard | 2 tests fail |

  The `never crowns a member who did not submit a pick` case originally used a
  team that lost by **3**, so `-3 > -14` on the arithmetic alone and the test
  passed with the guard deleted — a test that looked like it guarded and did not.
  It now uses a team that lost by **20**, and fails under the mutation.

## 5. Deploy

Functions only; then a Coolify rebuild for the client change. Re-score HOF
Weekend afterwards to regenerate the recap document — steps are in
`MORNING-2026-08-08.md`.
