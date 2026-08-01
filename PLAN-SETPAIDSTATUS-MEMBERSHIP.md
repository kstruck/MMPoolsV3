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

In the claim branch, before writing, the caller must be a **provable member**.

**Rounds 1–3 rewrote this section three times, and the third rewrite made it
smaller.** Each round found another pool type whose ownership the resolver did
not understand — Bracket (auto-id + `ownerUid`), Playoff (embedded `pool.entries`
map with `userId`), Squares, Props. The reflex was to add a check per shape. That
reflex was wrong: it produced a resolver that had to enumerate every pool type's
ownership representation and be re-audited whenever a type is added.

**A sweep of who writes `participantIds` collapsed it.** Every join path already
maintains it:

| Writer | Path |
|---|---|
| `bracketEntries.ts:107`, `bracketPools.ts:284` | Bracket |
| `nflPools.ts:258` | NFL |
| `playoffPools.ts:219` | Playoff |
| `squares.ts:115` | Squares reserve |
| `poolOps.ts:661` | commissioner add |
| `lib/memberRecord.ts:166` | `reconcileMembership` |

So `participantIds` is the system's own cross-type membership representation,
and the per-shape entry archaeology was re-deriving it badly. The resolver is
now **two checks on data already read inside the transaction, with no extra
query at all**:

| # | Evidence | Why it is trustworthy |
|---|---|---|
| 1 | A **canonical** Member Record exists | See below — mere existence is NOT enough |
| 2 | `uid ∈ pool.participantIds`, **excluding the `"guest"` sentinel** | Requires `isPoolManager()` to write, so no self-add |

### 1 is "canonical", not "exists" — this is the round 3 P1

A Member Record's mere existence cannot prove membership, because **the
vulnerable claim path is itself a way to create one**. Anyone who already
exploited the bug would have their forged record accepted as proof, stay on the
roster, and keep receiving #338's reminders — the fix would ratify the exploit.

The discriminator is what the record carries. `planMembershipWrite`
(`lib/memberRecord.ts:55-73`) seeds a first write with `uid`, `poolId`,
`userName`, `paidStatus` and **`joinedAt`**. The vulnerable claim writes exactly
two fields: `memberReportedPaid` and `memberReportedAt`. So a record counts as
evidence only when it carries the server-seeded stamp; a claim-only document
does not, and is treated as absent.

### Why evidence 2 must exclude `"guest"`

`squares.ts:115` inserts the **literal string `"guest"`** into `participantIds`
for an anonymous reservation — it is a sentinel, not a person. A membership test
that accepts any array element would therefore admit an authenticated account
whose Firebase UID is the string `guest` into **every pool containing a single
anonymous square reservation** (codex round 4).

`src/utils/poolRoster.ts` already excludes the same sentinel when building the
roster, so this is consistency with an existing rule rather than a new one — and
`resolveReminderTargets` in #338 excludes it too. Three places now agree that
`guest` is never a person; the guard must not be the one that disagrees.

### Squares claimed-ownership was evidence 3 and was REMOVED in round 5

`claimMySquares` does not write `participantIds`, so a user who claims a
guest-reserved square is not listed. Draft 4 therefore accepted
`pool.squares[*].reservedByUid === uid` as evidence, since it is on the pool
document the transaction already reads.

**That signal is attacker-settable, and the plan verified it rather than
assuming.** `firestore.rules:63` is `allow get: if true` — the pool document,
including every `squares[*].guestDeviceKey`, is readable by **anyone with the
pool id**. `claimMySquares` (`functions/src/participant.ts:113-125`) matches on
that key and stamps `reservedByUid: uid` for the caller whenever the square is
not already owned. So a stranger can read a key off a public document, claim an
unclaimed guest square, and thereby manufacture the exact evidence this guard
would have trusted.

**Removed.** A membership guard must not rest on a value the caller can cause to
be written. The residual cost is that a guest-claim Squares user with no Member
Record and no `participantIds` entry cannot self-report — the same shape of
exclusion as Props, and the same answer: fix it where membership is recorded
(`claimMySquares` should write `participantIds`), not by widening an
authorization predicate.

### Props are EXCLUDED, deliberately and on the record

`propBets.ts` writes `participantIds` **zero** times and creates no Member
Record; a prop-card buyer is represented only by `propCards/{autoId}.userId`.
They are therefore not on the roster by the system's own definition, and this
guard will refuse their self-report.

That is the correct outcome here rather than a gap to paper over: `setPaidStatus`
writes to the **roster**, and inventing roster membership for a pool type that
deliberately keeps buyers off it would be this authorization fix quietly making
a product decision. **It is a real inconsistency in `propBets.ts` and deserves
its own ticket** — but the fix belongs there, not in a membership guard.

Either of 1–2 suffices. None → `permission-denied`.

⚠️ **There is no third check.** Draft 4 had one (claimed-square ownership) and
round 5 removed it as attacker-settable. Any reader — or implementer — who
reintroduces a squares-ownership branch is restoring the exact authorization
route this plan rejected.

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

**The transactional pool read must also confirm the pool still EXISTS** (codex
round 4). Deleting a Firestore document does **not** delete its subcollections,
so `pools/{id}/members/*` survives its pool. If the pool is deleted between the
callable's opening `poolSnap` check and this transaction, a surviving canonical
member record would satisfy evidence 1 and the claim write would recreate an
orphaned member document under a pool that no longer exists. The transaction
therefore re-checks existence before evaluating any evidence.

