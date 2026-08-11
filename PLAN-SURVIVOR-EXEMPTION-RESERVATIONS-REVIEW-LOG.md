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

## Resolution status

**NOT CONVERGED — round 3 is owed.** 2 rounds, 4 findings, 100% accepted, zero
disputes. Severity went UP in round 2 (1×P2 → 2×P1), which is the opposite of the
converging trajectory a plan should show, so this is explicitly not ready to
implement. Round 1 complete, 1 finding, 100% accepted. The plan's two open
questions (default-path change vs. path divergence; and whether any live pool
currently holds an exemption this would revoke) are for Kevin and are NOT review
findings — they are deliberately left open for sign-off.
