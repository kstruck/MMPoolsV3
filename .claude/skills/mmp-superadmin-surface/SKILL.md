---
name: mmp-superadmin-surface
description: "Use when working on the March Melee Pools Super-Admin control plane: the /super-admin dashboard, SuperAdmin.tsx, the 8-tab contract (Overview/Pools/Members/Operations/Test Suite/Monetization/Themes/System), the Operations tab and its explain-then-confirm + admin_audit conventions, admin callables (setUserRole, adminSaveBillingConfig, fixPoolScores, backfillPools, searchUsersByEmail...), the sim- Firestore-rules backdoor, TournamentSimulator, the Test Suite / SimulationDashboard, role gating (SUPER_ADMIN custom claim vs users/{uid}.role, MODERATOR limits, useEnsureAdminClaims/syncMyClaims), or PLAN-SUPERADMIN-CONTROL.md phase status. Symptoms: 'Missing or insufficient permissions' on admin_audit/admin_stats reads, 'undefined @undefined' pool labels, Simulation Dashboard white-screen, 'where does this admin button live', 'is this admin card real or mock', 'can a MODERATOR do X', 'is the sim- rule closed', 'which admin ops are duplicated', adding/moving any admin capability or one-off data action."
---

# MMP Super-Admin Surface — the admin control plane

Scope: everything a SUPER_ADMIN sees and does at `/super-admin`, the server callables behind it, the authorization model, and the in-flight control-plane hardening plan. Repo root: `D:\march-melee-pools`. All line numbers verified against main at commit `a0ff311` (2026-07-06) — re-verify with the commands in "Provenance" if the file has churned.

**Status correction (as of 2026-07-06):** branch `fix/superadmin-phase0-control` is NOT in-flight anymore. It merged to main as **PR #139** (merge commit `53d9872`), followed by `#141` (pool-create schema drift fix) and `#142` (logClientError App Check fallback). `git diff main...fix/superadmin-phase0-control` is empty. Any doc or memory describing that branch as pending-deploy is stale; the current deploy state is in section 8.

## 1. Orientation — where the admin surface lives

| Thing | Location |
|---|---|
| Dashboard component (god file, 4,380 lines) | `src/components/SuperAdmin.tsx` |
| Route + gate | `src/App.tsx` — `/super-admin` renders only if `isSuperAdmin(user)`; `/tournament-sim` gated the same way (App.tsx:421-423) |
| Nav registry (8 groups → 16 sub-tab ids) | `SuperAdmin.tsx:1127` (`navStructure`), sub-tab union type at `:61` |
| Operations panel | `src/components/admin/OperationsPanel.tsx` (213 lines) |
| Overview bento | `src/components/SuperAdminBentoDashboard.tsx` |
| Confirm modal (typed-token guardrail) | `src/components/admin/ConfirmActionModal.tsx` |
| Audit log viewer | `src/components/admin/AdminAuditViewer.tsx` (rendered in System tab, SuperAdmin.tsx:2769) |
| Admin callables | `functions/src/adminOps.ts`, `adminBillingOps.ts`, `adminClaims.ts`, `adminHealth.ts`, `userManagement.ts`, `userSync.ts` (+ ops that live in domain files, see section 6) |
| Rules | `firestore.rules` (repo root) |
| Governing plan | `PLAN-SUPERADMIN-CONTROL.md` (locked 2026-07-05; status header inside it is the DONE/PENDING ledger) |
| Domain glossary / tab contract | `CONTEXT.md` |
| Test Suite known bugs | `TEST-SUITE-BACKLOG.md` |

Anti-clobber guard: a vitest regression test asserts the 8-tab registry, OperationsPanel render, absence of fake-card strings, and index.ts exports — this exists because PRs #116/#117 once silently reverted the entire merged admin overhaul (see mmp-failure-archaeology). Never merge a long-lived branch into the admin surface without re-verifying these invariants against latest main.

## 2. The 8-tab contract

CONTEXT.md defines the Super-Admin Dashboard as **exactly eight tabs**: Overview, Pools, Members, Operations, Test Suite, Monetization, Themes, System. Two contract rules, verbatim from the docs of record:

