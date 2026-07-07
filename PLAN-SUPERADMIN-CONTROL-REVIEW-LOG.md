# Plan Review Log: Super-Admin Dashboard — Full Control, Gap Closure & Consolidation
Act 1 (grill-with-docs) complete — plan locked (PLAN-SUPERADMIN-CONTROL.md), CONTEXT.md updated with Pool Lifecycle State + Health Snapshot terms. MAX_ROUNDS=5. PLAN_FILE=PLAN-SUPERADMIN-CONTROL.md.

Note: Act 1's interactive grill was run autonomously (user asleep, explicit overnight mandate) — plan synthesized from a live production walkthrough + four parallel code reviews rather than a live Q&A. Open questions are carried in the plan's "Risks / open questions" section for the user to resolve on sign-off.

## Round 1 — Codex (thread 019f35c4-36aa-7313-bbd6-bbda84b27bfe)
VERDICT: REVISE. 11 findings, all accepted (final arbiter: Claude). Summary:
1. (Critical) Phase 0.3 underspecified — simulator does direct privileged writes to tournaments/entries/status/deletes (`TournamentSimulator.tsx:157`, `tournamentTestUtils.ts:20`) and seeds an INVALID bracket status `PUBLISHED` (`TournamentSimulator.tsx:166`; type/rules only allow OPEN|LOCKED|LIVE|COMPLETED). Fix: audited test-only callables for seed/advance/reset/clear reusing the ADR-0001 unified path; fix the invalid status.
2. (Critical) Phase 2.4 too narrow — stale-client `entryCount` math (`SuperAdmin.tsx:191`) races transactional `FieldValue.increment()` (`bracketEntries.ts:96/390`). Fix: inventory EVERY admin/test addDoc|setDoc|updateDoc|deleteDoc and move privileged writes server-side before claiming "audited."
3. (High) Health scheduler can't call the `onCall` `getAdminHealthSnapshot` (requires request.auth SUPER_ADMIN). Fix: extract pure `computeAdminHealthSnapshot()` used by both callable + scheduler.
4. (High) Health retention/cost incomplete — no `health_snapshots` rule, Firestore has no capped collection. Fix: single admin-only doc holding latest+bounded history, OR read rules + `expireAt` TTL + hard UI query limits.
5. (High) `CLOSED` state won't render if wiring the existing helper — `poolSport.ts:40 getPoolLifecycleState` returns only open|locked|live|final and collapses COMPLETED/closedVia into `final`; closePool writes `COMPLETED` (`poolExceptions.ts:397`). Fix: add distinct derived `closed` keyed off `closedVia===ADMIN_CLOSE`, keep raw COMPLETED stored.
6. (High) `.squares` fix is one crash site, not a full audit — SuperAdmin treats every non-bracket pool as squares in cards/secondary views (`SuperAdmin.tsx:3772/3786`). Fix: explicit per-type rendering, replace all `isBracket ? ... : GameState` branches.
7. (High) "undefined @undefined" is generic non-bracket shape assumption (`SuperAdmin.tsx:1413` + `3772`), not just NFL rows. Fix: shared `formatPoolMatchup(pool)` by type.
8. (High) De-dup removes capabilities with NO Operations equivalent — Operations lacks global fixPoolScores, scoreBracketEntries, NFL schedule import, and Export Emails. Fix: add verified replacements BEFORE deleting old buttons; move Export Emails to Members/marketing, not Operations.
9. (Medium) Phase 1.1 premise partly wrong — a close action already exists (detail modal `SuperAdmin.tsx:616/3630`); the real gap is lifecycle labeling/filtering + a consistent list-level control. (Reconciles with walkthrough: rows showed "Lock Pool", not "Close".)
10. (Medium) Role cleanup inconsistent — deleting the `'ADMIN'` branch leaves live PARTICIPANT/POOL_MANAGER writes (`firestore.rules:222`, `participant.ts:32`, `poolCreation.ts:62`). Fix: either a full canonical-role migration + backfill, or explicitly DEFER all role-name cleanup — don't partially normalize.
11. (Medium) Username search needs schema/backfill — only `searchEmail` is indexed; no stored `username`/`searchName`. Fix: decide display-name vs true username, add normalized search field, backfill in `syncAllUsers`, then build the query.

### Claude's response
All 11 accepted and folded into PLAN-SUPERADMIN-CONTROL.md. Key changes: 0.1 broadened to a full per-pool-type rendering audit (absorbs the old 1.3 "undefined@undefined" via a `formatPoolMatchup` helper); 0.3 expanded to audited test-only sim callables (seed/advance/reset/clear) + fix invalid `PUBLISHED` status; 0.4 role cleanup DEFERRED to an explicit canonical-role migration item (5.6) rather than partial normalization; 1.1 rewritten to lifecycle labeling/filtering + distinct `closed` state in `getPoolLifecycleState` (close action already exists); 1.2 adds `computeAdminHealthSnapshot()` helper + bounded-history-doc-or-TTL retention + rules; 2.1 gated on "verified Operations replacement exists before deleting any legacy button", Export Emails relocated to Members; 2.4 expanded to a full privileged-write inventory before claiming audited; 3.1 adds a normalized `searchName` field + backfill.

