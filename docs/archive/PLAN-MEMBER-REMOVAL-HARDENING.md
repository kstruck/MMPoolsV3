# Plan: member-removal hardening — triage of external codex finding 2e

_Written 2026-08-25 (overnight audit-remediation, workstream S19). Verified
claim-by-claim against `origin/main` = `64183316`. Terms per CONTEXT.md._

**Plan-gate classification: PLAN-GATED on AUTHORIZATION.** The finding is about
who may act after being removed from a pool, and the change touches
`functions/src/lib/memberRecord.ts`, the file that defines what a removal
writes. It is **NOT** a production-data change: the helpers it edits have zero
production callers (proved below), so nothing this PR ships executes against
prod Firestore. It is **NOT** a `firestore.rules` change — the rules were
checked and found already correct, and the file is untouched. Money and scoring
are not involved.

## Verdict in one line

**All three claims are REJECTED as stated.** One real, latent gap was found
adjacent to claim (a) — the removal helpers did not clear the two reciprocal
membership indexes — and it is fixed here, together with regression tests that
keep claims (b) and (c) disproved.

---

## 0. The fact that governs the whole triage

**There is no wired member-removal path in this application.**

`voidMemberRecord` (`functions/src/lib/memberRecord.ts:315`) and
`reconcileMembership` (`:323`) are the only code that removes a pool member, and
neither has a single production caller. Grep across `functions/src` and `src`
returns the two definitions, comments referring to them, and
`functions/src/__tests__/emulator/memberRecord.emulator.test.ts:8,810,818,831`.
The file's own header says why — `functions/src/lib/memberRecord.ts:5-8`:

> WIRING IS DEFERRED (PLAN-COMMISSIONER-DASH.md step 7, option B): callers in
> nflPools/bracketPools/playoffPools/squares/participant must call
> reconcileMembership on every join/leave/delete/release/claim.

Only the ADD half, `ensureMemberRecord` (`:238`), is wired (`nflPools.ts:213,
303, 331, 875`; `poolExceptions.ts:509`; `lib/poolCreation.ts:13`).

Every UI control that reads like "remove this person" removes **entries or
squares**, never membership:

| Control | file:line | What it actually calls | Touches membership? |
|---|---|---|---|
| "Delete user and all their entries" | `src/components/BracketPoolDashboard/PaymentLedger.tsx:449` → `:143-158` | `Promise.all(entries.map(deleteBracketEntry))` | **No** |
| per-entry trash | `src/components/BracketPoolDashboard/PaymentLedger.tsx:530` | `deleteBracketEntry` | No |
| "Delete Entry" | `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx:916` | `deleteBracketEntry` | No |
| admin entry delete | `src/components/SuperAdmin.tsx:3647` | `deleteBracketEntry` / `adminDeleteEntry` | No |
| "Remove Player & Release All Squares" | `src/components/AdminPanel.tsx:1201` | `releaseSquares` (`functions/src/squares.ts:298`) | No |
| "Remove Player & Delete All Cards" | `src/components/AdminPanel.tsx:1298` | `deletePropCard` | No |
| "Leave Pool" | `src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:918` | `onClick={onBack}` — **pure navigation, a misnomer** | No |

`deleteBracketEntry` (`functions/src/bracketEntries.ts:350-405`) deletes the
entry, decrements `entryCount`, writes an audit row — and never touches
`pools/{id}/members/{uid}`, `participantIds`, `coManagers`, `rosterSummary` or
`feeOwed`. `releaseSquares` clears the squares and the `squarePrivate` PII docs
and writes no membership field. `deleteUserAccount`
(`functions/src/userManagement.ts:22`) deletes the Auth user and `users/{uid}`
and says in comments at `:41-44` that it deliberately leaves pool references
alone.

So the finding describes a feature this repo has not shipped. That does not make
it worthless — it makes it a specification of what the removal callable must do
when it is wired — but it does change every verdict below from "bug" to either
"false" or "latent".

