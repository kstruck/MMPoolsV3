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
| An entry owned by the caller exists | Entries are created only through join/submit callables, which enforce their own join rules |

⚠️ **The entry check must be BOTH `entries/{uid}` AND a `where('ownerUid','==',uid)`
query, not either alone** (codex round 1, verified). NFL entry docs are keyed by
the uid; `createBracketEntry` (`functions/src/bracketEntries.ts:86`) uses an
auto-generated id and records the member in `ownerUid` instead. A doc-id-only
check finds nothing for any bracket entry, so D1's "heal legacy members" promise
would have been empty for a whole pool type while reading as if it were covered.
A query-only check is also insufficient: NFL entries do not all carry `ownerUid`,
which is why `manualReminders.ts` reads `entry.ownerUid || doc.id`.

The `ownerUid` query takes **`.limit(1)`** (codex round 2). The guard needs
existence, not the set; Bracket pools may be configured `maxEntriesPerUser: -1`,
where a bare query pulls every entry the caller owns into a transactional read
for no benefit.

⚠️ **A FOURTH shape exists: Playoff pools have no `entries` subcollection at
all** (codex round 2, verified). `playoffPools.ts:114` iterates an **embedded
`pool.entries` map** whose values carry `userId` (`:182`, `:201`). A legacy
Playoff member with no Member Record and no `participantIds` entry is invisible
to every check above, so the embedded map is checked too. This callable is not
restricted by pool type, so "heal legacy members" has to mean every type or say
which ones it excludes.

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

The membership read and the claim write go in **one transaction**, and **every
piece of evidence is read with `tx.get` inside it** — including the pool document,
which the callable already loaded earlier for the owner check.

Reusing that earlier `poolSnap` would defeat the transaction entirely (codex
round 1, P1): a `voidMemberRecord` landing after the snapshot would not be
observed, and the caller's record would be resurrected from a stale
`participantIds`. That is the same class of bug this PR exists to close, so the
guard must not be built on a read taken before the guard begins.

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

**D3 — A domain-prefixed error, AND the client mapping to go with it.**
`NOT_A_POOL_MEMBER:`, alongside the `MEMBER_NOT_ON_ROSTER:` prefix added in #338.

⚠️ **The prefix alone does nothing** (codex round 2). `getUserMessage` matches
`DOMAIN_PREFIX_MESSAGES` by **exact key**, so an unregistered prefix falls
through to the generic `permission-denied` copy and D3 delivers no UX benefit at
all — it just puts a machine token in front of a message nobody sees. The client
mapping and a contract test in `tests/error-domain-prefix-contract.test.ts` are
part of this change, not a follow-up.

**D4 — The authoritative (commissioner) branch is NOT changed.**
It already requires owner/manager/SUPER_ADMIN and, in both transactions, throws
`MEMBER_NOT_ON_ROSTER` when the record is absent. It never creates. Out of
scope, deliberately: this PR should be reviewable as one rule.

---

## 6. Risks and open questions

| Risk | Assessment |
|---|---|
| A legitimate member is refused | Mitigated by D1's three-way evidence. The residual case is a member with **no record, not in `participantIds`, and no entry** — which is indistinguishable from a non-member using every signal the system has. |
| Extra reads on a hot path | A transactional pool **re-read** (it is NOT reused from the earlier fetch — see §4), the member doc, and the entry evidence. The claim path is a manual member action, not a scoring path. |
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
| Plan | ✅ this document (revised after review rounds 1–2) |
| Sweep | ✅ `PLAN-SETPAIDSTATUS-MEMBERSHIP-SWEEPS.md` (revised after review round 1) |
| Review log | 🔄 IN PROGRESS — rounds 1–2 recorded, 7 findings, all accepted |
| Implementation | not started — gated on a clean review round |

⚠️ This table is a status claim about a PLAN-GATED authorization change. Do not
mark a row ✅ before the artifact exists: round 1 caught this row asserting a
completed review log while the file was absent, which would have falsely
satisfied the very gate it records.
