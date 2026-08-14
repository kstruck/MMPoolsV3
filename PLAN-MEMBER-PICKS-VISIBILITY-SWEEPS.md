# PLAN-MEMBER-PICKS-VISIBILITY — sweeps

Deterministic, re-runnable greps building COMPLETE instance lists for the claims
the plan rests on. Run from the repo root. Ticket **T7**.

---

## S1 — Is `nflPickReveal.ts` on any scoring path? (risk R1)

R1 is the reason this change is frightening: it deploys into a live scorer
(`nflAutoScoreJob` `*/5`). The plan asserted the callable is isolated; this
proves it.

```bash
grep -rn "nflPickReveal\|lib/pickReveal" functions/src --include=*.ts | grep -v "__tests__"
```

**Complete result — two lines, and they are the same file:**

| Importer | Imports |
|---|---|
| `functions/src/nflPickReveal.ts:34` | `./lib/pickReveal` |
| `functions/src/index.ts:53` | `export { getPoolPicks } from "./nflPickReveal"` |

```bash
grep -rln "pickReveal" functions/src/nflScoringEngine.ts functions/src/nflPools.ts functions/src/nflAutoScore.ts
```

**Empty.** No scoring or finalization file imports either module.

✅ **`lib/pickReveal` has exactly ONE consumer (`nflPickReveal.ts`), and
`nflPickReveal.ts` has exactly ONE consumer (the `index.ts` export).** The
callable is a leaf. Editing it cannot change a score.

⚠️ **This is the property to re-run, not to remember.** If a future change makes
the scorer import `lib/pickReveal` — plausible, since "is this week locked" is a
question the scorer also asks — R1 stops being satisfied and this sweep is how
you find out.

---

## S2 — Every runtime caller of `getPoolPicks`

```bash
grep -rn "getPoolPicks" src/ --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Twenty hits. **Nineteen are comments, doc strings or type names.** The complete
list of code that actually CALLS it:

| Site | What |
|---|---|
| `src/services/dbService.ts:1648-1651` | the `httpsCallable` wrapper — the only place the callable is invoked |
| `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:201` | the only caller of that wrapper |

✅ **One call site.** Everything the response reaches, it reaches through
`NFLPoolDashboard`'s `weekReveal`.

---

## S3 — Where `counts` flows, and why K1 needs no client change

K1 withholds `counts` from members until the reveal. This sweep answers "which
surfaces would have started showing it".

```bash
grep -rn "pickCounts\|weekReveal?.counts" src/ --include=*.tsx --include=*.ts | grep -v "\.test\."
```

| Consumer | Audience | Reached via |
|---|---|---|
| `NFLManagerView` → `NFLManagerBentoDashboard` | commissioner only | `NFLPoolDashboard.tsx:852` |
| **`NFLStandings`** | 🛑 **EVERY MEMBER** | `NFLPoolDashboard.tsx:712` |
| `NFLPicksGrid` | commissioner today, members after this change | the `reveal` prop |
| `src/utils/poolRoster.ts:291` | commissioner roster / reminders | via `NFLManagerView` |

🛑 **`NFLStandings` is the one that matters and it is easy to miss.** It is
member-facing and already wired to `weekReveal?.counts` — it renders nothing
today only because `weekReveal` is `null` for a member (the `isManager` gate on
the fetch). The moment members are admitted, **that column starts printing
"14 of 16 Picks Set" for every player with no further change**.

✅ **Withholding `counts` SERVER-SIDE (K1/T2) therefore covers this surface for
free**, and is the reason no client edit is needed here. Had K1 been implemented
in the grid instead, the standings column would have leaked it.

**Pinned by a test**, because "it happens to be safe" is not a guard.

---

## S4 — Every client write of `participantIds` (does K9 break anything?)

Kevin's K9 ruling adds `participantIds` to `protectedFieldsUnchanged()`. That
governs client UPDATEs, so it breaks any client flow that writes the array.

```bash
grep -rn "participantIds" src/ --include=*.ts --include=*.tsx
```

**Complete result: 21 hits, ZERO writes.** Every one is a read
(`BillingGate.tsx:259`, `GlobalStandingsCard.tsx:36-37`, `memberStandings.ts:166`,
the `array-contains` query at `dbService.ts:887`), a type declaration
(`types/index.ts`, `types/nflPoolTypes.ts`), a test fixture, or the `[]` default
in `constants.ts:93`.

Two structural reasons this holds:

1. **Pool CREATE is server-only** — `firestore.rules`: *"NO CREATE via Client
   (must use createPool function)"*. The `constants.ts` default never reaches a
   client write, and `protectedFieldsUnchanged()` governs UPDATE regardless.
2. **Every join / removal path is Admin SDK**, which bypasses rules entirely —
   e.g. `functions/src/lib/memberRecord.ts:173-176` (`arrayRemove`). Joining,
   leaving and removal keep working untouched.

⚠️ **The one residual, with a precedent in this exact function.** The pool
wizards send full-object updates and may include `participantIds` unchanged.
That is safe — **a same-value write is not an `affectedKey`** — and it is the
same reasoning already written down for the `type` field in
`protectedFieldsUnchanged()`. A wizard sending a **stale** array would now be
rejected rather than silently overwriting the roster, which is the fix working.
**Verify against the rules test suite before deploy; do not assume it.**

---

## S5 — Surfaces that render another member's pick

Scoped to the NFL dashboards. Bracket surfaces (`BracketAwards`,
`BracketComparison`, `PoolAnalytics`, `EliminationTracker`, …) all read
`entry.picks` too, but bracket and playoff pools are **out of scope** — the
callable refuses non-NFL types and their reveal model is single-lock by design.

| Surface | Renders | Source of the pick |
|---|---|---|
| `NFLStandings.tsx:264` (`pickCell`) | Survivor + Margin weekly pick | `entry.picks[week]`, grafted by `buildMemberStandings` from the reveal |
| `NFLPicksGrid.tsx` | the Pick'em grid | `picksGridCell`, gated on `revealedGameIds` |
| `NFLUserBentoDashboard` / `PickemPickEntry` etc. | the viewer's OWN picks | their own entry document |

✅ **Exactly two surfaces show a pick belonging to someone else**, and both take
it from the same grafted `entries` rows. A third (the Margin/Survivor grid, T4)
is what this plan adds.

---

## Re-verification

Every command above is deterministic and safe to re-run. If any result changes,
the plan's corresponding claim is stale — **S1 and S4 are the two that would
turn a safe change into an unsafe one**, so re-run both immediately before the
deploy, not only at authoring time.