---

## 1. Claim (a) — "removal is not atomic; membership doc, reciprocal indexes and
delegated roles can end up inconsistent if the operation partially fails"

### Verdict: REJECTED as stated. Real adjacent gap found and fixed.

**Why the atomicity half is false.** Both removal helpers take the caller's
`Transaction` and issue every write on it. Before this change,
`voidMemberRecord` issued one `tx.update` on the pool doc carrying BOTH
`participantIds: arrayRemove(uid)` and `coManagers: arrayRemove(uid)`, plus one
`tx.delete` of the Member Record. Firestore commits a transaction's writes
atomically or not at all, so the specific inconsistency named in the claim — the
membership doc gone while the co-commissioner grant survives — is not reachable
through these helpers. `reconcileMembership`'s remove branch was byte-identical
and had the same property. This is now pinned by an executable test, not an
argument: `memberRemoval.emulator.test.ts` H1 "ATOMIC: a transaction that throws
after the removal leaves ALL SIX facts standing".

**Why the "reciprocal indexes" half held.** There are three denormalized
membership indexes, and no helper cleared any of them:

| Copy | Written by | Read by | Cleared on removal (before)? |
|---|---|---|---|
| `pools/{id}.participantIds` | every join path | `firestore.rules` (live `get()`), `getPoolPicks` | ✅ yes |
| `pools/{id}.coManagers` | `setPoolCoCommissioner` (`coCommissioners.ts:39`) | `isNFLCoManagerOf` in rules + payout callables | ✅ yes |
| `pools/{id}/members/{uid}` | `ensureMemberRecord` | roster, dues, `assertPickReader` | ✅ yes |
| `pools/{id}/participants/{uid}` | `syncParticipantIndices` trigger (`participant.ts:280-289`) | `migrations/backfillMemberRecords.ts:75` | ❌ **NO** |
| `users/{uid}/participations/{poolId}` | `nflPools.ts:352`, `lib/poolCreation.ts:203` (NFL season types only — `bracketPools.ts:158` records that bracket deliberately writes none) | `userProfile.ts:62` (`recomputeUserProfile`), `src/services/dbService.ts:669` | ❌ **NO** |
| `users/{uid}/joinedPools/{poolId}` | `bracketPools.ts:313` (bracket password-join) | **nothing** — write-only today (`lib/roles.ts:11` is the only other mention) | ❌ **NO** |

The only deleter of either was `simHarness.ts:406` (`cleanupPoolTree`, sim pools
only). `fixParticipantIds` (`poolOps.ts:818`) is add-only — `toAdd` with
`arrayUnion` at `:864-873`, no prune arm — so nothing repairs the drift either.

**Why that matters concretely, not theoretically.** `backfillMemberRecords`
reads `pools/{id}/participants` as a name source, so a surviving index doc lets
the next backfill run rebuild a removed member's record. And
`recomputeUserProfile` and `getMyParticipations` (the player profile's
shared-pool lookup) both read `users/{uid}/participations`, so a removed
member's public profile keeps counting the pool. It is **not** the "My Pools"
list — checked, and recorded so the next reader does not chase a navigation bug
that does not exist.

### The fix

`functions/src/lib/memberRecord.ts` — one private
`applyMembershipRemoval(tx, db, poolId, uid)` that both public helpers now
delegate to. It issues five writes on the caller's transaction: the pool update
(`participantIds` + `coManagers` arrayRemove), the Member Record delete, and the
three index deletes. `tx.delete` on a missing document is a no-op, so a pool type
that carries none of the three indexes pays three cheap no-op deletes.

`joinedPools` has no reader today and is cleared anyway. Stated plainly so it is
a decision and not an oversight: a write-only membership index is exactly what
acquires a reader later, and the cost of including it is one no-op delete.

