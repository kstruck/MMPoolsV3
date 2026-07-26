# PLAN — Payment truth: one store, one writer, one backfill

**Status: DRAFT, awaiting Kevin's sign-off. NO CODE WRITTEN — deliberately.**
Written 2026-07-26, after the overnight stats run. Covers **D13, D12, D25** from
`MORNING-2026-07-26-OVERNIGHT.md` §3.

> ## ⛔ Read §0 first — it corrects the morning report
>
> I wrote D13 up as "two payment controls, and you have to decide which store
> wins." **That decision is already made and written down in the code.** The fix
> is therefore smaller, safer, and less interesting than I made it sound. §0.

## Why this is plan-gated

`mmp-change-control` §1 plan-gates a change touching **money, authorization,
production data, or scoring**. This hits three:

- **Money** — it changes which dollars count as collected, on the surface that
  feeds the world-readable `stats/global`.
- **Production data** — D25 is a migration over historical pools.
- **Authorization** — D13 touches a commissioner-facing callable's contract.

---

## 0. The correction: the authoritative store is already decided

`functions/src/bracketEntries.ts:416-417`, in the header of `updateEntryPayment`:

> *"NOTE: the entry's paidStatus is display/legacy; the Member Record
> (setPaidStatus) remains the authoritative payment truth."*

And `functions/src/setPaidStatus.ts:1` calls itself *"Single authorized path for
Member Record payment writes."*

So:

- **PR B reading Member Records for NFL pots is correct by design**, not an
  accidental divergence. That is a relief and it means the shipped code is right.
- D13 is **not** an ambiguity about which store wins. It is a **miswired
  control**: the Bento detailed-payment panel calls a callable the code itself
  labels *display/legacy*, so a commissioner using it believes they marked
  someone paid while the authoritative record still says `UNPAID`.

That reframing removes the risky half of the change. There is no store to pick.

---

## 1. What I verified (file:line, read tonight, not assumed)

| Fact | Evidence |
|---|---|
| Member Record is authoritative; entry `paidStatus` is display/legacy | `bracketEntries.ts:416-417` |
| `setPaidStatus` writes the Member Record **and** appends the `payments` ledger **and** recomputes roster summary + commissioner aggregate | `setPaidStatus.ts:44-69` |
| `updateEntryPayment` writes **only** `pools/{id}/entries/{entryId}` + an `audit` doc. No Member Record, no ledger, no projections | `bracketEntries.ts:447-463` |
| The Bento detailed-payment panel calls `updateEntryPayment` | `NFLManagerBentoDashboard.tsx:94-97` |
| The roster toggle calls `setPaidStatus` (correct path) | `NFLManagerView.tsx:223` |
| `updateEntryPayment` carries detail fields `setPaidStatus` does not: `paymentMethod`, `paidAt`, `paymentNote` | `bracketEntries.ts:427,447-451` |
| The rebuy path increments **`rebuyOwed` only** — never `rebuyPaid` | `nflPools.ts:757,762` |
| Nothing in `functions/src` **or** `src/` writes `rebuyPaid` at all | grep, both trees, zero hits outside tests |
| `memberDues` adds `rebuyPaid` to *collected*, so rebuys contribute $0 | `shared/memberRecord.ts:76` |
| The backfill skips a pool unless `includeAll` | `backfillMemberRecords.ts:107` |
| Its skip predicate excludes COMPLETED / CANCELED / archived / final **and** sim pools | `lib/poolInclusion.ts:16-26` |
| The Operations panel calls it with `{ dryRun, limit, startAfter }` — **never `includeAll`** | `OperationsPanel.tsx:45` |
| `includeAll` exists in the schema and defaults to absent | `schemas/migrations.ts:26` |

---

## 2. D13 — the miswired payment control

### What happens today

A commissioner opens an NFL pool's manager Bento, uses the **detailed payment**
editor (method / date / note), and marks a member paid. The entry doc updates.
The Member Record does not. Therefore:

- the roster still shows them **UNPAID**;
- the `payments` ledger — the shared record that exists to prevent "I paid you"
  disputes — has **no entry**;
- `rosterSummary` and the commissioner aggregate are **not** recomputed;
- and their dues are **missing from the pot**, which is how this surfaced.

The two controls disagree, and the one with the richer UI is the wrong one.

### Options

| | Approach | Verdict |
|---|---|---|
| 1 | Bento calls `setPaidStatus` **and** `updateEntryPayment` | Rejected — two round trips, no atomicity; a partial failure leaves exactly today's split |
| 2 | `updateEntryPayment` reconciles the Member Record server-side for NFL pools | Workable, but it would have to duplicate the ledger append and the projection recomputes, or they silently diverge instead |
| 3 | **Extend `setPaidStatus` to accept the optional detail fields, write both stores + ledger + projections in its existing transaction, and repoint the Bento panel at it** | **RECOMMENDED** |

Option 3 is what `setPaidStatus`'s own header already claims to be. It leaves
exactly one authoritative writer, keeps the ledger correct by construction, and
deletes the second path rather than teaching it to agree.

### Blast radius, stated plainly

`updateEntryPayment` is **also used by BRACKET pools**, where the entry doc
genuinely *is* the payment store (`calculatePoolPot`'s BRACKET branch reads it,
correctly). So the callable **must not** be deleted or made NFL-only. Option 3
leaves it exactly as it is for bracket callers and simply stops the NFL panel
using it.

### Test plan

