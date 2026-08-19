# Review log — PLAN-NFL-SPREAD-FREEZE.md

`mmp-change-control` Rule 3: a plan-gated change needs PLAN → adversarial review
log → sweep before implementation. This is the log. Reviewer: `codex exec review
--base origin/main`, six rounds, 2026-08-19. Rounds 1–5 each found something
real; three were P1.

The plan was drafted against `e9f288ce`.

## Round 1 — two findings, both valid

**P1 — "not a console edit" is a promise Firestore Rules cannot keep.**
The Goal claimed the freeze would be safe from a console edit, and the mechanism
offered was a security rule. Rules do not apply to the Firebase console, the
Admin SDK, or any IAM principal with datastore write access — the same bypass
that lets the freeze job itself work.
**Absorbed.** The Goal now says plainly that the credential path is not
prevented and cannot be, and Phase 2.4 was added to cover it operationally
(documented repair path, audit-on-unapproved-change, and IAM scope named as
Kevin's call rather than implied away).

**P2 — `SPREADS_NOT_LOCKED` does not gate every NFL pool.**
The plan asserted the submit gate blocks all NFL pools until a week is fully
locked. It sits inside `if (poolUsesSpreads(pool))` (`nflPools.ts:466`), and
that is `type === 'NFL_PICKEM' && settings.pickMode === 'ATS'`
(`nflScoringEngine.ts:84-86`).
**Absorbed, and it went further than the finding.** Chasing it down showed two
more things the plan had wrong: `nflLockWatch` scopes to the same predicate
(`lib/nflLockWatch.ts:91-93`), which is why the two pools it named on 08-19 are
genuinely blocked — and **ATS is live, not V2**: the create wizard offers it
(`CreateNFLPickemPool.tsx:61`) and `gradePickemGames` grades against
`spread.value` (`nflScoringEngine.ts:98-101`). The "reserved for V2" comment at
`src/types/nflPoolTypes.ts:61` is stale. Two sweep rows were corrected and the
scope section rewritten.

## Round 2 — one finding, valid

**P2 — the Out-of-scope section still said ATS was inert.**
Round 1's correction was applied to the sweeps table and the scope section but
not to the Out-of-scope bullet, which still read *"`pickMode: 'ATS'` is reserved
for V2 and no scorer reads `spread.value` today"* — contradicting the evidence
three sections above it, and liable to make the implementation skip ATS
regression coverage.
**Absorbed.** The bullet now scopes out the grading RULE only, and adds an ATS
regression check to Phase 1's deliverables. *(Same claim, two places, one fixed
— the ordinary shape of a half-absorbed finding.)*

## Round 3 — two findings, both valid

**P2 — the 08-25 rehearsal rehearses nothing.**
Phase 1 makes dry-run write nothing, so leaving it in dry-run through Tuesday
exercises the fetch and the slate selection and never the transaction, the
write, or the resulting state. The first live lock would then be regular-season
week 1.
**Absorbed.** R2 now carries a dated sequence with the `dryRun: false` flip on
Mon 08-24, before the Tuesday run, plus the rollback (one field, plus the manual
Spread Manager) and a fallback if ESPN has not published by Monday.

**P2 — the unapproved-change audit is race-prone.**
Detecting an unapproved edit by looking for a matching `admin_audit` row races
in both directions: the override writing the game before its audit row lets the
trigger libel a legitimate override, and `writeAuditEvent` swallows its own
write failures so the row may never exist.
**Absorbed.** The override now mints an `overrideId`, one transaction writes
both the spread and the audit record carrying it, and the trigger compares
`before`/`after` ids — a purely local test with no window to race.

## Round 4 — one finding, valid, and it is a live defect

**P1 — unlock → edit → re-lock fires nothing.**
`lockedSpreadChanged` (`lib/rescoreQueue.ts:306-316`) opens
`if (before?.locked !== true) return false;`. Across the three-step sequence the
Spread Manager's own toggle invites, every step returns false: unlock (value
unchanged), edit (before not locked), re-lock (before not locked). So
`nflSpreadRescoreTrigger` never enqueues and finalized ATS standings stay graded
against the old line.
**Absorbed as new evidence item 1b**, because this is a defect in shipped code
reachable through the shipped UI, not merely a gap in the design. The detection
predicate is rewritten around a durable `spread.frozenAt` stamp rather than the
before-state of `locked`, and the plan takes ownership of changing
`lockedSpreadChanged` and of a regression test for the three-step sequence.

## Round 5 — one finding, valid

**P1 — the new detector would flag the freeze itself.**
Round 4's replacement said "any write to a game carrying `frozenAt`". The freeze
transaction adds `frozenAt`, changes `locked`, usually changes `value`, and
carries no `overrideId` — so on the post-write reading, every game of every
weekly freeze is an unapproved edit and enqueues a rescore.
**Absorbed.** The predicate is keyed on `before.spread.frozenAt`, which makes
the freeze transition invisible to the detector by construction.

## Round 7 — one finding, valid, and it inverted the plan

