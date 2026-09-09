# Plan: Super-Admin Dashboard Restoration + 8-Tab Rebuild

_Locked via grill-with-docs — by Claude + Kevin Struck (2026-07-04). Terms per CONTEXT.md.
Revised after Codex review round 1._

## Root cause (why "nothing changed")

The T1–T14 overhaul WAS built, pushed, and merged (PRs #111–#115, 2026-07-03). It was then
silently reverted — frontend AND parts of the backend — by the two follow-on merges: PR #116
(feat/ui-revamp, branch cut pre-overhaul; commit `2878ca5` restyled the old admin screens and
merge `c7f46e5` took the ui-revamp side) and PR #117 (feat/wizard-unification; merge `d5cec46`
reverted overhaul function code). Verified clobber inventory on `main` today:

- **T3 reverted** — all four fake cards resurrected in `SuperAdminBentoDashboard.tsx`
  (Security Audit :328, Database Migration Tools :373, Automation Test Suite :428, API Status
  Center :253). The real health-card wiring (`getAdminHealthSnapshot`, :73) survived and
  coexists with them.
- **T7 reverted, both halves** — `src/components/admin/OperationsPanel.tsx` AND
  `functions/src/adminOps.ts` deleted from the tree; Operations tab removed from
  `SuperAdmin.tsx` (both existed at `6c382cf`).
- **T6 reverted, both halves** — role-management UI removed from `SuperAdmin.tsx`;
  `setUserRole` reverted out of `functions/src/adminClaims.ts` (current exports:
  `setSuperAdminClaim`, `syncMyClaims` only); `functions/src/lib/roles.ts`,
  `src/utils/roles.ts`, and `tests/roles-parity.test.ts` gone; the T6 legacy-role write-path
  sweep across `bracketPools/nflPools/participant/poolOps/stripe/userSync/firestore.rules` is
  presumed reverted (all existed at `44666d6`).
- **Survived** — `adminHealth.ts` (+ export), `lib/adminAudit.ts` (+ its test),
  `lib/featureFlags.ts` + `systemGuards.ts` + `feature-flags-parity.test.ts`,
  `ConfirmActionModal.tsx`, `AdminAuditViewer.tsx`, `useFeatureFlags`/`PoolTypeGate`,
  firestore indexes.
- **Never built at all** — T2 (`closePool`/`autoClosePools`), T8, T12 harness, and the 8-tab
  consolidation itself (`SuperAdmin.tsx` has 15 top-level tabs today).
- **Deploy state unknown** — no deploy workflow (ci.yml only); web via Coolify, functions via
  manual `firebase deploy`. Functions are known stale (the #118 `adminAudit` namespace fix and
  anything after is undeployed).

## Goal

Restore the clobbered Super-Admin work (frontend and backend) onto the new brand styling and
complete the original goal: one coherent Super-Admin Dashboard of exactly eight tabs (Overview,
Pools, Members, Operations, Test Suite, Monetization, Themes, System) where every capability
lives in exactly one place, every card/stat/metric is wired to real data or deleted, every
privileged admin mutation flows through an audited Cloud Function behind the explain-then-confirm
guardrail, the Members system (User Management) is complete for the SUPER_ADMIN surface, Pools
gain the closePool lifecycle (T2), and the result is verifiably deployed to prod.

## Approach

Work happens on a fresh branch `feat/superadmin-restore` in its own worktree (parallel-session
discipline; the wizard worktree `D:\mmp-wizard` remains untouched).

0. **Step 0 — Clobber audit (re-baseline before restoring anything).** For each overhaul commit
   (`c7f0da2` T3, `ed44d0d`+`6c382cf` T7, `44666d6` T6, `2865cac` T14), diff its file set
   against `main` and produce a definitive lost/survived table — including the T6 write-path
   sweep files and `firestore.rules` hunks. The plan's restore list below is corrected per
   Codex round 1, but the audit is the authority; anything else found reverted joins step 1.
   Smoke-verify surviving pieces against the ACTUAL `functions/src/index.ts` export list, not
   the intended one.

