# TAKEOVER — NFL Sim Harness overnight build (2026-07-10)

Everything below was built overnight on branch **`feat/nfl-sim-harness`** in worktree
`D:\march-melee-pools\.claude\worktrees\nfl-sim-harness` (main checkout untouched; prod
untouched — nothing deployed). Plan of record: `PLAN-NFL-SIM-HARNESS.md` (Codex-approved,
round 4/5). This doc = what got built, the proof, and your exact steps.

---

## TL;DR of the night

- **Phases 0, 1, 2, 3, 4-core, and 6 of the plan are BUILT and green.** Phase 5 (8f legacy
  migration + rules-backdoor removal) was deliberately left for a supervised session —
  deleting Firestore-rules backdoors at 4am without you was the wrong risk.
- **Verification totals:** functions tsc ✅ · app tsc ✅ · **410 unit tests** (35 files) ✅ ·
  **38 emulator tests** ✅ · app prod build ✅. Every phase committed separately with its
  own verification evidence in the commit message.
- **A real pre-existing PROD bug was found and fixed** by the first-ever real-path golden
  run (details below — this alone justified the harness).

## The prod bug the harness caught (read this first)

`submitNFLPicks` wrote `confidence: undefined` for every **non-confidence pick'em pool**.
The Firestore serializer throws on literal `undefined` (this project deliberately does not
set `ignoreUndefinedProperties`), so **every pick submission to a `confidenceMode: false`
pick'em pool failed with INTERNAL — in production, today**. Nobody ever saw it because no
real picks have been submitted yet (preseason) and nothing ever exercised the real submit
path (the exact blind spot ADR 0006 called out; same bug class as the PR #152 weekly-recap
P0). Fixed in commit `e7b9b01` with the established conditional-spread idiom.
**This fix alone is worth deploying before the preseason live test.**

## What was built, per phase

| Phase | What | Commit |
|---|---|---|
| 0 | 8 sim-safety fixes: finalize-sweep sim exclusion (`isSimPool`), inline-finalize suppression (`allowSim`), profile-trigger short-circuit on entry `simRunId`, commissioner-aggregate sim exclusion (both predicate mirrors) + self-healing recompute on cleanup, `simUpdatePool` namespace-field immutability, run-scoped sim uids (`sim-<runId>-…`), `simRuns/{runId}` manifest + manifest-driven cleanup (incl. phantom-parent consensus purge via tracked `stWeeks`), honest zero-residue contract | `2d1c226` |
| 1 | `shared/simGen.ts` (seeded deterministic season generator incl. confidence), `shared/simOracle.ts` (independent expected-outcome oracle), headless emulator scenario runner through WRAPPED callables + real `scoreNFLWeek`, per-week game keys (multi-week fixtures were structurally broken), `startOffsetMs`, `generator` block, zero-assertion refusal, 7 new persisted-schema-exact assertion types | `87f449e`, `14bbc2a` |
| 2 | ADR 0006 extractions: `joinNFLPoolInternal` / `submitNFLPicksInternal` / `executeSurvivorRebuyInternal` with the `{actorUid, actorRole, subjectUid, subjectName, requestId}` contract; guarded `simJoinMembers` / `simSubmitPicks` / `simExecuteRebuy`; **the prod bug fix**; sim-season consensus scoping | `e7b9b01` |
| 3 | `simFinalizePool` (the only `allowSim` door); payouts→profile arc golden (real `recordPoolPayouts`, profile shows rank 1 + profit); 18-week survivor golden with REAL mid-season rebuy, oracle agreement; 18-week pick'em accumulation golden; rescore-idempotency gate | `e7b9b01`, `83cd182` |
| 4-core | Automated settings matrix: 7 cells (STRAIGHT / STRAIGHT+conf / ATS / ATS+conf / survivor strikes 0 & 2 / margin), each a generated season through the REAL scorer asserted equal to the oracle — all green first run | `a6d36ea` |
| 6 | `sweepSimRuns` callable (dry-run default) + Operations tab cards; stranded-run emulator gate | `aa819b0` |

## What was deliberately NOT done (needs you)

1. **Phase 5 — 8f legacy migration + firestore.rules backdoor removal.** Rules changes,
   unsupervised, at night = no. The two backdoors (`slug matches '^sim-.*'` create;
   `isSuperAdmin()` raw entry writes) are still in `firestore.rules`, still SUPER_ADMIN-only.
2. **Phase 4 hand-authored edge fixtures** (~2 dozen: tie games, exact-spread pushes,
   missed-pick weeks, dual-MNF, pickLosers/autoSurvive, cancelled-game VOIDs, rebuy-flow
   JSON scenarios, buy-flow stamps). The plan requires each edge's expected values be
   **human-verified** — authoring them without you would violate the oracle-honesty rule.
   The infrastructure they slot into is fully built.