## Round 2 — Codex (resumed thread)
VERDICT: REVISE. Confirmed all round-1 fixes landed. 3 new refinement findings, all accepted:
1. (High) 0.3 still underspecified vs repo — separate bracket create/publish paths still exist (`bracketPools.ts:20/146`); simulator also submits a user bracket + rewrites pool/entry state during advance (`TournamentSimulator.tsx:274/410/425`). Fix: make 0.3 ship a COMPLETE simulator server API (setup/submit/advance/score/reset/clear) OR declare ADR-0001 landing a hard prerequisite.
2. (Medium) Health design self-contradictory — 1.2 offered doc-OR-TTL-collection but Key Decisions still said "capped collection" (not a Firestore primitive). Fix: pick ONE design, purge "capped collection" wording.
3. (Medium) 1.2 didn't state whether manual Run Check persists to the same store the UI history reads — risk of stale "last run" after a manual probe. Fix: manual Run Check writes the same persisted record.

### Claude's response
All 3 accepted. 0.3 now specifies a complete simulator server API (setup/submit/advance/score/reset/clear) and names ADR-0001 consolidation as either in-scope or a hard prerequisite. Health storage decided as a SINGLE `health/latest` admin-only doc (newest + bounded in-doc history array, functions-write/SA-read rule); "capped collection" wording removed from Key Decisions; both scheduler and manual Run Check write the same doc so last-run/history never go stale.

## Round 3 — Codex (resumed thread)
VERDICT: REVISE. Confirmed all round-2 fixes landed. 1 narrow finding, accepted:
1. (High) 0.3 API list missed the simulator's `handleLoadTournamentOnly` (`TournamentSimulator.tsx:527`) and `handleLoadRound` (`:543`), which call direct-write helpers (`tournamentTestUtils.ts:20/38`) and would break after rule removal. Fix: add load-tournament-only + load-at-round-N callables, or delete those controls in the same phase.

### Claude's response
Accepted. 0.3 API scope extended to include load-tournament-only + load-tournament-at-round-N, with an explicit rule: any simulator control not reimplemented server-side is removed in the same phase (no orphaned buttons post-rule-removal).

## Round 4 — Codex (resumed thread)
VERDICT: REVISE. Confirmed round-3 fix landed. 2 findings, both accepted:
1. (High) Locking `system_logs` to functions-only kills client error telemetry — client writes there directly (`errorHandler.ts:95`), the `[ErrorHandler] CRITICAL` entries. Fix: add a server-side client-error logging path (or remove/replace client writes) in the SAME phase as the rule change.
2. (Medium) The global-header Tournament Simulator button is a CONTEXT.md contract violation (Test Suite = sole home for testing), not a "confirm later" open question. Fix: make relocation an explicit plan item.

### Claude's response
Both accepted. 0.3 now adds a rate-limited `logClientError` callable + repoints `errorHandler.ts`, preserving telemetry across the rule change. New explicit item 2.6 relocates the header simulator button into the Test Suite; the corresponding open-question bullet updated to point at 2.6.

## Round 5 — Codex (resumed thread) — FINAL (MAX_ROUNDS=5 reached)
VERDICT: REVISE. Confirmed round-4 fixes landed. 2 adjacent findings, both accepted:
1. (High) `logClientError` under-specified at the trust boundary — global ErrorBoundary/errorHandler means it must NOT be auth-gated (kills anonymous telemetry) nor free-form (moves the hole behind a function). Fix: App-Check-gated, schema-whitelisted, size-capped, server-stamped, optional auth enrichment.
2. (Medium) 2.6 missed the second simulator surface — standalone `/tournament-sim` route still mounted outside the admin shell (`App.tsx:420`). Fix: remove or guard+redirect into Test Suite.

### Claude's response
Both accepted and applied. 0.3 `logClientError` now specced as App-Check-gated / schema-whitelisted / size-capped / server-stamped / optional-auth-enrichment. 2.6 extended to remove-or-guard-and-redirect the standalone `/tournament-sim` route.

## Resolution — CONVERGED (cap reached, not deadlocked)
5 rounds, 19 findings total, **100% accepted, zero disputes**. Finding count and severity fell monotonically (11 → 3 → 1 → 2 → 2) and shifted from core design flaws (auth-gated scheduler, CLOSED-state collapse, de-dup capability loss) to adjacent hardening nits (route duplication, telemetry trust boundary). The loop hit MAX_ROUNDS while Codex kept surfacing ever-narrower edges; a 6th round would likely find another adjacent nit rather than a substantive flaw. No open counter-positions — Claude (final arbiter) agreed with every finding. Plan is locked for sign-off.
