# PLAN-SQUARES-REOPEN — review log

Findings from each review round, verbatim in substance, with the verdict and the
evidence. A rejection is recorded with its reasoning, the same as an acceptance.

> **STATUS: NOT CONVERGED.** One reviewer (qodo) has reported on PR-A. The
> second-model round CLAUDE.md §2c requires — `codex exec review` — **has not
> run on any PR in this plan**: `codex` is installed but not logged in on the
> machine this work was done on (`codex login status` → `Not logged in`). That
> gate is OWED, not waived. Nothing here should be read as "reviewed by codex".

| Round | Reviewer | Artifact | Findings | Accepted | Rejected |
|---|---|---|---|---|---|
| S1 | self-review | PR-A diff before push | 1 | 1 | 0 |
| S2 | self-review | PR-B diff before push | 1 | 1 | 0 |
| Q1 | qodo | PR-A @ `2499d8d0` | 12 | 11 | 1 |
| Q2 | qodo | PR-B @ `57290e7d` | 11 | 9 | 2 |
| — | codex | — | **OWED** | — | — |

---

## Round S1 — self-review of PR-A, before the first push (2026-11-10, ahead of `940b6c10`)

1. **(High) `exemptFromCap` could be true for a signed-out visitor.** The pool
   page computed `squaresPool.ownerId === user?.id`. On a pool document with no
   `ownerId`, a signed-out visitor has `user?.id === undefined`, and
   `undefined === undefined` — so the preview exempted them from the limit.
   **Accepted.** `!!user?.id && squaresPool.ownerId === user.id`. Preview only;
   the server was never affected.

## Round S2 — self-review of PR-B, before the first push (2026-11-10, ahead of `57290e7d`)

1. **(Critical) Opening the admin page of a FINISHED pool would have rewritten
   its winner records.** The admin page asks the server to reconcile winners
   whenever a period score is present. For a pool played months ago under the
   old rules that means re-deriving its winners under the new ones — charity off
   the top, rollover, the reverse-winner fix — and overwriting what the
   commissioner actually paid from. **Accepted.** Decision D14: record-keeping
   under the new rules applies only to pools created on or after 2026-11-10
   (`SQUARES_RULES_SINCE_MS`); an unreadable `createdAt` counts as old; the two
   new winner callables refuse an old pool; the pool page shows a recorded
   amount as recorded. Five emulator tests and eight mutants pinned it **as
   measured on 2026-11-10 at `57290e7d`**. Later rounds added tests to the same
   files; the current counts are in each PR's description, which is re-measured
   at every push, and not in this log.

## Round Q1 — qodo, PR #758 @ `2499d8d0` (2026-11-10T17:44Z)

All three surfaces read: 2 issue comments (summary + review), 1 review, 12
inline threads. 7 bugs, 5 "skill insights". Numbering is qodo's.

1. **(High, skill insight) Glossary misstates how membership is set.** The claim
   paths add the claimant to `participantIds`; `CONTEXT.md` says every join path
   writes `participantIds`, the Member Record and the `participations` mirror in
   one transaction.
   **Accepted.** Verified: no squares callable calls `ensureMemberRecord` /
   `stageEnrollment` (`git grep` — only the NFL paths, `poolCreation`,
   `poolExceptions`, `setPaidStatus`, `statsTrigger`). The mirror is built by the
   `syncParticipantIndices` trigger. `CONTEXT.md` now says so, and says a guest
   is not a Member until they claim into an account.

2. **(High, bug) Guessed codes can transfer guest squares.** `claimByCode` looks
   up a six-character code with no attempt limit.
   **Accepted.** 32⁶ ≈ 1.07 × 10⁹ codes, valid 24 hours, unlimited guesses, and
   a hit moves the squares and grants membership. Two bounds, because neither is
   enough alone: the code is now 8 characters (≈ 1.1 × 10¹²), and every attempt
   is charged against a per-account limit of ten in fifteen minutes (the existing
   `lib/poolAttempts` throttle, in a scope of its own). **Not** refunded on a
   correct code, unlike the pool-password throttle: anyone can mint a code of
   their own, so a refund would let an attacker redeem their own every ninth
   guess and never run out. A clash between two live codes is re-drawn at mint.
   Typed codes are compared upper-cased with spaces and dashes removed.
   *Not done:* qodo also suggested a per-CODE attempt limit. An attacker does
   not know the code, so there is nothing to count against it.

