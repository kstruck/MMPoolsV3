# PLAN — delete the two inert Pick'em scoring controls

**Status:** ✅ **SIGNED. Kevin ruled 2026-08-22: DELETE THEM.** His words:
*"delete the controls and the rules-page rows, do not honour them in the
scorer."*

**Trigger:** `MORNING-2026-08-22-FIXES.md` §7 item **(a)**; the last open
`PLAN-HELP-SYSTEM` T9 coverage row.

**Gate:** `mmp-change-control` §1 — **scoring**. A plan is required because the
change is *about* the scorer's inputs, even though it removes rather than adds.
Taken deliberately: `CLAUDE.md` §4 says take the gate when in doubt, and a
change that touches money-bearing standings should be argued in writing even
when the argument is "nothing moves".

---

## 1. What is true today — measured, not remembered

Measured 2026-08-22 against `origin/main` @ `8455ec53`.

### 1a. Neither field is read by anything that scores

`scorePickemEntry` ([functions/src/nflScoringEngine.ts](functions/src/nflScoringEngine.ts))
is the whole of Pick'em scoring:

```ts
if (confidenceMode) {
  points += entry.confidence?.[gameId] ?? 0;
} else {
  points += 1; // Standard scoring
}
```

**One point per correct pick.** `settings.pointsPerPick` is never read.
`settings.primetimeBonus` is never read — by the scorer or by anything else
that computes a number. `src/utils/nflResults.ts` already carries a comment
saying so, and `src/utils/nflResults.test.ts` already has a test pinning it.

### 1b. But three surfaces tell members otherwise

| Surface | What it says |
|---|---|
| `NFLManagerView.tsx` | lets a commissioner set base points 1–10 and three primetime bonuses 0–10 |
| `NFLPoolRules.tsx` | shows those numbers **to members** under "Scoring Config" as what a pick is worth |
| `JoinPool.tsx` | shows them in the rules preview **before somebody joins** |

A pool set to 3 tells its members three and pays one. On `JoinPool` it is a
claim made to someone deciding whether to hand over an entry fee.

### 1c. Where the value is stored, and what stores it

- `shared/schemas/nfl.ts` — `pointsPerPick: z.number().optional()`.
- `src/types/nflPoolTypes.ts` — both fields, optional.
- **No create-wizard control writes either.** The only writer is the manager
  settings save.

So a stored non-1 value can only exist on a pool whose commissioner used that
manager control. **Production cardinality is UNMEASURED** and this plan does not
depend on it — see §3.

---

## 2. The two options, and why Kevin chose deletion

### Option A — honour them in the scorer (REJECTED)

`scorePickemEntry` would read `settings.pointsPerPick` and add the primetime
bonuses.

**Why it was rejected, in Kevin's words:** honouring them *"would retroactively
change the standings of any already-scored week in a pool with a stored non-1
value, mid-season, on a live scorer with money attached."*

That is exactly right and worth stating precisely. `nflAutoScoreJob` regrades;
`scoreNFLWeek` regrades on demand. A pool holding `pointsPerPick: 3` that has
already published scored weeks would have every one of those weeks recomputed at
3× on the next pass — new standings, possibly a different weekly winner, for a
week members have already read as final. There is no migration that avoids it,
because the field is stored per pool and the scorer has no record of what it
paid last time.

### Option B — delete the controls (CHOSEN)

Remove the manager controls, the rules-page rows and the join-page preview
lines. **Do not touch the scorer.** The false claim disappears; the number a
pick is worth does not change, because it was already 1 and stays 1.

### Not on the table

**Weighted scoring as a feature.** That is a plan, a migration and a decision
about in-flight weeks. Kevin ruled it out for tonight explicitly. This plan
must not "helpfully" implement it.

---

## 3. What changes, and what does not

### Changes

| File | Change |
|---|---|
| `src/components/NFLPoolDashboard/NFLManagerView.tsx` | delete the 4 state hooks, the 2 lines in the save payload, the "Scoring Configuration" card |
| `src/components/NFLPoolDashboard/NFLPoolRules.tsx` | delete the "Base Points Per Pick" row and the three primetime rows; the standard-scoring sentence names 1 point directly |
| `src/components/JoinPool.tsx` | the base-scoring bullet names 1 point; the primetime bullet is removed |
| `src/help/coverage-allowlist.ts` | `settings.pointsPerPick` moves from `T9-BLOCKED` to a settled reason |

### Explicitly does NOT change

- **`functions/` — nothing.** No deploy. `scorePickemEntry` is untouched, which
  is the point: **no scoring behaviour changes, in any pool, in any week,
  already scored or not.**
- **`firestore.rules` — nothing.**
- **`shared/schemas/nfl.ts` — `pointsPerPick` stays.** Removing it would make
  the create schema *reject* a payload carrying the field, which is a live
  behaviour change for a field this plan is trying to make inert-and-harmless
  rather than forbidden.
- **Stored values — untouched.** A pool holding `pointsPerPick: 3` keeps
  holding it. **Deleting a control is not a data migration**, so this stays
  clear of the production-data gate; there is no script, nothing to run against
  prod, and nothing to roll back in Firestore.
- **`src/types/nflPoolTypes.ts` — the fields stay**, annotated as historical.
  They still exist on stored documents and a type that denied them would be
  lying in the other direction.

### The one visible consequence

A commissioner who had set 3 will see the control gone and the rules page say
1 point. **That is the correction, not a regression** — 1 point is what their
pool has always paid.

---

## 4. Rollback

`git revert` the PR. Nothing in Firestore moved, no function was deployed, and
no stored value was read or written differently, so a revert restores the
previous UI exactly. There is no state to reconcile.

---

## 5. Evidence required before this is called done

1. `scorePickemEntry` is byte-identical in the diff (`git diff` shows no
   `functions/` change at all).
2. A test asserting standard Pick'em scoring is 1 point per correct pick
   **regardless of a stored `pointsPerPick`** — the claim the deletion rests
   on, made checkable rather than asserted. `src/utils/nflResults.test.ts`
   already pins the mirror; the scorer itself gets the same fixture.
3. A grep guard: no surface renders `settings.pointsPerPick` or
   `settings.primetimeBonus` as a points value again. This is the guard that
   matters — the failure mode is a future edit re-adding the display, not
   re-adding the control.
4. The T9 coverage row reads as settled, and `help-schema-audit` stays green.

---

## 6. Open, and deliberately left open

- **How many production pools hold a non-1 `pointsPerPick`.** Unmeasured, and
  this plan is correct either way: if the answer is zero the deletion removes a
  control nobody used, and if it is not zero the deletion removes a claim those
  pools were making falsely. Worth a census read some day; not a blocker.
- **Whether weighted scoring should exist at all.** A separate plan, if ever.
