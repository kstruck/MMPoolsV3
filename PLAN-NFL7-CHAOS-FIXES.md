# PLAN — NFL-7 chaos-drill fixes

**Status:** authored 2026-07-31. Plan-gated because every item changes **scoring**
(CLAUDE.md §4, `mmp-change-control` §1 trigger list).

**Provenance:** the five defects were found by the NFL-7 chaos drill
(`functions/src/__tests__/emulator/hofChaosDrill.emulator.test.ts`, PR #332),
which is evidence-only and changes no production code. Each defect is already
pinned there as a report-only `it.fails()`. **This plan's definition of done is
that those five flip to plain `it()`** — the tests exist before the fixes, and
they were written against the behaviour the pilot needs rather than the behaviour
the code has.

**Clock:** the Hall of Fame game is 2026-08-06 (Thu, 8:00pm ET = `2026-08-07T00:00Z`),
six days out. Every defect below is reachable on that specific night and on no
other week of the season.

---

## 1. Goal

A feed that misbehaves on the one-game HOF week must never settle the pilot on a
result nobody played, and must never eliminate a member because of a field ESPN
dropped. Waiting is always an acceptable outcome; a wrong settlement is not.

Stated as the invariant the fixes are measured against:

> **The scorer may only grade what the feed actually reported. Absent data is a
> reason to wait, never a reason to grade a zero.**

## 2. Why now rather than after the pilot

Finalization is a re-runnable overwrite, so a *late* correction is survivable —
that is exactly what PR #332 proved for the correction path. Two of these five
are **not** correctable that way:

- A Survivor elimination is corrected by rescoring, but the member has already
  been told they are out on HOF night, in a pool with `maxStrikes: 0` where that
  is the whole game. The repair is social, not technical.
- A pool that FINALIZES off a scoreless FINAL has stamped `finalizedAt` and
  written `seasonHistory`. It is recoverable, but only via the queue tier, and
  only if somebody notices — and the drill found nothing that would tell them.

## 3. The five items

Each item names the defect, the single place the fix belongs, and the test that
must flip.

### 3.1 — NFL7-3 / NFL7-4: a scoreless `FINAL` is not concluded

**Defect.** `nflSchedule.ts:267-271` deliberately emits **no** `scores` object
when the feed delivers a score for neither competitor, precisely so that
"ESPN dropped the field" stays distinguishable from "the team scored zero" (the
A5 false-correction guard). Nothing downstream repeats the distinction: every
engine reads `game.scores?.home ?? 0`. So a `FINAL` with no `scores`:

| Pool type | Current grade | Consequence |
|---|---|---|
| Pick'em | 0-0 → `PUSH` for everyone | a published result nobody played |
| Survivor | 0-0 → tie → **strike** | **elimination** at `maxStrikes: 0` |
| Margin | 0-0 → net 0 | a fabricated 0 in the season total |

And because the week then reads COMPLETE, `scoredWeeks` is stamped, the recap is
written, and the one-game HOF season **finalizes**.

**Fix.** One predicate, one definition:

```ts
/** Did the feed actually deliver both scores for this game? */
export function hasReportedScores(g: Pick<NFLGame, 'scores'>): boolean {
  return typeof g.scores?.home === 'number' && typeof g.scores?.away === 'number';
}
```

Defined in `nflScoringEngine.ts` (pure, imports only types) and imported by
`lib/weekCompletion.ts`. Direction chosen to avoid a cycle: the engine imports
nothing from `lib/`, and `weekCompletion` is already imported by both scorers.

Applied in exactly four places — the one completeness definition and the three
engine entry points that independently test for `FINAL`:

1. `isTerminalGame` (`lib/weekCompletion.ts:16`) — `FINAL` counts as concluded
   only with reported scores. `CANCELLED` stays terminal unconditionally: a
   cancelled game has no scores *by definition*, and that is not missing data.
2. `gradePickemGames` (`nflScoringEngine.ts:58`)
3. `evaluateSurvivorWeek` (`nflScoringEngine.ts:214`)
4. `scoreMarginWeek` (`nflScoringEngine.ts:313`)

Item 1 alone makes the week incomplete, which stops finalization. Items 2-4 are
not redundant: `provisional` grading passes the full slate to the engines, so a
scoreless FINAL would still be graded mid-week without them. **Mutation-test each
of the four separately** — three of them are exactly the "guard that looks like it
guards" shape this repo has been bitten by four times.

**Loud, not just clean.** The scorer emits a `console.warn` naming the game id
when it drops a `FINAL` for missing scores. The week stays incomplete, so the
auto-scorer re-examines it every 10 minutes and self-heals the moment the feed
delivers.

**Known residual, deliberately out of scope.** A **one-sided** drop is NOT
detectable from the stored document: `nflSchedule.ts:271` emits both values when
*either* competitor has a score, so the missing side is written as a real `0`
through `safeInt`. Fixing that belongs in the importer (emit only what the feed
sent), not the scorer, and it is a separate change to a separate module. Named
here so it is a decision rather than an oversight.

**Second residual.** A game stuck `FINAL`-without-scores forever blocks
finalization with the generic `"N games not concluded"` reason.
`assessSeasonCompleteness` labels only SCHEDULED-past-kickoff as STALLED, and
that narrowness is deliberate and documented. Extending the stalled taxonomy is
follow-up work, not part of this plan — the `console.warn` plus the heartbeat UI
(Task 2) is the operator's signal for the pilot.

**Tests that must flip:** NFL7-3, NFL7-4.

### 3.2 — NFL7-1 / NFL7-2: no no-show penalty for a week nobody could play

**Defect.** The no-submission penalty — a Survivor strike
(`nflScoringEngine.ts:196`) and a Margin −14 (`nflPools.ts:1271`) — exists to
punish not showing up **for a game**. On a week where every game is CANCELLED
there was no legal pick to make. `checkAutoSurviveExemption` cannot rescue the
member: it returns false unless `teamsPlaying.size > 0`, and a fully-cancelled
slate contributes no teams, so the exemption machinery is silent *even at its
default-ON setting*.

On a 16-game week this is unreachable — one cancellation still leaves 15 games to
pick from. **On the HOF week the cancelled game IS the week**, so a cancellation
eliminates every non-submitter in the pool on night one.

**Fix.** A second shared predicate, beside the first:

```ts
/** Was there nothing to play? Every game of a non-empty slate cancelled. */
export function isVoidWeek(games: Pick<NFLGame, 'status'>[]): boolean {
  return games.length > 0 && games.every(g => g.status === 'CANCELLED');
}
```

- **Survivor** — in `evaluateSurvivorWeek`'s `if (!pick)` branch, return
  `{ survived: true, strikeLogged: false }` on a void week.
- **Margin** — at `nflPools.ts:1271`, the no-pick penalty becomes `0` on a void
  week rather than `−14`.

**Why not route this through the exemption.** Granting an auto-survive exemption
would flow through machinery that already exists and would mark the week in
`exemptWeeks`, which reads correctly. It is rejected because
`autoSurviveExemptionEnabled` is a **commissioner setting that can be turned
off**, and a week nobody could play must not strike anybody regardless of how
that setting is configured. The rule is a property of the slate, not a pool
preference.

**`games.length > 0` is load-bearing** and must be mutation-tested on its own: an
empty slate means "the scorer has no data", not "nothing was played", and
collapsing those two is defect 3.3 in a different costume.

**Tests that must flip:** NFL7-1, NFL7-2.

### 3.3 — NFL7-5: an empty slate is not a complete week

**Defect.** `isWeekComplete` is `games.every(...)`, vacuously **true** for `[]`.
An empty slate therefore reads as a fully-concluded week: `provisional: false`,
`scoredWeeks` stamped, recap written, season finalized — off a slate the caller
could not read.

**Not reachable today**, and the plan says so rather than overstating it:
`scoreNFLWeek` throws on `games.length === 0` (`nflPools.ts:1504`), and a slate
from `findActiveSlates` or the queue drain is built *from* games. This is a latent
trap, fixed because it is one line and because the failure would be silent and
total.

**Fix.** `return games.length > 0 && games.every(...)`.

**Blast-radius check performed:** no existing test asserts the vacuous-true
behaviour (`grep` over `functions/src/__tests__` for `isWeekComplete` returns two
files, neither passing an empty array), and all three production callers are
already non-empty. Re-verify with the full suite rather than trusting this note.

## 4. Sequencing

One PR. The five defects share two predicates and three files; splitting them
would mean shipping the Survivor half of a root cause without the Margin half,
which §3.2 explicitly warns against.

Phase order inside the PR, one commit each:

1. The two predicates, with unit tests, no callers changed.
2. 3.1 applied at all four sites.
3. 3.2 applied at both sites.
4. 3.3.
5. Promote the five `it.fails()` to `it()` in the chaos drill.

Commit 5 is the acceptance gate: it cannot pass unless 2-4 are correct, and it
fails loudly (`expected failure passed`) if a fix lands that the drill did not
demand.

> **DEVIATION, recorded rather than quietly taken.** Steps 1-4 landed as ONE
> commit, not four. `nflScoringEngine.ts` and `lib/weekCompletion.ts` each carry
> hunks belonging to three different steps, so a four-commit split would have
> meant staging partial hunks of the same function — more reviewer confusion than
> the per-step history buys. Step 5 is still its own commit, which is the half
> that matters: it is the acceptance gate.

### 3.1b — the hole 3.1 opens in the rescore-queue trigger

Found while implementing, not while planning, and worth its own heading because
it is the kind of thing that makes a fix worse than the defect.

`nflSchedule.ts`'s `firstTerminal` decides whether a slate is enqueued for later
reconciliation. It keys on a **status** transition:
`prev !== g.status && (isTerminalGame(g) || isTerminalGame({ status: prev }))`.

Once §3.1 lands, a game becomes terminal when its **scores** arrive — and across
that moment the status does not change (`FINAL` → `FINAL`). So the enqueue would
never fire for exactly the case §3.1 creates, and beyond the 24h live window
nothing else would ever make that slate a candidate again. The fix would have
introduced a permanent stale-standings path.

**Fix.** Key on status change **OR** terminal-ness change:

```ts
if (prevStatus === g.status && prevTerminal === nowTerminal) return false;
return nowTerminal || prevTerminal;
```

Every case the original comment block enumerates still fires (verified one by
one, including `CANCELLED ⇄ FINAL` where the status moves between two terminal
states, and `SCHEDULED → IN_PROGRESS` which must NOT fire), plus the new one.
This also required widening `isTerminalGame`'s parameter to
`Pick<NFLGame, 'status' | 'scores'>`, which is what surfaced the call site.

## 5. Risks and open questions

| # | Risk | Handling |
|---|---|---|
| R1 | A `FINAL` game legitimately missing scores blocks a week forever. | Accepted. Waiting is the correct outcome (§1) and the week self-heals when the feed delivers. Escalation is the `console.warn` + the heartbeat card. |
| R2 | The scoreless-FINAL predicate changes grading for **regular season** pools too, not just the HOF week. | Intended. The defect is not preseason-specific; only its blast radius is. |
| R3 | `isTerminalGame` is used by `isWeekComplete`, which gates finalization across every NFL pool. A wrong predicate here stalls every pool. | Four separate mutations, plus the full 286-test emulator suite, plus 1179 functions unit tests. |
| R4 | A one-sided score drop still grades wrong. | Named as an out-of-scope residual in §3.1; belongs in the importer. **DECISION NEEDED (Kevin)** — is that worth doing before 08-06? |
| R5 | Margin's void-week rule writes `0` rather than skipping the week. | `0` is what a member who *did* pick a cancelled game already receives (`scoreMarginWeek` returns 0 on CANCELLED), so this makes the two consistent. Skipping would leave the week absent from `weeklyScores` and diverge from the picked case. |

## 6. Out of scope

- The importer's one-sided-score behaviour (R4).
- Extending the STALLED taxonomy beyond SCHEDULED-past-kickoff.
- Anything touching the rescore queue — PR #332 proved that path converges,
  including re-crowning the `seasonHistory` champion.
- Arming any scheduled job. `system/config.nflAutoScore` stays unset.

## 7. Implementation status

| Item | Status | Notes |
|---|---|---|
| 3.1 predicates | ✅ | `hasReportedScores`, `isVoidWeek` in `nflScoringEngine.ts` |
| 3.1 call sites | ✅ | **SIX**, not four — see below |
| 3.1b enqueue trigger | ✅ | `nflSchedule.ts` `firstTerminal` |
| 3.2 Survivor + Margin | ✅ | `evaluateSurvivorWeek`, `nflPools.ts` |
| 3.3 empty slate | ✅ | `isWeekComplete` |
| Promote 5 `it.fails()` | ✅ | all five pass |

**The plan said four §3.1 call sites and there were six.** The two it missed are
the per-pick RECORD writers, not the graders: `gradeSurvivorWeekGame` would have
recorded `SURVIVED` off a payload reporting no scores, and `gradeMarginWeekGame`
does `scoreMarginWeek(...) ?? 0`, which converts the new "not ready" `null` back
into a recorded net of 0 — re-creating the exact defect one layer up. Written
down because "four sites" was an assertion from reading, and the code had six.

A seventh site is the caller in `nflPools.ts:1268`, which had the same
`res ?? 0`.
