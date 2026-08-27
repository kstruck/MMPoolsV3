# PLAN — a Monday-less week must not silently cancel the tiebreaker

**Status: 🟢 SIGNED 2026-08-27 by Kevin — "Go with A & D - If no Monday night
game, then fall back to the last game of the week."**

Plan-gated under `mmp-change-control` §1: this changes **what decides a tied
week**, which is the *scoring* trigger. The gate is PLAN → adversarial review log
→ sweeps → sign-off → implement.

**Every claim below is measured against `origin/main` @ `a85c6fbf`.** Re-read
`git rev-parse origin/main` before acting on it.

---

## 1. The defect, stated exactly

A Pick'em pool whose `settings.weeklyTiebreaker` is **absent or junk** resolves
to the legacy `MNF_COMBINED` (`effectiveWeeklyTiebreaker`, and that resolution is
deliberate — it is the no-migration story for every pool created before the
setting existed).

`resolveTiebreakTargetIds` (`shared/nflTiebreaker.ts:111-121`) then does this:

```ts
if (rule === 'MNF_COMBINED') return monday.map(g => String(g.id));   // → [] when no Monday game
if (monday.length === 0) return [String(ordered[ordered.length - 1].id)];
```

`MNF_LAST_GAME` and `MNF_FIRST_GAME` reach the Monday-less fallback on line 119.
**`MNF_COMBINED` returns on line 118 and never gets there.** On a week with no
Monday game it yields `[]`.

Downstream, in the pick sheet:

- `PickemPickEntry.tsx:518-522` — `frozen ?? resolveTiebreakTargetIds(...)`
- `PickemPickEntry.tsx:530` — `const showTiebreaker = tiebreakTargetIds.length > 0`
- `PickemPickEntry.tsx:821` — the tiebreaker card is gated on `showTiebreaker`

**So the input is not rendered.** Meanwhile `NFLPoolRules.tsx:170-181` renders,
unconditionally for any non-`NONE` rule:

> **Weekly Tie:** Closest to the combined Monday total
> Level on points? The player whose predicted score is closest wins the week.

The rules page promises a tiebreaker the sheet never asks for.

### Observed in production, 2026-08-27

Kevin's pool, preseason slate (FRI 6:00 PM / FRI 7:00 PM / SAT 11:00 AM /
SAT 4:00 PM — **no Monday game**), 16 of 16 picks saved, **no tiebreaker input**,
rules card showing the `MNF_COMBINED` copy branch verbatim.

**This is not a regression.** No code changed. The previous week had a Monday
game and rendered the input. The slate changed.

### What is NOT broken

`computeMNFTiebreakerTotal` (`functions/src/nflScoringEngine.ts:533-552`) returns
`null` on an empty target, and a tied week is then shared (D3). Nothing crashes
and nothing is mis-ranked. **This is a rules-copy lie, not a scoring error** —
but the member-visible effect is that they are told a number decides tied weeks
and are never asked for one.

---

## 2. Blast radius

| Population | Exposed? | Evidence |
|---|---|---|
| Wizard-created Pick'em pools | **No** | `CreateNFLPickemPool.tsx:131` writes `DEFAULT_NEW_POOL_TIEBREAKER` (`MNF_LAST_GAME`); `buildNFLPayload.ts:86` spreads `v.settings` through |
| Pools created before 2026-08-13 | **Yes** | the setting did not exist; absent ⇒ `MNF_COMBINED` |
| Simulator / scenario pools | **Yes** | no test-fixture path writes `settings.weeklyTiebreaker` (grep: only `weeklyTiebreakers`, the *entry* predictions — a different field) |
| `NONE` pools | No | asking nothing is the rule, and the rules page says so |

---

## 3. Two constraints that rule out the obvious fixes

**C1 — the pool's setting cannot be changed.** `weeklyTiebreakerGate.ts` refuses
with `TIEBREAKER_LOCKED_AFTER_SUBMISSIONS` once any member has submitted:
*"they answered the old question, or were never asked the new one."* The pool has
16 of 16 picks saved. That door is closed, and correctly so.