**And a roster guard in `syncParticipantIndices`** (`functions/src/participant.ts`),
without which the cleanup above is undone. That trigger fires on EVERY
`pools/{poolId}` write — including the one the removal makes — and rebuilt both
index docs from `squares[]` with no membership check.

The guard took two rounds to get right, and the second one is the interesting
half. Codex round 1 caught the trigger firing on the removal's own write; the
fix read `event.data.after.participantIds`. Codex round 3, on the rebased diff,
caught that this is still the wrong source: trigger delivery is **unordered and
at-least-once**, so a square write made before the removal can be delivered — or
retried — after it, carrying a snapshot that still lists the departed uid. A
guard that consults the past cannot enforce a fact about the present.

The check now reads the LIVE pool inside a transaction. `tx.get(poolRef)` puts
the pool in the transaction's read set, so a removal committing mid-flight forces
a retry against the new roster — which a bare fresher `get` would not. Missing
pool writes nothing; absent `participantIds` keeps the old behaviour; `poolName`
comes from the live document too; and the handler returns before the read when
there is nothing to index, so non-SQUARES pools pay nothing. Full verification,
the consumer trace for both documents, and the demonstration that the new test
fails against the round-1 guard are in the review log.

Collapsing the two byte-identical copies into one definition is part of the fix,
not tidying: the duplication is how both copies came to miss the same two
deletes, and a future fix applied to one would not have reached the other.

### Blast radius

**`lib/memberRecord.ts`: zero in production.** No production caller exists (§0),
so this code cannot execute against prod Firestore until the removal callable is
wired — which is exactly when it needs to be right. Within tests,
`memberRecord.emulator.test.ts` already wipes `participants` and
`participations` between cases, so no existing suite depends on those docs
surviving a removal.

**`participant.ts` (the trigger guard): live, and narrow.** This one DOES run in
production, on every pool write. It changes behaviour in exactly one case — a
uid that owns a square via `reservedByUid`/`paidByUid` but is NOT in
`participantIds` stops getting an index doc. `reserveSquare` never writes
`reservedByUid` (it stores a display name), so the only uids in that case are
`claimMySquares`/`claimByCode` claimants, whose signal three other surfaces
already refuse as membership. Both affected documents were traced to their last
reader and neither has a reachable consumer for a non-participant — see the
review log. A pool with no `participantIds` keeps the old behaviour.

### Rollback

Revert the PR and redeploy functions. The helpers return to the three-write
shape (no prod effect either way — nothing calls them) and the trigger returns
to writing an index for every square owner. No data migration is involved in
either direction: the guard only stops FUTURE writes, and no existing document
is deleted by it.

---

## 2. Claim (b) — "a removed member's NEXT request still succeeds, because
removal relies on refresh-token revocation, which does not take effect until the
client's ID token expires"

### Verdict: REJECTED. The premise is factually false.

**Removal does not use token revocation, and could not.**
`admin.auth().revokeRefreshTokens` appears exactly twice in the repo, both in
`functions/src/adminClaims.ts:58` (`setUserRole`, on demotion/ban) and `:94`
(the deprecated `setSuperAdminClaim` passthrough). Both are about the **platform
role claim**, not pool membership. **Pool membership has never been carried in a
token claim at all**, so there is no stale-claim window to close.

**`firestore.rules` is the authority for direct client reads, and it already
denies immediately.** Every member-gated surface resolves membership with a LIVE
`get()` of the pool document, which the rules engine evaluates against the
current document on every request:

- `pools/{id}/members/{uid}` — `firestore.rules:663-676` (`allow create,
  delete: if false` at `:675`; read gate at `:666`)
- `pools/{id}/entries/{eid}` — `:633`
- `pools/{id}/standings/{doc}` — `:683`
- `pools/{id}/payoutRecords/{id}` — `:696`
- `pools/{id}/rosterSummary/{doc}` — `:723`
- `pools/{id}/consensus/{gid}` — `:735`

