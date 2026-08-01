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

Pending.
