# Plan Review Log: NFL Pool Simulation Harness

Act 1 (grill-with-docs) complete — plan locked, CONTEXT.md updated (Sim Run, Test Pool,
Scenario, Golden Scenario, Scenario Oracle), ADR 0006 created (real-path fidelity via
extracted internals). Six decisions taken with Kevin: NFL-3-deep scope; fidelity split
(golden = real path, bulk = direct write); seeded generator + independent oracle;
full post-score arc + 3 sim-safety gap fixes; emulator CI matrix + prod smoke;
8f legacy migration included bounded. MAX_ROUNDS=5.

## Round 1 — Codex

1. The plan cannot actually exercise “real member actions” as written: `submitNFLPicks` requires membership, `recordPoolPayouts` only accepts `participantIds`, and `recomputeUserProfile` enumerates `users/{uid}/participations`, but Phase 2 adds `simSubmitPicks`/`simExecuteRebuy` without any sim join/enrollment path; a naive SUPER_ADMIN-backed internal call would also bypass membership entirely because actor and subject are currently the same value in the callable path. [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:82>) [nflPools.ts](</D:/march-melee-pools/functions/src/nflPools.ts:193>) [nflPools.ts](</D:/march-melee-pools/functions/src/nflPools.ts:254>) [payoutRecords.ts](</D:/march-melee-pools/functions/src/payoutRecords.ts:68>) [userProfile.ts](</D:/march-melee-pools/functions/src/userProfile.ts:59>)  
Fix: add a real sim enrollment path (`joinNFLPoolInternal` or `simJoinMembers`) and pass `{ actorUid, actorRole, subjectUid, subjectName }` to submission internals so membership is enforced against the simulated member, not the SUPER_ADMIN caller.

2. Phase 0’s finalize-sweep fix is insufficient because finalization already happens inline in scoring: `scoreNFLWeek` auto-calls `maybeFinalizeNFLPool`, which writes `seasonHistory` and recomputes `publicProfiles`, so full-season sims will hit real off-pool surfaces before the sweep ever matters; Phase 3’s “explicit `maybeFinalizeNFLPool` call” is also not browser-runnable because only the sweep is exported. [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:32>) [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:94>) [nflPools.ts](</D:/march-melee-pools/functions/src/nflPools.ts:907>) [nflFinalize.ts](</D:/march-melee-pools/functions/src/nflFinalize.ts:157>) [index.ts](</D:/march-melee-pools/functions/src/index.ts:107>)  
Fix: suppress inline finalization for sim pools and expose an audited `simFinalizePool` callable if you want finalization to be an explicit scenario step.

3. Sim pools already contaminate real commissioner aggregates, and the plan never calls that out: create seeds a real owner Member Record, `onMemberRecordWrite` recomputes `commissionerAggregate`, and `isActivePoolForStats` excludes only `sim-*` ids/slugs, not callable-created pools marked only by `simRunId`. [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:11>) [nflPools.ts](</D:/march-melee-pools/functions/src/nflPools.ts:131>) [rosterAggregate.ts](</D:/march-melee-pools/functions/src/rosterAggregate.ts:19>) [commissionerAggregate.ts](</D:/march-melee-pools/functions/src/lib/commissionerAggregate.ts:24>) [poolInclusion.ts](</D:/march-melee-pools/functions/src/lib/poolInclusion.ts:14>)  
Fix: extend every sim-exclusion predicate to honor `simRunId`/`season` and force an owner aggregate recompute during cleanup.

4. `simUpdatePool` is still a prod-safety hole because it can mutate `season`, `seasonType`, and `type`; once that happens, scoring and consensus stop being sim-isolated and start querying/publishing against whatever namespace those fields point at. [simHarness.ts](</D:/march-melee-pools/functions/src/simHarness.ts:140>) [simHarness.ts](</D:/march-melee-pools/functions/src/simHarness.ts:157>) [nflPools.ts](</D:/march-melee-pools/functions/src/nflPools.ts:305>) [nflPools.ts](</D:/march-melee-pools/functions/src/nflPools.ts:521>) [consensus.ts](</D:/march-melee-pools/functions/src/consensus.ts:57>)  
Fix: make `season`, `seasonType`, and `type` immutable in the sim harness and re-verify `pool.season === simSeason(runId)` before any scoring/submission helper runs.

5. Full-season Pick’em scenarios are structurally broken under the current fixture contract: `translateGameKeys` flattens week-local `gN` keys into one global map, so `week 2 / g1` overwrites `week 1 / g1`. [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:52>) [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:99>) [scenarios/index.ts](</D:/march-melee-pools/src/utils/testing/scenarios/index.ts:45>) [nflSeasonSimulator.ts](</D:/march-melee-pools/src/utils/testing/simulators/nflSeasonSimulator.ts:78>)  
Fix: switch Pick’em fixtures/assertions to stable per-game ids, or encode keys as `w<week>-g<n>` and update the translator/oracle together.

