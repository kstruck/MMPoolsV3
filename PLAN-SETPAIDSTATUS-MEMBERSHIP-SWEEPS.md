# SWEEP — every writer to `pools/{poolId}/members/{uid}`

Companion to `PLAN-SETPAIDSTATUS-MEMBERSHIP.md`. Rule 3 step 3: a deterministic,
COMPLETE instance list, so the fix is not whack-a-mole on the one instance a
reviewer happened to name.

**The question this sweep answers:** is `setPaidStatus` the only path that can
bring a Member Record into existence without verifying membership, or are there
others?

## Method

**TWO commands are required, and the second is what makes the conclusion
reproducible.** Direct references find the collection; they do NOT find code
that writes through the `ensureMemberRecord` / `reconcileMembership` helpers,
because those call sites mention neither `membersCol` nor `collection('members')`.

```
grep -rn "membersCol(\|collection('members')\|collection(\"members\")" functions/src --include=*.ts | grep -v __tests__
grep -rn "ensureMemberRecord(\|reconcileMembership(" functions/src --include=*.ts | grep -v __tests__
```

Run 2026-08-01 against `origin/main` @ `cae9c27`. Every hit is classified below;
read-only hits are listed so the list is provably complete rather than filtered
to the interesting ones.

⚠️ Recorded because round 1 caught it: the first version of this document stated
only the first command, while row 20 and `poolExceptions.ts:448` are outputs of
the second. A sweep whose stated method cannot reproduce its own table is worth
less than no sweep, because it looks like evidence.

## Results — 20 hits, 6 write paths

| # | Site | Read/Write | Membership verified? |
|---|---|---|---|
| 1 | `lib/memberRecord.ts:113` `membersCol()` | helper | n/a — returns the collection ref |
| 2 | `lib/memberRecord.ts:134` `ensureMemberRecord` | **WRITE** | ✅ by construction — see below |
| 3 | `lib/memberRecord.ts:141` `voidMemberRecord` | **WRITE (delete)** | ✅ removal, not creation |
| 4 | `lib/memberRecord.ts:158` `reconcileMembership` | **WRITE** | ✅ by construction — see below |
| 5 | `lib/memberRecord.ts:172` `memberRecordExists` | read | n/a |
| 6 | `lib/rosterSummary.ts:39` | read | n/a |
| 7 | `migrations/backfillMemberRecords.ts:175` | **WRITE** | ✅ SUPER_ADMIN migration, dry-run gated |
| 8 | `migrations/backfillProfileData.ts:77` | read | n/a |
| 9 | `migrations/reconcilePaymentTruth.ts:141` | read | n/a |
| 10 | `migrations/reconcilePaymentTruth.ts:194` | **WRITE** | ✅ SUPER_ADMIN migration |
| 11 | `migrations/reconcilePaymentTruth.ts:257` | **WRITE** | ✅ SUPER_ADMIN migration |
| 12 | `nflPools.ts:232` | read (in tx) | n/a |
| 13 | `nflPools.ts:447` | read (in tx) | n/a |
| 14 | `nflPools.ts:722` rebuy | **WRITE** | ✅ requires an existing entry + deadline checks |
| 15 | `poolExceptions.ts:306` | read (in tx) | n/a |
| 16 | `poolOps.ts:477` | read | n/a |
| 17 | **`setPaidStatus.ts:25` → `:30`** | **WRITE** | 🔴 **NO — this is the defect** |
| 18 | `statsTrigger.ts:66` | read | n/a |
| 19 | `userProfile.ts:26` | read | n/a |
| 20 | `nflPools.ts:157/239/272/641`, `lib/poolCreation.ts:166` | **WRITE** via #2 | ✅ — the join/create/submit paths |

## Why the `ensureMemberRecord` call sites are safe "by construction"

Every one of the five is inside the transaction of an operation that *is* the
act of joining or playing, so membership is established by the same code path
that writes the record:

| Call site | Operation |
|---|---|
| `lib/poolCreation.ts:166` | pool creation — seeds the **owner's** record at t=0 |
| `nflPools.ts:157` | NFL pool creation — same, owner seed |
| `nflPools.ts:239` | join — after the join's own eligibility checks |
| `nflPools.ts:272` | join — participant seed with `feeOwed` stamped |
| `nflPools.ts:641` | entry submit — the submitter is playing |
| `poolExceptions.ts:448` | commissioner exception, and note the guard: `if (existingMember && committedPick)` — it will not create |

## Conclusion

**`setPaidStatus.ts:30` is the ONLY unguarded creation path.** Every other
writer either establishes membership in the same operation, requires
SUPER_ADMIN, or refuses to create.

Two consequences for the plan:

1. **The fix is genuinely one site.** No enumeration gap — this sweep is what
   licenses that claim, rather than the reviewer's finding being assumed
   complete.
2. **The client-side equivalent is already closed.** `firestore.rules:408` is
   `allow create, delete: if false` for this subcollection, and the `allow
   update` clause permits exactly the two claim fields on an existing document.
   The rules already say what the callable should have said; callables bypass
   rules, which is why the gap survived.

## What this sweep does NOT cover

- **`participantIds` on the pool doc.** `protectedFieldsUnchanged()` in
  `firestore.rules` protects `participants` but **not** `participantIds`, so a
  pool manager can add arbitrary UIDs to their own pool. Raised on #338, tracked
  as its own ticket, explicitly out of scope here (`PLAN` §7).
- **Entries.** A separate collection with its own rules; not a Member Record
  creation path.
