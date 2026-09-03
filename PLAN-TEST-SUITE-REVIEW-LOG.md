# Plan Review Log: Test Suite fixes + NFL scenario coverage
Act 1 (grill-with-docs) complete — plan locked at PLAN-TEST-SUITE.md (PLAN.md is the pre-existing master roadmap, left untouched; PLAN-REVIEW-LOG.md belongs to the wizard-unification review). CONTEXT.md unchanged this round. MAX_ROUNDS=5.

## Round 1 — Codex
VERDICT: REVISE. 11 findings (5 High, 6 Medium). Note: round 1 ran as a fresh
`codex exec -s read-only` session; the thread id was lost to a harness timeout,
so round 2 resumes via `codex exec resume --last`.

1. (High) Prod functions deploy as first debugging move; emulator create-path
   coverage exists (`poolCreation.emulator.test.ts`). Fix: reproduce on emulator
   at target commit first; deploy is release, not diagnosis.
2. (High) Synthetic NFL game injection would write the global live `nfl_games`
   collection (SUPER_ADMIN-writable) — can corrupt real schedules; concurrent
   runs clobber. Fix: emulator or hard-isolated synthetic namespace.
3. (High) "Write entries/picks as test users" impossible: single privileged
   session; `submitNFLPicks` writes `entries/{auth.uid}` only. Fix: emulator
   tests with injected auth or budget an auth harness.
4. (High) `submitNFLPicks` never checks membership (`joinNFLPool` separate) —
   simulator submitting directly would normalize an authz hole. Fix: membership
   gate + negative test; scenarios go through `joinNFLPool`.
5. (High) Pick'em matrix includes ATS but `scorePickemEntry` has no pickMode
   branch and never reads spreads. Fix: implement ATS first or cut from wave 1.
6. (Medium) Props "bug" is scenario-internal: q4 worth 2, Dave 4/4 correct = 6;
   assertion expecting 5 is inconsistent. Fix: correct scenario first.
7. (Medium) Playoff "Alice should win" contradicts documented semantics (higher
   rank value = more points); Carol may be correct. Fix: lock canonical ranking
   direction, fix scenario, only then judge the engine.
8. (Medium) Plan says "trigger nflScoringEngine" — real unit under test is the
   `scoreNFLWeek` callable (RBAC, recaps, audit). Fix: invoke the callable;
   assert recaps/audit too.
9. (Medium) Phase 2.7 incomplete: no NFL assertion types, runner dispatch, or
   result hydration exist. Fix: explicit work items.
10. (Medium) Cleanup claim materially wrong: `runAllTests()` cleans nothing;
    only squaresSimulator tracks resources; `deletePool` is non-recursive
    `deleteDoc`. Fix: guaranteed recursive cleanup in `finally` everywhere
    before scaling scenario count.
11. (Medium) "Four NFL season types" wrong (three + Squares separate); missing
    preseason `seasonType=1` and dual-MNF edges (`nflPools.ts:615-617` reads
    only first Monday game). Fix: correct language; add those scenarios.

### Claude's response
All 11 accepted; plan revised to Rev 2:
- 1 → Phase 0 now requires emulator repro of the exact failing payloads on the
  target commit before the prod deploy (deploy reframed as release step).
- 2 → New Phase 2 item 9: hard data-isolation requirement — `sim-` prefixed
  game IDs under a synthetic season no real import can produce, per-run unique
  namespace, simulator-owned lifecycle. No simulator may write a doc a real
  ESPN import could write.
- 3 → Accepted with modification: rather than an auth harness (out of scope, on
  record), entries are fabricated via the existing `sim-` backdoor direct-write
  pattern (as squares/bracket sims do). Tradeoff logged: `submitNFLPicks` is
  NOT exercised by simulators; callable coverage lives in emulator tests.
- 4 → New item 11: membership gate in `submitNFLPicks` + negative test; flagged
  as danger-list authz change, own commit.
- 5 → New item 12 with DECISION NEEDED marker for Kevin: default implement ATS
  (spreads infra exists), fallback cut-and-remove-from-wizard. Offering-but-
  not-scoring explicitly rejected as "the UPSET bug again".
