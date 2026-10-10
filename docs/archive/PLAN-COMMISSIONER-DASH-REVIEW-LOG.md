# Plan Review Log: Commissioner Dashboards + Member Pool Homepage overhaul
Act 1 (grill-with-docs) complete — plan locked at PLAN-COMMISSIONER-DASH.md, CONTEXT.md glossary extended, ADR 0003 (unified roster model) written. MAX_ROUNDS=5. PLAN_FILE=PLAN-COMMISSIONER-DASH.md.

## Round 1 — Codex
Thread 019f3fd2-df1e-7a82-8e75-7429dcb24615. VERDICT: REVISE.

1. High — "One Entry per Member" collides with multi-entry types: Bracket has `maxEntriesPerUser` + random entry IDs (bracketEntries.ts:60,82); Playoff keys entries `uid_timestamp` + caps per user (playoffPools.ts:174,196). Fix: separate `members/{uid}` roster doc, don't redefine playable `entries`.
2. High — Squares doesn't fit `paidStatus + fee×members`; migration could create an `entries/guest` doc because squares add `"guest"` to participantIds (squares.ts:111); guest claims only rewrite `squares` (participant.ts:141). Fix: skip non-UID guests; model squares dues as units owned/paid.
3. High — Member-writable `paidStatus` breaks the domain and can self-unlock paid brackets. CONTEXT says Paid Status is commissioner-set (CONTEXT.md:53); bracket submission gates on `paidStatus==='PAID'` (bracketEntries.ts:227, BracketPoolDashboard.tsx:546). Fix: authoritative paidStatus stays server/commissioner-only; add a separate member payment-claim signal.
4. High — Member "honest pot" read impossible pre-lock: UI subscribes to raw `entries` (NFLPoolDashboard.tsx:83, dbService.ts:1432) but rules let members read only their own entry until locked (firestore.rules:191). Fix: publish a read-safe pool payment summary projection.
5. High — Backfill won't stop live drift: NFL join early-returns if already in participantIds (nflPools.ts:168); bracket/playoff delete + squares release don't reconcile membership (bracketEntries.ts:391, playoffPools.ts:340, squares.ts:352). Fix: one idempotent membership helper called from every join/delete/release/claim before migration.
6. High — Aggregate undercounts survivor rebuys: member view includes `rebuysUsed*rebuyCost` (PaymentsPanel.tsx:55) and rebuys hit the ledger (nflPools.ts:556); `fee×members` ignores them. Fix: include rebuy dues from ledger/deterministic fields.
7. High — Per-type source assumptions already wrong: statsTrigger reads nonexistent `playoff_entries` (statsTrigger.ts:18) though playoff data is in `pool.entries` (playoffPools.ts:108). Fix: tested per-type adapters for member count/dues/payouts.
8. High — Naive entry-write trigger thrashes stats on every pick save + weekly scoring: submitNFLPicks updates entry per submission (nflPools.ts:364); scoreNFLWeek rewrites every entry (nflPools.ts:621). Fix: trigger only on membership/payment fields, or roll from per-pool summaries.
9. High — One callable insufficient while direct writes remain (NFLManagerView.tsx:195, NFLManagerBentoDashboard.tsx:97, BracketPoolDashboard.tsx:323, SuperAdmin.tsx:179); ledger append is non-atomic + swallows failures (paymentLedger.ts:43). Fix: remove direct-write path; entry mutation + ledger append in one transaction.
10. Medium — Nav split has no canonical index: both buttons go `/participant` (Header.tsx:157); dashboard mixes owned pools into "my pools" (ParticipantDashboard.tsx:141); bracket uses `joinedPools` (bracketPools.ts:281), NFL/squares use `participations`. Fix: one canonical user-pool index; My Entries filters off membership not ownership.
11. Medium — Active/closed/test scope underspecified: UI excludes only COMPLETED + lowercase `archived` (GlobalCommissionerDashboard.tsx:23) but lifecycle includes CANCELED + `closedVia:'ADMIN_CLOSE'` (poolSport.ts:102), and sim-* pools exist (firestore.rules:93). Fix: explicit inclusion matrix by lifecycle/test marker, used everywhere.
12. Medium — Migration "idempotent + dry-runnable" in words only; no gate/checkpoint/invariant reporting. Fix: resumable script with checkpoints + post-run invariant counts; gate new reads on `rosterSchemaVersion`.
13. Medium — Stub too thin: roster/reminder code expects `userName` (NFLManagerView.tsx:893, manualReminders.ts:132). Fix: populate userName on join/backfill; keep deterministic doc IDs where helpers assume them.

