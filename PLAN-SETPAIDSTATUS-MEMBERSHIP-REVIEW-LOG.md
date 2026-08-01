# REVIEW LOG — `PLAN-SETPAIDSTATUS-MEMBERSHIP.md`

Rule 3 step 2. Verbatim findings per round, with severity and an accept/reject
response. Reviewer: `codex exec review --base origin/main` (OpenAI), per
CLAUDE.md §2c. Cap is 10 rounds; stop on evidence, not the counter.

---

## Round 1 — codex (plan + sweep, before any implementation)

**VERDICT: REVISE.** 4 findings — 1 P1, 3 P2. **All 4 accepted.**

### 1. (P1) Re-read pool membership inside the transaction

> `setPaidStatus` currently fetches `poolSnap` before claim handling. Treating
> that as the "already loaded" read invites using an out-of-transaction
> `participantIds` value; if `voidMemberRecord` removes the caller after that
> snapshot, the transaction will not observe the pool update and can recreate
> their Member Record. Require `tx.get(poolRef)` and evaluate all membership
> evidence from transaction reads before writing.

**Accepted.** This is the plan's own §4 argument turned against it: I required a
transaction so a concurrent `voidMemberRecord` could not slip in, then in §6
described the pool read as "already loaded", which is precisely the stale read
that defeats it. A pre-transaction `participantIds` snapshot would let a removed
member resurrect their record — the exact bug the transaction exists to stop.

**Plan changed:** §4 now states that **all** membership evidence is read via
`tx.get` inside the transaction, and §6's cost row is corrected to say the pool
is re-read rather than reused.

### 2. (P2) Query entry ownership instead of document ID

> This entry check rejects legitimate legacy Bracket members when their Member
> Record and `participantIds` entry are absent: `createBracketEntry` creates a
> random entry document ID and stores the member in `ownerUid`, not
> `entries/{uid}`. The fallback therefore does not deliver D1's promise for that
> pool type; use an `ownerUid == uid` query or a type-aware membership resolver
> and test that legacy shape.

**Accepted, and verified before accepting.** `functions/src/bracketEntries.ts:86`
is `poolRef.collection("entries").doc()` — an auto-generated id — with
`ownerUid: uid` set at `:92`. An `entries/{uid}` check finds nothing for any
bracket entry, so D1's "heal legacy members" promise would have been empty for
an entire pool type while reading as though it were covered.

**Plan changed:** the entry evidence is now **both** `entries/{uid}` (the NFL
shape, where the doc id is the uid) **and** a `where('ownerUid','==',uid)`
query (the bracket shape). Both, not either: NFL entry docs are keyed by uid and
do not all carry `ownerUid` — `manualReminders.ts` reads
`entry.ownerUid || doc.id` precisely because of that.

### 3. (P2) Include helper call sites in the deterministic sweep

> The stated command cannot establish a complete writer list because callers of
> `ensureMemberRecord` and `reconcileMembership` do not contain `membersCol` or
> `collection('members')`; `poolExceptions.ts:448` is already listed below
> despite not being an output of this command. Add explicit searches for those
> helper call sites so the one-site conclusion remains reproducible.

**Accepted, and it is the most serious of the three P2s** despite the severity,
because it attacks the sweep's *reproducibility* — the one property a sweep
exists to have. I ran a second grep for helper call sites and wrote its results
into the table without writing the command down, so the document claimed a
completeness its stated method could not produce. Row 20 and
`poolExceptions.ts:448` are both outputs of a command that was not there.

**Sweep changed:** both commands are now recorded, with a note that the helper
search is what makes the "only one site" conclusion reproducible.

### 4. (P2) Do not mark the required review log complete before it exists

> No `PLAN-SETPAIDSTATUS-MEMBERSHIP-REVIEW-LOG.md` is added or present in the
> worktree, while the plan itself says review rounds are still pending. Marking
> this required PLAN-GATED artifact complete can falsely satisfy the
> repository's plan→review-log→sweep gate.

**Accepted.** The status table marked the review log ✅ while this file did not
exist. That is a status claim ahead of the artifact, in a table whose entire job
is to say which gate steps are done — and the gate it would have falsely
satisfied is the authorization gate.

**Plan changed:** §9 marks the review log as in-progress and now cites round
numbers, so the row cannot be true before the rounds are real.

---

## Round 2 — codex (plan + sweep, after round 1 fixes)

**VERDICT: REVISE.** 3 findings, all P2. **All 3 accepted.** Round 1's fixes all
held; every finding here is new ground, and two of them are the same shape as
round 1 finding 2 — *the legacy-healing promise not actually reaching a pool
type*.

### 5. (P2) Cover every legacy membership representation

> A record-less legacy Playoff member with a missing `participantIds` entry will
> still be rejected: `submitPlayoffPicks` stores ownership in the embedded
> `pool.entries` map as `userId`, not in `entries/{uid}` or an `ownerUid`
> subcollection query. Since D1 promises to heal legacy members and this callable
> is not restricted to NFL/Bracket pools, make the resolver type-aware.

**Accepted, verified before accepting.** `playoffPools.ts:114` iterates
`Object.entries(pool.entries || {})` and `:182`/`:201` show `userId` carried
inside those values — Playoff pools have no `entries` subcollection at all.

