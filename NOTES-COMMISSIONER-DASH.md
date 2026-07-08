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

## SEE IT NOW (no deploy needed)
Run `npm run dev` → open **http://localhost:5173/dev/dashboards** (unauthenticated, mock data). Toggle: **Commissioner Hub** (grouped-by-type + filter + honest Dues cards), **Pool Homepage** (full week slate, centered Live badge, type-gated cards, Pool Standings), **Rules Tab** (commissioner edit banner + lock deadline). All screenshotted + verified in-browser. The route is unlisted; remove `src/pages/DevDashboardPreview.tsx` + its route/import in `App.tsx` before prod if you don't want it shipped (harmless if left).

## Roster + Payments consumer wiring — DONE (commit 4a709c5)
The Commissioner view roster + Payments tab now show **everyone who joined**, not just entry-holders.
- Roster = `participantIds` ∪ Member Records ∪ entries. Commissioner + members with no entry appear ("No entry yet" tag). Member count drives platform billing.
- Payments tab: commissioner banner + **Edit / Manage Payments** button → Commissioner view. Pot/expected count everyone who joined.
- Mark-paid via `setPaidStatus`; per-member + bulk email reminders from the roster.

**What works on the real pool right NOW (pre-deploy, pre-backfill):**
- You (commissioner) and all `participantIds` members are **listed** immediately (names show for entry-holders + you via your profile; other pick-less members show "Member" until the backfill seeds names).
- Pot/member count is correct from `participantIds`.
- Mark-paid on members **with an entry**: works (direct-write fallback).

**What needs deploy + backfill:**
- Mark-paid on no-entry rows (incl. yourself): needs `setPaidStatus` deployed (graceful error until then).
- Names for pick-less members: appear after the backfill seeds Member Records.
- `rosterSummary` pot precision: after the aggregate function deploys.

## Verification status (this branch)
App `tsc` ✓ · production `vite build` ✓ · app vitest **244/244** ✓ · functions `tsc` ✓ · functions vitest **323/323** ✓. NOT verified: Firestore transaction wiring (no Java/emulator in the build sandbox) — run `npm --prefix functions run test:emulator` (includes `memberRecord.emulator.test.ts`).

## Wiring — NFL DONE + all owner seeds (additive), rest still deferred

Done (additive — existing certified logic untouched, 323 unit tests green):
- NFL (`1bb7e89`): `createNFLPool` seeds owner Member Record; `joinNFLPool` seeds joiner (backfill-on-touch); `executeSurvivorRebuy` writes `rebuyOwed` in-tx.
- All non-NFL owner seeds (`734057b`): `writePoolCreationSideEffects` seeds the owner Member Record for Squares/Bracket/Props/Playoff, `ownerName` threaded from the create callers. → **the commissioner is on the roster from t=0 for every pool type.**
- Emulator test `memberRecord.emulator.test.ts` — needs Java; run in your env / CI.

Frontend (visible, committed): Commissioner Hub redesign (`879f561`), Pool Homepage fixes verified in preview (`03e3ee0`), Rules-tab commissioner editing (`d84c027`), Commissioner Hub reads `users/{uid}.commissionerAggregate` with fallback.

Still to wire — the reviewed step (deploy-coupled or emulator-gated; NOT done unattended):
1. Non-owner join for other types (additive, same pattern): bracket join (`bracketPools.ts:280`) + `createBracketEntry`, `submitPlayoffPicks`, squares claim/release + `reminders` auto-release, guest paths, `propBets.purchasePropCard`. (Backfill covers EXISTING members of these; only NEW non-NFL joiners between now and this wiring would be missing — low for an NFL preseason.)
2. Deletes/leaves → `voidMemberRecord`.
3. **Deploy-coupled — do WITH the functions deploy, not before:** remove the 4 direct-client paidStatus writes (`NFLManagerView.tsx:195`, `NFLManagerBentoDashboard.tsx:97`, `BracketPoolDashboard.tsx:323`, `SuperAdmin.tsx:179`) → call `setPaidStatus`. Switching the frontend before the callable is deployed BREAKS mark-paid, so these stay on the direct write until deploy.
4. `PaymentsPanel` + `NFLManagerView` roster read from `members`/`rosterSummary` (shows commissioner + pick-less members). Needs a `members` subscription; lights up post-backfill.
5. `reconcileMembership`-only CI guard.

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