- 6 → Phase 1.5 reframed: fix scenario/assertion first; engine only if the
  corrected scenario still fails.
- 7 → Phase 1.6 reframed: canonicalize ranking direction (higher value = more
  points per current docs/engine), fix `playoff-basic.json`, then judge engine.
- 8 → Item 10: scoring via the real `scoreNFLWeek` callable; assert standings +
  `weekly_recaps`/audit outputs. Direct engine calls banned.
- 9 → Item 8a-c: assertion primitives, dispatch, hydration as explicit work.
- 10 → Item 8d: cleanup hardening (resource tracking + `finally` + recursive
  subcollection delete) is a precondition for scaling scenario count; "Current
  state" section corrected to say cleanup is aspirational today.
- 11 → Goal/decisions language corrected to "three NFL season types + Squares";
  preseason seasonType=1 and dual-MNF scenarios added to the Pick'em matrix
  (~16); dual-MNF ENGINE change explicitly out of scope (product decision).

## Round 2 — Codex (resumed thread)
VERDICT: REVISE. "Most round-1 blockers were addressed." 4 findings (1 High, 3 Medium).

1. (High) Preseason claimed as wave-1 coverage, but the live create path cannot
   set `seasonType=1`: NFL wizards expose only `season`, `buildNFLPayload`
   omits seasonType, shared NFL schemas don't model it. Simulator-only payloads
   don't de-risk the commissioner path. Fix: add seasonType through
   wizard/schema/payload, or narrow the claim.
2. (Medium) Dual-MNF scenario would "document current behavior" while docs
   define the tiebreaker as COMBINED score of both Monday games and code reads
   only the first (`nflPools.ts:615-617`) — blessing a known doc/code mismatch.
   Fix: fix behavior/docs in this plan or drop dual-MNF from wave-1 claims.
3. (Medium) NFL scenario data-contract work dropped: `TestScenario` has no NFL
   game/week model (`seasonType`, `isMonday`, `spread.value/locked`, per-type
   picks). Fix: explicit schema/data-model step before the matrix.
4. (Medium) `scoreNFLWeek` writes ranks to `pools/{poolId}/entries/{ownerUid}`
   (`nflPools.ts:734-747`); fabricated entries with arbitrary doc IDs would get
   phantom rank writes. Fix: require `docId === ownerUid` + regression test.

### Claude's response
All 4 accepted; plan revised to Rev 3:
- 1 → New item 12: `seasonType` (1/2/3, default 2) added to shared NFL schemas
  (+ functions copy), `buildNFLPayload`, all three NFL create wizards, and
  persisted on the pool. New risk: verify week scoring filters by the pool's
  seasonType before authoring preseason scenarios.
- 2 → New item 13: dual-MNF engine fix pulled INTO scope — docs are the
  contract; engine sums ALL Monday games; scenario asserts documented behavior.
  Removed the "out of scope" carve-out. Flagged danger-list (scoring engine).
- 3 → Item 8b added: explicit NFL scenario data model (game/week with
  seasonType/isMonday/spread, per-type pick shapes) before matrix authoring.
- 4 → Entry-doc invariant added to item 10: fabricated NFL entry docs use
  `docId === ownerUid`, locked with a regression test.
Downstream items renumbered (ATS decision now item 14; matrix 15; groups 16;
Phase 3 = 17-19); cross-references updated.

## Round 3 — Codex (resumed thread)
VERDICT: REVISE. "Most round-2 blockers are fixed on paper." 4 findings (2 High, 2 Medium).

1. (High) Cleanup as "recursive delete the pool tree" is impossible client-side
   AND insufficient: creation writes outside the pool tree
   (`writePoolCreationSideEffects` → users/{uid}/managedPools, participations,
   activity; `joinNFLPool` adds a participation), and rules forbid client
   deletes of `audit`, writes to `weekly_recaps`, and any client access to
   `participations`. Fix: test-only Admin-SDK cleanup callable keyed by
   pool/run, or move suite to emulators.
2. (High) Fabricated-entry writes are NOT sim-scoped in practice: rules allow
   SUPER_ADMIN entry writes on ANY pool (`firestore.rules:193-204`) — one
   simulator bug could inject entries into a real prod pool. Fix: test-only
   callable asserting target is a current-run `sim-` pool, or a mandatory
   hard-stop guard on every direct write.
