# Plan: Super-Admin Dashboard — Full Control, Gap Closure & Consolidation
_Locked via grill-with-docs + 5 Codex rounds — by Claude + Kevin. Terms per CONTEXT.md. Compiled 2026-07-05 from a live production walkthrough + four parallel code reviews._

## Implementation status (overnight 2026-07-05 → 07-06, branch `fix/superadmin-phase0-control`)
**DONE + verified locally (typecheck/build/tests green), NOT deployed — see PHASE0-DEPLOY-CHECKLIST.md:**
- ✅ Phase 0.1 — crash fix (SimulationDashboard SQUARES-only + guards) + `formatPoolMatchup` + per-type card render (commit 42c7c57)
- ✅ Phase 0.2 — per-tab ErrorBoundary (fallback + resetKey)
- ✅ Phase 0.3 — `sim-*` rules tightened to isSuperAdmin (interim); `system_logs` locked functions-only + `logClientError` callable (App-Check-gated); invalid `PUBLISHED` status → `OPEN`
- ✅ Phase 0.4 — non-canonical `'ADMIN'` authz branches removed (espnBracket ×2)
- ✅ Phase 1.1 — derived `closed` lifecycle state + CLOSED filter chip + per-row status badge (commit 1b2fc55)
- ✅ Phase 1.2 — `computeAdminHealthSnapshot` helper + hourly `scheduledHealthCheck` + `health/latest` persistence + client hydrate/last-checked (commit 0a412f4)
- ✅ Phase 1.3 — Global Props seed editor as modal (commit d8928e0)
- ✅ Phase 2.6 — Tournament Simulator moved from global header into Test Suite; `/tournament-sim` route guarded (commit 1b2fc55)
- ✅ Members filters — client-side name/email search + role/method/sort (partial 3.1; commit dc5e75a)
- ✅ Partial 2.3 — Maintenance Mode toggle now confirmed
- ✅ Phase 2.1 (core) — global fixPoolScores + scoreBracketEntries → Operations; System-tab dups removed (commit a6ead5f)
- ✅ Phase 2.4 (the race) — bracket entry delete routed through the atomic `deleteBracketEntry` callable; client entryCount math removed (commit 719f141)
- ✅ Phase 3.2 (actions) — Member popup now has Email / Reset Password / Edit User (commit 797e38b)
- ✅ Test Suite — scenarios segmented by pool type + per-scenario description (commit 0a79e4e)
- ✅ IA decisions (commit 7ceed05): [1] conference re-init lives only in Operations (Tournament-tab banner removed); [2] March Madness re-init stays tournament-scoped on the Tournament tab (no hardcoded-season Operations button) + Operations pointer note; [3] Export Emails moved System → Members

- ✅ Phase 2.1 (core) — added global `fixPoolScores` + `scoreBracketEntries` cards to Operations; removed the System-tab duplicates (Fix Scoring / Fix Participants / Init Big East) + their dead handlers

**PENDING (needs product decisions, new callables, and/or deploy — left for sign-off):**
- Phase 2.1 (remainder) — **DECISION NEEDED:** conference re-init location (you said "put Big12/BigEast on the Tournament screen"; CONTEXT.md says Operations is the sole home for init — pick one). Relocate Export Emails from System → Members. Remove the Tournament-tab Big 12 panic banner once its home is settled.
- Phase 2.2 — Re-init March Madness: no param-less callable exists (adminInitTournament needs tournamentId/season/gender); today it's the per-tournament "Re-initialize Skeleton" in TournamentManager. Decide whether to add a dedicated MM Operations card or point users at the Tournament tab.
- Phase 2.4 (remainder) — pool-settings save + paid-status toggle direct client writes (non-racy) → callables; Phase 2.5 legacy-callable auth standardization on `assertCallerRole` + audit
- ✅ Phase 3.1 — server-side `searchName` field (onUserCreated + syncAllUsers backfill) + `searchUsersByEmail` now matches name OR email; client server-search placeholder updated. (Needs deploy + one Force Sync to backfill existing users.)
- Phase 3.2 remainder — in-popup field editing, pools-JOINED list, per-user activity log
- Test Suite — author NFL pick'em/survivor/margin scenarios (+ simulator support); the type groups already render once they exist
- NFL Schedule → NFL Pools management buildout
- Phase 4/5 — health/monitoring hardening, dead-code + config reconciliation, canonical-role migration (5.6)

