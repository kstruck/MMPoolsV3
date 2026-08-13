# PLAN — wizard tie-breaker options for weekly / hybrid pools

**Status:** 🛑 AWAITING KEVIN'S SIGN-OFF. No code written.
**Trigger:** `LAUNCH-READINESS.md` §I row **I2**, Kevin 2026-08-13.
**Gate:** `mmp-change-control` §1 — **scoring**. PLAN → adversarial review log →
sweeps → sign-off → code.
**Deploys into a LIVE scorer.** `nflAutoScoreJob` runs `*/5` with
`system/config.nflAutoScore {enabled:true, dryRun:false}`. Anything this plan
lands in `functions/` goes straight into a scorer grading real weeks.

Kevin's words, verbatim:

> "In the pool setup wizard, give options for tie-breakers, especially for
> weekly/hybrid type pools. If there is a winner each week, there needs to be a
> way to break the tie (example: Combined score of the Monday night game, if
> there are two games, the last game, or other options)."

---

## 1. 🛑 The finding that changes the shape of this ticket

**There is no weekly winner anywhere in this codebase, and the MNF prediction
breaks no tie.** Both halves measured tonight against `origin/main` @ `0572babc`.

### 1a. The tiebreaker number is a recap trivia field, not a tiebreak

`entry.weeklyTiebreakers[week]` is written by `submitNFLPicks`
([nflPools.ts:556](functions/src/nflPools.ts:556)) and read in exactly one place
in the scorer:

```ts
// functions/src/nflPools.ts:1307-1313
if (mnfTotalScore !== null) {
  const prediction = entry.weeklyTiebreakers?.[week] ?? 0;
  const diff = Math.abs(prediction - mnfTotalScore);
  if (!closestTie || diff < closestTie.diff) {
    closestTie = { uid: entry.ownerUid, name: entry.userName, diff };
  }
}
```

`closestTie` becomes `recap.closestTiebreaker`
([nflScoringEngine.ts:786](functions/src/nflScoringEngine.ts:786)) and its only
consumer is a highlight line on the weekly recap card
([NFLPoolDashboard.tsx:663-667](src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:663)).
It is a "closest guess" callout. It orders nothing.

### 1b. Nothing ranks a week, so there is no tie to break

- `buildStandingsRows` ([nflScoringEngine.ts:712](functions/src/nflScoringEngine.ts:712))
  emits `totalScore`, `weeklyPoints`, `weeklyResults` per entry. **It computes no
  rank for Pick'em** — the only `rank` field it copies is Margin's.
- The standings table sorts Pick'em by **season** `totalScore` desc, then
  `userName` ([NFLStandings.tsx:64-71](src/components/NFLPoolDashboard/NFLStandings.tsx:64)).
  No weekly column, no tiebreak.
- `settings.payoutMode` (`SEASON` | `WEEKLY` | `HYBRID`) **is stored and
  displayed only.** Every consumer is a label: the wizard select
  ([CreateNFLPickemPool.tsx:50](src/components/wizard/create/CreateNFLPickemPool.tsx:50)),
  the manager select ([NFLManagerView.tsx:898](src/components/NFLPoolDashboard/NFLManagerView.tsx:898)),
  and explanatory copy in `PayoutsPanel.tsx:44-49` which literally tells the
  member to **"Ask your commissioner how the split works in this pool."**
  Grep for `weeklyWinner`/`weekWinner`/`weeklyPayout` across `src/`,
  `functions/src/`, `shared/` and `docs/` returns **nothing**.

**So a weekly pool today is: the app scores the week, and the commissioner reads
the numbers off the standings and decides the winner by hand.** The tiebreak he
applies is whatever he says it is. That is not broken — it is the honour-system
model this product already runs on for entry fees — but it means row I2 as
written ("give options for tie-breakers") sits on top of a feature that does not
exist.

### 1c. The copy divergence Kevin spotted is real and is a separate, smaller bug

The pick sheet says the tiebreaker is the combined score of **both** MNF games:

> "Close counts: Predict the combined final score of the MNF games. If there are
> 2 MNF games, we count the combined score of **both** games."
> — [PickemPickEntry.tsx:626](src/components/NFLPoolDashboard/PickemPickEntry.tsx:626)

