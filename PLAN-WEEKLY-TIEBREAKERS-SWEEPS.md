# PLAN-WEEKLY-TIEBREAKERS — SWEEPS

Deterministic enumeration feeding `PLAN-WEEKLY-TIEBREAKERS.md`. Run from the
repo root. Every sweep states its command, a **known instance it must find**
(the S2 lesson from `PLAN-SURVIVOR-EXEMPTION-RESERVATIONS-SWEEPS.md`: a sweep
that finds nothing is worthless until you have proved it can find something),
and the complete result as of **2026-08-13 evening, `origin/main` @ `0572babc`**,
worktree `mmp-launch-fixes-694804`.

These sweeps answer three questions the plan's whole shape depends on:
**does a weekly winner exist**, **who consumes the tiebreaker number**, and
**can a client write the setting**.

---

## S1 — is there a weekly winner anywhere?

The plan's §1 claims there is none. That is a negative claim about the whole
repo, so it needs a sweep that could have found one.

```bash
grep -rni "weeklywinner\|weekwinner\|weekly winner\|winnerOfWeek\|weeklyPayout" \
  src/ functions/src/ shared/ docs/ --include=*.ts --include=*.tsx --include=*.md
```

**Must find:** the manager UI's `Weekly Winner Only` payout label. If it does
not, the grep is wrong, not the codebase.

**Result — 3 hits, all label text, zero computation:**

| # | Location | What it is |
|---|---|---|
| 1 | `src/components/NFLPoolDashboard/NFLManagerView.tsx:903` | `<option value="WEEKLY">Weekly Winner Only</option>` — the payout-mode select's label |
| 2 | `src/components/PayoutsPanel.tsx:44` | `label: 'Weekly Winners'` — display copy |
| 3 | `src/components/PayoutsPanel.tsx:49` | *"…split between weekly winners and the final season standings. **Ask your commissioner how the split works in this pool.**"* |

**Nothing computes a weekly winner.** Hit 3 is the load-bearing one: the product
already tells the member, in its own words, that the weekly split is the
commissioner's to explain. `payoutMode` is a label, not a behaviour.

---

## S2 — everything that reads or writes the tiebreaker number

```bash
grep -rn "weeklyTiebreakers\|closestTiebreaker\|computeMNFTiebreakerTotal" \
  functions/src/ src/ shared/ --include=*.ts --include=*.tsx | grep -v "functions/src/shared"
```

**Must find:** the write in `submitNFLPicks`. If it does not, the grep missed
the writer and every conclusion below is unsafe.

**Result — the complete consumer set, and it is small:**

| Role | Location | What it does |
|---|---|---|
| **write** | `functions/src/nflPools.ts:556-558` | `submitNFLPicks` merges `{ [week]: tiebreakerPrediction }`; absent value writes nothing |
| **target** | `functions/src/nflScoringEngine.ts:491` | `computeMNFTiebreakerTotal` — sums home+away over every `isMonday` game, `null` until **all** are FINAL |
| **read** | `functions/src/nflPools.ts:1307-1313` | closest-guess winner → `closestTie`; **the only read in the scorer** |
| **recap** | `functions/src/nflScoringEngine.ts:786` | `recap.closestTiebreaker = { userId, userName, diff }` |
| **reveal** | `functions/src/nflPickReveal.ts:183, 219-220` | `getPoolPicks` includes it once the week is revealed |
| **render** | `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:663-667` | one recap-card line |
| **render** | `src/components/NFLPoolDashboard/NFLStandings.tsx` "MNF Score" column | prints `entry.weeklyTiebreakers[week]` — display only, not a sort key |
| **highlight gate** | `src/utils/recapHighlight.ts:33` | already treats an absent `closestTiebreaker` as fine |
| **entry** | `src/components/NFLPoolDashboard/PickemPickEntry.tsx:351, 613-630` | `showTiebreaker` + the input + the "both games" copy |

**Nothing in that list ranks anybody.** The plan's §1a claim holds.

---

## S3 — does anything rank a Pick'em week?

```bash
grep -n "buildStandingsRows" -A 32 functions/src/nflScoringEngine.ts
grep -n "sortByType\|copy.sort" -A 10 src/components/NFLPoolDashboard/NFLStandings.tsx
```

**Must find:** Margin's `rank` copy in `buildStandingsRows`. It is the only rank
the function emits, so if the grep shows no rank at all it is scoped wrong.

**Result:**

- `buildStandingsRows` (`nflScoringEngine.ts:712-754`) emits, for `NFL_PICKEM`:
  `totalScore`, `weeklyPoints`, `weeklyResults`. **No rank.** The one `rank` it
  copies is `NFL_MARGIN`'s (`:747-748`) — the must-find, present.
- `NFLStandings.tsx:64-71` sorts Pick'em by `totalScore` desc then `userName`.
  **Season-cumulative, no weekly column, no tiebreak.**