1. "Every admin capability lives in exactly one tab; no capability is duplicated across tabs."
2. Operations "is the sole home for one-off administrative data actions (initialize, import, sync, backfill, score, fix). Every action runs behind an explain-then-confirm guardrail and is recorded in the Admin Audit Log." Test Suite "is the sole home of simulation and testing tools."

History: the dashboard used to be ~15 flat tabs; PR **#121** (commit `d941b71`, "consolidate 15 admin tabs into the 8 canonical tabs") created the two-level nav — 8 groups whose sub-tabs reuse the legacy render blocks. Verified in git log. When adding any admin capability, first decide which single tab owns it; if it is a one-off data action it goes in Operations, if it is simulation it goes in Test Suite, no exceptions.

Current group → sub-tab map (`SuperAdmin.tsx:1127`):

| Group | Sub-tabs (activeTab ids) | Render blocks |
|---|---|---|
| Overview | `overview`, `stats` | :1238 (bento), :1272 (AdminStatsDashboard) |
| Pools | `pools`, `tournament`, `playoffs`, `props`, `nfl` | :1280, :1261 (TournamentManager), :4055, :3879, :4279 (SuperAdminNFLSpreads at :4373) |
| Members | `users`, `referrals`, `loyalty` | :1554, :1786/:3135, :1898 |
| Operations | `operations` | :1245 → `<OperationsPanel />` |
| Test Suite | `testing` | :2728-2764 |
| Monetization | `billing` | :2939 → `<SuperAdminBillingPanel />` |
| Themes | `themes` | :2334 |
| System | `system`, `settings` | :2766 (AdminAuditViewer + system stats + logs), :2945 |

## 3. Real vs placeholder, per tab (as of 2026-07-06)

| Tab | Real | Placeholder / mock / known-broken |
|---|---|---|
| Overview | Bento has exactly **2 cards, both real** (2 `<h3>` in SuperAdminBentoDashboard.tsx): Platform Ledger (live GlobalStats + Stripe revenue from `admin_stats/revenue`) and API Status Center (hydrates persisted `health/latest` doc, hourly `scheduledHealthCheck` + manual Run Check). The 3 fake theater cards ("A+ CLEAN" security scan etc.) are deleted — regression test asserts their strings absent. Stats sub-tab computes from live pools/users. | — |
| Pools | All Pools list w/ lifecycle badges incl. derived CLOSED state + filter chip (`statusFilter` at :70); TournamentManager; per-pool row actions; NFL Schedule importer + spread override. | Playoffs sub-tab "Reset to 2024-25 NFL Playoff Teams" seeds a hardcoded `MOCK` array — `SuperAdmin.tsx:4080-4096` (line drifted from the older ~4054 citation). It only sets local state until saved. |
| Members | User list + client-side name/email/role/method filters; server search via `searchUsersByEmail` (matches `searchEmail` OR `searchName` prefix); member popup with Email / Reset Password / Edit User; Export Emails button (moved here from System, `handleExportEmails` at :654, button :1660); Force Sync / Recalculate Stats / Refresh header buttons; Referrals real. Loyalty **tier definitions** persist to settings via `settingsService.update({loyaltyTiers})` (:270) — real. | Loyalty "Mock Promo Campaign Creator" is pure theater: modal at `SuperAdmin.tsx:2222-2320` ("MOCK PROMO SENDER MODAL" comment :2222, header :2235), Execute fires `toast.success('Campaign successfully simulated! ...')` at **:2317** with zero backend call. Export Emails has **no confirm and no audit entry** (builds CSV of all users + squarePrivate guest emails client-side) — open gap. |
| Operations | Fully real — 9 callable-backed cards, see section 5. | — |
| Test Suite | SimpleTestingDashboard (scenarios segmented by pool type, per-scenario descriptions); "Open Simulation Dashboard" (SQUARES-only, crash fixed); Tournament Simulator card → navigates to `/tournament-sim` (:2756). | Live "Run All (15)" on 2026-07-07-dated run: **2 pass / 8 fail / 5 error** — parked pre-existing sim bugs in `TEST-SUITE-BACKLOG.md` (bracketSimulator writes 0 entries → 6 tests; props off-by-one; playoff wrong winner; UPSET scoring offered in wizard but unimplemented). 5 schema-drift failures fixed by #141 (needs `createPool` functions deploy — verify). |
| Monetization | SuperAdminBillingPanel backed by audited callables (adminSaveBillingConfig, adminManageCoupon, adminUpdatePoolBilling, adminAdjustUserCredits). | Empty pricing tiers for some pool types flagged as open question in the plan; BillingPanel auto-writes DEFAULT_BILLING_CONFIG on read if doc missing (verify intended). |
| Themes | Real CRUD on `themes` collection (rules: SUPER_ADMIN write). | — |
| System | AdminAuditViewer (`admin_audit`), system stats cards, `system_logs` viewer with filters, Maintenance Mode toggle (now confirm-gated), Settings sub-tab. | — (its former dup ops and Export Emails were relocated) |

