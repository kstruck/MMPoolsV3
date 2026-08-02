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

### Three things found while specifying P1 (none of which codex named)

1. **There are TWO Bento paths, not one.** `togglePayment`
   (`NFLManagerBentoDashboard.tsx:78`) *and* `saveDetailedPayment` (`:91`) both
   call `updateBracketEntryPayment` → `updateEntryPayment`. codex named only the
   detailed panel. Both need repointing.

2. **The ledger UI is entry-backed.** `ledgerStats` (`:167`) counts
   `e.paidStatus` from entries, and the table renders `player.paymentMethod` /
   `paidAt` / `paymentNote` (`:746,760,775`) from the same source. So repointing
   the writer *without more* would leave that table blank and the collected/
   remaining figures stuck.

   ⇒ **`setPaidStatus` must write the Member Record as truth AND mirror the
   display fields onto the entry, in the same transaction.** That keeps the UI
   unchanged, keeps one writer, and makes the two stores agree *by construction*
   — which means P2's reconciliation is genuinely a one-off for historical data
   rather than a recurring cleanup. It also makes the entry's `paidStatus`
   finally *be* what `bracketEntries.ts:416` already calls it: an accurate
   display projection.

3. **`setPaidStatus` throws when no Member Record exists** (`setPaidStatus.ts:46`
   — *"Member is not on this pool's roster"*). On a legacy NFL pool that is every
   member, so a naive repoint converts a working-but-wrong action into a hard
   error for exactly the pools this plan is trying to repair.

   ⇒ **Sequencing changes: P4's backfill must run BEFORE P1 reaches those pools.**
   The id mapping is at least unambiguous — for NFL season pools the entry doc id
   *is* the uid (`nflPools.ts:486,512,573`) and the Bento already derives
   `uid: e.ownerUid || e.id` (`:148`).

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

## 5. DECISIONS — ANSWERED BY KEVIN 2026-07-26. Build against these.

| Q | Answer |
|---|---|
| **Q1** | **Option 3.** Extend `setPaidStatus` with the detail fields; repoint the Bento panel at it. `updateEntryPayment` untouched for BRACKET. |
| **Q2** | **Option B.** Rebuys are dues owed — add a rebuy-paid control. |
| **Q3** | **Split the flag.** New `includeFinished`; the sim/test exclusion becomes unconditional and cannot be switched off. |
| **Q4** | Implied by Q2 — roster `duesCollected` and the pot move together. Accepted. |
| **Q5** | **Build the reconciliation pass now**, rather than counting first. |

> **Q5 note.** I had recommended counting first. Kevin's answer is strictly
> better than the way I framed the choice: the reconciliation is **dry-run-first
> by house rule**, so *its own dry run is the count*. One pass yields both the
> number and the fix, instead of a query and then a migration. P0 is therefore
> folded into P2 and is no longer a separate step.

The original questions are kept below for the record.

## 5b. The questions as originally written

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
| P1 | D13 — `setPaidStatus` takes the detail fields; Bento repointed | plan-gated (money + authz) | review |
| P2 | Reconciliation migration, **dry-run default** — its dry run is also the divergence count | plan-gated (prod data) | review + **runs it** |
| P3 | D12 — the rebuy-paid control (option B) | plan-gated (money) | review |
| P4 | D25 — split the backfill flag into `includeFinished`, add the Operations button | plan-gated (prod data) | review |
| — | **Reconciliation + backfill: dry run, read the report, then live** | prod-data | **runs it** |
| — | **Recalculate Global Stats** | prod-data | **runs it** |

**Revised order after specifying P1: P4 → P1 → P2 → P3.**

- **P4 first** because `setPaidStatus` refuses to write when no Member Record
  exists, and on legacy NFL pools that is every member (§2 finding 3). Repointing
  before the backfill would hard-error exactly the pools being repaired.
- **P1 before P2**, still: reconciling before the write path is fixed means the
  stores start diverging again the next time someone opens the Bento panel.
- **P3 last** — it is independent of the other three.

