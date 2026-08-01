# PLAN — `setPaidStatus` must verify membership before the self-report write

**Classification: PLAN-GATED — authorization** (CLAUDE.md §4 / `mmp-change-control`
§1). It changes who may write to `pools/{poolId}/members/{uid}`.

**Status:** awaiting review rounds, then Kevin's sign-off.
**Trigger:** codex round 10 on [#338](https://github.com/kstruck/MMPoolsV3/pull/338).
**Kevin's decision, 2026-08-01:** *"Fix `setPaidStatus` first in its own
plan-gated PR (verify membership before the claim write), then merge this."*

---

## 1. Goal

Make the `setPaidStatus` self-report ("claim") branch refuse to write a Member
Record for a caller who is not a member of the pool.

**Non-goal:** changing what a legitimate member can claim, or how commissioners
set authoritative `paidStatus`. Both stay exactly as they are.

---

## 2. The defect

`functions/src/setPaidStatus.ts:27-32`:

```ts
if (claim !== undefined) {
    if (memberUid !== uid) throw new HttpsError("permission-denied", "Members can only report their own payment.");
    await mRef.set({ memberReportedPaid: !!claim, memberReportedAt: Date.now() }, { merge: true });
    return { success: true, mode: 'claim' as const };
}
```

The only check is **"are you claiming for yourself?"** There is no check that
you are *in this pool*. `.set(..., { merge: true })` **creates** the document
when it is absent.

So any authenticated user can call `setPaidStatus({ poolId: <any pool>, memberUid: <their own uid>, claim: true })`
and mint `pools/{poolId}/members/{their-uid}`.

### Why it matters beyond the stray document

A Member Record is the roster truth (ADR 0003). Surfaces that read the roster
therefore treat a self-minted record as a real member:

- **#338** makes it a reminder target — a self-added non-member would receive
  that pool's commissioner-triggered pick and payment emails. **This is what
  blocked #338 and why this PR exists.**
- `recomputeRosterSummary` folds it into `memberCount` and the dues figures.
- The commissioner's roster lists a person who never joined.

The write itself is small; the reach of what reads it is not.

---

## 3. The finding that decides the design

**`firestore.rules` already encodes the correct policy, and the callable
contradicts it.** `firestore.rules:396-409`:

```
match /members/{memberUid} {
  allow read: if ... ;
  allow update: if request.auth != null
    && request.auth.uid == memberUid
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['memberReportedPaid', 'memberReportedAt']);
  allow create, delete: if false;
}
```

Three things follow, and they are the whole basis of the design:

1. **`allow create: if false`.** The intended policy is already *"no client may
   ever bring a Member Record into existence"* — records are created only by
   server join/create paths.
2. **`allow update`** — the same self-report, restricted to the same two fields
   — is permitted *only on an existing document*, because Firestore `update`
   requires one.
3. **A callable runs with admin credentials and bypasses rules entirely.** So
   `setPaidStatus` is not defeating a check; it is the one path that never had
   one.

**This is therefore not a new policy decision.** It aligns the callable with the
rule written beside it. That materially lowers the risk of this change: there is
no judgement call about what membership should mean, only about how to detect it
for records that predate the roster model.

---

## 4. Approach

### The rule

In the claim branch, before writing, the caller must be a **provable member**:

| Evidence | Why it is trustworthy |
|---|---|
| A Member Record already exists | Only server join/create paths create them (`allow create: if false`) |
| `uid ∈ pool.participantIds` | The pool doc's `allow update` requires `isPoolManager()`, so an arbitrary user cannot add themselves |
| An entry exists at `entries/{uid}` | Entries are created only through join/submit callables, which enforce their own join rules |

Any one suffices. None → `permission-denied`.

### On using `participantIds` here, given #338 removed it

#338 removed `participantIds` as a *reminder target* source because it is
**manager-writable**, which made a manager able to direct platform email at any
UID they knew. That reasoning does not transfer, and the difference is worth
stating precisely:

- In #338 the **manager** was the actor, and `participantIds` let them act on a
  **third party** (send them mail).
- Here the **member themselves** is the actor, claiming only for their own uid,
  and `participantIds` is evidence that *the pool's manager put them on the
  roster*. A manager listing someone as a participant **is** membership.

An arbitrary user still cannot self-add: writing `participantIds` requires
`isPoolManager()`. The threat this PR closes — a stranger minting their own
record — stays closed.

### Ordering

The membership read and the claim write go in **one transaction**. Read-then-write
outside a transaction would let a `voidMemberRecord` land in between, resurrecting
a removed member's record — the precise class of bug this PR is about.

---

## 5. Key decisions and tradeoffs

**D1 — Heal legacy members rather than hard-requiring an existing record.**
The strictest fix is "the record must already exist". It is one line and closes
the hole completely. Rejected because a legacy member of a pre-backfill pool
whose record was never created would be told they are not a member, which is
false and unactionable for them. The `participantIds`/entry evidence keeps them
working. Accepted cost: slightly more code and one more read.

**D2 — `permission-denied`, not silent success.**
Returning `{ success: true }` without writing would hide a real
misconfiguration. It also repeats the `sent: 0, skipped: 0` mistake #338 exists
to fix — an operation reporting success while doing nothing.

**D3 — A domain-prefixed error.**
`NOT_A_POOL_MEMBER:`, matching the `MEMBER_NOT_ON_ROSTER:` prefix added in #338
and resolved by `getUserMessage`. Without it the client renders the generic
"insufficient permissions" copy, which points a confused user at the wrong
problem.

**D4 — The authoritative (commissioner) branch is NOT changed.**
It already requires owner/manager/SUPER_ADMIN and, in both transactions, throws
`MEMBER_NOT_ON_ROSTER` when the record is absent. It never creates. Out of
scope, deliberately: this PR should be reviewable as one rule.

---

## 6. Risks and open questions

| Risk | Assessment |
|---|---|
| A legitimate member is refused | Mitigated by D1's three-way evidence. The residual case is a member with **no record, not in `participantIds`, and no entry** — which is indistinguishable from a non-member using every signal the system has. |
| Extra reads on a hot path | One pool read (already loaded) plus at most one entry read. The claim path is a manual member action, not a scoring path. |
| The transaction changes write semantics | The write is the same `set(..., {merge: true})` on the same ref; only the guard is added. |
| **Rules gap this does NOT close** | `participantIds` is missing from `protectedFieldsUnchanged()` in `firestore.rules`, so a manager can add arbitrary UIDs to their own pool. That is a separate ticket (raised on #338) and is **not** fixed here — it would be a second authorization change in one PR. |

**Open question for Kevin:** none blocking. The `participantIds` rules gap above
is worth its own ticket but does not gate this.

---

## 7. Out of scope

- The `protectedFieldsUnchanged()` / `participantIds` rules gap — own ticket.
- The commissioner branch (D4).
- Rebuy settlement, projections refresh, and the payment ledger — untouched.
- #338 itself, which merges after this.

---

## 8. Verification

1. Unit tests for the membership predicate: each of the three evidence paths
   admits; the no-evidence case is refused; a stranger cannot mint a record.
2. **Mutation-test every guard** — deleting the check, and each evidence branch
   individually, must fail the suite.
3. Full gate set: functions build + test, `tsc -b`, root test, lint, emulator.
4. `codex exec review --base origin/main` to a clean round, plus qodo on the PR.

---

## 9. Implementation status

| Item | Status |
|---|---|
| Plan | ✅ this document |
| Sweep | ✅ `PLAN-SETPAIDSTATUS-MEMBERSHIP-SWEEPS.md` |
| Review log | ✅ `PLAN-SETPAIDSTATUS-MEMBERSHIP-REVIEW-LOG.md` |
| Implementation | pending sign-off |