---

## 5. Key decisions and tradeoffs

**D1 — Heal legacy members, but via `participantIds`, not per-type archaeology.**
The strictest fix is "the record must already exist". Rejected: a legacy member
of a pre-backfill pool would be told they are not a member, which is false and
unactionable for them.

The first three drafts healed them by learning each pool type's entry shape.
Rounds 1–3 found a missing shape every single time, which is the signal that the
approach was wrong rather than incomplete. `participantIds` is the system's own
cross-type membership set and is written by every join path, so it does the same
job in one check — and a **new pool type inherits the guard for free**, instead
of silently falling through it until someone notices.

Accepted cost: the one `participantIds` gap (guest-claimed squares) needs its own
check, and Props are excluded on the record. Both are named in §4 rather than
discovered later.

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
| A legitimate member is refused | Mitigated by D1's two evidence sources. The residual case is a member with **no canonical record and no `participantIds` entry** — which, for every pool type whose join path writes `participantIds` (all of them: sweep 2), is indistinguishable from a non-member using every trustworthy signal the system has. The two known exceptions, Props and guest-claim Squares, are named in §4 and §7. |
| Extra reads on a hot path | Two transactional reads — the pool doc and the member doc. **No entry query at all** after the round-3 collapse. The claim path is a manual member action, not a scoring path. |
| Records forged before this fix | Handled: evidence 1 requires the server-seeded stamp, so a claim-only document is treated as absent (§4). Without that, the fix would ratify existing exploits. |
| Props buyers refused | Accepted and documented (§4). `propBets.ts` puts them on no roster; the inconsistency is real but belongs in its own ticket. |
| Guest-claim Squares users refused | Accepted (§4, round 5). Their ownership signal is attacker-settable, so it cannot be membership evidence. `claimMySquares` should write `participantIds` — own ticket. |
| The transaction changes write semantics | The write is the same `set(..., {merge: true})` on the same ref; only the guard is added. |
| **Rules gap this does NOT close** | `participantIds` is missing from `protectedFieldsUnchanged()` in `firestore.rules`, so a manager can add arbitrary UIDs to their own pool. That is a separate ticket (raised on #338) and is **not** fixed here — it would be a second authorization change in one PR. |

**Open question for Kevin:** none blocking. The `participantIds` rules gap above
is worth its own ticket but does not gate this.

---

## 7. Out of scope

- The `protectedFieldsUnchanged()` / `participantIds` rules gap — own ticket.
- **`propBets.ts` not writing `participantIds` or a Member Record** — a real
  inconsistency found by review round 3, own ticket (§4).
- **Cleaning up any records already forged via this bug** — the guard stops new
  ones and refuses to treat old ones as evidence, but does not delete them. A
  sweep would be a prod-data mutation and takes Rule 1's kill-switch/dry-run
  gate, so it is its own change.
- **`claimMySquares` guest-key ownership** — see below. Found by review round 5,
  NOT fixed here.

### 🔴 A pre-existing vulnerability found while reviewing this plan

Independent of this change, and worth Kevin's attention on its own:

`firestore.rules:63` makes every pool document world-readable (`allow get: if
true`) — deliberately, for guest access by link. That document carries
`squares[*].guestDeviceKey`. `claimMySquares` (`functions/src/participant.ts`)
authenticates a claim **solely** by matching that key, and assigns
`reservedByUid` to the caller for any square not already owned.

So anyone who can open a Squares pool link can read the guest keys on it and
claim the unclaimed guest squares as their own. A guest who reserved and paid
out of band, and has not yet claimed, can have their squares taken.

Not fixed here: it is a separate authorization change on a money-adjacent path
and takes its own plan gate. Flagged rather than folded in.
- The commissioner branch (D4).
- Rebuy settlement, projections refresh, and the payment ledger — untouched.
- #338 itself, which merges after this.

---

## 8. Verification

1. Unit tests for the membership predicate:
   - a canonical Member Record admits;
   - a **claim-only** record (the forged shape: only `memberReportedPaid` /
     `memberReportedAt`) is REFUSED — this is the round-3 P1 and the test that
     proves the fix does not ratify the exploit;
   - `participantIds` membership admits;
   - the literal `"guest"` sentinel is REFUSED;
   - no evidence at all is refused;
   - a deleted pool is refused even when a canonical record survives it.
2. **Mutation-test every guard** — deleting the check, and each evidence branch
   individually, must fail the suite.
3. Full gate set: functions build + test, `tsc -b`, root test, lint, emulator.
4. `codex exec review --base origin/main` to a clean round, plus qodo on the PR.

---

## 9. Implementation status

| Item | Status |
|---|---|
| Plan | ✅ this document — the rule SHRANK twice under review (4 evidence sources → 3 → 2) |
| Sweep | ✅ `PLAN-SETPAIDSTATUS-MEMBERSHIP-SWEEPS.md` (rewritten after round 4 to match its own commands) |
| Review log | 🔄 IN PROGRESS — rounds 1–5 recorded, 14 findings, all accepted |
| Implementation | not started — gated on a clean review round |

⚠️ This table is a status claim about a PLAN-GATED authorization change. Do not
mark a row ✅ before the artifact exists: round 1 caught this row asserting a
completed review log while the file was absent, which would have falsely
satisfied the very gate it records.