---


## Goal
Make the Super-Admin Dashboard a surface where a SUPER_ADMIN has complete, safe, legible control of the platform: every card wired to real data, every button working and non-crashing, every capability in exactly one tab (per the CONTEXT.md 8-tab contract), every destructive action behind an explain-then-confirm guardrail and recorded in the Admin Audit Log. Close the specific gaps found in the walkthrough and eliminate the duplicate/legacy surfaces that make the dashboard dangerous.

## Approach
Six phases. Phase 0 stops the bleeding (the live app-wide crash + the security backdoor). Phases 1–5 close gaps and consolidate. Each phase is independently shippable; nothing later depends on a full god-file rewrite landing first.

### Phase 0 — Stop the bleeding (Critical, small→medium)
0.1 **Fix the whole-app crash AND audit all per-pool-type field access (broadened per Codex #6/#7).** The `.squares` crash in `SimulationDashboard.tsx:24/155/256` is one site of a systemic assumption: SuperAdmin treats every non-BRACKET pool as a squares `GameState` in card/secondary views (`SuperAdmin.tsx:3772/3786`) and in the matchup string (`SuperAdmin.tsx:1413` — the "undefined @undefined" bug). Fix: (a) guard `SimulationDashboard` `.squares` with `?? []` and restrict its selector to SQUARES pools; (b) introduce a shared `formatPoolMatchup(pool)` and per-type render branches replacing every `isBracket ? ... : GameState...` assumption. This absorbs the old separate "undefined @undefined" item.
0.2 **Add per-tab ErrorBoundary.** Wrap each tab body so one panel's error shows a localized fallback, not an app outage. (`main.tsx` keeps the outer boundary.)
0.3 **Close the rules backdoor + replace the simulator's direct writes (broadened per Codex #1).** Remove the `slug ^sim-` client-create allowance in `firestore.rules:87`/`:194` and lock `system_logs` create (`:277`) to functions-only. **Preserve client error telemetry (per Codex #1, round 4):** the client currently writes directly to `system_logs` (`errorHandler.ts:95`) — the `[ErrorHandler] CRITICAL` entries seen when the app crashed. Locking the rule would silently kill that telemetry exactly when hardening admin ops. Fix in the SAME phase: add a `logClientError` callable (functions-only write to `system_logs`) and point `errorHandler.ts` at it, so front-end error visibility survives the rule change. **Trust-boundary spec (per Codex #1, round 5):** since `ErrorBoundary`/`errorHandler` are global (`main.tsx:13`, `errorHandler.ts:60`), this callable must NOT be auth/SUPER_ADMIN-gated (that would erase anonymous crash telemetry) and must NOT be a free-form sink (that just moves the `system_logs` hole behind a function). Spec it as: **App-Check-gated, schema-whitelisted fields, size-capped payload, server-stamped (timestamp/severity/source), with optional auth enrichment when a token is present.** The simulator does MORE than create pools — it directly writes `tournaments`, `entries`, status, and deletes (`TournamentSimulator.tsx:157`, `tournamentTestUtils.ts:20`) and seeds an **invalid** bracket status `PUBLISHED` (`TournamentSimulator.tsx:166`; the type/rules only allow OPEN|LOCKED|LIVE|COMPLETED — `src/types/index.ts:667`, `firestore.rules:63`). **SEQUENCING (corrected via sweep — the whole Test Suite depends on this rule).** `simpleTestRunner.ts` runs ALL five simulators (squares/bracket/props/playoff/bracketE2E) against real Firestore from the live Test Suite, plus `TournamentSimulator` and `simulationUtils`. They only work because of the `sim-` backdoor. Naively removing it kills the entire Test Suite. Both the pool-create rule (`:87`) and the entries-write rule (`:194-198`) ALREADY have an `isSuperAdmin()` branch, and only admins run the Test Suite. So:
- **Phase 0 (now, one-line-ish, zero Test-Suite breakage):** tighten `firestore.rules:87` `sim-` create from `request.auth != null` → `isSuperAdmin()`, and drop the `sim-`+`ownerUid==auth.uid` sub-clause from the entries write rule (`:194-198`), leaving `allow write: if isSuperAdmin()`. This closes the privilege-escalation vuln (arbitrary authed users can no longer inject pools/entries) while the admin-run Test Suite keeps working via the existing `isSuperAdmin()` path. Also fix the invalid `PUBLISHED` status in `TournamentSimulator.tsx:166`.
- **Phase 2 (deferred, larger):** ship the **complete simulator server API** — audited SUPER_ADMIN test-only callables covering setup (create/publish), submit-bracket, advance, score, reset, clear, load-tournament-only, load-at-round-N — replacing every client direct-write in `TournamentSimulator.tsx:157/178/274/406/410/425/527/543`, `tournamentTestUtils.ts:24/51/64`, `simulationUtils.ts:53/112/184`, and the 5 simulators (`bracketSimulator`, `bracketE2ESimulator`, `playoffSimulator`, `propsSimulator`, `squaresSimulator`). Then the `sim-` create branch can be removed entirely (admins go through callables). Consolidate the split bracket create/publish paths (`bracketPools.ts:20/146`) into the ADR-0001 unified path, or make that a hard prerequisite. Because separate bracket create/publish paths still exist (`bracketPools.ts:20/146`), either consolidate them into the ADR-0001 unified path as part of this work **or declare ADR 0001 landing a hard prerequisite of 0.3** — do not assume it is already unified. Sequence rule-removal + callables together so the simulator never breaks.
0.4 **Delete the `'ADMIN'` role branch** in `espnBracket.ts:987` (non-canonical per CONTEXT.md) — a pure guard hardening, NOT a role-rename. All canonical-role migration (PARTICIPANT/POOL_MANAGER still written live in `firestore.rules:222`, `participant.ts:32`, `poolCreation.ts:62`) is explicitly DEFERRED to 5.6 to avoid partial normalization (Codex #10). Delete plaintext test secrets in `functions/.env` and rotate them.

### Phase 1 — Wire the cards & fix visible bugs (High, small)
1.1 **Pools tab: surface the CLOSED lifecycle state (corrected per Codex #5/#9).** The `closePool` callable AND close buttons already exist (`SuperAdmin.tsx:616` detail modal, `:3630`); the walkthrough saw only "Lock Pool" in the row, not "Close." The real gap is visibility: `getPoolLifecycleState` (`poolSport.ts:40`) returns only open|locked|live|final and **collapses `COMPLETED`/`closedVia` into `final`**, while `closePool` stores `COMPLETED` (`poolExceptions.ts:397`). Fix: add a distinct derived `closed` state keyed off `closedVia === ADMIN_CLOSE` (keep raw `COMPLETED` as the stored status — no repo-wide status migration), then add a Pool Lifecycle State column/badge (incl. CLOSED) + a CLOSED filter chip, and expose a consistent list-level close control.
1.2 **Overview: persist + schedule Health Snapshots (corrected per Codex #3/#4).** Extract a pure `computeAdminHealthSnapshot()` helper from the current `onCall` wrapper (`adminHealth.ts:106` requires `request.auth` SUPER_ADMIN, so a scheduler cannot call it directly); call it from both the callable and a new hourly `onSchedule`. **Storage design (single, decided):** one admin-only `health/latest` Firestore doc holding the newest snapshot plus a bounded in-doc `history` array (last N, e.g. 24), with a functions-only-write / SUPER_ADMIN-read rule (none exists today). No separate collection, no TTL infra — bounded by design. (Chosen over a TTL-backed collection for simplicity and bounded cost.) **Both** the hourly scheduler **and** the manual "Run Check" callable write to this same doc, so the UI's last-run timestamp + history are never stale after a manual probe. API Status Center reads `health/latest` for current status + last-run + short history.
1.3 **Global Props: gear opens a modal** (not a top-of-page form) so editing a low seed doesn't require scrolling up. (The old 1.3 "undefined @undefined" item merged into 0.1.)

### Phase 2 — Consolidate the guardrails (Critical→High, medium)
2.1 **One home for destructive ops — but replacement-before-deletion (gated per Codex #8).** Operations tab (`OperationsPanel`) becomes the sole home for initialize/import/sync/backfill/score/fix (per CONTEXT.md). Codex confirmed Operations currently has **no** equivalent for several legacy buttons — global `fixPoolScores` (`SuperAdmin.tsx:2762`), `scoreBracketEntries` (`:666`), NFL schedule import, and Export Emails (`dbService.ts:1226`). Rule: **do not delete a legacy button until its verified Operations equivalent exists.** Add the missing Operations cards first, then remove the System-tab Fix Scoring / Fix Participants / Init Big East and the Tournament-tab Big 12 re-init banner. **Export Emails is not a destructive op** — relocate it to the Members (or a marketing) surface with an audit entry, not Operations.
2.2 **Complete the Operations set.** Add **Re-init March Madness** and re-init for other Pool types; give Big 12 / Big East re-init a consistent home (Operations, mirrored read-only status on the Tournament tab). Add an explicit **live "Audit Participant IDs"** action paired with the existing dry-run, each clearly labeled with what a real (non-dry-run) audit does.
2.3 **Every destructive op uses the same modal.** Extend the typed-`RUN` ConfirmActionModal (with blast-radius text) to any remaining unguarded destructive action; ensure all write to the Admin Audit Log on success AND error.
2.4 **Full privileged-write inventory → audited callables (broadened per Codex #2).** Inventory EVERY admin/test `addDoc|setDoc|updateDoc|deleteDoc` on privileged data and move it server-side before claiming the dashboard is "audited." Specifically the stale-client `entryCount` math (`SuperAdmin.tsx:191`) races the transactional `FieldValue.increment()` in `bracketEntries.ts:96/390` — entry count must be adjusted server-side, transactionally, not on the client. Covers pool settings, entry paid-status, entry delete + count.
2.5 **Standardize admin auth** on `assertCallerRole` across the legacy tournament callables (`espnBracket.ts`, `conferenceTournaments.ts`, `bracketOps.ts`); add audit entries there.
2.6 **Relocate the Tournament Simulator into the Test Suite (per Codex #2, round 4 — a CONTEXT.md contract fix, not an open question).** CONTEXT.md defines Test Suite as the sole home for testing/simulation tools, yet the red Tournament Simulator button is mounted in the global dashboard header (`SuperAdmin.tsx:1170`) and thus shows on every tab. Remove it from the header; access to the simulator lives only in the Test Suite tab. **Also close the second surface (per Codex #2, round 5):** the standalone `/tournament-sim` route is separately mounted outside the admin shell (`App.tsx:420`), contradicting the "sole home" rule — remove that route, or guard it and redirect into the Super-Admin Test Suite tab.

### Phase 3 — Member system upgrade (High, large)
3.1 **Search by username AND email — needs schema + backfill (corrected per Codex #11).** Today the only indexed search field is `searchEmail` (`userManagement.ts:228`, `userSync.ts:30`); there is no stored `username`/`searchName`. Decide first whether "username" means display name or a true handle, then add a normalized `searchName` field, **backfill it in `syncAllUsers`**, and only then build the name-prefix query alongside the existing email-prefix one. Confirmed gap: searching "Moriarty" returns nothing today.
3.2 **Filters**: role, registration method, date created (and referral count).
3.3 **Robust member detail modal**: editable profile fields, trigger Password Reset, send one-off Email, view Activity Log, pools joined + owned. Today the popup is read-only and thin.
3.4 **Clarify the header buttons** with tooltips/labels: Force Sync (reconciles Auth→users), Recalculate Stats (global stats recompute), Refresh List. Recommend moving Recalculate Stats out of Members (it duplicates the Operations card) — Members shouldn't recompute global stats.

### Phase 4 — Test Suite maturity & NFL Pools (High, large)
4.1 **Segment the Test Suite by Pool type** with a section per type (SQUARES, BRACKET, NFL_PLAYOFFS, NFL_PICKEM, NFL_SURVIVOR, NFL_MARGIN, PROPS). Each test shows what it does and when to use it.
4.2 **Add the missing pool-type tests** (NFL pick'em/survivor/margin/playoffs currently absent; bracket is over-represented at 9 of 15 scenarios).
4.3 **Audit every Test Suite button** for crashes/no-ops after the Phase 0 fix; the "Open Simulation Dashboard" fix is validated here.
4.4 **Rebuild "NFL Schedule" → "NFL Pools" tab**: keep the ESPN importer + spread override, add an imported-schedule viewer (per week/status) and management of the hosted NFL pool types linked to that schedule.

### Phase 5 — Scale & hardening (Medium, mixed)
5.1 `reminders.ts` (and other schedulers) → indexed queries, not full-collection `.get()`.
5.2 Move `waitlist` out of the pool god-doc into a subcollection; authenticate + throttle `joinWaitlist`/`createClaimCode`; enforce App Check server-side.
5.3 Paginate admin pools/users; lazy-load heavy admin panels; split `vendor-firebase` chunk.
5.4 **Extract `SuperAdmin.tsx`** (4,321 lines) into per-tab modules under `components/admin/tabs/`.
5.5 Reconcile dependency + Node versions (firebase-admin major, Node 20/22); `npm ci` in Docker; write ARCHITECTURE.md; delete dead code + ~~stale `src/nginx.conf`~~ (**DELETED 2026-07-29**); clean up the duplicate "Men's 2025" tournament selector entry.
5.6 **Canonical-role migration (split out per Codex #10).** The codebase still writes legacy `PARTICIPANT`/`POOL_MANAGER` role values live (`firestore.rules:222`, `functions/src/participant.ts:32`, `functions/src/lib/poolCreation.ts:62`, `authService.ts`, `userSync.ts`). Do this as ONE deliberate migration: deploy the cleaned writers, run an **audited role backfill** over existing user docs + claims, then switch role-filtered Members queries (`where('role','==',...)`) to canonical values. Until this lands, do NOT partially rename roles — canonical queries would silently miss legacy docs.

## Key decisions & tradeoffs
- **Consolidate before rewrite.** We fix the crash and de-duplicate ops (Phases 0–2) before the big god-file extraction (5.4). This delivers safety fastest and de-risks the extraction (fewer duplicate paths to move).
- **Health Snapshot persistence via a single admin-only `health/latest` doc** (newest snapshot + bounded in-doc history array), written by both the scheduler and the manual Run Check, so history survives refresh and cost is bounded without TTL infrastructure. Trade-off: hourly scheduled granularity (manual probes add points on demand).
- **Simulator writes go through a guarded callable**, not client-side rules — closing the `sim-` backdoor without losing the simulator. Trade-off: the simulator becomes SUPER_ADMIN-only server-side (acceptable; per CONTEXT.md, simulation belongs in the Test Suite anyway).
- **Operations is the single home for destructive actions.** Everything else references or mirrors it read-only.

## Risks / open questions
- Removing the `sim-` rule may break the current TournamentSimulator until its callable exists — sequence 0.3 as rule-removal + callable together, not separately.
- Recalculate Stats appears in both Members and Operations — confirm it should live only in Operations (recommended).
- The Tournament tab shows "Active, 0 teams, last sync succeeded" for Big 12 with a hardcoded panic banner — recommend removing the hardcoded banner and driving state from data; confirm.
- Empty NCAA Bracket / Gameday Squares / Prop Sheets pricing tiers in Monetization — confirm the intended fallback and that end users never see blank/$0 pricing (BillingPanel also auto-writes DEFAULT_BILLING_CONFIG on read if the doc is missing — verify this is intended).
- (Resolved — now plan item 2.6: relocate the global-header Tournament Simulator button into the Test Suite per the CONTEXT.md contract.)

## Out of scope
- Full rewrite of the pool-creation wizard (tracked separately as wizard unification Phase B).
- Non-admin end-user UX overhaul (tracked in PLAN-UX-OVERHAUL.md).
- Migrating off Firestore or changing the deploy topology.
- Marketing/SEO redesign beyond fixing the known default-canonical bug.
