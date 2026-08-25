# Review log — PLAN-MEMBER-REMOVAL-HARDENING

Reviewer: `codex exec review --base origin/main` (plan + implementation in one
diff). CLAUDE.md §2c; **qodo DORMANT** (§2b, Kevin 2026-08-19) — the stopping
rule is TWO conditions: a clean codex round AND my own read of the diff agrees.
Cap 10 rounds, flat.

Base: `origin/main` = `64183316`.

## Round 1 — 2026-08-25

_(The first invocation returned `ERROR: Selected model is at capacity` and was
re-run. Not counted as a round — no review was produced.)_

VERDICT: REVISE. 1 finding (P2), **ACCEPTED**.

1. **(P2) The reciprocal-index cleanup is undone by `syncParticipantIndices`.**
   `functions/src/lib/memberRecord.ts:316-317`.

   > For a SQUARES pool where the removed user still owns reserved/paid squares,
   > this transaction's pool update invokes `syncParticipantIndices`. That
   > trigger rebuilds its stats from `squares` and unconditionally `set`s both
   > `participants/{uid}` and `users/{uid}/participations/{poolId}`, recreating
   > the two documents deleted here immediately after commit.

   **Verified before acting.** `syncParticipantIndices`
   (`functions/src/participant.ts:243`) is `onDocumentWritten("pools/{poolId}")`
   — it fires on ANY pool-document write, and `applyMembershipRemoval` makes
   one. Its owner loop keyed on `s.reservedByUid || s.paidByUid` with no roster
   check, and both writes are `set(..., { merge: true })`. The finding is exact:
   the cleanup would have been undone within the same second, and only for
   SQUARES pools — the one type whose index the fix most needed to reach.

   **Fix:** a roster guard in the trigger. A uid that is not in
   `after.participantIds` gets no index doc.

   **Why the guard is safe, checked rather than assumed.** `reserveSquare`
   (`squares.ts:98-116`) never writes `reservedByUid` at all — it stores a
   display NAME — so the only writers are `claimMySquares`
   (`participant.ts:129`) and `claimByCode` (`:202`), both of which prove
   ownership with a `guestDeviceKey` read off the world-readable pool document
   (SECURITY-CLAIM-SQUARES.md). Three other surfaces already refuse that signal
   as membership: `backfillMemberRecords`' `applySquareUnits` gate,
   `fixParticipantIds` (its squares block was deleted, `poolOps.ts:825-843`),
   and `shared/memberRecord.ts:227-230` ("review round 5 removed it"). This
   trigger was the last surface still minting membership indexes from it.

   **Consumer impact traced to the end, both docs:**
   - `pools/{id}/participants/{uid}` — read only by
     `backfillMemberRecords.ts:75`, and only as an enrichment name source gated
     to uids some other signal already established. A uid not in
     `participantIds` was already rejected by that gate, so nothing is lost.
   - `users/{uid}/participations/{poolId}` — read by `recomputeUserProfile`
     (`userProfile.ts:62`, filtered to `NFL_SEASON_TYPES`, which a SQUARES pool
     never matches) and by `getMyParticipations` (`dbService.ts:668`), whose one
     caller `PlayerProfile.tsx:130-132` filters to the same three NFL types.
     **Zero reachable consumer.** It is not the "My Pools" list.

   **Unknown is not "not a member".** A legacy pool with no `participantIds`
   keeps the old behaviour rather than silently losing its indexes — the same
   discipline `lib/memberRecord.ts` applies to `hasPlayableEntry`. Every removal
   writes the array (`arrayRemove`), so the guard is always armed in the case it
   exists for.

   **Pinned by test:** `memberRemoval.emulator.test.ts` H3, three cases — a
   listed uid is still indexed (no collateral), an unlisted uid writes nothing,
   and a pool with no `participantIds` keeps the old behaviour. The trigger is
   driven with a synthetic `CloudEvent` because `test:emulator` starts only the
   Firestore emulator, so nothing dispatches trigger events; the handler under
   test is the same code the deployed trigger runs, and its writes land in the
   same live Firestore.

   **Self-review found a defect in the fix's own test** — the pattern CLAUDE.md
   §2c predicts. H3 drives the trigger synthetically, so it writes
   `pools/{POOL}/participants/*` under a pool document that does not exist, and
   `collection('pools').get()` never returns a missing parent — so the suite's
   `wipe()` could not reach it. Test 1's write survived into test 2 and inverted
   its verdict (it passed for the wrong reason on the first run, then failed
   once the guard worked). `wipe()` now sweeps that path directly.

## Round 2 — 2026-08-25

VERDICT: **CLEAN.** No findings.

> The removal helper now atomically clears the reciprocal membership indexes,
> and the participant-index trigger guard prevents Squares ownership data from
> recreating those indexes after a removal. Type checking passes; emulator tests
> could not be run locally because Java is unavailable.

The emulator caveat is codex's own sandbox, not this repo: `test:emulator` and
`test:rules` were run here and are green (gate table in the plan doc).

## Own read of the diff — 1 finding, fixed

CLAUDE.md §2c: a clean codex round is not the review. Reading the diff myself
turned up one defect codex did not flag.

1. **An overstated comment in the fix's own documentation.** The header on
   `applyMembershipRemoval` said `users/{uid}/participations/{poolId}` feeds
   "the client's own pool-discovery query" and that a stale one leaves "their
   pool list offering a door that now 403s". My round-1 consumer trace had
   already established that is false — the only client caller is
   `getMyParticipations` (`dbService.ts:668`), used by `PlayerProfile.tsx:130`
   for shared-pool lookup, and it is NOT the "My Pools" list. A comment that
   overstates a consumer is how the next reader chases a navigation bug that
   does not exist, and it contradicted this repo's own review log two files
   away. Corrected in both the code comment and the plan doc, with the negative
   fact ("it is NOT the My Pools list") written down explicitly.