- The Margin cascade (`nflScoringEngine.ts:447-455`, "strict 5-level tiebreaker
  cascade") is a **season** ranking of a different pool type and does not use
  `weeklyTiebreakers` at all — checked so it is not mistaken for the thing this
  plan is about.

---

## S4 — can a client write `settings.weeklyTiebreaker`?

The plan claims no rules work is owed. That is the claim most expensive to get
wrong, so it is measured rather than assumed.

```bash
grep -n "nflSettingsWriteBlocked" -A 25 firestore.rules
grep -n "protectedFieldsUnchanged" -A 20 firestore.rules
```

**Must find:** a denial of the top-level `settings` key on NFL pools.

> ### 🛑 THIS SWEEP WAS WRONG, AND THE PLAN BUILT ON IT
>
> **Original conclusion: "NFL pool `settings` writes are denied to every client
> principal, so no rules change and no rules deploy is owed." That is false.**
> They are denied to **MANAGERS**. Caught by codex on the implementation PR,
> after the plan had been through ten review rounds carrying the claim.
>
> The misreading is one line of Boolean structure:
>
> ```
> allow update: if request.auth != null && callableOnlySettingsUnchanged() && (
>     (isPoolManager() && ... && nflSettingsWriteBlocked() && ...)
>     || isSuperAdmin()
> );
> ```
>
> `nflSettingsWriteBlocked()` is **inside the manager branch**, and
> `isSuperAdmin()` short-circuits the whole disjunction. The only check that
> applies to both principals is the one hoisted **outside** it — which, before
> this change, guarded exactly two survivor fields.
>
> So a SUPER_ADMIN client could write `settings.weeklyTiebreaker` directly and
> skip the callable's refusal entirely. #399 had already found and closed this
> for its own two fields; the rules file even explains the reasoning, three
> lines above the sweep's own quote. Reading the function and not the expression
> it sits in is the whole mistake.
>
> **Corrected consequence: this feature DOES owe a rules edit and a rules
> deploy.** `weeklyTiebreaker` joins the nested `callableOnlySettingsUnchanged()`
> guard.
>
> **The general lesson, which is worth more than the fix:** a guard's *position
> in the expression* is part of the guard. Grepping for the function name found
> the right code and answered the wrong question.

**Original result — `firestore.rules:138-158`.** `nflSettingsWriteBlocked()`
denies a top-level `settings` write on NFL pools, with the reasoning in-file: the
manager UI sends a complete `settings` replacement and `affectedKeys()` only
reports the top-level `settings` key, so a per-field rule cannot see inside it.
That much is accurate — and it is scoped to the manager branch.

What survives from the original three consequences:

1. ~~A new nested settings key is server-only from the moment it exists.~~
   **FALSE for SUPER_ADMIN.** Fixed by adding the field to the nested guard.
2. The `updatePoolSettings` callable is the write path the UI uses, and it is
   where §5's refusal goes. ✅ — but it was **not** the only door.
3. `tests/nfl-settings-lockdown.test.ts` pins this block, and its header records
   why it must be a source assertion: **this repo has no `firestore.rules` test
   harness** — the emulator suites use the Admin SDK, which bypasses rules
   entirely. ✅ **And that is exactly why this went unnoticed:** nothing in CI
   could have failed on it.

---

## S5 — does a new settings key need an editability-matrix change?

```bash
grep -n "KEY_GROUPS" -A 30 shared/editability.ts
```

**Must find:** `settings: 'settings'`.

**Result — `shared/editability.ts:52-77`.** `settings` is one whole editable
group; `classifyUpdateKey` maps the **top-level** key only. A new nested key
inherits the group's lifecycle rules with **no matrix edit**. `MATRIX` permits
the `settings` group in `draft` and `open`, and denies it in `locked` and
`archived` — so a locked pool already cannot change it, independently of §5's
own gate.

---

## S6 — what happens to the number when the rule changes mid-season?

Not a grep — the enumeration of harm the §5 gate exists to prevent. Recorded
here because both codex findings landed on it and the review log should not be
the only place it is written down.

| Transition | Members already submitted? | Harm |
|---|---|---|
| `MNF_COMBINED` → `MNF_LAST_GAME` | yes | A guess at a two-game total is re-read as a guess at one game. **codex R1.1** |
| `MNF_LAST_GAME` → `MNF_COMBINED` | yes | Mirror image, same harm |
| `NONE` → either MNF rule | yes | Members were **never asked**; `?? 0` invents a prediction of 0 for everyone. **codex R2.1** |
| either MNF rule → `NONE` | yes | Their submitted number stops being used. Mild — no false result is published — but still a rule change under them |
| any | **no** | Harmless; this is the window §5 leaves open |

The last two rows are why §5 refuses on the **transition**, not on the
direction: three of the four are harmful and the fourth is not worth a special
case.
