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

## Results — 28 lines total (20 + 8), classified individually

⚠️ **Round 4 rewrote this section.** The previous version reported "20 hits",
collapsed the six helper call sites into a single row, and omitted the two helper
*definitions* — so the table could not be reproduced from the commands above,
which is the one property a sweep must have. Both commands are re-run below and
every line is listed.

### Command 1 — direct collection references (20 lines)

| # | Site | Read/Write | Membership verified? |
|---|---|---|---|
| 1 | `lib/memberRecord.ts:113` `membersCol()` | helper | n/a — returns the collection ref |
| 2 | `lib/memberRecord.ts:134` (inside `ensureMemberRecord`) | **WRITE** | ✅ via its call sites — command 2 |
| 3 | `lib/memberRecord.ts:141` `voidMemberRecord` | **WRITE (delete)** | ✅ removal, not creation |
| 4 | `lib/memberRecord.ts:158` (inside `reconcileMembership`) | **WRITE** | ✅ via its call sites — command 2 |
| 5 | `lib/memberRecord.ts:172` `memberRecordExists` | read | n/a |
| 6 | `lib/rosterSummary.ts:39` | read | n/a |
| 7 | `migrations/backfillMemberRecords.ts:175` | **WRITE** | ✅ SUPER_ADMIN migration, dry-run gated |
| 8 | `migrations/backfillProfileData.ts:77` | read | n/a |
| 9 | `migrations/reconcilePaymentTruth.ts:141` | read | n/a |
| 10 | `migrations/reconcilePaymentTruth.ts:194` | **WRITE** | ✅ SUPER_ADMIN migration |
| 11 | `migrations/reconcilePaymentTruth.ts:257` | **WRITE** | ✅ SUPER_ADMIN migration |
| 12 | `nflPools.ts:232` | read (in tx) | n/a |
| 13 | `nflPools.ts:447` | read (in tx) | n/a |
| 14 | `nflPools.ts:722` rebuy | **WRITE** | ⚠️ **NOT a membership check** — see below |
| 15 | `poolExceptions.ts:306` | read (in tx) | n/a |
| 16 | `poolOps.ts:477` | read | n/a |
| 17 | **`setPaidStatus.ts:25`** (→ the write at `:30`) | **WRITE** | 🔴 **NO — this is the defect** |
| 18 | `statsTrigger.ts:66` | read | n/a |
| 19 | `userProfile.ts:26` | read | n/a |
| 20 | `lib/memberRecord.ts:114` (body of `membersCol`) | helper | n/a |

### Command 2 — helper definitions and call sites (8 lines)

| # | Site | Kind | Membership verified? |
|---|---|---|---|
| 21 | `lib/memberRecord.ts:123` `export function ensureMemberRecord(` | definition | n/a — see call sites |
| 22 | `lib/memberRecord.ts:148` `export function reconcileMembership(` | definition | n/a — see call sites |
| 23 | `lib/poolCreation.ts:166` | call site | ✅ pool creation — seeds the **owner's** record at t=0 |
| 24 | `nflPools.ts:157` | call site | ✅ NFL pool creation — owner seed |
| 25 | `nflPools.ts:239` | call site | ✅ join, after the join's own eligibility checks |
| 26 | `nflPools.ts:272` | call site | ✅ join, participant seed with `feeOwed` stamped |
| 27 | `nflPools.ts:641` | call site | ✅ entry submit — the submitter is playing |
| 28 | `poolExceptions.ts:448` | call site | ✅ guarded `if (existingMember && committedPick)` — cannot create |

The two commands have **no overlapping lines**: call sites mention neither
`membersCol` nor `collection('members')`, which is exactly why command 2 is
required.

## Why the helper call sites are safe "by construction"

Rows 23–28 are each inside the transaction of an operation that *is* the act of
joining or playing, so membership is established by the same code path that
writes the record.

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

## ⚠️ Row 14 correction — the rebuy path verifies an ENTRY, not membership (round 8)

The first version of this table marked `executeSurvivorRebuyInternal` "✅ requires
an existing entry + deadline checks" and counted it as verified. **An entry is not
membership**, and the distinction matters because this path writes a Member Record
with `joinedAt` — the very stamp the plan uses to tell a canonical record from a
forged one.

Verified: `assertNFLPickMembership` is defined at `nflPools.ts:316` and called at
`nflPools.ts:363` — the pick-submission path — and **nowhere else**.
`executeSurvivorRebuyInternal` (`:691`) does not call it. Its gates are: an entry
exists, the pool is Survivor, the rebuy deadline has not passed, and
`maxRebuys` is not exceeded.

**Consequence for the plan:** a canonical stamp is *necessary* but not *sufficient*
proof of current membership. A legacy Survivor entry created before the
pick-submission membership gate existed, whose owner is not in `participantIds`,
could be rebought and thereby acquire a `joinedAt`-stamped Member Record that both
evidence 1 and #338's canonical filter would trust.

**Assessed exploitability: low, and bounded to legacy data.** Reaching this path
requires an entry to already exist in the pool, and entry creation today passes the
membership gate — so only entries predating that gate qualify, which belong to
people who did join at the time. There is no path for a stranger to create the
entry that this exploit needs.

**Not fixed here.** Adding a membership gate to the rebuy path is a change to who
may write a playable entry mutation — an authorization change on a money-adjacent
path, which needs its own plan under Rule 3. Recorded as a ticket in `PLAN` §7
rather than folded into this one. The sweep's job was to find it and classify it
honestly; it is listed here so the next change does not re-derive it.

## Sweep 2 — who writes `participantIds` (added round 3)

This second sweep is what collapsed the plan's membership rule from per-pool-type
entry archaeology to a single cross-type check.

```
grep -rn "participantIds" functions/src --include=*.ts | grep -v __tests__ | grep -i "arrayUnion\|arrayRemove"
```

| Writer | Pool type / path |
|---|---|
| `bracketEntries.ts:107` | Bracket entry create |
| `bracketPools.ts:284` | Bracket join |
| `nflPools.ts:258` | NFL join |
| `playoffPools.ts:219` | Playoff join |
| `squares.ts:115` | Squares reserve — ⚠️ inserts the literal `"guest"` when anonymous |
| `poolOps.ts:661` | commissioner add |
| `lib/memberRecord.ts:140,162` | `voidMemberRecord` / `reconcileMembership` (removal) |
| `lib/memberRecord.ts:166` | `reconcileMembership` (add) |

**Two conclusions the plan depends on:**

1. **Every join path maintains `participantIds`**, so it is the system's own
   cross-type membership set. A membership guard built on it inherits future pool
   types automatically.
2. **`propBets.ts` writes it ZERO times** (`grep -c` = 0) and creates no Member
   Record, so prop-card buyers are on no roster. That is why the plan excludes
   Props explicitly rather than silently missing them.

## What this sweep does NOT cover

- **`participantIds` on the pool doc.** `protectedFieldsUnchanged()` in
  `firestore.rules` protects `participants` but **not** `participantIds`, so a
  pool manager can add arbitrary UIDs to their own pool. Raised on #338, tracked
  as its own ticket, explicitly out of scope here (`PLAN` §7).
- **Entries.** A separate collection with its own rules; not a Member Record
  creation path.
