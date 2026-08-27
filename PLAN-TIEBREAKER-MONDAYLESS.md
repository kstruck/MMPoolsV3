# PLAN — the Monday-less week has no tie-breaker input, and the rules page says it does

**Status: ✅ SIGNED — Kevin ruled "A & D" (2026-08-27): *"If no Monday night game,
then fall back to the last game of the week."* This document records a decision
already made; it is not asking for one.**

Classification: **scoring** → plan-gated (`mmp-change-control` §1, Rule 3).
Written 2026-08-27. Sibling documents: `PLAN-TIEBREAKER-MONDAYLESS-REVIEW-LOG.md`
(codex rounds), `PLAN-TIEBREAKER-MONDAYLESS-SWEEPS.md` (the complete
`frozen ?? resolved` instance list).

---

## 1. The defect

A Pick'em pool whose `settings.weeklyTiebreaker` is absent or junk resolves to
the legacy `MNF_COMBINED` (`effectiveWeeklyTiebreaker`, `shared/nflTiebreaker.ts`
— deliberate, and the whole no-migration story). On a week with **no Monday
game**, `resolveTiebreakTargetIds` returns `[]` for that rule and only that rule:

```ts
if (rule === 'MNF_COMBINED') return monday.map(g => String(g.id));   // [] when no Monday game
if (monday.length === 0) return [String(ordered[ordered.length - 1].id)];  // never reached
```

`MNF_LAST_GAME` and `MNF_FIRST_GAME` reach the Monday-less fallback on the second
line. `MNF_COMBINED` returns on the first and never gets there.

Downstream, `PickemPickEntry.tsx` gates the whole tiebreaker card on
`showTiebreaker = tiebreakTargetIds.length > 0`, so **no input renders** — while
`NFLPoolRules.tsx` unconditionally promises "Closest to the combined Monday
total" and "the player whose predicted score is closest wins the week."

**Observed in production 2026-08-27:** a preseason slate (FRI 6:00pm / FRI 7:00pm
/ SAT 11:00am / SAT 4:00pm — no Monday game), 16 of 16 picks saved, no tiebreaker
input, rules card showing the `MNF_COMBINED` copy branch verbatim.

**Not a regression.** No code changed; the previous week's slate had a Monday
game.

**Not a scoring crash.** `computeMNFTiebreakerTotal` returns `null` on an empty
target and the tie is shared (PLAN-WEEKLY-PRIZES D3). Nothing mis-ranks.

**It is a rules-copy lie.** Members are told a number decides tied weeks and are
never asked for one.

### Blast radius

| Population | Exposed? | Why |
|---|---|---|
| Wizard-created pools | **No** | `CreateNFLPickemPool.tsx` writes `DEFAULT_NEW_POOL_TIEBREAKER` (`MNF_LAST_GAME`); `buildNFLPayload.ts` spreads `v.settings` through. |
| Pools created before 2026-08-13 | **Yes** | No `settings.weeklyTiebreaker` stored ⇒ `MNF_COMBINED`. |
| Every simulator / scenario pool | **Yes** | No test-fixture path writes `settings.weeklyTiebreaker`. The JSON fixtures write `weeklyTiebreakers` — the entry *predictions*, a different field. |

---

## 2. Two constraints that shape the fix

### C1 — the pool's setting cannot simply be changed

`weeklyTiebreakerGate.ts` refuses with `TIEBREAKER_LOCKED_AFTER_SUBMISSIONS`
once anyone has submitted: *"they answered the old question, or were never asked
the new one."* The observed pool has 16/16 saved. The gate is correctly closed
and is not being weakened.

### C2 🛑 — a code fix does NOT restore a week already in flight