## 4. Roles and gating — who can do what

Canonical roles: `SUPER_ADMIN > MODERATOR > COMMISSIONER > MEMBER > BANNED` (rank table `functions/src/adminClaims.ts:15-21`; canonical list in `functions/src/lib/roles.ts` mirrored by `src/utils/roles.ts` with a CI parity test).

Three layers, three different checks — know which one is failing:

1. **Client UI gate**: `isSuperAdmin(user)` in `src/utils/auth.ts:16` reads the normalized **Firestore user-doc role** (from the app User object). This gates the `/super-admin` and `/tournament-sim` routes. UX only — not security.
2. **Firestore rules**: `isSuperAdmin()` in `firestore.rules:17-18` reads ONLY the **custom claim** `request.auth.token.get('role','') == 'SUPER_ADMIN'`. The claim is authoritative. Drift between doc role and claim produces the classic symptom: admin reaches the dashboard but every claim-gated subscription (`admin_audit`, `admin_stats`, `billingCharges`, `health`) fails "Missing or insufficient permissions". Fix path: `useEnsureAdminClaims` (`src/hooks/useEnsureAdminClaims.ts`) calls the self-only `syncMyClaims` callable (mints claim from the rules-protected doc role — no escalation possible) then forces a token refresh; SuperAdmin gates all claim-gated subscriptions on its `ready` flag (SuperAdmin.tsx:50).
3. **Callables**: the best-practice guard is `assertCallerRole(request, 'SUPER_ADMIN')` (`adminClaims.ts:29-50`) which requires **claim AND doc to agree** (blocks stale elevated tokens after demotion). Enforcement is inconsistent across legacy callables — four idioms exist: assertCallerRole (best), claim-only (`token.role !== 'SUPER_ADMIN'`, most common), Firestore-doc-only (weakest — `conferenceTournaments.ts:171-173,359-361`, `bracketOps.ts` updateTournamentData), and espnBracket's doc-role **fallback** when the claim is absent. Standardizing on assertCallerRole is open plan item 2.5. When writing a NEW admin callable, use `assertCallerRole` + `writeAdminAudit` — no exceptions.

**MODERATOR — exact limits (verified in code, as of 2026-07-06):**
- Server allows MODERATOR on exactly two callables: `searchUsersByEmail` (`userManagement.ts:239`) and `sendUserEmail` (`userManagement.ts:278`). Claim-only checks (`role !== "SUPER_ADMIN" && role !== "MODERATOR"`).
- Everything else — role changes, billing, pool state, password resets, deletes — is SUPER_ADMIN-only. Note the discrepancy: CONTEXT.md says MODERATOR can "trigger password resets", but `sendAdminPasswordReset` is guarded SUPER_ADMIN-only in code (`userManagement.ts:86`). Code wins today; treat the CONTEXT.md claim as unimplemented intent.
- **MODERATOR has no UI surface**: `/super-admin` is gated on `isSuperAdmin` only, and no dedicated moderator panel component exists in `src/` (grep `UserManagementPanel` → 0 hits). The PLAN-USER-MGMT dedicated panel was designed but not built.

## 5. Operations tab — conventions and the 9 cards

`OperationsPanel.tsx` is the pattern to copy for any new one-off data action:

1. Each action is an `OpAction` with `label`, `description`, `blastRadius`, `destructive`, and a `run()` that invokes a callable.
2. Clicking Run opens `ConfirmActionModal` showing description + blast-radius text; **destructive actions require typing `RUN`** (`confirmToken` at :205).
3. On success AND error, the panel writes an `admin_audit` entry via `dbService.logAdminAction` (`OP_<ID>` action names, :141/:146) — the underlying callables also enforce their own SUPER_ADMIN guards; `logAdminAction` is a convenience trail, NOT an authz boundary (`adminOps.ts:9-13`).
4. Rule from the plan: "do not delete a legacy button until its verified Operations equivalent exists" and "Operations is the single home for destructive actions. Everything else references or mirrors it read-only."