3. **Browser Test Suite run of a generated season** — the picker works with existing
   fixtures; generated-season JSON entries ship with the edge-fixture authoring above.
4. **Deploy** — your gate, steps below.

---

## YOUR STEPS (in order)

### A. Review + merge the PR

1. Open a terminal (any directory).
2. I pushed the branch and opened a **draft PR** — link is in my end-of-session message
   (also: `gh pr list` from `D:\march-melee-pools` shows it). Review it in GitHub.
3. When satisfied, mark Ready + merge via GitHub UI (squash or merge — your convention has
   been squash for single-topic branches, merge-commit for phase stacks; this is a phase
   stack: **use "Create a merge commit"** or ask me to restack).
4. After merge, in `D:\march-melee-pools` (repo root, main checkout):
   ```
   git checkout main
   git pull origin main
   ```

### B. Deploy (functions first — order matters)

⚠️ Coolify auto-rebuilds the frontend on push to `main` — that covers the frontend part
(Operations cards). The FUNCTIONS need an explicit deploy:

5. In `D:\march-melee-pools` (repo root, on updated `main`):
   ```
   npm --prefix functions install
   ```
6. Deploy the changed/new functions:
   ```
   npx firebase deploy --only functions:submitNFLPicks,functions:joinNFLPool,functions:executeSurvivorRebuy,functions:nflFinalizeSweepJob,functions:onEntryChangedRecomputeProfile,functions:consensusRefreshJob,functions:recomputeConsensus,functions:simStartRun,functions:simWriteEntries,functions:simUpdatePool,functions:simSeedNFLGames,functions:cleanupSimPool,functions:simJoinMembers,functions:simSubmitPicks,functions:simExecuteRebuy,functions:simFinalizePool,functions:sweepSimRuns --project gridiron-gamble-uzuqo
   ```
   (Or `--only functions` for everything — slower but simpler.)
7. Wait for `Deploy complete!`.

### C. Post-deploy verification (10 min)

8. Hard-refresh www.marchmeleepools.com (Ctrl+F5), log in as SUPER_ADMIN.
9. **SuperAdmin → Operations**: confirm the two new cards exist — "Sweep Stranded Sim
   Runs (dry run)" and "Sweep Stranded Sim Runs". Click the **dry run** one; Run Log
   should report `stranded: 0` (or list genuinely stranded old runs — sweep them with the
   execute card if so).
10. **SuperAdmin → Test Suite → NFL scenarios**: run `Pick'em Basic (Straight)`,
    `Survivor Basic`, `Margin Basic` — all three should go green end-to-end against prod
    (they now run with run-scoped uids + manifest + full cleanup).
11. Firestore console: confirm a `simRuns/{runId}` doc appeared for each run with
    `status: CLEANED`.

### D. nflFinalize kill-switch (now safe to arm)

Phase 0 closed the sweep's sim-pool hazard, so arming is now safe **after B completes**:

12. Firestore console → `system/config` → add/edit field:
    `nflFinalize: { enabled: true, dryRun: true }` (map with two booleans).
13. It runs daily 08:30. After a day or two, check `admin_audit` for
    `NFL_FINALIZE_SWEEP` entries; when the dry-run candidate lists look right, flip
    `dryRun: false`.

### E. Next work session (say the word and I start)

- **Phase 5**: 8f legacy migration + rules-backdoor drop (supervised).
- **Phase 4 edge fixtures**: I generate each edge scenario + computed expectations; you
  sanity-check the expectations (that's the human-verification step); I wire them into
  both runners.
- **Player Profiles grill** (`PROMPT-GRILL-PLAYER-PROFILES.md`) — still queued.
- **Security/observability plan** — ON HOLD until this ships (your call, in memory).

## Where everything lives

- Worktree: `D:\march-melee-pools\.claude\worktrees\nfl-sim-harness` (branch `feat/nfl-sim-harness`)
- New server code: `functions/src/simHarness.ts` (harness + sweep), `functions/src/lib/simNamespace.ts`,
  extractions in `functions/src/nflPools.ts`, guards in `functions/src/nflFinalize.ts` /
  `functions/src/userProfile.ts` / `functions/src/lib/poolInclusion.ts` / `functions/src/consensus.ts`
- Shared: `shared/simGen.ts`, `shared/simOracle.ts`
- Tests: `functions/src/__tests__/simSafety.test.ts`, `simGenOracle.test.ts`, and emulator
  `simHarness / scenarioRunner / goldenArc / phase3Arc / settingsMatrix .emulator.test.ts`
- Browser: `src/utils/testing/scenarios/index.ts`, `src/utils/testing/simulators/nflSeasonSimulator.ts`,
  `src/utils/poolSport.ts`, `src/components/admin/OperationsPanel.tsx`
- Run tests yourself (from the worktree root):
  ```
  npm --prefix functions test
  npm --prefix functions run test:emulator   (needs Java on PATH; see HANDOFF env notes)
  ```