6. Sim user ids are not run-scoped today (`sim-user-alice`), which violates the namespace contract and creates cross-run races in `publicProfiles`, `seasonHistory`, and any future `users/{uid}` state. [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:11>) [nflSeasonSimulator.ts](</D:/march-melee-pools/src/utils/testing/simulators/nflSeasonSimulator.ts:142>) [userProfile.ts](</D:/march-melee-pools/functions/src/userProfile.ts:74>)  
Fix: generate run-scoped simulated subject ids (`sim-<runId>-u<n>`) and use those everywhere instead of name-derived stable ids.

7. The cleanup/sweep model cannot satisfy the residue claim because it discovers external docs from the wrong anchors: current cleanup looks only at `participantIds`/owner, while Phase 23 sweeps from surviving pool docs, so it misses current sim entry owners and cannot recover orphaned `publicProfiles`, `seasonHistory`, or consensus after the pool doc is already gone. [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:43>) [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:138>) [simHarness.ts](</D:/march-melee-pools/functions/src/simHarness.ts:230>) [simHarness.ts](</D:/march-melee-pools/functions/src/simHarness.ts:247>)  
Fix: persist a run manifest in `simRuns/{runId}` with `poolIds`, `simUids`, and consensus/game keys, and drive cleanup/sweep from that manifest rather than from `participantIds` or surviving pool docs.

8. The proposed profile-trigger suppression is under-specified and racy: `onEntryChangedRecomputeProfile` fires on deletes too, so cleanup can delete `publicProfiles` and then recreate them from the entry-deletion trigger; a pool-read-based guard fails once `recursiveDelete` has removed the parent. [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:37>) [userProfile.ts](</D:/march-melee-pools/functions/src/userProfile.ts:79>) [simHarness.ts](</D:/march-melee-pools/functions/src/simHarness.ts:247>)  
Fix: stamp `simRunId` on every sim-created entry and short-circuit the trigger from `before/after.simRunId` before any pool lookup.

9. The new assertion schema does not match the actual stored shapes: the plan invents `WIN|LOSS|PUSH` for `gradedPick`, but code/ADR store `W|L|PUSH|VOID` for Pick’em and `SURVIVED|STRUCK|VOID` for Survivor; `standings/current` also does not expose a universal `rank/points/status` row for Pick’em and Survivor. [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:55>) [0005-player-profile-data-model.md](</D:/march-melee-pools/docs/adr/0005-player-profile-data-model.md:34>) [nflPoolTypes.ts](</D:/march-melee-pools/functions/src/nflPoolTypes.ts:192>) [nflPoolTypes.ts](</D:/march-melee-pools/functions/src/nflPoolTypes.ts:223>) [nflScoringEngine.ts](</D:/march-melee-pools/functions/src/nflScoringEngine.ts:527>)  
Fix: make assertions type-specific to the real persisted schema and include `VOID`; if you need rank on Pick’em/Survivor standings, add it server-side first.

10. One acceptance criterion is impossible as written: the plan promises cleanup leaves “zero docs matching the run anywhere we write,” but the harness intentionally writes top-level `admin_audit` entries on every sim callable attempt and never proposes deleting them. [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:19>) [PLAN-NFL-SIM-HARNESS.md](</D:/march-melee-pools/PLAN-NFL-SIM-HARNESS.md:47>) [simHarness.ts](</D:/march-melee-pools/functions/src/simHarness.ts:48>)  
Fix: explicitly exempt `admin_audit` from the zero-residue contract, or route sim audits to a TTL’d test sink.

VERDICT: REVISE
### Claude's response

All 10 findings accepted — every one verified against the code. Plan revised:
1. Sim enrollment: new Phase 2.16 — joinNFLPoolInternal extraction + guarded simJoinMembers;
   internals take explicit subject uid, membership enforced against the subject.
2. Inline finalize: Phase 0.2 — maybeFinalizeNFLPool short-circuits on simRunId; Phase 3.21
   adds the audited simFinalizePool callable as the explicit scenario step.
3. Commissioner aggregates: Phase 0.4 — isActivePoolForStats (both mirrors) honors
   simRunId/sim-season; owner aggregate recompute forced during cleanup.
4. simUpdatePool namespace hole: Phase 0.5 — season/seasonType/type added to
   SIM_PATCH_FORBIDDEN + season re-verification in sim helpers.
5. Game-key flattening: Phase 1.11 — fixture keys become w<week>-g<n>; translator, existing
   fixtures, generator, oracle move in one commit.
6. Run-scoped uids: Phase 0.6 — sim-<runId>-u<n> enforced by simWriteEntries.
7. Manifest-driven cleanup: Phase 0.7 — simRuns/{runId} manifest created at run start;
   cleanup + Phase 6 sweep delete from the manifest, never by discovery.
8. Profile-trigger race on deletes: Phase 0.3 — simRunId stamped on every sim entry; trigger
   short-circuits on entry.simRunId before any pool read.
9. Assertion schema: Phase 1.10 — type-specific values matching persisted shapes
   (W|L|PUSH|VOID, SURVIVED|STRUCK|VOID); no invented universal standings rank; oracle
   computes placement from stored points.
10. Zero-residue honesty: Phase 0.8 — admin_audit explicitly exempt (forensic trail);
    manifest survives as run record; residue test asserts exactly this contract.
Rejected: none.
