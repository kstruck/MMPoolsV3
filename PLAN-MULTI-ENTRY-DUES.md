# PLAN — per-entry dues and entry deletion (NFL multi-entry, Phase 2)

> **STATUS: §6 FULLY SIGNED. D1–D4 answered by Kevin 2026-08-25 (all "A");
> N1, N2 and the two §6a exclusions ratified 2026-08-26. NO CODE YET — this doc
> is the gate, and Kevin's ruling is to HOLD Phase 2 code until PR #597 (Phase 1,
> `renameNFLEntry`) merges, per CLAUDE.md §2d's one-PR-at-a-time cadence.**
>
> `mmp-change-control` §1: plan → adversarial review log
> (`PLAN-MULTI-ENTRY-DUES-REVIEW-LOG.md`) → sweeps
> (`PLAN-MULTI-ENTRY-DUES-SWEEPS.md`) → code, in small PRs.
>
> 🛑 **THIS IS A MONEY CHANGE AND IT SUPERSEDES TWO SIGNED DECISIONS.** See §0c.
> It is also the first change in this repo that makes a **one-way counter
> reversible**. Both of those are the reason for the gate, not paperwork.
>
> **Provenance — Kevin, 2026-08-25, verbatim:**
> *"On the Payment Ledger, it shows my two entries, but only one has the payment
> checkbox. Figure out a way to group the entries together for multiple entries,
> but have each row responsible for the entry fee. It is possible someone enters
> multiple entries but only pays for a portion of them. If they do not pay for
> one, the commissioner should be able to delete the non-paid entry and that
> should reflect on the payment ledger."*
>
> **Phase 1 (`renameNFLEntry`) is a SEPARATE, non-plan-gated PR** and is not
> covered here beyond one interaction noted in §3 D5.

---

## 0. What Kevin asked for, and what that means precisely

Two things, and they are one feature because the second only makes sense given
the first:

1. **Dues are per ENTRY, not per member.** A member with three entries can have
   paid for two of them. The ledger must be able to say so, and the commissioner
   must be able to tick each row.
2. **A commissioner can delete an entry that was not paid for**, and the pot,
   the dues and the ledger must all follow it down.

### 0a. 🛑 The single most important line in this document

**Today `paidStatus` is ONE BOOLEAN PER MEMBER, and roughly two dozen surfaces
read it as such.** After this change the truth is a MAP — which of my entries
are paid — and `paidStatus` becomes a *derived summary* of that map.

The change that will break things is not the map. It is the temptation to
remove `paidStatus` once it is derived. **`paidStatus` MUST REMAIN A STORED
FIELD, recomputed on every write.** Roster chips, `memberDues`, `setPaidStatus`,
exports, `PaymentsPanel`, `poolRoster`, `reminderTargets`, the commissioner
aggregate and `statsTrigger` all read it, several of them from a client that
cannot run our derivation. §8 sweeps every one.

### 0b. 🛑 The second most important line

**`pool.entryCount` is the POT DENOMINATOR and it has only ever gone up.**
`shared/weeklyPrizes.ts:94` and `shared/seasonPrizes.ts:67` price every weekly
and season prize off it; `PayoutsPanel.tsx:350` renders the member-facing pot
from it; `functions/src/billing.ts:386` and `BillingGate.tsx:273` count against
plan limits with it. D4 makes it go DOWN.

A decrement is not the hard part. **The hard part is a decrement landing after
a prize has been published at the old denominator** — see R1 in §4, and D3,
which is the mitigation Kevin already chose.

### 0c. 🛑 What this SUPERSEDES — stated plainly, not buried

This plan **overrides two decisions that were signed and shipped** in
`PLAN-MULTI-ENTRY.md`. Neither was wrong when written; both were scoped
deliberately, and Kevin has now changed the scope.

| Superseded | It said | It now says | Where |
|---|---|---|---|
| **D2 (money)** | *"`paidStatus` remains one flag per member (paid in full or not) — partial payment is the payment-ledger plan's problem, not this one's; until then a member with 3 entries is UNPAID until all 3 are paid."* | Per-entry payment on the Member Record; `paidStatus` DERIVED from it. | §3 D1 |
| **D2 / K11** | Adding an entry to a PAID member flips them UNPAID and appends a `MARKED_UNPAID` ledger line, because payment was all-or-nothing. | **K11 IS RETIRED.** The paid entries stay paid; the new one is simply unpaid. | §3 D6 |
| **K7 (deletion)** | *"deleting an entry is out of scope"*; `playableEntryCount` is a one-way counter, and so is `pool.entryCount`. | Both become reversible, under the D2/D3 refusals. | §3 D7, D8 |

`PLAN-MULTI-ENTRY.md` is **not** edited to pretend it always said this. The
ticket that ships D1 adds a one-line pointer in its D2 and K7 saying they were
superseded here and on what date — the same convention the repo uses elsewhere,
because a doc that quietly rewrites its own history is worse than a stale one.

---

## 1. What is true today — measured, not remembered

Every line here was read at origin/main, commit 6d9faa9f (2026-08-26).
(Deliberately not written as a backticked SHA claim — `tests/docs-state-invariants.test.ts`
scans for that construction and this doc is not an operator deploy-state carrier.)

### 1a. The money model

| Fact | Where |
|---|---|
| `feeOwed` = `entryFee × memberLiableEntries(m)`, ONE number per member | `functions/src/lib/memberRecord.ts:115` |
| `memberLiableEntries` = `max(joinLiability, playableEntryCount)`; joinLiability is 1 for a participant, 0 for a seeded MANAGER | `shared/memberRecord.ts:117` |
| `playableEntryCount` is a **one-way counter** — `Math.max(storedCount, reportedCount ?? 0)` | `functions/src/lib/memberRecord.ts:111` |
| `paidStatus` is ONE flag on the Member Record, commissioner-owned | `shared/memberRecord.ts:20` |
| `setPaidStatus` writes that flag and **mirrors it onto EVERY entry the member owns** | `functions/src/setPaidStatus.ts:227` (the ref list), `:260` (the mirror loop) |
| the `MARKED_PAID` ledger amount is the member's `feeOwed` (the multiplied figure), read at `:234` | `functions/src/setPaidStatus.ts:312` |
| an `entryFee` edit cascades `newFee × memberLiableEntries(rec)` onto every fee-liable record | `functions/src/poolOps.ts:674-688` |
| `pool.entryCount` counts LIABLE entries, is server-maintained, and moves by `stamp.liabilityDelta` — **two call sites**: the submit path and the JOIN path | `functions/src/nflPools.ts:899` (submit) and `:309` (join), via `lib/multiEntry.ts` `entryCountWrite` |
| K11: a member whose `feeOwed` RISES while PAID is reset to UNPAID + a `MARKED_UNPAID` line | `functions/src/lib/memberRecord.ts:172-190` (the plan) → `nflPools.ts:907` (the apply) → `lib/multiEntry.ts` `applyPaidReset` |