3. **(Medium, skill insight) "I've paid" skips a player's squares.** The grid
   decided "mine" by display name only, while the limit counted by account.
   **Accepted.** One exported `isOwnSquare(square, identity, name)` — identity
   first, a name match only on a square with no identity — now used by
   `planClaim`, the grid's three counts and the paid action.

4. **(Medium, skill insight) An unknown squares cap shows "no limit".**
   `squareCapSentence` returns "No limit" for `undefined` / `null` / `NaN`,
   where the old page showed "N/A".
   **REJECTED.** The page says what the server enforces, and the server enforces
   an absent or unreadable cap as no limit (`effectiveSquareCap` → `null`;
   emulator test "an absent limit is no limit too"). "N/A" was one of the six
   meanings the same stored value had (C2) — showing "unavailable" for a pool
   that will in fact accept any number of squares would put that disagreement
   back. If a cap must never be absent, that is a creation-time validation, and
   `createPool` already writes one.

5. **(Medium, skill insight) Authorization changes ship with no adversarial
   review record.** No `-REVIEW-LOG.md`, no `-SWEEPS.md`, codex owed.
   **Accepted.** This file, and `PLAN-SQUARES-REOPEN-SWEEPS.md`. The codex round
   is still owed and is marked so at the top of this file rather than papered
   over.

6. **(Medium, skill insight) A red required CI check is set to merge.**
   **Accepted as a merge precondition; no code change.** `docs-state-invariants`
   fails only in the shallow clone this was built in and passes in CI
   (`build-and-test` is green on the PR head). `security-audit` is red on `main`
   too. Plan §0 now states that none of A–D is merged over it without either the
   dependency PRs landing or Kevin's recorded decision. This work does not
   merge PRs.

7. **(Medium, bug) A failed claim waits out the session.** The grid set its
   once-per-session flag before awaiting `claimMySquares`, whose quiet mode
   swallows failures.
   **Accepted.** `claimGuestSquaresOnce` records "done" only after success,
   never runs two at once, and the grid retries on its next change (at most
   three failures a page load).

8. **(Medium, bug) Re-booked squares keep the old holder's payment claim.**
   **Accepted.** `planClaim` now clears `paymentConfirmedAt` /
   `paymentConfirmedByUid` on every square it reserves.

9. **(Medium, bug) Guests can select squares they cannot buy.** The page
   previewed a guest's claim with no device identity.
   **Accepted.** The browser computes the same pool-salted hash the server
   stores (`hashGuestKey`, Web Crypto) and previews with it. Both sides are
   pinned to one test vector, so they cannot drift apart silently.

10. **(Medium, bug) Rollback has no verified full backup.**
    **Accepted; Kevin's to do.** There are no production credentials here, so a
    backup can neither be taken nor checked. Plan §0 now says so in plain words
    and makes "confirm PITR + take an export" step 1 of the deploy runbook, with
    the commands.

11. **(Medium, bug) Auto-release can free squares players already paid for.**
    Stamping `reservedAt` switches on a job in `reminders.ts` that has never run
    and is not safe to run.
    **Accepted — the most valuable finding of the round.** Verified at
    `reminders.ts:494-540`: the list is built outside the transaction, the
    release inside it is by id alone, and `paymentConfirmedAt` is not consulted.
    `reminders.ts` also sends the NFL reminders and is outside this work's
    authority, so qodo's second option is taken: the claim is recorded under
    `claimedAt`, `reservedAt` is written as `null`, and the job stays dormant.
    Written up for Kevin as K6.

12. **(Medium, bug) Squares a commissioner enters for players are credited to
    the commissioner.**
    **Accepted.** When the pool's owner reserves under a name that is not their
    own, the square carries the name and no identity, and its contact details
    are the player's as typed. A player (not the owner) typing a different name
    still holds the square by account.

**Round result:** 11 accepted (9 with code or doc changes, 2 as recorded
preconditions for Kevin), 1 rejected. Every code change in this round is new
code no second model has seen — §2c's "new code written to close a finding
earns its own round" applies, and that round is the owed codex one.

## Round Q2 — qodo, PR #759 @ `57290e7d` (2026-11-10T17:54Z)

All three surfaces read. 7 bugs, 4 "skill insights". Numbering is qodo's.