**P2 — the slate-selection rule could re-freeze an already frozen week.**
1.1 selected "the earliest slate not already fully locked". A slate with fifteen
games frozen and one late addition unlocked satisfies that, and 1.4 then wrote
all sixteen fetched lines — re-freezing the fifteen at a second instant with
whatever ESPN said at that moment. The job is a Cloud Function and bypasses the
2.3 rules deny, so nothing downstream would have caught it. The mechanism meant
to enforce the requirement was the one that would have broken it.
**Absorbed.** A slate is freezable exactly once: one game carrying `frozenAt`
puts the whole slate off-limits (1.1), and the transaction re-reads and refuses
if any target already carries it (1.4). R3 is resolved rather than left open —
page, never auto-freeze — because leaving it open is what let the selection rule
answer it by accident.

## Round 8 — two findings, both P1, both valid

**P1 — the score sync erases the freeze marker.**
`syncScoresWindow` preserves a locked spread by rebuilding it as
`{ value, locked: true }` (`nflSchedule.ts:1157-1163`) — two fields, and only
two. Every sync run in the 2-hour pre-kickoff window would therefore delete
`frozenAt` and `overrideId`, leaving the value intact and the provenance gone,
so 2.4's detector would stop recognising the line as committed. The invariant
would have looked enforced and been unenforceable.
**Absorbed as 1.4b.** The sync drops the `spread` key entirely when the stored
one is locked and lets `merge: true` preserve it whole — the technique the
importer already uses at `:535-536`, which also means the next field added to
`spread` inherits the protection rather than the bug. Regression test specified.

**P1 — slate selection freezes the following week nine days early.**
With the round-7 rule, once week N carries `frozenAt` the next Tuesday's run
skips it and selects week N+1 — freezing it about nine days before kickoff, at a
Tuesday that is not that week's stated cutoff, on lines that will move all week.
Round 7's fix made the walk-forward permanent by making the freeze once-only.
**Absorbed.** 1.1 gains a freeze horizon: the slate must kick off within 7 days
of the run. No qualifying slate means the run does nothing and says so.

## Round 9 — two findings, both P1, both valid

**P1 — an approved override drops `frozenAt` and disarms the detector.**
2.1 specified `spread = { value, locked: true, overrideId }`, which omits the
marker 2.4 reads off the *before* image. The first legitimate override would
therefore blind the alarm to every unauthorised change on that game afterwards.
**Absorbed.** The override amends the stored spread and preserves `frozenAt`.
Same failure as round 8's sync bug, one layer up.

**P1 — all-or-nothing was measured over the fetch, not over the slate.**
Checking "every fetched game has a line" passes on a 15-of-16 ESPN response:
fifteen get written and the stored sixteenth stays unlocked — a partially frozen
week that looks complete to the job that made it.
**Absorbed.** 1.3 now reconciles fetched ids against stored ids first and
refuses on any member missing from either side, with a 15-of-16 regression test.

## Round 10 — one finding, valid: round 9's fix applied in only one of two places

**P1 — 2.4 still spelled the override as a whole-map write.**
Round 9's correction landed in 2.1 and not in 2.4, which repeats the
instruction. Same claim, two places, one fixed — the identical shape as round 2.
**Absorbed**, and this is where the round budget ran out: `CLAUDE.md` §2c caps
codex at 10 rounds per artifact, and the fix for this finding has NOT had a
round of its own. It is a one-line textual consistency fix to a duplicated
instruction rather than new design, but that is a judgement, not a review.
**Named in the PR body as an unreviewed change; Kevin decides whether to spend
round 11.**

## Round 9 — clean

## Round 6 — clean

> The change only adds an implementation plan and explicitly states that no
> implementation phase has started. It introduces no executable code or
> configuration changes that could break existing behavior.

## Own read of the diff

Agrees. Three things worth recording:

- **Round 6's clean result was not the review, and neither was round 7's fix.**
  Round 6 came back clean; round 7 then found a P2 that inverted the plan's
  central mechanism; round 8 found two P1s, one of them *created* by round 7's
  fix. A clean round is evidence about the diff the reviewer saw, not a verdict
  on the artifact — and a fix earns its own round, every time.

- **One failure shape ran through rounds 8 and 9: rebuilding an object instead
  of amending it.** The sync rebuilt `spread` as two fields and lost the marker;
  the override rebuilt it as three and lost it again. Both were written by
  someone who knew the marker mattered. The implementation rule that falls out
  of it is worth more than either fix: **never write a whole `spread` object —
  amend the stored one, or drop the key and let `merge` keep it.** A field added
  to `spread` next year should inherit the protection, not the bug.

- **Rounds 4 and 5 are the same finding from opposite ends** — first the
  detector missed a real change, then it caught an unreal one. A predicate over
  `locked` transitions is easy to get wrong in both directions, which is why the
  plan asks for a regression test naming the three-step sequence explicitly
  rather than trusting the rule to read correctly.
- **Defect 1b should not wait for this plan.** It is live, it is reachable from
  the Spread Manager today, and its consequence is permanently wrong ATS
  standings. It is written into this plan because the fix and the freeze share a
  predicate, but if the plan stalls it should be lifted out as its own change.

## Verdict

Plan is fit to implement. Every finding across ten rounds was valid and every
one is absorbed — **with one carried caveat**: the round-10 fix has not itself
been reviewed, because ten rounds is the §2c cap. Nothing is carried forward as
an open finding.

Ten rounds is the ceiling, not a target, and it is worth saying why this
artifact spent all of them: it is a plan whose entire subject is an invariant,
and eight of the twelve findings were places the plan broke its own invariant.
That is a good use of the budget on a document; it would be a bad sign on a
diff.
