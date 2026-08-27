# PLAN-TIEBREAKER-MONDAYLESS — adversarial review log

Reviewer: `codex exec review --base origin/main` (OpenAI), per CLAUDE.md §2c.
qodo is **DORMANT** (§2b), so the stopping rule here is TWO conditions: a codex
round comes back clean AND my own read of the diff agrees.

Cap: 10 rounds.

---

## Round 1 — codex

**VERDICT: REVISE.** One finding, P1, **ACCEPTED**.

> **[P1] Do not freeze a new target for clients that never displayed it** —
> `shared/nflTiebreaker.ts:160`
>
> When the functions deploy precedes hosting (these are separate deploy scripts)
> or a member still has the prior JS loaded, a legacy `MNF_COMBINED` Monday-less
> sheet submits neither a prediction nor `displayedTiebreakTargetIds`, because it
> rendered no card. The server accepts that request and now freezes this fallback
> game; a subsequently refreshed member sees the input and can supply a
> prediction, while the first member has none and loses any points tie. Preserve
> the no-target behavior for requests that did not participate in the target
> handshake, or otherwise make this rollout transition-safe.

### Response — ACCEPTED, verified before acting

Three claims checked against the code rather than taken on trust:

1. **"loses any points tie"** — CONFIRMED. `computeWeeklyWinners`
   (`functions/src/nflScoringEngine.ts`) filters leaders to
   `typeof c.tiebreakDiff === 'number'` and returns the closest of those. Its own
   doc block: *"they lose a tiebreak somebody else can win, but two
   non-answerers tie with each other and share."* So one answerer among the
   leaders is enough to drop every non-answerer.
2. **"separate deploy scripts"** — CONFIRMED. CLAUDE.md §3: functions and rules
   go out with `npx firebase deploy`; the www frontend is *"a manual trigger in
   the Coolify dashboard — pushing to `main` does not auto-deploy the frontend."*
   The window is however long that gap is, and an open tab extends it further.
3. **Whether deploying the frontend FIRST avoids it** — it does NOT, and codex
   did not check this. A new sheet sends `displayedTiebreakTargetIds: ['sun']`;
   an old server resolves `canonicalTarget` to `[]`; `sameTargetIds(['sun'], [])`
   is false and the submit is refused with `TIEBREAK_TARGET_STALE`. **Both
   orders are unsafe**, which strengthens the finding — an operational
   work-around does not exist, so the fix has to be in the code.

**What changed.** `functions/src/nflPools.ts`, the freeze write. On the one week
whose meaning this release changed — legacy `MNF_COMBINED`, no Monday game — a
submission that did not take part in the handshake freezes `[]`, the previous
release's answer. Nobody in that week is asked; a tied week is shared. Plan §4
D4 records it.

**Two things deliberately NOT done, with reasons:**

- **Not "preserve the no-target behavior for requests that did not participate"
  in general.** A pre-#452 client sends no displayed list either, so a universal
  handshake requirement would withhold a target the previous release already
  gave — a regression on every rule, not a fix. Scoped to `MNF_COMBINED` +
  Monday-less, and emulator test 5e pins that scoping.
- **Not a scoring change.** Making a missing prediction share rather than lose
  would have closed the finding too, and it is out of scope, unsigned, and
  would alter every pool's tiebreak semantics to patch a rollout window.

**Guards added:** emulator 5d (the window itself) and 5e (the guard is not
over-broad). **Mutation-tested:**

| Mutation | Result |
|---|---|
| Disable the guard (`false && …`) | 🔴 5d red |
| Widen it past `MNF_COMBINED` | 🔴 5e red, and test 6 (`MNF_FIRST_GAME` Monday-less) red |

---

## Round 2 — codex

**VERDICT: REVISE.** Two findings, both P2, both **ACCEPTED**. Both are defects
in the round-1 FIX, which is the pattern §2c warns about: *"round 1 finds defects
in the code, and rounds 2+ find defects in the fixes."*

> **[P2] Preserve the fallback for simulation submissions** —
> `functions/src/nflPools.ts:657-659`
>
> When `simSubmitPicks` submits a legacy pool on a Monday-less slate, it always
> calls `submitNFLPicksInternal` without `displayedTiebreakTargetIds`; this
> condition therefore freezes `[]` permanently for every such simulated week.
> Those simulator pools continue to have no tiebreaker despite the resolver
> change. Have the sim path send the canonical displayed target (or exempt
> trusted sim submissions from this rollout-only guard).

### Response — ACCEPTED, verified

CONFIRMED at `functions/src/simHarness.ts`: the call passes
`{ poolId, week, picks, confidence, tiebreakerPrediction }` and no displayed
list. And this is not a corner — the plan's own blast-radius table names **every
simulator/scenario pool** as exposed, because no simulator path writes
`settings.weeklyTiebreaker`. So the round-1 guard withheld the fix from exactly
the population the plan was written for, permanently rather than for the rollout
window.

**Fix:** `MemberActionContext.serverSideCaller`, set only by the sim harness.
The guard infers "this client is out of date" from a missing displayed list;
server code has no browser bundle to be stale and is always running what was
just deployed, so the inference does not apply to it.

🛑 **On the CONTEXT, never the payload.** `ctx` is built only by server code; the
payload is client-supplied and schema-validated, so a field there would let any
browser assert it and walk past the guard. It grants nothing else — the
SUPER_ADMIN membership bypass keys off `actorRole`, still deliberately undefined
for the sim harness (ADR 0006).

Guard: emulator **5f**. Mutation — drop `&& ctx.serverSideCaller !== true` →
🔴 5f red.

---

> **[P2] Do not promise a fallback for an already empty-frozen week** —
> `src/components/NFLPoolDashboard/NFLPoolRules.tsx:181`
>
> For a legacy Monday-less week that already froze `[]` (including the rollout
> guard above), scoring and the pick sheet intentionally use no tiebreaker, but
> this new unconditional sentence says the final game is the target. Members
> viewing Rules and their pick sheet receive contradictory instructions for the
> same active week; qualify this copy for an existing empty freeze or surface
> that exception in the Rules view.

### Response — ACCEPTED, verified

CONFIRMED, and it is this plan's own defect returning one layer up: round 1
removed a rules-page branch that contradicted the sheet, and the replacement
sentence contradicts the sheet on a *different* week — one frozen `[]`, where the
sheet now correctly renders the D2 "No tiebreaker this week" card.

**"Qualify this copy for an existing empty freeze" is not available**, and codex
did not check that: `NFLPoolRules` takes `{ pool, isManager, onEditRules,
lockTime }` — no `week`, no schedule. It cannot know a per-week fact.

**Fix:** state the RULE and hand the per-week answer to the surface that knows
it. Added: *"Your pick sheet names the game each week, and tells you when a week
has none — that week is shared."* That is a promise the sheet keeps —
`tiebreakTargetSentence` names the target, and the D2 card covers the empty case
— so it is a true statement rather than a wider hedge.

Guard: extended the rules-page test. Mutation — remove the sentence → 🔴 1 red.
