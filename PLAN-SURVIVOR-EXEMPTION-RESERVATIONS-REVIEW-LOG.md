# REVIEW LOG — PLAN-SURVIVOR-EXEMPTION-RESERVATIONS

Reviewer: codex (codex-cli, `codex exec review`, read-only sandbox). Cap:
judgement up to 10 rounds (CLAUDE.md §2c). The branch also carries the #399
deploy record, so findings against those docs are logged here too.

## Round 1 — codex

VERDICT: REVISE. 1 finding (P2). Accepted.

1. **(P2) The new deploy claim is contradicted by still-current prose around it.**
   `PICKUP-PRESEASON-PILOT.md:365-366` was updated to `c7bdcf5`, but the lines
   immediately after it still said rules remain ≡ `0a705c0` and still reported the
   2026-08-08 bundle `index-W6uLtMV7.js` as live. A reader following that document
   could conclude the rules and frontend were NOT deployed.
   **Response: accepted.** This is precisely the class the docs-state invariant
   cannot catch — that suite compares SHAs and states its own limit: it "does NOT
   compare deploy-QUEUE prose". Fixed: the rules/frontend lines now state that
   `firestore.rules` is no longer ≡ `0a705c0` and that every earlier box claiming
   the equivalence is historical from 2026-08-09; the 2026-08-08 deploy record
   (including its bundle hash) is moved into an explicit HISTORICAL paragraph; and
   the surviving `0a705c0` claim in HANDOFF's dated 2026-08-05 box is annotated in
   place as no longer true.

   **Two further defects surfaced while fixing it, both caught by running the
   suite rather than by reading:**
   - `docs-state-invariants` failed on `PICKUP-PRESEASON-PILOT.md:336` — the
     section heading still read "deploy state verified 2026-08-08" while its body
     now described the 2026-08-09 deploy. The guard's own message forbids the
     tempting fix ("never stack a note under it — two live-looking claims and the
     reader takes whichever they reach first"), so the heading date was REPLACED.
   - The same suite had been red on this branch's parent for an unrelated reason
     during #399 (two plan-doc dates read as the Hall of Fame game date); tagged
     then, still green now.

Plan, sweeps and deploy docs updated. Proceeding to round 2.

## Round 2 — codex

VERDICT: REVISE. 3 findings (2×P1, 1×P2). All accepted. Two of them reversed
first-draft claims, which is the point of running this before implementing.

1. **(P1) The change would be INERT on every already-scored week.** Deploying a new
   eligibility algorithm moves no `computeWeekFingerprint` input — games, settings
   and `entryRevisionSum` are all unchanged — so `nflAutoScoreJob` matches the
   stored fingerprint, takes the skip path, and never re-grades the exemptions this
   plan exists to correct.
   **Response: accepted.** The plan had this as "none expected, confirm in review";
   it is now a required deliverable — a scoring-version term in the fingerprint,
   with a test, plus an explicit review question about whether that term is global
   or survivor-scoped.

2. **(P1) "A rescore corrects history with no backfill" is false and the repo says
   so.** `scoreSlateOnce` DEFERS queued survivor rescores
   (`survivorQueuedDeferred`) because re-running an earlier week keeps later
   `strikeWeeks` while rewriting `eliminatedWeek`, corrupting the ledger — verbatim
   at `functions/src/nflAutoScore.ts:257-260`, which names "the reset-and-replay
   sub-PR" that does not exist yet.
   **Response: accepted.** Decision 4 reversed. Correcting EXISTING wrong
   exemptions is now separate, sequenced work, and open question 4 is the
   fix-forward-vs-replay-first decision — recommendation: fix-forward first, since
   it stops the exploit and does not depend on machinery nobody has built.

3. **(P2) S2 was JSON-only and its "complete inventory" claim was false.** The
   command never searched TypeScript seeds, where most divergent entries live
   (`perPickResults.test.ts` among them).
   **Response: accepted.** Sweep re-run across `.ts`/`.tsx`/`.json`, table
   extended, and the correction recorded as a generalisable lesson: a sweep is
   only as complete as its `--include` list. Also scoped it usefully — the blast
   radius is seeds that reach `checkAutoSurviveExemption`, not every divergent
   seed — and marked the per-instance verdicts as claims to be tested rather than
   evidence.

## Round 3 — qodo (PR #404)

VERDICT: REVISE. 3 findings. 1 accepted as a real defect, 1 accepted as trivial,
1 rejected.

1. **(🐞 Bug / Correctness) The sweep commands are not reproducible.** They used
   `|` alternation with plain `grep`, which is BRE — `|` is a literal pipe there —
   so every documented command returned ZERO matches, while the commands actually
   run had used `\|`.
   **Response: accepted, and it is the most valuable finding on this branch.**
   Measured before fixing: the published form returns 0, the real form returns 39.
   A sweep doc exists so the next session can re-run it and get the same list; one
   that silently returns nothing hands them an empty inventory plus the confidence
   of a completed sweep. That is this very file's correction #3 ("grep found
   nothing is not evidence when the grep could not have looked") reproduced inside
   the fix for it. All commands moved to `grep -E` / `grep -Ev`, and each was
   executed to confirm it returns results (16 / 77 / 40). The same pattern exists
   in already-merged sweep docs; noted as out of scope rather than fixed here.

2. **(Quality) Shell fence missing the `bash` language identifier.**
   **Response: accepted.** One word, improves rendering. Done.

3. **(Maintainability) Lines exceed 100 characters.**
   **Response: REJECTED.** Miscalibrated to this repo. `HANDOFF.md` line 1 is a
   single-line status banner by construction, and the operator docs are written in
   long prose lines throughout — the finding would require reformatting documents
   this PR only touches in passing. It also names no rule that exists in the repo:
   there is no line-length lint for Markdown here. Consistent with this repo's
   qodo calibration, where defect findings have been 17/17 valid and style findings
   7/7 rejected.

## Round 4 — codex (on the post-sign-off shape)

VERDICT: REVISE. 2 findings (2×P2). Both accepted. Both are consequences of the
sign-off edits, which is why running codex again AFTER recording Kevin's rulings
was worth the round.

1. **(P2) The fingerprint section still claimed to repair history.** Kevin's
   fix-forward ruling was recorded in question 4, but the fingerprint section was
   left reading as though the version term corrects existing wrong exemptions. It
   cannot: `scoreSlateOnce` calls `survivorAllowedForGroup` BEFORE computing the
   fingerprint, so an already-scored survivor week is deferred whatever the hash
   says, and weeks outside the active window are not candidates at all.
   **Response: accepted.** Section re-scoped to what the term actually buys — a
   week scored after deploy grades under the new rule even when re-graded for an
   unrelated reason — and "no version term at all, documented as future-passes-only"
   added as a legitimate third option now that it cannot repair history.

2. **(P2) The CORRECTED S2 was still incomplete.** It omitted
   `survivorRescore.test.ts:357` — `usedTeams: ['KC','BUF']` with picks only for
   weeks 1 and 9 — which is divergent AND reaches `computeSurvivorWeekUpdate`.
   **Response: accepted.** Cause: the re-run was truncated by `head -25`. Re-run
   untruncated, which surfaced `:357` and also `:98` (divergent, no picks at all —
   a second instance of the autosurvive-fixture problem hiding in a unit test).
   Both added with explicit verdicts.

   **This is the third failure of the same family on one sweep** — JSON-only
   `--include`, then literal `|` under plain `grep`, now `head` truncation. Each
   time the command ran, returned something plausible, and was written up as
   COMPLETE. Recorded in the sweeps doc as a rule: a sweep's output is not evidence
   until the command has been shown capable of finding everything it claims to
   cover.

## Round 5 — codex

VERDICT: REVISE. 3 findings (3×P2). All accepted. All three are the previous
round's fixes being wrong, not new design problems.

1. **(P2) The S2 command could not match JSON keys at all.** It searched
   `usedTeams:` while advertising `--include=*.json`, and JSON writes
   `"usedTeams":` — so it matched **0** of the four scenario fixtures the table's
   first four rows are about.
   **Response: accepted.** Pattern is now `'"?usedTeams"?:'`, measured 0 → 4, and
   the `"?` is annotated as load-bearing so it does not get "simplified" away.
   **Fourth failure of the same family on this one sweep.** Rule 5 promoted from
   aspiration to procedure: before writing a sweep up as complete, prove the
   command finds a known instance of EVERY shape it claims to cover.

2. **(P2) The plan's status table contradicted this log** — it said 2 rounds / 4
   findings / round 3 owed while the log recorded 4 rounds / 9 findings / round 5
   owed. A future session could have read the gate as nearly closed.
   **Response: accepted.** Row synchronised, and it now names this log as
   authoritative on disagreement so the two cannot drift silently again. The
   sweeps row likewise now warns that S2's command has been wrong four times.

3. **(P2) The round-1 resolution paragraph still described the shape questions as
   open** after Kevin had resolved them.
   **Response: accepted.** Marked SUPERSEDED in place rather than rewritten — the
   round-1 record stays honest — with a pointer to the current status.

## Round 6 — codex

VERDICT: REVISE. 2 findings (2×P2). Both accepted. Both are the plan telling the
implementing session to do something that would not work.

1. **(P2) The prescribed fixture fix would be silently ignored, and is bigger than
   stated.** The plan said the autosurvive fixtures "must gain a `picks` map".
   Measured: the scenario schema has **no `picks` field** — entries carry
   `survivorPicks`, and `nflSeasonSimulator.ts:331` persists
   `picks: numKeys(e.survivorPicks)`. Worse, the fixture has `scoreWeeks: [1]`,
   `nflGames` in week 1 only, and `testEntries[0].survivorPicks` is `{}` — its
   exemption comes entirely from seeded `usedTeams`.
   **Response: accepted.** Under strictly-prior counting there is no week before
   week 1 for a use to have occurred in, so **no edit to the entry alone can
   preserve this scenario.** It must be rebuilt with earlier `nflGames`,
   `survivorPicks` in those weeks, and `scoreWeeks` moved later. Written into the
   plan as scope, not a footnote.

2. **(P2) The fingerprint-version term was still MANDATORY while the plan
   simultaneously said no term was a valid option.** Under fix-forward it has no
   demonstrated benefit: a week first scored after deploy already runs the new
   code without it, and an already-scored survivor week is rejected by
   `survivorAllowedForGroup` before its fingerprint is computed. A global term
   would invalidate fingerprints for every NFL pool and trigger regrading nobody
   asked for.
   **Response: accepted.** Demoted from deliverable to an explicit decision with
   **NO as the default**; if the implementing session takes it anyway, the PR must
   name the concrete re-grade case it is buying. This reverses part of round 2's
   own finding — correctly, because round 2 predated the fix-forward ruling.

## Round 7 — codex

VERDICT: REVISE. 3 findings (3×P2). All accepted. All three are STALE COPIES that
round 6's fixes left behind elsewhere in the same documents.

1. **(P2) The obsolete "add a `picks` map" instruction survived** in the plan's
   risks section, directly contradicting round 6's correction a hundred lines
   above it.
2. **(P2) The sweep table said `testEntries[1]`'s picks were "absent entirely"** —
   it carries `survivorPicks: {"1":"SF"}`, which the simulator converts into a
   persisted `picks` map. All four scenario rows restated with what is actually
   persisted, so the rebuild cannot silently drop that week-1 reservation.
3. **(P2) The round-1 resolution paragraph still said the shape questions were
   open** — and worse, it was a DANGLING TAIL from an earlier botched replace of
   mine, so a sentence about a settled shape ran straight into a clause saying it
   was unsettled.

**Response: all accepted, and fixed by a SWEEP of each document rather than at the
three cited lines** — grepping every remaining instance of "picks map", "open
question 1" and "for Kevin" first, then editing all of them. Fixing only what a
reviewer cites is what produced rounds 5, 6 and 7 in the first place: each round
corrected one copy and left the others to be found next time.

## Round 8 — codex

VERDICT: REVISE. 2 findings (2×P2). Both accepted.

1. **(P2) The last surviving claim for the fingerprint version term was false.**
   Round 6 left it as "buys a week re-graded for an unrelated reason". It does
   not: once any other fingerprint input moves and the scorer runs, it executes
   the DEPLOYED eligibility code whether or not a version is hashed. The term's
   only distinct effect is forcing regrades when nothing else changed.
   **Response: accepted. The answer is now simply NO version term**, and the
   section is kept rather than deleted because "we considered hashing the
   algorithm and here is why it buys nothing" is the artifact worth having — a
   future change that DOES need historical regrading will want this reasoning and
   the `survivorAllowedForGroup` constraint that shapes it.

2. **(P2) S2 searched DECLARATIONS and never CALL SITES — a fifth shape failure.**
   `survivorRescore.test.ts:277` passes a divergent ledger straight into
   `checkAutoSurviveExemption` as an argument, reaching the helper as directly as
   any seeded entry, and it exists specifically to pin the behaviour this plan
   removes — so its assertion REVERSES. A property-name grep cannot see it.
   **Response: accepted.** S2 now carries two commands (declarations + call
   sites), both call sites are in the table with their verdicts, and the sweep
   rule gains a clause: enumerate the SHAPES a thing can take before writing the
   command — seed literal, JSON key, function argument — not just the files it
   can live in.

## Round 9 — codex (implementing session, on the refreshed plan)

VERDICT: **CLEAN.** "The changes update planning and sweep documentation only.
I found no actionable inconsistencies that would break existing code or tests."

Run 2026-08-10 against the S1–S4 re-run (shape-proofs executed first) plus the
recorded implementation decisions: required-context signature with the dead
`usedTeams` parameter removed (one counting path, so the modes cannot diverge),
and the concrete three-week fixture rebuild. This is the "one more codex round
before writing code" the round-8 stop demanded; implementation proceeds from
here, and the CODE will earn its own rounds.

## Round 10 — codex (round 1 on the CODE)

VERDICT: **CLEAN.** "The change consistently derives exemption eligibility from
picks in weeks strictly before the scored week, updates all direct call sites,
and covers future reservations, same-week picks, reuse limits, and divergent
ledgers."

Self-review of the same diff (§2c: a clean round 1 is not the review) found one
staleness codex did not: `checkAutoSurviveExemption`'s docstring still described
the pre-change rule ("already used or on bye") with no prior-week qualifier.
Fixed in the same PR. Gate evidence (all measured 2026-08-10): root tsc clean,
functions typecheck clean, root vitest 860/860, functions vitest 1432/1432,
emulator 348 passed / 2 expected-fail / 10 skipped with both rebuilt autosurvive
scenarios passing through the real callables; 4 mutations applied, 4 killed.

## Resolution status

**STOPPING AT 8 ROUNDS, NOT CONVERGED — and stopping is a judgement call, not a
clean result.** 8 rounds (7 codex, 1 qodo), 19 findings, 18 accepted and 1
rejected with reasoning on the PR. CLAUDE.md §2c allows up to 10; the remaining
two are deliberately left for the implementing session, which will have to run
codex again anyway once there is code.

Severity has settled — 2×P1 in round 2, then P2-only in rounds 3, 4 and 5 — and
**no round since round 2 has found anything wrong with the DESIGN.** Every finding
since has been in the sweep tooling or in doc consistency, and each was introduced
by the previous round's fix. That is exactly the pattern CLAUDE.md §2c predicts,
and it is why the counter is not the stopping rule.

**The DIRECTION is stable and signed off. The instructions are what keep being
wrong** — three rounds of sweep-command defects, then round 6 finding that the
prescribed fixture remedy would be silently ignored and that a "mandatory"
deliverable buys nothing under the chosen scope.

That is a useful thing to know about this plan: its shape is right and its detail
is not yet trustworthy. The implementing session should treat every specific
instruction here as a claim to verify against the code before acting on it,
re-run S1–S4 from scratch, and take one more codex round before writing code.

What HAS closed is the design. **Kevin resolved both shape-changing questions on
2026-08-09** — change both eligibility paths, and fix-forward only, with existing
wrong exemptions deliberately left standing until reset-and-replay exists. The
implementing session starts from a settled shape and an unsettled sweep.

### What eight rounds actually bought, and what a reader should take from it

**Nothing since round 2 has found a problem with the DESIGN.** Rounds 3–8 found
one class of defect over and over: a sweep command or an instruction that looked
right, ran clean, returned something plausible, and could not have found what it
claimed to cover. Five of those were the S2 sweep alone — JSON-only `--include`,
literal `|` under plain `grep`, `head` truncation, unquoted JSON key,
declarations-but-not-call-sites.

That is the honest summary to hand forward: **treat this plan's direction as
settled and every one of its specifics as a claim to re-verify against the code.**
The sweep tables are a starting inventory, not evidence. Re-run S1–S4 from
scratch, prove each command finds a known instance of every shape it covers, and
take at least one more codex round before writing code.
