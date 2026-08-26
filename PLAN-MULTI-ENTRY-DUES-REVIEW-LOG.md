# REVIEW LOG — PLAN-MULTI-ENTRY-DUES.md

Adversarial review of the plan document, before any code
(`mmp-change-control` §1: plan → review log → sweeps → code).

⚠️ **REVIEWER PROVENANCE, BECAUSE IT IS NOT THE USUAL ONE.** These rounds ran in
a remote Claude Code container, not on `D:\march-melee-pools`. `codex` is on PATH
there but is **not authenticated the way it is on Kevin's machine**: the default
`gpt-5.6-sol` returned `401 Unauthorized` on the ChatGPT path, and once routed
through the container's `OPENAI_API_KEY` the project has no access to that model.
The review therefore ran on **`gpt-5.3-codex`** via an explicit provider
override. That is a **different reviewer** from the one CLAUDE.md §2c's
calibration (17/17 valid defect findings) was measured against, and the round 1
verdict table below is consistent with that: **6 of 15 findings survived, and 3
of the 9 rejections cited fields that do not exist in this codebase.** Weigh the
calibration accordingly, and re-run a round on Kevin's machine before P2-T2
ships if that is available.

```
codex exec -m gpt-5.3-codex \
  -c model_provider=oai \
  -c 'model_providers.oai={name="OpenAI",base_url="https://api.openai.com/v1",env_key="OPENAI_API_KEY",wire_api="responses"}'
```

`codex exec review --uncommitted` was tried FIRST and declined the job —
*"there is no executable patch to assess"* — so the plan was reviewed by
prompting `codex exec` directly, the same way `PLAN-MULTI-ENTRY.md` was.

---

## Round 1 — 15 findings, 6 absorbed, 9 rejected

