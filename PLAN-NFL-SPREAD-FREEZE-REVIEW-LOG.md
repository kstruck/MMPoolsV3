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

## Rounds 11-14 — authorised past the cap

Kevin, 2026-08-19: *"Yes, do round 11, up to 15 if needed."* `CLAUDE.md` §2c
caps codex at 10 per artifact and requires the over-cap rounds to be recorded.
Rounds 11 and 12 found **five more P1s** between them, so the overage paid for
itself twice over.

Also decided in the same message: **R1 is settled — Tuesday 09:00 ET**, the
existing schedule. Recorded in the plan before round 11 ran, so the reviewer saw
the final text.

### Round 11 — three findings, all P1, all valid

**An approved override was routed away from the rescore queue.** 2.4 exempted a
change carrying a fresh `overrideId` from "everything else gets audit AND
rescore" — so a properly approved correction, the one case that exists to fix a
line after scoring, would have left finalized ATS standings on the old number
*because it was approved*.
**Absorbed.** The predicate splits: rescore fires on ANY change to a frozen
line; the "unapproved" audit row fires only without a fresh id. They were never
the same question.

**Sync preservation keyed on `locked` could be laundered by unlocking first.**
The bypass 2.4 expects can set `locked: false`, and the next sync then writes
ESPN's unlocked map and drops `frozenAt`.
**Absorbed** — see round 12, which corrected the correction.

**Preflight slate reconciliation does not survive a concurrent add.** The set
check runs before the transaction; Firestore does not range-lock, so re-reading
the query inside it does not help either.
**Absorbed.** The freeze takes the fenced slate lease the scorer already uses
(`nflPools.ts:913-951`), the importer respects it, and the transaction re-reads
target refs by id so concurrent modifications still conflict. The
added-after-commit case is R3's page-don't-auto-freeze.

### Round 12 — two findings, both P1, both valid

**Round 11's own fix was a live-data hazard.** Switching sync preservation to
`frozenAt` alone would hand every spread locked *before* this ships — including
the ones locked by hand on 2026-08-19 — back to the next ESPN payload,
unlocked and revalued, by the change meant to protect them.
**Absorbed.** The condition is the UNION: preserve on `frozenAt` **or**
`locked === true`. Safe on day one with no migration, and still closed against
unlock-laundering. Backfilling `frozenAt` at cutover drops from precondition to
tidy-up (R4).

**A game added after a freeze has no `frozenAt` to amend.** The manual backstop
was specified as an "override", which only amends — leaving a manually added
line unmarked, unpreserved by 1.4b and invisible to 2.4.
**Absorbed.** `overrideLockedSpread` has two shapes, amend and create, and the
create shape stamps `frozenAt` so a hand-repaired game is indistinguishable from
one the job froze.

### Round 13 — clean

Reviewed the round-12 fixes.

### Round 14 — two findings, valid

**P1 — the union rule went into the sync and not the importer.**
`importNFLSeason` has its own preservation branch (`:534-536`) testing
`locked === true` alone, so the identical laundering works through an import:
unlock, re-import the week, and ESPN's unlocked map lands with `frozenAt` gone.
**Absorbed.** One rule, both writers, with a regression test driving each over a
spread carrying `frozenAt` with `locked: false`.

**P2 — the rollout asked for dry runs the schedule cannot produce.**
R2's table said "Sat–Mon: read each run" against a `0 9 * * 2` job. There are no
runs on those days; the preflight was unrunnable as written.
**Absorbed as 1.5b** — a SUPER_ADMIN `runNFLSpreadFreeze({ dryRun })` callable
invoking the same `freezeSlateOnce`. It also becomes the on-demand re-run when a
Tuesday pass refuses, and the hook an emulator test drives.

### Round 15 — two findings, both P1, both valid — AND THE BUDGET ENDS HERE

**P1 — "Lock All Spreads" manufactures unprotected lines.**
2.2 left unlocked rows on the current client write, so the per-row toggle and the
**Lock All** button could still write `{ value, locked: true }` directly. The
2.3 rules only protect an ALREADY-locked spread, so those create a newly locked
line with no `frozenAt` and no audit record — outside 1.4b, outside 2.4, around
R3. The manual backstop was quietly manufacturing lines the scheme cannot see.
**Absorbed.** Every action that sets `locked: true` goes through the callable.

**P1 — deleting `frozenAt` fires nothing.**
A whole-map console write can drop the marker while leaving value and `locked`
untouched. The predicate saw no change, so no rescore and no audit — and 1.4b
then preserves the markerless locked spread forever. One quiet write and the
game leaves the detector permanently.
**Absorbed.** `frozenAt` changing or disappearing is now part of the predicate;
the freeze's own unset→set transition stays excluded by the `before` keying.

⚠️ **THE ROUND-15 FIXES HAVE NOT BEEN REVIEWED.** Kevin authorised "up to 15 if
needed" and 15 is spent. Both fixes are direct and unambiguous, but that is a
judgement, not a round. **Named in the PR body; Kevin decides whether to spend
round 16.**