3. (Medium) Plan says edit `shared/` AND `functions/src/shared`, but the latter
   is GENERATED (`copy-shared.mjs`, blown away every build/predeploy) —
   source-of-truth drift by plan. Fix: `shared/` is sole editable source;
   verify generated copy post-build.
4. (Medium) Dual-MNF "sum all Monday games" still undefined when SUPER_ADMIN
   scores mid-Monday (`scoreNFLWeek` allows scoring with active games,
   `nflPools.ts:578-581`): one-final-one-live freezes a partial total. Fix:
   gate MNF tiebreak resolution on all-Monday-FINAL or make it provisional
   with required rescore.

### Claude's response
All 4 accepted; plan revised to Rev 4:
- 1 → Item 8e rewritten: cleanup is a test-only Admin-SDK callable
  (`cleanupSimPool`, SUPER_ADMIN-only) deleting the pool tree AND user-side
  index/activity docs; refuses any pool outside the `sim-` namespace. Client
  deleteDoc cleanup declared impossible in "why" detail.
- 2 → New item 8f "Sim write guard": fabricated-entry writes via test-only
  callable (or mandatory client hard-stop) that fetches the pool and refuses
  non-current-run-sim targets; new NFL simulators never do raw writes; existing
  sims migrate opportunistically.
- 3 → New "Contract-source rule" section: repo-root `shared/` sole editable
  source; `functions/src/shared` generated; both "(+ functions copy)" phrases
  removed from items 12 and 18; verification asserts generated copy matches.
- 4 → Item 13 extended: MNF tiebreak must not resolve until every Monday game
  is FINAL (rescore recomputes); scenario covers one-final-one-live week.

## Round 4 — Codex (resumed thread)
VERDICT: REVISE. 4 findings (2 High, 2 Medium).

1. (High) The new `sim-` scoped cleanup/guard model doesn't match reality:
   legacy simulators (squares, bracket, bracketE2E, playoff, props) don't
   create `sim-` pools at all — `cleanupSimPool` would refuse the suite's own
   artifacts, and old unsafe paths remain in the final full run. Fix: uniform
   `sim-<runId>-` marker mandatory for every suite-created pool; migrate ALL
   existing simulators before any production suite run.
2. (High) Raw SUPER_ADMIN writes to live `tournaments` and pool docs remain
   outside the guard (rules allow them anywhere; simulators write pool status,
   tournaments, results directly) — a bug can still overwrite
   `tournaments/mens-2025` or mutate a real pool on prod. Fix: every
   non-callable simulator mutation of pools/tournaments/subcollections behind
   server-side guarded test callables or synthetic IDs; no raw prod writes.
3. (Medium) Contradictory contract language: item 10 still said "direct sim-
   backdoor writes" while 8f offered a client-guard fallback and
   "opportunistic" legacy migration — not real enforcement for a known
   corruption path. Fix: guarded server callable mandatory; raw-write language
   removed; legacy migration required before final suite gate.
4. (Medium) Item 13's rescore path assumes rerunnable scoring, but
   `scoreNFLWeek` is not idempotent for Survivor: reruns append duplicate
   `exemptWeeks`, re-increment `strikesUsed`, duplicate audit events
   (`nflPools.ts:660-766`). Fix: idempotent per (poolId, week) with deduped
   audit, or ban reruns except a Pick'em-only tiebreak recompute.

### Claude's response
All 4 accepted; plan revised to Rev 5:
- 1+3 → Item 8f rewritten as "Sim harness contract (mandatory, no fallback)":
  uniform `sim-<runId>-` prefix on EVERY suite artifact (pools, tournaments,
  games, entries); all non-product-callable mutations through SUPER_ADMIN
  test-only callables enforcing the namespace server-side; client-side guard
  explicitly rejected as enforcement; legacy simulator migration a MANDATORY
  precondition for any prod run of the expanded suite. Item 10 raw-write
  language replaced with reference to 8f callables.
- 2 → Folded into 8f: no simulator may reference a real tournament/game doc
  ID; raw client writes removed from all simulators.