Simpler alt (adopted): `pools/{poolId}/members/{uid}` cross-type roster/payment truth; leave gameplay entries/squares models alone. If timing tight: ship roster/payment for NFL now, bracket/playoff/squares behind adapters.

### Claude's response
Accepted all 13 (final arbiter). Core pivot: introduce a dedicated **Member Record** at `pools/{poolId}/members/{uid}` as the roster + payment truth for every Pool type; the playable Entry stays the selection record (may be >1 per Member for Bracket/Playoff) and Squares keeps square-level truth. Specific responses:
- (1)(2) Member Record replaces "Entry Stub"; migration seeds Member Records only for real UIDs (skip `guest`); Squares dues modeled as units owned/paid on the Member Record.
- (3) Authoritative `paidStatus` stays commissioner/server-only; added **Member Payment Claim** (member self-report, never gates play).
- (4) Added a read-safe `pools/{id}/rosterSummary` projection (member count, dues collected/expected) that members can read pre-lock; rules updated.
- (5) One idempotent `reconcileMembership` helper wired into every join/leave/delete/release/claim path, shipped before the backfill.
- (6) Dues math includes rebuy dues sourced from the payment ledger / deterministic pool fields.
- (7) Per-type dues/member/payout adapters, unit-tested; fix the `playoff_entries` vs `pool.entries` bug in the same pass.
- (8) Aggregate trigger fires only on Member Record writes (membership/payment), not on Entry pick/score writes.
- (9) Single authorized `setPaidStatus` callable does Member Record mutation + ledger append in one transaction; all four direct-write call sites removed.
- (10) Canonical membership = Member Records; header split reads that. Pick a single user-pool index (`participations`) and backfill bracket onto it.
- (11) Explicit pool inclusion matrix (exclude COMPLETED/archived/CANCELED/ADMIN_CLOSE/sim-*), one shared predicate.
- (12) Migration becomes a resumable, checkpointed script with post-run invariant counts; new hub/summary reads gate on `rosterSchemaVersion`.
- (13) Member Record carries `userName`; deterministic doc ID `members/{uid}`.
Revising ADR 0003, CONTEXT.md, PLAN-COMMISSIONER-DASH.md accordingly.

## Round 2 — Codex
VERDICT: REVISE. Prior 13: 8 addressed (1,3,7,8,9,10,11,13), 5 partial (2,4,5,6,12). 5 new/sharpening findings:

- High — Rebuy trigger hole: survivor rebuys write the ledger (nflPools.ts:556) with no Member Record write, so Member-Record-triggered aggregates stay stale. Fix: write rebuy owed/paid onto the Member Record in the rebuy transaction.
- High — reconcileMembership underspecified: "5 files" misses bracket join (bracketPools.ts:235), both guest-claim paths (participant.ts:93,157), owner seeding (poolCreation.ts:134); and a simple add/remove is wrong for "delete one of many bracket/playoff entries" or "release some but not all squares". Fix: enumerate every writer; reconcileMembership recomputes post-write membership/units from authoritative pool state inside the same transaction.
- Medium — rosterSummary consistency + scope: not stated atomic with setPaidStatus/membership writes; scope conflicts (ADR "world/member" vs CONTEXT "member"). Fix: readable by pool members/commissioner/admins only; update in the same transaction as every membership/payment mutation.
- Medium — memberReportedPaid rules too vague: "own record only + deny paidStatus" doesn't stop mutating adjacent fields. Fix: pin the exact diff — allow self-writes only to memberReportedPaid + memberReportedAt (or use a callable) + audit each claim.
- Medium — Squares guest dues + gating criteria: skipping "guest" is right, but unclaimed guest squares then have no dues bucket, and rosterSchemaVersion has no per-pool flip criteria. Fix: add a derived guest/unclaimed-squares bucket to rosterSummary; flip rosterSchemaVersion per pool only after that pool's invariant checks pass.