and `computeMNFTiebreakerTotal` does exactly that — sums home+away across every
`isMonday` game, returning `null` until **every** Monday game is FINAL
([nflScoringEngine.ts:491](functions/src/nflScoringEngine.ts:491)). So copy and
code agree today. Kevin's example ("if there are two games, the **last** game")
is a **different rule** and would be a behaviour change, not a copy fix.

---

## 2. 🛑 Scope question for Kevin — this is the sign-off gate

Two genuinely different tickets are hiding in row I2, and they cost very
different amounts. **I am not choosing between them.**

### Option A — settings-only (no weekly-winner computation) — ⚠️ STILL a scorer change

⚠️ **Read the label carefully. "Settings-only" means no weekly-winner
computation; it does NOT mean the scorer is untouched.** Option A changes
`computeMNFTiebreakerTotal`, which lives in `functions/src/nflScoringEngine.ts`,
and alters what gets persisted into the weekly recap. It is plan-gated, it owes
a **functions deploy**, and it lands in the LIVE scorer. An earlier draft of
this heading said "no scorer change" and that was wrong in the one section where
being wrong changes the decision — this is the sign-off gate (codex P2, round 9).

The difference between A and B is **what is computed**, not **where**.

Add a `settings.weeklyTiebreaker` choice to the wizard + manager UI. It changes
**what the pick sheet asks for** and **what `computeMNFTiebreakerTotal` sums**,
so the recap's "closest guess" line follows the setting. The commissioner still
decides the weekly winner by hand, but the pool now has a written, in-app answer
to "what breaks a tie here" and the number members entered matches it.

- Touches: `shared/schemas/nfl.ts`, wizard step, `NFLManagerView`, pick-sheet
  copy + `showTiebreaker`, `computeMNFTiebreakerTotal` + its caller, `NFLPoolRules`.
- **Is a scoring change** (`computeMNFTiebreakerTotal` lives in the scoring
  engine and its output is persisted in the recap), so it stays plan-gated and
  owes a functions deploy.
- Delivers what Kevin literally asked for: "in the pool setup wizard, give
  options for tie-breakers".

### Option B — Option A **plus** a real weekly winner

Compute a per-week ranking, apply the chosen tiebreaker to it, and publish a
weekly winner per week for `payoutMode` `WEEKLY`/`HYBRID`.

- Everything in A, plus: a weekly-rank computation in the scorer, a
  reveal-safe place to store it, a standings/recap surface to show it, and a
  decision about what happens when the tiebreaker itself ties (two members both
  1 point off).
- Interacts with the **provisional** pass: a weekly winner computed mid-Sunday
  is wrong until the week completes, and `computeMNFTiebreakerTotal` already
  returns `null` until every Monday game is FINAL — so the winner cannot be
  published before Monday night regardless. That is a real product constraint,
  not an implementation detail: the "who won this week" tile stays empty for
  three days.
- It also lands in the LIVE scorer, and it writes a member-visible result that
  is currently a human's judgement call. If it is ever wrong, it is wrong about
  **money**.

**My recommendation: A now, B after launch.** A is what the sentence asks for,
it is deliverable before the season, and it removes the ambiguity Kevin is
actually worried about ("there needs to be a **way** to break the tie" — a
stated rule is a way). B replaces a commissioner's judgement with the scorer's,
in a scorer that has never run a live season, three weeks before kickoff. The
commissioners are the people paying out; taking the ruling off them is a bigger
change than it looks.

**Everything below specifies Option A.** Section 8 sketches what B would add.

---

## 3. Where the setting lives, and its exact option set

### Field

`settings.weeklyTiebreaker`, on **Pick'em only**.

```ts
// shared/schemas/nfl.ts — pickemCreateInputSchema.settings
weeklyTiebreaker: z.enum(['MNF_COMBINED', 'MNF_LAST_GAME', 'NONE']).optional(),
```

`.optional()` is load-bearing and is the whole no-migration story — see §4.

⚠️ **The Zod schema is not the only type contract, and forgetting the other two
is a typecheck failure or, worse, an `as any`.** `NFLPickemPool.settings` is
declared **twice**, by hand, in two module-incompatible TS roots:

| File | Line | Note |
|---|---|---|
| `src/types/nflPoolTypes.ts` | 83 | the client's copy |
| `functions/src/nflPoolTypes.ts` | 86 | the scorer's copy |

Both currently carry `payoutMode` and `pickMode` and **neither carries
`weeklyTiebreaker`**. Add `weeklyTiebreaker?: WeeklyTiebreaker;` to **both**, in
the same change. (codex P2 on this plan — the first draft's touch list had only
the Zod schema, which would have compiled nowhere.)

**Do NOT "fix" the duplication as part of this ticket.** Collapsing the two
interfaces into `shared/` is a repo-wide refactor of a hand-maintained contract
that predates `shared/` and is touched by every NFL surface — a strictly larger
and riskier change than the feature, three weeks from kickoff. The tiebreaker
type itself does go in `shared/` (§4); the surrounding `NFLPickemPool` interface
stays where it is.

Nothing else in the schema chain needs a change: `settings` is already a single
editable group in the matrix (`shared/editability.ts` `KEY_GROUPS.settings =
'settings'`), so a new nested key inherits its lifecycle rules with no matrix
edit. And NFL `settings` writes are **already denied to every client principal**
in `firestore.rules` (`nflSettingsWriteBlocked()`, rules:138-158) — the only
write path is the `updatePoolSettings` callable. **Measured, per the brief's
instruction: the field is NOT client-writable today and needs no new rules
work.** `tests/nfl-settings-lockdown.test.ts` pins that block.

### The option set, with the justification for each

| Value | Rule | Why it is in the set |
|---|---|---|
| `MNF_COMBINED` | Combined final score of **all** Monday games | **Today's behaviour and the DEFAULT.** It is what `computeMNFTiebreakerTotal` does, what the sheet copy says, and what every existing pool is already playing |
| `MNF_LAST_GAME` | Combined final score of the **latest-kickoff** Monday game only | Kevin named it explicitly ("if there are two games, the last game"). It is also the more common house rule, because a two-game Monday makes a combined guess a coin flip |
| `NONE` | No tiebreaker question; ties are shared | The honest option for a `SEASON` pool, which has no weekly winner to break. Today the sheet asks for a Monday prediction on **every** pick'em pool with a Monday game, including season-long ones that never use it — a question with no purpose |

**Deliberately NOT included**, and I will not add them without being asked:
first-game score, total points across the whole slate, most-confident-pick
correctness, coin flip, head-to-head. Nobody asked for any of them, each needs
its own scorer branch, and every one is a new way to be wrong about money.

⚠️ **`MNF_LAST_GAME` needs a tie-break of its own for "the last game".** Two
Monday games can share a kickoff time (rare, but a doubleheader at the same
`startTime` is not impossible in the feed). Proposed: sort by `startTime` desc,
then `id` desc — deterministic, and documented in the code. **Do not** leave it
to array order; `nfl_games` query order is not a promise.

---

## 4. Existing pools keep today's behaviour, with NO migration

The **#399 pattern exactly** (HANDOFF's 2026-08-09 box): absent field = current
rule, default applied at every read site, no backfill.

```ts
// shared/nflTiebreaker.ts (new, in shared/ so the scorer and the client share it)
export type WeeklyTiebreaker = 'MNF_COMBINED' | 'MNF_LAST_GAME' | 'NONE';
export function effectiveWeeklyTiebreaker(settings): WeeklyTiebreaker {
  const v = settings?.weeklyTiebreaker;
  return v === 'MNF_LAST_GAME' || v === 'NONE' ? v : 'MNF_COMBINED';
}
```

Every read site calls that helper. An unset pool, a pool created before this
ships, and a pool whose field holds junk all resolve to `MNF_COMBINED` —
byte-identical to today. **No backfill script, no data touch, nothing to run in
prod.**

⚠️ **`shared/` means this is a functions-coupled change.** `shared/` is copied
into `functions/src/shared` by the predeploy step, so adding the helper there
owes a **functions deploy**, and CLAUDE.md §3's order applies (functions before
rules; no rules change here, so functions → Coolify).