## Round 3 — 2026-08-25, on the REBASED diff

The coordinator rebased this branch onto `origin/main` after #579 (pool
passwords) landed — the two PRs collided in `functions/scripts/run-rules-tests.mjs`,
both having bumped `MIN_FILES`. Resolved to `MIN_FILES = 13` with both
rationales kept; `ls functions/scripts/*.rules.test.mjs | wc -l` = 13, verified
here after pulling. Per CLAUDE.md §2c a rebase is code codex has not seen, so a
round was run on it.

VERDICT: REVISE. 1 finding (P2), **ACCEPTED**.

1. **(P2) Revalidate the live roster before rebuilding indexes.**
   `functions/src/participant.ts:289`.

   > When a square update event generated before a member's removal is delivered
   > after the removal event, this check uses that older event snapshot, where
   > the UID is still listed, and recreates both deleted index documents.
   > Firestore-trigger delivery is asynchronous and does not guarantee ordering,
   > so the removal event's guard writes nothing but the delayed square event
   > still executes its `set`s.

   **Verified against the code, not taken on trust.** The r1 guard read
   `event.data.after.participantIds` — the roster **as of the write that
   produced the event** — and the two `set`s ran outside any transaction with
   nothing re-checking the stored document. Two independent ways to reach it:

   - **Ordering.** Cloud Functions v2 Firestore triggers carry no ordering
     guarantee. A square write W1 (Alice listed) and the removal W2 produce E1
     and E2; E2 can be processed first, write nothing, and E1 then arrives
     carrying a snapshot that still lists Alice.
   - **Retries**, which are the likelier path. Delivery is at-least-once: a
     failed or timed-out invocation is redelivered **with the original
     snapshot**, so a pre-removal event can legitimately execute after the
     removal without any ordering exotica.

   `pools/{poolId}` is written by many paths (settings, squares, scores,
   billing), so a backlog is ordinary rather than contrived. The finding is
   exact and it is the same defect class as r1 reached by a different route:
   **a guard that consults the past cannot enforce a fact about the present.**

   **Fix.** The roster check moved off the snapshot and into a transaction that
   reads the live pool:
   - `tx.get(poolRef)` puts the pool document in the transaction's **read set**,
     so a removal committing between the read and the writes forces a RETRY
     against the new roster. A bare non-transactional re-read would have shrunk
     the window without closing it; this is why it is a transaction and not just
     a fresher `get`.
   - The snapshot-based `isListed` is **deleted**, not kept alongside — one
     authoritative definition rather than two sources that can disagree.
   - Missing pool document → write nothing (deleted between event and delivery).
   - Absent `participantIds` → old behaviour preserved (unknown ≠ not-a-member).
   - `poolName` now also comes from the live document; taking it from the stale
     snapshot stamps a renamed pool's old name onto the index, a smaller
     instance of the same bug.
   - Early return when `stats.size === 0`, **before** the read, so every
     non-SQUARES pool pays nothing — this trigger fires on `pools/{poolId}`,
     which the NFL scorer writes every five minutes.

   **Test that fails without the fix, demonstrated rather than asserted.** H3
   `out-of-order delivery: a PRE-removal event delivered AFTER the removal
   writes nothing` — event snapshot lists Alice, stored document does not. The
   guard was temporarily reverted to its r1 snapshot form and the suite re-run:
   **that one test failed and nothing else did**, so it isolates exactly this
   defect. Fix restored, suite green.

   H3 was rewritten around the live/snapshot distinction (6 cases): normal path,
   the out-of-order case, both-agree, legacy pool with no `participantIds`,
   pool deleted between event and delivery, and live pool name.

## Round 4

VERDICT: **CLEAN.** No findings.

> No actionable correctness issues were found in the diff. The new
> transaction-based cleanup and live-roster guard are consistent with the
> surrounding Firestore code; type checking passes.

## Own read of the rebased diff — 1 finding, NAMED AND NOT FIXED

1. **The index CONTENTS are still snapshot-derived.** `squaresCount`,
   `squareIds` and `paidCount` are computed from the EVENT's `squares[]`, so an
   out-of-order delivery can still write an older count over a newer one **for a
   member who is still listed**. The r3 guard decides WHO gets an index, not
   what it says.

   **Not fixed here, deliberately.** It is a pre-existing lost-update in the
   squares index, orthogonal to member removal, and this PR neither introduces
   nor worsens it — the behaviour is identical before and after. The fix would
   be to rebuild `stats` from `poolSnap.data().squares` inside the transaction,
   which also changes what the `stats.size === 0` early return means; that is a
   squares-subsystem change with its own blast radius and it does not belong in
   a member-removal PR. Written into the code beside the transaction and carried
   as a named open item here and in the PR body, per CLAUDE.md §2c — **this PR
   carries it**, and it is Kevin's call whether it earns its own ticket.

## Stopping

Two conditions, per CLAUDE.md §2c with §2b DORMANT: a codex round came back
clean (round 4) **and** my own read of the diff agrees. **4 rounds, under the
cap of 10** — rounds 3–4 were forced by the coordinator's rebase, which
introduced code no earlier round had seen. One finding is carried open and named
above; it is pre-existing and out of scope, not an unresolved defect in this
change.
