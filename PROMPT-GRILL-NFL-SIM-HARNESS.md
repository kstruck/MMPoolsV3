# Grill prompt — NFL pool simulation harness (preseason live-test confidence)

Paste the block below tomorrow to plan the NFL simulation work. Invokes the
adversarial Codex planning skill. Use `/grill-with-docs-codex`.

---

/grill-with-docs-codex

**Goal:** Design (do not build yet) a comprehensive, config-driven simulation harness that gives 100% confidence EVERY NFL pool type works end-to-end before the preseason live test. It must pre-populate fake test users, drive them through making picks, score those picks, and produce verifiable results — with all data fake (game scores, W/L, etc.). Produce a locked, adversarially-reviewed plan with phases and acceptance criteria.

**Owner's explicit ask:**
- Simulate all NFL pool types (NFL_PICKEM, NFL_SURVIVOR, NFL_MARGIN — and consider SQUARES/BRACKET/NFL_PLAYOFFS/PROPS) in prep for the preseason live test.
- Each sim should: pre-populate fake test users → have them go through making picks → score the picks → verify results.
- Be able to change settings per pool type — or better, provide a LIST of pool types, each with its settings, that populates the pool, runs a week or a full season, and produces VERIFIABLE results (assertions, not just "it ran").
- The owner must be 100% confident every pool actually works.

**What already exists (this is EXTEND, not build-from-zero):**
- `functions/src/simHarness.ts` (PLAN-TEST-SUITE Phase 2, items 8e/8f) — sanctioned SUPER_ADMIN-only mutation callables: `simSeason`, `simWriteEntries`, `simUpdatePool`, `simSeedNFLGames`, `cleanupSimPool`.
  - Safety architecture to PRESERVE: trust anchor is a persisted `simRunId` stamped on Test Pools by the create callables (never an ID/slug prefix). Every callable re-verifies the target against that field and refuses anything outside the sim namespace. Every attempt (success or refusal) writes an `admin_audit` entry. Synthetic NFL games live in the real `nfl_games` collection under `season = "sim-<runId>"` with doc IDs `sim-<runId>-g<n>` — values no real ESPN import produces, invisible to production season/week queries (reminders, status, scoring for real pools).
- `src/components/SimulationDashboard.tsx` — "Pool Simulation" UI (Test Suite tab → "Open Simulation Dashboard"). **Now SQUARES-only by design** (filters `p.type === 'SQUARES'`; the old `.squares` app-wide crash is FIXED — non-squares pools can no longer be selected). Drives the squares lifecycle (fill grid, simulate game, winners). Implication: the NFL harness needs its own run surface; this dashboard is not it.
- `src/components/{SimpleTestingDashboard,TestingDashboard}.tsx`, `src/utils/simulationUtils.ts`.
- `src/components/TournamentSimulator/` (`/tournament-sim`) — full NCAA bracket simulator, already in the Test Suite tab. Distinct from NFL pool sim.
- NFL scoring: `functions/src/nflScoringEngine.ts`, `scoreNFLWeek`; pick submission `submitNFLPicks` in `functions/src/nflPools.ts`; Member Records (ADR 0003).
- **Player Profiles PR #153 landed AFTER this prompt was first drafted — new assertion targets the harness should exploit:** per-pick graded outcomes persisted in `weeklyResults[week]` for all 3 NFL types (scorer derives totals FROM grades); member-readable standings projection at `pools/{id}/standings/current`; automatic Season Finalization (`functions/src/nflFinalize.ts`, `seasonHistory`, kill-switched via `system/config.nflFinalize`, currently OFF/fail-closed); `payoutRecords` + `recordPoolPayouts` callable; `backfillProfileData` migration. A green sim can now assert against graded picks, the standings projection, finalization output, and profile recomputes — far stronger than counts alone. NFL entry reads are tightened to own-only pre-FINAL, which constrains how a browser-side harness can verify entries (server/emulator asserts or the standings projection instead).

**Cleanup already done (context, not a task):**
- The legacy "Simulation Tools" block on SuperAdmin → System → Settings was ALREADY deleted (commit `2e61a9f`, owner-confirmed, deployed). Test Suite tab is now the single home for simulation tooling. Do not re-plan this.

**Design questions the grill MUST resolve:**
1. **Config matrix:** what's the shape of "a list of pool types each with settings" (lock mode, confidence, survivor rebuy, margin rules, entry counts, week vs. full-season)? A declarative fixture the harness iterates?
2. **Fake picks:** should sims write entries directly (`simWriteEntries`, current approach) or exercise the REAL `submitNFLPicks` path (higher fidelity — catches lock/validation bugs — but heavier)? Trade-off and recommendation.
3. **Verifiable results:** define concrete assertions per pool type (e.g. survivor eliminations correct, margin scoring correct, pickem W-L totals match, standings/payout math). What is the pass/fail contract?
4. **Fake users:** how are test users created/represented (real auth users? synthetic uids? existing member-record backfill?) and cleaned up (`cleanupSimPool`) so nothing leaks into prod.
5. **Scoring:** reuse the real `nflScoringEngine`/`scoreNFLWeek` against `season="sim-<runId>"` games so we test the real engine, not a mock.
6. **Run surface:** SUPER_ADMIN-only, in the Test Suite tab, with a run log + per-assertion results + one-click cleanup.

**Constraints / non-negotiables:**
- NEVER touch production data — preserve the `simRunId`/`sim-<runId>` namespace isolation and the audit trail. This is the #1 risk (SUPER_ADMIN rules allow writes to any pool/entry).
- All mutations go through sanctioned callables (extend `simHarness.ts`), never raw client writes.
- Idempotent + fully cleanable — a run leaves no residue after `cleanupSimPool`.
- Reuse real engines (scoring, membership, payouts) so a green sim genuinely means the real pool works.

**Deliverables from the grill:**
- Phased plan (like `PLAN-TEST-SUITE`/`PLAN-POOL-HOMEPAGE`) with the config-matrix schema and per-pool-type assertion contracts.
- Decision on direct-write vs. real-submit-path fidelity.
- Acceptance criteria + verification (emulator tests that run the matrix headless).

Run the full adversarial review. Hammer the prod-safety isolation, the "verifiable" claim (is it really asserting, or just running?), and whether reusing real engines is airtight. Do not write feature code — output the plan.