## Verdict

**Nineteen findings across fifteen rounds. Every one valid, every one absorbed.
Eleven were P1.** Nothing is carried forward as an open finding — but two
caveats stand, and neither should be read past:

1. **The round-15 fixes are unreviewed.** The budget ended on the same round
   that produced them.
2. **The finding rate never decayed.** Rounds 11-15 produced nine P1s, more than
   rounds 1-10 did. A review that is still finding P1s at round 15 is telling
   you something about the design, not about the reviewer — which is why the
   plan now carries a section pricing decision A against what the review
   learned. That section is the most useful output of the overage.

Fourteen rounds is well past the ordinary ceiling, and it is worth saying why
this artifact earned them: it is a plan whose entire subject is an invariant,
and eight of the twelve findings were places the plan broke its own invariant.
That is a good use of the budget on a document; it would be a bad sign on a
diff.


---

# Revision 1 — the write-once store (2026-08-19)

Kevin: *"Go with your recommendation for all."* Nine further codex rounds on the
revision, under the §2c cap of 10. **Fourteen findings, all valid, all absorbed;
nine were P1.** Round 9 clean.

**What triggered the revision** was not codex but a hand read of the Spread
Manager while planning Phase 2: `handleSave` (`:84-96`) writes **every game in
the fetched list**, whole-map. Every operator Save would have erased `frozenAt`
and `overrideId` on all sixteen games — the tool the plan tells you to use,
wiping the markers the plan depends on. That made twenty findings of the same
shape and settled the design question the previous section had only posed.

## The rounds

| # | Finding | Absorbed as |
|---|---|---|
| 1 | The pick sheet renders `nfl_games.spread` via `GameMeta`, so after a freeze a player could be **shown one number and graded on another** — breaking the requirement more directly than the original bug | one precedence rule, `frozen ?? working`, covering read AND display, with a component test |
| 1 | `nflSpreadRescoreTrigger` watches `nfl_games`; the override now writes elsewhere, so an approved correction would never enqueue | enqueue follows the data |
| 2 | Legacy locked slates have no frozen record, so reads fall back to a field the revision leaves fully mutable — **a live slate alterable at pick time and grading**, worse than today | backfill promoted from tidy-up to **precondition**, with the kill-switch + dry-run house shape |
| 3 | Routing the enqueue through the callable covers one writer; the trigger it replaced covered **every** writer. A console write would leave standings stale — a regression | trigger on the frozen store, `retry: true`; audit exemption stays a separate question |
| 4 | **The manual backstop dies.** The freeze fetches ESPN and the override only corrects; nothing could turn operator-entered values into frozen records, so a gap week blocks ATS submissions indefinitely | freeze takes the feed value per game, falling back to the stored working value; all-or-nothing over the union |
| 4 | `nflLockWatch` counts coverage off `nfl_games.spread.locked` — it would page on **every successful freeze** | watcher resolves frozen records with the same precedence |
| 5 | 1.1's once-per-slate test still read `nfl_games.spread.frozenAt`, which the revision no longer writes — resurrecting the round-7 re-freeze defect by moving the data | eligibility keys on frozen-record existence |
| 5 | The revision dropped the override's CREATE shape, leaving a late-added game with no path to a frozen line — R3's remediation gone | both shapes restored against the new store |
| 6 | A **delete** of a frozen record is a canonical-line change with no `after` document; the slate key exists only in `before` | key derived from `before.slate`; deletes always unapproved |
| 6 | Every scheduled freeze creates records without an `overrideId`, so "no fresh id = unapproved" would file all sixteen games weekly as unauthorized | `source` discriminator |
| 7 | The first `source` rule still demanded an `overrideId` from writes that by design never carry one | approval judged **per source**, as a table |
| 8 | The backfill payload omitted `source: 'backfill'` | added |
| 8 | The override payload omitted `source: 'override'` | added, both paths |

## Own read

**Three times in this plan a detector was aimed at the mechanism it exists to
protect** — round 5 of the original (the freeze flagged itself), round 6 here
(every freeze unapproved), round 8 here (every override unapproved). That is not
carelessness repeated; it is what happens when the thing being watched and the
thing doing the watching are specified in different paragraphs. The rule the
plan now carries — *every writer declares itself, and every payload spec carries
that declaration* — is the generalisation, and it is worth more than the three
fixes.

**The revision is a better design and the rounds say so in a specific way:**
nine of fourteen findings were about wiring the new store into readers that
already existed, not about the invariant leaking. The original's findings were
the opposite — the invariant leaking through writers, endlessly. Wiring is
finite and testable; leaking is not.

## Verdict

Revision 1 is fit to implement, and supersedes the shape of Phases 1 and 2.
Nothing carried forward. **Implementation still waits on Kevin reading it** — it
is a design he has not seen, arrived at by delegation.
