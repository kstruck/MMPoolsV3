# PLAN-COMMISSIONER-TRANSFER — adversarial review log

Act 1 (grill-with-docs) ran 2026-08-16 **without Kevin** — the questions it would
have asked him are the plan's §6, each with a recommendation. Act 2 is codex
(`codex exec -s read-only`, fresh session per round, `</dev/null` on stdin — the
`--json`/resume path hangs on this machine, memory `codex-exec-stdin-gotcha`).
MAX_ROUNDS=6 (paid runs; stop on the first APPROVED). PLAN_FILE=`PLAN-COMMISSIONER-TRANSFER.md`.
Every finding was checked against the code before it was absorbed or rejected;
the file:line in the "What changed" column is the plan section that moved.

## Round 1 — codex (10 findings) — VERDICT: REVISE

| # | Sev | Finding (in substance) | Verified? | Verdict | What changed |
|---|---|---|---|---|---|
| 1 | High | `firestore.rules` still lets a SUPER_ADMIN client change `ownerId`/`managerUid` directly, skipping confirmation, transaction, audit, indexes and emails; make the ownership fields immutable for every client branch | Yes — `firestore.rules:377-380`: `protectedFieldsUnchanged()` is inside the manager branch, `isSuperAdmin()` short-circuits it; `SuperAdmin.tsx` writes none of these fields (sweeps S5) | **ACCEPTED — the best finding of the round.** The plan had copied the co-commissioner acceptance without asking whether ownership is the same case; it is not — there is exactly one legitimate mover after this plan | D1 rules paragraph rewritten; D8 now specifies `ownershipFieldsUnchanged()` OUTSIDE the SA disjunction (precedent `callableOnlySettingsUnchanged()`, `:331-350, 377`); T3 evidence gains "SA refused"; new K16; new R12 |
| 2 | High | `createdByUid` remains client-writable on update although it is the fallback principal on ownerless pools; add it to the lock and backfill legacy ownerless pools | Yes — `createdByUid` is in `PRIVILEGED_POOL_FIELDS` (`poolOps.ts:104`, create only) and NOT in `protectedFieldsUnchanged()` (`:121-199`); `isPoolOwnerOrManager` falls back to it (`poolOps.ts:45`) | **ACCEPTED** | D8's six-field list includes `createdByUid`; T5 census gains (b) pools with no `ownerId`, backfilled `ownerId ← createdByUid` via Admin SDK BEFORE T3 deploys; deploy shape updated; R12 |
| 3 | Medium | D4 rewrites only nested `paymentHandles`; legacy top-level `venmo/zelle/cashapp/paypal` still fill gaps in `readPaymentHandles`; use `writePaymentHandles()` and clear all shapes atomically | Yes — `shared/paymentHandles.ts:1-12` ("Squares pools + NFL pools store top-level"), `:53` ("legacy top-level fields fill gaps"), `writePaymentHandles` `:93-105` writes nested + legacy with `CLEAR` for absent | **ACCEPTED** | D4 rewritten to `readPaymentHandles`/`writePaymentHandles`; D1 write list; R4 enforcement column |
| 4 | High | R3 is false under the acknowledged `createCheckoutSession` gap — the former owner or anyone can start a checkout after transfer; owner-authorize checkout before shipping transfer, or stop promising future charges belong to the new owner | Yes — `stripe.ts:189-193` checks existence only; zero `permission-denied` in `stripe.ts`; UI paywall already commissioner-gated (`Grid.tsx:445`, `BillingGate.tsx:95`) | **ACCEPTED — both halves.** R3 copy no longer promises who will pay; the gate is closed in this plan | R3 rewritten; T2 gains the `createCheckoutSession` owner gate + emulator case; new K17; R11 marked absorbed; §10 line removed |
| 5 | Medium | The SUPER_ADMIN branch trusts only the JWT claim — a demoted admin with a stale token can transfer any pool; use `assertCallerRole` | Yes — `lib/assertRole.ts:18-40` requires claim AND live doc; the co-commissioner setter uses the bare claim (`coCommissioners.ts:44,54`) | **ACCEPTED** | D1 gate 1: SA path via `assertCallerRole(request, 'SUPER_ADMIN')` |
| 6 | Medium | Rejecting only `newOwnerUid === actor` lets a SUPER_ADMIN retry "transfer" a pool to its existing owner and duplicate audit/activity/email rows | Yes — the D1 text said `!== actor` | **ACCEPTED** | D1: `newOwnerUid !== pool.ownerId` (covers the owner path too); idempotent retry explicitly not a v1 requirement |
| 7 | Medium | The lifecycle gate permits `archived`, arbitrary `closedVia` and `isFinal` although other code treats them as retired; define an explicit allowed set and test every persisted terminal shape | Partly — `archived` is real (`dbService.ts:256-262` writes it; `poolInclusion.ts:36`, `reminders.ts:894` treat it as retired) and was missing. `closedVia`: the ONLY writer is `adminCloseUpdate` → `'ADMIN_CLOSE'` (`lifecycle.ts:59`), but `poolInclusion.ts:37` treats ANY value as retired, so the plan adopts the same. `isFinal`/`COMPLETED`: kept ALLOWED deliberately (payouts still to record — K12) | **ACCEPTED as an explicit refusal set** (`CANCELED`, `archived`, any `closedVia`); the `isFinal`/`COMPLETED` half is **REJECTED with reasoning** — a finalized pool is exactly where a departing commissioner leaves money unrecorded (CONTEXT.md §Season Finalization) | D1 lifecycle bullet rewritten with the measured writers and the shape-by-shape test list |
| 8 | Medium | The plan promises `admin_audit` evidence but `writeAdminAudit` deliberately swallows failures, so an admin transfer can commit without the record | Yes — `lib/adminAudit.ts:60-99` header: "Swallowing the failure is still right"; returns boolean | **ACCEPTED** | D1 write list + D6: `admin_audit` doc written with `tx.set` inside the transaction in the helper's field shape; the transfer cannot commit without it |
| 9 | Medium | Updating NFL participation indexes "only if the doc exists" leaves a canonical target with no `MANAGER` index when legacy indexes are missing; upsert from the pool's authoritative data | Yes — the D1 text said "only if the doc exists"; `poolCreation.ts:153-159` shows the doc shape | **ACCEPTED** | D1: `participations` upserted for both users from pool fields (`poolId, name, type, role`, `joinedAt` preserved or now); `managedPools` set/delete |
| 10 | Low | The plan calls the former owner an "ordinary member" while retaining their `MANAGER` Member Record role and zero join liability; fix the language or make the role/ledger change an explicit money operation | Yes — D5 keeps the role; `shared/memberRecord.ts:116` | **ACCEPTED as language** (the money operation stays K7 = unchanged, by design) | New term **Former Commissioner** in R1, R6, §9 CONTEXT entry; the confirmation copy now says the dues treatment is preserved |

