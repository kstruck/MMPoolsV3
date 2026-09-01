# PLAN — commissioner transfer

> **STATUS: PLAN ONLY, AWAITING KEVIN'S SIGN-OFF ON §6. No code written.
> Classification: authorization → plan-gated.**
> This is an **AUTHORIZATION** change (`mmp-change-control` Rule 3 — it decides
> who may do what on a pool, and adds a `functions/src/index.ts` export), so this
> plan, the adversarial review log (`PLAN-COMMISSIONER-TRANSFER-REVIEW-LOG.md`) and
> the sweep pass (`PLAN-COMMISSIONER-TRANSFER-SWEEPS.md`) all come before
> implementation. It is money-adjacent too (Billing follows the pool; Entry Fees
> are paid to whoever the commissioner is), which is stated per row below rather
> than waved at.
>
> **Provenance:** Kevin, 2026-08-16, verbatim — *"Commissioner transfer. The
> COMMISSIONER (owner) — NOT a co-commissioner — can transfer commissioner status
> to another pool member when they can no longer manage the pool. Must have an
> explicit confirmation step spelling out the ramifications (they lose owner
> control, billing/Stripe hosting-fee ownership implications, co-commissioner
> grants, audit trail) before it happens. Authorization change → plan-gated."*
>
> Written 2026-08-16 without Kevin in the room, on `origin/main` @ `42906ecc`.
> Every question the grill would have asked him is in §6 with a recommendation;
> **nothing in §6 has been answered.** Codex Act 2 ran **6 rounds (the cap), all
> REVISE — the plan STOPPED WITH ONE FINDING OPEN**: round 6's late-webhook race
> is half-absorbed in D1 and the money half is **K18**, a signed row, not a
> silent carry. Rounds and per-finding verdicts are in the review log.
> Anything not measured in this tree is marked UNVERIFIED.

---

## 0. What Kevin asked for, and what that means precisely

*"Transfer commissioner status"* — the pool's **owner** hands the pool to another
**member**, who becomes the owner; the old owner stops being one. Four things
have to be true afterwards, at every layer that decides "is this uid the
commissioner":

1. the new owner has every owner capability (rules, callables, UI, Hub, billing);
2. the old owner has none of them — not via `ownerId`, not via `managerUid`, not
   via `createdByUid`, not via a leftover `coManagers` entry;
3. the transfer is recorded where the pool's history and both users' histories
   are kept;
4. nobody can do it except the owner (and, if K1 says so, a Super Admin), and
   only after an explicit, server-checked confirmation.

### 🛑 The single most important line in this document

**A transfer that moves only `ownerId` transfers nothing.** Every NFL pool is
created with `createdByUid: uid, ownerId: uid, managerUid: uid` — the same uid in
all three (`functions/src/nflPools.ts:145-147`); Bracket pools write `managerUid`
and `ownerId` (`functions/src/bracketPools.ts:79-80`). `managerUid` is a
co-equal principal everywhere: rules `delete` (`firestore.rules:89-93`),
`isPoolManager()` (`:114-118`), every inline subcollection read
(`managerUid == request.auth.uid` ×12), the functions helper
`isPoolOwnerOrManager` (`functions/src/poolOps.ts:43-47`) that every
commissioner callable and the co-commissioner setter sit behind, and the client's
`isPoolOwner` (`src/utils/auth.ts:21-24`). And `createdByUid` still OUTRANKS
`ownerId` in three functions sites (`entitlements.ts:379`,
`lib/reminderTargets.ts:219`, `bracketEntries.ts:438`) and in the client's
NFLManagerView commissioner set (`NFLManagerView.tsx:297`).

So the transfer must move **`ownerId` AND `managerUid`** together, and this plan
must fix every `createdByUid`-first site so the creator does not remain a
phantom principal (D3). If a single one is missed, the "former" owner keeps a
capability, silently. The sweeps doc is the enumeration; T2's test pins it.

---

## 1. What is true today — measured, not remembered

Full file:line inventory in the sweeps doc, S1–S9. The shape:

**Table 1 — the four "who owns this pool" fields and who honours them**

