# Plan: NFL Pool Simulation Harness — preseason live-test confidence
_Locked via grill-with-docs — by Claude + Kevin. Terms per CONTEXT.md (Sim Run, Test Pool, Scenario, Golden Scenario, Scenario Oracle). ADR 0006._

## Goal

Extend the existing Test Suite simulation harness so that, before the preseason live test, every
NFL pool type (Pick'em, Survivor, Margin) is certified end to end by Scenarios with explicit
assertions: simulated Members make picks through the real submission path, the real scoring
engine grades them, and the post-scoring machinery (standings projection, Season Finalization,
Payout Records, Player Profile recompute) produces outcomes that match an independent Scenario
Oracle. All simulated data is namespaced to a Sim Run and fully removable; a Sim Run must never
touch, count toward, or leave residue in real play. Completes PLAN-TEST-SUITE item 15 (the
combinatorial matrix) and the 8f legacy-simulator migration mandate.

## What already exists (extend, don't rebuild)

- Guarded harness callables (`functions/src/simHarness.ts`): `simWriteEntries`, `simUpdatePool`,
  `simSeedNFLGames`, `cleanupSimPool` — persisted-`simRunId` trust anchor, sim-uid prefix
  enforcement, `admin_audit` on every attempt, `season='sim-<runId>'` game namespace.
- Declarative Scenario fixtures (`src/utils/testing/scenarios/*.json`) + typed assertions +
  `nflSeasonSimulator.ts` (create via real `createNFLPool` → seed → fabricate entries → REAL
  `scoreNFLWeek` per week → hydrate → cleanup in `finally`) + Test Suite tab picker UI.
- 3 basic NFL scenarios (one per type) already green; squares/bracket/playoff/props basics exist.
- Firestore-emulator vitest infrastructure in `functions/` (`test:emulator`).
- New assertion targets from Player Profiles (PR #153): graded per-pick outcomes in
  `weeklyResults[week]`, `pools/{id}/standings/current`, `nflFinalize.ts` + `seasonHistory`,
  `payoutRecords` + `recordPoolPayouts`, `publicProfiles` recompute.

## Approach

### Phase 0 — Sim-safety gap fixes (prod-safety; danger-list; deployable independently)
1. **Finalize sweep sim exclusion is broken:** `nflFinalizeSweepJob` filters candidates by
   `d.id.startsWith('sim-')`, but NFL Test Pools have server-generated doc IDs — only their
   `season` (`sim-<runId>`) and `simRunId` field mark them. A scored, stranded Test Pool WOULD be
   finalized once the kill-switch is armed. Fix: exclude on `simRunId` presence OR
   `season` sim-prefix. Unit test: scored sim pool never a candidate.
2. **Inline finalization fires during sim scoring (Codex R1 #2):** `scoreNFLWeek` auto-calls
   `maybeFinalizeNFLPool` after scoring, so a full-season Sim Run writes `seasonHistory` and
   triggers profile recomputes for sim subjects mid-run — before any cleanup and regardless of
   the sweep fix. Fix: `maybeFinalizeNFLPool` short-circuits when the pool carries `simRunId`;
   finalization in sims becomes an explicit, audited `simFinalizePool` step (Phase 3).
3. **Sim entries + profile trigger:** stamp `simRunId` on every sim-created entry
   (`simWriteEntries` and the Phase 2 sim callables); `onEntryChangedRecomputeProfile`
   short-circuits on `before/after.simRunId` BEFORE any pool read — a pool-read guard is racy
   on deletes (the trigger fires during `recursiveDelete` after the parent pool doc is gone
   and would recreate `publicProfiles` post-cleanup; Codex R1 #8).
4. **Commissioner aggregates contaminated (Codex R1 #3):** creating a Test Pool seeds a REAL
   owner Member Record, and `onMemberRecordWrite` recomputes `commissionerAggregate`;
   `isActivePoolForStats` excludes only `sim-*` ids/slugs, not `simRunId`-marked pools. Fix:
   extend the predicate (functions `lib/poolInclusion.ts` AND the client mirror
   `src/utils/poolSport.ts`) to honor `simRunId`/sim-season, and force an owner-aggregate
   recompute during `cleanupSimPool`.
5. **`simUpdatePool` can break the namespace (Codex R1 #4):** `season`, `seasonType`, and
   `type` are patchable today — mutating them re-points scoring/consensus at a real namespace.
   Fix: add them to `SIM_PATCH_FORBIDDEN`; additionally every sim scoring/submission helper
   re-verifies `pool.season === simSeason(runId)` before acting.
6. **Run-scoped sim uids (Codex R1 #6):** today's fabricated uids are name-derived
   (`sim-user-alice`) — two concurrent or successive runs collide on `publicProfiles`/
   `seasonHistory`/`users` docs. Fix: all simulated subjects become `sim-<runId>-u<n>`;
   `simWriteEntries` enforces the run-scoped prefix (not just `sim-`).
7. **Cleanup residue coverage, manifest-driven (Codex R1 #7):** a `simRuns/{runId}` manifest is
   created at run start and appended as the run creates things (`poolIds`, `simUids`, game/
   consensus keys, scenario id, status). `cleanupSimPool` (and the Phase 6 sweep) delete FROM
   THE MANIFEST — never by discovery from `participantIds` or surviving pool docs, which miss
   entry owners and orphans once the pool doc is gone. Cleanup covers: pool tree (recursive),
   user-side docs for real uids (existing), and for every manifest sim uid: `publicProfiles/
   {uid}` + `users/{uid}` recursive; plus the run's `nfl_games` and site-wide consensus docs.
   Audit counts per category.
8. **Zero-residue contract, stated honestly (Codex R1 #10):** `admin_audit` entries are the
   forensic trail and are EXEMPT from the zero-residue claim by design — they must survive
   cleanup. The manifest doc itself survives with status `CLEANED` (it IS the run record).
   Everything else matching the run must be gone; the emulator residue test asserts exactly
   this contract.
9. Acceptance: emulator tests for all of the above; deploy is its own gate (these fixes must
   land BEFORE Kevin arms `system/config.nflFinalize` live).

### Phase 1 — Scenario format v2, Scenario Oracle, headless emulator runner
10. Extend `TestScenario` (`scenarios/index.ts`): optional `generator` block
    (`{ seed, weeks, entryCount, gamesPerWeek, strategy }`), `actions` timeline
    (`[{week, action: 'rebuy'|'rescoreWeek'|'submitLate', uid}]`), and new assertion types
    **matching the persisted schemas exactly (Codex R1 #9)**: `gradedPick`
    (uid/week/gameKey → Pick'em `W|L|PUSH|VOID`, Survivor `SURVIVED|STRUCK|VOID`, margin
    signed value), `standingsRow` (type-specific: assert the fields `standings/current`
    actually stores per pool type — no invented universal rank; the Oracle computes ordering
    from stored points when a scenario asserts placement), `seasonHistoryRow`,
    `payoutRecordExists`, `profileField`, `consensusTally`, `submitRejected` (uid/week →
    expected error code). Schema rule: a Scenario with zero assertions is INVALID — the
    runner refuses it (no "ran = passed").
11. **Multi-week game keys (Codex R1 #5):** the current `translateGameKeys` flattens week-local
    `gN` keys into one global map — `week 2 / g1` overwrites `week 1 / g1`, so any multi-week
    Pick'em fixture is structurally broken. Fix: fixture keys become `w<week>-g<n>`; the
    translator, existing 3 NFL fixtures, generator, and Oracle all move together in one commit.
12. **Deterministic generator:** own PRNG (mulberry32-style, seed in fixture — never
    `Math.random`), generates weeks×games with scores and per-entry picks by strategy
    (`favorites`, `random`, `contrarian`, per-type variants). Same seed ⇒ byte-identical fixture.
13. **Scenario Oracle** (`src/utils/testing/oracle/`, pure TS, shared-friendly): computes expected
    weekly points / eliminations / margins / placements / payout splits from the fixture alone.
    MUST NOT import engine code (`nflScoringEngine`, `scoreNFLWeek` helpers) — independence is the
    point; divergence is a finding. Oracle covers: straight + ATS w/ pushes + VOID (canceled
    games), confidence, survivor strikes/exemptions/rebuys/sudden-death, margin accumulation +
    ties, weekly/season/hybrid payout places, MNF tiebreakers (incl. dual-MNF combined rule).
14. **Headless emulator runner:** a functions-side executor (`functions/src/__tests__/emulator/
    scenarioRunner.emulator.test.ts` + a shared driver module) that runs any Scenario against the
    Firestore emulator by invoking the deployed handlers' internals directly (existing emulator
    test pattern), including REAL `scoreNFLWeek`. The browser simulator and the emulator runner
    consume the SAME fixture format (fixtures move to a location both can import; `copy-shared`
    pattern already exists). CI gate: the full matrix runs in `test:emulator`.
15. Acceptance: the 3 existing NFL basics pass identically in browser AND emulator adapters
    (on the new `w<week>-g<n>` keys); one generated full-season fixture round-trips
    deterministically (same seed, same oracle expectations, two consecutive runs byte-identical).

### Phase 2 — Real-path member actions (ADR 0006; danger-list)
16. **Sim enrollment first (Codex R1 #1):** the real path REQUIRES membership —
    `submitNFLPicks` enforces `assertNFLPickMembership`, `recordPoolPayouts` only accepts
    `participantIds`, and `recomputeUserProfile` enumerates `users/{uid}/participations`.
    Extract the join flow into `joinNFLPoolInternal(db, uid, poolId)` and add a guarded
    `simJoinMembers` callable (SUPER_ADMIN + `simRunId`-verified + run-scoped-uid-enforced +
    audited) so simulated Members are enrolled exactly as real ones (participantIds, Member
    Record, participations). Membership is then enforced against the SUBJECT sim uid — the
    internals take an explicit subject, never inherit the SUPER_ADMIN caller's identity.
17. Extract `submitNFLPicksInternal(db, uid, payload)` and `executeSurvivorRebuyInternal(...)`
    from the public callables — behavior-preserving refactor, own commit, emulator regression
    proving the public callables' auth/validation behavior is unchanged.
18. New guarded callables `simSubmitPicks` / `simExecuteRebuy` in `simHarness.ts`: SUPER_ADMIN +
    `simRunId`-verified pool + run-scoped sim uid enforced + audited; delegate to the internals;
    stamp `simRunId` on the entries they create (Phase 0.3 contract).
19. **Lock-timing assertions become real:** Scenario games carry `startTime` offsets relative to
    run start; Golden Scenarios assert `submitRejected` for post-kickoff submissions
    (WEEK_LOCKED / GAME_LOCKED paths), pre-lock submissions succeed, and per-game vs weekly
    lock modes behave per settings. Consensus assertions (`consensusTally`) verify the
    post-submit recompute against the oracle's tally.
20. Acceptance: one Golden Scenario per NFL type runs create → simJoinMembers → members submit
    via real path → locks enforced → score → standings assert, green in both adapters;
    emulator regression on the public callables green.

### Phase 3 — Full post-score arc (finalize → payouts → profiles)
21. **`simFinalizePool` guarded callable (Codex R1 #2):** inline finalization is suppressed for
    Test Pools (Phase 0.2), and `maybeFinalizeNFLPool` is not otherwise reachable from the
    browser — so finalization in a Golden Scenario is an explicit, audited `simFinalizePool`
    step (SUPER_ADMIN + `simRunId`-verified) invoking the same internal, never the sweep.
22. Golden Scenarios extend through the arc: `simFinalizePool` → assert `finalRanks`/
    `seasonHistoryRow` vs oracle → `recordPoolPayouts` as the run's admin with oracle-computed
    places → assert `payoutRecordExists` + amounts → guarded profile recompute for a sim
    subject (explicit call — the trigger is sim-suppressed by Phase 0.3) → assert
    `profileField` (record, best finish, profit) vs oracle.
23. **Season-length goldens via generator:** 18-week survivor (elimination arc, rebuy at
    deadline week via `simExecuteRebuy`, last-man-standing), 18-week pick'em
    (season+weekly+hybrid payouts), margin season with tie weeks. Rescore-idempotency action
    (`rescoreWeek`) asserts identical state after a double score (PLAN-TEST-SUITE item 13
    contract).
24. Acceptance: full-arc goldens green in emulator CI; the same goldens runnable from the Test
    Suite tab against prod as the pre-preseason smoke; the Phase 0.8 residue contract holds
    after cleanup.

### Phase 4 — Matrix completion (PLAN-TEST-SUITE item 15)
25. Author the remaining combinatorial Scenarios (direct-write path for speed):
    **Pick'em ~16** (pickMode{STRAIGHT,ATS} × payoutMode{SEASON,WEEKLY,HYBRID} ×
    confidence{on,off}, ATS-push / tie-game / missed-picks / weekly-tiebreaker edges folded in;
    2 lockMode lifecycle scenarios; preseason seasonType=1; dual-MNF tiebreaker),
    **Survivor ~13** (pickLosersMode × autoSurviveExemption × maxStrikes{0,2}; rebuy flow;
    all-eliminated week, duplicate-team rejected, tie game, last-man-standing),
    **Margin ~5** (payoutMode ×3, margin-tie, season tiebreak),
    **Buy-flow interaction 3** (free-launch stamp assert; free-plan 11th join rejected;
    trial stamp on create — never entering the paid path; per item 15).
26. Test Suite tab: grouped scenario picker per type (exists), "Run all NFL", per-assertion
    result rows; the `simRuns/{runId}` manifest (created at run start, Phase 0.7) is finalized
    with per-assertion pass/fail, durations, and cleanup status — it doubles as run history.
27. Acceptance: full matrix green in CI; tab shows grouped results; a deliberately-broken
    scoring branch (local mutation test) turns the right scenario red.

### Phase 5 — 8f legacy migration + rules-backdoor removal (bounded)
28. Migrate the legacy simulators off raw client writes onto guarded callables: squares
    `SimulationDashboard` (grid fill / game sim / winners) and NCAA tournament seeding
    (`seedTestTournament` / `simulateRound` / `resetTournament` in `simulationUtils.ts`,
    `testEntryGenerator` entry writes). New guarded callables as needed (e.g. `simFillSquares`,
    `simSeedTournament` — tournament writes stay explicitly SUPER_ADMIN + audited; the
    tournament doc is shared test infrastructure, not a Test Pool, and is called out as such).
29. Drop the two `firestore.rules` backdoors: the `slug matches '^sim-.*'` client-create
    exception and the `isSuperAdmin()` raw entry-write allowance — after migration, client
    code needs neither. Emulator rules tests prove: SUPER_ADMIN client can no longer raw-create
    a sim- pool or raw-write entries.
30. Acceptance: every existing squares/bracket/playoff/props scenario green through the
    migrated path; rules tests green; no client code performs raw pool/entry writes.

### Phase 6 — Residue sweep + run reporting polish
31. Operations action "Sweep stranded Sim Runs": lists `simRuns` manifests not marked
    `CLEANED` (plus a safety-net query for pools where `simRunId` exists but no manifest —
    pre-manifest strays), surfaces age + scenario, one-click manifest-driven cleanup per run
    (dry-run list first, explain-then-confirm, audited — Operations guardrail conventions).
    Manifest-driven means orphaned off-pool docs are recoverable even after the pool doc is
    gone (Codex R1 #7).
32. Acceptance: strand a run deliberately (kill mid-scenario), sweep finds and fully cleans it
    including off-pool residue; the manifest marks the run `SWEPT`.

## Key decisions & tradeoffs

- **NFL 3 types deep for v1** (Kevin): finish item 15's matrix + the new arc; squares/bracket/
  playoffs/props keep existing basics (bracket has its own simulator; March is far).
- **Fidelity split** (ADR 0006): Golden Scenarios drive the REAL submission path via extracted
  internals + guarded sim callables; bulk matrix keeps direct writes. Supersedes the recorded
  8f "picks callable not exercised" tradeoff.
- **Deterministic generator + independent Scenario Oracle** over hand-authoring seasons or
  random fuzzing: exact assertions, reproducible reds, no oracle/engine circularity.
- **Full post-score arc in scope** (finalize/payouts/profiles) — the newest, least-battle-tested
  machinery is exactly what preseason confidence needs. Finalization in sims is always an
  explicit call; the sweep never processes Test Pools (Phase 0 fix).
- **Emulator CI is the matrix home; prod runs are a curated smoke** — full matrix on every
  scoring-engine change without touching prod; the browser Test Suite proves the deployed
  stack end to end before the live test.
- **8f migration + rules-backdoor removal included, bounded** — this effort owns the guarded-
  callable surface, so the standing mandate lands here, not in the on-hold security plan.
- **Assertions are mandatory** — the runner rejects assertion-less Scenarios by schema.
- **Manifest-driven lifecycle (Codex R1):** `simRuns/{runId}` is created at run start and is
  the single source of truth for what a run created; cleanup and the stranded-run sweep delete
  from it, never by discovery. `admin_audit` is exempt from zero-residue by design; the
  manifest survives as the run record.
- **Simulated Members are enrolled, not faked (Codex R1 #1):** the real submission path
  requires membership, so Golden Scenarios join sim subjects through the extracted real join
  internal; internals take an explicit subject uid and enforce against it.

## Risks / open questions

- `submitNFLPicks` / `executeSurvivorRebuy` / join-flow extraction touches danger-list files.
  Mitigation: behavior-preserving refactors, own commits, emulator regression before anything
  else builds on them (Phase 2 gate).
- The Scenario Oracle re-implements scoring semantics; a shared misunderstanding could make
  oracle and engine agree on the same wrong answer. Mitigation: oracle expectations for the
  hand-authored edge scenarios are human-verified (they're small); the certified-suite unit
  tests remain the authoritative spec cross-check.
- Emulator runner imports function internals — module-load side effects (admin.initializeApp
  ordering) are a known repo gotcha; the existing emulator setup file pattern handles it, but
  new imports may surface more.
- Consensus recompute now fires on real-path sim submits (`submitNFLPicks` → per-week
  recompute); Phase 0.3's cleanup covers the residue, but throttling many golden submits in one
  run may be slow against prod — acceptable for a curated smoke set.
- Sim uid pattern (`sim-*`) collides with nothing today (expert ids are `expert_*`; Phase 1 of
  PR #153 proved non-collision) — keep the prefix test in place as callables are added.

## Out of scope

- New squares/bracket/playoff/props scenario authoring (basics only, migrated in Phase 5).
- Load/performance testing; Playwright member-flow E2E; AI testing dashboard changes.
- Monetization paths beyond item 15's three stamp/negative assertions (sim runs never enter
  the paid path; launch mode pinned `free`).
- Arming `system/config.nflFinalize` (Kevin's live decision, after Phase 0 ships).
- The on-hold security/observability plan's callable retrofits (separate effort; the
  `validated()` wrapper is not retrofitted onto sim callables here).