10/10 accepted (one half-rejected with reasoning: `isFinal`/`COMPLETED` stay allowed). No outright rejections.

### Claude's response
Findings 1 and 4 are the ones that changed the plan's shape: the plan had
inherited two acceptances from PLAN-CO-COMMISSIONERS (SA-client bypass; the
adjacent checkout gap "named, not absorbed") without re-deriving them for
ownership, and codex showed both were wrong for this feature. Everything else
was precision in the transaction spec. Round 2 requested on the revised plan.

## Round 2 — codex (9 findings) — VERDICT: REVISE

Codex confirmed round 1's changes landed ("universal rules lock, `createdByUid`
lock/backfill, dual-shape handle update, audit/index writes, Former Commissioner
terminology"), then:

| # | Sev | Finding (in substance) | Verified? | Verdict | What changed |
|---|---|---|---|---|---|
| 1 | High | The new checkout ownership check (T2) is on the pre-read only; a former owner passes it, the transfer commits, then their checkout transaction reserves/charges the new owner's pool. Re-check ownership on `freshPool` inside the checkout transaction; race-test | Yes — `createCheckoutSession` runs a transaction that re-reads the pool (`stripe.ts:365-372`) for `pendingSessionId`/`active` — the natural place for the re-check | **ACCEPTED** | T2 spec: check on the pre-read AND on `freshPool` in-txn; new emulator race case (exactly one of the two commits) |
| 2 | Medium | The transfer transaction does not re-check the actor's live ban / SA status; a concurrent ban or demotion after the pre-read can still commit | Yes — the D1 text had `assertNotBannedLive` outside only (the co-commissioner precedent) | **ACCEPTED** | D1 gate 2: `users/{actor}` read in-tx; BANNED re-checked; SA doc role re-checked |
| 3 | Medium | `previousOwnerId: actorOrOldOwner` is ambiguous on SA transfers and ownerless legacy pools — the wrong user's index/activity/aggregate/email effects | Yes — the D1 pseudo-write said `actorOrOldOwner` | **ACCEPTED** | D1: `oldOwnerUid = pool.ownerId ?? pool.createdByUid` defined in-tx, refuse if neither; all former-owner effects key on it; `actorUid` recorded separately |
| 4 | Medium | Aggregate recompute is post-commit best-effort, contradicting "Hub stats correct after return"; enqueue durable tasks | Yes for the defect; the proposed fix (a queue) is heavier than needed — `onPoolRosterFieldsChange` (`rosterAggregate.ts:42-52`) is an at-least-once pool-doc trigger that already recomputes on watched-field changes | **ACCEPTED, with a simpler mechanism** | D1 step 4: `'ownerId'` joins `WATCHED_FIELDS`, and an ownerId change recomputes BOTH `ownerOf(before)` and `ownerOf(after)`; the in-call recompute stays as the fast path; T2 files + unit test |
| 5 | Medium | R8 promises both emails but `sendEmail` swallows queue failures; a committed transfer can produce neither. Write a transactional outbox, or weaken the promise | Yes — `reminders.ts:34-60` fail-open by design; the `mail` collection IS the async outbox already (Trigger Email extension) | **ACCEPTED as "weaken the promise"; the outbox half is REJECTED** — writing raw `mail` docs in the transaction would bypass the opt-out/unsubscribe/tally logic `sendEmail` exists for, and the record of truth is the audit + Activity rows the transaction already guarantees | R8 copy rewritten: emails are sent, the audit is the record whether or not they arrive |
| 6 | Medium | `pendingSessionId` blocks a transfer even after the 24h checkout TTL; T5(c) only reports stale markers | Yes — `stripe.ts:155` `PENDING_SESSION_TTL_MS`, `:371` applies it; the D1 text said "absent" | **ACCEPTED** | D1: refuse only when the marker is within the TTL, reusing the exported constant/predicate; expired markers ignored (the checkout path overwrites at `:416`, the release path deletes at `:791-797`); T5(c) downgraded to informational |
| 7 | Low | The UI cannot show the target's profile handles — `users/{uid}` is readable only by that user or an SA | Yes — `firestore.rules:639-640` | **ACCEPTED** | R4 copy: "whatever handles [Name] has saved — or none"; D7 step 2; the callable returns `paymentHandles: 'profile' \| 'cleared'` for the success toast |
| 8 | Medium | D1 rejects lowercase `archived` only; uppercase `ARCHIVED` is persisted and treated as retired elsewhere | Yes — `autoScoreDecisions.ts:22,75`, `backfill.ts:95`, `shared/editability.ts:43`, `types.ts:370` | **ACCEPTED** | D1: both casings; `TRANSFER_REFUSED_STATUSES` in `lib/lifecycle.ts` as the single home; emulator cases for both |
| 9 | Low | K12 (the row Kevin signs) said "everything except `CANCELED` and `ADMIN_CLOSE`" while D1 also refuses `archived` and any `closedVia` — the plan was not signed for its enforced behaviour | Yes — a doc-vs-doc mismatch introduced by round 1's edit to D1 | **ACCEPTED** | K12 rewritten to the exact enforced set |