`nflPools.ts` freezes the week's target on the **first submission — including an
empty one, deliberately** (qodo #9 on #452) — into
`pool.frozenTiebreakTargets[week]`. Every reader resolves `frozen ?? resolved`,
and `[]` is not nullish, so a frozen `[]` beats any fixed resolver.

**The freeze is not being "fixed".** Its purpose is that a target must not be
ADDED under members who already submitted — they would hold no prediction and
lose a tied week to anyone submitting later, which is precisely the harm here.

⇒ **The fix takes effect from the next UNFROZEN week onward. The week in Kevin's
screenshot stays shared-on-tie.** This must be stated in the PR body and is the
reason D2 exists.

---

## 3. A — the resolver change

Reorder two lines so the Monday-less fallback covers every rule that asks for a
prediction:

```ts
if (rule === 'NONE' || games.length === 0) return [];
const ordered = byKickoff(games);
const monday = ordered.filter(g => g.isMonday === true);
if (monday.length === 0) return [String(ordered[ordered.length - 1].id)];   // ← now covers COMBINED
if (rule === 'MNF_COMBINED') return monday.map(g => String(g.id));
return [String(rule === 'MNF_LAST_GAME' ? monday[monday.length - 1].id : monday[0].id)];
```

**A Monday-FUL week must be byte-identical for every rule.** That is the whole
safety argument — the reorder can only change behaviour on the branch where
`monday.length === 0`, and under `MNF_COMBINED` that branch previously returned
`[]`, i.e. "no question asked". It is pinned by test rather than asserted.

### The copy that asserts the old behaviour, corrected in the same commit

| Site | Today | Why it is wrong after A |
|---|---|---|
| `shared/nflTiebreaker.ts` — `resolveTiebreakTargetIds` doc block | "`MNF_COMBINED` → … no Monday game → `[]`. Deliberately NO fallback" | The fallback now applies. |
| `shared/nflTiebreaker.ts` — `tiebreakerCopy('MNF_COMBINED').hint` | The only one of the three hints lacking the "on a week with no Monday game" sentence | Member-facing. |
| `functions/src/nflScoringEngine.ts` — `computeMNFTiebreakerTotal` doc block | "`MNF_COMBINED` — every Monday game (legacy; no Monday game → no target)" | Same. |
| `src/components/NFLPoolDashboard/NFLPoolRules.tsx` | The `MNF_COMBINED` branch of the sub-line omits the fallback sentence the other two carry | Member-facing; this is the surface that lied. |
| `src/help/content/wizard-shared.ts` — `settings.weeklyTiebreaker` long template, `MNF_COMBINED` branch | "On a week with no Monday game nothing is predicted, and everyone level at the top of that week shares it." | Member-facing, and **not named in the original brief** — found by the sweep. |
| `src/help/content/wizard-shared.ts` — the same topic's `long.fallback` | "A few older pools ask about every Monday game together. Those ask for nothing on a week with no Monday game." | Same. |

---

## 4. D — one definition, and a sheet that cannot go silent

### D1 — `weekTiebreakTargetIds`, exported once

The precedence rule `frozen ?? resolved` is hand-rolled in **three** places (the
complete list is the sweep doc):

| Site | Today |
|---|---|
| `src/components/NFLPoolDashboard/PickemPickEntry.tsx` | `frozenTiebreakTargetFor(...) ?? resolveTiebreakTargetIds(...)` |
| `functions/src/nflPools.ts` (submit path) | `frozenTarget ?? canonicalTarget` |
| `functions/src/nflScoringEngine.ts` (`computeMNFTiebreakerTotal`) | `frozenTargetIds !== undefined ? frozenTargetIds : resolve(...)` |

Export ONE function from `shared/nflTiebreaker.ts` and have all three call it:

```ts
export function weekTiebreakTargetIds(pool, week, games, rule): string[]
```

The submit path still needs `frozenTiebreakTargetFor` separately, because it must
know whether a freeze **exists** in order to decide whether to write one. That is
a different question from "what is this week's target", and the two are kept
distinct rather than fused.

`computeMNFTiebreakerTotal` keeps its `frozenTargetIds` parameter — it is a pure
schedule-and-list function used directly by twenty-plus unit tests, and giving it
a `pool` would be a signature change with no correctness gain. It routes its
precedence through the shared primitive `applyFrozenTarget(frozen, games, rule)`
that `weekTiebreakTargetIds` is itself built from, so there is still exactly ONE
definition of the precedence rule.

### D2 — the half that actually closes the contradiction

When the pool's rule **asks for a prediction** but the week has **no target**,
the pick sheet must render an explicit line — *this week has no tiebreaker, a
tied week is shared* — instead of rendering nothing.

Today the silence is indistinguishable from a bug, which is how this reached
production. It lands where the member noticed it. **After A this state is rarer,
but it is not gone:** a frozen `[]` from a week that was in flight before the fix
still resolves to no target, and that is exactly the week Kevin is looking at.

### D3 — a test pinning sheet-and-rules agreement

So a future surface cannot reopen the gap.

### D4 — the rollout window (added after codex round 1, finding R1-1)

🛑 **Functions and the www frontend deploy SEPARATELY** (CLAUDE.md §3 — Coolify
is a manual trigger). So there is a real window, and stale browser tabs extend
it past the deploy, in which the SERVER knows about the fallback and a member's
loaded bundle does not.

That member's legacy `MNF_COMBINED` sheet renders no tiebreaker card, and sends
neither a prediction nor `displayedTiebreakTargetIds`. If the server froze the
fallback game on that submission, the next member to reload WOULD see the card,
answer it, and take any tied week outright — `computeWeeklyWinners` **drops** a
leader with no prediction the moment another leader has one
(`nflScoringEngine.ts`: *"they lose a tiebreak somebody else can win"*). That is
the same harm C2 protects against, arriving through a code change instead of a
schedule change.

**Deploying the frontend first is not an escape.** A new sheet sends the
fallback id, an old server resolves `[]`, and `sameTargetIds` refuses every
submission with `TIEBREAK_TARGET_STALE`. Both orders are unsafe.

**The guard.** On the ONE week whose meaning this release changed — a legacy
`MNF_COMBINED` pool with no Monday game — a submission that did NOT take part in
the handshake freezes what the previous release would have frozen, `[]`. Nobody
in that week is asked, and a tied week is shared.

```ts
const noMondayGame = games.every(g => g.isMonday !== true);
const introducesNewQuestion =
  tiebreakRule === 'MNF_COMBINED' && noMondayGame && displayedTargetIds === undefined;
```

**Self-expiring.** A current sheet always sends the list when it asks
(`displayedTiebreakTargetIds: showTiebreaker ? tiebreakTargetIds : undefined`),
so once the frontend is deployed this branch stops firing and every Monday-less
week freezes the fallback normally.

**Deliberately NOT widened past `MNF_COMBINED`.** A pre-#452 client sends no
displayed list either, so a universal handshake requirement would withhold a
target the previous release already gave — a regression. Pinned by emulator
test 5e.

---

## 5. Out of scope — named so the absence is a decision

| Not doing | Why |
|---|---|
| **Option C** — clearing an already-frozen empty target | **NOT signed.** It is prod-data mutation and would need kill-switch + dryRun-default + cap under Rule 1. Not built unless Kevin asks. |
| Changing `effectiveWeeklyTiebreaker`'s absent ⇒ `MNF_COMBINED` resolution | That is the no-migration story and is load-bearing. |
| Making simulators write `settings.weeklyTiebreaker` | A is a superset fix. |
| `NFLStandings.tsx` and `NFLManagerView.tsx` | Both ask a POOL-level question; `tiebreakerAsksForPrediction` is the right predicate there. |
| Weakening `TIEBREAKER_LOCKED_AFTER_SUBMISSIONS` | C1. |

---

## 6. Risks

- 🔴 **The scorer is LIVE.** `system/config.nflAutoScore` is
  `{enabled: true, dryRun: false}` and `nflAutoScoreJob` runs `*/5` in
  production. A only widens which weeks have a target;
  `computeMNFTiebreakerTotal` already handles a non-empty target under every
  rule, and A cannot change a Monday-ful week. The full emulator suite runs
  before merge.
- **A legacy pool's Monday-less week now asks a question it did not ask
  before.** That is the point of the ruling, and it applies only to weeks not
  yet frozen — C2. An in-flight week keeps its meaning, which is
  PLAN-WEEKLY-PRIZES §0's invariant, unbroken.
- **No `firestore.rules` change.** `frozenTiebreakTargets` is already
  server-only and its shape is unchanged.
- **No prod-data mutation.** Nothing to backfill; nothing to run.

---

## 7. Implementation status

| Item | Status | Commit |
|---|---|---|
| A — resolver reorder + 6 copy corrections | ✅ | this branch |
| D1 — `weekTiebreakTargetIds` / `applyFrozenTarget`, 3 call sites | ✅ | this branch |
| D2 — the "no tiebreaker this week" line on the pick sheet | ✅ | this branch |
| D3 — sheet-and-rules agreement test | ✅ | this branch |
| `tests/weekly-tiebreaker-contract.test.ts` updated to pin the NEW behaviour | ✅ | this branch |