### Claude's response
Accepted all 5 (final arbiter); all are refinements, model unchanged.
- Rebuy: Member Record gains `rebuyOwed/rebuyPaid`, written in the rebuy transaction; dues adapters read them.
- reconcileMembership redefined as **recompute-from-authoritative-pool-state within the writer's own transaction** (not add/remove). Writer list expanded to: nflPools join, bracketPools.ts:235 join, playoffPools join, squares claim/release, participant.ts:93 & :157 guest paths, poolCreation.ts:134 owner seed, and all delete paths. Multi-entry delete recomputes membership from remaining entries; partial squares release recomputes units.
- rosterSummary scoped to pool members/commissioner/admins (ADR "world" wording corrected); updated in the same transaction as every membership/payment mutation.
- Rules pin the exact diff to `memberReportedPaid` + `memberReportedAt` only; `paidStatus` and all other fields denied to members.
- rosterSummary gains a derived guest/unclaimed-squares dues bucket; `rosterSchemaVersion` flips per pool only after that pool passes its invariant checks.
Revising ADR 0003 + PLAN + CONTEXT.

## Round 3 — Codex
VERDICT: REVISE. Closed 4/5 prior partials (rebuy, rosterSummary scope/atomicity/guest bucket, member-claim exact-diff rules, per-pool schema-version gating). Remaining:

- High — reconcileMembership coverage still incomplete: `createBracketEntry` directly arrayUnions participantIds (bracketEntries.ts:102); the real playoff add path is `submitPlayoffPicks` not a join callable (playoffPools.ts:137,213); squares auto-release mutates ownership directly (reminders.ts:318,339); legacy side-writers `syncParticipantIndices` (participant.ts:225) + `fixParticipantIds` (poolOps.ts:532). Fix: route/rewrite/retire every one under reconcileMembership before calling it closed.
- High — "all types" false for Props: `purchasePropCard` writes only propCards + entryCount (propBets.ts:94,98); Prop members never enter participations/Member Records/My Entries. Fix: add Prop participation + Member Record + backfill, or scope Props out of Phase 2 explicitly.
- Medium — aggregate Payouts can go stale: squares payout flips happen on `pools/{id}/winners/*` (poolOps.ts:504) with no Member Record touch, but the aggregate triggers on Member Record writes only. Fix: add a payout-source trigger/ledger refresh, or drop Payouts from the aggregate this release.
- Low — goal sentence still says "one Entry-per-Member Roster model" (PLAN:5), contradicting the ADR's Member Record. Fix wording.

### Claude's response
Accepted all 4 (final arbiter).
- reconcileMembership: rather than keep hand-enumerating (the repo has too many writers to trust a static list), close it with a **mechanism** — a pre-implementation grep audit of every writer of participantIds/participants/propCards/entry ownership, plus a **test/CI guard that fails if membership state is mutated outside reconcileMembership**. Added the newly found writers explicitly (createBracketEntry, submitPlayoffPicks, reminders auto-release, syncParticipantIndices, fixParticipantIds) as must-route/retire; legacy fixers get folded into reconcileMembership or retired.
- Props: brought into the model explicitly — `purchasePropCard` gains a participation + Member Record write; Props included in backfill. (Not scoped out; "all types" made true.)
- Payouts: sourced from the winners subcollection / payout ledger; the aggregate recomputes on payout events too (winners write → aggregate refresh), so Payouts can't go stale. Not dropped.
- Goal reworded to "one Member Record per Member roster model."

## Round 4 — Codex
VERDICT: REVISE. 2 findings:

- High — Props not in backfill source: step 8 fixed the new-write path, but the migration still reads only participantIds/participants/entries; existing Prop members live in `propCards`, so old Prop pools migrate with missing Member Records. Fix: include `propCards` in the backfill source set + invariant report.
- High — Aggregates stale on lifecycle change: the inclusion predicate excludes COMPLETED/archived/CANCELED/ADMIN_CLOSE/sim-*, but a pool crosses that boundary via a pool-doc write with no Member Record/winner write, leaving commissioner counts/dues/payouts stale. Fix: also recompute on pool-doc writes affecting the predicate, or make aggregate inclusion live rather than trigger-only.

### Claude's response
Accepted both (final arbiter).
- Backfill source set now explicitly includes `propCards` (+ its own invariant: propCard-member-without-record); the migration reads participantIds ∪ participants ∪ entries ∪ propCards.
- Aggregate refresh gains a third trigger: pool-doc writes that change inclusion-predicate fields (`status`, `closedVia`, archived flag). Stated as the chosen option over live-query inclusion to keep the aggregate a cheap stored read.

## Round 5 — Codex (MAX_ROUNDS cap)
VERDICT: REVISE. 1 finding:

- Money-state: derived dues refresh only on membership/payment/inclusion/payout writes, but `entryFee`/`costPerSquare`/`rebuyCost` edits are allowed via `updatePoolSettings` + dashboard edit flows — a fee edit changes owed dues without firing any trigger, so `rosterSummary` (Dues Expected = fee × members) and commissioner aggregates go stale. Fix: also refresh on pool-doc writes that change fee fields.

### Claude's response
Accepted (final arbiter). Generalized the pool-doc trigger from inclusion-predicate fields to **inclusion OR fee fields** (`entryFee`, `costPerSquare`, `rebuyCost`) in both PLAN and ADR, so a fee edit recomputes rosterSummary + aggregates.

## Resolution — cap reached, substantively converged
Loop terminated at MAX_ROUNDS=5 without a formal APPROVED. This is NOT a deadlock of disagreement: every finding across all five rounds was accepted and incorporated; there is no unresolved Claude counter-position. Findings shrank monotonically (13 → 5 → 4 → 2 → 1) and never reopened the core model (the round-1 Member Record pivot held). The reviewer defaults to REVISE while any refinement remains; the round-5 fee-edit catch is folded in. Plan is considered substantively converged and ready for Kevin's sign-off. Remaining reviewer-style residue would be incremental, not structural.

## Post-approval: test-work review + NFL wiring (2026-07-08)
Reviewed paused test work at user request. Finding: NFL Test Suite Phase 2 (PR #150/#151/#152) is fully merged to main; this branch already contains it; test-suite worktrees clean; no stashes. Hot-file conflict resolved → wiring unblocked.
Wired Member Record writes into NFL paths ADDITIVELY (commit 1bb7e89): createNFLPool owner seed, joinNFLPool joiner seed, executeSurvivorRebuy rebuy dues. Existing entry/participantIds/paidStatus logic untouched; 323 functions unit tests + typecheck green. Emulator integration test written but cannot run locally (no Java) — verify via test:emulator in CI/Kevin's env. Other pool-type wiring + direct-write removal + frontend consumers remain the reviewed follow-up (see NOTES).

## Overnight continuation (2026-07-08) — frontend redesign + all-types owner seeds
- Commissioner Hub redesign (879f561): grouped-by-type + filter + honest Dues (collected/expected)/Payouts cards from commissionerAggregate w/ fallback; removed the nonsensical revenue chart.
- Pool Homepage fixes verified in browser via /dev/dashboards (03e3ee0): full slate, centered Live badge, type-gated cards, Pool Standings.
- Rules & Rulesets tab (d84c027): commissioner edit banner + Edit button routing to the manager settings editor + season-opener lock.
- Owner Member Record seeded for ALL pool types on create (734057b) — commissioner on roster from t=0 everywhere.
- Full verification: app tsc + vite build + 244 app tests + functions tsc + 323 functions tests all green. Firestore transaction wiring unverified locally (no Java) — emulator test written for CI.
- Remaining: non-owner join wiring for non-NFL types, delete/void, deploy-coupled direct-write removal + members-driven roster read. All documented in NOTES.