| # | Sev | Finding | Verdict | Evidence / action |
|---|---|---|---|---|
| **A1** | P1 | The plan does not call out that the ledger is member-aggregated today, so an implementer could "agree with the plan" and miss that the UI must be rewritten. | **REJECTED — already in the plan** | §1b is exactly that table, with `:421`, `:423`, `:430`, `:281` named, and §3 D10 says fee + checkbox on EVERY row. Nothing to add. |
| **A2** | P1 | *"`planMembershipWrite` sets `paidStatus` from `feeOwed <= paid`"* — so a developer might recompute in some writers and not others. | **EVIDENCE FABRICATED, CONCERN ACCEPTED** | There is no `paid`/`amountPaid` field anywhere (`grep -c amountPaid` → 0 in both `functions/src/lib/memberRecord.ts` and `shared/memberRecord.ts`). `planMembershipWrite` writes `paidStatus` at `:123` (create, literal `'UNPAID'`) and `:192` (the K11 reset) and derives nothing. **But the underlying question is real and the plan did not answer it: WHICH writers own the derivation.** Absorbed as §3 D1a — a named canonical helper plus the exhaustive writer list. |
| **B1** | P1 | The §8 sweep misses `lib/multiEntry.ts`'s `ownerStateAfter` / `entryCountWrite`, and the atomicity requirement between a counter change and the derivation. | **PARTIALLY ACCEPTED** | `lib/multiEntry.ts` was already listed under `playableEntryCount` and (after the citation fix) under `entryCount`. `ownerStateAfter` was not named, and the atomicity requirement was implied rather than stated. Both absorbed into §8. |
| **B2** | P2 | The ledger totals stay gated on `r.first`. | **REJECTED — already in the plan** | §3 D10 bullet 4, including the rebuy carve-out that the finding does not mention. |
| **C1** | P1 | A concurrent delete and paid-toggle can interleave and leave the map, `feeOwed` and the counters inconsistent. | **ACCEPTED** | Real gap. `setPaidStatus`'s transaction reads `ownedEntriesQuery` (`setPaidStatus.ts:227`), so a delete of a matching document conflicts and one side retries — but the plan never said so, and never said what a paid mark for an already-deleted `entryId` must do. Absorbed as §3 D7a. |
| **C2** | P1 | Legacy records with absent fields are not normalized before the delete math. | **PARTIALLY ACCEPTED** | D7 already recounts from entry existence, which covers an absent `playableEntryCount`. It did NOT cover an absent `feeOwed` — recomputing would stamp a fee onto a record that never had one. Absorbed as a rule in §3 D7a. |
| **C3** | P1 | A delete must not reduce Survivor `rebuyOwed`, which is a member-level sum. | **ACCEPTED — the best finding of the round** | `rebuyOwed` is the sum across entries (parent plan D3) and `setPaidStatus.ts:124-200` settles it independently of base dues. The plan's delete section said nothing about it. Absorbed as §3 D7b, including the observation that D3 already makes a rebuy-bearing entry undeletable — stated rather than built for. |
| **C4** | P1 | The delete must invoke the same entry-fee cascade as `poolOps`. | **REJECTED as stated, INTERACTION ABSORBED** | The cascade (`poolOps.ts:674-688`) exists for a FEE CHANGE; invoking it from a delete would restamp every member in the pool over one entry. But there IS an interaction the plan missed: the cascade skips `rec.role === 'MANAGER' && (rec.feeOwed ?? 0) === 0` (`:680`), so a manager whose last entry is deleted becomes skippable again — which is correct, and now says so in §3 D7b. |
| **C5** | P1 | Refuse the delete when payout records already exist for the entry. | **ACCEPTED as a STATEMENT, not as new work** | Payout records are written by the scorer / `recordPoolPayouts`, both of which require a scored week, and D3 forbids deleting once any week is scored. Same treatment as D9's seasonHistory: stated in §3 D9 so nobody builds for an unreachable case, and flagged as work if D3 is ever relaxed. |
| **C6** | P2 | A `firestore.rules` update plus rule tests are needed. | **REJECTED ON EVIDENCE** | `firestore.rules:750` — entries are `allow write: if false`. `:766-770` — members allow update ONLY on `memberReportedPaid`/`memberReportedAt`, and `create, delete: if false`. Every write in this plan goes through a callable's admin credentials, so **no rules change is expected**. Absorbed as the opposite of what the finding asked: §3 D11 says a needed rules change is a STOP-and-ask-Kevin signal, the same posture Phase 1 took. |
| **D1** | P1 | The derived `paidStatus` can be wrong if based on a legacy member-level `amountPaid`. | **REJECTED — FABRICATED FIELD** | No `amountPaid` exists. Nothing derives `paidStatus` from an amount today, and this plan does not introduce one. |
| **D2** | P2 | The derivation is ambiguous for zero-entry and legacy members. | **REJECTED — already specified** | §3 D1 gives the `length > 0` guard (and R2 names the `[].every === true` trap by hand), plus the "liable, not exists" definition with the synthetic `uid` id for a joined-and-never-picked participant. The finding's suggested `NON_PARTICIPANT` role does not exist here — roles are `MANAGER`/`PARTICIPANT`. |
| **E1** | P1 | The per-entry payment map shape is under-specified (boolean map vs object-with-metadata). | **REJECTED as stated, SHARP EDGE ABSORBED** | §3 D1 already gives the exact TypeScript shape. But it raised something real that the shape alone does not settle: **presence in the map IS the paid signal**, there is no `paid: boolean`, and therefore un-marking must DELETE the key. Absorbed as §3 D1b, with the reason a boolean was rejected. |
| **E2** | P2 | The toggle contract must carry `entryId`, not just `uid`. | **REJECTED — already in the plan** | §3 D10 bullet 3, verbatim. |
| **E3** | P2 | Soft-delete (tombstone) vs hard-delete is not fixed; "never physically delete in financial domains". | **ACCEPTED** | The plan said "removes the entry doc" without ruling out the alternative, and the alternative is a legitimate design position that deserves an explicit rejection rather than silence. Absorbed as §3 D12, which chooses HARD delete and says why (a tombstone would have to be filtered by `resolveOwnedEntry`'s cap check, the standings fold, the reveal, the profile aggregate and the ledger — five readers, each a place to forget), and names `admin_audit` + the ledger line as the durable record. |

**Score: 6 absorbed (A2-concern, B1, C1, C2, C3, C5, C6-inverted, E1-edge, E3 — nine
changes across six findings), 9 rejected.** Three rejections were fabricated
evidence (A2's derivation, D1's `amountPaid`, D2's `NON_PARTICIPANT`); four were
things the plan already said (A1, B2, D2, E2); two were correct concerns with the
wrong prescription (C4, E1).

---

## Round 2 — 3 findings, 1 absorbed, 2 rejected; D1b / D11 / D12 clean

Scoped to the text written to close round 1 (§2c: "the code most likely to be
wrong is the code written last, to close somebody else's finding").

| # | Sev | Finding | Verdict | Evidence / action |
|---|---|---|---|---|
| **1** | Med | D1a's writer list is incomplete: it misses `reconcilePaymentTruth.ts` and `setMemberPaidStatus(...)` in `functions/src/lib/memberRecord.ts`. | **REJECTED — half already listed, half fabricated** | `reconcilePaymentTruth` is writer **#5** in D1a's table, flagged as "the one that will be missed". `setMemberPaidStatus` **does not exist**: `grep -rn setMemberPaidStatus functions/src src shared` → 0 hits, and the file's exports are `planMembershipWrite`, `isProvableMember`, `membersCol`, `ensureMemberRecord`, `voidMemberRecord`, `reconcileMembership`, `memberRecordExists`, `ROSTER_SCHEMA_VERSION`. |
| **2** | High | D7a's "the query read set makes a concurrent delete conflict" is overstated — Firestore conflicts on documents actually read/written. | **ACCEPTED — the best finding of the round** | The claim rested on QUERY read-set semantics, which is a subtler guarantee than a document read and not something a money path should bet on. D7a rewritten to lead with the guarantee that actually holds: **both transactions touch `pools/{poolId}/members/{uid}`** — `setPaidStatus` reads it at `setPaidStatus.ts:217` and writes it at `:240`/`:252`; the delete reads and writes it to recompute `feeOwed`, the roster map and `paidEntries`. One shared document, no query semantics required. |
| **3** | Med | D7b's "a deletable entry always has `rebuysUsed: 0`" is too strong and is not enforced. | **REJECTED — the code enforces it, and now the plan cites the line** | `functions/src/nflPools.ts:1006`: `executeSurvivorRebuyInternal` throws `NOT_ELIMINATED: Player is still alive.` unless `entry.status === 'ELIMINATED'`. `status` becomes `ELIMINATED` only in a scoring pass (`nflScoringEngine.ts:356`); `poolExceptions.ts:410` only READS it to refuse a proxy pick. So a rebuy requires a scored week and D3 makes the entry undeletable. The finding's evidence cited a delete path in `lib/multiEntry.ts` that does not exist — no code has been written. The prose argument was replaced with the `nflPools.ts:1006` citation, which is what the finding should have produced. |

**D1b, D11 and D12 returned CLEAN** on their specific questions — including
Firestore's handling of a `:`-bearing map key, and whether any reader requires a
tombstone.

---

## Round 3 — 3 of 4 questions CLEAN, 1 finding rejected on its premise

Scoped to D7a and D7b as rewritten by round 2.

| # | Verdict | Detail |
|---|---|---|
| **1** | **CLEAN** | The `setPaidStatus` half of D7a's shared-document claim is true at `:217`, `:240`, `:252`. |
| **2** | **CLEAN** | No path through the authoritative-paid branch skips `members/{uid}`. |
| **3** | **CLEAN** | `nflPools.ts:1006` throws as D7b claims; no writer sets a Survivor entry `ELIMINATED` outside a scoring pass (`nflScoringEngine.ts:356` is the only one; `poolExceptions.ts:410` reads it). |
| **4** | **REJECTED ON ITS PREMISE, CLARIFICATION TAKEN** | It read the two `tx.set(mRef, …)` calls as independent conditionals; they are the two arms of one `if (isPaid) … else …`, so a write always runs. **But the instinct is right and was absorbed:** D7a now says the guarantee rests on the unconditional READ at `:217`, not on either write, so a future branch that skipped the write could not silently weaken it. |

---

## Round 4 — THE NORMAL REVIEWER, ON KEVIN'S MACHINE. 3 findings, 3 P1, **ALL THREE ACCEPTED**

🛑 **THIS IS THE ROUND THIS FILE ASKED FOR, AND IT WAS RIGHT TO ASK.** The caveat
above says *"re-run a round on Kevin's machine with the normal reviewer before
P2-T1 opens if that is available."* It was available (2026-08-26, `codex-cli
0.144.5`, CLI default model, no provider override). It found **three P1 defects
that three rounds of the substitute reviewer did not**, and one of them would
have sunk P2-T1 on its first line.

**Zero fabricated evidence this round.** Every citation was checked against the
file before absorbing; all three verified. Compare the substitute reviewer's four
fabricated findings across rounds 1–3. The calibration difference is the whole
point of the caveat, and it is now measured rather than suspected.

| # | Sev | Finding | Verdict | Evidence / action |
|---|---|---|---|---|
| **1** | P1 | `derivePaidStatus` is given only a `MemberRecord`, but liability is defined as *"the ids in `entries` whose entry has committed a pick"* — and `entries` carries no pick state. The helper cannot compute its own input. | **ACCEPTED — the finding of the round; P2-T1 was unimplementable as written** | Verified: `shared/memberRecord.ts` types `entries` as `Record<string, { entryIndex: number; name?: string }>`, and its doc comment says *"NEVER picks and never per-entry weeks"* — an AUTHORIZATION constraint (commissioner-blind picks), not an oversight. `playableEntryCount` is a count, not a set, so with entries 1 and 2 and one pick between them the liable id is unknowable from the record. **D1a rewritten**: two helpers, `liableEntryIds(m, uid, pickedEntryIds)` and `derivePaidStatus(m, liable)`, with the ids passed in from the caller's transactional read. |
| **2** | P1 | Retiring K11 leaves **no writer** to recompute the stored summary when an existing member adds a liable entry, so a fully-paid member can keep a stored `PAID`. | **ACCEPTED** | Verified: `data.paidStatus = 'UNPAID'` (`lib/memberRecord.ts:192`) sits inside the `paidReset` branch and is the ONLY assignment to `paidStatus` on `planMembershipWrite`'s UPDATE path — whose own comment says it "merge[s] identity/units only; preserve[s] paidStatus". Applied at `nflPools.ts:907`. **D1a row 2 changed from `DELETED` to `REPLACED`**; D6's "becomes UNPAID *by itself*" corrected (nothing derives on read — §0a fixes `paidStatus` as STORED); T3's scope and §9's gate both extended. |
| **3** | P1 | D7 decrements the pot *"only when the entry it removed was liable"*; D8 says `Math.max(0, current - 1)` with no such condition; §9's gate asserts all three counters "DROP" unconditionally. | **ACCEPTED** | Verified reachable: `picks: {}` is schema-legal on pick'em and persists an entry doc (`nflPools.ts:681`) with `committedPickForWeek` false (`:883-895`) — PLAN-EMPTY-SUBMISSION-FEE's whole subject. **D8 rewritten around ONE `liabilityDelta`** driving all three counters, zero for a non-liable entry; §9 gains the non-liable delete as its own case. |

### What I verified that the finding did NOT claim, and it strengthened #3

`entryCountWrite` emits `FieldValue.increment(delta)` when `entryCount` is
present (`lib/multiEntry.ts:191-192`) and **applies no clamp at all**. So D8's
own opening sentence — *"It needs no change to accept `-1`"* — is true of the
SIGNATURE and false of the BEHAVIOUR the rest of D8 requires: routing a negative
delta through that branch is exactly the unclamped path D8 then forbids. D8 now
says so explicitly rather than leaving two sentences for whoever writes T4 to
reconcile.

### And a free one from `ownerStateAfter` — finding #1 costs no extra read

`ownerStateAfter` ALREADY tests `entryHasPick(e.data)` per owned entry
(`lib/multiEntry.ts:172`) and discards which ids matched, returning only the
count and a pick-free map. So the ids finding #1 needs are computed today and
thrown away. T1 has it return them as a third, **transaction-local** field —
never written to the Member Record, which is what keeps the authorization
contract intact. No writer gains a read.

### The alternative fix, REJECTED on authorization

"Store a per-entry `liable` flag on the record" is the obvious repair for #1, and
it is the **forbidden bit**: liability IS "this entry has committed a pick", so
early in a season, when only week 1 exists and is unrevealed,
`entries[id].liable` and "entry `id` picked week 1" are the same statement. It
would put the commissioner-blind-picks payload onto a participant-readable
document. Recorded in D1a as a STOP-and-ask-Kevin signal, same posture as D11.

---

## Housekeeping — a stale block removed, and it had already misled someone

This file carried **`## Round 2` — "⛔ NOT YET RUN"** immediately above an actual
Round 2 and an actual Round 3. Two contradictory claims in one document, and the
overnight brief acted on the wrong one (*"review round 2 on the PLAN DOCUMENT
itself … the log marks round 2 as owed"*). Rounds 2 and 3 had in fact run — in
the cloud container, on the substitute reviewer.

The block is deleted. The reviewer-provenance caveat at the top of this file is
**not** deleted: that part was true, it is the reason those rounds are weak
evidence, and it is exactly what round 4 has now acted on.

---

## Stopping

**PENDING ROUND 5.** Round 4's three findings are absorbed above. The text
written to close them has not been reviewed by anything yet, and CLAUDE.md §2c is
explicit that new text written to close a finding earns its own round — *"the
code most likely to be wrong is the code written last, to close somebody else's
finding."* This section is replaced when round 5 runs.