**P2 and P4 both dry-run by default**, per Rule 1 and the `fixParticipantIds`
lesson (PR #183): the flag must fail safe **at the schema layer**, not in a
handler truthy check.

All of it lands **after** the A–D stats chain is merged and deployed. None of it
blocks that chain — A–D are correct as they stand; these three make the number
they produce *complete*.

### 6a. P1's transitional fallback — CLOSED 2026-07-28

P1 shipped (#294) carrying one named transitional residual: **`NFLManagerView`'s
roster toggle kept a fallback to `updateBracketEntryPayment` →
`updateEntryPayment` when `setPaidStatus` threw.** It was named in
`MORNING-2026-07-27.md` §5 as "correct until the backfill runs everywhere, then
it should be removed (not this PR)".

**That condition is now met and the fallback is removed.** No new plan gate: the
removal is P1's own stated end-state, and both halves of the reasoning are
already in this document — §2 finding 3 (why the fallback had to exist:
`setPaidStatus` throws `"Member is not on this pool's roster"`, which on a legacy
NFL pool was every member) and §4 / §6's P4-first ordering (what removes that
condition). The prod evidence closing it is the D25 backfill live run on
2026-07-27: **72 member records created across 127 pools, zero failures, and a
follow-up dry run reporting 0-to-create / 152-already-present.**

Why removing it is a fix and not just tidying: `setPaidStatus` throwing no longer
means "not deployed yet", it means the write genuinely failed. Falling back then
writes the *display-legacy* entry doc alone — the D13 split-brain this plan
exists to close, reachable again through the error path, and silent because the
UI reads the same entry doc it just wrote. `tests/nfl-settings-lockdown.test.ts`
now pins the absence of `updateBracketEntryPayment` from `NFLManagerView.tsx`,
alongside the existing Bento guard.

**Unchanged: `updateEntryPayment` itself stays** — BRACKET pools' entry doc
genuinely *is* their payment store (§2 "Blast radius"), and its six remaining
callers are all BRACKET or SuperAdmin paths.

---

## 6b. P5 — the READER side of D13 (added 2026-07-30)

⚖️ **Money surface, so plan-gated. Kevin ruled on 2026-07-28 that this belongs
here rather than in a new `PLAN-*.md`**, because it is the other half of a defect
this plan already names.

### What was still wrong after P1–P4

P1 fixed the **writer**: every payment write now goes through `setPaidStatus`,
which makes the Member Record truth and mirrors the display fields onto the entry.
§4 item 2 above records why the mirror was required — *"the ledger UI is
entry-backed"* — and treats that as a constraint to preserve.

It was a constraint worth removing instead. Because the mirror only fires
`if (entrySnap.exists)`, an entry-backed **reader** cannot see a member who never
submitted an entry, and there is no write that can fix that. Observed live by
Kevin on 2026-07-29: on a pool whose members held Member Records but no entry
documents, the Buy-In Ledger card and the Advanced Payment Ledger modal both
reported `$0` projected, `$0` collected, `0%` clearing rate and *"no members
matching filter criteria"* — while the Member Roster panel **on the same page**
listed those members correctly, because it reads Member Records.

Two figures on that card were independently wrong, and neither needed an empty
roster to be wrong:

* The entry fee defaulted to `entryFee || 20`, so a pool with no fee projected a
  pot of $20 per head that nobody owed.
* Clearing Rate divided paid members by **entry holders**, so a pool where one of
  four members had paid and only that member had an entry reported **100%**.

### What shipped

There were already **three** independent derivations of this data — the roster
merge in `NFLManagerView`, the dues maths in `PaymentsPanel` (hardened over four
codex rounds under P3), and the Bento card's own entries-only version. Adding a
fourth was the wrong move; the disagreement *was* the multiplicity, the same
one-definition defect as #315, #319 and HANDOFF item 11.

So the first two moved into `src/utils/poolRoster.ts` unchanged, comments
included, and all three surfaces now read from there:

| Export | What it is | Readers |
|---|---|---|
| `buildPoolRoster` | participantIds + Member Records + entries merged into one row per member, Member Record winning on `paidStatus` and on the payment detail | `NFLManagerView` roster panel, Bento card, Bento modal |
| `rosterPotStats` | `{ memberCount, paidCount, unpaidCount, collected, expected }` — the P3 dues maths verbatim | `PaymentsPanel` pot, Bento card, Bento modal |
| `outstandingDue` / `clearingRate` | derived, clamped at 0 and divide-by-zero-safe | Bento card, Bento modal |

`shared/memberRecord.ts` was deliberately **not** touched. Its `MemberRecord`
interface still omits `paymentMethod` and `paymentNote` even though
`setPaidStatus` writes both onto the record — a real inaccuracy, but `shared/` is
compiled into `functions/` by the predeploy hook, so declaring two optional fields
there would have owed a full functions deploy for a change with no runtime effect.
Fold it into the next PR that touches `functions/`, together with the now-obsolete
comment in `setPaidStatus.ts` that still justifies the mirror by the reader being
entry-backed.

### Evidence

`src/utils/poolRoster.test.ts` — 23 cases covering the entry-less member, the
unset fee, a stamped `feeOwed: 0`, owed-vs-settled rebuys, the un-stamped
`rebuyOwed` fallback and its stamped-zero counterpart, partially backfilled pools,
the pre-backfill path, the guest sentinel, the uid union and both clamps.

`tests/admin-surface-invariants.test.ts` — wiring invariants plus the T3 fake-card
guard extended to the commissioner bento (it had only ever covered the super-admin
one, which is why the same defect class survived there).

**38 mutations applied across the two files. 37 killed on the first attempt; one
SURVIVED and the guard was strengthened until it did not** — see round 4 below,
because that near-miss is the most useful thing in this section. The killed set
includes reinstating `entryFee || 20`, making the pot ignore Member Records,
dropping the `members` prop, forking `PaymentsPanel`'s maths back off, reverting
the head count to `Math.max`, putting the raw kickoff back in place of the
enforced lock, removing the weekly-lock type gate, and dropping an entry-only
member's payment from Collected.

### Review log — P5

| Round | Reviewer | Findings |
|---|---|---|
| 1 | codex | **3 findings, all P2, all VALID and all absorbed. None rejected.** (a) **The replacement deadline was wrong too.** Removing the hardcoded sixteen-hour countdown, the first draft showed the first KICKOFF and labelled it the lock. Picks close `lockBufferMinutes` earlier (default 5; Survivor/Margin allow 5/30/60) and a hard-lock pool's deadline is frozen per week, so commissioners would have read a cutoff up to an hour late — a fabricated deadline replaced by a differently-wrong one. Worse, `weekDeadline` and `effectiveBufferMinutesForWeek` already existed and are what `WeekChecklist` (the MEMBER-facing surface) uses, so the hand-rolled `Math.min` was a fourth definition inside a PR whose whole point was collapsing definitions. Now delegates to both. (b) **The green all-clear could contradict the card's own Outstanding Due tile.** Base dues and rebuy dues settle independently under P3, so every member can be `PAID` while rebuy dollars are owed — and the unpaid LIST is empty in precisely that case, since those members' base dues really are paid. Gating on the list meant "All buy-ins cleared!" could sit above a positive balance. Now gated on `outstandingDue(pot) === 0`, with a distinct state that names the rebuy debt and points at the control that settles it. (c) **The head count undercounted a person evidenced only by an entry.** `Math.max(members.length, participantIds.length, entries.length)` is the roster size only when the sets nest; where an entry exists for a uid in neither `members` nor `participantIds`, the max is short AND `memberCount - members.length` is 0, so that person's base fee vanished from `expected` while `buildPoolRoster` still listed them — the card disagreeing with itself, which is the exact failure this section exists to end. Now a uid UNION shared with `buildPoolRoster`, and record-less people are walked per-uid rather than counted by difference. **Inherited, not introduced:** (c) came verbatim from `PaymentsPanel`, so the member-facing pot had it too and is fixed by the same change. |
| 2 | codex | **2 findings, both VALID, both absorbed, and both on ROUND 1's OWN FIXES rather than the original defect.** (a) **P1, and a regression r1 introduced.** r1(c) started charging a person evidenced only by an entry — but never read their `entry.paidStatus`, while `buildPoolRoster` renders that same person's row as `PAID`. So the card could show a PAID row and simultaneously understate Total Collected and Clearing Rate and overstate Outstanding Due. The old entries-backed ledger DID count that payment, so this was a regression, not an omission. The record-less loop now reads the entry for payment as well as for dues, and the guard asserts the totals and the rendered row read the same field. (b) **P2: one week deadline is only TRUE for weekly-hard-lock pools.** Default `NFL_PICKEM` is `PER_GAME` — `submitNFLPicksInternal` checks each picked game's own lock, so later games stay editable long after the first closes, and `weekLockOverrides` can push an individual week later still. That per-game/override model lives in `functions/src/lib/effectiveLock.ts`, which is **not** shared with the client, so no honest single line can be rendered for those pools from this card. Gated on `usesWeeklyHardLock` — the same predicate the server uses — so Survivor/Margin get the label and everything else gets nothing. **Showing nothing beats showing a deadline that is not enforced,** and building a fifth client-side lock model to fill the gap on a submission-health card is not worth it seven days out. Recorded rather than done. |
| 3 | codex | **CLEAN.** Self-review of the diff afterwards found one real thing codex had not: the roster this card renders deliberately falls back to `participantIds` and entries, so it can list someone `setPaidStatus` rejects with `not-found` — a reachability the entries-backed version did not have for participantIds-only rows — and both handlers hardcoded their error copy, one of them blaming *"Insufficient permissions or network loss"*. That sends whoever reads it to debug the wrong thing entirely. Routed through `getUserMessage`. Also renamed `editingEntryId`, which had held a member UID since the repoint, and replaced a hardcoded `false` for the current paid state with the row's own value. |
| 4 | codex | **1 finding, P3, VALID and absorbed — on round 3's fix.** `getUserMessage` resolves the transport CODE (`functions/not-found`) *before* it looks at the message, and `setPaidStatus` uses `not-found` for BOTH "Pool not found" and "Member is not on this pool's roster" — so round 3's fix still rendered the roster case as *"that pool or entry couldn't be found"*, about a pool plainly on the commissioner's screen. Disambiguated by the client's own `hasMember` rather than by pattern-matching the server's prose, which would break silently the day that sentence is reworded; it only EXPLAINS an error that already happened and never pre-blocks the write. **✅ PAID 2026-07-31 — the durable fix landed** as `MEMBER_NOT_ON_ROSTER:` on both `setPaidStatus` throw sites, with a matching entry in `DOMAIN_PREFIX_MESSAGES`. The client no longer needs `hasMember` to disambiguate, though that branch is left in place as a second line of defence for older deployed functions. Original note follows. **The durable fix is a domain prefix on the server error** — `getUserMessage` already resolves `/^[A-Z_]{4,}:/` ahead of the code — but that is a `functions/` change and this PR is frontend-only. Owed to the next PR that touches `functions/`, alongside the two undeclared `MemberRecord` fields and the stale mirror comment. **⚠️ The guard written for this finding did NOT hold on the first attempt.** It pinned the plumbing — the parameter, both call sites, the arity — every one of which survives reverting the body to a bare `getUserMessage(err, fallback)`. The mutation caught it; reading it did not. It now pins the BRANCH: `hasMember` must actually select between `getUserMessage` and a distinct message naming the missing roster record, and a mutation collapsing both sides of the ternary fails it. This is the fourth time in this repo a test has looked like it guarded and did not. |
| 5 | codex | **1 finding, P2, VALID and absorbed — plus a follow-on it did not name.** "Unpaid" on this card was a payment STATUS, not a DEBT. A seeded owner carries `feeOwed: 0` (ADR 0005 — hosting is not playing) with `paidStatus: 'UNPAID'`, and on a FREE pool every member does. So the unpaid queue listed people who owed nothing, offered them a meaningless "Mark Paid", and kept the card from ever reaching its all-clear — beside its own tiles reading Expected $0 and Outstanding Due $0. Clearing Rate had the same defect from the other end, reporting 0% on a free pool. Fixed with `memberOutstanding` (one row's real debt: base dues plus unsettled rebuy dues) and a `clearedCount` counted off the SAME rows the card renders, so the list and the percentage cannot disagree with each other. **The follow-on, found by self-review after the fix:** a debt-filtered list CONTAINS rebuy-only debtors, who are `paidStatus: 'PAID'` — and the row's button called `togglePayment` with their current state, so clicking "Mark Paid" on them would have set them **UNPAID**. Those rows now name the debt and offer no action, since rebuy settlement is a different callable mode (`settleRebuys`) living on the member roster below. That same change made **round 1's separate "base cleared, rebuy outstanding" empty state unreachable**, so it was deleted rather than left standing as a branch that looks like a safeguard and can never run — and the guard was rewritten to assert its absence. |


### The mirror stays

Nothing here makes `setPaidStatus`'s entry mirror removable. `reconcilePaymentTruth`
depends on the two stores converging, and BRACKET pools' entry doc genuinely is
their payment store (§7). Only the *justification* recorded in §4 item 2 is out of
date.

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