9/9 accepted (two with a simpler/partial mechanism than proposed, both with reasoning). No outright rejections.

### Claude's response
Round 2 was, as the pattern predicts, defects in round 1's fixes: the checkout
gate I added in T2 had the same TOCTOU shape the transfer itself guards
against, and the K12 row drifted from the D1 text I had just rewritten. Both
are the kind of thing self-review does not catch. Round 3 requested.

## Round 3 — codex (7 findings) — VERDICT: REVISE

Codex confirmed rounds 1–2 landed ("universal rules lock, transactional checkout
recheck, live ban/SA rechecks, dual-shape handles, and aggregate repair"), then:

| # | Sev | Finding (in substance) | Verified? | Verdict | What changed |
|---|---|---|---|---|---|
| 1 | High | D1 rejects `newOwnerUid === pool.ownerId`, but on a legacy ownerless pool `pool.ownerId` is undefined while `oldOwnerUid` resolves to `createdByUid` — an SA can "transfer" it to its own creator and emit false records | Yes — a consequence of round 2's `oldOwnerUid` definition landing in one bullet and not the other | **ACCEPTED** | D1: reject `newOwnerUid === oldOwnerUid`; T1 gains the ownerless-SA case |
| 2 | High | The transaction filters only the new owner out of `coManagers`; a legacy/forged array naming the outgoing owner would leave them co-commissioner authority, contradicting §0's "no capability via any field" | Yes as a hole in the plan text; in practice #444 cleared every legacy array and the setter refuses adding the owner (`coCommissioners.ts:84-86`), so it is belt-and-braces — but the invariant is stated absolutely, so it must be enforced absolutely | **ACCEPTED** | D1 write list + R5: filter BOTH `newOwnerUid` and `oldOwnerUid`; T1 test |
| 3 | High | Target consent is absent — an owner can force any eligible member into commissioner, payment-handle and billing responsibility with notice only after the irreversible commit; use a pending/accept flow or explicit target confirmation | The mechanics are as described; whether it is a defect is a PRODUCT decision, and it is already K14 (recommended immediate) | **PARTIALLY ACCEPTED — escalated to Kevin, recommendation held.** The plan now states codex's HIGH rating in the K14 row itself, spells out the accept-flow design (`pendingOwnershipTransfer`, `respondToOwnershipTransfer`, owner-cancel, 72h expiry) so it can be signed in one line, and gives the reasoning for recommending against it (handles copy only what the target chose to save; hosting is charged only when they choose to buy; they can transfer on/back immediately). Not silently rejected — it is the one §6 row where the recommendation goes against the reviewer, and it says so | K14 rewritten |
| 4 | Medium | T2's checkout `\|\| SUPER_ADMIN` is underspecified and stale-token-vulnerable versus D1's `assertCallerRole` + in-txn re-check | Yes — T2 said `\|\| SUPER_ADMIN` bare; today the checkout path has NO admin exception (`stripe.ts:161-260`) | **ACCEPTED** | T2: `assertCallerRole(request,'SUPER_ADMIN')` on the pre-read and a live-role re-read in the reservation transaction; noted that this ADDS an admin path that does not exist today, for the audited support case only |
| 5 | Medium | `writePaymentHandles()` returns `CLEAR` as `null`; spreading it into `tx.update` stores `null` rather than deleting the legacy fields | Yes — `shared/paymentHandles.ts:77` `CLEAR = null`; `lib/poolUpdate.ts:57-71` maps CLEAR into a `clearLegacy` list for exactly this reason | **ACCEPTED** | D1 write list: every CLEAR → `FieldValue.delete()`, reusing `poolUpdate.ts`'s mapping; T1 test asserts the legacy fields are ABSENT, not null |
| 6 | Medium | D1 requires refusal of `archived`/`ARCHIVED`/any `closedVia`, but T1's evidence list only named `CANCELED`/`ADMIN_CLOSE` | Yes — T1 was not updated when D1 was | **ACCEPTED** | T1 evidence: every persisted shape listed, allowed and refused |
| 7 | Low | The write pseudocode still said `previousOwnerId: actorOrOldOwner` | Yes | **ACCEPTED** | `previousOwnerId: oldOwnerUid` |

7/7 addressed: 6 accepted, 1 partially accepted and escalated to Kevin (K14) with the recommendation held and the reasoning written down.

### Claude's response
Findings 1, 6 and 7 are round-2 fixes that landed in one place and not the
other — the same drift the review log's own header warns about. Finding 3 is a
product call, not a defect, and it now sits in the row Kevin signs with the
reviewer's severity attached. Round 4 requested.

## Round 4 — codex (4 findings) — VERDICT: REVISE

Codex confirmed rounds 1–3 landed, then:

| # | Sev | Finding (in substance) | Verified? | Verdict | What changed |
|---|---|---|---|---|---|
| 1 | High | T2's checkout re-check is anchored only to the paid reservation transaction (`stripe.ts:365`); the separate $0/free/credit activation transaction can still activate another user's pool after a stale pre-read | Yes — `createCheckoutSession` has TWO transactions: `:275` ($0 activation, coupon confirm + credit deduct) and `:364` (paid reservation); round 2's fix named only the second | **ACCEPTED — the best finding of the round** (a defect in a round-2 fix, again) | T2: ownership re-checked on a fresh in-txn pool read in BOTH transactions, SA live-role re-read in each; T2 evidence: refusal + race case per path |
| 2 | Medium | Transfer bypasses the one-active-free-pool policy; the plan observes it but specifies neither refusal nor grandfathering | Half — K6 already said "allow, stated", but not as a rule with a test | **ACCEPTED as "grandfather, explicitly"; the "normally refuse" half REJECTED with reasoning** — the limit is enforced at the target's next free checkout (`stripe.ts:229-242`) exactly as it is today; refusing in the transfer would need a query on the target's pools inside the txn and would strand a real hand-over over a $0 tier | K6 rewritten as an explicit tested rule (transfer succeeds; the target's next free checkout is refused), with the one-line alternative if Kevin prefers refusal |
| 3 | Medium | The capability is type-agnostic server-side but the only UI is NFL; K13 is unsigned, so the plan does not deliver the stated feature for four pool types | Yes as a scope statement; K13 is a decision row by design | **ACCEPTED as a scope clarification** — K13 now names the exact surfaces (`ManagerDashboard.tsx:823-870` Squares danger zone, `BracketPoolDashboard.tsx:159`, Props/Playoff) as a T7 that joins the client PR if Kevin signs "all"; nothing else in the plan changes either way | K13 rewritten |
| 4 | Low | `joinedAt: existing ?? now` needs `tx.get` of both participation docs before any write, or the join date is overwritten | Yes — Firestore forbids reads after writes; `memberRecord.ts:278-280` documents the same constraint | **ACCEPTED** | D1: explicit in-transaction read list (pool, `users/{actor}`, `users/{new}`, `members/{new}`, both `participations` docs) BEFORE writes |

4/4 addressed: 3 accepted, 1 accepted in half with the other half rejected with reasoning.

### Claude's response
The trajectory is the expected one — 10 → 9 → 7 → 4 findings, and round 4's
High is a hole in a round-2 fix, not in the original design. Nothing in this
round touched §3 or the transaction's core shape. Round 5 requested.

## Round 5 — codex (1 finding) — VERDICT: REVISE

Codex confirmed rounds 1–4 landed, then:

| # | Sev | Finding (in substance) | Verified? | Verdict | What changed |
|---|---|---|---|---|---|
| 1 | High | D1 rejects only `newOwnerUid === oldOwnerUid`, which covers owner callers but not a SUPER_ADMIN who is a canonical member — that SA can hand another owner's pool to themself, contradicting K3's "not the caller" | Yes — round 3's rewrite of that bullet replaced the `!== actor` clause with `!== oldOwnerUid` and dropped the actor check for the SA path | **ACCEPTED** | D1: `newOwnerUid !== actorUid` for every caller, in addition to `!== oldOwnerUid`; T1 gains the SA-self-target case |

1/1 accepted.

### Claude's response
One finding, and once more it is a defect in an earlier fix (round 3 tightened
one clause and loosened its neighbour). Round 6 requested — the last under the
cap; if it is not clean the plan stops with whatever it finds named.

## Round 6 — codex (1 finding) — VERDICT: REVISE

Codex confirmed rounds 1–5 landed, then:

| # | Sev | Finding (in substance) | Verified? | Verdict | What changed |
|---|---|---|---|---|---|
| 1 | High | D1 permits a transfer after an EXPIRED `pendingSessionId`, but `finalizePoolPayment` accepts any reservation without checking session status, the pool's current reservation id, or ownership — a delayed old-owner Stripe webhook can activate/charge the new owner's pool after transfer. Bind reservations to `ownershipRevision`, release expired reservations during transfer, make finalization require a matching live reservation | Yes — `stripe.ts:657-760`: the only guard is `billing.status === 'active'` (`:693-712`, the double-charge no-op + `monetization_alerts` + Sentry); nothing compares `metadata.reservationId` to `billing.pendingSessionId.reservationId` or reads the session's status | **HALF ABSORBED, HALF ESCALATED — cap reached.** (a) The transfer transaction now RELEASES an expired reservation (deletes the marker, marks the `checkoutSessions` doc released, same shape as `:791-797`) instead of ignoring it — absorbed into D1. (b) Making the webhook refuse a released/mismatched reservation is a change to the money path itself (no-op + alert + manual refund) — written as **K18** with a Yes recommendation and a T2c ticket, and named in the plan header as the open finding. `ownershipRevision` binding is NOT adopted: matching the live reservation id is the same guarantee with one fewer field on the Stripe metadata | D1 checkout bullet; K18; T2c; header + §8 |

1/1 addressed: half absorbed, half escalated as a signed row. **The plan carries this finding open.**

## Resolution — STOPPED WITH FINDINGS OPEN (cap of 6 reached; final round not clean)

6 rounds, 32 findings total: 27 accepted outright, 3 accepted with a simpler or
partial mechanism and the remainder rejected with reasoning (r2 #4 queue → the
existing trigger; r2 #5 outbox → weaken the promise; r4 #2 refuse → grandfather),
2 escalated to Kevin as signed rows with the reviewer's severity attached
(r3 #3 → K14 target consent; r6 #1 → K18 late-webhook race, half absorbed).
Trajectory: 10 → 9 → 7 → 4 → 1 → 1 — the round-1 findings reshaped the design
(SA-client bypass closed, `createdByUid` locked, checkout gap absorbed); rounds
2–6 were, every time, a defect in a previous round's fix (the checkout TOCTOU,
the second checkout transaction, the `!== actor` clause dropped, K12 drift).
Three separate times the plan text disagreed with itself between two sections
after an edit; the review caught each.

**Open at stop:** K18 (money half of r6 #1). Kevin decides it with the rest of
§6; the plan does not proceed to T1 until every K row is signed. If K18 = No,
the alternative in the row (refuse any `pendingSessionId`, expired or not) closes
the same race more bluntly and needs no webhook change.

Not converged: the last round was not clean, so this is a stop, not an approval,
and the header of the plan says so.