- 4 → Item 13 extended: `scoreNFLWeek` made idempotent per (poolId, week) —
  recompute-from-scratch (set, don't increment), deduped audit writes,
  regression test scoring the same week twice asserting identical state.
  Danger-list, own commit.
- Process-gates note updated: sim- rules backdoor untouchable only until 8f
  migration completes; tightening becomes possible follow-up afterward.

## Round 5 — Codex (resumed thread, FINAL — cap reached)
VERDICT: REVISE. 2 findings (1 High, 1 Medium).

1. (High) The mandatory namespace rule has no concrete persisted marker for
   real-callable NFL pools: `createPool`/`createNFLPool` generate random doc
   IDs server-side and the NFL create contract has no slug/namespace field —
   `cleanupSimPool` and the guarded callables have nothing trustworthy to
   authorize against. Fix: persist a `simRunId`/`simNamespace` field via the
   create callables; authorize against the field, not an ID prefix.
2. (Medium) 8e/8f callables are the highest-blast-radius additions in the plan
   but weren't marked danger-list, and no `admin_audit` requirement despite
   the repo's forensic-trail contract. Fix: danger-list 8e/8f, emulator tests
   for namespace refusal / non-sim rejection, `admin_audit` entry for every
   sim cleanup/mutation attempt (runId, targets, outcome).

### Claude's response
Both accepted; plan revised to Rev 6:
- 1 → Item 8f: trust anchor changed from ID prefix to a persisted `simRunId`
  field, stamped by the create callables only when the caller is SUPER_ADMIN;
  all cleanup/mutation callables authorize against the field. ID prefix
  retained only as naming convention where the harness controls the ID.
- 2 → Process gates: 8e/8f explicitly danger-list; emulator tests required for
  non-sim rejection, wrong-runId rejection, non-SUPER_ADMIN rejection; every
  attempt (success or refusal) writes `admin_audit` with runId, target paths,
  outcome.

## Resolution
CONVERGED at cap (5 rounds, not deadlocked in substance). 25 findings total
(11 → 4 → 4 → 4 → 2), 100% accepted, zero disputes; finding scope narrowed
monotonically from plan-killing premise errors (round 1: props/playoff were
scenario bugs; ATS unimplemented; cleanup aspirational) to hardening details
(round 5: field-vs-prefix trust anchor, audit logging). No APPROVED verdict
was issued before the cap; Claude's position: rounds 1-4 findings are fully
incorporated and round 5's two findings are incorporated in Rev 6, leaving no
known open issue. Next gates per mmp-change-control Rule 3: sweep pass
(PLAN-TEST-SUITE-SWEEPS.md), then Kevin sign-off (one DECISION NEEDED: item 14
ATS in wave 1 vs cut) before implementation.

## Addendum — Rev 7 rebase on buy-flow overhaul (PR #144), 2026-07-07
Not a review round; a baseline update after ~14k-line buy-flow merge landed
post-review. Changes reviewed: all 7 wizards gained a LaunchStep
(estimatedPlayers + addons in every create payload); server-side
computeLaunchMode stamps free vs trial billing at create; joinNFLPool enforces
the free 10-participant cap + paid ceiling; new money surface (quote engine,
coupon reservation, entitlements, ledger, alerts) with its own tests; #141
schema fixes verified to have survived the merge. Plan updates:
- Phase 0: deploy state now UNCERTAIN (live-UAT implies possible deploy) —
  verify with functions:list before deploying; a functions deploy now ships
  buy-flow functions, coordinate with docs/archive/MORNING-CHECKLIST-BUYFLOW.md
  (rules + indexes pending); Phase 0 steps renumbered 0.1-0.5.
- Item 10: sim pools pin launch mode 'free' (no paid addons, no oversized
  estimate); sim runs never write monetization collections; ≤10 users when
  joining via the real callable.
- Item 12: seasonType composes with readLaunchFields; extend build*Payload
  tests.
- Item 15: +3 buy-flow interaction scenarios (free stamp, 11th-join rejected,
  trial stamp create-only).
- Item 18: UPSET anchor moved to CreateBracketPool.tsx:44; Upset Bonus is a
  scoring setting, must not route through paid addons.
- Out of scope: the buy-flow money engine itself (own test suite from #144).
