# PLAN-SQUARES-REOPEN — review log

Findings from each review round, verbatim in substance, with the verdict and the
evidence. A rejection is recorded with its reasoning, the same as an acceptance.

> **STATUS: NOT CONVERGED.** One reviewer (qodo) has reported on PR-A and on
> PR-B, twice each. The second-model round CLAUDE.md §2c requires —
> `codex exec review` — **has not
> run on any PR in this plan**: `codex` is installed but not logged in on the
> machine this work was done on (`codex login status` → `Not logged in`). That
> gate is OWED, not waived. Nothing here should be read as "reviewed by codex".

| Round | Reviewer | Artifact | Findings | Accepted | Rejected |
|---|---|---|---|---|---|
| S1 | self-review | PR-A diff before push | 1 | 1 | 0 |
| S2 | self-review | PR-B diff before push | 1 | 1 | 0 |
| Q1 | qodo | PR-A @ `2499d8d0` | 12 | 11 | 1 |
| Q2 | qodo | PR-B @ `57290e7d` | 11 | 9 | 2 |
| Q3 | qodo (re-review) | PR-A @ `6095d92d` | 5 | 5 | 0 |
| Q3 | qodo (re-review) | PR-B @ `652fe64c` | 9 | 8 | 1 |
| W1 | browser walk-through | A + B + C + the reopen flip, on emulators | 9 | 9 | 0 |
| Q4 | qodo | #758 @ `d8978a82`, #759 @ `10d65cce` | 4 | 4 | 0 |
| W2 | the end-to-end test, and the gates | C + D | 3 | 3 | 0 |
| Q5 | qodo | #758 @ `77418e03`, #760 @ `3619b6cb` | 7 | 5 | 2 |
| Q6 | qodo | #761 @ `04996b6b` | 13 | 8 | 3, and 2 that are Kevin's |
| Q7 | qodo | #758 @ `0ac1bdb6`, #759 @ `085a0d07`, #760 @ `e4a06808`, #761 @ `c7af924f` | 8 | 7 | 1 kept as built, for Kevin to confirm |
| Q8 | qodo | #758 @ `74e37a35`, #761 @ `d9d81fe6` (#759 and #760: nothing new) | 6 | 5 | 1 kept as built, for Kevin to confirm |
| Q9 | qodo | #762 @ `d7e3bd11` (first review of the K7 PR) | 1 | 1 | 0 |
| Q10 | qodo | #758 @ `ed3af116`, #760 @ `c9191f58` (#759, #761, #762: nothing new) | 7 | 6 | 1 that is Kevin's (K11) |
| Q11 | qodo | all five, at the heads of round Q10 (`542b1313`, `b63403d8`, `3ec26e4b`, `5bf4640a`, `2a6232f1`) | 4 (raised 8 times across the five PRs) | 3 | 1 that is Kevin's (K11) |
| Q12 | qodo | all five, at the heads of round Q11 (`2776f1ef`, `ff34bd2c`, `7eb7b825`, `b1919e2d`, `b23d25fc`) | 3 (raised 4 times) | 1 | 2 — **not fixed, put to Kevin** |
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

## Round Q3 — qodo's re-review of both PRs (2026-11-10T18:41Z)

A push does not make qodo review again; a draft → ready toggle does. Both PRs
were toggled at 18:37Z and it re-reviewed each at its current head within four
minutes, updating its review comment in place. All three surfaces were read
again on each PR.

### PR #758 @ `6095d92d`

