# Plan Review Log: Pre-Season Readiness + Super-Admin Overhaul

Act 1 (grill-with-docs) complete — the audit brief fully specified requirements; codebase questions were resolved by direct inspection (7 parallel evidence agents + live build/lint/test runs) rather than user interview, per skill rule "if a question can be answered by exploring the codebase, explore the codebase instead." CONTEXT.md required no glossary changes (existing terms match usage); no new ADRs met the 3-part bar (decisions are reversible or already specced in PLAN-USER-MGMT.md). Plan locked in PLAN-SUPERADMIN-OVERHAUL.md. MAX_ROUNDS=5.

## Round 1 — Codex
VERDICT: REVISE. Findings (paraphrased; full text preserved by reviewer):
1. Sim runs leak into prod side-effects — triggers/email/stats fire unconditionally (statsTrigger.ts:46, postGameEmail.ts:35, billing.ts:309); slug-based rules are the only sim hook. Fix: mandatory isSimulation guards on every trigger or emulator-only runs.
2. Playoff migration into shared `entries` subcollection conflicts with ownerUid-keyed rules/readers (firestore.rules:185-198, bracketEntries.ts:58,83) vs playoff userId keying. Fix: dedicated playoff_entries or normalize first.
3. Five-role cutover under-scoped — legacy enums still written in 7+ places (userSync.ts:37, participant.ts:31, poolOps.ts:117-118, nflPools.ts:82-84, auth.ts:28, types/index.ts:515, rules:222). Fix: grep-zero sweep + alias layer as hard prerequisite.
4. maintenanceMode guarding only creates leaves join/pick/pay flows live — flag still mostly fake. Fix: shared guard across all state-changing callables or rename flag.
5. testHarness "drives real callables" impossible cleanly — flows are auth-bound onCall handlers, not services. Fix: extract service layer; both callables and harness call services.
6. closePool auth "Super Admin or Pool owner" narrower than repo principal owner-or-manager (rules:34-49); adjacent plumbing exists in poolExceptions.ts cancelPool. Fix: centralize on ownerId||managerUid||SUPER_ADMIN, extend existing layer.
7. Health checks at wrong layer — mail queue not client-readable (rules:300-301). Fix: one privileged getAdminHealthSnapshot callable.
8. admin_audit canonical trail specified write-only — no shape/index/reader/retention; zero references in repo today. Fix: define all four before wiring actions.

### Claude's response
Accepted all 8; plan revised:
- Approach §3: health via getAdminHealthSnapshot callable (was client probes).
- Approach §4: closePool = ownerId||managerUid||SUPER_ADMIN, extends poolExceptions layer.
- Approach §5: admin_audit schema {actorUid, actorEmail, action, targetType, targetId, params, result, at}, indexes, System-tab reader, 12-month retention.
- Approach §6: maintenanceMode via shared assertNotMaintenance() on ALL state-changing callables.
- Approach §7: grep-zero legacy-enum sweep + alias layer as hard prerequisite to setUserRole.
- Approach §8: dedicated pools/{id}/playoff_entries subcollection with its own rules block (not shared entries).
- Approach §10: service-layer extraction prerequisite; trigger-level isSimulation guards + emulator leak-test as prerequisite; emulator-only fallback documented.
- Key decisions updated to record tradeoffs for sim isolation, health callable, lifecycle layering.
Nothing rejected.

## Round 2 — Codex
VERDICT: REVISE. Prior 8 confirmed addressed ("Most prior blockers are now actually addressed"). New findings:
1. `/mail` "queue depth" not a real signal — sendEmail() writes no pending/sent state (reminders.ts:54-61). Fix: extension-owned delivery-status metric.
2. closePool lacks lifecycle precedence vs CANCELED (poolExceptions.ts:342-392 writes status:"CANCELED") — sweep could overwrite canceled→completed. Fix: CANCELED terminal; close/sweep skip terminal states.
3. admin_audit raw params/result = unbounded payload + PII leakage on role/email/reset/export actions. Fix: redacted size-capped metadata + status/error summaries.
4. testRuns has no schema/rules/index/retention and zero repo surface. Fix: specify all now.
5. "shared DEFAULT_FLAGS" impossible — client and functions are incompatible TS roots/module systems (tsconfig.app.json vs functions/tsconfig.json). Fix: shared package OR duplicated defaults + parity test + declared source of truth.