Current cards (OperationsPanel.tsx:35-126): Recalculate Global Stats, Sync All Users, Backfill Pools, Sync Playoff Pools, Audit Participant IDs (dry run), Fix Participant IDs, Fix Pool Scores (global), Score Bracket Entries (global), Re-init Big 12, Re-init Big East. A footer note explains March Madness re-init is tournament-scoped and lives in Tournament tab → TournamentManager → Re-initialize Skeleton (deliberate IA decision, commit `7ceed05` — not a contract violation).

**Known duplicate / stray ops still open (as of 2026-07-06):**
- Recalculate Stats exists BOTH as the Members-tab header button (SuperAdmin.tsx:1651, calls `recalculateGlobalStats` at :1640, no typed-RUN modal) AND as an Operations card. Plan item 3.4 recommends removing it from Members. Open.
- Per-pool `fixPoolScores`/`scoreBracketEntries` variants remain as Pools-tab row actions **by design** (global variants live in Operations) — not a violation.
- `functions/setUserAdmin.cjs` — a role-escalation one-off script at functions root, contradicting the Operations-sole-home rule. Still present.
- Export Emails (Members) runs with no confirm/audit — flagged, open.

## 6. Admin callable inventory (guards + audit, verified 2026-07-06)

"Audit" = writes `admin_audit` via `writeAdminAudit` (`functions/src/lib/adminAudit.ts` — functions-only writes, secret redaction, 1KB metadata cap, never throws into caller).

| Callable | File | Does | Guard | Audit |
|---|---|---|---|---|
| logAdminAction | adminOps.ts:14 | client-reported audit entry for ops whose callable doesn't self-audit | claim-only SA | yes (that's its job) |
| adminSaveBillingConfig | adminBillingOps.ts:23 | overwrite `settings/billing_config` or `referral_config` | assertCallerRole SA | yes |
| adminManageCoupon | adminBillingOps.ts:48 | create/delete/toggle coupon | assertCallerRole SA | yes |
| adminUpdatePoolBilling | adminBillingOps.ts:89 | billing override / extendTrial(+14d) / resetGrace | assertCallerRole SA | yes |
| adminAdjustUserCredits | adminBillingOps.ts:127 | set referralCredits / freePoolsAvailable | assertCallerRole SA | yes |
| setUserRole | adminClaims.ts:62 | THE role-change path: claim first, doc mirror second, revoke tokens on demotion | assertCallerRole SA | yes (ROLE_CHANGED) |
| setSuperAdminClaim | adminClaims.ts:110 | DEPRECATED passthrough (grant/revoke SA) | assertCallerRole SA | yes |
| syncMyClaims | adminClaims.ts:152 | self-only doc-role → claim bootstrap | authed self only | no |
| backfillUserRoles | adminClaims.ts:184 | legacy-role migration, **dryRun default true**, 400/run | assertCallerRole SA | yes |
| getAdminHealthSnapshot | adminHealth.ts:159 | live integration probes → `health/latest` | claim-only SA | no |
| scheduledHealthCheck | adminHealth.ts:176 | same, hourly schedule | n/a (scheduler) | no |
| deleteUserAccount | userManagement.ts:14 | delete auth user + doc | claim-only SA | UNVERIFIED (check body for writeAdminAudit) |
| sendAdminPasswordReset | userManagement.ts:77 | password-reset email via `mail` | claim-only SA (NOT moderator, despite CONTEXT.md) | logs to user activity |
| searchUsersByEmail | userManagement.ts:234 | prefix search on `searchEmail` OR `searchName`, merged, cap 50 | claim-only SA or MODERATOR | no (read) |
| sendUserEmail | userManagement.ts:273 | one-off email to any user | claim-only SA or MODERATOR | yes + activity |
| sendSecuritySMSAlert | userManagement.ts:164 | SMS to the CALLER (self) if opted in | authed self | no |
| testSmsHttp | userManagement.ts:191 | onRequest, manual SMS test | Bearer token, SA | no |
| syncAllUsers | userSync.ts:58 | Auth → users reconcile + `searchName` backfill | **authed-only** (`userSync.ts:60` — no role check; weakest guard in the set) | no |
| recalculateGlobalStats | statsTrigger.ts:113 | recompute `stats/global` | claim-only SA (:120) | no (panel logs it) |
| backfillPools | backfill.ts:6 | all-pool field/index backfill; **re-running double-counts historical stats — not idempotent, no dry-run** | claim-only SA | no (panel logs it) |
| fixParticipantIds | poolOps.ts | participant-index repair, has dryRun param | SA (via poolOps guards) | pool audit_events |
| fixPoolScores | scoreUpdates.ts:1342 | global/targeted score repair; global mode resets Every-Score-Pays pools mid-run | claim-only SA | pool audit_events |
| scoreBracketEntries | bracketScoring.ts:331 | rescore tournaments/entries | claim-only SA | no |
| syncPlayoffPools | playoffPools.ts | resync playoff standings | SA | no |
| initializeBig12/BigEastTournamentHttp | conferenceTournaments.ts:164/352 | overwrite conference tournament skeleton (misnamed "Http" — they are callables) | **Firestore-doc-role only** (:171-173, :359-361 — weak; plan 2.5) | no |
| updateTournamentData | bracketOps.ts:97 | unvalidated merge-set on any tournament doc | **Firestore-doc-role only — weakest gate + widest blast radius in the codebase** | no |

