# Plan: Test Suite — fix all failures, then full NFL scenario coverage
_Locked via grill-with-docs — by Claude + Kevin. Terms per CONTEXT.md. Rev 7 (rebased on buy-flow overhaul PR #144 after the 5-round Codex review closed at Rev 6)._

## Goal
Get the Super-Admin Test Suite from 1/15 passing to fully green, then extend it
with full-combinatorial Scenario coverage for the three NFL season pool types
(Pick'em, Survivor, Margin) plus Squares, so every format can be trusted before
live preseason testing (weeks away). Bracket-harness debugging and the Upset
Bonus wizard rework land last (March-deadline work).

## Current state (verified; corrected after Codex round 1)
- 5 "Failed to create pool" errors (Basic Quarters, Every Score Wins, Partial Fill,
  Bracket Fibonacci, Bracket ESPN) are already fixed in merged PR #141
  (`fix/pool-schema-drift`): `shared/schemas/squares.ts` gameId → `.nullish()`,
  `shared/schemas/bracket.ts` scoringSystem enum now all 5 values. Validation runs
  server-side in `functions/src/lib/poolCreation.ts` — the fixes survived the
  buy-flow merge (verified in `origin/main` schemas). **Prod deploy state is
  UNCERTAIN**: the buy-flow morning checklist says "nothing deployed" at
  authoring, but live-UAT fixes on 2026-07-07 say "some need a redeploy" —
  Phase 0 verifies before acting.
- 6 bracket test failures share one harness bug: `bracketSimulator.ts:166-190`
  entry `addDoc` silently fails (error swallowed into an "Entry Error" step) → 0
  entries → every assertion reads 0. `bracketE2ESimulator` uses a different write
  path and creates entries fine, so Firestore rules are not the cause.
- Props Basic "expected 5, got 6" is a **scenario-authoring bug, not an engine
  bug**: `props-basic.json` gives q4 two points and Dave answers all four
  correctly (2+1+1+2=6); the assertion expecting 5 is internally inconsistent.
- Playoff Basic "Alice should win" likely contradicts the documented semantics:
  higher rank value = higher confidence/points (`README.md:33-35`,
  `functions/src/playoffPools.ts:107-118`), so Alice ranking KC #1 earns the
  FEWEST points for KC — Carol may be the correct winner and the scenario wrong.
- Bracket Full 2025 E2E: regression since TEST-SUITE-BACKLOG.md was written —
  AllChalk beats PerfectBracket despite all-correct picks + closer tiebreaker.
  Genuine winner/tiebreaker-resolution suspect.
- Functions implement NFL_PICKEM / NFL_SURVIVOR / NFL_MARGIN (`nflPools.ts`,
  `nflScoringEngine.ts`), **but `scorePickemEntry` has no ATS branch** — it never
  reads spreads, despite `pickMode: 'ATS'` existing in the create schema.
- Test Suite harness gaps (all verified): PoolType union is
  `SQUARES | BRACKET | NFL_PLAYOFFS | PROPS` (`scenarios/index.ts:20`); no NFL
  assertion types, runner dispatch, or result hydration exist
  (`simpleTestRunner.ts:52-157`); `runAllTests()` performs **no cleanup**
  (`simpleTestRunner.ts:201-219`); only `squaresSimulator` tracks resources;
  `deletePool` is a plain `deleteDoc` — **no recursive subcollection delete**
  (`BaseRepository.ts:96-99`). Cleanup is aspirational today, not working.
- The harness is a single privileged (SUPER_ADMIN) client session. Existing
  simulators create multi-"user" entries by writing entry docs directly under the
  `sim-` Firestore-rules backdoor with fake ownerUids — there is no multi-user
  auth orchestration, and `submitNFLPicks` writes only to
  `entries/{request.auth.uid}` (`nflPools.ts:199-334`).
- **Authorization gap found in review:** `submitNFLPicks` never checks pool
  membership (`joinNFLPool` is a separate callable) — any authed user can submit
  picks to any NFL pool.
- NFL edges called out by `docs/NFL_POOLS_README.md`: preseason `seasonType=1`;
  dual-MNF weeks (current tiebreaker code looks only at the first Monday game,
  `nflPools.ts:615-617`).
- **Buy-flow overhaul (PR #144) changed the create/join ground under this
  plan:** every create payload now carries `estimatedPlayers` + `addons` (all 7
  wizards gained a LaunchStep; `launchFields.ts` spreads them top-level); the
  server computes a launch billing mode — `computeLaunchMode` in `poolOps.ts`
  stamps `billing` as `free` (no estimate/small estimate, no paid add-on) or
  `trial` (any paid add-on, or estimate > freePlayerThreshold). `joinNFLPool`
  now enforces the free-plan 10-participant cap AND a paid-participant ceiling
  (`assertPaidParticipantCeiling`). New money surface (quote engine, coupon
  reservation, entitlements/bundles, billing-charges ledger, monetization
  alerts) ships with its own unit/emulator tests. The #141 schema fixes
  survived the merge; squares schema already models `seasonType`.

## Approach

### Phase 0 — Verify fix + deploy state, then deploy (clears the 5 errors)
_Status 2026-07-07: 0.1 ✅ (main @ 9e6b032). 0.2 ✅ — `npx firebase
functions:list` shows `updateCouponTemplate` (buy-flow Wave 4a) deployed, so
prod functions post-date #141: the schema fixes are LIVE, no deploy needed
from this plan. 0.3 ✅ — `tests/pool-schema-drift.test.ts` 9/9 green locally.
0.4 SKIPPED (already deployed by Kevin during live-UAT). 0.5 PENDING — Kevin
re-runs the in-app suite to confirm the 5 errors are gone (expected: ~6 pass)._
0.1. `git pull` main (now includes #141, #142, #138, #143, and the buy-flow
   overhaul #144).
0.2. **Verify prod deploy state first** (`npx firebase functions:list`, function
   behavior probes): the buy-flow live-UAT implies a deploy may already have
   happened. If prod already runs post-#141 functions, re-run the suite before
   deploying anything — the 5 errors may already be gone.
0.3. Reproduce the fix on a controlled surface BEFORE touching prod: run the
   emulator-backed create-path tests on the target commit
   (`functions/src/__tests__/emulator/poolCreation.emulator.test.ts`, plus the
   new `tests/pool-schema-drift.test.ts`), including the exact failing payloads
   (gameId:null squares; FIBONACCI/ESPN brackets). Deploy is the release step,
   not the diagnosis step.
0.4. Deploy ritual: `npm --prefix functions install`, then
   `npx firebase deploy --only functions --project gridiron-gamble-uzuqo`.
   **A functions deploy now ships the buy-flow functions too** — coordinate
   with MORNING-CHECKLIST-BUYFLOW.md (its deploy order includes
   `firestore:rules` and `firestore:indexes` for the new monetization
   collections; functions before rules, per the ritual). Do not deploy
   functions in isolation if the checklist's rules/indexes steps are still
   pending without confirming with Kevin.
0.5. Re-run the 15 tests; record results. Expected: 5 errors gone. If any still
   error, stop and root-cause before Phase 1.

### Phase 1 — Scenario-vs-engine triage, then fixes
_Status 2026-07-07: items 5-7 ✅ — commit `7216436` on `fix/test-suite-phase1`
(worktree .claude/worktrees/test-suite-phase1). Item 7 resolution: NOT an
engine bug — the E2E 'AllChalk' control entry duplicated PerfectBracket's
picks (its 'chalk' mode copied correct results) AND its exact tiebreaker
(128), so two perfectly tied entries left the winner to unstable sort order —
that's why the test flaked from pass to fail. Controls are now seed-based and
AllChalk's tiebreaker is 130; regression-locked by testEntryGenerator.test.ts.
Root suite 24 files / 230 tests green. In-app confirmation rides on the Phase
0.5 suite re-run._
5. Props Basic: fix the scenario/assertion inconsistency (q4=2pts → top score 6,
   or make q4 worth 1). Only touch props scoring if the corrected scenario still
   fails.
6. Playoff ranking direction: lock ONE canonical semantics (higher rank value =
   more points, per current docs/UI/engine) across README, HowItWorksPage, and
   scenarios; fix `playoff-basic.json` expectations to match. Only treat the
   engine as buggy if it disagrees with the canonical rule. Keep Playoff
   Lifecycle green.
7. Bracket E2E tiebreaker regression: diff behavior against the commit range
   since the backlog said it passed; fix winner/tiebreaker resolution
   (closest-absolute |148−145|=3 must beat AllChalk's distance).
7b. _(discovered by the 2026-07-07 suite re-run)_ **Squares $0 payouts — real
   product bug, fixed in PR #147** (`fix/test-suite-squares-bracket`,
   commit `a091276`): `payouts` is a privileged create field (stripped since
   dfe43ca) and the post-buyflow wizard collects none, so every new squares
   pool had no payouts map → scoreUpdates paid $0/period. createPool now
   seeds DEFAULT_SQUARES_PAYOUTS 25/25/25/25 (the legacy SetupWizard default).
   Needs a functions deploy. Open follow-up: prod squares pools created via
   the new wizard before this fix have no payouts map — backfill is a Rule-1
   gated decision for Kevin.
   _**SUITE FULLY GREEN 2026-07-07: 15/15** (was 1/15 + 5 errors at plan
   start). Final fixes: PR #148 (dashboard renders failed simulator steps —
   the diagnostic that cracked the cluster) and PR #149 (the 8-test bracket
   0-entries root cause: simpleTestRunner renamed the scenarios'
   `tiebreakerPrediction` to `tiebreaker`, bracketSimulator read undefined,
   and Firestore addDoc rejects documents with undefined fields; runner
   mapping fixed, simulator strips undefined before writes, scenario
   data-contract tests added). Item 17 (bracketSimulator 0-entries) is
   RESOLVED by #149 — it was this mapping bug, not the entry-write path
   itself. Phases 0-1 complete; next: Phase 2 NFL wave (items 8-16)._

### Phase 2 — NFL wave (the deadline work)
8. **Harness plumbing first** (explicit work items, not assumed):
   a. PoolType union += `NFL_PICKEM | NFL_SURVIVOR | NFL_MARGIN`.
   b. **NFL scenario data model**: extend `TestScenario` so NFL runs are
      representable — game/week model with `seasonType`, `isMonday`,
      `spread.value`, `spread.locked`, and per-type pick shapes (pick'em picks
      + confidence, survivor team-per-week, margin team-per-week). Without
      this, ATS/preseason/dual-MNF scenarios cannot be authored.
   c. NFL assertion primitives (standings position, points, strikes,
      eliminations, weekly winner, recap existence).
   d. Runner dispatch branches + post-run result hydration for NFL pools.
   e. **Cleanup hardening (precondition for scaling scenario count):** every
      simulator tracks created resources and cleans in `finally`. Client-side
      cleanup is IMPOSSIBLE under current rules (audit deletes forbidden,
      `weekly_recaps` writes forbidden, `participations` server-only), and pool
      creation writes OUTSIDE the pool tree (`writePoolCreationSideEffects`:
      `users/{uid}/managedPools`, `participations`, `activity`; `joinNFLPool`
      adds another participation doc). Therefore: a **test-only Admin-SDK
      cleanup callable** (`cleanupSimPool`, SUPER_ADMIN-only) that recursively
      deletes the pool tree AND the user-side index/activity docs a sim run
      created — and refuses any pool outside the `sim-` namespace.
   f. **Sim harness contract (mandatory, no fallback):** SUPER_ADMIN writes are
      allowed on ANY pool, entry, and tournament doc by rules
      (`firestore.rules:81,193-204,322`) — the `sim-` "backdoor" is not
      actually scoped, and today's simulators do raw client writes to pool
      docs, entries, AND tournaments (e.g. a bug could overwrite
      `tournaments/mens-2025` or mutate a real pool's status on prod).
      Therefore:
      - EVERY suite-created artifact (pool, tournament, game, entry) carries a
        uniform `sim-<runId>-` ID prefix where the harness controls the ID. No
        simulator may reference a real tournament/game doc ID.
      - **The trust anchor is a persisted field, not the ID**: `createPool` /
        `createNFLPool` generate random pool doc IDs server-side, so an ID
        prefix cannot mark real-callable-created Test Pools. The create
        callables accept and persist a `simRunId` field (stamped only when the
        caller is SUPER_ADMIN); `cleanupSimPool` and every guarded sim-write
        callable authorize against that persisted field — never against an ID
        or slug prefix.
      - EVERY simulator mutation that is not a real product callable goes
        through SUPER_ADMIN test-only server callables that enforce the
        `sim-<runId>-` namespace server-side before writing. Raw client writes
        are removed from all simulators — a client-side guard is NOT accepted
        as enforcement. Sweep 1 fixed the API surface: the callables must
        support THREE write shapes — entries subcollection (bracket), entries
        array inside the pool doc (playoff/props), and tournament docs
        (bracketE2ESimulator hardcodes the REAL `tournaments/mens-2025` doc
        twice today). Harness-originated `dbService.updatePool` /
        `updateBracketPool` calls move behind the same guard.
      - **Legacy simulator migration (squares, bracket, bracketE2E, playoff,
        props) is a mandatory precondition** for any production run of the
        expanded suite and for the final suite gate — today they don't create
        `sim-` pools at all, so `cleanupSimPool` would refuse the suite's own
        artifacts. Not "opportunistic".
9. **Data isolation (hard requirement):** simulated NFL games/weeks live in a
   synthetic namespace that can never overlap live data — `sim-` prefixed game
   IDs under a synthetic season value never used by real imports, written and
   deleted by the simulator. No simulator may write a doc a real ESPN import
   could also write. Concurrent-run safety: per-run unique namespace suffix.
10. **Simulator contract per pool type:**
    - Pool creation via the real create callable (createNFLPool path, ADR 0001).
    - Entries: joined via `joinNFLPool` where the harness identity allows;
      multi-user entries fabricated ONLY through the guarded sim harness
      callables of item 8f (never raw writes). Tradeoff on record: the picks
      callable is NOT exercised by simulators; callable coverage lives in
      emulator tests.
    - **Launch mode pinned `free` (buy-flow interaction):** simulator create
      payloads MUST NOT select paid add-ons and MUST keep `estimatedPlayers`
      absent or ≤ freePlayerThreshold, so every Test Pool launches
      `billing.status='free'` — a sim run must never enter the trial/paid/
      Stripe path or write monetization collections (billing_charges, bundles,
      coupon reservations). Asserted per scenario. Free-pool joins cap at 10
      participants (`joinNFLPool`), so scenarios routing joins through the real
      callable use ≤10 users.
    - **Entry-doc invariant:** fabricated NFL entry docs MUST use
      `docId === ownerUid` — `scoreNFLWeek` writes ranks back to
      `pools/{poolId}/entries/{ownerUid}` (`nflPools.ts:734-747`); arbitrary doc
      IDs would make the rank pass write phantom docs and diverge from real
      behavior. Locked with a regression test.
    - Scoring via the real `scoreNFLWeek` callable (RBAC + recap/audit side
      effects are part of what's under test) — never direct engine calls.
      Assert standings AND `weekly_recaps`/audit outputs.
11. **Close the authz gap:** add a participant-membership check to
    `submitNFLPicks` + a negative test (non-member picks rejected). Danger-list
    change (functions authz) — lands as its own reviewed commit.
12. **seasonType through the live create path:** preseason coverage must be
    provable on the path commissioners actually use, not simulator-only. Add
    `seasonType` (1=preseason, 2=regular, 3=post; default 2) to
    `shared/schemas/nfl.ts`, `buildNFLPayload`,
    and the three NFL create wizards (`CreateNFLPickemPool.tsx`,
    `CreateNFLSurvivorPool.tsx`, `CreateNFLMarginPool.tsx`), and persist it on
    the pool so week scoring queries the right game set. Post-#144 note:
    `buildNFLPayload` now spreads `readLaunchFields(values)` — seasonType
    composes with that; the new `buildNFLPayload.test.ts` (and sibling
    build*Payload tests) must be extended, not broken.
13. **Dual-MNF tiebreaker fix (pulled INTO scope):** `docs/NFL_POOLS_README.md`
    defines the MNF tiebreaker as the COMBINED score of both Monday games;
    `nflPools.ts:615-617` reads only the first. Doc is the contract — fix the
    engine to sum all Monday games in the week, and the scenario asserts the
    documented behavior. Additionally: the MNF tiebreaker must not RESOLVE
    until every Monday game is `FINAL` — `scoreNFLWeek` lets SUPER_ADMIN score
    with games still active (`nflPools.ts:578-581`), which would freeze a
    partial Monday total into the tiebreak. Gate tiebreak resolution on
    all-Monday-FINAL (rescore path recomputes it); scenario covers the
    one-final-one-live week.
    **Rescore safety (same item):** `scoreNFLWeek` is NOT idempotent today —
    Survivor reruns append duplicate `exemptWeeks`, re-increment `strikesUsed`,
    and emit duplicate `SURVIVOR_AUTO_STRIKE`/`SCORE_FINALIZED` audit events
    (`nflPools.ts:660-766`). The rescore path this item depends on requires
    making `scoreNFLWeek` idempotent per `(poolId, week)` — recompute-from-
    scratch semantics (set, don't increment) with deduped audit writes — with
    a regression test that scores the same week twice and asserts identical
    state. Danger-list (scoring engine), own commit.
14. **ATS scoring (DECIDED by Kevin 2026-07-07: implement in wave 1):**
    `pickMode: 'ATS'` is offered
    but unscored. Default: implement the ATS branch in `scorePickemEntry`
    (spreads infra already exists — lockNFLSpreadsJob, `spread.locked`) with
    push-handling, in wave 1. Fallback if runway shrinks: cut ATS from wave 1,
    remove it from the wizard, and narrow the coverage claim. No third option:
    offering-but-not-scoring is the UPSET bug again.
15. Author full-combinatorial Scenarios over scoring-affecting dimensions
    (timing-only dims like lockMode/lockBufferMinutes get one lifecycle scenario
    each, not multiplied):
    - **Pick'em (~16):** pickMode{STRAIGHT,ATS†} × payoutMode{SEASON,WEEKLY,
      HYBRID} × confidenceMode{on,off} = 12, edges folded in (ATS push, tie game,
      missed-picks week, weekly tiebreaker); + 2 lockMode lifecycle scenarios;
      + preseason `seasonType=1` scenario (via item 12's live-path field);
      + dual-MNF tiebreaker scenario (asserting item 13's combined-score rule).
      († contingent on item 14.)
    - **Survivor (~13):** pickLosersMode{on,off} × autoSurviveExemption{on,off} ×
      maxStrikes{0,2} = 8; + rebuy flow (maxRebuys>0, deadline week, cost);
      + edges: all-eliminated week, duplicate-team pick rejected, tie game,
      last-man-standing.
    - **Margin (~5):** payoutMode ×3; margin-tie edge; season-winner tiebreak.
    - **Squares (+2):** existing 3 revived by Phase 0; add full-fill
      quarter-payout variant and an NFL-game-context scenario.
    - **Buy-flow interaction (+3):** free pool launches with
      `billing.status='free'` + all `featuresUnlocked` false (stamp
      assertion); free-plan 11th `joinNFLPool` rejected (negative); create
      payload with `estimatedPlayers` > freePlayerThreshold stamps `trial`
      with `trialEndsAt` (create-only assertion — the sim run still never
      enters the paid path; pool cleaned up like any other Test Pool).
16. Test Suite tab: segmented groups render per pool type once scenarios exist.

### Phase 3 — Bracket harness + Upset Bonus (March-deadline, last)
17. bracketSimulator 0-entries: instrument the swallowed `errMsg` at
    `bracketSimulator.ts:166-190`, reproduce, fix the entry write (or align with
    the working bracketE2ESimulator path). Should flip 6 tests.
18. Upset Bonus rework (per grill decision):
    - Remove `UPSET` from the wizard scoringSystem select
      (`CreateBracketPool.tsx:44` post-#144); add an Upset Bonus toggle +
      multiplier input mapped to `settings.upsetBonus.{enabled,multiplier}`
      (engine support exists in `bracketScoring.ts`). Post-#144 note: the
      wizard now has a LaunchStep with paid `addons` — Upset Bonus is a
      SCORING setting, NOT a paid add-on; it must live with the scoring fields
      and never route through `addons` (which would force a trial launch).
    - Add `upsetBonus` to `shared/schemas/bracket.ts` create-input settings;
      keep `UPSET` in the enum for back-compat.
    - Audit prod (read-only) for pools with `scoringSystem == 'UPSET'`; report to
      Kevin before any data decision.
    - New Scenario: bracket with upsetBonus enabled, seed-differential assertion.
19. Final full-suite run; all groups green; update TEST-SUITE-BACKLOG.md.

## Key decisions & tradeoffs (from the grill + review round 1)
- **Verify-then-deploy**: emulator repro of the #141 fix precedes the prod
  functions deploy; deploy is release, not diagnosis.
- **Scenario bugs are fixed as scenario bugs**: Props and Playoff failures are
  triaged against canonical semantics before any engine change.
- **UPSET retired as a Scoring System; Upset Bonus exposed as a composable
  add-on** (toggle + multiplier) — reuses the existing engine path.
- **NFL-first hybrid sequencing**: engine/scenario fixes and NFL wave before
  bracket-harness debugging (bracket is March; preseason is weeks away).
- **Three NFL season types + Squares** in wave 1 (Squares is not an NFL season
  type; it's game-scoped and already simulated).
- **Full combinatorial depth**, bounded to scoring-affecting dimensions.
- **Real callables for create + score; guarded sim harness callables for
  everything else** — multi-user entry fabrication is the one place the harness
  can't be real without a multi-user auth harness (explicitly out of scope, on
  record), and no simulator mutation bypasses the `sim-<runId>-` server-side
  namespace check.
- ADR 0001 governs: no direct Firestore writes for pool docs.

## Risks / open questions
- Test Suite runs against **production** Firestore; cleanup hardening (8e) is a
  precondition, not a nice-to-have — a failed run today strands pools AND
  subcollections. Consider a periodic sim-pool sweep op later.
- Bracket E2E regression cause unknown until Phase 1.7 — if it's in shared
  winner resolution it may also affect playoff/NFL winner calc (would raise its
  priority).
- Survivor/margin engine behavior for edges (ties, all-eliminated) may be
  unspecified in `nflScoringEngine.ts` — each gap gets a decision checkpoint
  rather than an invented rule.
- ATS implementation size unknown until `scorePickemEntry` + spread-locking flow
  is read in anger (item 14 fallback exists).
- Prod pools with `scoringSystem == 'UPSET'` unknown until audited.
- `seasonType` persistence (item 12) touches the create schema + scoring query
  path — verify week scoring filters games by the pool's seasonType, not just
  season/week, before authoring preseason scenarios.
- Item 14 DECIDED (Kevin, 2026-07-07): implement ATS scoring in wave 1; the
  cut-from-wizard fallback remains available only if runway collapses.

## Contract-source rule
Repo-root `shared/` is the ONLY editable contract source. `functions/src/shared`
is GENERATED — `copy-shared.mjs` blows it away on every build/predeploy. Never
edit the generated copy; verification asserts the generated copy matches
`shared/` after build.

## Process gates (mmp-change-control)
- Multi-file change → this plan + adversarial review log
  (`PLAN-TEST-SUITE-REVIEW-LOG.md`) + sweep pass (`PLAN-TEST-SUITE-SWEEPS.md`)
  before implementation; Kevin sign-off after review converges.
- Implementation in its own worktree/branch (Rule 4); merge latest `main` in and
  re-run clobber-guard tests before PR.
- Phase 0 deploy follows the deploy ritual (functions-only; no rules change).
- Simulators depend on the `sim-` Firestore rules backdoor today — nothing in
  this plan may tighten that rule until the legacy-simulator migration (8f) is
  complete; after migration, tightening it becomes possible as follow-up work.
- The `submitNFLPicks` membership gate (item 11) is a functions authz change:
  danger-list, own commit, emulator-tested before deploy. Same discipline for
  the dual-MNF tiebreaker fix (item 13) and ATS scoring (item 14) — scoring
  engines are danger-list.
- **Items 8e/8f (cleanupSimPool + guarded sim-write callables) are the
  highest-blast-radius additions in this plan: danger-list.** Required before
  deploy: emulator tests proving namespace refusal (non-sim pool rejected,
  wrong-runId rejected, non-SUPER_ADMIN rejected). Every cleanup/mutation
  attempt — success OR refusal — writes an `admin_audit` entry with runId,
  target doc paths, and outcome (the repo's existing forensic-trail contract,
  `functions/src/lib/adminAudit.ts`).
- No prod-data mutation beyond Test Pool/sim-namespace create/cleanup; the UPSET
  prod audit is read-only; any migration is a separate Rule-1 gated decision.

## Out of scope
- Live preseason testing itself (this plan makes it possible, doesn't do it).
- A real multi-user auth harness for simulators (entries fabricated via sim-
  backdoor; callable-level picks coverage lives in emulator tests).
- ESPN live-data ingestion changes; AI testing tab; bracket features beyond the
  listed fixes; Pick'em pointsPerPick custom values beyond default.
- The buy-flow money engine (quote, coupon reservation, entitlements/bundles,
  billing-charges ledger, Stripe webhooks, monetization alerts) — covered by
  its own unit/emulator tests from PR #144. This suite only covers the
  create/join interactions listed in item 15's buy-flow scenarios, and sim runs
  must never write monetization collections.
