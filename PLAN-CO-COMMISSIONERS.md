# PLAN — co-commissioners

> **STATUS: PLAN ONLY, AWAITING KEVIN'S SIGN-OFF ON §6. No code has been written.**
> This is an **AUTHORIZATION** change (`mmp-change-control` Rule 3), so this plan,
> the adversarial review log (`PLAN-CO-COMMISSIONERS-REVIEW-LOG.md`) and the sweep
> pass (`PLAN-CO-COMMISSIONERS-SWEEPS.md`) all come before implementation.
>
> **Provenance:** overnight brief 2026-08-14/15, item 2 — *"Co-commissioners. A
> `coManagers` field already exists and is referenced in `firestore.rules` and
> `assertPoolOwnerOrSuperAdmin`."* ⚠️ Half of that sentence is wrong and the
> plan starts by saying so (§1).
>
> Written overnight without Kevin in the room. Every question the grill would
> have asked him is in §6 with a recommendation; **nothing in §6 has been
> answered.** Codex Act 2 rounds are in the review log.

---

## 0. What Kevin asked for, and what that means precisely

*"Co-commissioners"* — a pool's commissioner names one or more other members who
can help run the pool. The brief's own guard rail is the important part:

> 🛑 `assertPickReader` deliberately EXCLUDES co-managers and its header says
> why. Whatever co-commissioners are allowed to do, **decide it explicitly per
> capability**; do not grant by swapping in a wider helper.

So this plan is a **capability table** (§3) with one row per thing a
commissioner can do, a Yes/No per row for a co-commissioner, and a mechanism
(§4) that grants exactly those rows and nothing else. Kevin's job in the
morning is to accept or edit the Yes/No column.

### 🛑 The single most important line in this document

**Today `coManagers` is a field the functions layer trusts and nothing else
knows about — and the client can write it.** It is absent from
`firestore.rules` entirely, absent from `shared/`, absent from every file in
`src/`, and it is *not* in `protectedFieldsUnchanged()`, so a pool's owner can
already `updateDoc({ coManagers: [anyUid] })` from the browser on a
`DRAFT`/`OPEN` pool and hand that uid `scoreNFLWeek`, `recordPoolPayouts`,
`updatePoolSettings`, `cancelPool`, `closePool`, `proxyPick`, `sendPoolInvites`
— every callable behind `assertPoolOwnerOrSuperAdmin` (§1, table 2). Nothing in
the product does this today, which is the only reason it has not mattered.

**Therefore the first ticket of this plan is a lock, not a feature:** put
`coManagers` in `protectedFieldsUnchanged()` and make the ONLY writer a callable
that the owner calls. Do that even if Kevin says No to every other row in §3 —
it is the same class of hole as `participantIds` was before #432's K9.

---

## 1. What is true today — measured, not remembered

Full file:line inventory in the sweeps doc, §S1–S4. The shape:

**Table 1 — the three "second commissioner" fields and who honours them**

| Field | `firestore.rules` | functions | client (`src/`) | client-writable? |
|---|---|---|---|---|
| `ownerId` | everywhere (`isPoolManager()` :87, 19 inline sites) | everywhere | `isPoolOwner` (`utils/auth.ts:21`) | **frozen** (`protectedFieldsUnchanged`) |
| `managerUid` | everywhere, alongside `ownerId` | most helpers | `isPoolOwner` | **frozen** |
| `coManagers` | **nowhere** | 3 gates (`poolOps.ts:32`, `scoreUpdates.ts:1322`, `simLegacy.ts:144`) | **nowhere** | ⚠️ **YES** — not in `protectedFieldsUnchanged()` |

So the brief's *"referenced in `firestore.rules`"* is false — verified by
`grep -n coManagers firestore.rules` returning nothing (sweeps S1). What IS
true is that `managerUid` is a fully-wired single co-commissioner slot that no
UI can set (frozen, and no callable writes it after creation).

**Table 2 — every commissioner capability and who it admits TODAY**