Related non-admin-but-adjacent: `logClientError` (logClientError.ts) is the anonymous-reachable telemetry sink for `system_logs` — schema-whitelisted, size-capped, server-stamped; `enforceAppCheck` is currently **false** in code (commit `beac092`) with a TODO to re-enable. `autoClosePools` (autoClosePools.ts:26) is the kill-switch + dry-run-default pattern exemplar; per owner it is **LIVE past dry-run in prod as of 2026-07-06** — it actually closes pools daily.

## 7. The `sim-` backdoor — precise current state

What it is: a test affordance in production Firestore rules letting the client create pool docs directly (bypassing the `createPool` callable) when the slug starts with `sim-`.

**Current state on main (= what is deployed to prod, per PHASE0-DEPLOY-CHECKLIST.md + owner confirmation 2026-07-06):**
- `firestore.rules:93` — pool create: `allow create: if request.resource.data.slug.matches('^sim-.*') && isSuperAdmin();` — previously ANY authenticated user; now SUPER_ADMIN-only (Phase 0.3 interim fix). The privilege-escalation/billing-bypass hole is closed.
- `firestore.rules:204` — entries write: `allow write: if isSuperAdmin();` — the former `sim-` + `ownerUid==auth.uid` sub-clause is REMOVED entirely.
- `firestore.rules:295-298` — `system_logs` create locked to functions-only (paired with `logClientError`).

**True blast radius of the remaining `sim-` create branch (verified by grep, 2026-07-06):** exactly ONE caller. `src/components/TournamentSimulator/TournamentSimulator.tsx:157-176` does a client-side `addDoc(collection(db,'pools'), ...)` with `slug: sim-${Date.now()}` (slug at :163-164). Nothing else client-creates pool docs. The five Test Suite simulators (`src/utils/testing/simulators/{squares,bracket,bracketE2E,playoff,props}Simulator.ts`) all create pools through the real **`dbService.createPool` callable** (verified at bracketSimulator.ts:102, bracketE2ESimulator.ts:139, playoffSimulator.ts:109, propsSimulator.ts:87, squaresSimulator.ts:63) — so they do NOT need the `sim-` create branch. What the simulators DO still need is the generic `isSuperAdmin()` branches in the rules for their direct writes: `tournaments` setDoc, `pools/{id}/entries` addDoc/updateDoc, pool-doc updateDoc (dozens of sites across the simulators, `tournamentTestUtils.ts:24/51/64`, `simulationUtils.ts:53/112/184`).