The mirror-vs-share call, stated so the reviewer can disagree: this goes in
`shared/` rather than being duplicated the way `src/utils/pickemResult.ts`
mirrors `gradePickemGames`. The duplication there is justified because that rule
changes with **frontend** iteration. This one is a settings enum both sides must
agree on exactly, and a drift here means the sheet asks for one number while the
scorer sums another — silently.

---

## 5. Mid-season changes are refused server-side

**Same gate as #399's survivor parity settings**, and then **one notch tighter**
than #399 — see the box below, which is a codex finding on this plan and changes
the rule.

The #399 reason applies unchanged: changing the rule after a week has been
scored rewrites what that week's recap said on the next rescore, and members
have already seen the old answer.

> ### ⚠️ ABSORBED — codex P1 on this plan, round 1
>
> **`poolHasScoredWeek` alone is the WRONG line, and this plan originally drew
> it there.** It permits a commissioner to switch `MNF_COMBINED` →
> `MNF_LAST_GAME` after members have submitted this week's prediction but before
> anything is scored. The same stored number is then judged against a different
> target — a member who guessed 47 for a two-game Monday total is silently
> re-read as having guessed 47 for one game. Their picks may already be locked,
> and most people never revisit a submitted sheet. That is a retroactive rule
> change on live participants, and `poolHasScoredWeek` is false the whole time.
>
> **The line is the first submitted prediction, not the first scored week.**