1. **Restore clobbered work (semantics from git history, brand styling kept — no revert of #116).**
   - **T7 backend + UI**: restore `functions/src/adminOps.ts` (+ index export) and
     `OperationsPanel.tsx` from `6c382cf`; restyle panel to brand system; re-register the
     Operations tab.
   - **T6 backend first**: restore `lib/roles.ts`, `src/utils/roles.ts`, `roles-parity.test.ts`,
     and `setUserRole` in `adminClaims.ts` (+ export). `setUserRole` is restored from `44666d6`
     PLUS the post-review PLAN-USER-MGMT hardening — claim+Firestore agreement checks and
     refresh-token revocation on demotion — not the raw historical implementation. Re-apply the
     legacy-role write-path sweep + alias layer (`POOL_MANAGER→COMMISSIONER`,
     `PARTICIPANT→MEMBER`); known writers: the `44666d6` file set (`firestore.rules`,
     `userSync.ts`, `participant.ts`, `poolOps.ts`, `nflPools.ts`, `bracketPools.ts`,
     `stripe.ts`, `src/utils/auth.ts`, `src/types/index.ts`) plus the post-`44666d6` writers
     `src/services/authService.ts:42` and `functions/src/lib/poolCreation.ts:64`, plus
     function-side role-bearing types (`functions/src/types.ts:246` hardcodes the legacy union —
     migrate or prove unused). The gate is twofold: (a) an explicit **repo-wide grep-zero on
     `PARTICIPANT|POOL_MANAGER` write-paths**, not a fixed file list; and (b) a **read-path
     migration gate** — admin/client role displays and auth helpers (`SuperAdmin.tsx:1534`,
     `SuperAdminBillingPanel.tsx:1416`, `src/utils/auth.ts:29`, and grep-found peers) go through
     `normalizeRole`/`roleBadge` helpers, never raw legacy-string comparisons, so canonical
     values render correctly the moment they land. **Stored-data backfill (PLAN-USER-MGMT
     sequence):** after the cleaned writers deploy, run an audited one-time backfill that
     rewrites legacy `PARTICIPANT`/`POOL_MANAGER` values to canonical ones in `users/{uid}.role`
     docs and auth claims (Operations action, dry-run first, `admin_audit` logged) — existing
     live docs already contain legacy values, and canonical role-filtered queries
     (`where('role','==',...)`) would silently miss them. **Only after** both gates are green
     AND the backfill has run does the role-selector UI return and do role-filtered Members
     queries ship (typed confirm for SUPER_ADMIN grants).
   - **T3**: delete the Security Audit / Database Migration Tools / Automation Test Suite cards
     from the brand-styled `SuperAdminBentoDashboard.tsx`; keep the surviving real health card
     (reference semantics: `c7f0da2`). Fix the fake "Refresh" button on the Platform Ledger card
     (currently setTimeout + toast) to actually re-read its sources.
   - **T14**: check the Overview revenue split for the same clobber; restore if hit (`2865cac`).
   - **Claims-sync hardening (prerequisite for role work)**: `syncMyClaims` is currently an
     any-authenticated-user Firestore-role→Auth-claim copier auto-invoked by
     `useEnsureAdminClaims` and `SuperAdminBillingPanel`. Before the restored `setUserRole`
     ships, harden it per the PLAN-USER-MGMT bootstrap contract: it KEEPS the self-only,
     Firestore-role-verified `SUPER_ADMIN` recovery path (claim missing but rules-protected
     `users/{uid}.role == 'SUPER_ADMIN'` → mint the claim; this is the catch-22 escape the
     current hook compensates for) and forbids privileged minting outside exactly that path —
     never escalating beyond what the rules-protected role field says. Client auto-sync becomes
     bootstrap-only.

2. **Kill direct client admin writes (prerequisite for the guardrail sweep).** Inventory every
   privileged Firestore mutation issued from admin UI (`SuperAdmin.tsx:614` user doc writes,
   `SuperAdminBillingPanel.tsx:255,305`, `dbService.ts:290`, plus whatever the inventory finds).
   Route each through an audited Cloud Function (existing callable where one exists; thin new
   callables where not — each writes `admin_audit`). Client writes to `admin_audit` are already
   rules-forbidden; this makes the audit trail complete rather than theater.

3. **8-tab consolidation.** Restructure `SuperAdmin.tsx` (4,000+ lines) by extracting each tab
   into `src/components/admin/tabs/<Tab>.tsx`; the shell keeps only nav + routing state.
   Mapping (agreed):
   - **Overview** ← current Overview (Bento) + Stats (`AdminStatsDashboard` folded in as a section).
   - **Pools** ← Pools list + sport sub-panels: Tournament/Bracket, Playoffs, Global Props,
     NFL Schedule. Adds Close Pool (step 7).
   - **Members** ← Users + Referrals + Loyalty Tiers (SUPER_ADMIN surface; see step 6).
   - **Operations** ← restored OperationsPanel; one-off action buttons currently living in
     Tournament/NFL/System move here (single home per T7 spec); originals removed.
   - **Test Suite** ← AI Testing (`SimpleTestingDashboard`) + `SimulationDashboard` +
     `TestingDashboard` + `TournamentSimulator` merged into one tab with sub-sections; duplicate
     capabilities deduped; honest labels. UI consolidation only — no new harness (T12 deferred).
   - **Monetization** ← Billing panel + revenue rollup.
   - **Themes** ← unchanged.
   - **System** ← System Status + Settings + `AdminAuditViewer` + feature-flag toggles.
   Tab state is local React state today (no URL), so no bookmark-alias work; if deep links are
   wanted later, move tab id to a search param as its own tiny change.

4. **Wire-audit: no fake data.** Inventory every card, stat, and metric across all eight tabs.
   Each one either (a) reads a real Firestore/callable source, or (b) is deleted. Deliverable: a
   wiring table (surface → source → verified how) in the PR description. Explicitly includes the
   Bento tiles, System stats cards, Members counts, and Monetization figures. Data unavailable →
   the card shows "unavailable", never a plausible-looking substitute.

5. **Guardrail sweep.** With step 2 done, every destructive action across all tabs (delete user,
   delete pool, re-init tournament, backfills, Close Pool) goes through `ConfirmActionModal`
   with blast-radius text + typed confirmation for destructive ops, and its callable writes
   `admin_audit`. Remove remaining raw `window.confirm` paths on admin surfaces.

6. **Members robustness (SUPER_ADMIN surface; scoped against PLAN-USER-MGMT).**
   - The Members tab is the SUPER_ADMIN-only surface. The moderator-capable `/admin/users`
     surface specced in PLAN-USER-MGMT stays a separate deliverable; components built here
     (profile drawer, role badge, activity list) are built shareable so `/admin/users` reuses
     them. Destructive super-admin actions (delete account, SUPER_ADMIN grants) exist only in
     the Members tab.
   - Role selector with typed confirm (from step 1) + BANNED enforcement at BOTH layers per
     CONTEXT.md: UI state on the Members surface AND a server-side `assertNotBanned(request)`
     guard in state-changing callables that follows the PLAN-USER-MGMT contract — it reads the
     rules-protected **Firestore role**, not just the auth claim. **Enforcement latency is
     honest, not overstated:** a fresh ban bites immediately on all CALLABLE paths (Firestore
     read per call). Direct rule-gated client writes (`ai_requests` rules:144, `messages`
     rules:165, `shareClicks` rules:205) use the claim-based rules helper and retain a residual
     window up to token TTL for a stale token; mitigation: `setUserRole(→BANNED)` revokes
     refresh tokens (step 1 hardening) and these three paths are low-blast-radius. Any of them
     that turns out to be higher-risk during implementation moves behind a callable instead.
     The historical `44666d6` `systemGuards.ts` hunks are reference only (step 0 confirms what
     survived); the Firestore-backed guard is the spec, plus the PLAN-USER-MGMT rules sweep
     for BANNED.
   - Unified profile drawer: account fields, participations, seasonHistory, referrals, computed
     loyalty tier.
   - **Password reset + one-off email are BUILD work, not verify work** (Codex finding 4): the
     shipped `sendAdminPasswordReset` is SUPER_ADMIN-only and writes only `admin_audit`; no
     one-off email callable exists. Implement `triggerPasswordReset` and `sendUserEmail` per the
     CONTEXT.md contract: callable by SUPER_ADMIN or MODERATOR, dual-write `users/{uid}/activity`
     (`PASSWORD_RESET_SENT` / `EMAIL_SENT`) + `admin_audit`.
   - Replace the unbounded users fetch (`getAllUsers()` → repository `find()` full-table read)
     with a paged query contract (server-side ordering + `limit` + cursor) and search by
     `searchEmail` only — matching the accepted PLAN-USER-MGMT v1 scope; name search is
     explicitly deferred until its schema/index design exists. **The `searchEmail` plumbing is
     pulled into this plan** (no implementation exists in the tree today): add
     `users/{uid}.searchEmail` (lowercased email) written by `userSync` on create/update, a
     one-time backfill for existing users (Operations action, audited), and the
     `role + searchEmail` composite index from PLAN-USER-MGMT.

7. **T2: Pool lifecycle.** As previously locked (full detail in PLAN-SUPERADMIN-OVERHAUL.md):
   `closePool` callable extending `poolExceptions.ts`, authorized `ownerId || managerUid ||
   SUPER_ADMIN`; dual-write canonical status + legacy fields (`isLocked`, `isFinal`,
   `scores.gameStatus:'post'`) + `closedVia:'ADMIN_CLOSE'` in one update; hard guards in
   `onPoolLocked` and `onGameComplete`; `recalculateGlobalStats` excludes admin-closed
   compatibility locks; CANCELED terminal; daily `autoClosePools` sweep with dry-run + config
   kill-switch; Close Pool button behind the guardrail. **Plus lifecycle unification (Codex
   finding 7):** define one canonical post-close state per pool type in a single shared helper
   (extend `src/utils/poolSport.ts` or new `poolLifecycle.ts` with CLOSED/CANCELED semantics)
   and migrate BrowsePools, ManagerDashboard, and ParticipantDashboard to it — acceptance is
   "an admin-closed pool no longer appears in any Open list and renders a Closed state on all
   three surfaces," verified via the shared helper, not three ad-hoc derivations. Emulator test
   proves zero `stats/global` deltas and zero mail writes on admin close. First implementation
   step remains the read-only prod query confirming per-type close conditions.

8. **Regression guard (prevent a third clobber).** A small vitest of admin-surface invariants:
   the 8-tab registry matches CONTEXT.md's Super-Admin Dashboard term; `OperationsPanel` is
   imported and rendered; the known fake-card strings do not appear in
   `SuperAdminBentoDashboard.tsx`; role-management UI is present; `functions/src/index.ts`
   exports `setUserRole`, `logAdminAction` (adminOps), and `getAdminHealthSnapshot`. Runs in the
   required CI job. Plus process: long-lived feature branches must merge latest `main` and
   re-verify admin surfaces before PR (documented in ARCHITECTURE/CLAUDE notes).

9. **Deploy + verify (deploy matrix, not just functions).** After merge:
   `firebase deploy --only functions,firestore:rules,firestore:indexes`; verify the ACTUAL
   deployed function list contains `setUserRole`, `logAdminAction`, `getAdminHealthSnapshot`,
   `closePool` (`firebase functions:list`); confirm Coolify picked up the web build (served
   bundle hash vs local build); manual smoke of the deployed dashboard: health check runs, an
   Operations action writes `admin_audit`, a role change round-trips through claim refresh.
   No "done" without this step's evidence.

Sequencing: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 8 → 7 → 9 (guard lands before T2; T2 is the only
step with live-data risk and gets its own PR).

## Key decisions & tradeoffs

- **Re-apply semantics onto brand-styled files, not `git revert` of #116/#117.** The brand
  styling and wizard are wanted; the regression is semantic.
- **Restore from git history (`6c382cf`, `44666d6`, `c7f0da2`, `2865cac`) rather than rewrite**
  — reviewed-and-merged-once code; only styling and drift need rework. Step 0 re-baselines so
  we restore against reality, not assumption (Codex round 1 caught the backend clobber).
- **Role sweep + claims hardening before any role UI** — restoring the selector without the
  write-path sweep would drift straight back to legacy enum values (Codex findings 2, 3).
- **Audited-callable prerequisite before guardrail polish** — modals over direct client writes
  would be audit theater (Codex finding 5).
- **Members tab = SUPER_ADMIN surface; PLAN-USER-MGMT's `/admin/users` stays separate** with
  shared components — keeps moderator-capable tooling out of the god-mode screen (finding 6).
- **Tab map locked** (user-approved): sport ops nest under Pools; Stats folds into Overview;
  Settings merges into System; Referrals + Loyalty merge into Members.
- **Test Suite = UI consolidation only.** Full T12 harness deferred.
- **T8 deferred** — live-data migration risk, unrelated to the dashboard goal.
- **Invariant test over process-only prevention** — the clobber was invisible to CI twice.
- **Per-tab file extraction** — 4,000-line `SuperAdmin.tsx` is the structural cause of silent
  merge clobbers and unreviewable diffs.
- **No bookmark aliases** — tab state isn't in the URL today (Codex finding 10).

## Risks / open questions

- **Prod deploy state** — functions known stale since #118; step 9 measures and fixes.
- **Restyling restored components** could subtly change behavior; mitigation: restore logic
  verbatim first, restyle second, diff against the historical commit.
- **Role sweep touches live rules/claims** — alias layer + dual-read window per PLAN-USER-MGMT;
  emulator rules tests before deploy.
- **Tab consolidation churn** vs. the active wizard worktree (`D:\mmp-wizard`): own worktree,
  land dashboard first, wizard rebases.
- **autoClosePools mis-closing a live pool** — dry-run first week + kill-switch; prod read-only
  query before enabling.
- **Step 2 inventory may surface more client writes than listed** — no carve-out: every
  privileged admin mutation found (including the SuperAdminBillingPanel config/coupon/
  pool-billing/user-credit writes at :255/:305/:400) converts to an audited callable in this
  cycle. If the inventory is larger than expected, the schedule slips rather than the audit
  boundary.

## Out of scope

- T8 playoff-entries migration; full T12 harness + sim-isolation guards; the moderator-facing
  `/admin/users` surface (PLAN-USER-MGMT deliverable — components built shareable here); T13
  theme `appliesTo` extensions beyond what shipped; SSR; participant/commissioner surface
  redesign; Stripe changes (commissioner-hosting-fees-only model is fixed).
