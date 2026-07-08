# Commissioner Dash — overnight progress + morning list

Branch: `feat/commissioner-dash` (off `main`). Nothing deployed. Test Suite work untouched.

## Done overnight (Phase 1 — shipped, typecheck clean, committed)

1. **Nav split** — `My Entries` → `/participant?tab=entries` (new membership-filtered tab); `Manage My Pools` → `/participant?tab=commissioner` (Commissioner Hub). Query-param drives the active tab. (`Header.tsx`, `ParticipantDashboard.tsx`)
2. **Killed the fake Roster Hub stats** — dropped the never-written `managerStats` blob. Commissioner Hub now shows **Pools Managed**, **Total Participants**, **Dues Expected** (fee × real participants, `guest` excluded) computed live; **Dues Collected** shows `—` until the Phase 2 aggregate. Replaced the phantom "Top Pools Revenue" chart with **Dues Expected by Pool** + a real empty state. (`GlobalCommissionerDashboard.tsx`)
3. **Top-row cards** — "Active Entries" now counts NFL season pools too (was Squares/Bracket/Playoff only); "Prize Payouts" (a win **count**, not money) relabeled **Wins**. (`ParticipantDashboard.tsx`)
4. **Live Weekly Pick'em** — now renders the **full week slate**, not a single game; the Live/Scheduled badge moved to top-center so it no longer covers the away-team logo. (`NFLUserBentoDashboard.tsx`)
5. **Type-gated homepage** — Pick'em pool sidebar shows Pick'em + Rules only (no Survivor/Margin); **Survivor Attrition** card only on `NFL_SURVIVOR`, **Margin Pool Stats** only on `NFL_MARGIN`; "Global Standings" relabeled **Pool Standings** (it is this pool's leaderboard). (`NFLUserBentoDashboard.tsx`)

Commits: `ab21ebf` (docs) → `be1892c` (nav + stats) → `594417c` (homepage).

## Phase 2 — Member Record backend (option B: DONE, additive only)

You picked **B**. Built as **new files only** — no `nflPools.ts`/`bracketPools.ts`/`squares.ts`/`participant.ts` touched, so zero conflict with the Test Suite NFL wave. Functions typecheck clean; pure logic unit-tested (shared selfcheck + `planMembershipWrite` 4/4).

Shipped (commits `60df0d5` backend, `0cbec75` rules):
- `shared/memberRecord.ts` — types + dues adapters (squares units, rebuy dues) + pure `computeRosterSummary`/`foldCommissionerAggregate` (+ selfcheck).
- `functions/src/lib/memberRecord.ts` — pure `planMembershipWrite` (never clobbers `paidStatus`) + `reconcileMembership` tx applier.
- `functions/src/lib/rosterSummary.ts` — `recomputeRosterSummary` → `pools/{id}/rosterSummary/current` (+ guest/unclaimed-squares bucket).
- `functions/src/lib/commissionerAggregate.ts` — `recomputeCommissionerAggregate` → `users/{uid}.commissionerAggregate` (replaces dead `managerStats`); `lib/poolInclusion.ts` predicate.
- `functions/src/setPaidStatus.ts` — commissioner-authoritative paidStatus (member+ledger one tx) + member-only `memberReportedPaid` claim.
- `functions/src/rosterAggregate.ts` — triggers: `onMemberRecordWrite`, `onWinnerWrite`, `onPoolRosterFieldsChange` (fee+inclusion only).
- `functions/src/migrations/backfillMemberRecords.ts` — super-admin, dryRun default, resumable, invariant counts, per-pool `rosterSchemaVersion` flip.
- `firestore.rules` — `members` + `rosterSummary` (member self-write pinned to the two claim fields).

## Test-work review (2026-07-08) — SAFE, wiring unblocked

Reviewed the paused test work: NFL Test Suite Phase 2 wave is **fully merged to main** (PR #150 engine, #151 harness, #152 scoreNFLWeek P0). This branch was cut from the up-to-date main, so it already contains all of it; both test-suite worktrees are clean; no stashes. The hot-file conflict that forced option B is gone.

## Wiring — NFL DONE (additive), rest still deferred

Done (commit `1bb7e89`, additive — existing certified logic untouched, 323 unit tests green):
- `createNFLPool` seeds the owner Member Record; `joinNFLPool` seeds the joiner (backfill-on-touch); `executeSurvivorRebuy` writes `rebuyOwed` in-tx.
- Emulator test `memberRecord.emulator.test.ts` — **needs Java to run (unavailable in the build sandbox)**; verify with `npm --prefix functions run test:emulator` in your env / CI.

Still to wire (same additive pattern, other pool types — lower priority than NFL preseason):
1. Bracket join (`bracketPools.ts:235`) + `createBracketEntry` (`bracketEntries.ts:102`), `submitPlayoffPicks` (`playoffPools.ts:137`), squares claim/release (`squares.ts`) + `reminders` auto-release, guest paths (`participant.ts:93,157`), non-NFL owner seed (`poolCreation.ts:134`), `propBets.purchasePropCard`.
2. Deletes/leaves → `voidMemberRecord`.
3. Remove the 4 direct-client paidStatus writes (`NFLManagerView.tsx:195`, `NFLManagerBentoDashboard.tsx:97`, `BracketPoolDashboard.tsx:323`, `SuperAdmin.tsx:179`) → call `setPaidStatus`.
4. Frontend consumers: `PaymentsPanel` + `NFLManagerView` read the Roster from `members`/`rosterSummary`; Commissioner Hub "Dues Collected" reads `users/{uid}.commissionerAggregate`.
5. `reconcileMembership`-only CI guard (fail build if `participantIds` is mutated elsewhere).

## Morning deploy sequence (when you're ready)
```
cd D:\march-melee-pools
npm --prefix functions install          # avoid stripe/fft TS2307
npm --prefix functions run build        # copies shared + tsc
npx firebase deploy --only firestore:rules   # review the members/rosterSummary rules first
npx firebase deploy --only functions:setPaidStatus,functions:onMemberRecordWrite,functions:onWinnerWrite,functions:onPoolRosterFieldsChange,functions:backfillMemberRecords
# then dry-run the migration and READ the report before a real run:
# call backfillMemberRecords({ dryRun: true }) → paginate with nextCursor → review invariant counts
# only then backfillMemberRecords({ dryRun: false })
```
Note: `commissionerAggregate` + `backfill` query `pools where ownerId ==` — if the deploy logs a missing-index error, add the composite index it names.

## Morning list (needs you regardless)
- Deploy Phase 1 frontend (frontend only; no functions in Phase 1).
- Review + deploy the Firestore rules (compile on deploy; I could not compile them locally).
- Dry-run the backfill and review the invariant report before any real run.
- Visual QA of Phase 1 on a real logged-in pool (couldn't drive authenticated prod unattended): slate list, badge position, type-gated cards, nav split — desktop + mobile.

## Not yet started
Deferred wiring commit (above), Phase 3 redesign (Homepage + Roster Hub toward the mockup), Phase 4 polish + full UX-review write-up, Rules & Rulesets commissioner editing (item 14, frontend-light — good next pickup).