Of the twelve Q1 findings, qodo marks **eleven Resolved** (including the two
that were left open for Kevin, #6 and #10). The one rejection — #4, "an unknown
cap shows no limit" — is still listed and still rejected, for the reason in Q1.
Five new findings. Numbering is qodo's.

3. **(Medium, skill insight) Test counts in the review log are undated.**
   **Accepted.** Rounds S1 and S2 now carry a date and the commit they were
   measured ahead of, and the one count in this log says when it was taken and
   that current counts live in the PR descriptions.
4. **(Medium, skill insight) An unverified claim about the random generator is
   stated as fact.** Sweep SW3 said the generator's state "is recoverable from
   its outputs". Nothing here measured that. **Accepted.** SW3 now says what is
   known (not a cryptographic source; the earlier quarters' numbers are public)
   and that recoverability was not measured — and that the fix does not depend
   on it.
5. **(Medium, bug) A player cannot confirm payment when one of their squares
   was entered by the organizer.** `confirmPayment` accepts only squares
   stamped with the caller's account and refuses the whole request otherwise;
   the grid sent every square that was "mine", including ones matched by name.
   **Accepted — a real regression from Q1's fix #3**, which widened "mine"
   without checking what the server would take. `duesBuckets`
   (`shared/squaresClaim.ts`) is now the one rule: "I've sent payment" covers
   the squares on the player's account, and the others are shown as the
   organizer's to mark paid. 9 unit tests; 5 mutants, all red.
6. **(Medium, security) Two guests can be issued the same claim code.** The
   mint queried for the code and then wrote under a random id, so two mints
   could both pass the query, and the last of its five draws was never
   checked. **Accepted.** The code is the document id, taken in a transaction;
   a mint that cannot get a free code fails. Codes minted before the change
   still redeem. 10 emulator tests, which force the clash chance will not by
   passing the draw in; 8 mutants, all red.
17. **(Informational, skill insight) The backup warning uses an emoji outside
    the house marker set.** **Accepted** — one character.

Fixed in `e530fd3c`. 5 of 5 accepted.

### PR #759 @ `652fe64c`

Of the eleven Q2 findings, qodo marks **seven Resolved** and **dismissed two
itself** after reading the replies (#4 floor the prize pot — "false positive";
#11 winner-email wording — "deferred"). Two it still lists: #2 (Every Score
Pays scored by hand) and #5 (plan and review). Nine new findings.

1. **(High, bug) A quarter switched off after its winner was recorded leaves
   that winner on the books.** The page's own check looked only for records
   that were MISSING, so it reported a match and hid the button. **Accepted —
   and fixed at the root.** The page had a shorter copy of the server's rule.
   `planWinnerWrites` moved to `shared/squaresWinnerPlan.ts`; the page runs it
   and lists what would be added, changed and removed (`describeWinnerDrift`).
5. **(Medium, skill insight) The drawn-prize rule is kept in two copies.**
   **Accepted** — same move: `recordedEntry` is shared and the page calls it.
   A test runs both on every shape the two copies used to disagree about.
6. **(Medium, skill insight) The admin-audit gate compares the raw role
   claim.** **Rejected.** The gate that lets a SUPER_ADMIN act on a pool they
   do not run is `assertPoolOwnerOrSuperAdmin`, and it compares the same value
   the same way (`=== 'SUPER_ADMIN'`, `poolOps.ts:83`). The audit row is written
   for exactly the callers that gate let through as an admin. Normalising one
   of the two would make them disagree. Whether `confirmedAdminClaim` should
   normalise at all is a question about `lib/confirmedRole.ts`, which every
   pool type's callables share and this work does not touch.
7. **(Medium, bug) "Record winners" pressed straight after a score edit records
   the previous score's winner.** **Accepted.** The request now carries the
   scores the commissioner was looking at and the server refuses if the stored
   ones differ.
8. **(Medium, bug) A drawn prize that was paid can come back as unpaid.**
   Changing the unclaimed-prize rule after a draw moved the prize to the last
   winner (clearing "paid") and changing it back returned it to the drawn
   winner, unpaid. **Accepted — and the rule is simpler for it:** a draw that
   has been made stands, whatever the rule is set to afterwards.
9. **(Medium, bug) An old pool shows prizes that were never recorded, worked
   out by today's rules.** **Accepted in part.** A finished quarter with no
   record on an old pool now shows the owner of the square the score lands on
   and that quarter's plain share — no reverse split, no rollover, no
   unclaimed-prize award — and the card says no winner was recorded. It is not
   blanked: a hand-scored pool recorded no winners at all before 2026-11, and
   an empty card would be a worse account of that game than a labelled one.
10. **(Medium, bug) A second click un-pays a prize.** **Accepted.** The page
    says which state it wants and the server sets it; asking for the state a
    record is already in writes nothing. Un-marking asks first.
18. **(Informational, bug) "Pending" can go negative.** **Accepted.**
    `payoutTotals`: an unpaid prize is owed in full, a paid one only what it
    has grown by since.
20. **(Informational, skill insight) The sync cannot be paused if payouts
    misfire.** **Accepted.** `system/config.squaresWinners.paused`. While set,
    scores are still kept and no winner record is written; "Record winners" and
    the draw are refused in words. Clearing it reconciles everything.

Still listed from Q2, unchanged:

- **#2 Every Score Pays scored by hand.** One more guard added in this round:
  Every Score Pays **cannot be chosen** on a pool with no linked game, with the
  reason on the option. Entering each score of a game by hand remains plan
  K9(b).
- **#5 Plan and review.** The plan, this log and the sweeps are in #758, which
  merges first. Nothing to change in #759.

Fixed in `10d65cce`. 8 of 9 accepted (one in part), 1 rejected.

### What this round says about the last one

Two of the fourteen new findings are defects **in the fixes for the previous
round** — #758's "mixed dues" (introduced by Q1's fix #3) and #759's "drawn
winners can be marked paid twice" (reachable only through Q2's fix #9). That is
the pattern CLAUDE.md §2c describes for codex: round one finds defects in the
code, later rounds find defects in the fixes. It is the argument for the codex
round that is still owed, not against it.

## Round W1 — a browser walk-through of the whole thing (2026-11-10)

Not a reviewer: a run. With A, B and C merged and the reopen flag flipped
locally, the real app was driven in Chromium against the auth, functions and
Firestore emulators — register, create a pool through the wizard (the schedule
call answered by a fixture), claim as the organizer, as the organizer for
someone else, and as a guest in a second browser, lock, score a quarter by
hand, record the winner, mark it paid, switch the quarter off again.

It created a complete pool, opened both of its pages, and paid the right
square the right amount. It also found nine things, one of them serious, that
two rounds of review and every test had missed. Each is fixed; the first is the
one worth reading.

1. **(High) A square the organizer entered for somebody else still carried the
   organizer's account.** The fix for Q1 finding 12 compared the typed name with
   "the organizer's name" — which, for an account whose sign-in token carries no
   name (every email-and-password account, until its token is next refreshed),
   fell back to the name that was TYPED. The typed name always equalled itself,
   so nothing was ever "for someone else". **Every emulator test for that fix
   passed a token with a name in it, and so tested a sign-in the app does not
   produce.** Fixed in PR-A: the organizer's names are the token's, if it has
   one, and the one on their profile. Five emulator tests with a nameless
   token; six mutants, all red.
2. **(Medium) "In the money: ROLLOVER".** The pool page's banner named the last
   record in the list, which is in document-id order — `q1_reverse`, an unsold
   square. Fixed in PR-C (`latestPlayerWinner`).
3. **(Low) Prizes read "$12.5".** Fixed in PR-C (`formatPrize`).
4. **(Low) The payout list showed one winner's half as the quarter's prize**
   once a quarter with reverse winners had been played. Fixed in PR-C
   (`PeriodCard.prize`).
5. **(Medium) "Generate Numbers" locked the grid** — it was the lock button
   under another name, and neither asked first. One button now, named for what
   it does, and it asks. PR-C.
6. **(Low) The launch step said "$10/player"** for a price that is per square.
   PR-C.
7. **(Low) The record-winners list named "Rollover" as if it were a person.**
   PR-B.
8. **(Medium) Squares could only be picked with a mouse** — a bare element with
   a click handler, no name, not reachable by keyboard. PR-C.
9. **(Needs Kevin) A pool above ten players cannot be priced if squares has no
   pricing tiers.** A setting, not code — plan K10.

**What it says about the tests.** Finding 1 is the pattern from §2c again — a
defect in a fix — with a sharper edge: the tests for that fix were green
because they supplied the one input the defect needed to be absent. The new
tests use the token the app actually sends. The walk-through is being kept as
a permanent end-to-end test in PR-D for the same reason.

## Round Q4 — qodo on the round-Q3 fixes (2026-11-10)

Re-reviews forced by a draft → ready toggle on each PR; all three surfaces
read, filtered on `updated_at`.

**#758 @ `d8978a82` — clean.** Bugs (0). Every finding from Q1–Q3 is marked
Resolved except the one that was rejected in Q1 ("an unknown squares cap shows
'No limit'" — the page says what the server enforces), which stays open with
its reasoning.

**#759 @ `10d65cce` — four findings, all on one thing: the pause switch that
round Q3 added to close its finding 20.** That is §2c's pattern exactly — the
code written last, to close a reviewer's finding, was the code with the
defects in it. All four accepted.

| # | Finding | What was wrong | Fix |
|---|---|---|---|
| 1 | The simulator and "Fix Sync" still write winners while paused | The switch was read once, by the scheduled sync, and handed down as an argument. The two other callers of the same writer were never told. | The switch is read **inside the transaction that would write the winners**, by the writer itself. No caller passes it; no caller can forget it. |
| 7 | A pause set while a run is under way is missed | Read once per run, before the first pool. A run that takes a minute writes for a minute after the switch is set. | Same fix. Each pool's transaction reads the switch, so a pause set mid-run holds every pool not yet written, and one that lands while a write is being prepared makes that write retry and see it. |
| 2 | A paused game may never be caught up | The sync stops looking at a game 36 hours after kickoff (6 hours after its last update once finished). A pause that outlasted that left the game's winners unrecorded for good, while the PR said "nothing is lost". | A pool whose winners were held is **marked** (`squaresWinnersHeld`). Each sync run first looks for marked pools and, if the switch is clear, records them from their stored scores — whatever state the game is in by then. The mark comes off when the sync, the catch-up, "Record winners" or the draw records the pool. |
| 21 | The pause fails open when the config cannot be read | The read was outside the transaction and a failure meant "not paused". | The read is part of the transaction. If it fails the transaction fails: that pool is left exactly as it was and is tried again on the next pass. Neither fails open nor latches shut. |

**What the switch costs a pool that is not affected.** One extra document read
per winner write (only once a first quarter is final), and per sync run one
read of the switch and one query for marked pools that normally returns
nothing.

**One thing checked before choosing the document.** Reading a document in a
server transaction takes a lock on it, and `system/config` is read by the NFL
jobs. A lock held by a squares write would delay anything that WRITES that
document — so who writes it was measured, on 2026-11-10 at `fde71552`:

- **Cloud Functions: one file, two calls** — `functions/src/migrations/
  backfillProfileData.ts` lines 78 and 221, a migration run by hand. Method:
  every `const`/`let` in `functions/src` (tests excluded) bound to
  `collection('system').doc('config')` or `doc('system/config')` was listed —
  19 of them — and each file searched for `.set(` / `.update(` / `.delete(` on
  that name: none. Then the same three calls made directly on the reference:
  those two lines and no others.
- **The client: the Super-Admin settings page** (`src/services/
  settingsService.ts`, `setDoc` / `updateDoc`), by hand, when a super admin
  changes a setting.

**No scheduled job writes `system/config`.** Both writers are a person
pressing something. So a squares write holding a read lock for the length of
one transaction delays no NFL job, and the switch stays where the rollback
steps already say it is.

*(Corrected in round Q5. As first written this paragraph said "two hand-run
migrations" in one sentence and named one file in the next, gave no method,
and missed the client writer. qodo caught the contradiction.)*

**Fixed in `fde71552`. Tests.** 24 emulator tests: the simulator and "Fix Sync" under the switch; a
pause set from inside the feed fetch, after the run has started; a pause set
after the catch-up has looked and before a pool's own transaction; a game
three days over, recorded on the first run after the switch clears; the whole
story (paused through four quarters, cleared days later, paid in full); an
old-rules pool whose mark comes off with its records untouched; one pool
failing without stopping the next; a marked pool since put on Manual Score Override left for the
commissioner's button (round Q2, finding 3 — hand-typed scores are never
recorded on their own); and four with the config read made to fail.

**18 mutants, all red — but five survived their first run.** Each was a
missing test, not a wrong guard: the mark coming off on the ordinary sync
path; a marked pool being found among many unmarked ones; a mark removed
between the catch-up's query and its transaction; event prizes being paid by
the catch-up; and the catch-up not opening pools at all while paused. Each is
now written and its mutant fails. The first run of the suite had been green
with all five holes in it.

## Round W2 — what the end-to-end test and the gates found (2026-11-10)

Round W1's walk-through was turned into a test for PR-D
(`tests/e2e/squares-pool.spec.ts`) so that it runs every time and asserts what
was written to the database, not what the page showed. Written, it found two
defects on its first two runs. A third came from running the full gate set on
the PR-C branch for the first time. All three are fixed in PR-C (#760).

1. **(High) A name typed for someone else was silently replaced by the
   organizer's own before they pressed Reserve.** The grid pre-filled the name
   field with `useEffect(..., [currentUser])`. The app hands down a fresh copy
   of the user object whenever anything on the user's document changes; each
   one put the account's name back into the field. An organizer entering
   squares for "Uncle Ray" straight after taking a square of their own had
   their own name restored between typing and pressing the button, and the
   squares were recorded for the organizer, on the organizer's account.
   **The hand-driven walk-through (W1) had paused two and a half seconds
   between those steps, which was long enough to miss it.** The test does not
   pause. Fixed with `useAccountPrefill`: fill when someone signs in, and
   again only if that account's own name or email changes. 9 tests on the
   rendered hook; 7 mutants, the first of which is the original code.

2. **(Medium) "Record winners", pressed straight after typing a score, was
   refused with a red error.** The server refuses to record when the scores
   the page shows are not the ones stored yet (round Q3, finding 7) — rightly.
   But in the ordinary flow — type the score, press the button — the save had
   usually not landed, and the commissioner was told "…press Record winners
   again". The test was refused two runs in three. The page now waits out
   that one refusal for up to about three seconds, sending the same scores
   each time; every other refusal is reported at once. The server's guard is
   unchanged. 11 tests; 9 mutants, 8 red, and the ninth showed a redundant
   clamp that was removed.

3. **(Medium) The wizard previewed brand colours the squares page does not
   use.** PR-C's first commit switched the squares wizard to the NFL wizards'
   themed branding step. `tests/branding-renders.test.ts` already pins that
   only the NFL dashboards paint with those colours, and it was red — on a
   branch whose full gate set had not been run before its first push.
   Reverted to the plain step.

**What it says.** Finding 1 is the third time in this plan that a check was
green because of how it was run rather than because the code was right: the
emulator tests that passed a token the app does not send (W1), the walk-through
that paused where a person would not, and — finding 3 — a branch pushed before
its gates. Each was caught by the next, more literal check. That is the
argument for keeping the end-to-end test, and for the `codex` round that is
still owed on all four PRs.

**Not changed.** `create-pool.spec.ts` takes 7.7 minutes for seven wizards,
most of it in a helper that waits for a SUPER_ADMIN role the wizards no longer
need now that pool creation is open to members. It is slow, not wrong, and it
is shared by the NFL wizard tests — left alone.
## Round Q5 — qodo on #758 (third re-review) and #760 (first review) (2026-11-10)

All three surfaces read on each. #759's re-review of `fde71552` came back
**clean** — Bugs (0), all four round-Q4 findings marked Resolved.

### #758 @ `77418e03` — two new

| # | Finding | Verdict |
|---|---|---|
| 3 | The review log names two different sets of `system/config` writers | **Accepted.** Both sentences were written from one grep that looked only three lines past each reference. Re-measured properly; the paragraph in round Q4 now carries the method and the result, and names the writer it had missed. |
| 4 | An organizer can lose ownership of their own squares | **Accepted — and the fix replaces the mechanism rather than patching it.** See below. |

**Finding 4.** The server decided "the organizer is entering this for someone
else" by comparing the typed name with names it could find for the account.
A profile name that is only the email prefix — which the sign-up trigger
writes first, and an interrupted registration leaves behind — made the
organizer's own real name read as somebody else's, and their square lost its
account, with nothing on the page to say so.

That is the THIRD way the name comparison has been wrong (a token with no
name, round W1; token and profile names that differ, so the page and the
server could disagree about the same square; and this). Three is a pattern:
the server was guessing at something only the organizer knows.

**It no longer guesses.** One rule, `isEnteringForSomeoneElse`
(`shared/squaresClaim.ts`): the pool page evaluates it, shows the result
beside the name field, and sends it with the request as `onBehalf`. The server
follows it — **for the pool's owner only** — and does not compare names of its
own. A request with no flag is "these are mine".

The owner-only part is the security half: the per-player limit is counted by
identity, and a player who could shed theirs would never reach it. Three
`ATTACK:` tests — a player sending the flag, a player sending it under a new
name each time against a limit of two, and a guest sending it.

### #760 @ `3619b6cb` — five

| # | Finding | Verdict |
|---|---|---|
| 1 | Players can exceed the square limit by merging guest squares into an account | **Accepted** — fixed in #758 (`b111293a`), where that code lives |
| 2 | A pool can be linked to the wrong game — the server trusts the client's id, league, teams and kickoff | **Rejected as specified; the reachable half is fixed.** See below |
| 3 | A linked pool can be tied to the wrong league's feed | **Accepted** — fixed in #760 (`2cf665a5`) |
| 4 | Two auto-lock paths draw numbers differently, and the new default reaches both | **Accepted, in the half this plan may touch.** See below |
| 5 | Winner records are written by default, not held until switched on | **Rejected.** See below |

**Finding 1.** Reserving past the limit is refused; moving guest squares onto
an account was not counted at all. Fill the limit on a phone, fill it again on
a laptop, sign in on each, and one account held twice the limit.
`claimGuestSquares` now takes the pool's limit and is all-or-nothing: over it,
nothing moves and the squares stay exactly as they were — reserved, under the
guest's name, on the device that holds them. `claimMySquares` reports that as
a warning (the page calls it for every signed-in visitor; a refusal there is
not something they did); `claimByCode` refuses in words and does not use the
code up. The owner is exempt, as everywhere.

**Finding 2 — why the server lookup is not built.** Every field of a game
link is supplied by the pool's own commissioner — who may also type the scores
by hand, by design, and can write `scores`, `isLocked` and `payouts` straight
from the client (plan K4, `firestore.rules`, not this plan's to change). A
mismatched link gives them nothing those do not. Resolving the game on the
server at creation would make creating a pool depend on a third-party feed
being reachable at that moment, and still would not cover linking from the
manage page, which is a client write (K4 again). What a mismatch CAN do to an
honest commissioner is score the wrong game — and the one way the page could
produce that is finding 3, which is fixed at its source. Also tightened: a
game id must be digits. **Recorded as plan K11** with the design that would
close it properly: one `linkSquaresGame` callable used by both the wizard and
the manage page, shipped with the K4 rules change.

**Finding 4 — the second auto-lock in `reminders.ts`.** It is real, it is plan
K7, and the new default (a linked grid locks at kickoff) does put new pools in
its reach: `runReminders` locks any squares grid whose lock time has passed
and is still open, drawing with a biased `Math.random` sort. That file sends
the reminders for every running NFL pool and is outside the delegation.
What was done instead, in #760 (`2cf665a5`): the dedicated job
(`autoLock.ts`, every minute, `crypto.randomInt`) locks a squares grid from 90
seconds before its lock time rather than 30, so it has always run before the
lock time arrives and `runReminders` finds the grid already locked. (That
change is not in #758's own diff; this log is, because the log lives here.) That closes the race in normal
operation; it does not close it if the dedicated job is down or failing at
that minute. **K7 is now the first decision for Kevin, not the seventh.**

**Finding 5 — rejected.** It asks for winner recording to be off unless a
config flag turns it on. The house rule it cites is for a NEW scheduled job
that writes; this job has recorded squares winners since the product shipped,
and what changed is what it records. A switch that defaults to "held" would
mean no squares winner is ever recorded until somebody arms it — and that a
config document lost or reset silently stops every payout record, on a holiday
afternoon, with nothing failing. The switch is an emergency stop: absent means
running, and an unreadable config means nothing is written for that pool
until it can be read (round Q4). qodo's own note on the finding: "Team
repeatedly rejected 'add fail-closed system/config kill-switch to money or
data-writing job' suggestions."

**Tests and mutants for the #758 half.** 73 emulator tests in
`squaresClaim.emulator.test.ts` (58 before this round) and 66 unit (60
before). 15 mutants, all red on the first run.

**#758's fourth re-review, on `b111293a`: Bugs (0).** One new note, accepted:
the plan's K7 entry described the 90-second lock lead as a fact while this
branch's `autoLock.ts` still says 30 — the change is in #760. A reader of
this PR alone could have taken the race as closed. K7 and the paragraph above
now say which PR and which commit, and that the race is open until #760
merges.

## Round Q6 — qodo's first review of #761, the reopen (2026-11-10T22:57Z)

All three surfaces read. 13 findings on `04996b6b`: 7 bugs, 6 skill
insights. Each was traced in the code before anything was changed. The fixes
are on the branch where the code lives (#758, #759, #760) and merged up.

| # | Finding | Verdict | Where |
|---|---|---|---|
| 1 | Pool managers can alter live prize data (`firestore.rules`) | **Real, known, Kevin's** — plan K1 and K4. See below | — |
| 2 | The fallback lock can redraw winning digits (`reminders.ts`) | **Real, known, Kevin's** — plan K7. See below | — |
| 3 | Payout figures jitter as values change | **Accepted** | #760 |
| 4 | The wizard's kickoff check trusts the device clock | **Accepted** | #760 |
| 5 | The prize pot can keep fractional cents | **Rejected as asked; what it turned up is fixed** | #759 |
| 6 | The pause switch sits outside the settings types | **Accepted** (types only) | #759 |
| 7 | Players are locked out before the time they were shown | **Accepted** | #760 |
| 8 | A simulated game can miss winner records | **Rejected** — not what the code does; pinned | #759 |
| 9 | Signed-in guests see a false cap preview | **Accepted** | #758 |
| 10 | The release can go ahead without a full backup | **Accepted** | #758 (plan) |
| 11 | A used claim code can take later guest squares | **Accepted** | #758 |
| 12 | Wizard headings miss the display font | **Rejected** | — |
| 13 | The auto-lock job has no runtime kill switch | **Rejected** | — |

**1 and 2 — the two marked High, and both in files this work may not
change.** Neither is new: they are K1/K4 and K7, and both were already on
Kevin's list. What the finding adds is the framing — *reopening* is what
makes them matter — and that is right. So the hand-off now says it plainly:
**#761 is not to be merged until Kevin has decided K7, and has seen K1/K4.**

- *Finding 2 (K7).* `runReminders` locks any squares grid whose time has
  passed and is still open, with a biased shuffle. `reminders.ts` sends the
  reminders for every NFL pool that is running now. Mitigated, not closed:
  the dedicated job locks 90 seconds ahead, so in normal operation the other
  finds the grid locked. If the dedicated job is down at that minute, it does
  not.
- *Finding 1 (K1/K4).* A commissioner can write `scores`, `isLocked`,
  `payouts` and (four-set pools) `quarterlyNumbers` straight from the client.
  The commissioner is the trusted party in a squares pool — they hold the
  money and may type the scores by hand — so this gives a dishonest one
  nothing they could not already do off the site; what it costs is that the
  audited server paths can be gone around. Closing it is a rules change plus
  callables for the legitimate edits.

**5 — the prize pot.** The finding asked for `net = floor(gross − charity)`,
citing the stats trigger. That figure is a site-wide display total; what
winners are paid is to the cent, and a fee may carry cents. Flooring would
strand up to 99 cents the players paid in. What the finding did turn up:
`gross` and `net` were the only amounts in the module that skipped `toCents`,
so 100 squares at $1.10 read `110.00000000000001`. Fixed; a mutant that
floors the pot, as asked, turns three tests red.

**7 — the 90-second lead was mine (round Q5), and this is its cost.** The
page showed the stored lock time, kickoff, as "Grid locks", and the grid
locked up to a minute and a half before it. The lead is now one number in
`shared/squaresDefaults.ts`, read by the job to lock and by the page to show
the earliest moment that can happen. A deadline shown from it is one the
grid always keeps. If K7 is approved and the lead goes back to 30 seconds,
the page follows without being touched.

**8 — rejected.** The finding reads the winners gate as looking only at the
stored pool, so a simulation that had to draw the numbers would skip the
winners for that update. `processGameUpdate` builds the pool it reads as
`{ ...doc.data(), ...overrides }`, so the drawn numbers are there. Two
emulator tests drive the real callable on a grid with no numbers: the
first-quarter winner is recorded in the same update, on the numbers just
drawn. They passed before any code changed.

**11 — a claim code is spent the first time it moves a square.** It counted
its uses and never looked at the count. The check is read inside the
transaction that moves the squares, so two redemptions of one code cannot
both pass. A redemption refused over the limit, or one that found nothing to
move, does not spend it.

**12 — rejected.** `src/index.css` gives every `h1`–`h4` the display font
and uppercase; the two headings are `h3`. qodo's own note: the same finding
on the same heading was rejected in #471.

**13 — rejected.** It asks for the lock job to no-op unless a config flag
turns it on. That job locks bracket pools as well as squares grids; a switch
that defaults to off would stop every one of them until somebody armed it,
and an unreadable config would leave grids open at kickoff — the worst
failure a squares pool has. qodo's own note: "consistently rejected (#654,
#687, #691)". The creation flag and the winner-record pause are the stops
this rollout has.

**Tests and mutants this round.** #758: 7 emulator, 4 client; 7 mutants.
#759: 3 unit, 2 emulator; 4 mutants. #760: 5 unit, 5 on the rendered hook,
2 call-site; 9 mutants. All 20 mutants red on the first run.

## Round Q7 — qodo's re-reviews after round Q6 (2026-11-10T23:27Z)

All four PRs re-reviewed at their new heads; all three surfaces read on each.
**#761 raised nothing new** — what it still lists is findings 1 and 2 (Kevin's)
and the two rejected in round Q6. Eight new findings on the other three, every
one in code that round Q5 or Q6 changed — the code written last, to close
somebody else's finding, is the code most likely to be wrong.

| PR | Finding | Verdict |
|---|---|---|
| #758 | The backup gate names the wrong status | **Accepted.** I wrote `state: SUCCESSFUL` from memory; the export's output has no such field. The step now uses the check `PLAN-BACKUPS-PHASE3.md` already uses — list the files — and says the first line only means the export started |
| #759 | Guest squares stop moving after a limit refusal | **Accepted.** See below |
| #759 | "Pay the organizer" text for a player's own squares | **Accepted.** `duesBuckets` now says which host-only squares are still under this browser's key (`guestHeld`), and the note tells that player why they did not move |
| #759 | The grid highlights a namesake's squares as yours | **Accepted.** The highlight used a bare name match; it now uses `isOwnSquare`, the one rule |
| #759 | The claim-code comment says six characters | **Accepted.** It is eight |
| #760 | Guests cannot renew a spent transfer code | **Accepted.** See below |
| #760 | The pause switch has no entry in the client settings defaults | **Accepted** (in #759). I declined this in round Q6; it costs one inert line and the rule it cites is the repo's own |
| #760 | The prize pot skips the floor | **Kept as built — recorded as decision D23 (first labelled D19, which was taken), for Kevin to confirm.** qodo accepts the reason and asks that the departure be recorded and confirmed rather than live in a code comment. It is right about that |

**The two that were consequences of round Q6's "a claim code is used once"
and round Q5's "a merge respects the limit".**

- *A refusal over the limit was filed as a finished claim.* The page tries
  the guest-to-account merge once per session. The server's "moved nothing,
  you would be over the limit" came back as a success, so the page never
  asked again — not when the player gave up a square, not when the organizer
  raised the limit. The callable now returns `overLimit`, and the page
  remembers a refusal together with what it depended on (the limit, the
  account's count, this browser's count): the same question is not asked
  twice, a changed one is.
- *A spent code stayed on the old device's screen with no way to get
  another*, and the new device answered every refusal with "Invalid code or
  failed to merge." There is a "Get a new code" link under the code now, and
  the new device shows the server's own words for the cases a player can act
  on — used, expired, over the limit, too many tries.

**Tests and mutants.** 7 + 5 client tests (over-limit retry, failure text),
2 unit (`guestHeld`), 2 emulator (82 in the file). 13 mutants, all red on the
first run.

## Round Q8 — qodo after round Q7 (2026-11-10T23:56Z)

**#759 came back with no open bugs and nothing new. #760 came back with
nothing new** — its one listed bug is "a pool can score the wrong game",
rejected with reasons in round Q5 (plan K11). Six new findings, on #758 and
#761; four of the six are about what round Q7 wrote in the plan.

| # | Finding | Verdict |
|---|---|---|
| 1 | The backup step states expected output nobody ran | **Accepted.** Marked UNVERIFIED, with where the wording comes from and "trust the screen, not this page" |
| 2 | The money example in the pot decision does not add up | **Accepted.** I wrote "a full pool" over the numbers for 97 squares. It now shows the sum, and it is the case the test runs |
| 3 | Two decisions share the label D19 | **Accepted.** I took D19 without looking; it was in use. The pot decision is D23 |
| 4 | Guest claims miss a limit change that arrives mid-claim | **Accepted.** See below |
| 5 | The new "Get a new code" control misses the button style | **Accepted** — it carries the classes the "Sync" button beside it has |
| 6 | Winners are recorded when the pause field is absent | **Kept as built — Kevin's to confirm.** See below |

**4.** The page asks the server to merge guest squares; while that is in
flight the limit is raised; the page asks again and is told "in flight"; the
first claim, which read the pool before the change, comes back "over the
limit" — and writes nothing, so nothing prompts a third ask. The newest
question asked during a flight is now kept, and asked when the flight ends
in a refusal that a different question might not get.

**6.** The finding itself says the design is deliberate and asks for one of
two things: confirm it with the maintainer and say so here, or require an
explicit "on". It is decision D18 and it was rejected as a code change in
round Q5 for a stated reason — a switch that must be armed means no squares
winner is recorded until somebody arms it, and a config document that is
lost or reset stops every payout record with nothing failing. What can be
done from here is done: it is recorded, and **it is on the list put to Kevin
to confirm**, with the pot decision (D23).

**Three of these six are the same mistake**: something written into a
document from memory instead of from a command or a file — a field name
(round Q7), a label, an example's arithmetic. Each took a reviewer to find.

## Round Q9 — qodo's first review of #762, the K7 PR (2026-11-11T00:02Z)

One finding, and **none about what #762 itself changes**: nothing on the
`reminders.ts` edit, the removed copy, or the lock lead.

| # | Finding | Verdict |
|---|---|---|
| 1 | Commissioners see a false game link | **Accepted** — fixed in #760, whose code it is |

The manage page called its update and showed "Linked to …" on the next
line, then closed the picker. The update is a write that can be refused, so
the page could say a game was linked while the pool had not changed. The
link is now `linkSquaresGame`: it awaits the save and reports what happened;
the page toasts on that, and the picker closes only once the link is saved.
10 tests on the link, 1 call-site, 9 mutants, all red.

## Round Q10 — qodo at the heads of round Q9 (2026-11-11T00:29Z – 00:32Z)

**Surfaces.** For this round all three were read on all five PRs: the issue
comments (qodo's report and its "updated up to" note, which names the head
it reviewed), the inline review threads, and the reviews list. The reviews
list on each PR holds only empty review containers — qodo's, one per pass,
and one for each reply made here — and nothing that is not also an inline
thread. A re-review was asked for by the draft → ready toggle after each
push, and each report was read only once its "updated up to" note named the
pushed head.

**A correction to rounds Q6 and Q7 (finding 5 below).** Both say "all three
surfaces read". In those rounds, and in Q8 and Q9, what was read was the
issue comments and the inline threads; the reviews list was not pulled until
this round. It was then read back to each PR's first review and holds
nothing the other two do not, so no finding was missed — but the sentence
was written before it was true, and it is the fifth thing in this log found
to have been written from memory rather than from a command.

**#759, #761 and #762 raised nothing new. #762 is clean: no bugs, no
insights.** Seven new findings, on #758 and #760:

| # | PR | Finding | Verdict |
|---|---|---|---|
| 1 | #758 | Guests lose a queued ownership claim | **Accepted** — see "the guest merge" below |
| 2 | #760 | Failed guest merges go untracked | **Accepted** — same |
| 3 | #760 | Incomplete exports pass the backup gate | **Accepted.** The plan took files in the bucket as proof. An export still running, or one that failed part-way, leaves files too. The gate is now both: the operation has finished with no error, and the files are there |
| 4 | #760 | A started game can be linked to a pool | **Accepted, in the half this work can reach.** The link itself now refuses a game that has kicked off, by the server's clock; before, only the greyed-out button did. Refusing it on the server is K11 |
| 5 | #760 | Two qodo rounds omit the surface-read record | **Accepted** — the paragraph above, including what rounds Q6 and Q7 got wrong |
| 6 | #760 | Pool names collide after many game links | **Accepted.** The search for a free name stopped at 49 and used that one unchecked. A pool with no free name is linked and keeps the name it has |
| 7 | #760 | The manage page's game link is a client write | **Kevin's — plan K11 and K4.** It is the same finding as "a pool can score the wrong game" (round Q5) from the other side, and the answer is the same: one `linkSquaresGame` callable, with the rules change that makes the link fields server-only |

**The guest merge (1 and 2) — rebuilt rather than patched a fourth time.**
Rounds Q7, Q8 and now Q10 each found a way the guest-to-account merge gave
up too early or told nobody what happened. Each fix added a branch; each
branch drew the next finding. The cause was that the retry was split between
two places that could not see each other: a helper that remembered answers,
and an effect inside the grid that counted failures.

- **The helper owns the whole chain.** One call is the claim plus, at most,
  two follow-ups for questions that arrived while it was in flight. A
  question that arrives meanwhile is asked when the flight lands — after a
  refusal *or a failure*, not after a move. The caller is told how the chain
  **ended**, so a follow-up that fails is counted.
- **The grid's effect is a hook** (`useGuestSquaresMerge`), so when it asks,
  when it asks again and when it gives up are tested on a rendered hook
  rather than argued from the code — which is what finding 1 asked for.

Tests: 11 on the chain (42 in `guestKey.test.ts`), 18 on the hook. 17
mutants: 16 red on the first run. The seventeenth showed that "no follow-up
after the squares moved" was guarded only where the browser has session
storage; a test for the storage-blocked case was added and the mutant is red.

## Round Q11 — qodo at the heads of round Q10 (2026-11-11T01:02Z – 01:04Z)

**Surfaces.** On all five PRs: the issue comments (the report, and the
"updated up to" note naming the head reviewed — each names the head pushed in
round Q10), and the inline review threads. **The reviews list was NOT read
before this round's verdicts and fixes were written** — it was skipped on the
strength of round Q10, where it held nothing but empty review containers.
That is a skipped surface, and qodo said so (round Q12, finding 3). It was
read afterwards, for all five PRs, in round Q12: still nothing but empty
containers, so no finding was missed — but that was not known when this
round's work was done.

**Round Q10 said the guest merge had been "rebuilt rather than patched a
fourth time". It drew three more findings, and they are the same mistake.**
The rebuild moved the retry into one place and left the MEMORY where it was:
"done", kept in the browser session under the pool and the account. Every
finding below is that memory outliving what it meant.

Eight threads, four findings:

| # | Raised on | Finding | Verdict |
|---|---|---|---|
| 1 | #758, #761, #762 | A success that moved NOTHING is remembered as done — and the hook asks when ANY guest holds a square, so most signed-in visitors got that empty success. Squares they then reserve as a guest and sign back in to are never moved to the account, until the tab is closed | **Accepted** |
| 2 | #762 | A new browser key is answered with the old key's result | **Accepted** |
| 3 | #758, #759, #762 | Three failures for one account, or one pool, stop the next account or pool on the same mounted grid; and a result that lands late is charged to whoever is there now | **Accepted** |
| 4 | #762 | A started game can still be linked — the refusal is in the browser only | **Kevin's — plan K11 and K4.** The same finding as round Q10's 4 and 7, raised on the K7 PR. The thread stays open |

**Finding 1 was worse than qodo said.** The grid gives every visitor a browser
key on arrival, so "this browser has a key" was true of everyone: every
signed-in visitor to a grid with any guest square on it was asked for, moved
nothing, and was marked done for the session.

**What was built — the memory is gone from the helper.**

- **`mergeGuestSquares`** (was `claimGuestSquaresOnce`) remembers nothing and
  writes nothing to the browser session. It does what only it can: one call
  at a time for a pool and account; the newest question asked meanwhile is
  asked when the flight lands; the caller is told how the chain ended **and
  which question that answer belongs to**. A success that moved no squares is
  reported as `nothing-moved`, not as a move.
- **`useGuestSquaresMerge`** decides whether to ask, because it can see the
  grid. It asks only when a square is held under **this** browser's key, and
  not before that key's hash is known. The question is the key, the limit,
  the account's count and **which** squares the browser holds. An answer is
  kept only against the question it answered, only for the life of the page,
  and is dropped when the browser holds nothing — so the same squares, given
  up and reserved again, are a new question. Failures are counted per pool
  and account, against the one that asked.

**A design that was written first and thrown away.** The first draft kept the
session memory and keyed it by the counts ("limit : on the account : on this
browser"). It was abandoned before it was committed: the same counts come
round again — merge two, give two back, reserve two — and the old answer
would have met them. Naming the squares instead of counting them, and
dropping the answer when there is nothing to ask about, is what closes that;
and once the answer is dropped that readily there is nothing worth writing to
the session.

**What it costs.** A signed-in player whose browser still holds guest squares
is asked for once per page load, where before it was once per browser
session. For a player over the pool's limit that is one refused call per
load. The call is idempotent.

Tests: 22 on the helper (40 in `guestKey.test.ts`), 37 on the hook. **38
mutants. 36 were red on the first run; the two that survived were gaps in
the tests, not in the code**, and a test was added for each: an answer that
lands after the grid has already shown the move must not be kept (the
listener is usually quicker than the call), and a failed attempt must not be
retried by a re-render that changed nothing. 38 of 38 are red now.

**If this draws a fifth round on the same mechanism, it goes to Kevin as a
question — whether guest squares should move to an account automatically at
all, or only when the player asks — and not into a fifth fix.**

## Round Q12 — qodo at the heads of round Q11 (2026-11-11T01:38Z – 01:39Z)

**How a report was waited for.** The `mmp-qodo-cycle` watcher is a script
around `gh`, and `gh` is not available where this work is being done. What
stood in for it in every round of this log: a subscription to each PR's
activity, a draft → ready toggle after each push to ask for a review, and a
read of the surfaces through the GitHub API tool — a report being read only
once its "updated up to" note named the head that had been pushed. In this
round qodo also updated its reports within a minute of the push, marking
findings resolved; those updates were NOT taken as a review of the new heads,
because the notes still named the old ones. The toggle was made ten minutes
later and the notes then named the new heads.

**Surfaces — all three, on all five PRs, read before the verdicts below.**
The issue comments; the inline review threads; and the reviews list, read to
its last entry on each PR (each came back whole, in one page). Every entry on
the reviews list is a `COMMENTED` container with no text of its own — qodo's,
one per pass, and one for each reply made in these rounds. Nothing on it that
is not also an inline thread.

Four threads, three findings:

| # | Raised on | Finding | Verdict |
|---|---|---|---|
| 1 | #762 | A claim that MOVED squares drops a question that arrived while it was in flight. If this browser reserves more squares as a guest after the server has committed and before its answer lands, they are not moved until the grid next changes or the page is reloaded | **Not fixed — put to Kevin.** See below |
| 2 | #760 | An answer that lands late can be kept for a NEW reservation of the same squares: the claim moves nothing, and before its answer arrives this browser's squares are given up and reserved again in the same positions | **Not fixed — put to Kevin.** See below |
| 3 | #758, #760 | Round Q11 did not read the reviews list, and no round says how a report was waited for; the PR description says all three surfaces are read each time | **Accepted.** Round Q11's paragraph now says what was skipped and when it was read; this round records the method; #758's description is corrected |

**Findings 1 and 2 — why they are not fixed.** Round Q11 ended: "If this
draws a fifth round on the same mechanism, it goes to Kevin as a question …
and not into a fifth fix." This is the fifth round. Each of the four before
it closed what was reported and the next review found the neighbouring case;
a fix written at this point would be the least reviewed code in the stack.

What was traced, so the decision is made on the mechanism and not on the
label (both are marked High / Medium):

- **Both need a second thing to happen inside one round trip to the
  server** — between the server committing the merge and the page hearing
  about it.
- **Both need this browser to reserve as a GUEST while it is signed in.**
  The merge only runs for a signed-in player, and a signed-in player's
  reservation goes on their account, not under the browser's key. The app
  does not set a sign-in persistence, so it uses Firebase's default, which
  is shared by every tab of the browser — a second tab is signed in too.
  (Checked: no `setPersistence` / `initializeAuth` in `src/`.) No ordinary
  path through the app was found that reaches either case.
- **If one were reached, nothing is lost.** The squares stay reserved, under
  the browser's key, exactly as they were before the player signed in. They
  move to the account on the next change to the grid by anyone, or on the
  next page load. No money is involved and no square changes hands.

**What Kevin is asked (plan K12):** leave it as it is (recommended); or one
more change — ask again when the grid has moved on by the time an answer
lands, and number each stretch in which the browser holds squares so a late
answer cannot be kept for a later one, about ten lines and their tests; or
stop moving guest squares automatically and give the player a button.

Nothing in the code changed in this round. Both threads are left open.