> ### ⚠️ ABSORBED — codex P1 on this plan, round 2 (a hole in the round-1 fix)
>
> Round 1's fix said "freeze once any entry holds a `weeklyTiebreakers` value",
> and **that is still too loose in exactly one direction: away from `NONE`.**
> Under `NONE` the sheet deliberately stops sending `tiebreakerPrediction`
> (§7), so entries carry **no** `weeklyTiebreakers` value at all — the round-1
> gate is vacuously satisfied. A commissioner could then switch `NONE` →
> `MNF_COMBINED` after picks are locked, and the scorer's
> `entry.weeklyTiebreakers?.[week] ?? 0` reads every member as having guessed
> **0** — a target nobody was ever asked for, on picks they can no longer edit.
>
> Round 1 tightened the gate and round 2 found the hole the tightening left.
> That is the documented pattern in CLAUDE.md §2c ("rounds 2+ find defects in
> the fixes"), and it is why the round count is not the stopping rule.

So the refusal is: **the effective rule may not change once the pool holds ANY
evidence of a submission** — an entry with non-empty `picks`, **or** an entry
holding any `weeklyTiebreakers` value. Both halves are needed: `picks` alone
misses nothing in practice but the tiebreaker map is the direct evidence, and
`weeklyTiebreakers` alone misses the `NONE` case entirely (round 2). Judge the
**OR** of the two, per-entry, short-circuiting on the first hit.

That is strictly tighter than `poolHasScoredWeek` (a scored week implies
submissions), so the scored check becomes a cheap early-out rather than the
whole gate.

Rejected alternative, named because codex offered it: **versioning the rule
per week** (`weeklyTiebreakerByWeek[week]`, frozen at each week's lock). It is
strictly more capable — a commissioner could change the rule for *future* weeks
— and strictly more machinery: a second frozen-per-week map alongside
`hardLockByWeek`, a freeze writer on the submission path, and a scorer that
resolves per week rather than per pool. **Not worth it for a setting whose
correct value is known at pool creation and whose realistic edit window is "the
day I set the pool up".** If a commissioner genuinely needs to change it after
submissions start, the honest answer is a support action, not a feature.

Implementation: extend `functions/src/lib/survivorSettingsGate.ts`'s pattern
rather than inventing a second one — a new `weeklyTiebreakerRefusal(pool, patch,
entries)` beside it, plus a `tiebreakerEditNeedsEntries(pool, patch)` mirroring
`parityEditNeedsEntries` so the entries read happens **only** when the effective
value actually moves (the manager UI submits a complete settings object on every
save, so an unconditional read would cost hundreds of transactional reads to
confirm nothing changed).

`poolHasScoredWeek` is reused **unchanged** as the early-out. Its correctness is
subtle and worth keeping: it reads `publishedWeeks` **and** the legacy markers,
precisely because `scoredWeeks` is withheld on a provisional pass — and the
provisional window is exactly when members have seen a result no `scoredWeeks`
marker records yet.

```
TIEBREAKER_LOCKED_AFTER_SUBMISSIONS: members have already submitted picks in
this pool, so the tiebreaker rule can no longer be changed — they answered the
old question, or were never asked the new one.
```

(Plus the existing `SETTINGS_LOCKED_AFTER_SCORING` wording when the pool is
already past a scored week; two messages because the member-facing explanation
genuinely differs.)

Wired into `updatePoolSettings` at the same point as `parityTouched`
([poolOps.ts:457](functions/src/poolOps.ts:457)) — **inside** the transaction,
against a pool read in that transaction, and under `retryWhileScoring` so an
in-flight scoring lease bounces the edit. That is not optional politeness: a
save landing between the scorer's post-lease re-read and its publication
publishes a recap computed under settings it was not computed with.

**Present-only, by effective value**, exactly as `survivorParitySettingsRefusal`
is: the manager UI submits a complete settings object on every save, so a
scored pool saving unrelated fields must not be refused over a tiebreaker key it
never meant to change, and a legacy pool saving the UI's default must not be
refused over `undefined -> 'MNF_COMBINED'`.

The wizard needs no gate — a pool being created has no scored week.

---

## 6. How the scorer consumes it

One function changes, and its contract widens by one argument:

```ts
// functions/src/nflScoringEngine.ts:491
export function computeMNFTiebreakerTotal(
  games: NFLGame[],
  rule: WeeklyTiebreaker = 'MNF_COMBINED',   // default = today
): number | null
```

- `MNF_COMBINED` — unchanged: sum home+away over every `isMonday` game, `null`
  until **all** of them are FINAL.
- `MNF_LAST_GAME` — pick the latest `startTime` Monday game (ties broken by `id`
  desc), `null` unless **that** game is FINAL. Note it can resolve **earlier**
  than `MNF_COMBINED` on a doubleheader, which is a behaviour improvement, not a
  hazard: the "closest guess" line appears once the game it names has ended.
- `NONE` — return `null` unconditionally. `null` is already the "no tiebreaker
  this week" path (the caller guards `if (mnfTotalScore !== null)`), so the
  recap simply omits `closestTiebreaker` and `recapHasHighlights` already handles
  its absence (`src/utils/recapHighlight.ts:33`).

**The one thing a reviewer should attack**: does anything else break when the
tiebreaker number means something different than it did? Measured — the number
has exactly two consumers, both listed in §1a, and neither ranks anybody. It is
persisted per-entry as `weeklyTiebreakers[week]` and revealed by
`getPoolPicks`/`nflPickReveal.ts:219` once the week is revealed. **A pool that
switches rules mid-season would compare old guesses to a new target** — which is
exactly why §5 refuses that switch after a scored week. The two mechanisms are a
pair; neither is safe alone.

**Rescore safety:** `computeMNFTiebreakerTotal` is already documented as a
rescore-safe helper — it recomputes from `games` on every pass and freezes
nothing. Adding a settings-derived argument keeps that property as long as the
setting cannot move once a week is scored, which §5 enforces.

---

## 7. The pick sheet follows the setting

- `showTiebreaker` ([PickemPickEntry.tsx:351](src/components/NFLPoolDashboard/PickemPickEntry.tsx:351))
  gains `&& rule !== 'NONE'`.
- The label and the "Close counts" paragraph become rule-derived, one string per
  rule, so the sheet can never claim "both games" while the scorer sums one.
- `NFLPoolRules.tsx` states the pool's tiebreaker rule in plain words — it is a
  house rule and belongs where members read the house rules.
- ⚠️ **`NFLStandings.tsx`'s "MNF Score" column, which the first draft's touch
  list forgot** (codex P2, round 8). It renders **unconditionally** for every
  Pick'em pool — the header at `NFLStandings.tsx:184-187` and the cell that
  prints `entry.weeklyTiebreakers[week]`. Under `NONE` that leaves an
  all-dashes column with no meaning, and — worse — a prediction submitted by an
  **older client before the flip** still renders in it, so the standings display
  a tiebreaker number for a pool that has no tiebreaker. Gate the column *and*
  its cell on `rule !== 'NONE'`. **Hiding the column is the whole fix**: nothing
  is deleted, and if the commissioner switches back before any submission, the
  numbers are still there.
- ⚠️ **`tiebreakerPrediction` keeps being submitted and stored under `NONE`?**
  Proposed: **no** — the sheet stops sending it, and `submitNFLPicks` keeps
  accepting it (the field is `?? undefined`-guarded at
  [nflPools.ts:558](functions/src/nflPools.ts:558), so an absent value writes
  nothing and an older client keeps working). Do not add a server-side rejection
  of the field for `NONE` pools; it would break every already-installed client
  the moment a commissioner flips the setting.

---

## 8. What Option B would add, if Kevin wants it

Listed so the decision is informed, **not** as a specification:

1. A per-week ranking for Pick'em in `buildStandingsRows` (it computes none today).
2. A tiebreak cascade: weekly points desc → `|prediction − target|` asc → **then
   what?** Two members exactly 1 off is not rare. Shared win? Earlier submit
   time? That is a product decision with money attached.
3. A publication rule that survives the provisional pass — the winner cannot be
   final before every Monday game is, and a "leader so far" that changes on
   Monday night will be read as a result.
4. A surface: a weekly-winner column or a recap line, and a Payouts panel that
   stops saying "ask your commissioner".
5. A reveal-safety pass: a weekly winner is derived from picks, so it must not
   leak anything `getPoolPicks` withholds.

Estimate, honestly: this is a plan of its own plus 2–3 PRs, and it lands in the
live scorer. It is not a pre-season item.

---

## 9. 🛑 Questions for Kevin — sign-off gate

1. **A or B?** (§2). My recommendation is A now, B after launch. If you want B,
   it needs its own plan and I would not start it before the Hall of Fame game.
2. **Is `MNF_LAST_GAME` "the last game to kick off", or "the game that ends
   last"?** They are the same on any real Monday slate, and kickoff order is the
   only one the data supports before the games are played — the sheet has to ask
   the question days ahead. I plan to implement latest-kickoff and say so in the
   copy. Confirm.
3. **Should `NONE` be offered at all?** It is the honest option for a
   season-long pool, but it removes a question members are used to seeing. If you
   would rather always ask, I drop it and the enum is two values.
4. **Should the manager UI expose this at all, or wizard-only?** §5 refuses the
   change once anyone has submitted a prediction either way; the question is
   whether a commissioner may fix a wizard misclick in the window before that.
   I propose **yes**, manager UI included — but note the window is now narrower
   than it first looked: it closes at the **first submitted prediction**, not
   the first scored week.
5. **Do you want the pick sheet to keep asking on `SEASON` payout pools?** Today
   it does, and the number is never used for anything but a recap trivia line.

---

## 10. Gates this will owe when it is built

| Gate | Applies |
|---|---|
| Frontend typecheck, functions typecheck, root suite, functions suite | yes |
| Scoring invariant tests named (§5 of `mmp-validation-and-qa`) | **yes** — `computeMNFTiebreakerTotal` is in the scoring engine |
| `firestore.rules` | **no** — NFL `settings` is already server-only; no rules edit |
| Wizard touched → Playwright specs run, or explicitly stated not run | yes |
| Adversarial review log + sweep pass | **yes** — `PLAN-WEEKLY-TIEBREAKERS-REVIEW-LOG.md` |
| codex round on the PR, qodo on the PR, joint stop | yes |
| Deploy | **functions** (via `shared/`) → **Coolify**. No rules deploy. Lands in the LIVE scorer and the PR body must say so |

---

## 11. Provenance

Measured 2026-08-13 evening against `origin/main` @ `0572babc`, in worktree
`mmp-launch-fixes-694804`. Re-verify with:

```bash
grep -rn "weeklyTiebreakers\|closestTiebreaker" functions/src/ src/ --include=*.ts --include=*.tsx
grep -rni "weeklywinner\|weekwinner\|weekly winner\|weeklyPayout" src/ functions/src/ shared/ docs/
grep -n "computeMNFTiebreakerTotal" -A 12 functions/src/nflScoringEngine.ts
grep -n "nflSettingsWriteBlocked" -A 25 firestore.rules
```