Emulator, against the real callables: mark paid through the Bento path and assert
the Member Record flipped, the ledger gained one row, `rosterSummary.paidCount`
moved, and `calculatePoolPot` now includes that member. Reverting the repoint
must fail it.

---

## 3. D12 — Survivor rebuys contribute $0

`rebuyOwed` goes up; `rebuyPaid` is never written by anything. `memberDues` adds
only `rebuyPaid` to collected. So every rebuy dollar is invisible to the pot —
and to `duesCollected` on the commissioner roster, which has had the same hole
all along.

**This one is a genuine product decision, not a mechanical fix.** The question is
what a commissioner is even asserting when they click "Paid".

| | Approach | Trade |
|---|---|---|
| A | Treat `paidStatus === 'PAID'` as covering `rebuyOwed` too — one line in `memberDues` | Cheapest. But it conflates: a member who paid dues and owes a rebuy shows as fully settled, and their rebuy silently lands in the pot as collected |
| B | Add a **rebuy-paid** control — commissioner settles rebuys separately; `setPaidStatus` (post-D13) grows a rebuy amount | Most correct. Models what actually happened. Costs a UI control and a schema field |
| C | Make a rebuy **paid at purchase** — it is a buy-in, so `rebuyPaid = rebuyOwed` at the moment of rebuy | Simplest mental model, and arguably true: `executeSurvivorRebuy` is the member choosing to buy back in. Wrong if you collect rebuy money out-of-band like normal dues |

**My read: C if rebuys are paid up front, B if they are collected like dues.
A is the one to avoid** — it makes the roster lie in a way nobody can see.

**I do not know how you actually collect rebuy money**, and that single fact
picks the option. That is decision Q2 below.

⚠️ `memberDues` is **shared** — it also backs `lib/rosterSummary.ts` and the
commissioner dashboard. Whatever we choose moves **two** money surfaces, so the
change needs its tests on both.

---

## 4. D25 — historical pools have no Member Records

The backfill skips a pool unless `includeAll: true`, and the Operations button
never passes it. The skip predicate excludes COMPLETED / CANCELED / archived /
final — **exactly the historical pools whose money you want in the all-time
total**.

### A finding from writing this: `includeAll` is too blunt

It conflates two independent questions:

- *include finished pools?* — **yes**, that is the whole point;
- *include sim/test pools?* — **no**, and after PR D the stats filter them anyway,
  so backfilling them is pure write amplification against test data.

`isActivePoolForStats` answers both with one boolean. **Recommendation: split it**
— `includeFinished` (what you want) separate from the sim exclusion (which should
stay unconditional). Small change to the migration + its schema, and it makes the
prod run narrower rather than wider.

### Order matters, and it is the opposite of what looks natural

The backfill **must run before** Recalculate Global Stats. Backfilling after
means the recalculate published an under-count and nobody re-ran it.

But the backfill copies `paidStatus` **from entry docs** (`backfillMemberRecords.ts:56`)
— so a pool whose commissioner used the Bento path gets its Member Record seeded
from the entry, which is the *display/legacy* field. **That is a second reason to
land D13 first**: after D13 the two agree, so the seed is right whichever way it
was set.

**Sequence: D13 → D25 backfill (dry run, then live) → Recalculate.**

### Kevin-run, dry-run first

Nothing here runs unattended. The dry run reports counts and the live run is
idempotent (it skips members already present).

---

## 5. Decisions I need — the whole plan is blocked on these

1. **Q1 — D13 option 3?** Extend `setPaidStatus` with the detail fields and
   repoint the Bento panel at it, leaving `updateEntryPayment` untouched for
   bracket pools. *(My recommendation. Say no and I will do option 2.)*
2. **Q2 — how is Survivor rebuy money actually collected?** Paid up front at the
   moment of rebuy (→ option C), or collected out-of-band like dues (→ option B)?
   **This is the only question I cannot answer from the code.**
3. **Q3 — split `includeAll` into `includeFinished` + always-skip-sim?** Or just
   pass `includeAll: true` and accept member records being written onto test
   pools?
4. **Q4 — does the commissioner roster's `duesCollected` change with the pot?**
   Q2's answer moves both surfaces. Confirm you want them consistent — I assume
   yes, but it changes numbers commissioners are already looking at.

---

## 6. Proposed sequencing

| PR | Scope | Gate | Kevin needed |
|---|---|---|---|
| P1 | D13 — `setPaidStatus` takes the detail fields; Bento repointed | plan-gated (money + authz) | review |
| P2 | D12 — per Q2 | plan-gated (money) | **Q2 first** |
| P3 | D25 — split the backfill flag, add the Operations button | plan-gated (prod data) | review |
| — | **Backfill dry run, then live** | prod-data | **runs it** |
| — | **Recalculate Global Stats** | prod-data | **runs it** |

All of it lands **after** the A–D stats chain is merged and deployed. None of it
blocks that chain — A–D are correct as they stand; these three make the number
they produce *complete*.

---

## 7. Explicitly out of scope

- **Props payment state (D11).** Props has no payment path at all. Separate
  product question: does a Props pool even need one, or is card count the right
  definition of its pot forever?
- **`bracketScoring.ts:410`** — the pot sized from PAID entries while line 415
  ranks over ALL entries. Real money defect, still owed a test, **report only**
  per your instruction. Not this plan.
- **The `isSuperAdmin()` rules bypass (D22).** Pre-existing, unrelated to payment
  writes.

---

## 8. Review log

| Round | Reviewer | Findings |
|---|---|---|
| — | — | pending `codex exec review` on this document |
