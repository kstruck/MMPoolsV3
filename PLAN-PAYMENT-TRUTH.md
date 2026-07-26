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
| B | **Add a rebuy-paid control** — commissioner settles rebuys separately; `setPaidStatus` (post-D13) grows a rebuy amount | **RECOMMENDED** — models what actually happened. Costs a UI control and a schema field |
| C | Make a rebuy **paid at purchase** — `rebuyPaid = rebuyOwed` at the moment of rebuy | **Ruled out — see below** |

### The product already answers this, so Q2 is a confirmation, not a decision

I had this down as the one thing I could not get from the code. It is in the
code — in the UI copy. `SurvivorPickEntry.tsx:132,145`, the rebuy confirmation
the member actually reads:

> *"This restores your ALIVE status and adds **$X** to what you owe the
> commissioner."*
>
> *"Rebuy confirmed — you're back in the game! **$X due to the commissioner**."*

A rebuy is money **owed and collected out of band**, exactly like dues. It is not
a buy-in taken at purchase. So:

- **C is wrong** — it would book money as collected that the member has just been
  told they still owe.
- **A is wrong for the same reason**, one step later: it marks the rebuy collected
  the moment base dues are marked paid, which is a different event.
- **B is the only one consistent with what the member was promised.**

That also explains why `executeSurvivorRebuy` writes `rebuyOwed` and stops: the
existing code is *right*, and `rebuyPaid` was simply never given a writer.

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

The backfill copies `paidStatus` **from entry docs** (`backfillMemberRecords.ts:56`)
— the *display/legacy* field. Counter-intuitively **that is the correct source for
exactly these pools**, and the reason is worth writing down:

`setPaidStatus` throws `"Member is not on this pool's roster"` when the Member
Record does not exist (`setPaidStatus.ts:46`). So on a historical NFL pool that
has **no** Member Records, the roster toggle was never usable — the commissioner
*must* have marked people paid through the Bento path, which means the entry docs
carry the real answer. The backfill seeding from entries recovers it.

### ⚠️ But D13's fix is FORWARD-ONLY, and that leaves a gap nothing closes

Consider a pool that **does** have Member Records and whose commissioner then used
the Bento panel. Today that pool's two stores already disagree. After D13 they
agree *going forward* — but:

- the backfill **skips members already present** (`backfillMemberRecords.ts:121`),
  so it will not repair them;
- nothing else reconciles the two stores.

**So those pools stay wrong after every step in this plan.** The money is marked
paid on the entry, `UNPAID` on the Member Record, and the pot under-reports it
permanently.

That needs a **one-off reconciliation**: for NFL pools, where the entry says
`PAID` and the Member Record says `UNPAID`, promote the Member Record (and append
the missing ledger rows, or the payments ledger stays incomplete).

How many pools that affects is **unknown from here** — it depends entirely on
which control your commissioners used. **A read-only count should run before we
decide whether to build the reconciliation or fix the handful by hand.** That is
Q5.

**Sequence: D13 → D25 backfill (dry run, then live) → Recalculate.**

### Kevin-run, dry-run first

Nothing here runs unattended. The dry run reports counts and the live run is
idempotent (it skips members already present).

---

## 5. Decisions I need — the whole plan is blocked on these

1. **Q1 — D13 option 3?** Extend `setPaidStatus` with the detail fields and
   repoint the Bento panel at it, leaving `updateEntryPayment` untouched for
   bracket pools. *(My recommendation. Say no and I will do option 2.)*
2. **Q2 — confirm option B for rebuys.** No longer an open question: the rebuy
   confirmation tells the member the money is **owed to the commissioner**
   (`SurvivorPickEntry.tsx:132,145`), so a separate rebuy-paid control is the only
   option consistent with what they were told. **Just confirm — or tell me the UI
   copy is wrong and you take rebuy money up front**, which would make it C.
3. **Q3 — split `includeAll` into `includeFinished` + always-skip-sim?** Or just
   pass `includeAll: true` and accept member records being written onto test
   pools?
4. **Q4 — does the commissioner roster's `duesCollected` change with the pot?**
   Q2's answer moves both surfaces. Confirm you want them consistent — I assume
   yes, but it changes numbers commissioners are already looking at.
5. **Q5 — reconciliation for pools already diverged.** D13 is forward-only (§4).
   Build a one-off reconciliation pass, or count them first and fix by hand if it
   is a handful? **I recommend counting first** — it is a read-only query and it
   decides whether the pass is worth writing at all.

---

## 6. Proposed sequencing

| # | Scope | Gate | Kevin needed |
|---|---|---|---|
| P0 | **Read-only divergence count** — how many NFL members have entry `PAID` + Member Record `UNPAID`? | read-only | **runs it** (creds) |
| P1 | D13 — `setPaidStatus` takes the detail fields; Bento repointed | plan-gated (money + authz) | review |
| P2 | Reconciliation for the pools P0 finds — **only if P0 says it is worth it** | plan-gated (prod data) | review + runs it |
| P3 | D12 — the rebuy-paid control (option B) | plan-gated (money) | review |
| P4 | D25 — split the backfill flag, add the Operations button | plan-gated (prod data) | review |
| — | **Backfill dry run, then live** | prod-data | **runs it** |
| — | **Recalculate Global Stats** | prod-data | **runs it** |

**P0 first, deliberately.** It is a read-only query and it decides whether P2 is a
migration or a five-minute manual fix. Writing the reconciliation before knowing
the number is how a one-off script becomes a week.

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
| 1 | codex | **5 findings on this doc + the morning report. 4 valid, 1 rejected.** (a) **P1, valid and the best catch:** the morning report told the operator to Recalculate right after deploying A–D, while this plan says the backfill must come first — **my own two documents contradicted each other**, and following the report would have published a known under-count to a world-readable doc. Both corrected. (b) **P1, valid:** repointing the Bento control is forward-only; members already marked paid through it keep an `UNPAID` Member Record and the backfill skips them. I had reached the same conclusion independently while codex was running, so this is corroboration rather than a save — it is now P0/P2 and Q5. (c) **P2, valid:** #283 was already merged and still listed as step 1 of the merge queue. Removed. (d) **P2, valid:** the "for each PR" runbook hardcoded `gh pr checks 282`. Parameterised. (e) **REJECTED:** claimed the merge order contradicts branch ancestry — *"B is rooted at main, C contains B, A contains C, and D contains A"*. Checked with `git merge-base --is-ancestor` against `origin/*`: **A and B are both rooted at `8a55b84` and independent; A contains nothing.** The stated A → B → C → D order satisfies every real dependency. The check did surface something codex had not named, though — D carries A's content as *replayed* commits (a rebase linearised the merge), so D will likely need a rebase once A lands. That is now written into the report. |