Worth noting how this was missed twice: round 1 corrected the entry check from
one shape to two, and I treated "two shapes" as "all shapes". The real lesson is
that **this callable accepts any pool type**, so any membership resolver has to
enumerate the types or state which it excludes. Guessing the set from the two I
had already looked at is what produced both misses.

**Plan changed:** §4 adds the embedded-map shape as a fourth evidence source,
with the reasoning above.

### 6. (P2) Limit the ownerUid membership query

> For Bracket pools configured with unlimited entries (`maxEntriesPerUser: -1`),
> a bare `where('ownerUid', '==', uid)` query returns every entry the caller owns
> even though the guard only needs existence. This can turn a self-report into an
> unbounded transactional read; add `limit(1)`.

**Accepted.** The guard tests existence, so the query should say so.

**Plan changed:** §4 specifies `.limit(1)` and a non-empty test.

### 7. (P2) Register the new domain error prefix

> The mapping added by #338 contains `MEMBER_NOT_ON_ROSTER`, not
> `NOT_A_POOL_MEMBER`; `getUserMessage` matches domain prefixes by exact key, so
> this new error will fall through to the generic `permission-denied` copy.

**Accepted, and it invalidates D3 as written.** I specified the prefix and
described the UX benefit as though the prefix were the mechanism. It is not:
`errorMessages.ts:56` matches `DOMAIN_PREFIX_MESSAGES` by exact key, so an
unregistered prefix produces the generic copy **plus** a machine token nobody
sees. D3 would have shipped as pure ceremony.

**Plan changed:** D3 now includes the client mapping and a case in
`tests/error-domain-prefix-contract.test.ts` as part of this change.

---

## Round 3 — codex (plan + sweep, after round 2 fixes)

**VERDICT: REVISE.** 3 findings — 1 P1, 2 P2. **All 3 accepted, and together
they caused the design to be rewritten smaller rather than extended.**

### 8. (P1) Do not trust records created by the vulnerable claim path

> For Member Records minted before this fix, this predicate treats the exact
> forged document created by the current `set(..., { merge: true })` claim branch
> as proof of membership. Those users therefore remain on the roster and will
> still be eligible for the reminder targeting that motivated this PR. Require
> independent membership evidence (or a cleanup/canonical-record check).

**Accepted. This is the best finding of the cycle** — the plan would have shipped
a fix that ratified the exploit it exists to close. Every draft treated "a Member
Record exists" as proof of membership while the whole premise of the PR is that
the claim path can create one.

Verified discriminator: `planMembershipWrite` (`lib/memberRecord.ts:55-73`) seeds
a first write with `uid`, `poolId`, `userName`, `paidStatus` and `joinedAt`; the
vulnerable claim writes exactly `memberReportedPaid` and `memberReportedAt`. A
claim-only document is therefore distinguishable and is treated as absent.

**Plan changed:** §4 evidence 1 is now a **canonical** record, not any record,
with the field-level reasoning. §6 gains a risk row. §7 records that cleaning up
already-forged records is a prod-data mutation under Rule 1 and its own change.

### 9. (P2) Recognize claimed Squares ownership as membership

> A user who reserves as a guest and then calls `claimMySquares` is represented
> by `squares[*].reservedByUid`, but that flow neither adds their UID to
> `participantIds` nor creates a Member Record. With no entry document, every
> listed predicate fails and a legitimate Squares member is denied.

**Accepted, verified.** `squares.ts:115` adds the literal `"guest"` sentinel for
an anonymous reserve, and `squarePrivate.ts` (`claimMySquares`) never writes
`participantIds`. Cheap to cover: `pool.squares[*].reservedByUid` is on the pool
document the transaction already reads, so it costs no extra query.

### 10. (P2) Include Prop-card ownership in the membership resolver

> The all-types promise still misses Props: `purchasePropCard` creates auto-ID
> documents in `propCards` with `userId`, without writing `participantIds` or a
> Member Record.

**Accepted as a finding; the resolution is an explicit EXCLUSION, not a fourth
check.** Verified: `propBets.ts` contains zero `participantIds` writes and
creates no Member Record. A prop-card buyer is not on the roster by the system's
own definition.

`setPaidStatus` writes to the roster. Teaching this guard to invent roster
membership for a pool type that deliberately keeps buyers off it would be an
authorization fix quietly making a product decision. The inconsistency is real
and is now an out-of-scope ticket (§7) against `propBets.ts`, where it belongs.

### What rounds 1–3 actually established

Three rounds, four missing pool-type shapes (Bracket, Playoff, Squares, Props).
Adding a fifth check was the obvious move and the wrong one. Sweeping **who
writes `participantIds`** showed the system already has a cross-type membership
set maintained by every join path, so the resolver collapsed from per-type entry
archaeology to **three checks on data already in the transaction, with no extra
query**. A new pool type now inherits the guard instead of silently falling
through it.

The rule got smaller on round 3 than it was on round 1. That is the outcome to
want from a review loop, and it only happened because the reviewer kept finding
the *same shape* of hole — which is the signal to change approach, not to patch
again.

---

## Round 4 — codex (plan + sweep, after round 3 rewrite)

Pending.