`participantIds` is itself server-owned (`firestore.rules:173`, the K9 lock), so
a removed member cannot write herself back in.

**The callables also re-read live.** `getPoolPicks`' `assertPickReader`
(`functions/src/nflPickReveal.ts:154-193`) reads
`pools/{id}/members/{uid}` from Firestore on **every** call and requires a
canonical Member Record (`:189-192`). Removal deletes that document, so the next
call throws `permission-denied` with no window. The same file already carries
the repo's rule about stale tokens for the one claim that IS token-carried —
`:161-170`, "THE CLAIM ALONE IS NOT PROOF" for `SUPER_ADMIN`, closed by
`assertCallerRole` claim+doc agreement.

**Where the gap actually is, stated plainly:** neither layer. The rules cover
direct client reads and the callables re-read membership per call. Saying which
half was weak was part of the brief; the honest answer is that both were already
correct and the claim mis-describes the mechanism.

### What was added anyway

A rejected claim with no test is a claim that returns. Two regression guards,
one per layer:

1. `functions/scripts/memberRemoval.rules.test.mjs` (new) — mints Alice's auth
   context BEFORE the removal, removes her server-side, and re-uses the SAME
   context: five member-gated surfaces flip from succeed to fail with no delay
   and no re-mint. Controls: Bob (equally old context, still listed) keeps every
   read; the pool document itself stays readable **by design**; the removed
   member cannot re-add herself or recreate her record.
2. `functions/src/__tests__/emulator/memberRemoval.emulator.test.ts` H2 — the
   callable half, against the real `getPoolPicks` handler, holding the decoded
   `auth` object literally constant across the removal.

`functions/scripts/run-rules-tests.mjs` `MIN_FILES` 10 → 11 so a broken glob
cannot silently drop the new file.

---

## 3. Claim (c) — "client listeners are not cleared on removal, so a removed
member keeps receiving live Firestore updates"

### Verdict: REJECTED. Already handled, deliberately, with a documented history.

1. **The listener does not survive.** Every member-gated subscription is a
   `onSnapshot` on a path the rules now deny (§2). The Firestore Web SDK fires
   the error callback and **terminates** the listener on `permission-denied`; it
   does not keep streaming. `subscribeToPoolMembers`
   (`src/services/dbService.ts:575-580`) routes that error to `callback([])`.
2. **The cache is explicitly revoked.** `NFLPoolDashboard.tsx:395-422` carries a
   `viewerStillMember` guard keyed on `pool.participantIds` that bumps
   `authGen` and clears the reveal cache the moment the viewer leaves the
   roster. Its own comment (`:396-413`) records that an earlier revision derived
   this from the `members` snapshot and was holed in review precisely because
   the `[]`-on-error behaviour above made it go quiet in the one case it existed
   for.
3. **The subscriptions unsubscribe.** `NFLPoolDashboard.tsx:526-531` and
   `:533-538` both return their `unsub` from `useEffect`; the pool-doc listeners
   in `PoolRoute.tsx:75-79`, `AdminRoute.tsx:58` and `JoinPool.tsx:44` do the
   same.
4. **The one surface that legitimately keeps arriving is the pool document
   itself** (`firestore.rules` `allow get: if true`). That is load-bearing, not
   leaked: it is the signal (2) reads to notice the removal. The new rules test
   asserts it stays readable so a future tightening cannot blind the revocation
   without going red.

**No change made.** `src/services/dbService.ts` is owned by another live
workstream tonight and needs no edit for this finding.

---

## 4. Complete list of denormalized member copies (the brief's deliverable)

Six places a membership fact is stored, all now cleared by
`applyMembershipRemoval`:

1. `pools/{poolId}.participantIds` — the authorization array.
2. `pools/{poolId}.coManagers` — the delegated co-commissioner grant.
3. `pools/{poolId}/members/{uid}` — the Member Record (ADR 0003).
4. `pools/{poolId}/participants/{uid}` — squares-derived index, trigger-written.
5. `users/{uid}/participations/{poolId}` — the user's own NFL pool index.
6. `users/{uid}/joinedPools/{poolId}` — the bracket password-join index (no
   reader today).

