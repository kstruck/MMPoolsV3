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

**PENDING** — running against the round-1 fix.