| Capability | Gate | owner | `managerUid` | uid in `coManagers` |
|---|---|---|---|---|
| Commissioner tab / `NFLManagerView` | `PoolRoute.tsx:106` `isPoolManager` = ownerId ∨ managerUid ∨ SUPER_ADMIN | ✅ | ✅ | ❌ |
| Pool doc `update` from client | rules `:328` `isPoolManager()` | ✅ (DRAFT/OPEN) | ✅ | ❌ |
| `updatePoolSettings` callable | `poolOps.ts:411-419` (managerUid short-circuit, else `assertPoolOwnerOrSuperAdmin`) | ✅ | ✅ | ✅ *(if also in `participantIds`)* |
| `scoreNFLWeek` | `nflPools.ts:1710` → `assertPoolOwnerOrSuperAdmin` | ✅ | ⚠️ only if no `createdByUid`/`ownerId` (helper picks ONE owner) | ✅ |
| `lockPool` | `poolParams.ts:27` → same | ✅ | ⚠️ same | ✅ |
| `extendWeekDeadline`, `proxyPick`, `cancelPool`, `closePool` | `poolExceptions.ts:56` → same | ✅ | ⚠️ | ✅ |
| `sendPoolInvites`, `sendManualReminder` | `invites.ts:73`, `manualReminders.ts:62` → same | ✅ | ⚠️ | ✅ |
| `recordPoolPayouts`, `toggleWinnerPaid` | `payoutRecords.ts:54`, `poolOps.ts:658` → same | ✅ | ⚠️ | ✅ |
| `setPaidStatus` (authoritative mark) | `setPaidStatus.ts:102-106` ownerId ∨ managerUid ∨ createdByUid ∨ SA | ✅ | ✅ | ❌ |
| `getPoolPicks` COMMISSIONER principal (live pre-lock counts, departed members) | `nflPickReveal.ts:158-160` ownerId ∨ managerUid | ✅ | ✅ | ❌ **by design** (header :93-98; pinned `blindPicks.emulator.test.ts:495-512`) |
| read `members/*`, `standings/*`, `payoutRecords/*`, `rosterSummary`, `consensus` | rules: participantIds ∨ ownerId ∨ managerUid ∨ SA | ✅ | ✅ | ✅ *as a participant* — already works |
| read `squarePrivate`, `audit`, `shareClicks`; write `announcements` | rules: ownerId ∨ managerUid ∨ SA only | ✅ | ✅ | ❌ |
| read `payoutRecordsPrivate/*` | rules: `resource.data.uid` ∨ ownerId ∨ managerUid ∨ SA | ✅ | ✅ | own only |
| `deletePool` (rules `:82`), `list` pools | ownerId ∨ managerUid ∨ SA | ✅ | ✅ | ❌ |
| Stripe checkout, `redeemCoupon`, credits/bundles | `billing.ts:293` `ownerId` strict; `stripe.ts:233` | ✅ | ❌ | ❌ |
| Commissioner Hub listing, Commissioner Aggregate Stats, reminder "commissioner" targets | queries on `ownerId`/`managerUid`/`createdByUid` | ✅ | ✅ | ❌ |

Three things fall out of Table 2 that the plan has to reconcile rather than
paper over (sweeps S5 has the file:line for each):

1. **`assertPoolOwnerOrSuperAdmin` admits `coManagers` but effectively drops
   `managerUid`** when `createdByUid`/`ownerId` is set (it resolves ONE owner
   with `||`). `updatePoolSettings` has a hand-rolled bypass for exactly that.
2. **Two `coManagers` shapes**: `poolOps.ts:32` requires `participantIds ∧
   coManagers`; `scoreUpdates.ts:1322` / `simLegacy.ts:144` require only
   `coManagers`.
3. **The rules layer knows only `managerUid`**, so a co-manager today gets the
   dangerous callables and none of the read surfaces or the UI. Backwards.

---

## 2. Goal

A commissioner can name co-commissioners from the pool's roster. A
co-commissioner gets exactly the capabilities in §3 marked Yes — visible in
the same Commissioner tab, enforced at the same three layers (rules, callables,
UI gate) — and nothing else. `coManagers` becomes **server-owned** (a callable
writes it; the client cannot), and there is **one** definition of "is this uid
a commissioner of this pool" per layer instead of the five in Table 2.