Two more copies exist that a removal **deliberately does not** touch, recorded
so a future removal callable does not "fix" them by accident:

- `pools/{poolId}/entries/{entryId}` — a departed member's entry survives. This
  is intentional and load-bearing: `getPoolPicks` filters departed entries out
  of the PARTICIPANT view only (`nflPickReveal.ts:218-245`), because a
  commissioner still needs to see them. Deleting entries on removal would
  destroy pool history and change scoring.
- `pools/{poolId}.entryCount` and the member's `feeOwed` — money. Whatever the
  removal callable decides here is a **money** trigger and takes its own plan
  gate; it is out of scope for this one and is listed in §5.

---

## 5. Explicitly out of scope (for whoever wires the removal callable)

Not built here, and each is named so it is not mistaken for covered:

1. **The removal callable itself** — authorization gate, audit event, kill
   switch. Plan-gated on authorization AND production data.
2. **Money on removal** — `entryCount`, `feeOwed`, refunds, `rosterSummary`
   recompute. Plan-gated on money.
3. **Entry disposition** — see §4. A product decision, not a defect.
4. **`deleteBracketEntry` voiding membership when it deletes a member's last
   entry** — the gap the ledger's "Delete user and all their entries" button
   leaves today. It is also the only genuinely non-atomic thing in this area:
   `PaymentLedger.tsx:147` fires N independent callables in a `Promise.all`, so
   a partial failure leaves some entries deleted. That is entry-level, not
   membership-level, and `src/components/BracketPoolDashboard/**` is owned by
   another workstream tonight.
5. **`fixParticipantIds` pruning** — the repair callable adds only. Adding a
   prune arm is a production-data change and needs its own dry-run gate.
6. **Stale COUNTS in the squares index** (open finding, carried by this PR).
   `syncParticipantIndices` computes `squaresCount` / `squareIds` / `paidCount`
   from the EVENT's `squares[]`, so an out-of-order delivery can write an older
   count over a newer one for a member who IS still listed. The r3 guard decides
   who gets an index, not what it says. Pre-existing, orthogonal to member
   removal, and identical before and after this PR. The fix — rebuild the stats
   from the live `squares` inside the same transaction — also changes what the
   `stats.size === 0` early return means, so it is a squares-subsystem change
   with its own blast radius. Named in the code, the review log and the PR body
   rather than smuggled in.

---

## 6. Gate evidence

| Gate | Result |
|---|---|
| `npm --prefix functions run typecheck` | clean |
| `npm --prefix functions test` | 130 files, 2066 passed |
| `npm --prefix functions run test:emulator` | 35 files passed, 1 skipped; **516 passed**, 2 expected-fail, 10 skipped — includes the 12 new cases in `memberRemoval.emulator.test.ts` |
| `npm --prefix functions run test:rules` | **12/12 files passed**, all 22 assertions in the new `memberRemoval.rules.test.mjs` green |
| `npx tsc -b` | clean |
| `npm test` (root) | **2357/2357 passed, 0 failures.** The 3 `tests/addon-purchase.test.ts` CRLF failures are gone: #576 landed a `.gitattributes` LF normalisation, and since `.gitattributes` does not rewrite files already in the working tree, a `git rm --cached -r . && git reset --hard` from a clean tree in this worktree renormalised them. No repository content changed — `git status` clean before and after. |
| `npm run build:static` | **not run** — no frontend file was touched |

`test:rules` was run even though `firestore.rules` is unchanged, because a rules
test file was ADDED and `run-rules-tests.mjs` `MIN_FILES` moved 10 → 11.

Codex rounds and per-finding verdicts: `PLAN-MEMBER-REMOVAL-HARDENING-REVIEW-LOG.md`.
