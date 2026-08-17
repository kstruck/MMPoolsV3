# PLAN — the payment ledger, and weekly + season prizes on a HYBRID pool

> **STATUS: ✅ SIGNED 2026-08-15 (K1–K12, "all recommendations"). SHIPPED: T3 (#451), T4 (#455), T5 (#456; ledger UX #460), T6 (#465), T7 (#466), T0 (#469). T1 (`weeklyPayouts` schema + validator + rules; K9 census script) in PR #470. T2 (wizard second editor + PayoutsPanel) next. Absent `weeklyPayouts` ⇒ `payouts` prices both pots (`weeklyPlacesFor`).**
> This is a **MONEY** change (`mmp-change-control` Rule 3). Plan → adversarial
> review log (`PLAN-PAYMENT-LEDGER-REVIEW-LOG.md`) → sweeps
> (`PLAN-PAYMENT-LEDGER-SWEEPS.md`) → Kevin's sign-off → code.
>
> **Provenance:** overnight brief 2026-08-14/15, items **4** (*"extend the existing
> Payments section into a full ledger: per participant, entry fee paid, what they
> are OWED for each week they won (amount), and a way to mark that payout as
> paid (a checkbox is fine). Payouts computed from the entry fee × the
> percentages the commissioner set in the wizard"*), **6** (*"a HYBRID pool must
> be able to define weekly prizes AND season-long prizes; today only one payout
> structure is offered"*) and **5** (move the hybrid split control under Entry
> Fee — ordinary if behaviour-preserving, otherwise plan-gated).
>
> 🛑 **This plan stands on `PLAN-WEEKLY-PRIZES.md`, which is UNSIGNED (D1–D8
> open, no review log, no sweeps).** The ledger's "owed for each week they won"
> is exactly that plan's `weeklyPlaces` snapshot and frozen weekly pot. This
> plan does not re-decide any of it; it consumes it. **Signing this plan without
> signing that one leaves the ledger with nothing to read.** §6 K1 asks for both.
>
> Written overnight without Kevin in the room. Every question the grill would
> have asked him is in §6 with a recommendation; **nothing in §6 has been
> answered.** Codex Act 2 rounds are in the review log.

---

## 0. What Kevin asked for, and what that means precisely

| # | Ask | Class | Why |
|---|---|---|---|
| **6** | HYBRID pool defines **weekly** prizes AND **season** prizes | 🛑 money | Today `settings.payouts.places[]` is one flat list applied to BOTH pots (`PayoutsPanel.tsx:333-338` applies the same percentages to each). Two structures = a new settings field + wizard editor + validation. It is the input the ledger multiplies. **Lands before 4.** |
| **4** | Per-participant ledger: fee paid, owed per week won, mark paid | 🛑 money | Reads Member Records (fee), the recap's frozen weekly places (owed), Payout Records (settled). Writes only through `setPaidStatus` and Payout Records — **extend, do not re-invent** (brief). |
| **5** | Move `HybridSplitFields` from the rules step to the fee step | Ordinary **if** the field names and validation are unchanged and a test proves the create payload is byte-identical | `HybridSplitFields.tsx:16-19` already documents the wrong-step problem. §4 D0. |

### 🛑 The single most important line in this document

**The platform records money; it never moves it, and it never invents a
payout.** CONTEXT.md §Payout Record: *"the platform never computes or
fabricates a payout a Commissioner did not record."* So the ledger's "owed"
column is a **displayed estimate** — `entry fee × entries × the commissioner's
percentages`, whole dollars, labelled approximate — until the commissioner
ticks the box, at which point it becomes a **Payout Record** (the figure) with
`settled: true` (the state). Nothing is auto-recorded when a week is scored.
The checkbox is the act of recording. That keeps the invariant that has been
"permanently settled, not a review-log matter" (`mmp-product-frontier`) intact,
and it keeps Profit (which reads Payout Records only) honest.

---

## 1. What is true today — measured, not remembered

Full file:line inventory in the sweeps doc. The shape:

| Piece | Today | Source |
|---|---|---|
| **Payout structure** | `settings.payouts = { places: [{rank, percentage}], bonuses[] }`, one flat list, ≤ 100 % total, **duplicate ranks allowed** | `shared/schemas/common.ts:55-72`; wizard `StepPayouts.tsx` (rank + % rows, no per-week concept); shown by all five NFL/Bracket/Playoff wizards |
| **`payoutMode`** | `'SEASON' \| 'WEEKLY' \| 'HYBRID'` on Pick'em and Margin; **Survivor has none** | `shared/schemas/nfl.ts:40,79` |
| **Hybrid split** | `settings.hybridSplit = { weeklyPerEntry, seasonPerEntry }`, integers, must sum to `entryFee`; validated at create (`nfl.ts:28-31`), update (`lib/hybridSplitGate.ts`), rules (`callableOnlySettingsUnchanged`, `firestore.rules:298`); control lives on the **rules** step (`CreateNFLPickemPool.tsx:68`) not the fee step (`StepFeeAndPayment.tsx:18`) | #423, `PLAN-HYBRID-SPLIT.md` signed 2026-08-13 |
| **Pot display** | `PayoutsPanel.tsx:284-436`: `grossPot = entryFee × knownEntries`, charity floored, HYBRID `splitPots` floors weekly and lets season absorb the remainder, `dollarFor(pct)` per pot | member-facing |
| **Weekly winner** | `computeWeeklyWinners` → `recap.weeklyWinners[]` (tied leaders only, **no amount, no places beyond 1st**) | `nflScoringEngine.ts:591-606`, `nflPools.ts:1644`, #421 |
| **Weekly places + pot** | **Do not exist.** `PLAN-WEEKLY-PRIZES.md` §3a–3c specifies `recap.weeklyPlaces` (depth = `max(places[].rank)`), a frozen `{pot, places snapshot, entryCount, weeksInSeason}` at first publication, whole-dollar rounding with a NAMED remainder, and `shared/prizeSplit.ts` for ties (§4). Unsigned. | that plan |
| **Payout Records** | `pools/{id}/payoutRecords/{awardId}` `{uid, entryId?, amount, kind: PLACE\|BONUS\|ADJUSTMENT, place?, recordedAt, supersededBy?}` + `payoutRecordsPrivate/{awardId}` `{uid, settled, note?, recordedBy}`; written ONLY by `recordPoolPayouts`; **gated `POOL_NOT_SETTLED` unless the pool is FINAL/COMPLETED** (`payoutRecords.ts:76-79`); corrections supersede, never mutate; `reduceAwards` skips superseded | `shared/payoutRecords.ts`, `functions/src/payoutRecords.ts`, rules `:522-542`, rules test in CI since #434 |
| **Settle toggle** | none for NFL — `settled` is set at record time; `toggleWinnerPaid` (`poolOps.ts:636`) is a **Squares** quarter-winner flag, not reusable | |
| **Fee side** | Member Record `feeOwed` (single source), `paidStatus` via `setPaidStatus` (`isPaid` mode: transactional, mirrors onto `entries/{uid}`, appends `MARKED_PAID` ledger event), member `claim` mode advisory | `shared/memberRecord.ts:25-49`, `setPaidStatus.ts` |
| **Existing surfaces** | member `PaymentsPanel.tsx` (read-only: my paid badge, my due, pot tiles, last 50 ledger events); commissioner `NFLManagerView.tsx` "Members & Payments" (`setPaidStatus`, `settleRebuys`, `RecordPayoutsCard`) | |
| **`RecordPayoutsCard` prefill bug** | reads `castPool.payoutSettings?.places \|\| castPool.payouts?.places` and `p.place ?? idx+1` — neither is the persisted `settings.payouts.places[].rank`, so the prefill silently yields empty/mis-ranked rows | `RecordPayoutsCard.tsx:62,73` — a live defect the ledger replaces |
| **Open money bug** | `PLAN-EMPTY-SUBMISSION-FEE.md` — a seeded commissioner's `feeOwed` can be wrong in the data this ledger reads | unsigned |
| **Standings projection** | `weeklyPoints` per entry per week is member-readable ✅; `paidStatus` is already on the row | `nflScoringEngine.ts:833-846` |

---

## 2. Goal

A commissioner running a HYBRID pool defines a **weekly** prize list and a
**season** prize list in the wizard (a WEEKLY pool defines only weekly, a
SEASON pool only season). After each week is scored the recap carries that
week's places and a frozen pot (WEEKLY-PRIZES). The Members & Payments tab
becomes a ledger: one row per member for the entry fee (paid ✓ via
`setPaidStatus`, unchanged), one line per (entry, week, place) they are owed
with the dollar figure, and a checkbox that **records** that payout as a
settled Payout Record. A member sees their own rows and the pot; Profit and the
Commissioner Aggregate Stats keep reading Payout Records and are correct
without change.

---

## 3. Key decisions and tradeoffs

### D0 — Item 5 (relocation) is ordinary, ships FIRST, and this is the proof required

Move `<HybridSplitFields />` from `StepPickemRules` (and its Margin twin) to
`StepFeeAndPayment`, rendered directly under the entry-fee `NumberField` when
`settings.payoutMode === 'HYBRID'`. The react-hook-form field names
(`settings.hybridSplit.weeklyPerEntry` / `.seasonPerEntry`), the client
`hybridSplitProblem` check, and the create/update/rules validation are
untouched. Step order today (codex r1 corrected the first draft): **rules
(`payoutMode` lives here) comes BEFORE Fee & Payment** in both wizards
(`CreateNFLPickemPool.tsx:162-163`, `CreateNFLMarginPool.tsx:85-86`), so by
the time the user reaches the fee step the mode is already chosen and the
split renders under the fee it must sum to — which is exactly Kevin's ask.
**Evidence that makes it ordinary:** `buildNFLPayload.test.ts` and
`nflPoolsSchema.test.ts` unchanged and green; `wizard-invariants.test.ts`
gains (a) `HybridSplitFields` imported by `StepFeeAndPayment` and by NO rules
step, and (b) an **interaction test**: select HYBRID on the rules step, enter
`$25 = 18 + 7` on the fee step, step forward and back, submit — the create
payload is byte-identical to the pre-move payload (an import-only grep does
not prove field persistence). If any validation line moves, it is plan-gated
and stops.

### D1 — `settings.payouts` stays what it is; HYBRID gains `settings.weeklyPayouts`

`payouts` is **required** on every NFL create schema today (`nfl.ts:25`) and
is THE list for SEASON and WEEKLY pools. That does not change (codex r1 — the
first draft said WEEKLY would "ignore" it, which broke every existing WEEKLY
pool and the required-field contract). The persisted **mode matrix**:

| `payoutMode` | `payouts` (required, unchanged) | `weeklyPayouts` (new, optional) |
|---|---|---|
| `SEASON` | the season list | absent / ignored |
| `WEEKLY` | the weekly list (as today) | absent / ignored |
| `HYBRID` | the **season** list | the **weekly** list; **absent ⇒ `payouts` applies to both pots — today's behaviour, byte-for-byte** |

- `weeklyPayouts: { places: [{rank, percentage}] }` — no `bonuses` (a weekly
  prize is a place); same `payoutPlaceSchema`; ≤ 100 %; **unique ranks on
  BOTH lists** (closes WEEKLY-PRIZES' duplicate-rank money defect for the
  season list too; K9 census first).
- **Server-side, not rules-only** (codex r1): `updatePoolSettings` accepts an
  open settings record and flattens it (`poolOps.ts:393`, `schemas/poolCore.ts:21`),
  so T1 adds a `weeklyPayouts`/`payouts` zod validator + a lifecycle gate to
  the callable (refuse on a pool past OPEN, refuse `weeklyPayouts` on a
  non-HYBRID mode, refuse bonuses/duplicates/>100 %), with callable tests.
- **Mode transitions (codex r3).** `updatePoolSettings` merge-writes, so
  leaving HYBRID must not strand the field: on any `payoutMode` change away
  from HYBRID the callable writes `settings.weeklyPayouts: FieldValue.delete()`
  in the same update — the exact pattern `hybridSplit` already uses
  (`poolOps.ts:526-527`); HYBRID → WEEKLY leaves `payouts` as it was (the
  former season list is now the weekly list, which is what the D1 matrix
  says WEEKLY reads) and the manager UI shows a "review your prize places"
  notice on that transition. Tests: HYBRID↔WEEKLY, HYBRID↔SEASON, both ways.
- **`weeklyPayouts` joins `callableOnlySettingsUnchanged()`** in
  `firestore.rules` (with `hybridSplit`, `tieCountsAs`, `maxTeamUses`,
  `weeklyTiebreaker`), which binds SUPER_ADMIN clients too — the validator
  lives in the callable, so no direct-write path may bypass it (codex r3);
  rules test for a SUPER_ADMIN direct write.
- The ledger never reads live settings for a published week — it reads the
  frozen recap snapshot — so a later edit cannot re-price a settled week.

Rejected: `payouts.weeklyPlaces[]` nested inside the existing object — it
would make every existing consumer of `payouts.places` (five wizards,
`PayoutsPanel`, `RecordPayoutsCard`, `bracketScoring`) parse a shape they do
not expect.

### D2 — Wizard: the Payouts step grows a second editor on HYBRID

`StepPayouts.tsx` takes a `payoutsField` already; render it twice on HYBRID
("Weekly prizes — % of the weekly pot", bound to `settings.weeklyPayouts` /
"Season prizes — % of the season pot", bound to `settings.payouts`), and ONCE
on WEEKLY and on SEASON — both bound to `settings.payouts`, exactly as today
(the D1 matrix; codex r2 caught the first draft binding WEEKLY's editor to
`weeklyPayouts`, which D1 says is HYBRID-only). Live "must not exceed 100 %"
and "ranks must be unique" per editor.

### D3 — 🛑 "Owed" is displayed, never auto-recorded

Per entry per week: `place` from `recap.weeklyPlaces` (WEEKLY-PRIZES §3a),
amount from the frozen `weeklyPot × weeklyPayouts.places[rank].percentage`
with tie-splitting via `shared/prizeSplit.ts` (WEEKLY-PRIZES §4), whole
dollars, remainder named (D6 there). Shown as **"Owed (est.)"** with the copy
WEEKLY-PRIZES §3c requires. Season prizes: same, from final standings once
`finalizedAt` is set. **No Payout Record exists until the commissioner ticks
the box.**

### D4 — The checkbox = `recordPoolPayouts` with `settled: true`, per week — bound to the published award, idempotent

Extend, not re-invent — but two things the callable does NOT do today are
load-bearing for a checkbox (codex r1):

- **Deterministic award id.** A weekly place award's doc id is
  `wk{week}-{entryId}-p{place}`, created **only if absent** in the
  transaction. A double-click, a retry, or two commissioner tabs cannot record
  the same win twice and double Profit (`reduceAwards` sums every
  non-superseded record). Season awards keep random ids as today.
- **Bound to the recap.** For `kind:'PLACE'` + `week`, the transaction reads
  `weekly_recaps/week_{N}` and requires: integer week ≤ last scored week with a
  published `weeklyPlaces`; `entryId` owned by `uid`; `(entryId, place)` present
  in `weeklyPlaces`; **`amount` equal to the frozen computed amount** for that
  place (after tie split). Anything else is refused. A commissioner who wants a
  different figure records a `BONUS`/`ADJUSTMENT` — the override path that
  already exists.
- **Per-award eligibility, before any write.** The current gate runs once for
  the whole `awards[]` batch (`payoutRecords.ts:74-79`); a mixed batch could
  ride an unfinalized season award in on a valid weekly one. Each award is
  gated independently (weekly rule above; `POOL_NOT_SETTLED` for the rest),
  and the batch is all-or-nothing.
- `PayoutRecord` gains optional **`week?: number`** (additive; `schemaVersion`
  2; `reduceAwards` unchanged since it ignores the field).
- Ticking writes `{uid, entryId, amount, kind:'PLACE', place, week}` +
  private `{settled: true}`, emits `PAYOUT_PAID` (already does), recomputes the
  profile (already does).
- Un-ticking: a new small callable **`setPayoutSettled({poolId, awardId,
  settled})`** — transaction over BOTH docs, refuses a superseded award,
  **transition-only** event emission (`PAYOUT_UNPAID`/`PAYOUT_PAID`), same
  owner gate as `setPaidStatus` + `assertNotBannedLive`, **no profile
  recompute** (settlement does not move Profit — CONTEXT.md §Profit counts
  recorded prizes whether or not settled). The AMOUNT stays immutable
  (supersede to correct it, as today).
- The ledger shows a recorded-but-different amount (a `BONUS`/`ADJUSTMENT`)
  as the recorded figure, with the estimate beside it — the record wins.
- **Rescore after a recorded weekly award (codex r2).** WEEKLY-PRIZES permits
  a rescore to re-rank a published week. Policy: **the recap wins; the ledger
  never silently keeps a stale award.** On every render the ledger compares
  each non-superseded weekly `PLACE` record against the current recap; a
  mismatch (entry no longer at that place, or a different frozen amount) is
  shown as **STALE** with the current figure beside it, and the checkbox on
  that row becomes "re-record": `recordPoolPayouts` accepts a weekly award
  whose deterministic id already exists **only as a supersession** — in one
  transaction it marks the old record `supersededBy` and writes the
  replacement at `wk{week}-{entryId}-p{place}~{k}` (k = 2, 3, …). **The
  re-record request carries the `staleAwardId` it is replacing; if that award
  is already superseded when the transaction reads it, the call returns the
  current live matching award and writes nothing** — two tabs cannot churn
  the chain (codex r3). Profit therefore counts exactly one live record per
  (entry, week, place). Nothing
  is superseded automatically by the scorer — a human clicks, as everywhere
  else in this plan.
- **One authorizer for record AND settle (codex r2/r3).** A new shared helper
  **`assertPayoutAuthority(pool, uid, role)`** = `assertPoolOwnerOrSuperAdmin`
  + `assertNotBannedLive`, called by BOTH `recordPoolPayouts` and
  `setPayoutSettled` — one function, not two callables that happen to agree
  (the earlier "same gate as `setPaidStatus`" wording is withdrawn; that
  callable's gate is different and token-only on bans).
  Whether that set includes co-commissioners is `PLAN-CO-COMMISSIONERS` C6/K3's
  ruling, applied here through that plan's one helper — not decided twice.

### D5 — Where it lives, and who sees what

- Commissioner: `NFLManagerView` "Members & Payments" — the ledger table
  REPLACES `RecordPayoutsCard` (its prefill is broken, D1 in §1) for NFL pools;
  the card's free-form "record an arbitrary award" survives as an "Add
  adjustment" row (`kind: ADJUSTMENT`/`BONUS`).
- Member: `PaymentsPanel` gains "My prizes" — the viewer's own rows only
  (Payout Records are participant-readable by rules, `payoutRecordsPrivate`
  only for own uid, so `settled` for others is not readable — and should not
  be). The pot tiles stay.
- Reads: Member Records (already subscribed), recaps (already subscribed for
  the Recaps tab), `payoutRecords` (`subscribeToPayoutRecords` exists),
  `payoutRecordsPrivate` for own/commissioner. **No new read type**; one new
  subscription on the manager tab.

### D6 — Multi-entry aware from day one (`PLAN-MULTI-ENTRY` §0b)

Prize rows are per **entry** (`entryId` on the record — already in the
contract); fee rows are per **member** (`feeOwed` is already the sum). Display
name `entryName ?? userName`. Nothing here assumes one entry per uid.

### D7 — Survivor

No `payoutMode` on Survivor; its prize is the pot to the last standing (or
split among survivors at season end). The ledger shows fee rows and, once
`finalizedAt`, a season row per surviving entry from `payouts.places`. No
weekly rows. Out of scope to add weekly Survivor prizes.

---

## 4. Risks

| R | Risk | Mitigation |
|---|---|---|
| R1 | Building the ledger before WEEKLY-PRIZES lands means computing from a structure that does not exist | Hard dependency in §7 order; T3+ do not start until WEEKLY-PRIZES steps 1–4 are merged |
| R2 | A commissioner edits `weeklyPayouts` after week 3 is settled | The recap freeze snapshots the list; the ledger reads the snapshot; a copy line says "changes apply to weeks not yet scored" |
| R3 | Relaxing `POOL_NOT_SETTLED` per week opens `recordPoolPayouts` mid-season | Only for `PLACE` + `week` + week scored; emulator test: week 5 refused when `lastScoredWeek` = 4 |
| R4 | `setPayoutSettled` is a new money-adjacent write | Same owner gate as `setPaidStatus`, banned-live check, ledger event, audit event; emulator test |
| R5 | Rounding drift between the member `PayoutsPanel` maths and the ledger | ONE helper used by both, with **two named units** (codex r1): `weeklySeasonAllocation` = `weeklyPerEntry × entries × charityFactor` (what `PayoutsPanel.tsx:324` displays today as "weekly pot"), and `perWeekPrizePot` = that ÷ `weeksInSeason` (WEEKLY-PRIZES §3b) — **only the latter prices a weekly award**. Test asserts both figures on the #423 example and that the ledger never uses the former |
| R8 | `weekly_recaps` are publicly readable (`firestore.rules:427`); adding `weeklyPlaces` + frozen amounts publishes recipient names and prize figures to anyone with the pool URL | 🛑 **K10** — decide: public product data (the recap already names the weekly winner publicly, and the amount is derivable from public settings), or gate the recap to participants (a rules change that also hides today's winner). Recommendation: **public**, stated on the page |
| R6 | The empty-submission fee bug pollutes `feeOwed` rows | Named on the page as WEEKLY-PRIZES/EMPTY-SUBMISSION dependency; not fixed here |
| R7 | Co-commissioner (PLAN-CO-COMMISSIONERS C6) may or may not be allowed to tick the box | The gate is the one helper that plan introduces; whichever way Kevin rules there applies here automatically |

---

## 5. Out of scope

- Any Stripe/platform handling of entry-fee money (invariant).
- Partial payment of a member's fee (paid is all-or-nothing per member).
- Weekly prizes on Survivor.
- Backfilling `weeklyPlaces` for weeks scored before WEEKLY-PRIZES ships (that
  plan says no backfill; the ledger shows "not computed" for those weeks).

---

## 6. 🛑 DECISIONS NEEDED FROM KEVIN — no code until these are answered

> ✅ **SIGNED 2026-08-15 by Kevin — "all recommendations"** (asked and answered in the session that opened the T1 lock PR; every row below stands as recommended).

| # | Question | Recommendation |
|---|---|---|
| **K1** | 🛑 **Sign `PLAN-WEEKLY-PRIZES.md` D1–D8 first** (its review log + sweeps still owed) — the ledger reads its `weeklyPlaces` + frozen pot. Do both plans go together? | **Yes.** Its recommendations stand; nothing here changes them. |
| **K2** | Item 6 shape: new `settings.weeklyPayouts` for weekly places, `settings.payouts` stays as season places; absent `weeklyPayouts` = today's behaviour? | **Yes.** |
| **K3** | "Owed" is a displayed estimate; ticking the box RECORDS a settled Payout Record; nothing is auto-recorded on scoring? | **Yes** — the invariant. |
| **K4** | Allow `recordPoolPayouts` for a **weekly** `PLACE` award once that week is scored (relaxing "pool must be FINAL" for weekly only)? | **Yes.** |
| **K5** | Un-ticking flips `settled` on the private record (new `setPayoutSettled`) — amount stays immutable, supersede to correct? | **Yes.** |
| **K6** | Pot from **every** entry or **PAID** entries only? (WEEKLY-PRIZES D8) | **Every entry**, printed on the page. |
| **K7** | Members see **only their own** prize rows + the pot; the commissioner sees all? | **Yes** (rules already enforce it for `settled`). |
| **K8** | Item 5 (move the split control under Entry Fee) ships as an **ordinary** PR first, with the D0 test proof, and stops if any validation line moves? | **Yes.** |
| **K9** | Unique ranks enforced on BOTH lists (a schema tightening that could refuse an existing pool's future settings save)? | **Yes**; a census counts pools with duplicate ranks first (expected 0). |
| **K10** | Weekly places + frozen prize amounts live on the (publicly readable) weekly recap — public product data, or gate the recap to participants? | **Public.** The recap already names the winner to anyone with the URL; the dollar figure is `fee × places`, derivable from the pool's public rules. Say so on the page. |
| **K11** | Weekly award = deterministic id `wk{week}-{entryId}-p{place}`, bound to the recap's published place and frozen amount; any other figure goes through `BONUS`/`ADJUSTMENT`? | **Yes.** It is what makes a checkbox safe to double-click. |
| **K12** | After a rescore, a recorded weekly award that no longer matches the recap shows STALE and is re-recorded by supersession on click — never auto-corrected by the scorer? | **Yes.** A human records money; the scorer only publishes places. |

---

## 7. Implementation tickets — NOT STARTED, gated on §6 AND on WEEKLY-PRIZES steps 1–4

| T | What | Files | Evidence required |
|---|---|---|---|
| **T0** | Item 5 relocation (D0) — ordinary PR | `StepFeeAndPayment.tsx`, `StepPickemRules` + Margin twin, `wizard-invariants.test.ts` | payload tests unchanged; new invariant |
| **T1** | Item 6 schema: `weeklyPayouts` + unique-rank refinement on both lists; rules parity with `payouts`; **`updatePoolSettings` server validator + lifecycle gate** (D1) | `shared/schemas/common.ts`, `nfl.ts`, `firestore.rules`, `functions/src/schemas/poolCore.ts`, `poolOps.ts`, `nflPoolsSchema.test.ts` | schema tests; callable tests (malformed / duplicate / >100 % / bonuses / non-HYBRID / past-OPEN all refused); census (K9) in PR body |
| **T2** | Item 6 wizard: two editors on HYBRID (D2); `PayoutsPanel` reads `weeklyPayouts` for the weekly pot when present | `StepPayouts.tsx`, `Create*Pool.tsx`, `PayoutsPanel.tsx` | `wizard-invariants`, `buildNFLPayload.test`; the #423 example renders $18/$7 pots with different place lists |
| **T3** ✅ #451 | Shared maths: `weeklyPot()` beside `prizeSplit.ts` (from WEEKLY-PRIZES step 1); one function for panel + ledger | `shared/prizeSplit.ts` (+ new `shared/prizePot.ts`) | R5 equality test |
| **T4** ✅ #455 | `PayoutRecord.week?` (schemaVersion 2); `recordPoolPayouts` per-award gate, deterministic weekly ids, recap binding (D4); `setPayoutSettled` callable | `shared/payoutRecords.ts`, `functions/src/payoutRecords.ts` (+ new file), `schemas/*` | emulator: week 5 refused when last scored is 4; **same weekly award recorded twice → one record**; wrong amount / wrong place / entry not owned / recipient not in `weeklyPlaces` → refused; mixed batch with an unfinalized season award → whole batch refused; settle toggle transition-only + refuses a superseded award; sim harness season award still passes; `payoutRecords.rules.test.mjs` unchanged and green — **functions deploy into a LIVE scorer, say so** |
| **T5** | Commissioner ledger table (D5) replacing `RecordPayoutsCard` for NFL; per-entry rows (D6) | `NFLManagerView.tsx`, new `PaymentLedgerNFL.tsx` | `admin-surface-invariants` payment-wiring guard extended; `nfl-settings-lockdown` (no `updateEntryPayment`) still green |
| **T6** | Member "My prizes" in `PaymentsPanel` | `PaymentsPanel.tsx` | manual + a render test on the own-rows filter |
| **T7** | Docs: CONTEXT.md — **Weekly Prize**, **Season Prize** glossary entries (definitions only), Payout Record entry gains "may name a week"; pool Rules copy; ADR note on "displayed until recorded" | `CONTEXT.md`, `docs/adr/`, `NFLPoolRules` | `docs-state-invariants` |
| **T8** | Sweeps | `PLAN-PAYMENT-LEDGER-SWEEPS.md` | every `payouts.places` consumer enumerated and classified |

**Order:** T0 → (WEEKLY-PRIZES 1–4) → T1 → T2 → T3 → T4 → T5 → T6 → T7. One PR
per ticket. Item 6 (T1–T2) is the visible half Kevin can see early; the ledger
proper (T4–T6) is the money half.

---

## 8. What this plan does NOT do

- It does not move money, or let the platform hold any.
- It does not create a Payout Record without a commissioner's click.
- It does not change `setPaidStatus`, `feeOwed`, or Paid Status semantics.
- It does not touch scoring or `weekRevealFor`.
