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

## Round 2

VERDICT: (recorded below after the round on the amended diff.)