**Phase 2 — STATUS UPDATE 2026-07-12: the `sim-` create branch IS deleted from firestore.rules** (rules:125 now reads "NO CREATE via Client (must use createPool function)", zero exceptions). Per nfl-sim-harness-status memory, prod smoke including "all legacy sims green" passed post-deploy, which implies TournamentSimulator's Setup phase did NOT break — i.e. the audited-callable replacement this paragraph called for was built. That inference is memory-sourced, not independently verified against TournamentSimulator.tsx in this pass — if you are about to touch TournamentSimulator or the simulator suite, confirm directly rather than trusting this note. (Historical, pre-fix) the original open item: replace every simulator direct-write with audited SUPER_ADMIN test-only callables (setup/submit/advance/score/reset/clear/load), then delete the `sim-` create branch — "any simulator control not reimplemented server-side is removed in the same phase (no orphaned buttons post-rule-removal)."

## 8. Phase 0 control work — what landed, what's open

`PLAN-SUPERADMIN-CONTROL.md` (locked 2026-07-05 after a live prod walkthrough + 5 Codex review rounds). Intent: "every card wired to real data, every button working and non-crashing, every capability in exactly one tab, every destructive action behind an explain-then-confirm guardrail and recorded in the Admin Audit Log."

**DONE and merged (PR #139 + follow-ups; verified in git log / code):**
- 0.1 app-wide crash fix: SimulationDashboard SQUARES-only + `?? []` guards + shared `formatPoolMatchup` (kills "undefined @undefined")
- 0.2 per-tab ErrorBoundary (one panel crash no longer white-screens the app)
- 0.3 `sim-` rules tightened to isSuperAdmin; `system_logs` functions-only; `logClientError` callable; invalid `PUBLISHED` bracket status → `OPEN` (TournamentSimulator.tsx:161 comment)
- 0.4 non-canonical `'ADMIN'` authz branches deleted (espnBracket ×2)
- 1.1 derived CLOSED lifecycle state + filter chip + badges; 1.2 health snapshot persistence + hourly scheduler; 1.3 props seed modal
- 2.1 core: global fixPoolScores + scoreBracketEntries → Operations, System-tab dups removed; 2.4 entry-delete race fixed (atomic `deleteBracketEntry`, client count math removed); 2.6 Tournament Simulator relocated to Test Suite (header button removed, route guarded)
- 3.1 `searchName` schema + `onUserCreated`/`syncAllUsers` backfill + name-OR-email server search; 3.2 member popup actions (Email/Reset Password/Edit)
- IA decisions (commit `7ceed05`): conference re-init only in Operations; MM re-init stays tournament-scoped; Export Emails System → Members
- Post-merge: #141 schema-drift fix (squares gameId `.nullish()`, bracket scoringSystem ESPN/FIBONACCI), #142/`beac092` logClientError enforceAppCheck → false

**Prod deploy state (owner ground truth, as of 2026-07-06):** Phase 3.1 functions (`onUserCreated`, `syncAllUsers`, `searchUsersByEmail`) + `adminHealth` functions deployed; tightened firestore.rules deployed (functions-before-rules order respected); `searchName` backfill (Force Sync) run; App Check ENFORCED in the Firebase console; `autoClosePools` LIVE past dry-run. **Still pending: Stripe TEST secret rotation** (plaintext test key in `functions/.env` — delete + rotate in Stripe dashboard; Kevin-only action). The Gemini key was NOT leaked — disregard any doc claiming otherwise. Note: `PHASE0-DEPLOY-CHECKLIST.md` says "Coolify auto-builds main on push" — the owner states prod www deploys are a **manual trigger in the Coolify dashboard**; treat push-to-main as NOT deploying the frontend (see mmp-deploy-and-operate).

**OPEN (do not claim done):**
- Phase 2 simulator server API + full `sim-` branch removal (the biggest risk item; possibly gated on ADR-0001 create-path consolidation)
- 2.4 remainder (pool-settings save + paid-status toggle direct client writes → callables); 2.5 assertCallerRole standardization on legacy tournament callables
- 3.2 remainder (in-popup field editing, pools-joined list, per-user activity log); 3.4 Recalculate Stats out of Members
- Test Suite: NFL pick'em/survivor/margin scenarios; the parked TEST-SUITE-BACKLOG bugs (bracketSimulator 0-entries cluster is the big one)
- Phase 4 NFL Schedule → NFL Pools buildout; Phase 5 hardening incl. 5.4 SuperAdmin.tsx extraction and 5.6 canonical-role migration (legacy PARTICIPANT/POOL_MANAGER still live — do NOT partially rename; see plan)
- Unaudited Export Emails; `enforceAppCheck` re-enable on logClientError; T8 playoff-entries 1MB doc migration (never built, three audits running)

## 9. Rules of engagement when touching this surface

1. One capability, one tab. One-off data actions → Operations, via the OpAction pattern (description + blastRadius + destructive + typed-RUN + logAdminAction on success AND error).
2. New admin callable → `assertCallerRole` + `writeAdminAudit`. Never claim-only, never doc-role-only, never client-side-only.
3. No client-side privileged Firestore writes from admin UI — route through callables (the carve-out for "low-risk client writes" was explicitly rejected in review).
4. Any prod-data mutation op ships kill-switched + dry-run-default (autoClosePools pattern); verify dry-run output before enabling. See mmp-change-control for the full gate.
5. Deploy order: functions BEFORE rules (else e.g. client error telemetry breaks). Always `npx firebase`, project `gridiron-gamble-uzuqo`, `npm --prefix functions install` first.
6. Data unavailable → the card shows "unavailable", never a plausible-looking substitute. Delete fake cards rather than build fake equivalents.
7. Multi-file admin changes require PLAN-*.md + adversarial review log + sweep (mmp-change-control), in an isolated worktree.

## When NOT to use this skill

- Deploy mechanics, Coolify www deploy, scheduled-job operations → **mmp-deploy-and-operate**
- Change gating, the four discipline rules, plan/review-log process → **mmp-change-control**
- Interpreting health checks / audit logs / running the Test Suite as a diagnostic → **mmp-diagnostics-and-tooling**
- Why the clobber/crash/backdoor incidents happened → **mmp-failure-archaeology**; triaging a live symptom → **mmp-debugging-playbook**
- Pool scoring math / lifecycle semantics behind the admin buttons → **mmp-pools-domain-reference**
- System invariants and authz architecture rationale → **mmp-architecture-contract**
- Feature flags / kill-switches / billing config axes → **mmp-config-and-flags**
- NFL first-season readiness (scoreNFLWeek, lockNFLSpreadsJob) → **mmp-nfl-season-campaign**

## Provenance and maintenance

Compiled 2026-07-06 against main `a0ff311` from direct code/git reads plus owner interview facts (date-stamped above). Re-verify before trusting line numbers or "open" statuses:

| Fact class | Re-verification command (PowerShell, repo root) |
|---|---|
| 8-tab registry + sub-tabs | `Select-String -Path src/components/SuperAdmin.tsx -Pattern "navStructure"` then read that block |
| Mock Loyalty / Playoffs MOCK line drift | `Select-String -Path src/components/SuperAdmin.tsx -Pattern "MOCK PROMO SENDER MODAL","const MOCK = \["` |
| sim- rules state | `Select-String -Path firestore.rules -Pattern "sim-","isSuperAdmin\(\)$"` |
| sim- create blast radius | `Get-ChildItem src -Recurse -Include *.ts,*.tsx \| Select-String "slug: ``sim-"` (expect only TournamentSimulator.tsx) |
| Simulators use createPool callable | `Select-String -Path src/utils/testing/simulators/*.ts -Pattern "dbService.createPool"` |
| Operations card list | `Select-String -Path src/components/admin/OperationsPanel.tsx -Pattern "id: '"` |
| Callable guards | `Select-String -Path functions/src/adminBillingOps.ts,functions/src/adminClaims.ts,functions/src/userManagement.ts,functions/src/conferenceTournaments.ts -Pattern "assertCallerRole\|token.role\|MODERATOR"` |
| MODERATOR server allowances | `Select-String -Path functions/src/*.ts -Pattern "MODERATOR"` |
| Plan DONE/PENDING ledger | read the "Implementation status" header of `PLAN-SUPERADMIN-CONTROL.md` |
| Branch merged / current delta | `git log --oneline -5 main; git diff main...fix/superadmin-phase0-control --stat` |
| Deploy state | `PHASE0-DEPLOY-CHECKLIST.md` + `npx firebase functions:list --project gridiron-gamble-uzuqo` (and Firebase console for App Check / rules) |
| Test Suite bug status | `TEST-SUITE-BACKLOG.md` |
| enforceAppCheck on logClientError | `Select-String -Path functions/src/logClientError.ts -Pattern "enforceAppCheck"` |