| Field | `firestore.rules` | functions | client (`src/`) | client-writable? | written at create by |
|---|---|---|---|---|---|
| `ownerId` | 19 sites: `list` `:73`, `delete` `:90`, `isPoolManager()` `:115`, `isPoolParticipant()` `:363`, subcollections | canonical (`isPoolOwnerOrManager` `poolOps.ts:45`), `redeemCoupon` strict (`billing.ts:293`), Hub aggregate query (`commissionerAggregate.ts:25`), free-tier limit (`stripe.ts:233`) | `isPoolOwner` (`auth.ts:21`), Hub query (`dbService.ts:886`), roster badge (`poolRoster.ts:219-230`) | **frozen** (`protectedFieldsUnchanged` `:124`); SUPER_ADMIN client bypasses (`:379`) | every create path |
| `managerUid` | 18 sites, alongside `ownerId` everywhere | `isPoolOwnerOrManager` (or'd in), Bracket gates (`bracketOps.ts:34`, `bracketPools.ts:186`), Props (`propBets.ts:132`) | `isPoolOwner`, Hub query, SuperAdmin treats it as THE owner for Bracket (`SuperAdmin.tsx:1443, 3297, 3733`) | **frozen** (`:124`) | NFL (`nflPools.ts:147`), Bracket (`bracketPools.ts:79`), Squares (`constants.ts:92` client shape) |
| `createdByUid` | **0 sites** | fallback when `ownerId` absent (`poolOps.ts:45`), but **first** in `entitlements.ts:379`, `reminderTargets.ts:219`, `bracketEntries.ts:438`, `nflPools.ts:366`; `commissionerAggregate.ownerOf` `:46` second | `NFLManagerView.tsx:297` (first), Operations census copy | frozen only via `PRIVILEGED_POOL_FIELDS` on create (`poolOps.ts:104`); **not** in `protectedFieldsUnchanged` — but nothing client-side writes it | NFL, generic `createPool` (`poolOps.ts:358`) |
| `coManagers` | `isNFLCoManagerOf` `:102-107`, `list` `:83-84` | `isPoolCommissioner` (`poolOps.ts:65-70`) | `isNamedNFLCoCommissioner` | **frozen**, callable-only (`setPoolCoCommissioner`) | never (roster-time grant) |

⚠️ `ownerUid` (95 functions hits, 162 client hits, rules `:512`) is the **entry
document's** owner (multi-entry `e{n}:{uid}` — PLAN-MULTI-ENTRY) and the Member
Record's uid — it is **not** the pool owner and this plan does not touch it.
Named here so nobody greps it into the sweep.

**Table 2 — every owner-keyed thing that changes meaning when the owner changes**

| # | Surface | Keyed on | Where | Moves with `ownerId`+`managerUid` automatically? |
|---|---|---|---|---|
| S-a | Commissioner tab / `NFLManagerView`, Bracket/Squares/Props dashboards | `isPoolOwner` / `isPoolManager` / `isNFLPoolCommissioner` | `PoolRoute.tsx:115`, `AdminRoute.tsx:79`, `Grid.tsx:445` | ✅ live snapshot |
| S-b | Commissioner Hub feed + "Commissioner Hub" tab | `or(ownerId==uid, managerUid==uid)` realtime query | `dbService.ts:886`, `ParticipantDashboard.tsx:145,517,549` | ✅ realtime |
| S-c | Commissioner Aggregate Stats (`users/{uid}.commissionerAggregate`) | `where('ownerId','==',uid)` at recompute; recompute is triggered by Member Record writes | `lib/commissionerAggregate.ts:25,37,46` | ❌ **not until the next roster write** on one of each user's pools — the callable must recompute BOTH uids |
| S-d | Every commissioner callable (`assertPoolOwnerOrSuperAdmin`, `assertPoolOwnerOrManagerNoCo`, `setPoolCoCommissioner`, `setPaidStatus`, `getPoolPicks` COMMISSIONER branch) | `isPoolOwnerOrManager` / `isPoolCommissioner` | `poolOps.ts:43-92`, `coCommissioners.ts:54,68`, `setPaidStatus.ts:111`, `nflPickReveal.ts:166` | ✅ (they read the doc per call) — **except** the `createdByUid`-first sites in Table 1 |
| S-e | Rules: pool `update`/`delete`/`list`, 12 inline subcollection reads, `isPoolParticipant()` | `ownerId` ∨ `managerUid` | `firestore.rules:70-118, 360-368, 402-409, …` | ✅ |
| S-f | Billing: `redeemCoupon` (`ownerId` strict), `redeemCreditForPool` (`createdByUid` **first**), free-tier "1 active free pool" limit at checkout, trial/grace emails, `pool.billing.*` | `billing.ts:293`, `entitlements.ts:379-380, 400`, `stripe.ts:229-242`, `billing.ts:64-74, 399-402` | `pool.billing` is **pool-scoped** (status/tier/paid snapshot/pendingSessionId — `types.ts:685-709`); Stripe holds **no customer object** for the platform (`customer_email` from the caller's token only, `stripe.ts:466,535`); Bundles/credits are **user-scoped** (`bundles.ownerId`, `entitlements.ts:55,111`) | Billing follows the pool ✅; credits stay with the person ✅; `redeemCreditForPool` ❌ (creator outranks owner); free-tier limit ⚠️ can end with the NEW owner holding two active free pools (checked only at checkout) |
| S-g | Commissioner-personal fields ON the pool doc: `contactEmail` (billing/reminder/announcement/grid-full mail — `billing.ts:65`, `reminders.ts:322,514,571`, `announcements.ts:35`, `squares.ts:136-149`, `confirmPayment.ts:107`), `managerName`, `paymentHandles` (the P2P handles members are told to pay — CONTEXT.md §Payment Handle) | pool doc | wizards write them (client-writable) | ❌ **the pool keeps the OLD owner's email, name and Venmo/Zelle handles** unless the transfer rewrites them — members would keep paying the wrong person |
| S-h | Member Record `role: 'MANAGER'` for the owner; `memberLiableEntries` gives MANAGER **zero join liability** (`shared/memberRecord.ts:116`); default role at join derived from `pool.ownerId` (`nflPools.ts:806`, `poolExceptions.ts:511`) | `pools/{id}/members/{uid}.role` | money: `feeOwed = fee × max(joinLiability, played)` | ❌ — and flipping it MOVES DUES (D5) |
| S-i | `users/{uid}/managedPools/{poolId}` owner index (write-only today: `poolCreation.ts:144`, `backfill.ts:67`, `simHarness.ts:405`; **no reader in `src/`**), `users/{uid}/participations/{poolId}.role: 'MANAGER'` (NFL — `poolCreation.ts:153-159`; read only for `poolId` at `dbService.ts:550`) | per-user subcollections | — | ❌ index goes stale unless written |
| S-j | Pool audit (`pools/{id}/audit`, `writeAuditEvent` `audit.ts:21`), per-user Activity Log (`users/{uid}/activity`, exhaustive v1 list in CONTEXT.md), `admin_audit` (SUPER_ADMIN actor log, `lib/adminAudit.ts:66`) | — | — | ❌ nothing records a transfer today (no such op exists — measured: no `transferOwner|reassignOwner|setPoolOwner|newOwner` anywhere in `functions/src` or `src/`) |
| S-k | Reminder "commissioner" targets | `[createdByUid, ownerId, managerUid]` union (`reminderTargets.ts:219`) | — | ⚠️ the OLD owner keeps getting commissioner reminders via `createdByUid` (D3) |
| S-l | Referral credit on pool create (`referral.ts:22`), `Billing Charge` ledger `userId` = who paid (`stripe.ts` `finalizePoolPayment`), monetization admin views keyed on `pools.ownerId` (`UserMoneyProfile.tsx:42`) | historical | — | unaffected by design — history stays with who did it |

Three things fall out of Tables 1–2 that the plan has to reconcile rather than
paper over:

1. **`managerUid` is not "the manager", it is a second owner slot that equals
   the owner on every pool the product creates.** Transfer moves both (D2).
2. **`createdByUid` outranks `ownerId` in four functions sites and one client
   site.** PLAN-CO-COMMISSIONERS D3 already ruled `ownerId` canonical and
   `createdByUid` a functions-only fallback *when `ownerId` is absent*, but only
   `isPoolOwnerOrManager` was rewritten to that rule. Transfer is the first
   feature where the two actually diverge on real pools, so the rest get fixed
   now (D3, T2) — or the creator remains a principal on the pool they gave away.
3. **The pool doc carries the commissioner's personal contact/payment identity**
   (`contactEmail`, `managerName`, `paymentHandles`). Those are not
   authorization, but leaving them is a money-routing defect: the platform tells
   members to pay the Payment Handle on the pool (CONTEXT.md §Payment Handle),
   and Entry Fees are P2P — if the handle is the old owner's, members pay
   someone who no longer runs the pool (D4).

---

## 2. Goal

The pool's owner can hand the pool to a member. After the call returns, the
member is the owner at every layer (rules, callables, UI, Hub, aggregate stats,
billing paths, reminder targeting) and the previous owner is an ordinary member
at every layer; the pool's contact identity points at the new owner; the pool's
audit trail and both users' Activity Logs record it; and the operation is a
single server transaction that only the owner (or a Super Admin, K1) can invoke,
after a confirmation the server itself checks.

---

## 3. The ramifications table — 🛑 THIS IS WHAT THE CONFIRMATION SHOWS, AND WHAT KEVIN SIGNS

The confirmation step Kevin asked for is this table rendered in plain words. Each
row is a consequence the transfer has; the "How it is enforced" column is what the
callable does. Kevin edits the middle column; the mechanism in §4 does exactly
that.

| # | Ramification (what the old owner is told) | Recommended behaviour | How it is enforced |
|---|---|---|---|
| **R1** | *You will no longer be the commissioner. You lose the Commissioner tab, settings, scoring, payouts, invites, reminders, cancel/close/delete — everything. You stay on the roster as a former commissioner.* | Old owner becomes a **former commissioner** — a member with no commissioner capability whose Member Record and dues are left exactly as they were (R6, D5); **not** auto-named a co-commissioner (K4) | `ownerId` and `managerUid` both set to the new owner in one transaction (D2); old owner is not added to `coManagers` |
| **R2** | *[Name] becomes the commissioner with full control, including the ability to transfer the pool again — to anyone, including you — or to remove you as a member.* | Yes; **no undo**. The only way back is the new owner transferring back (K8) | Same callable, callable by whoever `ownerId` is at that time |
| **R3** | *This pool's hosting plan stays with the pool. Anything already paid stays paid and is not refunded or re-billed. From now on only [Name] can buy or upgrade hosting for this pool, apply coupons or credits to it — you will not be asked to, and you cannot.* | Billing follows the **pool**; credits/bundles follow the **person** (measured, S-f). If a Stripe checkout for this pool is currently open, the transfer is refused until it completes or expires (K6). ⚠️ The second sentence is only true once `createCheckoutSession` gates on ownership — today it checks that the pool **exists**, not who is paying (R11, codex r1 #4) — so T2 closes that gate in this plan (K17) | No Stripe object changes hands (there is none — S-f). Refuse when `billing.pendingSessionId` is set. `redeemCreditForPool` fixed to `ownerId` (D3) so the new owner CAN activate it and the old owner cannot; `createCheckoutSession` pool path gains `isPoolOwnerOrManager \|\| SUPER_ADMIN` (T2) |
| **R4** | *Members are currently told to pay [old handles]. After the transfer the pool will show whatever payment handles [Name] has saved on their profile — or none, until they add some. Money already sent to you is not tracked or moved by the platform.* (The modal cannot preview the new handles: `users/{uid}` is readable only by that user or a Super Admin, `firestore.rules:639-640` — codex r2 #7; the success toast reports which happened from the callable's response) | Replace `paymentHandles` with the new owner's profile handles, else clear; replace `contactEmail` with the new owner's account email; replace `managerName` (K5) | Written in the same transaction (D4) through `writePaymentHandles()` so BOTH the nested map and the legacy top-level `venmo/zelle/cashapp/paypal` fields move or clear together (codex r1 #3) |
| **R5** | *Your co-commissioners stay co-commissioners. If [Name] is one, they stop being one (they are the commissioner now). You will not be one.* | Keep `coManagers`; remove the new owner from it if present; remove the old owner too if a legacy/forged array names them (K4) | Transaction: `coManagers = before.filter(u => u !== newOwner && u !== oldOwner)`, `coManagersRevision + 1` if it changed; NFL only (the field exists nowhere else) |
| **R6** | *Nobody's dues change. You stay on the roster; what you owe or have paid does not move — you keep the commissioner's dues treatment you had (no entry fee unless you play), and [Name] keeps theirs.* | Member Record `role` fields **unchanged** for both users (D5, K7) — which is WHY the old owner is called a *former commissioner*, not an ordinary member: their roster record still says `MANAGER` and still owes nothing for joining (codex r1 #10) | Nothing written to `members/*` except the audit; `feeOwed` untouched |
| **R7** | *This is recorded permanently: on the pool's activity feed, on your account history and on [Name]'s.* | Pool audit event `OWNERSHIP_TRANSFERRED`; Activity Log `POOL_TRANSFERRED` for both users; `admin_audit` when a Super Admin does it (K9) | D6 |
| **R8** | *We will email you and [Name] a confirmation. Members are not emailed. The record of the transfer is the pool's activity feed and your account history, whether or not the email arrives.* | Two transactional emails, best-effort; no member broadcast in v1 (K10). The copy does not promise delivery — `sendEmail` swallows queue failures by design (`reminders.ts:34-60`), and the audit/Activity rows written IN the transaction are the record (codex r2 #5) | D6 |
| **R9** | *Type the pool name to confirm.* | Typed pool name, checked **on the server** too (K11) | Callable input `confirmName` must equal `pool.name` |

---

## 4. Key decisions and tradeoffs

### D1 — One callable, `transferPoolOwnership`, server-side, in a transaction

`transferPoolOwnership({ poolId, newOwnerUid, confirmName })`, in
`functions/src/poolOwnership.ts` (new), zod schema in
`functions/src/schemas/poolOwnership.ts` (`z.strictObject`, `newOwnerUid`
trimmed 1..128, `confirmName` trimmed 1..200), `validated({ appCheck: 'monitor'
})` exactly like `setPoolCoCommissioner` (`coCommissioners.ts:39-40`), export in
`functions/src/index.ts`, `dbService.transferPoolOwnership` wrapper.

**Gates, in order (mirroring `coCommissioners.ts:48-73`, which codex r1 on that
plan shaped):**

1. Pre-read the pool outside the transaction for the ownership gate only:
   `pool.ownerId === actor` — 🛑 **strict `ownerId`, NOT
   `isPoolOwnerOrManager`.** Kevin's brief says the owner, not a
   co-commissioner; a legacy distinct `managerUid` is a delegate, not the owner
   (K2). The SUPER_ADMIN path (K1) is admitted by
   **`assertCallerRole(request, 'SUPER_ADMIN')`** (`lib/assertRole.ts:18` —
   claim AND live `users/{uid}.role` must agree), not by the bare JWT claim the
   co-commissioner setter uses: a demoted admin with a stale token must not be
   able to move any pool (codex r1 #5). Then `assertNotBannedLive(actor)` (same
   placement as `recordPoolPayouts` / `setPoolCoCommissioner`).
2. `db.runTransaction`: re-read the pool and **re-check the gate on the exact
   version being written** (`coCommissioners.ts:63-70` — ownership can move
   between the pre-read and commit; two transfers racing must not both win).
   Also re-read **`users/{actor}`** inside the transaction and re-check
   `BANNED` (and, on the SA path, that the live doc role is still
   `SUPER_ADMIN`) — a ban or demotion that lands between the pre-read and the
   commit must not be able to move a pool (codex r2 #2). Define, in-transaction,
   **`oldOwnerUid = pool.ownerId ?? pool.createdByUid`** and refuse
   `failed-precondition` ("This pool has no owner on record — contact
   support.") if neither exists; every former-owner effect (index delete,
   Activity Log, aggregate, email, `previousOwnerId`) uses `oldOwnerUid`, and
   the actor is recorded separately as `actorUid` — on the SA path they differ
   (codex r2 #3). Then:
   - `confirmName === pool.name` (trimmed, exact) else `failed-precondition`
     ("Type the pool name exactly to confirm.") — R9.
   - `newOwnerUid !== oldOwnerUid` (the resolved value above — NOT
     `pool.ownerId`, which is undefined on a legacy ownerless pool where an SA
     could otherwise "transfer" it to its own creator; codex r3 #1) — else
     `failed-precondition`: a SUPER_ADMIN retry, or an owner double-submit,
     must not "transfer" a pool to its current owner and emit a second set of
     audit/activity/email rows (codex r1 #6). **AND `newOwnerUid !== actorUid`
     for EVERY caller** — on the owner path the two checks coincide; on the SA
     path they do not, and a Super Admin who is a canonical member of someone
     else's pool must not be able to hand it to themself (K3 says "not the
     caller"; codex r5 #1). Support transfers go to a member, never to the
     admin doing them. Retries that need
     to succeed idempotently are not a v1 requirement: the transaction is
     all-or-nothing and the client shows the failure.
   - lifecycle — an **explicit refusal set, tested shape by shape**, not "not
     terminal" (codex r1 #7): refuse when `status === 'CANCELED'`, when
     `status` is `'archived'` **or `'ARCHIVED'`** — both casings are persisted
     (lower: the client `archivePool` shape, `dbService.ts:256-262`, honoured by
     `poolInclusion.ts:36`, `reminders.ts:894`; upper: `autoScoreDecisions.ts:22,75`,
     `backfill.ts:95`, `shared/editability.ts:43` — codex r2 #8), or when **any**
     `closedVia` is set (measured: the
     only writer is `adminCloseUpdate` → `'ADMIN_CLOSE'`, `lib/lifecycle.ts:59`;
     `poolInclusion.ts:37` already treats any value as retired — same rule
     here). **Allow** `COMPLETED`, `isFinal: true` and every open/live status —
     payouts may still need recording after finalization (CONTEXT.md §Season
     Finalization: "money always [waits on a human]") and a commissioner who is
     leaving is exactly who cannot record them — K12. The set lives in ONE
     place — `lib/lifecycle.ts` gains `TRANSFER_REFUSED_STATUSES = ['CANCELED',
     'archived', 'ARCHIVED']` next to `TERMINAL_STATUSES` — and the emulator test
     enumerates each persisted shape (`CANCELED`, `archived`, `ARCHIVED`,
     `closedVia`, `COMPLETED`, `isFinal`, `OPEN`, `LOCKED`, `LIVE`, `FINAL`).
   - no **live** checkout: refuse `failed-precondition` ("A hosting checkout is
     in progress for this pool — finish or abandon it first.") only when
     `billing.pendingSessionId.at` is within `PENDING_SESSION_TTL_MS`
     (`stripe.ts:155`, 24h — the SAME predicate `createCheckoutSession` uses at
     `:371`, exported and reused, never re-typed). An expired marker is **released
     by the transfer itself, in the transaction** — `billing.pendingSessionId`
     deleted and `checkoutSessions/{reservationId}` set
     `{status:'released', releasedAt, releasedBy:'ownership-transfer'}` (the
     same shape the release path writes at `:791-797`) — rather than merely
     ignored (codex r2 #6, tightened by r6 #1): otherwise a delayed
     `checkout.session.completed` webhook from the OLD owner's expired session
     could still activate the pool after it changed hands, because
     `finalizePoolPayment` (`:657-760`) guards only "already active" and never
     checks that the reservation is still the pool's live one. Releasing it
     here is half of that fix; the webhook half is **K18** — R3.
   - target read INSIDE the transaction: `users/{newOwnerUid}` exists and
     `normalizeRole(role) !== 'BANNED'` (a BANNED user must never become an
     owner — CONTEXT.md §Role); target holds a **canonical Member Record**
     (`isCanonicalMemberRecord`, the same evidence `setPoolCoCommissioner` and
     `getPoolPicks` accept) — K3. Not `participantIds`: that array is an
     authorization input the reveal plan deliberately stopped trusting.
3. Writes (one `tx.update` on the pool):
   ```
   ownerId: newOwnerUid, managerUid: newOwnerUid,
   previousOwnerId: oldOwnerUid, ownershipTransferredAt: now,
   ownershipRevision: (pool.ownershipRevision ?? 0) + 1,
   coManagers: before.filter(u => u !== newOwnerUid && u !== oldOwnerUid)  // NFL only, only if it changed;
                                                        // BOTH filtered — a leftover grant to the outgoing owner is exactly the
                                                        // "no capability via any field" invariant of §0 (codex r3 #2)
   coManagersRevision: +1                               // only if coManagers changed
   contactEmail: newOwner.email ?? FieldValue.delete(),
   managerName: newOwner.name/displayName ?? FieldValue.delete(),
   paymentHandles + legacy top-level: writePaymentHandles(newOwnerProfileHandles ?? null),
       with every CLEAR mapped to FieldValue.delete() — the same CLEAR→delete mapping
       lib/poolUpdate.ts:57-71 already does; a raw spread would store `null` (codex r3 #5)
   updatedAt: serverTimestamp()
   ```
   plus `users/{new}/managedPools/{poolId}` **set** and
   `users/{old}/managedPools/{poolId}` **delete**; `users/{new}/participations/
   {poolId}` **upserted** (`set` with `{poolId, name, type, role:'MANAGER',
   joinedAt: existing ?? now}`, merge) and `users/{old}/participations/{poolId}`
   `role: 'PARTICIPANT'` (merge, upsert likewise) — on NFL pools, from the
   pool's own authoritative fields, never "only if the doc exists": a canonical
   member on a pool whose legacy indexes were never written must end up with a
   correct index, not no index (codex r1 #9). ⚠️ Both `participations` docs
   are **`tx.get` BEFORE any write** (Firestore forbids reads after writes in a
   transaction — `memberRecord.ts:278-280` says so) so a valid existing
   `joinedAt` is preserved and never overwritten with `now` (codex r4 #4); the
   in-tx read list is therefore: pool, `users/{actor}`, `users/{new}`,
   `members/{new}`, `users/{new}/participations/{poolId}`,
   `users/{old}/participations/{poolId}` — then writes; the two Activity Log docs (D6);
   and, on the SUPER_ADMIN path, the `admin_audit` document **written with
   `tx.set` inside the transaction** in `writeAdminAudit`'s field shape
   (`lib/adminAudit.ts:66-99`) — that helper deliberately swallows write
   failures (its header says so), which is wrong for the one record that proves
   an admin moved someone's pool; in-transaction, the transfer cannot commit
   without it (codex r1 #8). `createdByUid` is **not** touched (D3).
4. After commit: `recomputeCommissionerAggregate(db, oldOwnerUid)` and
   `(db, newOwnerUid)` as the FAST path (logged on failure, same shape as
   `simHarness.ts:417-421`) — and the DURABLE path is the existing pool-doc
   trigger: **`onPoolRosterFieldsChange` (`rosterAggregate.ts:42-52`) adds
   `'ownerId'` to `WATCHED_FIELDS` and, when it changed, recomputes for BOTH
   `ownerOf(before)` and `ownerOf(after)`.** Firestore triggers are delivered
   at-least-once and retried, so a failed in-call recompute cannot leave the Hub
   stale indefinitely (codex r2 #4 — no new queue needed; the trigger IS the
   queue). Then two `sendEmail` calls with `context.transactional: true` (D6),
   best-effort. Return `{ success: true, ownerId, ownershipRevision,
   paymentHandles: 'profile' | 'cleared' }` so the UI can say which happened.

**Why a callable and not a client `updateDoc`:** `ownerId`/`managerUid` are
already frozen in `protectedFieldsUnchanged()` (`firestore.rules:124`), which is
the right lock — this plan keeps it and adds the new bookkeeping fields to it.
Nothing about the lock changes for a manager principal. ⚠️ As with every
protected field, the `isSuperAdmin()` branch of the `update` rule (`:379`)
bypasses `protectedFieldsUnchanged()`, so today a SUPER_ADMIN **client** can move
`ownerId` directly — with no confirmation, transaction, index maintenance, audit
or email. The co-commissioner plan accepted that for `coManagers`; codex r1 #1
argues ownership is different, and it is right: there is exactly ONE legitimate
way to move a pool after this plan, and it is the callable. So D8 puts the
ownership fields behind an **`ownershipFieldsUnchanged()` check OUTSIDE the
super-admin disjunction**, the same position and reasoning as
`callableOnlySettingsUnchanged()` (`firestore.rules:331-350, 377`): no client
principal, SUPER_ADMIN included, may write `ownerId`, `managerUid`,
`createdByUid`, `previousOwnerId`, `ownershipTransferredAt` or
`ownershipRevision`. Measured: no SUPER_ADMIN client surface writes any of them
(`SuperAdmin.tsx` reads `ownerId`/`managerUid` at 9 sites and writes none —
sweeps S5), so no repair path is lost; console and Admin SDK bypass rules by
nature and carry the invariant by convention, as that comment already says. K16.

**Why one transaction:** the two-owner window is the whole risk. Between "old
owner removed" and "new owner written" nobody could run the pool; between "new
owner written" and "old owner removed" two people could, and one of them could
transfer again. One `tx.update` on the pool doc has no window.

### D2 — 🛑 `managerUid` moves WITH `ownerId`; a legacy distinct `managerUid` is overwritten

Measured: every create path writes `managerUid` = the creator (Table 1). The
field is not "the manager"; it is the owner's second slot, honoured as a
co-equal principal in 18 rules sites and the functions/client helpers (§0). So:

- The callable writes `managerUid = newOwnerUid`. Not `FieldValue.delete()`:
  `SuperAdmin.tsx:1443, 3297, 3733` treat `managerUid` as THE owner for Bracket
  pools, `bracketPools.ts:186` gates publish on it alone, and several types
  declare it non-optional (`types.ts:614`, `nflPoolTypes.ts:67`) — deleting it
  would orphan Bracket pools in the admin UI and break `tsc` assumptions.
- A pool whose `managerUid` differs from `ownerId` **before** the transfer loses
  that manager. Census in T5 (expected 0 — creation writes both from one uid;
  the #444 census already reported `ownerMismatch: 0` for `createdByUid`). If
  non-zero, those pools are listed for Kevin, and the confirmation copy adds a
  row naming the manager who will be dropped (K2).

### D3 — `createdByUid` stays as history; every site that ranks it above `ownerId` is fixed

Ruling inherited from PLAN-CO-COMMISSIONERS D3: **`ownerId` is canonical;
`createdByUid` is a functions-only fallback used ONLY when `ownerId` is absent.**
Today that rule is implemented in exactly one helper (`poolOps.ts:43-47`). The
sites still ranking the creator first, all of which would keep the OLD owner as
a principal after a transfer:

| Site | Today | After (T2) |
|---|---|---|
| `functions/src/entitlements.ts:379-380` (`redeemCreditForPool` "You do not own this pool") | `createdByUid \|\| ownerId \|\| managerUid` | `isPoolOwnerOrManager(pool, ownerId)` — the new owner can redeem a credit on it; the old owner cannot |
| `functions/src/lib/reminderTargets.ts:219` (commissioner reminder recipients) | union of all three | `[ownerId ?? createdByUid, managerUid]` — the old owner stops getting commissioner reminders |
| `functions/src/bracketEntries.ts:438` (`isOwner` for entry ops) | `ownerId \|\| managerUid \|\| createdByUid \|\| …` (disjunction, creator admitted) | `isPoolOwnerOrManager` |
| `functions/src/nflPools.ts:366` (`assertNFLPickMembership`) | creator admitted as "owner or manager" | `isPoolOwnerOrManager` — ⚠️ the old owner is still a **member** (canonical record + `participantIds`), so their picks path is unaffected; this only stops a creator who LEFT the pool from submitting |
| `functions/src/lib/commissionerAggregate.ts:46` (`ownerOf`) | `ownerId \|\| createdByUid \|\| managerUid` | already ownerId-first — unchanged, listed for completeness |
| `src/components/NFLPoolDashboard/NFLManagerView.tsx:297` (commissioner uid set for roster display) | `[createdByUid, ownerId, managerUid]` | `[ownerId, managerUid]` — after transfer the old owner must not render as "Commissioner" |
| `functions/src/migrations/backfillMemberRecords.ts:56` | `ownerId \|\| createdByUid \|\| managerUid` | unchanged (ownerId-first, one-off) |

Why not overwrite `createdByUid` too? Because it is the answer to a different
question ("who created this") that the referral credit (`referral.ts:22`, create
time only) and the D3 census read, and because rewriting history to fix
authorization is the pattern this repo keeps paying for. The fix is to make the
one rule true everywhere and **pin it**: T2 adds a unit test in
`functions/src/__tests__/` that greps `functions/src` (non-test) for
`createdByUid ||` / `createdByUid ??` preceding `ownerId` on the same line and
expects zero — the same shape as `tests/nfl-surface-invariants.test.ts`'s
source-pinning.

### D4 — The pool's contact/payment identity is rewritten to the new owner (R4)

`contactEmail` is where billing trial/grace mail (`billing.ts:64-74`), lock and
unpaid-squares reminders (`reminders.ts:322, 514, 571`), announcements
(`announcements.ts:35`) and grid-full mail (`squares.ts:136-149`) go. Leaving it
means the **old** owner keeps receiving the pool's commissioner mail and the new
owner receives none. `paymentHandles` is what members are shown to pay Entry Fees
(CONTEXT.md §Payment Handle) — leaving it means members pay the old owner.

Recommendation (K5): in the same transaction, `contactEmail ← users/{new}.email`,
`managerName ← users/{new}` display name, and the payment handles ← the new
owner's profile handles read with `readPaymentHandles(users/{new})`
(`shared/paymentHandles.ts:56`) and written with **`writePaymentHandles()`**
(`:93`) — never a bare `paymentHandles:` assignment. Squares and NFL pools store
the **legacy top-level** `venmo/zelle/cashapp/paypal` fields as well as the
nested map, and `readPaymentHandles` lets the legacy fields fill gaps
(`shared/paymentHandles.ts:1-12, 53`), so replacing only the nested map would
leave the OLD owner's Venmo showing through wherever the new owner has no value
(codex r1 #3). When the new owner has no handles at all, every key is written
`CLEAR` (`:77`) so both shapes are emptied. The confirmation says so in words
(R4). The new owner can edit all of it afterwards exactly as today. Nothing here
is authorization; it is here because the confirmation must be honest about it
and because the callable is the only moment both users' data is in hand.

### D5 — Member Record `role` is NOT flipped; dues do not move (R6)

`memberLiableEntries` (`shared/memberRecord.ts:113-118`) gives `role: 'MANAGER'`
a join liability of 0 and everyone else 1. Flipping the old owner to
`PARTICIPANT` would make a commissioner who never played suddenly owe one Entry
Fee; flipping the new owner to `MANAGER` would forgive a fee they owe as a
player. Both are money changes hidden inside an authorization change. So: **no
Member Record write.** The roster's "Commissioner" badge is derived from
`pool.ownerId` (`src/utils/poolRoster.ts:219-230`), not from the record's role,
so it moves anyway. Consequence, stated: the old owner keeps a `MANAGER`-role
record with 0 join liability for the rest of the season, and the default-role
logic at join (`nflPools.ts:806`, `poolExceptions.ts:511`) is unaffected because
both users already have records. If Kevin wants dues to follow the role
(K7 = flip), that is a `reconcileMembership` write with a `MARKED_UNPAID`-style
ledger line, and it becomes a money ticket in this plan.

### D6 — Audit, activity, admin_audit, email — where each record lives

- **Pool audit** (`pools/{id}/audit`, `writeAuditEvent`): new `AuditEventType`
  `OWNERSHIP_TRANSFERRED` (`types.ts:257-286`), severity `WARNING` (it is the
  most consequential thing a commissioner can do short of cancel), payload
  `{ from, to, actorUid, actorRole: 'OWNER'|'SUPER_ADMIN', previousManagerUid,
  coManagersBefore, coManagersAfter, contactEmailChanged: boolean,
  paymentHandlesReplaced: 'profile'|'cleared'|'unchanged', ownershipRevision }`.
  Written after commit like `CO_COMMISSIONER_CHANGED` (`coCommissioners.ts:114`),
  or inside the transaction via the `existingTransaction` parameter
  (`audit.ts:21`) — T1 picks in-transaction so a committed transfer can never
  lack its audit row.
- **Activity Log** (`users/{uid}/activity`, server-only): new type
  `POOL_TRANSFERRED` with `{ poolId, poolName, poolType, direction: 'OUT'|'IN',
  counterpartyUid }` for **both** users, in the transaction. CONTEXT.md's list
  is "exhaustive for v1" — §9 proposes the addition.
- **`admin_audit`**: written **only** when the actor is a SUPER_ADMIN,
  consistent with the co-commissioner ruling that `admin_audit` is the
  SUPER_ADMIN actor log (PLAN-CO-COMMISSIONERS r2 #8). An owner's own transfer
  is not an admin action. ⚠️ Written **inside the transaction** with `tx.set`
  in `writeAdminAudit`'s document shape (`lib/adminAudit.ts:66-99`:
  `actorUid, actorEmail, action: 'transferPoolOwnership', targetType: 'pool',
  targetId, metadata, status, at`), NOT via the helper — the helper swallows
  write failures by design (its own header), which is acceptable for a
  scheduled sweep and not for the record that proves an admin moved a pool
  (codex r1 #8). If that write cannot commit, the transfer does not.
- **Email**: two `sendEmail` calls with `context: { transactional: true,
  poolId, reason: 'OWNERSHIP_TRANSFERRED' }` — to the new owner ("You are now
  the commissioner of X") and to the old owner (a receipt). Both after commit,
  best-effort, never inside the transaction. No member broadcast in v1 (K10) —
  the new owner has Announcements for that.

### D7 — Where the UI lives, and the confirmation shape

`NFLManagerView.tsx` next to the Cancel Pool block (`:1734`, the owner-only
danger zone), gated on **`pool.ownerId === user.id`** (or SUPER_ADMIN if K1) —
not `isPoolOwner` (admits `managerUid`) and not `isNFLPoolCommissioner` (admits
co-commissioners). The modal:

1. a member picker over the roster rows the view already has (`:1376-1444`),
   excluding the viewer and any row without a canonical record;
2. the §3 table as a checklist — one checkbox per ramification row, all required
   (R1–R8), with `[Name]` and the OLD handles filled in from data the client
   already holds (the pool doc); the new handles are described, not shown (R4);
3. a typed pool-name field (precedent: `ManagerDashboard.tsx:839-870`, the
   Squares delete modal), submitted as `confirmName` so the server checks it too;
4. one call to `dbService.transferPoolOwnership`; on success the view re-renders
   from the pool snapshot (the viewer is no longer `isManager` and `PoolRoute`
   drops them to the member view — no local optimistic state).

UI copy obeys `docs/UI-REVAMP-GUIDE.md`: no emoji, Lucide icons,
`font-display font-bold uppercase` labels. Squares/Bracket/Props/Playoff
dashboards do not get the control in v1 (K13); the callable is type-agnostic so
adding it there later is UI-only.

### D8 — Rules: ownership fields become callable-only for EVERY client principal

No principal set changes in `firestore.rules` (nobody gains or loses a read or
write by being who they are). What changes is WHICH FIELDS no client may write.
Diff in outline:

```
+      // Ownership is moved by exactly one path — the transferPoolOwnership
+      // callable (PLAN-COMMISSIONER-TRANSFER D1/D8). Applied OUTSIDE the
+      // super-admin disjunction below, like callableOnlySettingsUnchanged():
+      // a SUPER_ADMIN client write would skip the confirmation, the
+      // transaction, the index maintenance, the audit row and the emails.
+      // `createdByUid` joins because it is the fallback principal on a pool
+      // with no ownerId (poolOps.ts isPoolOwnerOrManager) and was never in
+      // protectedFieldsUnchanged() (codex r1 #2 on the plan). Nothing
+      // client-side writes any of these (sweeps S5). Console / Admin SDK
+      // bypass rules by nature and carry the invariant by convention.
+      function ownershipFieldsUnchanged() {
+        let changed = request.resource.data.diff(resource.data).affectedKeys();
+        return !changed.hasAny(['ownerId', 'managerUid', 'createdByUid',
+                                'previousOwnerId', 'ownershipTransferredAt', 'ownershipRevision']);
+      }
 …
-      allow update: if request.auth != null && callableOnlySettingsUnchanged() && (
+      allow update: if request.auth != null && callableOnlySettingsUnchanged() && ownershipFieldsUnchanged() && (
         (isPoolManager() && protectedFieldsUnchanged() && … && poolIsEditable())
         || isSuperAdmin()
       );
```

`'managerUid', 'ownerId'` stay in `protectedFieldsUnchanged()` too (harmless
redundancy for the manager branch, and it keeps the existing rules tests
byte-stable). `PRIVILEGED_POOL_FIELDS` (`poolOps.ts:100-113`) gains the three
new fields so a create payload cannot pre-seed them (`createdByUid`, `ownerId`,
`managerUid` are already there, `:104`).

⚠️ `tests/nfl-settings-lockdown.test.ts:233-240` pins that
`callableOnlySettingsUnchanged()` sits OUTSIDE the disjunction by slicing the
`allow update:` statement — adding a second `&& ownershipFieldsUnchanged()` on
that line must keep that assertion green (it checks presence/position of the
first call, not exclusivity); run it, do not edit it. New rules test
`poolOwnership.rules.test.mjs` (mirror `coManagers.rules.test.mjs`): **owner
AND SUPER_ADMIN clients are both refused** on each of the six fields; a
same-value resend passes for both; a wholesale wizard-style update that carries
the unchanged fields passes (same-value is not an affectedKey — the reasoning
already written at `firestore.rules:141-144`).

### D9 — Not a `managerUid` promotion, not a `coManagers` op, not an admin backfill

Rejected alternatives, one line each:
- *Set the new owner as `managerUid` and leave `ownerId`*: gives the new person
  most capabilities but leaves the old owner every one of them — the opposite of
  the ask.
- *Make the new owner a co-commissioner and let the old owner "step back"*:
  co-commissioners cannot cancel/close/delete/bill/name others by design
  (PLAN-CO-COMMISSIONERS C8–C10); the ask is a hand-over of ownership.
- *A SUPER_ADMIN Operations-tab action only*: Kevin's ask is self-service by the
  owner. SA use of the same callable is K1.
- *A two-step "invite → accept" hand-shake*: better consent model for the new
  owner, but a second state machine (pending transfer, expiry, decline) for a
  rare operation; v1 is owner-initiated, immediate, and emailed. Listed as K14
  in case Kevin wants the target to accept first.

---

## 5. Risks

| R | Risk | Mitigation |
|---|---|---|
| R1 | A missed `createdByUid`-first site keeps the old owner as a principal | Sweeps S3 is the complete list; T2's grep-pinned unit test fails CI if a new one appears |
| R2 | Two transfers race (owner → A and owner → B, or new owner transfers on before the old owner's second tab settles) | The transaction re-reads and re-checks `ownerId === actor` on the version it writes (`coCommissioners.ts:63-70` precedent); `ownershipRevision` in the audit makes the order forensically clear |
| R3 | The new owner is a co-commissioner and the transaction forgets to drop them, so they appear in `coManagers` AND as owner; a later `remove` by the new owner on themself would then be accepted | Transaction filters them out and bumps `coManagersRevision`; emulator test |
| R4 | The new owner already has an active free-tier pool → two active free pools after transfer (`stripe.ts:229-242` only checks at checkout) | **Accepted and stated in R3's copy** (K6). Alternative: refuse the transfer when both are `free_tier` + `active` — one extra query in the pre-read; Kevin's call |
| R5 | Commissioner Aggregate Stats for both users go stale until the next roster write | Explicit recompute for both uids after commit (S-c) |
| R6 | A SUPER_ADMIN client bypasses `protectedFieldsUnchanged()` and moves `ownerId` without the audit/side-effects | Accepted as for every protected field (D1); the SA path with the audit is the callable |
| R7 | The old owner's `contactEmail` was a shared pool inbox, not their personal address | R4 copy says the address will change and to what; the new owner can put the shared inbox back in settings |
| R8 | The old owner still receives commissioner reminders via `createdByUid` (`reminderTargets.ts:219`) after transfer | D3/T2 |
| R9 | The typed confirmation is bypassed by a hand-built callable call | Server checks `confirmName` (R9); it is not the security boundary — `ownerId === actor` is — but it stops a stale-tab misclick from a script |
| R10 | The target has left the pool between the picker render and the call | Canonical Member Record checked inside the transaction |
| R11 | Adjacent: `createCheckoutSession` (`stripe.ts:161-193`) verifies the pool **exists** but never that the caller **owns** it — measured: zero `permission-denied` in `stripe.ts`. Any signed-in user can start a hosting checkout for any pool, so R3's "only [Name] can buy hosting" would be false and the FORMER owner could keep paying for (and be ledgered against) a pool they no longer run | **Absorbed into T2 (K17)** — codex r1 #4 called the promise false. The UI already gates the paywall on the commissioner (`Grid.tsx:445`, `BillingGate.tsx:95`), so nothing legitimate loses a path |
| R12 | `ownershipFieldsUnchanged()` outside the disjunction (D8) also blocks a SUPER_ADMIN client from repairing a pool with no `ownerId` | T5(b) census before T3 deploys; any such pool is backfilled via Admin SDK first, and the callable itself does not require a pre-existing `ownerId` on the SA path (it requires one on the owner path by definition) |

---

## 6. 🛑 DECISIONS NEEDED FROM KEVIN — no code until these are answered

| # | Question | Recommendation |
|---|---|---|
| **K1** | Who may transfer: the owner only, or also a SUPER_ADMIN (support case: owner is unreachable)? | **Owner, and SUPER_ADMIN.** SA use goes through the SAME callable and is written to `admin_audit`; no separate Operations action in v1. |
| **K2** | On a legacy pool where `managerUid` ≠ `ownerId`, may the `managerUid` holder transfer, and does the transfer drop them? | **Only `ownerId` may transfer** (Kevin's brief: the owner, not a delegate). The transfer sets `managerUid` = new owner, **dropping** the legacy manager; census expected 0 (D2), listed if not. |
| **K3** | Eligible target: must hold a canonical Member Record? Must be a co-commissioner? Not BANNED? | **Any canonical member, not BANNED, not the caller.** Not required to be a co-commissioner (a Squares/Bracket pool has none). |
| **K4** | The old owner afterwards: ordinary member, or auto-named co-commissioner? Existing co-commissioners kept? | **Ordinary member; kept.** They said they cannot manage; the new owner can name them back in one click. |
| **K5** | Rewrite `contactEmail`, `managerName`, `paymentHandles` to the new owner (D4)? | **Yes** — email and name from `users/{new}`; handles from their profile, else cleared. The confirmation says so (R4). |
| **K6** | Billing: refuse the transfer while a checkout is open (`billing.pendingSessionId`)? Refuse when it would give the new owner a second active free-tier pool? | **Refuse while a LIVE checkout is open. Allow the second free pool — as an explicit, tested rule, not an oversight (codex r4 #2):** the transferred pool is *grandfathered*; the "1 active free pool" limit is enforced where it always was — at the target's NEXT free checkout (`stripe.ts:229-242`), which will then be refused until one of their free pools ends. Not enforced in the transfer transaction (that would need a query on the target's pools inside the txn and would strand a real hand-over over a $0 tier). T1 test: transfer of an active free pool to a target who already owns one SUCCEEDS; the target's next free checkout is refused. If Kevin prefers refusal, it is one query on the pre-read + one `failed-precondition` and a confirmation row. |
| **K7** | Member Record `role` (`MANAGER`/`PARTICIPANT`) — leave both unchanged (dues do not move) or flip (dues move)? | **Unchanged** (D5). Flipping is a money change; if wanted, it is its own ticket with a ledger line. |
| **K8** | Reversibility: no undo; the new owner may transfer back? Cooling-off period? | **No undo, transfer-back allowed, no cooling-off.** Two emails and two audit rows are the safety net. |
| **K9** | Audit: pool `OWNERSHIP_TRANSFERRED` (WARNING) + Activity `POOL_TRANSFERRED` on both users + `admin_audit` only for SA actors? | **Yes.** |
| **K10** | Emails: new owner + old owner only, or all members too? | **Both owners only.** Members via Announcements at the new owner's discretion. |
| **K11** | Confirmation: checklist of R1–R8 + typed pool name, server-verified? | **Yes** — checkboxes all required, `confirmName` checked in the transaction. |
| **K12** | Which statuses allow a transfer? | **Refuse `CANCELED`, `archived`/`ARCHIVED`, and any pool with `closedVia` set (today only `ADMIN_CLOSE` writes it). Allow everything else — `OPEN`/`LOCKED`/`LIVE`/`FINAL`, and `COMPLETED`/`isFinal` (payouts still to record).** The set is `TRANSFER_REFUSED_STATUSES` in `lib/lifecycle.ts` (D1). |
| **K13** | Scope of the UI in v1: NFL Commissioner tab only, or Squares/Bracket/Props/Playoff dashboards too? Kevin's brief is not NFL-specific; codex r4 #3 notes the feature is not delivered for four pool types until this is signed. | **NFL only in v1, other surfaces as T7 in the client PR if Kevin says "all"** — the callable is type-agnostic from day one, so T7 is UI-only: the Squares danger zone in `ManagerDashboard.tsx` (where the typed-name delete modal already lives, `:823-870`), `BracketPoolDashboard.tsx` (`isManager` at `:159`), and the Props/Playoff manager surfaces. Same modal component, same gate (`pool.ownerId === user.id`). Signing "all" adds T7 to the client PR; signing "NFL" leaves it as the next ticket. |
| **K14** | Immediate hand-over, or invite → accept by the target? ⚠️ **Codex rates the absence of target consent HIGH (r3 #3):** an owner can make any eligible member the commissioner — with the pool's contact mail, the payment-handle rewrite and the ability to be asked for hosting money — and the target's first notice is the post-commit email. | **Immediate in v1, with the mitigations already in the plan** — the target's handles are copied only if THEY saved some on their profile, hosting is only ever charged when THEY choose to buy, and they can transfer the pool on (or back) the moment they read the email. If Kevin agrees with codex, the accept-flow shape is: `pool.pendingOwnershipTransfer {to, by, at, expiresAt}` (server-owned, protected), a second callable `respondToOwnershipTransfer({poolId, accept})` gated on `to === actor`, owner-cancel, 72h expiry via the existing scheduled sweeps, and the transfer commit runs THIS plan's transaction unchanged on accept. That is roughly one more ticket (T1b) and one more §3 row; the rest of the plan does not change. **Kevin's call — this is the one row where I recommend against the reviewer.** |
| **K15** | Write ADR 0008 (ownership is a server-owned, audited hand-over; `managerUid` = owner's second slot; `createdByUid` = history only)? | **Yes**, one page, alongside 0007. |
| **K16** | Rules: make the six ownership fields callable-only for **every** client principal including SUPER_ADMIN (`ownershipFieldsUnchanged()` outside the disjunction, D8), or keep the SA-client bypass the co-commissioner plan accepted for `coManagers`? | **Callable-only for everyone.** No SA client surface writes them (measured); the console still can. Codex r1 #1. |
| **K17** | Close the adjacent `createCheckoutSession` gap (any signed-in user can start a hosting checkout for any pool — `stripe.ts:189-193`) inside this plan as T2, or leave it as a separately-planned fix? | **Inside this plan (T2).** R3's promise ("only [Name] can buy hosting for this pool") is false until it is closed, and it is a one-line `isPoolOwnerOrManager \|\| SUPER_ADMIN` gate on the pool-purchase path (bundle purchases untouched). Codex r1 #4. |
| **K18** | 🛑 **OPEN — codex r6 #1, cap reached, carried by this plan.** A delayed Stripe webhook for the OLD owner's checkout can still activate (and ledger a charge against) the pool after transfer, because `finalizePoolPayment` (`stripe.ts:657-760`) checks only "already active", not that `metadata.reservationId` is still the pool's live reservation. D1 now releases an expired reservation inside the transfer transaction (half the fix). Should the webhook path ALSO refuse to activate when the reservation's `checkoutSessions` doc is `released` (or the pool's `pendingSessionId.reservationId` no longer matches) — no-op + Sentry alert + **manual refund by Kevin**, the same treatment the double-charge guard gives at `:693-712`? | **Yes — as T2c in this plan**, because it is the only way R3's "anything already paid stays paid and is not re-billed" survives a late webhook: a released session that still gets paid is money taken for nothing, and it must surface as an alert with a refund, never as a silent activation of someone else's pool. It is a **money** change to the webhook path (`mmp-change-control` Rule 3) — which is why it is a signed row and not a quiet absorption. Alternative if Kevin says No: the transfer refuses while ANY `pendingSessionId` exists, expired or not (revert to round 1's stricter gate), accepting that a stale marker blocks a hand-over until the release sweep clears it. |

---

## 7. Implementation tickets (after §6 is signed)

| T | What | Files | Evidence required |
|---|---|---|---|
| **T1** | Callable `transferPoolOwnership` per D1 (strict-owner pre-read + `assertNotBannedLive`; transaction re-check; `confirmName`; status/checkout/target gates; single pool `update` incl. `managerUid`, contact identity (D4), `coManagers` filter; `managedPools`/`participations` writes; both Activity Log docs; in-tx `OWNERSHIP_TRANSFERRED` audit; post-commit aggregate recompute ×2 + 2 emails; `admin_audit` when SA); zod schema; `index.ts` export; `dbService` wrapper; `AuditEventType` + Activity type; pool types gain `previousOwnerId?`, `ownershipTransferredAt?`, `ownershipRevision?` in `src/types/*` and `functions/src/types.ts` | new `functions/src/poolOwnership.ts`, `functions/src/schemas/poolOwnership.ts`, `functions/src/index.ts`, `functions/src/types.ts`, `src/services/dbService.ts`, `src/types/*` | `functions/src/__tests__/poolOwnership.emulator.test.ts`: non-owner refused; `managerUid`-only holder refused (K2); co-commissioner refused; BANNED actor refused (pre-read AND a ban written between pre-read and commit); BANNED target refused; non-member target refused; self refused; **SA transfer to the resolved `oldOwnerUid` on an ownerless legacy pool refused** (codex r3 #1); **SA transfer to THEMSELF (SA holds a canonical Member Record on the pool) refused** (codex r5 #1); wrong `confirmName` refused; **lifecycle shape by shape: `CANCELED`, `archived`, `ARCHIVED`, `closedVia:'ADMIN_CLOSE'`, `closedVia:'anything-else'` refused; `COMPLETED`, `isFinal:true`, `OPEN`, `LOCKED`, `LIVE`, `FINAL` allowed** (codex r3 #6); live `pendingSessionId` refused, expired one ignored; success moves `ownerId`+`managerUid`, leaves `createdByUid`, filters BOTH the target and the old owner out of `coManagers` and bumps its revision only when it changed, rewrites/clears contact identity **with the legacy top-level handle fields DELETED (not null) when the new owner has none**, writes both `managedPools`/`participations` (including on a pool whose legacy indexes were never written), both Activity docs, the audit row; **two concurrent transfers → exactly one commits**; after transfer the OLD owner is refused on `setPoolCoCommissioner`, `cancelPool`, `redeemCoupon`, and the NEW owner is admitted on each; SA path writes `admin_audit`. Emails asserted via the `mail` collection in the emulator (precedent: `manualReminders.emulator.test.ts`) |
| **T2** | D3: `createdByUid`-first sites → `isPoolOwnerOrManager` / ownerId-first (`entitlements.ts:379`, `reminderTargets.ts:219`, `bracketEntries.ts:438`, `nflPools.ts:366`, `NFLManagerView.tsx:297`); grep-pinned invariant test; **K17: `createCheckoutSession` pool-purchase path gains an ownership gate — `isPoolOwnerOrManager(pool, uid)`, or SUPER_ADMIN via `assertCallerRole(request, 'SUPER_ADMIN')` (claim + live doc, the same guard D1 uses; the checkout path has no admin exception today, so this ADDS one only for the audited support case — codex r3 #4) — checked on the pre-read after the existence check (`stripe.ts:189-193`) AND re-checked on a fresh in-transaction read of the pool inside **BOTH** of that callable's transactions — the **$0 / free / credit activation transaction at `:275`** and the **paid reservation transaction at `:364-372`** (next to its `pendingSessionId` check); the SA path re-reads `users/{actor}` in each — because a former owner who passes the pre-read while a transfer commits would otherwise activate or reserve a checkout on the new owner's pool (codex r2 #1, r4 #1: the $0 path is a separate transaction and was missed); bundle path untouched**; **T2c (iff K18 = Yes): `finalizePoolPayment` treats a webhook whose `metadata.reservationId` names a `checkoutSessions` doc with `status:'released'` (or that no longer matches the pool's live `pendingSessionId`) as STALE — no activation, session marked `{status:'confirmed', stale:true}`, Sentry alert, `monetization_alerts`-style record for the manual refund, exactly the double-charge guard's shape at `stripe.ts:693-712`** | those five + `stripe.ts` + `rosterAggregate.ts` (D1 step 4: `ownerId` in `WATCHED_FIELDS`, both owners recomputed) + `lib/lifecycle.ts` (`TRANSFER_REFUSED_STATUSES`) + a new test in `functions/src/__tests__/` and `tests/` | the invariant test; `manualReminderTargets.test.ts` `it.each` updated deliberately (creator no longer a target unless `ownerId` absent) and green; `bannedOwnerPath.emulator.test.ts` green; **`buyflowWebhook.emulator.test.ts` green and new cases: a non-owner's `createCheckoutSession` for someone else's pool is `permission-denied` on BOTH the $0 path and the paid path, the owner's and a SUPER_ADMIN's succeed on each, and a checkout racing a transfer ends with exactly one of {checkout reserved/activated under the old owner (transfer refused on `pendingSessionId` / already `active`), transfer committed (checkout refused in-txn)} — one race case per path**; a `rosterAggregate` unit test that an `ownerId` change recomputes both uids |
| **T3** | D8: rules — `ownershipFieldsUnchanged()` (six fields) applied OUTSIDE the SA disjunction on `allow update`; `PRIVILEGED_POOL_FIELDS` gains the three new fields; `poolOwnership.rules.test.mjs` | `firestore.rules`, `poolOps.ts`, `functions/scripts/poolOwnership.rules.test.mjs` + `run-rules-tests.mjs` registration | rules test cases per D8 (owner refused, **SA refused**, same-value passes for both, wizard-style wholesale update passes); `tests/nfl-settings-lockdown.test.ts` untouched and green; `coManagers.rules.test.mjs` / `participantIds.rules.test.mjs` untouched and green |
| **T4** | D7 UI: danger-zone control + modal (picker, R1–R8 checklist, typed name) in `NFLManagerView.tsx`; `getUserMessage` copy for each `failed-precondition` | `NFLManagerView.tsx`, `src/utils/errorMessages.ts` | `tests/nfl-surface-invariants.test.ts` green (do not touch `NFLPoolDashboard.tsx`); `npx tsc -b`; a `co-commissioner-client.test.ts`-style unit test that the control renders only for `pool.ownerId === user.id` |
| **T5** | Census before deploy — read-only, three counts in the PR body, pools listed for Kevin if any is > 0: (a) `managerUid` ≠ `ownerId` (D2); (b) pools with **no `ownerId`** — the only pools where `createdByUid` is still a principal, and after T3 nobody can write `ownerId` from a client, so if any exist they need an Admin-SDK backfill `ownerId ← createdByUid` BEFORE T3 deploys (codex r1 #2); (c) pools with a `billing.pendingSessionId` older than `PENDING_SESSION_TTL_MS` — informational only, since D1 ignores expired markers (codex r2 #6) | read-only script (`mmp-diagnostics-and-tooling` census; extend the `clearLegacyCoManagers` dry-run shape, `poolOps.ts:852-885`) | three counts in the PR body |
| **T6** | Docs: CONTEXT.md entries (§9), Activity type list, ADR 0008 (K15), HANDOFF top box; pool Rules copy line "the commissioner may hand the pool to another member" | `CONTEXT.md`, `docs/adr/0008-*.md`, `HANDOFF.md`, `NFLPoolRules` | `docs-state-invariants` green |

**Deploy shape:** T5 census first (and the Admin-SDK `ownerId` backfill if
T5(b) > 0); then one functions deploy (T1 + T2); then rules (T3) — rules add
protection only, they never grant, so functions-before-rules is safe and there
is no inconsistent window (a client cannot legitimately write any of the six
fields before or after). Then Coolify for T4. **Every functions deploy is into a LIVE scorer** — T2
touches `nflPools.ts` (`assertNFLPickMembership`) and reminder targeting; say so
in the PR body. No scheduled job's gate changes.

**PR shape:** one PR for T1–T3 + T5 (server + rules + census), one for T4 + T6
(client + docs), stacked — the same split #446/#447 used, for the same reason
(Coolify is a separate deploy surface).

---

## 8. Gate status

- [x] Plan written (this file)
- [x] Adversarial review log — `PLAN-COMMISSIONER-TRANSFER-REVIEW-LOG.md` — **6 codex rounds, all REVISE (10 → 9 → 7 → 4 → 1 → 1 findings); STOPPED WITH ONE FINDING OPEN at the cap: round 6 #1 (late-webhook race), half-absorbed in D1, money half is K18**
- [x] Sweeps — `PLAN-COMMISSIONER-TRANSFER-SWEEPS.md`
- [ ] Kevin's sign-off on §6 (K1–K18; K14 and K18 carry the reviewer's HIGH severity — read those two rows first)
- [ ] Implementation (T1–T6, + T7 iff K13 = all)

---

## 9. Proposed CONTEXT.md additions (NOT applied — T6 applies them after sign-off)

**New glossary entry**

> ### Commissioner Transfer
> The hand-over of a Pool from its owner to another Member of that Pool. Only the
> owner (`ownerId`) — never a Co-Commissioner or a legacy `managerUid` delegate —
> or a Super Admin may perform it, through the `transferPoolOwnership` callable,
> in one transaction, after a confirmation that names the ramifications and is
> checked server-side. Afterwards the new owner holds `ownerId` AND `managerUid`
> (the owner's second slot — every create path writes both from one uid); the old
> owner becomes a **Former Commissioner** — a Member with no commissioner
> capability whose Member Record (including its `MANAGER` role and dues
> treatment) is left unchanged; `createdByUid` records who created the Pool and
> grants nothing when `ownerId` is present. No client principal — Super Admin
> included — may write the ownership fields; only the callable does. Billing follows the Pool; Pool Credits and Bundles follow the person.
> The Pool's contact email, manager name and Payment Handles are rewritten to the
> new owner's. Recorded as `OWNERSHIP_TRANSFERRED` on the Pool's audit trail and
> `POOL_TRANSFERRED` on both Users' Activity Logs (and in the Admin Audit Log when
> a Super Admin performs it). No undo; the new owner may transfer again. See
> `PLAN-COMMISSIONER-TRANSFER.md`.

**Edit to §Pool** — *"A Pool has one owner (`ownerId`), optionally a separate
manager (`managerUid`)"* → *"A Pool has one owner (`ownerId`; `managerUid` is
the owner's second slot and equals it on every Pool the product creates), …"*.

**Edit to §Activity Log** — add `POOL_TRANSFERRED — the User handed a Pool to
another Member, or received one (payload carries direction and counterparty;
written by transferPoolOwnership)`.

**Edit to §Commissioner** — append: *"Ownership of a Pool can be handed to
another Member (Commissioner Transfer)."*

---

## 10. What this plan does NOT do

- It does not change any rules principal set (no widening, no narrowing).
- It does not touch `coManagers` semantics beyond removing the new owner from it.
- It does not move Pool Credits, Bundles, Billing Charges or Stripe records —
  there is no per-commissioner Stripe object to move.
- It does not flip Member Record roles or move any dues (D5).
- It does not build the invite → accept flow (K14) or a cooling-off period.
- It does not change how Bundles, Coupons or Billing Charges are owned or shown.

---

## § Board memo (2026-08-16)

Simulated advisory board (`ask-the-board`, 6 seats + Chair, unanimous, medium confidence): **do not build this plan now** — no measured hand-over demand, review stopped with K18 open, and every functions deploy lands in a live scorer. Ship the K17 `createCheckoutSession` ownership gate NOW as its own small plan-gated PR, decoupled from this plan; re-open TRANSFER on the first hand-over the co-commissioner path cannot satisfy. §6 rows the board would overturn: **K14** → invite→accept (4 seats; codex's HIGH stands); **K17** → keep "yes", drop "inside this plan" (all seats); **K18** → do not ship T2c as written — majority takes the plan's own alternative (refuse on ANY `pendingSessionId`) and instruments first, minority says land the webhook guard before any callable ships; K1 → owner-only v1 (Willison alone). Full memo, split, experiment and framing audit: [BOARD-MEMO-2026-08-16-transfer-icons-help.md](docs/archive/BOARD-MEMO-2026-08-16-transfer-icons-help.md). Simulation, not approval — Kevin decides.