1. **(High, skill insight) Squares money terms missing from the glossary.**
   **Accepted.** `CONTEXT.md` gains a Squares Winner Record entry: what a record
   is, that it follows the scores, charity off the top, the reverse-winner
   rule, the unsold rules, and that "Paid" on a record means the PRIZE was paid.

2. **(High, bug) Manually scored games can pay no prizes.** On an
   Every-Score-Pays pool scored by hand, no scoring-event records exist — they
   are created only as the score sync sees each score.
   **Accepted as a stated limitation, with a guard; the feature is not built.**
   Every Score Pays needs the game linked to the live feed: scoring events
   cannot be reconstructed from four quarter-end scores, and inventing them
   would be paying on guesses. The admin page now says so and will not offer
   Manual Score Override on such a pool; `recomputeSquaresWinners` reports
   `eventsNotRecorded` when it finds a finished Every-Score-Pays game with no
   event records, and the page tells the commissioner in words. Entering scoring
   events by hand is written up as K9.

3. **(High, bug) Players get a winner email for a score still being typed.**
   The admin page reconciled winners 1.5 s after any period-score change; manual
   entry writes on every keystroke, and creating a winner record sends the
   one-time winner email.
   **Accepted — the most valuable finding of the round.** The automatic
   recompute is removed. Winners are recorded by an explicit **Record winners**
   button, and after "Auto-Update Scores" (whose period scores come from the
   feed, not from typing). The page shows which final periods have no record
   yet.

4. **(Medium, skill insight) The charity-adjusted prize pot is not floored to
   whole dollars.**
   **REJECTED.** The "both floored" wording in `mmp-pools-domain-reference`
   describes `calculatePoolPot` in `statsTrigger.ts`, which feeds the PUBLIC
   site totals — a reporting figure. Flooring the pot that prizes are paid from
   would take up to 99¢ of the players' money per pool and give it to nobody.
   The engine keeps `gross = charity + net` exactly, as the pool page it
   replaces already did (`payouts.ts:43-45` at `980efc94`). With a whole-dollar
   price — every pool to date — the two agree. The skill's wording is corrected
   in PR-D.

5. **(Medium, skill insight) The payout change lacks its plan and review.**
   **Accepted.** The plan, this log and the sweeps live in #758; #759's
   description now says so and names #758 as merging first.

6. **(Medium, skill insight) The new callables leave no admin audit record.**
   **Accepted in part.** `admin_audit` is the SUPER_ADMIN actor log; a
   commissioner's action on their own pool belongs in the pool's audit trail,
   which is where `lockPool`, `toggleWinnerPaid` and `updatePlayer` already
   write and where these three write. What was missing is the case qodo's own
   caveat points at: a SUPER_ADMIN who is NOT the pool's commissioner acting on
   someone else's pool. That now also writes `admin_audit`.

7. **(Medium, bug) Paid totals count unissued adjustments.** "Paid Out" summed
   the CURRENT prize of every record marked paid.
   **Accepted.** `toggleWinnerPaid` records `paidAmount` — what the prize was
   when it was marked — and the Payouts tab totals that and shows the
   difference when the prize has since changed.

8. **(Medium, bug) Corrected winners can be marked paid.** `toggleWinnerPaid`
   read the record and wrote it back outside a transaction.
   **Accepted.** It is transactional and takes the winner the commissioner was
   looking at; if the record now names someone else it refuses, so a click meant
   for the old winner cannot mark the new one paid.

9. **(Medium, bug) The final-prize draw can still be re-rolled.** Switching the
   final score off and on made the reconcile delete the drawn record, `drawnAt`
   with it.
   **Accepted.** A drawn record is never deleted. While the scores call for no
   unclaimed prize it is kept at $0 with a CRITICAL audit line, and the draw
   stays refused.

10. **(Medium, bug) Old pools show rollover money they never paid.**
    **Accepted.** For a pool on the old rules the cards show the records and
    nothing derived from today's math: no "includes $X rolled over".

11. **(Low, bug) Announcements name "Rollover" but skip the drawn winner.**
    **REJECTED for this plan; written up.** Both halves live in
    `onWinnerComputed` in `reminders.ts`: it announces every created record,
    whoever the owner, and it fires on create only. That file is outside this
    work's authority. The email is opt-in per pool, and "Q1 — Rollover, $0" is
    true if terse. Carried to Kevin as part of K9.

**Round result:** 9 accepted (one of them as a stated limitation), 2 rejected.
