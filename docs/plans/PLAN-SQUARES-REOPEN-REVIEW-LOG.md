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
| Q5 | qodo | #758 @ `77418e03`, #760 @ `3619b6cb` | 7 | 5 | 2 |
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