### 1b. The ledger UI, which is what Kevin was looking at

`PaymentLedgerNFL.tsx` already renders **one row per entry** — `ledgerRows`
(`:213-274`) builds `ids.forEach(...)` with `first: i === 0`. What it does NOT
do is make each row responsible for a fee:

| Line | Today |
|---|---|
| `:248` | `feeOwed` is the MEMBER's total (`fee × entries`), attached to every row of that member |
| `:421` | the **Entry fee** cell renders `r.first ? money(r.feeOwed) : ''` |
| `:423` | the **Fee paid** checkbox renders only `r.first &&` |
| `:430` | `onTogglePaid?.(r.uid, …)` — the toggle's subject is a **uid**, not an entry |
| `:281` | `owedIn` / `paidIn` sum `if (r.first && …)` — i.e. once per member |

So a member with two entries sees two rows, one $50 figure on the first, and
one checkbox that is all-or-nothing. That is exactly what Kevin described.

### 1c. What is NOT true today, and needs saying

- **There is no delete-entry path of any kind.** No callable, no admin button,
  no script. `firestore.rules` has entries at `allow write: if false`.
- **`playableEntryCount` has never been decremented by anything.**
- **`pool.entryCount` has never been decremented by anything.** `entryCountWrite`
  accepts a negative delta arithmetically (`FieldValue.increment(delta)`) but no
  caller has ever passed one.
- **A member's `paidStatus` has never been derived** — every write states it.

---

## 2. Goal

1. A commissioner can mark **each entry** paid or unpaid independently, from the
   Payment Ledger, with the entries grouped under their member and the member
   subtotal preserved.
2. `paidStatus` continues to mean "this member is square with the pool", and is
   now TRUE iff every entry they are liable for is paid.
3. A commissioner can **delete an unpaid, unscored entry**, and the entry's fee
   leaves `feeOwed`, `playableEntryCount` and `pool.entryCount` in the same
   transaction, with an `admin_audit` row and a ledger line.
4. Nothing changes on a single-entry pool. **Every assertion in this plan must
   hold byte-for-byte on a pool where `maxEntriesPerUser` is absent** — that is
   every pool in production except the ones Kevin has opted in.

---

## 3. Key decisions

### D1 — Per-entry paid status lives on the MEMBER RECORD *(Kevin: A)*

The Member Record gains:

```ts
/**
 * PLAN-MULTI-ENTRY-DUES D1. Which of this member's entries have been paid for,
 * keyed by entry id. ABSENT on every record written before this ticket:
 * readers treat `undefined` as "no per-entry detail recorded" and fall back to
 * `paidStatus`, which is still the summary flag and is still stored.
 */
paidEntries?: Record<string, { paidAt?: number; method?: string; note?: string }>;
```

and `paidStatus` becomes **derived and still stored**:

```
paidStatus = liableEntryIds.length > 0 && liableEntryIds.every(id => id in paidEntries)
           ? 'PAID' : 'UNPAID'
```

recomputed **in the same transaction as every write that can change either
side** — a per-entry mark, an entry delete, an entry add, a fee cascade.

**Why the Member Record and not the entry doc.** Money truth in one document
means one transaction and no two-phase state. The entry doc's `paidStatus`
mirror stays (`setPaidStatus.ts:265`) because exports and other surfaces read
it, but it is a MIRROR — the Member Record is the source, as it is today.

⚠️ **`paidStatus` MUST REMAIN STORED.** See §0a. A derived-only field would have
to be recomputed by every client that reads a Member Record, including ones that
do not have the entry roster to hand.

🛑 **THE EMPTY-MAP TRAP, WRITTEN DOWN BEFORE IT IS BUILT.** `[].every(...)` is
`true`. A member with **zero** liable entries — a seeded commissioner who has
never played — would derive as **PAID** under a naive `every`. Today they are
`UNPAID` with `feeOwed: 0`, and roster chips render that. The `length > 0` guard
above is not decoration; the ticket's first test is a seeded manager staying
`UNPAID`.

🛑 **"LIABLE", NOT "EXISTS".** The derivation must iterate the entries the
member is LIABLE for, which is not the same as the ids in their `entries` map: a
member's `joinLiability` of 1 exists from the moment they join, before any entry
document does. Definition, and the ticket implements exactly this:

> `liableEntryIds` = the ids in `entries` whose entry has committed a pick,
> and — when that set is empty and `memberLiableEntries(m) > 0` — the synthetic
> id `uid` (entry #1's id, D1 of the parent plan), so a joined-and-never-picked
> participant has exactly one payable row.

### D1a — WHO owns the derivation, named exhaustively *(codex r1 A2)*

The plan said "recomputed in the same transaction as every write that can change
either side" and left the writers to the implementer. Naming them is the whole
job, because a writer that forgets makes the stored summary disagree with the map
and nothing detects it.

**TWO canonical helpers, in `shared/memberRecord.ts`, pure and unit-tested:**

```ts
/**
 * The entry ids this member is LIABLE for (D1's definition).
 *
 * `pickedEntryIds` is supplied BY THE CALLER from its transactional read of the
 * owner's entry documents. It cannot come off the Member Record — see the box
 * below. Pass the ids that have committed a pick; the synthetic-`uid` fallback
 * for a joined-and-never-picked participant is applied here, not by the caller.
 */
export function liableEntryIds(
  m: Pick<MemberRecord, 'role' | 'feeOwed' | 'hasPlayableEntry' | 'playableEntryCount' | 'entries'>,
  uid: string,
  pickedEntryIds: readonly string[],
): string[]

export function derivePaidStatus(
  m: Pick<MemberRecord, 'paidEntries'>,
  liable: readonly string[],
): 'PAID' | 'UNPAID'
```

🛑 **WHY THE LIABLE IDS ARE AN ARGUMENT AND NOT DERIVED INSIDE *(codex r4 #1 —
this is the finding that would have sunk P2-T1 as originally written)*.**

The first draft gave `derivePaidStatus` the whole Member Record and no id list,
which cannot work. D1 defines liability as *"the ids in `entries` whose entry has
committed a pick"*, and **the Member Record does not carry pick state per
entry — deliberately, as an AUTHORIZATION constraint, not an oversight:**

> `entries?: Record<string, { entryIndex: number; name?: string }>` —
> *"the authorization-safe roster of this member's entries: existence + index +
> display name, NEVER picks and never per-entry weeks (a participant-readable
> record must not say which entry has a pick for an unrevealed week — that
> completeness is the commissioner's, via `getPoolPicks.counts`)"*
> — `shared/memberRecord.ts`

`playableEntryCount` gives a COUNT, not a set. So with entries 1 and 2 present
and one pick between them, a record-only helper cannot tell which id is liable —
and a member who paid for the picked entry would read as unpaid, or the reverse.
That is a money error, silently, in the direction of both signs.

⛔ **THE ALTERNATIVE IS REJECTED, AND IT IS REJECTED ON AUTHORIZATION, NOT
TASTE.** "Store a per-entry `liable` flag on the record" is exactly the forbidden
bit: liability *is* "this entry has committed a pick", so at the start of a
season — when only week 1 exists and is unrevealed — `entries[id].liable` and
"entry `id` picked week 1" are the same statement. It would put the
commissioner-blind-picks contract's payload onto a participant-readable document.
**If a ticket concludes it needs this, STOP and ask Kevin** — same posture as D11.

✅ **AND THE ARGUMENT IS FREE TO SUPPLY — no new read, in any writer.**
`ownerStateAfter` ALREADY computes it and throws it away: it tests
`entryHasPick(e.data)` per owned entry (`lib/multiEntry.ts:172`) and returns only
the count plus a pick-free `entries` map. The ticket has it return the picked ids
as a THIRD, transaction-local field — computed inside the transaction, passed to
`liableEntryIds`, and **never written to the Member Record**, which is what keeps
the authorization contract intact. Every writer below is already inside a
transaction that reads the owner's entry docs, so none of them gains a read.

**Every writer of `paidStatus`, today — the complete list, measured:**

| # | Writer | After this plan |
|---|---|---|
| 1 | `functions/src/lib/memberRecord.ts:123` — `planMembershipWrite` CREATE, literal `'UNPAID'` | unchanged: a brand-new record has an empty `paidEntries`, and `derivePaidStatus` of that is `'UNPAID'`. Keep the literal, and assert the two agree. |
| 2 | `functions/src/lib/memberRecord.ts:192` — the K11 reset | **REPLACED, NOT DELETED.** See the box below — this is the only writer of `paidStatus` on the existing-member ADD path, and deleting it without a replacement leaves a paid member reading PAID after adding an unpaid entry. |
| 3 | `functions/src/setPaidStatus.ts:241` / `:253` — the authoritative PAID / UNPAID mark | **rewritten**: mutate `paidEntries`, then write `paidStatus: derivePaidStatus(next)`. |
| 4 | `functions/src/setPaidStatus.ts:100` — the self-report seed, `paidStatus: 'UNPAID'` on create only | unchanged, and deliberately: this is a MEMBER-triggered path and must never write money. Same reasoning already in that file. |
| 5 | `functions/src/migrations/reconcilePaymentTruth.ts` | **sweep target** — it promotes a claim-only record to PAID from a paid entry. Under per-entry payment it must write the `paidEntries` key too, or the next derivation un-pays what it just paid. |
| 6 | the new `deleteNFLEntry` callable (P2-T4) | writes `paidStatus: derivePaidStatus(next)` after removing the entry's keys. |

⚠️ **#5 IS THE ONE THAT WILL BE MISSED.** It is a migration, it runs from the
Operations panel (`admin/OperationsPanel.tsx:346` — *"Writes members.paidStatus +
payments ledger rows…"*), and it is not in any hot path, so nothing exercises it
in normal testing. The sweep ticket owns it explicitly.

🛑 **ROW 2 IS A REPLACEMENT, AND READING IT AS A DELETION SHIPS A MONEY BUG
*(codex r4 #2)*.** This table said `DELETED` and D6 said the derived status
"becomes UNPAID *by itself*". Both are wrong in the same way, and the second
sentence is what makes the first look safe.

**Measured.** `data.paidStatus = 'UNPAID'` at `lib/memberRecord.ts:192` sits
inside the K11 `paidReset` branch, and it is **the only assignment to
`paidStatus` on `planMembershipWrite`'s UPDATE path** — the update branch's own
comment says it "merge[s] identity/units only; preserve[s] paidStatus". So the
existing-member add path has exactly one writer of the summary, and D6 removes
it.

**Nothing derives on read.** §0a fixes `paidStatus` as a STORED field precisely
because readers cannot recompute it. So "the derived `paidStatus` becomes UNPAID
by itself" is only true of a value somebody WRITES. Delete row 2 with no
replacement and a fully-paid member who adds an unpaid liable entry keeps a
stored `PAID` — reporting money as collected that was never collected, which is
the exact failure K11 existed to prevent. Retiring K11 must not resurrect it.

**So P2-T3 replaces the branch rather than removing it**: on every
`planMembershipWrite` UPDATE that changes the entry set, write
`paidStatus: derivePaidStatus(next, liableEntryIds(next, uid, pickedIds))`
unconditionally, in the same transaction — the atomicity §8 already requires.
`pickedIds` is the new transaction-local field from `ownerStateAfter` (D1a), so
this costs no extra read. What D6 correctly removes is the **ledger line, the
per-entry UNPAID mirror and the `MARKED_UNPAID` event** (`applyPaidReset`) — the
noisy half. The summary recomputation is the half that must survive, and the
distinction is the whole content of that ticket.

### D1b — Presence IS the paid signal; un-marking DELETES the key *(codex r1 E1)*

`paidEntries` carries **no `paid: boolean`**. An entry id present in the map is
paid; absent is not paid. Therefore:

- marking paid writes `paidEntries.<entryId> = { paidAt, method?, note? }`;
- **un-marking DELETES the key** — `FieldValue.delete()` on the nested path, not
  `{ paid: false }` and not `{}`;
- an entry deleted by P2-T4 has its key removed by the same rule.

**Why no boolean:** with one, `{paid: false}` and an absent key would be two ways
to say the same thing, and every reader would have to handle both — which is
exactly how `hasPlayableEntry`'s "absent ≠ false" trap works, except here there
is no third state to preserve. An `{}` value with no boolean would read as PAID,
which is the failure mode a boolean is supposed to prevent and does not.

⚠️ **A nested `FieldValue.delete()` needs `update()` or `set(..., {merge:true})`
with a dotted path**, and the entry id contains a `:` (`e2:uid`). Dotted-string
paths are ambiguous around unusual characters; the ticket uses
`new FieldPath('paidEntries', entryId)` and its test covers an `e2:` id
specifically.

### D2 — A PAID entry may NOT be deleted *(Kevin: A)*

Refuse with `ENTRY_IS_PAID`. The commissioner un-marks payment first, which is
one click and leaves a `MARKED_UNPAID` ledger line — so the money coming off the
books is a visible event rather than a side effect of a delete.

**Why refusing is right and "delete and refund" is not:** a delete that silently
destroys a record of collected money has no undo, and the ledger is the only
place that money was ever written down.

### D3 — An entry may NOT be deleted once ANY week is scored *(Kevin: A)*

Refuse with `ENTRY_IS_SCORED`. The test is on the POOL, not the entry:
`pool.scoredWeeks` non-empty (or `scoredThroughWeek > 0`) — because a published
`standings/current`, a `weekly_recap`, a `WeeklyWinner` row and a
`seasonHistory` doc can all reference an entry that never itself scored a point.

**Why the pool and not the entry:** an entry with `totalScore: 0` in a pool
that has scored week 1 is still ON the published board. Deleting it removes a
row members have already seen, and — worse — the row may be *named* in a recap.

This refusal is also what makes D4 safe: see R1.

### D4 — Deletion DOES reduce the pot *(Kevin: A)*

`pool.entryCount` decrements, `feeOwed` drops by one fee, `playableEntryCount`
drops by one, and every payout figure recomputes off the new denominator.

Reachable only pre-scoring, which follows from D3 — so no published prize can
have been priced at the old denominator. **That is the whole safety argument for
D4, and it rests entirely on D3.** If D3 is ever relaxed, D4 must be re-decided
in the same breath.

### D5 — Interaction with `renameNFLEntry` (Phase 1)

Deletion removes the entry's key from `entries` AND from `paidEntries`. Phase 1's
rename **rebuilds the whole `entries` map** from the entry docs in its
transaction (deliberately — see that PR). The two are therefore compatible by
construction: a rename after a delete rebuilds a map that no longer contains the
deleted entry, because its document is gone.

⚠️ **But `paidEntries` is NOT rebuilt by the rename**, and must not be: a rename
has no business touching money. The delete callable is the only writer that
removes a `paidEntries` key. The ticket asserts a rename after a delete leaves
`paidEntries` alone.

### D6 — K11 is RETIRED, not preserved

Today, adding an entry to a PAID member flips them UNPAID and appends a
`MARKED_UNPAID` line, because `feeOwed` rose and payment was all-or-nothing.

Under per-entry payment that behaviour is **wrong, not merely redundant**: the
member paid for entries 1 and 2, and adding entry 3 does not unpay entries 1
and 2. The summary `paidStatus` still becomes UNPAID — entry 3 is not in
`paidEntries` — but with no reset, no ledger line, and no loss of the per-entry
marks.

⚠️ **"BY ITSELF" WAS WRONG, AND THE ORIGINAL WORDING HERE SAID IT *(codex r4
#2)*.** Nothing derives `paidStatus` on read: §0a fixes it as a STORED field
because readers cannot recompute it. It becomes UNPAID only because a writer
writes it. **`lib/memberRecord.ts:192` is that writer, and it is the ONLY one on
the existing-member add path** — so removing it wholesale would leave a fully-paid
member reading `PAID` after adding an unpaid entry, which is the money lie K11
existed to prevent. D1a row 2 carries the measurement and the replacement.

**So: remove `applyPaidReset` and the `paidReset` limb of `planMembershipWrite`
rather than leaving them dormant** — a dormant money path is a path somebody
re-enables — **but REPLACE the summary write, do not drop it.** What goes is the
ledger line, the per-entry UNPAID mirror and the `MARKED_UNPAID` event. What
stays, unconditionally on any UPDATE that changes the entry set, is
`paidStatus: derivePaidStatus(next, liableEntryIds(next, uid, pickedIds))` in the
same transaction.

Its emulator test (case 3 in `multiEntry.emulator.test.ts`) is rewritten to
assert the OPPOSITE of today on the per-entry marks **and both halves of the new
behaviour**: adding an entry to a fully-paid member leaves the existing entries'
`paidEntries` keys intact, writes no `MARKED_UNPAID` ledger line, **and moves the
member's stored `paidStatus` to `UNPAID`**. Asserting only the first two is what
would let the bug through.

⚠️ **The `MARKED_UNPAID` lines K11 already wrote to production ledgers stay.**
They were true when written. Nothing back-fills or deletes ledger history.

### D7 — `playableEntryCount` becomes reversible

`planMembershipWrite`'s `Math.max(storedCount, reportedCount ?? 0)` is the
one-way latch. It stays exactly as it is for every EXISTING caller — the
`undefined` = "not reporting" contract is what stops a join or a payment edit
from zeroing a counter it knows nothing about.

The delete callable does **not** go through that path. It computes the owner's
post-delete state from the surviving entry documents inside its own transaction
— the same way `ownerStateAfter` already does for the submit path — and writes
the count explicitly. One new writer, not a loosened latch.

🛑 **WHAT STOPS A DELETE/RE-ADD CYCLE FROM MIS-CHARGING.** This is the question
K7 was avoiding, and it has to be answered before code:

- **Liability is derived from entry EXISTENCE + a committed pick, never from an
  accumulated counter.** Delete entry 3 → the doc is gone → the recount is 2 →
  `feeOwed = fee × 2`. Re-add entry 3 and submit a pick → the recount is 3 →
  `feeOwed = fee × 3`. There is no path that double-charges, because nothing is
  added to; everything is recounted.
- **`pool.entryCount` is the one accumulator, and it is moved by a DELTA.** The
  delete writes `increment(-1)` only when the entry it removed was liable. Two
  concurrent deletes of the same entry cannot both decrement: the entry document
  is in both transactions' read sets, so the loser retries and finds it gone.
- **Payment does not survive a delete.** The `paidEntries` key is removed with
  the entry, so a re-added entry at the same index and id starts unpaid. This is
  deliberate and is the conservative direction: the alternative (a re-created
  entry inheriting a paid mark from a deleted one) would let a commissioner
  manufacture a paid entry by deleting and re-adding.
- **A deleted entry's fee, if it was somehow paid, cannot be lost silently**
  because D2 refuses to delete a paid entry at all.

### D7a — Concurrency and legacy records in the delete transaction *(codex r1 C1, C2)*

**Against `setPaidStatus`.**

⚠️ **REWRITTEN AFTER CODEX r2 (finding 3), WHICH WAS RIGHT.** The first version
argued that `setPaidStatus`'s `ownedEntriesQuery` read (`setPaidStatus.ts:224`)
puts the entry documents in its read set, so deleting one conflicts. That may
well be true, but it rests on Firestore's QUERY read-set semantics, which are
subtler than a document read and which this plan should not be betting money on.

**The guarantee this plan actually relies on is a shared DOCUMENT, not a query.**
Both transactions read *and* write `pools/{poolId}/members/{uid}`:

- `setPaidStatus` reads it (`setPaidStatus.ts:217`) and writes it (`:240` PAID /
  `:252` UNPAID);
- the delete reads it (to recompute `feeOwed`, the roster map and `paidEntries`)
  and writes it.

One document in both read sets ⇒ the loser aborts and retries, and on retry it
sees the winner's committed state. **That is the whole mechanism, it needs no
query semantics, and no additional lock is to be added.**

🛑 **AND THE ARGUMENT RESTS ON THE *READ*, NOT THE WRITE.** `tx.get(mRef)` at
`:217` is unconditional; the writes at `:240`/`:252` are the two arms of one
`if (isPaid) … else …`, so one of them always runs — but the ticket must not
depend on that, because a future branch that skips the write would silently
weaken a concurrency guarantee nobody would think to re-check. The shared READ
is sufficient on its own. (codex r3 finding 4 read those two `tx.set` calls as
independent conditionals rather than as an if/else; the premise is wrong, the
instinct to not depend on a conditional write is right.)

Two consequences to build:

- **A paid mark naming an entry that no longer exists must REFUSE**, with
  `ENTRY_NOT_FOUND`, not silently create a `paidEntries` key for a ghost. The
  key set is validated against the entry documents read in the same transaction.
- **The delete reads the Member Record**, so a paid mark that commits first is
  observed and the recomputed `paidStatus` is right either way.

**Against a scoring pass.** The delete reads the pool doc and asserts
`standings/current` does not exist — which D3 guarantees, so it is an assertion
rather than a merge. If it DOES exist, the delete refuses with `ENTRY_IS_SCORED`
rather than trying to patch a published projection.

**Legacy records with absent fields.** D7's recount handles an absent
`playableEntryCount` (it counts documents, it does not decrement a stored
number). It does NOT license stamping a `feeOwed` that was never there:

> 🛑 **If `feeOwed` is ABSENT on the record, the delete leaves it absent.** A
> record that predates the ADR-0005 stamp means "unknown", and `memberDues`
> falls back to the pool fee for exactly that case (`shared/memberRecord.ts:292`).
> Writing a computed number there would convert an unknown into a claim, on the
> one path in this plan that reduces money owed. Only a record that already
> carries `feeOwed` has it lowered.

### D7b — What a delete does NOT touch *(codex r1 C3, C4)*

**Survivor rebuys are member-level and are NOT reduced.** `rebuyOwed` /
`rebuyPaid` are the sum across the member's entries (parent plan D3), and
`setPaidStatus` settles them independently of base dues
(`functions/src/setPaidStatus.ts:124-200`) precisely because a member can be
square on one and not the other. A delete changes neither field.

This is stated rather than built for, and the unreachability is **enforced by a
line of code, not by an argument** (codex r2 finding 4 doubted it; the code
settles it):

> `functions/src/nflPools.ts:1006` — `executeSurvivorRebuyInternal` throws
> `NOT_ELIMINATED: Player is still alive.` unless `entry.status === 'ELIMINATED'`,
> and `status` only becomes `ELIMINATED` inside a scoring pass
> (`nflScoringEngine`). **A rebuy therefore requires a scored week, and D3
> forbids deleting once any week is scored.** A deletable entry has
> `rebuysUsed: 0`.

The ticket nonetheless asserts `rebuyOwed` and `rebuyPaid` are byte-identical
across a delete. An unreachable case that is cheap to pin is worth pinning,
because a single line in `nflPools.ts` and D3 are the only two things making it
unreachable, and neither is obvious from the delete callable's own code.

**The `entryFee` cascade is NOT invoked.** `poolOps.ts:674-688` exists for a FEE
CHANGE and restamps every fee-liable record in the pool; calling it from a delete
would rewrite the whole roster over one entry. The delete restamps ONE record,
its own.

⚠️ **But there is a real interaction with the cascade, and it is benign.** The
cascade skips `rec.role === 'MANAGER' && (rec.feeOwed ?? 0) === 0`
(`poolOps.ts:680`) — the seeded-owner-never-played carve-out. After a delete
takes a manager's last liable entry away, their `feeOwed` returns to 0 and a
LATER fee edit will skip them again. **That is correct** — they are back to
hosting-not-playing — but it must be asserted, because it is the one place a
delete changes how a *different* feature behaves.

### D8 — `pool.entryCount` becomes reversible

`entryCountWrite` already takes a signed delta and already handles the
absent-field case by deriving from the Member Records. It needs **no change** to
accept a negative delta; the ticket adds the caller and a unit test proving a
negative delta on a pool with NO `entryCount` derives-then-subtracts rather than
writing a negative number.

🛑 **THE DELTA IS THE MEMBER'S LIABILITY CHANGE — NOT A FLAT `-1` *(codex r4
#3)*.** D7 said the delete decrements *"only when the entry it removed was
liable"*; this section said `Math.max(0, current - 1)` with no such condition,
and §9's gate asserted all three counters "DROP" unconditionally. Three
statements, two of them wrong, and the gate would have **encoded** the wrong one.

**A non-liable entry document is reachable, measured.** `picks: {}` is
schema-legal on a pick'em pool and persists an entry doc (`nflPools.ts:681`),
while `committedPickForWeek` is false for it (`:883-895`) — this is
PLAN-EMPTY-SUBMISSION-FEE's whole subject, and the comment there records that
passing `true` unconditionally once charged a seeded MANAGER for a pick nobody
made. Deleting such an entry must move **nothing**: it was never in
`playableEntryCount`, never in `feeOwed`, never in `pool.entryCount`.

**ONE delta, computed once, applied to all three.** The delete transaction
computes the member's liability before and after from the surviving entry
documents — `liabilityDelta = memberLiableEntries(after) - memberLiableEntries(before)`,
the same quantity `planMembershipWrite` already returns on the submit path — and
that single signed number drives `feeOwed`, `playableEntryCount` and the
`entryCountWrite` call. **Deleting a non-liable entry yields `0` and writes no
counter at all**, which is also why `entryCountWrite`'s existing `delta === 0 ⇒
{}` short-circuit is the right shape and needs no change. Three counters derived
from one delta cannot disagree; three independent decrements can.

🛑 **A FLOOR AT ZERO IS STILL REQUIRED AND IS STILL NOT FREE.** `entryCountWrite`
emits `FieldValue.increment(delta)` when the field is present
(`lib/multiEntry.ts:192`) and **applies no clamp** — so on a pool whose
`entryCount` has drifted (a legacy pool where the derived value was stamped once)
it can go negative, and `potBreakdown` on a negative denominator produces a
negative pot. When the delta is negative the delete transaction therefore reads
the pool doc, computes the next value, and clamps: an explicit
`entryCount: Math.max(0, current + delta)` rather than a blind increment.

**This costs the increment's concurrency safety**, which is acceptable only
because the entry doc is in the same transaction's read set and is what actually
serialises two deletes. Note this is a real amendment to the paragraph above it:
the opening sentence's "needs no change" is true of the SIGNATURE, and the ticket
must not read it as licence to route a negative delta through
`entryCountWrite`'s increment branch.

### D9 — seasonHistory is NOT a concern, and here is why

D9 of the parent plan gives an extra entry the seasonHistory id
`{poolId}__e{n}`. Those documents are written at **finalization**, which cannot
have happened on a pool that has scored no week (D3). **So a deletable entry has
no seasonHistory document, and the delete callable does not look for one.**

The same argument, and the same non-work, covers **payout and prize records**
(codex r1 C5): `recordPoolPayouts`, the weekly `WeeklyWinner` rows and the frozen
season places are all written by a scoring or finalization pass, so an entry that
can be deleted has none. The delete does not search for them.

🛑 **BOTH OF THESE ARE UNREACHABLE ONLY BECAUSE OF D3.** If D3 is ever relaxed —
if a scored entry becomes deletable — seasonHistory removal, payout-record
orphaning and recap rows naming a vanished entry all become real work, and D4
(the pot decrement) has to be re-decided at the same time because a prize may
already have been priced at the old denominator. This paragraph is the tripwire.

### D10 — The ledger UI

- Fee column and paid checkbox render on **EVERY** row, not `r.first` only.
- `feeOwed` on a row (`:248`) becomes the **per-entry** fee (`rates.entryFee`), not
  the member's multiplied total. The member's total moves to a **subtotal** line
  under the group, so Kevin's "group the entries together" reading survives.
- `onTogglePaid` takes `(uid, entryId, current)` — a uid alone can no longer
  identify what is being marked.
- `owedIn` / `paidIn` drop the `r.first` gate and sum **per entry**. ⚠️ Rebuys
  stay per MEMBER (`rebuyOwed` is a member-level sum, `shared/memberRecord.ts`),
  so they keep the `r.first` gate. Mixing those two in one loop is exactly how a
  double-count gets shipped; the ticket separates them into two loops with a
  comment.
- A row whose `paidStatus` is unknown (`null` — a prize recipient outside the
  roster) still renders `—`, never an unticked box. An unticked box is a
  statement; `—` is the absence of one.

### D11 — `firestore.rules` is NOT expected to change *(codex r1 C6)*

Measured, not assumed:

- `firestore.rules:750` — `pools/{id}/entries/{entryId}`: `allow write: if false`.
- `firestore.rules:766-770` — `pools/{id}/members/{memberUid}`: `allow update`
  only when the caller is the member AND the diff touches exactly
  `memberReportedPaid` / `memberReportedAt`; `allow create, delete: if false`.

Every write in this plan — `paidEntries`, the derived `paidStatus`, the entry
deletion, `pool.entryCount` — goes through a callable running with admin
credentials, which bypasses rules. **So no rules change is expected, and a
ticket that finds it needs one has found something else: STOP and ask Kevin**
(same posture Phase 1 took). A rules change here would mean a client had been
handed a write path to money, which is the thing the whole architecture refuses.

Rule tests are therefore NOT part of this plan's gates. The emulator suite tests
the callables, which is where the policy actually lives.

### D12 — HARD delete, not a tombstone *(codex r1 E3)*

The entry document is **removed**, not flagged `deletedAt`. This was put to the
alternative deliberately, because "never physically delete in a financial domain"
is a real position and deserves an answer rather than silence.

**Why hard delete wins here:**

- **A tombstone has to be filtered by five readers, each a place to forget it:**
  `resolveOwnedEntry`'s owned-set (which feeds the CAP — a tombstone would
  consume one of the member's 10 slots forever), `buildStandingsRows`, the
  reveal maps in `getPoolPicks`, `gatherPoolInput`'s profile aggregate, and the
  ledger's row builder. A missed filter shows a deleted entry as a live
  contestant.
- **There is no financial record to preserve.** D2 refuses to delete a paid
  entry; D3 refuses once anything is scored. By construction the deleted entry
  has no payment, no prize, no published row and no history document. The
  "financial domain" argument is about not destroying money records — and there
  are none.
- **The record of the deletion is durable and lives elsewhere**: an
  `admin_audit` row (actor, target uid, entry id, index, name, timestamp) and a
  ledger line, neither of which the delete can remove. That is the audit trail;
  the corpse is not.

⚠️ **The entry ID IS REUSABLE after a delete**, because it is deterministic
(`e${n}:${uid}`). A member who deletes entry 2 and creates a new one gets the
same id. That is fine — nothing joins on the old one, by the three bullets above
— but it means **the `admin_audit` row must carry the entry NAME and INDEX, not
just the id**, or two deletions of "entry 2" are indistinguishable in the trail.

---

## 4. Risks

| R | Risk | Mitigation |
|---|---|---|
| **R1** | A delete lands after a prize was priced at the old `entryCount`, so the published payout no longer matches the pot. | **D3.** Deletion is impossible once any week is scored, and prizes are published by the scorer. This is the load-bearing mitigation for the whole feature. |
| **R2** | `paidStatus` derives to PAID for a member with no liable entries (`[].every` is `true`), turning every seeded commissioner green. | The `length > 0` guard in D1, and it is the ticket's first test. |
| **R3** | A reader treats `paidEntries: undefined` (every legacy record) as "nothing is paid" and reports a PAID member as unpaid. | `undefined` means "no per-entry detail" and the reader falls back to the stored `paidStatus`. The derivation only runs where the map exists or is being written. Same unknown-is-not-false discipline as `hasPlayableEntry` and `pickedWeeks`. |
| **R4** | `entryCount` goes negative on a legacy pool whose stamp had drifted, and the pot goes negative with it. | D8's explicit clamp at 0, with a unit test on a drifted pool. |
| **R5** | The delete removes the entry doc but a concurrent scoring pass has already read it, and republishes a standings row for a document that no longer exists. | The delete transaction reads the pool doc **and** `standings/current`; a scoring pass that commits first aborts it. And D3 means the pool has never been scored, so `standings/current` should not exist at all — the delete asserts that rather than assuming it. |
| **R6** | Retiring K11 leaves a member who genuinely owes more money looking PAID. | It cannot: the new entry is absent from `paidEntries`, so the derived `paidStatus` is UNPAID from the moment the entry exists. The ticket asserts this directly. |
| **R7** | The ledger's per-entry sums double-count rebuys, which are per member. | D10's two-loop split, with the comment naming this risk. |
| **R8** | A commissioner deletes the WRONG member's entry (the callable takes a target uid). | `admin_audit` row with actor, target uid, entry id, entry name and index; the UI requires an explain-then-confirm step naming the entry (`mmp-superadmin-surface` convention). Not undoable — say so in the confirm copy. |

---

## 5. Out of scope

- **Refunds.** Marking an entry unpaid is not a refund and the ledger does not
  claim it is. Money moves between people out of band; this records it.
- **Deleting a member** (that is `PLAN-MEMBER-REMOVAL-HARDENING`), or deleting a
  SCORED entry, or deleting an entry in a non-NFL pool type.
- **Partial payment of a single entry** (paying $10 of a $25 fee). An entry is
  paid or it is not.
- **Rebuy payment per entry.** `rebuyOwed`/`rebuyPaid` stay per member. Kevin's
  ask was about the entry fee; splitting rebuys is a separate decision.
- **Backfilling `paidEntries` onto existing records.** Fix-forward: the map
  appears the first time a commissioner marks an entry, and until then
  `paidStatus` is the answer, exactly as today.

---

## 6. 🛑 DECISIONS — ANSWERED BY KEVIN 2026-08-25, ALL "A"

| # | Question | Answer |
|---|---|---|
| D1 | Where does per-entry paid status live? | **A** — on the Member Record as `paidEntries`; `paidStatus` derived and still stored. |
| D2 | May a PAID entry be deleted? | **A** — No. Refuse; un-mark payment first. |
| D3 | May an entry be deleted once a week is scored? | **A** — No. Refuse. |
| D4 | Does deletion reduce the pot? | **A** — Yes. `entryCount` drops and payouts recompute. |

**Nothing in §6 is open.** Two things surfaced while writing this plan that D1–D4
do not cover. Both were put to Kevin in chat with a recommendation, and **both
were RATIFIED on 2026-08-26** ("go with rec") — so they are decisions now, not
standing recommendations, and neither is to be re-derived by an implementer:

| # | Question | Ruling |
|---|---|---|
| **N1** | What does the derived `paidStatus` say for a member with **no liable entries** — a seeded commissioner who has never played? | **UNPAID (Kevin, 2026-08-26).** `[].every(...)` is `true`, so a naive derivation would turn every seeded commissioner green. The `length > 0` guard in D1 is the implementation, R2 is the risk row, and it is the ticket's first test. |
| **N2** | Does a deleted entry's paid mark survive, so a re-added entry at the same id comes back paid? | **NO — the `paidEntries` key is cleared with the entry (Kevin, 2026-08-26).** The alternative lets a commissioner manufacture a paid entry by deleting and re-adding one. A re-created entry starts unpaid. |

### 6a. Two things Kevin ruled OUT on 2026-08-26 — do not re-propose

Recorded here because both are the kind of "obvious improvement" a later session
re-invents, and each would have widened a money or authorization surface:

| Ruled out | Detail |
|---|---|
| **A commissioner rename of a member's entry** | Kevin: **no.** It adds a new authorization capability — and so a plan gate of its own under `mmp-change-control` §1 — to buy a rename the member can already perform themselves via `renameNFLEntry`. Not in scope for this plan or for Phase 1. |
| **A rename UI on SINGLE-ENTRY pools** | Kevin: **leave it.** `EntrySwitcher` renders nothing when `maxEntriesPerUser` is 1 or absent, so an ordinary pool has no rename control. The `renameNFLEntry` callable itself works on any NFL pool — the restriction is the switcher's visibility rule, deliberately unchanged. Entry #1's row shows the player's own name, which is what the default is for. |

---

## 7. Implementation tickets — small PRs, in this order

Each is its own PR with its own `codex exec review --base origin/main` round set
(CLAUDE.md §2c), its own gates, and its own sweep note.

| T | Ticket | Touches |
|---|---|---|
| **P2-T1** | `paidEntries` on the Member Record + the two derivation helpers (`liableEntryIds(m, uid, pickedEntryIds)` and `derivePaidStatus(m, liable)`) in `shared/memberRecord.ts`, **plus `ownerStateAfter` returning the transaction-local picked ids** that the first one needs (D1a). **PURE, no writers yet** — so the whole derivation including R2's empty-map case is unit-tested before anything can write it. | `shared/memberRecord.ts`, `lib/multiEntry.ts`, their tests |
| **P2-T2** | `setPaidStatus` takes an optional `entryId`; recomputes `paidStatus` from `paidEntries` in the same transaction; ledger amount becomes the ENTRY's fee when an entryId is given. The entry-doc mirror lands on that entry only. | `functions/src/setPaidStatus.ts`, `schemas/participantOps.ts` |
| **P2-T3** | Retire K11 (D6): remove `applyPaidReset` and `planMembershipWrite`'s `paidReset`, **and REPLACE — not drop — the summary write with `paidStatus: derivePaidStatus(...)` on every UPDATE that changes the entry set** (D1a row 2; dropping it leaves a paid member reading PAID after adding an unpaid entry). Rewrite emulator case 3 to assert the opposite on the per-entry marks AND that the stored summary goes UNPAID. | `functions/src/lib/{memberRecord,multiEntry}.ts`, `nflPools.ts` |
| **P2-T4** | `deleteNFLEntry` callable: commissioner-only, D2/D3 refusals, `admin_audit` row, ledger line, removes the entry doc + its `entries` key + its `paidEntries` key, recomputes `feeOwed`/`playableEntryCount`/`pool.entryCount` from ONE `liabilityDelta` (D7/D8 — zero for a non-liable entry, with the clamp when negative). | new `functions/src/nflEntryDelete.ts`, `index.ts`, schemas |
| **P2-T5** | Ledger UI (D10): fee + checkbox on every row, member subtotal, `owedIn`/`paidIn` re-derived per entry with rebuys kept per member. | `PaymentLedgerNFL.tsx`, `NFLManagerView.tsx` |
| **P2-T6** | The delete control: explain-then-confirm naming the entry, disabled with the reason when D2/D3 refuse it. | `PaymentLedgerNFL.tsx` / manager surface |
| **P2-T7** | The sweep pass in §8, each reader classified by WHAT IT READS. | `PLAN-MULTI-ENTRY-DUES-SWEEPS.md` |

**T1 before T2 is not arbitrary.** The derivation is where R2 lives, and a pure
function with a test is the only place that bug is cheap.

---

## 8. SWEEPS — every reader of the four fields

🛑 **THE RULE, AND THE INCIDENT BEHIND IT.** When a reader is classified
"correct as-is", the note must state **WHAT IT READS**, not what the file is
for. `PLAN-MULTI-ENTRY-SWEEPS.md` S1d records the cost of the shortcut:
`PaymentsPanel` was waved through as *"dues come from the Member Record"* and it
**never read the Member Record's fee at all** — which is how the
$25-instead-of-$50 defect passed a sweep that had just been re-verified clean.

The full pass lands in `PLAN-MULTI-ENTRY-DUES-SWEEPS.md` (T7). The surface,
enumerated here so the sweep cannot quietly shrink:

**`paidStatus` — 19 functions files, 23 client files.** The ones that decide
behaviour rather than display: `functions/src/setPaidStatus.ts`,
`lib/memberRecord.ts`, `lib/commissionerAggregate.ts`, `lib/reminderTargets.ts`,
`migrations/reconcilePaymentTruth.ts`, `statsTrigger.ts`,
`shared/memberRecord.ts` (`memberDues`, `isMemberPaid`); client
`utils/poolRoster.ts`, `PaymentsPanel.tsx`, `PaymentLedgerNFL.tsx`,
`NFLManagerView.tsx`, `NFLManagerBentoDashboard.tsx`, `NFLUserBentoDashboard.tsx`,
`ManagerDashboard.tsx`, `ParticipantDashboard.tsx`, `SuperAdmin.tsx`,
`admin/OperationsPanel.tsx`. **Bracket/Squares/Props readers are in scope for a
NO-CHANGE verdict, not for exclusion**: they read the same field on the same
document type, and the sweep must say why each is unaffected.

**`feeOwed` — `poolOps.ts:674-688` (the cascade), `setPaidStatus.ts:234` (read)
and `:312` (the ledger amount), `lib/profileBuild.ts`, `userProfile.ts`, `expertProfiles.ts`,
`shared/profile.ts`, `lib/reminderTargets.ts`; client `poolRoster.ts`,
`PaymentsPanel.tsx`, `PaymentLedgerNFL.tsx:248`, `NFLManagerView.tsx`,
`NFLManagerBentoDashboard.tsx`, `admin/OperationsPanel.tsx`.**

**`playableEntryCount` / `memberLiableEntries` / `memberPlayedEntries` —
`lib/memberRecord.ts:107-118`, `lib/multiEntry.ts` (**`ownerStateAfter` and
`entryCountWrite` BY NAME** — codex r1 B1), `nflPools.ts`, `poolExceptions.ts`,
`poolOps.ts:684`, `userProfile.ts`, `shared/memberRecord.ts`; client
`PaymentsPanel.tsx:114`.**

🛑 **ATOMICITY IS A SWEEP CRITERION, NOT ONLY COVERAGE.** `ownerStateAfter`
rebuilds the roster map and `entryCountWrite` moves the pot denominator; the
derived `paidStatus` reads the same roster. **A write that changes the entry set
and a write that recomputes `paidStatus` must be in ONE transaction**, or a
member briefly reads as PAID against a roster that has already grown. Each swept
writer is classified on two axes: does it read the field, and does it change the
entry set without recomputing the summary in the same transaction.

**`pool.entryCount` — the two WRITERS first (`nflPools.ts:899` submit, `:309`
join), then the readers: `shared/weeklyPrizes.ts:94`, `shared/seasonPrizes.ts:67`,
`functions/src/billing.ts:386`, `nflFinalize.ts`, `nflScoringEngine.ts`,
`nflPools.ts`, `poolOps.ts`, `propBets.ts`, `bracketEntries.ts`,
`shared/simGen.ts`; client `PayoutsPanel.tsx:350`, `billing/BillingGate.tsx:273`,
`utils/poolSport.ts:97`, `BrowsePools.tsx`, `ManagerDashboard.tsx`,
`Dashboards/GlobalStandingsCard.tsx`, `NFLPoolDashboard/WeeklyWinnersList.tsx`,
`admin/MembersTab.tsx`, `SuperAdmin.tsx`.**

⚠️ **`billing.ts:386` and `BillingGate.tsx:273` are the two that are NOT about
the pot.** They count entries against a billing plan's limit. A decrement there
means a pool that had exceeded its plan can come back under it — which is
correct, and is worth stating in the sweep rather than discovering when a gate
re-opens.

---

## 9. Gates for every PR in this plan

Unchanged from the standing set, listed so no ticket has to remember them:

- `npm --prefix functions test`
- `npx vitest run` (root)
- `npm --prefix functions run test:emulator`, extending
  `functions/src/__tests__/emulator/multiEntry.emulator.test.ts`:
  - pay entry 2 but not entry 1 → member `paidStatus` stays UNPAID, ledger shows
    one paid row;
  - pay both → PAID;
  - delete an unpaid unscored **liable** entry → `feeOwed`, `playableEntryCount`
    and `pool.entryCount` all DROP;
  - **delete an unpaid unscored NON-LIABLE entry (a pick'em entry persisted with
    `picks: {}`) → all three counters are UNCHANGED** *(codex r4 #3 — the earlier
    unconditional "all DROP" would have encoded the wrong behaviour and charged
    the pot for a delete that costs nothing)*;
  - deleting a PAID entry is refused (D2);
  - deleting an entry in a pool with a scored week is refused (D3);
  - adding an entry to a fully-paid member does NOT unpay the existing entries,
    writes NO `MARKED_UNPAID` ledger line, **and DOES move the member's stored
    `paidStatus` to UNPAID** (D6 / K11 retired) *(codex r4 #2 — asserting only
    the first two passes on the bug)*;
  - a seeded commissioner with no liable entries stays UNPAID (R2).
- Lint delta **ZERO**, measured by stashing rather than trusting a number.
- `codex exec review --base origin/main` — **never `--base main`** — up to 10
  rounds, every finding absorbed or rejected in the PR body with evidence.
- **Guard the guard**: any regex-based invariant is asserted against a sample it
  MUST catch and one it must NOT (#596 shipped an inert one).
- All checks green before merge, verified with `gh pr checks <n>`.