### Claude's response
Accepted all 5; plan + tickets revised:
- §3/T3: email health via Trigger-Email extension delivery.state counts (PROCESSING/ERROR 24h + last error), not raw /mail count.
- §4/T2: CANCELED terminal; closePool + autoClosePools reject/skip terminal states; acceptance test added (sweeping CANCELED leaves CANCELED).
- §5/T7: admin_audit shape now {…, metadata (redacted, ≤1KB, per-action registry subset), status, error, at} — no raw params/results.
- §10/T12: testRuns fully specified (doc shape, write:false rules + SUPER_ADMIN read, (poolType, startedAt desc) index, 90-day TTL).
- §6/T5 + flag design section: DEFAULT_FLAGS duplicated; functions copy = source of truth; root vitest parity test gates drift in CI.
Nothing rejected.

## Round 3 — Codex
VERDICT: REVISE. Round-2 fixes confirmed ("materially addressed"). New:
1. Canonical COMPLETED status invisible to non-admin surfaces — BrowsePools.tsx:81,305, ManagerDashboard.tsx:205, ParticipantDashboard.tsx:236 derive open/live/closed from isLocked/scores.gameStatus, not status. Fix: closePool dual-writes legacy fields or consumers updated.
2. delivery.state contract has no repo-local evidence — external extension assumption. Fix: verify sample + fallback metric before locking health payload.
3. testRuns assertions {expected, actual} unbounded — doc-size/PII risk. Fix: truncated summaries + artifacts subcollection.

### Claude's response
Accepted all 3:
- §4/T2: closePool dual-writes status + isLocked/isFinal/scores.gameStatus:'post'; acceptance extended to the three non-admin surfaces; consumer normalization folded into T4.
- §3/T3: delivery.state flagged as external assumption; verify one real /mail doc first; fallback metric defined.
- §10/T12: assertions → expectedSummary/actualSummary ≤256 chars; full artifacts in testRuns/{runId}/artifacts.
Nothing rejected.

## Round 4 — Codex
VERDICT: REVISE. New:
1. Dual-write legacy fields are trigger-watched: onPoolLocked (statsTrigger.ts:10,46) increments stats/global on any isLocked flip with pot logic that only understands bracket/playoff/squares; onGameComplete (postGameEmail.ts:35,58) fires on any scores.gameStatus→'post' and writes postGameEmailSent. Admin close would corrupt stats + send stray email. Fix: guard both triggers or avoid trigger-watched fields.
2. testRuns/{runId}/artifacts has no access/retention spec; Firestore parent rules don't secure subcollections (repo uses explicit nested matches, rules:89,95). Fix: explicit artifacts rules block + size/retention.

### Claude's response
Accepted both:
- §4/T2: closePool adds closedVia:'ADMIN_CLOSE' in the same update; onPoolLocked + onGameComplete early-return on closedVia + pool-type guards (defense in depth, shared with T12 sim guards); acceptance: admin close ⇒ zero stats/global deltas + zero mail writes (emulator test).
- §10/T12: artifacts subcollection gets explicit rules block (SUPER_ADMIN read, write:false, ≤200KB docs, 90-day TTL).
Nothing rejected.

## Round 5 — Codex (MAX_ROUNDS cap)
VERDICT: REVISE. Round-4 fixes confirmed addressed. One new Medium:
1. recalculateGlobalStats (statsTrigger.ts:115) recomputes every isLocked==true pool with squares-only pot math for non-BRACKET/NFL_PLAYOFFS types — admin-closed NFL/PROPS compat-locks would be counted with wrong economics or zero. Fix: exclude closedVia:'ADMIN_CLOSE' locks or add NFL/PROPS pot math before dual-write ships.

### Claude's response
Accepted; folded into §4/T2 (recalculateGlobalStats exclusion/pot-math prerequisite + acceptance: post-close recalc leaves totals unchanged). Nothing rejected.

## Resolution — cap reached (5/5), no APPROVED emitted
Not fake convergence: Codex's final round contained exactly ONE new Medium finding, itself now incorporated; all 19 findings across 5 rounds were accepted and folded into the plan (0 rejected). Codex explicitly confirmed each prior round's blockers as addressed. Residual position: no known unresolved disagreements — the loop terminated on round count, not on substance. Plan is final in PLAN-SUPERADMIN-OVERHAUL.md; tickets synced in AUDIT-REPORT-PRESEASON.md; user sign-off required before any implementation.
