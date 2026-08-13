# PLAN-WEEKLY-TIEBREAKERS — REVIEW LOG

Adversarial review of the plan itself, before any code exists. Reviewer:
`codex exec review --uncommitted` (OpenAI), per CLAUDE.md §2c — `--uncommitted`
rather than `--base origin/main` because the plan is an uncommitted working-tree
document. Findings are quoted in substance and answered individually; a rejection
would be recorded with its reasoning, same as an acceptance.

**Rounds: 3. Findings: 2 — both valid, both absorbed. Round 3 clean.**

Both findings hit the same clause — §5, the mid-season edit gate — and the
second one is a hole the first one's fix opened. That is the pattern CLAUDE.md
§2c documents ("round 1 finds defects in the code, rounds 2+ find defects in the
fixes"), reproduced exactly, on a plan that had already copied a gate this repo
believed was correct.

---

## Round 1

### R1.1 — the gate freezes too late (P1) — **ACCEPTED**

> The proposed `poolHasScoredWeek` gate still permits a commissioner to switch
> `MNF_COMBINED` to `MNF_LAST_GAME` after members have submitted predictions for
> the current, unscored week. The same stored number is then interpreted against
> a different target … Freeze this setting once the first relevant week's
> submissions/picks begin (or version the rule per week), not only after scoring
> publishes.

**Verdict: valid, and it holed the plan's one borrowed mechanism.** The draft
reused `poolHasScoredWeek` from `functions/src/lib/survivorSettingsGate.ts`
because #399 established it, and reused it without asking whether #399's line is
*this* setting's line. It is not. #399's parity settings are re-applied by the
scorer, so "has anything been scored" is exactly the right question there. This
setting changes **what a number a member already typed means**, and that harm
lands at submission, not at scoring — a whole weekend earlier.

**Absorbed** as the §5 box: the gate freezes on the first submitted prediction,
and `poolHasScoredWeek` demotes from the whole gate to a cheap early-out. The
per-week versioning alternative codex offered is recorded as **rejected** in §5
with its reasoning — strictly more capable, strictly more machinery (a second
frozen-per-week map beside `hardLockByWeek`, a freeze writer on the submission
path, a per-week resolver in the scorer), for a setting whose correct value is
known at pool creation.

**Lesson worth carrying past this plan:** copying a gate is copying its
*question*, not just its code. The question `poolHasScoredWeek` answers is "has
the scorer published anything", and that is only the right question for settings
the scorer re-applies.

---

## Round 2

### R2.1 — the round-1 fix is vacuous in the `NONE` direction (P1) — **ACCEPTED**

> When a pool starts with `NONE`, the proposed client deliberately stops sending
> `tiebreakerPrediction`, so submitted entries have no `weeklyTiebreakers` value.
> A manager can then switch to an MNF rule after picks are locked; members were
> never asked for predictions and scoring falls back to `0` for them. Gate
> changes on evidence of any Pick'em submission … not only on stored tiebreaker
> values.

**Verdict: valid, and it is a hole round 1 created.** Round 1's fix keyed the
freeze on `weeklyTiebreakers` being non-empty. §7 of the same plan says a `NONE`
pool's sheet stops sending `tiebreakerPrediction` at all — so on exactly the
pools where the switch is most damaging, the round-1 gate is satisfied by an
empty map and permits everything.

The consequence is worse than round 1's, not equal to it. Round 1's case
re-reads a number the member chose; this one **invents** one:
`entry.weeklyTiebreakers?.[week] ?? 0` ([nflPools.ts:1308](functions/src/nflPools.ts:1308))
reads every member as having predicted **0** for a question they were never
asked, on picks they can no longer change.

**Absorbed** as the second §5 box: the freeze judges the **OR** of two
per-entry conditions — non-empty `picks` **or** any `weeklyTiebreakers` value —
and the refusal message changes to cover both ("they answered the old question,
or were never asked the new one").

---

## Round 3 — clean

> The only untracked change is a planning document marked as awaiting sign-off;
> it makes no executable code or configuration changes.

No findings.

---

## Stopping rule

CLAUDE.md §2c's stopping rule is **evidence, not the counter**: a clean codex
round **and** qodo clean **and** my own read of the artifact agreeing.

- **codex:** round 3 clean. ✅
- **own read:** agrees, with one reservation recorded in the plan rather than
  hidden — §2 is a scope question, not a specification, and the plan is
  deliberately not implementable until Kevin answers it. That is the intended
  state of a plan-gated artifact awaiting sign-off, not an open finding. ✅
- **qodo:** ⚠️ **NOT RUN.** qodo reviews pull requests; this plan is an
  uncommitted document with no PR. It will run on the PR that carries the plan
  and again on the PR that implements it. Stated rather than skipped silently.

**No findings are carried open.**