---

## 3. The capability table — 🛑 THIS IS WHAT KEVIN SIGNS

Recommendation column is mine. **Kevin edits the Yes/No; the mechanism in §4
then grants exactly that.** Rows are grouped by the blast radius they carry.

| # | Capability | Co-commissioner? | Why |
|---|---|---|---|
| **C1** | See the Commissioner tab (`NFLManagerView`), Commissioner Hub card for the pool | **Yes** | It is the whole point. |
| **C2** | Edit pool settings (`updatePoolSettings`; client `update` in DRAFT/OPEN) | **Yes** | Delegated pool-running. Same `nflSettingsWriteBlocked` / `callableOnlySettingsUnchanged` limits as the owner. |
| **C3** | Lock pool, extend a week deadline, proxy-pick for a member | **Yes** | Day-to-day operations; the reason someone wants help. |
| **C4** | Score a week (`scoreNFLWeek`) — a manual re-run of what `nflAutoScoreJob` does | **Yes** | Idempotent with the scorer; a co-commissioner correcting a stale week is the common case. |
| **C5** | Send invites, send manual reminders | **Yes** | Chasing people is the delegated job. |
| **C6** | 🛑 **Money**: mark a member paid (`setPaidStatus`), record payouts, toggle winner paid, read the private ledger | **Yes** *(Kevin's call — see K3)* | Chasing dues IS what a co-commissioner is usually for. But it lets someone other than the owner state who has paid the owner. If Kevin says No, C6 splits: read Yes, write No. |
| **C7** | 🛑 **Pre-lock completeness counts** in `getPoolPicks` ("14 of 16 Picks Set"), and departed members' entries | **Yes, ONLY IF `coManagers` becomes server-owned (T1)** | The header's objection (`nflPickReveal.ts:93-98`) was that `coManagers` was an unvetted, wider door. Once the owner sets it deliberately through a callable, a co-commissioner is a commissioner for the purpose CONTEXT.md §Pick Reveal names ("chasing missing picks is the Commissioner's job"). ⚠️ Changes a pinned emulator test deliberately (`blindPicks.emulator.test.ts:495-512`). |
| **C8** | Cancel pool, close pool, delete pool | **No** | Destructive and pool-ending; the owner's alone. |
| **C9** | Billing: Stripe checkout, coupons, credits, bundles, the paywall | **No** | `redeemCoupon` is `ownerId`-strict today for a reason: hosting fees are the owner's money (CONTEXT.md §Billing). Unchanged. |
| **C10** | Add / remove co-commissioners | **No** (owner only) | Delegation does not delegate itself. |
| **C11** | Read `squarePrivate` (Squares PII), `audit`, `shareClicks`; write `announcements` | **Yes** for announcements/audit/shareClicks; **Squares PII: Kevin's call** | Announcements are ops. Squares PII is personal data of members — default No unless Kevin wants Squares co-commissioners to see it. NFL pools have no `squarePrivate`, so it only matters for Squares. |
| **C12** | Count as a "commissioner" for reminder targeting and Commissioner Aggregate Stats | **No, v1** | Both are owner-keyed rollups; widening them is a separate, cheaper change once the concept exists. |
| **C13** | Non-NFL formats (Squares, Bracket, Playoff, Props) — their manager callables and simulation tools | **No, v1** | Co-commissioners ship for the three NFL types. Bracket/Props/Squares gates stay owner/`managerUid`; the sim tools narrow to strict owner (codex r2). |

---

## 4. Key decisions and tradeoffs

### D1 — Reuse `coManagers` (array of uids), do not invent a second field

`managerUid` is a scalar and frozen; promoting it to an array touches every one
of its 19 rules sites and its type in six files. `coManagers` is already the
name the functions layer uses. Reuse it, define it once, and retire the
"co-manager" prose in favour of **Co-Commissioner** in CONTEXT.md.

### D2 — 🛑 `coManagers` becomes SERVER-OWNED (T1) — this ticket ships regardless

- `firestore.rules`: add `'coManagers'` **and `'coManagersRevision'`** to
  `protectedFieldsUnchanged()`, and both to `PRIVILEGED_POOL_FIELDS` on create
  (codex r3 — a client-writable revision lets a current co-manager reset it
  after a remove and slip a stale add through).
- 🛑 **NFL-only, enforced, not implied** (codex r3): the setter refuses any
  pool whose `type` is not `NFL_PICKEM` / `NFL_SURVIVOR` / `NFL_MARGIN`; the
  functions helper's `coManagers` branch and the rules predicate both carry the
  same `type in [...]` guard, so a `coManagers` array on a Squares/Bracket/
  Props/Playoff pool grants nothing anywhere.
  ⚠️ That helper sits INSIDE the manager branch; the `isSuperAdmin()` branch
  bypasses it, so a SUPER_ADMIN client can still write `coManagers` directly —
  **stated and accepted**, exactly as `participantIds.rules.test.mjs` case 3
  asserts for that field. The rules test for this field pins the same shape.
- New callable `setPoolCoCommissioner({ poolId, uid, op: 'add' | 'remove',
  revision })` — **one uid per call, in a transaction; `revision` is REQUIRED
  for `add` in the zod schema, the `dbService` wrapper and the UI call, and
  `coManagersRevision?: number` joins `coManagers?: string[]` on both pool
  type systems** (codex r5 — D6's `{uid, op}` shorthand had dropped it). ⚠️ A transaction
  alone does not give revocation priority: an `add` that retries after a
  concurrent `remove` re-adds the uid (codex r2). So: the pool carries
  `coManagersRevision` (int, incremented by every successful call); **`add`
  must present the revision it saw** and fails `failed-precondition` ("roster
  changed — reload") if it has moved; **`remove` needs no revision and always
  wins.** Tested: add(rev 3) racing remove → remove commits, add is refused. Owner-only — a **strict** owner check, not the
  helper; then `assertNotBannedLive` (the same order `recordPoolPayouts` uses);
  every added uid must have a **canonical Member Record**
  (`isCanonicalMemberRecord`, the evidence `getPoolPicks` accepts); owner
  cannot add themself; cap (K5). Writes a typed pool audit event via the
  existing `writeAuditEvent` — new type `CO_COMMISSIONER_CHANGED` with
  `{op, uid, before, after, revision}` (codex r2 — not `admin_audit`, which is
  the SUPER_ADMIN actor log).
- Needs, and T1 lists: a zod schema in `functions/src/schemas/`, the
  `functions/src/index.ts` export, a `dbService` wrapper, `coManagers?:
  string[]` on the pool types in `src/types/*` and `functions/src/types.ts`
  (codex r1 — `src/utils/auth.ts` cannot read a field the type does not
  carry).
- `PRIVILEGED_POOL_FIELDS` already strips it on create — unchanged.
- 🛑 **Legacy values are NOT trusted, and the deploy ORDER is the control.**
  Three gates honour `coManagers` TODAY (`assertPoolOwnerOrSuperAdmin`,
  `simulateGameUpdate`, `simFillSquares`), and the field is client-writable, so
  "clear it before the widened gates read it" is not enough — the CURRENT gates
  already read it (codex r2). The order is therefore:
  **(1)** deploy functions that IGNORE `coManagers` everywhere (T2a — the three
  checks removed; the sim tools go no-co); **(2)** deploy the rules LOCK ONLY
  (`protectedFieldsUnchanged` gains the two fields — **no rule that READS
  `coManagers` ships in this step**, codex r4) and run the one-off, audited,
  resumable admin action that clears `coManagers` (and stamps
  `coManagersRevision: 0`) on every pool — expected 0 pools with a non-empty
  array, count in the PR body, and the scrub is VERIFIED complete (a census
  returns 0) before step 3 starts; **(3)** only then deploy the callable, the
  widened functions helper (T2b) AND every co-manager-reading rules predicate
  (T3). Between (1) and (3) nothing — functions or rules — trusts the field, so
  a forged array written during the window is inert and then erased.
- A member who **leaves** the pool is dropped from `coManagers`. ⚠️
  `reconcileMembership` today updates only `participantIds` and `members`, and
  its own header says caller wiring is deferred (codex r1) — so T1 adds
  `arrayRemove(uid)` on `coManagers` to **every** membership-removal path
  (sweeps S8 enumerates them), and the feature is not enabled in the UI until
  that list is wired and tested. A departed uid must never keep the callables.

### D3 — ONE definition per layer, and they must agree

| Layer | Today | After |
|---|---|---|
| rules | `isPoolManager()` = ownerId ∨ managerUid | `isPoolManager()` = ownerId ∨ managerUid ∨ `uid in coManagers` — **and the destructive blocks (C8/C10) get an explicit `isPoolOwnerOrManagerNoCo()` helper — ownerId ∨ managerUid, i.e. today's `delete` principal set at `:79-84`, minus `coManagers` — instead of inheriting the widened one** (codex r4: `managerUid` can delete today and is not revoked). ⚠️ `allow list` on `/pools` (`:70-77`) is inline and does NOT call `isPoolManager()` (codex r1) — it gains the co-manager predicate too, or the Hub query (D7) is denied |
| functions | 5 ad-hoc shapes (Table 2) | `isPoolCommissioner(pool, uid)` in `poolOps.ts` = createdByUid ∨ ownerId ∨ managerUid ∨ `coManagers.includes(uid)`; `assertPoolOwnerOrSuperAdmin` calls it; **the `participantIds ∧` conjunct goes** (D2 guarantees membership at write time, and reconcile keeps it). **A second helper, `assertPoolOwnerOrManagerNoCo`** (ownerId ∨ `managerUid` ∨ SUPER_ADMIN, `createdByUid` fallback only when `ownerId` is absent — i.e. TODAY's destructive principal set, minus `coManagers`) gates C8/C10 — `cancelPool`/`closePool` go through `loadPoolAndAssertManager` today and would otherwise be widened by the first helper (codex r1); it deliberately **keeps `managerUid`**, which rules `:82` and `closePool`'s own doc already admit for delete/close, so no legacy principal is silently revoked (codex r3). C9 (billing) stays `ownerId`-strict as today |
| client | `isPoolOwner` (`utils/auth.ts:21`) | **`isPoolOwner` / `isPoolManager` / `canManageEntries` stay strict** — Bracket and Playoff dashboards read them (codex r3). New `isNFLPoolCommissioner(user, pool)` = `isPoolManager(user, pool) \|\| (NFL type && coManagers.includes(uid))`, used ONLY where `PoolRoute.tsx:106` computes `isManager` for the three NFL dashboards; D6's owner-only toggle uses `isPoolOwner` (strict) |

**`createdByUid` (codex r1).** Functions honour it, rules and the client do
not, so a pool whose `createdByUid` differs from `ownerId` has a phantom
principal who can call callables but sees no Commissioner tab. Ruling for this
plan: **`ownerId` is canonical**; `createdByUid` is a functions-only fallback
kept for pools where `ownerId` is absent. A census counts pools where the two
disagree (expected 0 — pool creation writes both from the same uid); the
number goes in the T2 PR body and, if non-zero, those pools are listed for
Kevin rather than silently reinterpreted.

**Scope of the helper swap (codex r2).** The one-helper rule applies to the
NFL commissioner callables in Table 2 and to `setPaidStatus`. It does **NOT**
apply to: `squares.ts` `assertPoolManager` (`updatePlayer` writes member PII,
`releaseSquares` clears ownership/payment/PII — Squares PII is K7's "No");
`scoreUpdates.ts` `simulateGameUpdate` and `simLegacy.ts` `simFillSquares`
(simulation tools — they **narrow** to owner/`managerUid`/SUPER_ADMIN via the same no-co helper, which removes
a grant a forged array could reach today; C4 covers real scoring only); or the
Bracket/Props manager gates (`bracketPools.ts` publish, `bracketOps.ts` /
`bracketEntries.ts` payment + entry delete, `propBets.ts` grading — sweeps S9).
Co-commissioners are an **NFL** feature in v1 (§3 row C13); other formats keep
their owner/`managerUid` gates unchanged and are listed, not reinterpreted.

⚠️ This is where the plan **fixes** the `managerUid` drop in
`assertPoolOwnerOrSuperAdmin` (Table 2 note 1) as a side effect: the new helper
is a disjunction, not a precedence chain. `updatePoolSettings`' bypass
(`poolOps.ts:411-419`) becomes dead and is removed. **The banned-owner
emulator test (`bannedOwnerPath.emulator.test.ts`) must still pass** —
`assertNotBannedLive` is unchanged.

### D4 — Owner-only stays owner-only by NAME, not by omission

C8/C9/C10 must be gated on a helper that says *owner* (`isPoolOwnerStrict` in
functions; `isPoolOwner()` in rules), not on "the helper that happens not to
know about coManagers". Otherwise the next person who "fixes" a helper widens
them by accident — exactly the failure mode `assertPickReader`'s header warns
about, in reverse.

### D5 — C7 is a deliberate widening of the reveal principal, and it is Kevin's

If Kevin says Yes to C7: `assertPickReader` COMMISSIONER branch reads
`isPoolCommissioner`. The header comment is rewritten to say the door is now
deliberate and server-owned. The two pinned tests flip: `asCo.counts` becomes
`{[ALICE]: 2}` and the `managerUid` case stays. If No: nothing changes there
and the header gains a line saying Kevin ruled No on 2026-08-15.

### D6 — Where the UI lives

`NFLManagerView.tsx` members tab (`commishTab === 'members'`, `:1308`): a
per-row "Co-commissioner" toggle, owner-only, calling
`setPoolCoCommissioner({ uid, op })` for THAT ROW ONLY — never a full array
(codex r2: a full replacement reinstates the stale-tab race D2 closes). The
row re-renders from the pool snapshot, not from local optimistic state. A small
"Co-commissioner" badge next to the existing Owner badge (`:1365`). Nothing in
the wizard — co-commissioners are named from the roster, which does not exist
at creation.

### D7 — Commissioner Hub

`coManagers array-contains uid` is a single-field query; Firestore auto-indexes
it. The Hub is `ParticipantDashboard.tsx`, fed by `dbService.subscribeToPools`
and filtered by `ownerId || managerUid` in two places (tab visibility and
`managedPools`) — all three change, via `isNFLPoolCommissioner`, or the query
alone exposes nothing (codex r5). **Not** the aggregate stats (C12).

---

## 5. Risks

| R | Risk | Mitigation |
|---|---|---|
| R1 | Widening `isPoolManager()` in rules widens every site that calls it, including ones nobody re-read | Sweeps S1 lists every caller; **only** the pool `update` rule and `list` call it — the subcollections inline `ownerId/managerUid` and are re-decided row-by-row against §3 |
| R2 | The rules `update` branch lets a co-commissioner write pool fields the callable never would | Same `protectedFieldsUnchanged` / `callableOnlySettingsUnchanged` / `nflSettingsWriteBlocked` chain binds them; the co-commissioner is inside the same branch as `managerUid` |
| R3 | A co-commissioner who is also a player edits settings that affect their own scoring | Already true of `managerUid` and of an owner who plays. Not new; note it in the pool Rules copy |
| R4 | `tests/nfl-settings-lockdown.test.ts:233` asserts source order in the update statement | The change is inside `isPoolManager()`, not the statement — verify the invariant still passes, do not edit it |
| R5 | Legacy pools carrying a `coManagers` array written by nobody-knows-what | The one-off census (`mmp-diagnostics-and-tooling` firestore-census) counts pools with a non-empty `coManagers` before T1 deploys; expected 0 |

---

## 6. 🛑 DECISIONS NEEDED FROM KEVIN — no code until these are answered

> ✅ **SIGNED 2026-08-15 by Kevin — "all recommendations"** (asked and answered in the session that opened the T1 lock PR; every row below stands as recommended).

| # | Question | Recommendation |
|---|---|---|
| **K1** | Accept the §3 table as written? Edit any row's Yes/No here. | Accept. |
| **K2** | Ship **T1 (the lock)** on its own, immediately, before the feature? It closes a client-writable authorization input the same way #432 closed `participantIds`. | **Yes — T1 first as its own PR**, feature after sign-off. |
| **K3** | **C6 money**: may a co-commissioner mark members paid and record payouts? | **Yes.** It is the delegated chore. If No: reads Yes, writes owner-only. |
| **K4** | **C7 pre-lock counts**: does a co-commissioner see "14 of 16 Picks Set" before lock? | **Yes, once `coManagers` is server-owned.** They share the chasing job. |
| **K5** | Cap on co-commissioners per pool? | **3.** Enough for a big pool, small enough that "who can score my pool" is a short list. |
| **K6** | Must a co-commissioner be a member of the pool (canonical Member Record)? | **Yes.** Keeps reveal, roster and reconcile consistent, and matches `poolOps.ts:32` today. |
| **K7** | Squares PII (`squarePrivate`) readable by a Squares co-commissioner? | **No** in v1. |
| **K8** | Rename in prose: **Co-Commissioner** in CONTEXT.md, UI, and pool Rules copy; `coManagers` stays as the field name. | Yes. |

---

## 7. Implementation tickets — §6 signed 2026-08-15; T1 lock + T2a + T7 IN A PR (deploy steps 1–2)

> **Status 2026-08-15:** the first PR carries **T2a** (functions blind to `coManagers`; `assertPoolOwnerOrSuperAdmin` is a disjunction; `assertPoolOwnerOrManagerNoCo` gates cancel/close; `updatePoolSettings` bypass gone), **T1's lock half** (`coManagers` + `coManagersRevision` in `protectedFieldsUnchanged()` and `PRIVILEGED_POOL_FIELDS`; `arrayRemove` in both S8 helpers; `coManagers.rules.test.mjs`; `coManagersIgnored.emulator.test.ts`), and **T7** as the `clearLegacyCoManagers` Operations-tab action (dry-run = the census; live = the audited clear). **T1's callable half (`setPoolCoCommissioner`), T2b, T3, T4, T5, T6 are the NEXT PR — deploy step 3 — and must not merge until the clear has been run and re-censused to 0.**

| T | What | Files | Evidence required |
|---|---|---|---|
| **T1** | 🛑 Lock: `coManagers` into `protectedFieldsUnchanged()`; `setPoolCoCommissioner` callable (D2: one uid per call, transaction, strict owner, `assertNotBannedLive`, canonical-member check, cap, audit event); zod schema + index export + `dbService` wrapper + pool types; **one-off admin clear of all legacy `coManagers`** (D2); `arrayRemove` on every membership-removal path (sweeps S8) | `firestore.rules`, new `functions/src/coCommissioners.ts`, `functions/src/schemas/coCommissioners.ts`, `functions/src/index.ts`, `src/services/dbService.ts`, `src/types/*`, `functions/src/types.ts`, `lib/memberRecord.ts` + every S8 path, an Operations-tab action | new `coManagers.rules.test.mjs` (owner cannot write it, SA can, same-value resend passes — mirror `participantIds.rules.test.mjs`); emulator tests: non-owner refused, banned owner refused, non-member uid refused, cap, **remove wins over a concurrent stale add** (transaction), leave via each S8 path drops the uid, a pre-existing malformed array (non-string, duplicates) is cleared not honoured; census counts in the PR body |
| **T2a** | 🛑 **FIRST DEPLOY (D2 step 1):** functions stop reading `coManagers` everywhere — the conjunct in `assertPoolOwnerOrSuperAdmin` goes, `simulateGameUpdate`/`simFillSquares` go strict owner/SUPER_ADMIN; `assertPoolOwnerOrManagerNoCo` introduced and applied to `cancelPool`/`closePool`/delete; `updatePoolSettings` bypass removed; `createdByUid` census | `poolOps.ts`, `poolExceptions.ts`, `scoreUpdates.ts`, `simLegacy.ts` | `bannedOwnerPath.emulator.test.ts` green; `manualReminderTargets.test.ts` `it.each` still green; **emulator: a uid in a hand-written `coManagers` array is refused on EVERY Table-2 callable after this deploy**; `blindPicks` co-manager test unchanged |
| **T2b** | **THIRD DEPLOY (D2 step 3):** `isPoolCommissioner` helper reads `coManagers` again — NFL callables + `setPaidStatus` per §3; client gains `isNFLPoolCommissioner` (D3) — **`isPoolOwner`/`isPoolManager`/`canManageEntries` unchanged, asserted by test** | `poolOps.ts`, `setPaidStatus.ts`, `src/utils/auth.ts` (NOT `squares.ts`, NOT bracket/props — D3 scope) | a unit test enumerating the four fields through the one helper; **emulator: a co-manager is refused on `cancelPool` and `closePool`, admitted on `extendWeekDeadline`**; sweeps S9 grep shows the other-format gates untouched |
| **T3** | **THIRD DEPLOY (with T2b, never with T1's lock):** rules rows per §3: `isPoolManager()` widened; `allow list` gains the predicate; `isPoolOwnerOrManagerNoCo()` for delete (keeps `managerUid`); `announcements`/`audit`/`shareClicks` per C11; **`payoutRecordsPrivate` read gains the co-manager predicate iff K3 = Yes** (C6 — codex r2) | `firestore.rules` | `coManagers.rules.test.mjs` cases per row **including the exact Hub `array-contains` list query succeeding for a co-manager, and another member's private payout record readable by a co-manager (K3 Yes) / refused (K3 No)**; `nfl-settings-lockdown.test.ts` untouched and green |
| **T4** | C7 (if K4 = Yes): `assertPickReader` COMMISSIONER branch via the helper; header rewritten; flip the two pinned tests deliberately | `functions/src/nflPickReveal.ts`, `blindPicks.emulator.test.ts` | the flipped tests, and PR body names them |
| **T5** | UI: members-tab toggle + badge (D6, gated on strict `isPoolOwner`, passing the observed `revision`); Hub: `dbService.subscribeToPools` + both `ParticipantDashboard` owner/manager filters (D7); `isNFLPoolCommissioner` at the NFL `isManager` gate only (D3) | `NFLManagerView.tsx`, `src/utils/auth.ts`, Hub component | `tests/nfl-surface-invariants.test.ts` still green (it pins `isManager` lines in `NFLPoolDashboard.tsx` — do not touch that file) |
| **T6** | Docs: CONTEXT.md **Co-Commissioner** entry (glossary only), Pool entry's "optionally a separate manager" line, ADR note on why `coManagers` is server-owned; pool Rules copy | `CONTEXT.md`, `docs/adr/`, `NFLPoolRules` | `docs-state-invariants` green |
| **T7** | Census R5 before T1 deploys | read-only script | count of pools with non-empty `coManagers` in the PR body |

**Deploy shape:** three deploys, in D2's order — **(1)** T2a functions
(ignore the field) → **(2)** T1 rules LOCK ONLY + the audited clear, verified
complete → **(3)** T1 callable + T2b widened helper + **T3 rules readers**
(+ T4 if K4). (codex r5 caught this line still saying T3 shipped in step 2.) Each is a functions
deploy **into a LIVE scorer** — `scoreNFLWeek`'s gate changes; the scheduled
job does not go through it, but say so in every PR body. No client read is
revoked at any step, so no Coolify-in-the-middle requirement — state that too.

---

## 8. What this plan does NOT do

- It does not change WHEN anybody sees a pick (`weekRevealFor` untouched).
- It does not touch billing, Stripe, or `redeemCoupon`.
- It does not widen reminder targeting or Commissioner Aggregate Stats (C12).
- It does not make `managerUid` settable — it stays a legacy frozen slot.
- It does not build a wizard step.