**C2 — a code fix alone does NOT restore a week already in flight.**
`nflPools.ts:614-628` freezes the week's target on the first submission —
**including an empty one, deliberately** (qodo #9 on #452) — into
`pool.frozenTiebreakTargets[week]`. The sheet reads `frozen ?? resolved`, and
`[]` is not nullish, so **a frozen `[]` beats any fixed resolver.**

🛑 **AND THE FREEZE IS RIGHT, WHICH IS WHY THIS PLAN DOES NOT TOUCH IT.** Its
purpose is that a target must not be *added* under members who already submitted:
they would hold no prediction and lose a tied week to anyone submitting later.
That is precisely the harm here. **The fix therefore takes effect from the next
unfrozen week onward, and the week in Kevin's screenshot stays shared-on-tie.**
Said plainly rather than discovered later.

---

## 4. The change — A and D, as signed

### A. `MNF_COMBINED` gets the same Monday-less fallback

Reorder two lines in `resolveTiebreakTargetIds` so the Monday-less fallback
applies to **every** rule that asks for a prediction:

```ts
if (rule === 'NONE' || games.length === 0) return [];
const ordered = byKickoff(games);
const monday = ordered.filter(g => g.isMonday === true);
if (monday.length === 0) return [String(ordered[ordered.length - 1].id)];   // ← now covers COMBINED
if (rule === 'MNF_COMBINED') return monday.map(g => String(g.id));
return [String(rule === 'MNF_LAST_GAME' ? monday[monday.length - 1].id : monday[0].id)];
```

A Monday-ful week is **unchanged for every rule** — that is the whole safety
argument, and the tests pin it.

Copy that asserted the old behaviour is corrected in the same commit:
`resolveTiebreakTargetIds`' own doc block, `tiebreakerCopy('MNF_COMBINED').hint`
(the only one of the three hints lacking the Monday-less sentence),
`computeMNFTiebreakerTotal`'s doc block, and `NFLPoolRules.tsx:178-181`.

### D. One definition of "this week's target", and a sheet that cannot go silent

**D1 — kill the triple duplication.** The precedence rule `frozen ?? resolved` is
hand-rolled in three places today:

| Site | Today |
|---|---|
| `PickemPickEntry.tsx:520` | `frozenTiebreakTargetFor(...) ?? resolveTiebreakTargetIds(...)` |
| `nflPools.ts:615-617` | `frozenTarget ?? canonicalTarget` |
| `nflScoringEngine.ts:543-545` | `frozenTargetIds !== undefined ? frozenTargetIds : resolve(...)` |

Export **one** `weekTiebreakTargetIds(pool, week, games, rule)` from
`shared/nflTiebreaker.ts` and have all three call it. Three copies of a
precedence rule is three chances to fix it in two places.

**D2 — the sheet states the case instead of rendering nothing.** When the pool's
rule asks for a prediction but the week has no target, the sheet renders an
explicit line saying this week has no tiebreaker and a tied week is shared.
**This is the half that actually closes the contradiction**, because it lands at
the exact place the member noticed it. Today the sheet's silence is
indistinguishable from a bug — which is how this reached production.

**D3 — a test pins sheet-and-rules agreement**, so a future surface cannot
re-open the gap.

### Out of scope

- **Option C (clearing an already-frozen empty target).** Not signed. It is
  prod-data mutation and would need kill-switch + dryRun-default + cap under
  Rule 1. Named here so its absence is a decision, not an oversight.
- Changing `effectiveWeeklyTiebreaker`'s absent-⇒-`MNF_COMBINED` resolution.
  That is the no-migration story and is load-bearing.
- Making the simulator write `settings.weeklyTiebreaker`. A is a superset fix:
  it repairs those pools without touching the fixtures.
- `NFLStandings.tsx:95` / `NFLManagerView.tsx:1139`. Both are **pool-level**
  questions ("does this pool use a tiebreaker?") and `tiebreakerAsksForPrediction`
  is the right predicate for them. After A they no longer disagree with the sheet
  except on a frozen-empty legacy week, which D2 explains at the sheet.

---

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | A changes what a legacy pool plays | Only on Monday-less weeks, and only unfrozen ones. Monday-ful weeks are byte-identical — pinned by test. §0's concern was in-flight weeks; the freeze already protects those. |
| R2 | The scorer and the sheet disagree during the rollout window | Both read the same `shared/` function. The deploy ritual is functions-then-frontend; a frontend still on the old bundle simply keeps hiding the input, which is today's behaviour, not a new failure. |
| R3 | A frozen `[]` makes D2's note appear on a week whose rules page promises a tiebreaker | That is the honest state and D2 exists to say it out loud. |
| R4 | The scorer is LIVE (`nflAutoScoreJob` `*/5`, `{enabled:true, dryRun:false}`) | `computeMNFTiebreakerTotal` already handles a non-empty target on every rule; A only widens which weeks have one. Full emulator suite before merge. |

---

## 6. Evidence required before "done"

1. All five gates green with real numbers reported.
2. **Every new guard mutation-tested** — broken on purpose, proven red, restored.
3. `codex exec review --base origin/main`, clean, plus own read of the diff.
4. The existing test that pins the OLD behaviour
   (`tests/weekly-tiebreaker-contract.test.ts:230-235`) is **updated, not
   deleted** — it becomes the test that pins the NEW behaviour.
