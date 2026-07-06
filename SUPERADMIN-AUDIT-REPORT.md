# March Melee Pools — Engineering Review + Super-Admin Deep Dive

_Compiled 2026-07-05. Live walkthrough performed as SUPER_ADMIN (kstruck@gmail.com) against production www.marchmeleepools.com. Code review by four parallel agents over the real repo at D:\march-melee-pools. Toolchain (typecheck/lint/test/build) actually executed — results are real, not estimated. No destructive production action was executed; dangerous operations were verified by code and by opening (then cancelling) their confirm modals._

---

# Executive Summary

**Classification: decent but needs cleanup — trending fragile in the admin surface specifically.**

The product underneath is stronger than a solo-built app has any right to be: strict TypeScript on the frontend, 299 passing unit tests, a real CI gate that even validates the nginx config, a genuinely good domain glossary (`CONTEXT.md`), a dual-guard admin auth helper, and a deliberate money-safety design (Stripe is commissioner hosting-fees only; participant entry fees never touch the platform). Build is green, typecheck is clean, zero test failures.

But the Super-Admin dashboard — the thing this review is really about — is where the debt concentrates and where it is actively dangerous. It is a **4,321-line single-file god component** (`src/components/SuperAdmin.tsx`) that holds 16 tab bodies, 68 `useState` hooks and ~106 click handlers, re-renders wholesale on every data snapshot, and is protected by exactly **one global ErrorBoundary** — so a single unguarded `.filter()` on the wrong pool type white-screens the entire app. I reproduced that crash live: clicking **Open Simulation Dashboard** throws `TypeError: Cannot read properties of undefined (reading 'filter')` and takes down the whole page. That is not a cosmetic bug; it is the dashboard's defining structural weakness made visible.

The dashboard is also **half-migrated**. A modern, well-built guardrail system (OperationsPanel with typed-RUN confirms + audit logging, the `closePool` callable, the ConfirmActionModal) was built *next to* the legacy surfaces instead of replacing them. The result: the same destructive operations (Fix Scoring, Fix Participants, Init Big East, Big 12 re-init) exist in two or three places with **different guard strengths**, and the good version's own source comment admits the legacy duplicates "should be removed." Every specific gap you flagged in your brief checked out in code and on screen — API status is ephemeral, no close/archive UI, email-only member search, misplaced System-tab buttons, an incomplete test suite, and a write-only "NFL Schedule" tab that should be an NFL-pools manager.

Net: the foundation is sound and worth building on. The admin experience needs a focused consolidation pass (kill duplicates, extract the god file, add per-panel error boundaries) plus roughly a dozen concrete feature/gap fixes before it is something you can operate confidently or hand to a second admin.

---

# Project Understanding

**What it does.** A multi-sport contest platform. Commissioners create Pools (NCAA brackets, Super Bowl squares, NFL pick'em / survivor / margin / playoff challenge, custom prop sheets); Members enter and submit picks. Entry fees move peer-to-peer between Members and Commissioners (honor system, off-platform). The platform's own revenue is commissioner hosting subscriptions via Stripe. Charity pools are a first-class concept. Super-admins operate the whole thing from one dashboard.

**Stack.** React 19 + TypeScript + Vite SPA (`src/`), Firebase Cloud Functions in TypeScript (`functions/src/`, ~110 exported entrypoints), Firestore as the database, Firebase Auth with custom-claim roles. Charts via recharts. Deployed to production `www` via Docker → nginx → Coolify (Firebase project `gridiron-gamble-uzuqo` hosts the functions/data; `firebase.json` hosting config coexists but does **not** govern `www`). CI on GitHub Actions.

**Architecture at a glance.** Thick-ish client, thin service layer. Business logic lives partly in Cloud Functions `onCall` handlers and partly in the client (`src/services/dbService.ts`, 1,322 lines, does direct Firestore reads/writes). Roles are enforced in three places that must agree: the JWT custom claim (authoritative for rules), the `users/{uid}.role` mirror (fallback + admin queries), and per-pool participation. Data access is a mix of live `onSnapshot` subscriptions and one-shot reads, with almost no caching/state-management layer.

---

# What Is Working Well

- **The Operations tab is genuinely well-built.** `src/components/admin/OperationsPanel.tsx` gives every action a `destructive` flag, a plain-English blast-radius description, a `ConfirmActionModal` that requires typing `RUN` for destructive ops, and writes an `OP_*` entry to the Admin Audit Log on **both success and error**. I opened the Re-init Big 12 modal live: it says "OVERWRITES THE BIG 12 TOURNAMENT DOCUMENT" and demands typed confirmation. This is the pattern the rest of the dashboard should copy.
- **Dual-guard admin auth.** `functions/src/lib/roles.ts` `assertCallerRole` requires the JWT claim **and** the Firestore role doc to agree, and returns the actor for auditing — closing the demoted-but-unrefreshed-token hole. Used by the modern billing/claims callables (`adminClaims.ts:63`, all of `adminBillingOps.ts`).
- **Money-safety by design, and Stripe done correctly.** Entry fees are P2P/off-platform (`CONTEXT.md` invariant). The Stripe webhook verifies the signature (`stripe.ts:478`) and is idempotent via a `stripeWebhookEvents/{id}` marker (`stripe.ts:494`). Production secrets use Secret Manager (`defineSecret`), not env files.
- **Firestore rules are mostly thought-through.** `admin_audit`, `billingCharges`, `mail`, `coupons`, participant/winner/payment subcollections, and guest PII (`squarePrivate`) are all functions-only writes; users cannot edit their own `role`.
- **CI is real.** `.github/workflows/ci.yml` gates build+prerender, functions typecheck, both test suites, and `nginx -t` on the prod config on every PR. Pre-commit secret scan via husky. Dependabot weekly.
- **Toolchain is green** (all executed, not estimated): root typecheck 0 errors, functions typecheck 0 errors, root tests 203/203, functions tests 96/96, production build succeeds in ~27s.
- **The domain glossary (`CONTEXT.md`) is the best onboarding artifact in the repo** — exhaustive role enum, the Entry-Fee-vs-Billing distinction, the 8-tab dashboard contract.

---

# Biggest Risks

1. **Whole-app crash from the admin dashboard (live-reproduced).** `SimulationDashboard.tsx:155/256` calls `.squares.filter(...)` on every non-BRACKET pool; PROPS/PICKEM/SURVIVOR/PLAYOFF pools have no `squares` array → `TypeError` → caught only by the single global ErrorBoundary (`main.tsx:13`) → white screen. **Security-of-uptime critical.**
2. **Client-side pool-creation backdoor in Firestore rules.** `firestore.rules:87` lets any authenticated user create a `pools/{id}` doc directly from the client if the slug starts with `sim-`, bypassing `createPool` and setting `ownerId`/`billing`/`participantIds` to anything (billing bypass + arbitrary injection). Extended to `entries` at `:194`. This is a test affordance living in production rules.
3. **Half-migrated guardrails = destructive ops with inconsistent protection.** Fix Scoring / Fix Participants / Init Big East / Big 12 re-init exist in the well-guarded Operations tab **and** as weaker-guarded duplicates in the System and Tournament tabs. OperationsPanel's own comment (`:16-17`) says the duplicates should be deleted. One click in the wrong place skips the confirm/audit.
4. **Unaudited PII export.** System-tab **Export Emails** builds a CSV of all users plus guest emails pulled from `squarePrivate` subcollections, with no confirm and no audit entry (`SuperAdmin.tsx:2723-2762`).
5. **Cost-scaling landmine.** `functions/src/reminders.ts:117` does an unfiltered `pools.get()` (full-collection read) every 5 minutes; `autoLock` and `syncGameStatus` run every 1 minute. Firestore read cost grows linearly with pool count × 1440/day. Fine now, expensive at a few thousand pools.
6. **Abuse surface: unauthenticated, unthrottled callables + App Check not enforced.** `joinWaitlist` (appends to an unbounded array inside the hot pool doc) and `createClaimCode` take no auth and no rate limit; App Check is initialized client-side but no function enforces it.
7. **The god file itself.** `SuperAdmin.tsx` (4,321 lines) is a maintainability and merge-conflict tax on every future admin change, and the reason a single crash is app-wide.

---

# Detailed Findings By Category

## Repo and Codebase Structure

**Finding: One 4,321-line god component; extraction started and stalled.**
Evidence: `src/components/SuperAdmin.tsx` is 4.7× the next-largest admin file, yet `src/components/admin/` already holds 13 extracted panels and `SuperAdminBentoDashboard.tsx` exists — both the monolith and the fragments are alive.
Why it matters: every admin feature pays a comprehension/merge tax here, and it is the root cause of the app-wide crash blast radius.
Fix: extract each tab body into `src/components/admin/tabs/*`; SuperAdmin becomes a ~200-line shell (nav + routing + shared providers).

**Finding: Three coexisting generations of the pool-creation wizard.**
Evidence: `src/components/admin/WizardStep*.tsx` (11 files), root-level `src/components/WizardStep*.tsx` (5 files), and `src/components/wizard/steps/Step*.tsx` (6 files). `WizardStepBranding.tsx` and `WizardStepReminders.tsx` exist under two paths with different content.
Why it matters: a wizard bugfix has three plausible targets; fix the wrong one and the bug stays live. (Known debt — Phase B of the wizard unification in the `mmp-wizard` worktree.)
Fix: land wizard Phase B; delete the two dead generations.

**Finding: ~2,500 lines of verified dead code.**
Evidence: unreferenced across all of `src/`: `ManagerDashboard.tsx` (876 lines), `PoolTypeGate.tsx`, `PayoutGallery.tsx`, `modals/PlayoffSettingsModal.tsx`, `admin/WizardStepAdvanced.tsx`, `CustomSportsLanding.tsx`, `ResourcesPage.tsx`, `SupportPage.tsx`, `version.ts` (stale `BUILD_TIMESTAMP='2026-01-12'`), and others.
Why it matters: dead weight that new devs (and agents) waste time reading.
Fix: delete after confirming test-only imports (`themeScope.ts`/`themeUtils.ts` are used by tests — keep).

**Finding: Bracket scoring logic triplicated; shared/ package exists but scoring isn't in it.**
Evidence: `src/utils/bracketScoring.ts` (148), `src/components/BracketPoolDashboard/bracketScoring.ts` (290), `functions/src/bracketScoring.ts` (618). The `shared/` package was created to prevent client/server drift — scoring, the thing users scream about, is the one thing not shared.
Why it matters: silent client/server scoring divergence.
Fix: move canonical scoring into `shared/`.

**Finding: Repo root is a session-artifact dumping ground.** 13 PLAN/AUDIT/REVIEW markdown files, 308 committed skill files, tracked `scripts/espn_output.txt`, a stale tracked `src/nginx.conf` that differs from the real prod `nginx.conf`, and role-escalation one-off scripts (`functions/setUserAdmin.cjs`, `reinit_big12.js`) that contradict CONTEXT.md's "Operations tab is the sole home" rule.
Why it matters: signal-to-noise for humans and agents; a stale nginx.conf that could be deployed by mistake breaks Google sign-in.
Fix: `docs/plans/archive/` sweep; delete `src/nginx.conf`; move ops scripts behind Operations callables or into `scripts/ops/` clearly labeled.

## Frontend Architecture

**Finding: No state-management or data-fetching layer.**
Evidence: no redux/zustand/react-query/swr in `package.json`; SuperAdmin alone holds 68 `useState`; all subscriptions in one mega-`useEffect` (`SuperAdmin.tsx:360-423`) passed down as props; only 2 custom hooks exist.
Why it matters: every data concern is hand-rolled; the users list even needs a manual "Refresh List" button because there is no cache invalidation.
Fix: adopt a light query layer (react-query) for admin data; co-locate subscriptions with the panels that use them.

**Finding: One ErrorBoundary for the entire app.**
Evidence: `main.tsx:13`; no per-tab/per-panel boundary. This is why the SimulationDashboard `.squares` crash is app-wide.
Why it matters: any admin panel bug becomes a full outage for the admin.
Fix: wrap each tab body in its own `ErrorBoundary` with a localized fallback.

**Finding: Full-collection reads + no memoization in the admin session.**
Evidence: live subscription to up to 500 pool docs (`dbService.ts:640-644`, with a self-acknowledged "add pagination" note) and a full `users` collection read (`:845-847`); every snapshot re-renders the whole 4,321-line component (5 `useMemo`/`useCallback` total).
Why it matters: admin session gets slower as data grows; re-render storms.
Fix: paginate pools/users; memoize panels; move to per-panel subscriptions.

**Finding: Client-side privileged writes bypass the callable/audit pattern.**
Evidence: pool settings, entry paid-status, entry deletion + `entryCount` decrement are direct client `updateDoc`/`deleteDoc` (`SuperAdmin.tsx:137-229`) — unaudited and race-prone.
Why it matters: data-integrity drift; no audit trail for admin edits.
Fix: route through audited callables.

**Finding: Accessibility is near zero in admin.** 2 `aria-` attributes in 4,321 lines; icon-only gear/trash buttons; hover-only (`opacity-0 group-hover`) controls that are keyboard-invisible.

## Backend Architecture

**Finding: Four different "is this caller an admin" idioms, not equivalent.**
Evidence: strongest `assertCallerRole` (claim+doc) in the modern callables; claim-only inline in `userManagement.ts:24`, `adminOps.ts:15`, `adminHealth.ts:107`, etc. (misses demoted-token case); Firestore-doc-only in `espnBracket.ts`/`conferenceTournaments.ts`/`bracketOps.ts`; and `espnBracket.ts:987` accepts a **non-canonical `'ADMIN'` role** (latent authz bug).
Why it matters: inconsistent security posture; the legacy tournament callables are also unaudited.
Fix: standardize on `assertCallerRole` everywhere; delete the `'ADMIN'` branch.

**Finding: Business logic sits inside `onCall` handlers; no service boundary.** Handlers reach into `admin.firestore()` directly and duplicate auth. Workable at 70 files, but there is no repository/service layer server-side (mirrors the client's `dbService` kitchen-sink).

**Finding: Unauthenticated callables with no validation/throttle.** `participant.ts:43 createClaimCode` (no auth, unbounded doc creation), `waitlist.ts:14 joinWaitlist` (no auth, appends to unbounded in-doc array), `referral.ts:88 resolveReferralToken` (UID leak). See Security.

## Database and Data Model

**Finding: `pools/{poolId}` is a hot god-document with an unbounded in-doc array.**
Evidence: it carries `squares` (~100), `participants`, `participantIds`, `waitlist`, `billing`, `scores`, `reminders`; multiple triggers fire on every write; `waitlist` is appended by an unauthenticated callable and rewrites the whole array each time (1 MiB cap + write contention).
Why it matters: growth + contention hazard on popular pools.
Fix: move `waitlist` to a subcollection; authenticate + throttle the writer.

**Finding: Role denormalized three ways** (claim, user doc, participation) — intentional but the source of the drift only `assertCallerRole` defends against.

**Finding: Indexes are present for the hot paths** (`admin_audit`, `entries` collection-group, `pools` status/type queries) — this is done well.

## Performance and Scalability

**Finding: Per-minute / per-5-minute full-collection scans.**
Evidence: `reminders.ts:117` unfiltered `pools.get()` every 5 min; `autoLock.ts:41` and `scoreUpdates.ts:1081` every 1 min.
Why it matters: Firestore reads scale linearly with pool count × frequency; dominates the bill at scale.
Fix: query only pools with a pending reminder window (indexed field), not the whole collection.

**Finding: Bundle chunks over 500 kB.** `vendor-firebase` 693 kB (build warning), plus `PlayoffDashboard` 420 kB, `SuperAdmin` 324 kB. Route-level splitting is good; SuperAdmin ships the whole admin suite as one static chunk (it statically imports SimulationDashboard, BillingPanel, etc.).
Fix: lazy-load heavy admin panels; split vendor-firebase.

## Security and Production Readiness

**Finding (Dangerous): `slug ^sim-` client pool/entry creation backdoor.** `firestore.rules:87` + `:194`. Any authed user creates pools/entries directly with arbitrary fields (billing bypass). Fix: remove the client-create allowance; route simulator through a callable.

**Finding (Moderate): `system_logs` writable by any authed user.** `firestore.rules:277` `allow create: if request.auth != null` → log spoofing into an admin-visible surface.

**Finding (Moderate): App Check initialized client-side, enforced nowhere.** `src/firebase.ts:26`; no function sets `enforceAppCheck`. The no-auth callables are fully scriptable from outside the app.

**Finding (Low): Over-broad reads.** `propCards` readable by any authed user; `system/config`, `tournaments`, `stats`, `themes` are `read: if true` (feature flags + autoClose kill-switch state world-readable).

**Finding (Low-Moderate): Plaintext (commented) Stripe TEST key + webhook secret in `functions/.env:1-2`.** Gitignored, so not in the repo, but on disk in cleartext. Delete and rotate.

**No hardcoded secrets in tracked source.** No Storage in use (no `storage.rules` needed).

## Maintainability and Developer Experience

**Finding: Lint discipline is formalized surrender.** 609 ESLint warnings, 0 errors; `ci.yml` lint job is `continue-on-error: true`. 469 of them are `no-explicit-any`. Hooks rules stay errors (good), but nothing ratchets the count down.

**Finding: Config drift.** `firebase-admin` ^13 (root) vs ^12 (functions); Node engines `22` (functions) vs CI `20` vs Docker `node:20`; Dockerfile uses `npm install --legacy-peer-deps` not `npm ci`. Tests mock a different firebase-admin major than prod runs.

**Finding: No `ARCHITECTURE.md`, no project `CLAUDE.md`.** The real deploy topology (nginx-vs-firebase) is reconstructable only from comments in `nginx.conf` and out-of-repo memory. For one of the most agent-driven repos imaginable, session knowledge lives outside the repo.

**Finding: Test coverage gaps where it matters most.** 299 passing tests, but **zero** tests on functions admin callables (`adminOps`, `userManagement`, `adminClaims`, `backfill`) and **zero** SuperAdmin component tests. Scoring engines and billing math are well-covered.

---

# Top 10 Priority Fixes

| # | Fix | Priority | Effort | Impact | Area | Why now |
|---|-----|----------|--------|--------|------|---------|
| 1 | Guard `SimulationDashboard` against non-squares pools + add per-tab ErrorBoundary | **Critical** | Small | Large | Frontend | Live-reproduced whole-app crash from an admin button |
| 2 | Remove `slug ^sim-` client create backdoor in `firestore.rules` (route simulator via callable) | **Critical** | Small | Large | Security | Billing bypass + arbitrary pool injection by any authed user |
| 3 | De-duplicate destructive ops — one guarded home (Operations); delete System/Tournament duplicates | **Critical** | Medium | Large | Frontend/Backend | Same op with weaker guards elsewhere; the good code says to remove them |
| 4 | Add Close/Archive action + CLOSED status column/badge to Pools tab | **High** | Small | Large | Frontend | `closePool` backend exists (#126/#127) with no UI; you can't see or close a pool |
| 5 | Persist + schedule Health Snapshots (hourly `onSchedule`, store history, show last-run) | **High** | Medium | Medium | Backend/Infra | API Status Center is ephemeral; your explicit ask |
| 6 | Standardize admin auth on `assertCallerRole`; delete non-canonical `'ADMIN'` branch; audit legacy tournament callables | **High** | Medium | Large | Security | Inconsistent guards; latent authz bug |
| 7 | Member system: name search + filters (role/method/date) + robust detail modal (edit fields, reset pw, email in-modal, activity) | **High** | Large | Large | Frontend | Email-only search confirmed useless in practice; your ask |
| 8 | Full, pool-type-segmented Test Suite with per-test descriptions; fix every button | **High** | Large | Medium | DX | Bracket-heavy, missing NFL types; the crash lives here |
| 9 | Fix `reminders.ts` full-collection scan (indexed query) | **Medium** | Small | Medium | Backend | Cheapest large cost-scaling win |
| 10 | Extract `SuperAdmin.tsx` into per-tab modules | **Medium** | Large | Large | Frontend/DX | Root cause of blast radius + merge tax; unblocks everything else |

---

# Files and Folders That Need the Most Attention

- **`src/components/SuperAdmin.tsx` (4,321 lines)** — the god file; source of the crash blast radius, the duplicate ops, the client-side privileged writes, and the merge tax.
- **`src/components/SimulationDashboard.tsx`** — active prod crash on non-squares pools.
- **`firestore.rules`** — `sim-` backdoor (`:87`, `:194`), `system_logs` open write (`:277`), over-broad reads.
- **`functions/src/reminders.ts`** — the dominant Firestore-cost scanner.
- **`functions/src/espnBracket.ts` (1,463 lines)** — unaudited legacy admin callables + the `'ADMIN'` role bug.
- **`src/services/dbService.ts` (1,322 lines)** — client-side kitchen-sink data layer beside a stalled `BaseRepository`/`poolRepository` migration.
- **The wizard trio** (`admin/WizardStep*`, root `WizardStep*`, `wizard/steps/*`) — three generations until Phase B lands.
- **`functions/.env`** — plaintext test secrets on disk.

---

# Architectural Smells

- **God component** — `SuperAdmin.tsx`.
- **God service** — `dbService.ts` client-side; `onCall` handlers server-side with no service boundary.
- **Mixed concerns** — presentation, data fetching, privileged writes, and one-off seasonal ops (hardcoded 2025/2026 tournament seeding) all in one file.
- **Hidden coupling** — role in three stores; scoring in three files; CSP duplicated across `firebase.json` + three nginx blocks + a stale `src/nginx.conf`.
- **Duplicated business logic** — Fix Scoring / Fix Participants / Init Big East / Big 12 re-init in 2–3 tabs with different guards.
- **Weak boundaries** — client writes to pools/entries that should be callables; unauthenticated callables writing to hot docs.
- **Config sprawl** — root/functions dependency skew, Node-version roulette, `legacy-peer-deps` in Docker.
- **MVP shortcuts aging badly** — placeholder "mock" Loyalty campaign that fakes a success toast (`SuperAdmin.tsx:2251`); simulation tools pinned to `tournaments/2025`.

---

# What Will Hurt Later If Ignored

- **The god file + single ErrorBoundary** turn every future admin bug into a full outage and every change into a merge fight. This compounds with every feature you add.
- **Full-collection scanners** are invisible until the Firestore bill spikes; by then they're load-bearing and scary to change.
- **Dependency/Node skew** means "works in CI" won't guarantee "works in prod" the day a firebase-admin API shifts between majors.
- **Zero admin-callable tests** means the most destructive code paths have no safety net exactly where mistakes are irreversible.
- **The `sim-` backdoor and unenforced App Check** are quiet until someone scripts them.

---

# Scalability Verdict

- **Can the backend scale as-is?** For hundreds of pools, yes. The architecture (Functions + Firestore) scales horizontally by default.
- **What breaks first as load grows?** Firestore **read cost**, driven by the per-1-minute and per-5-minute full-collection scans (`reminders.ts`, `autoLock`, `syncGameStatus`), then the unbounded in-doc `waitlist` array on popular pools, then the admin session's 500-doc live subscription.
- **Refactor before real growth:** convert the scanners to indexed queries; move `waitlist` out of the pool doc; paginate admin data; enforce App Check + throttle the unauthenticated callables.
- **Can wait:** the god-file extraction (maintainability, not scale), the wizard unification, the dependency-skew cleanup.

---

# Maintainability Verdict

- **Could a good dev maintain this without pain?** They'd get the *domain* fast (CONTEXT.md is excellent) and the *code* slow — 58 flat files in `src/components/`, a 4,321-line admin file, three wizards, no ARCHITECTURE.md.
- **Organized well enough for a growing team?** Not yet in the admin surface. Two devs editing SuperAdmin.tsx will conflict constantly.
- **Highest-leverage refactors:** (1) extract SuperAdmin into per-tab modules with per-tab error boundaries; (2) delete the duplicate ops and dead code; (3) write an ARCHITECTURE.md capturing the nginx/Firebase split and the shared/ copy-step; (4) add tests for admin callables.

---

# Suggested Ideal Structure

```
src/
  app/                      # App shell, routing, providers, ErrorBoundary tree
  features/
    pools/                  # pool dashboards, per type (bracket, squares, nfl-*)
    admin/
      AdminShell.tsx        # ~200-line nav + tab router
      tabs/
        OverviewTab/        # + ApiStatusCenter (persisted health)
        PoolsTab/           # list + close/archive + status badges
        MembersTab/         # search(name+email)+filters, robust detail modal
        OperationsTab/      # the ONLY home for destructive ops
        TestSuiteTab/       # ONLY home for all simulation; segmented by pool type
        MonetizationTab/
        ThemesTab/
        SystemTab/          # logs + audit viewers ONLY (no action buttons)
      panels/               # reusable: ConfirmActionModal, AuditViewer
  services/
    repositories/           # finish BaseRepository migration; retire dbService god
    scoring/                # -> move to shared/
  hooks/                    # query hooks (react-query) per feature
  shared/                   # types + scoring + validation shared with functions
functions/src/
  callables/                # thin handlers
  services/                 # business logic (pools, scoring, billing, tournaments)
  lib/                      # roles, audit, guards (assertCallerRole everywhere)
  scheduled/                # indexed-query jobs (no full scans)
docs/
  ARCHITECTURE.md           # deploy topology, shared/ copy-step, data model
  adr/                      # decisions
  plans/archive/            # completed PLAN-*.md
```

- **Business logic** lives in `functions/src/services/` (server, authoritative) and `shared/` (pure logic used by both). Not in components, not in `dbService`.
- **SEO concerns** live in the prerender step + a required-prop `SEO` component per route (the AUDIT-REPORT already flags the default-canonical bug — fix it there).
- **Shared utilities** in `shared/` (types, scoring, validation), consumed by app via alias and by functions via the existing copy-step.

---

# Refactoring Plan

## Phase 1: Quick wins (small changes, high impact)
- Guard `SimulationDashboard` against non-squares pools; add per-tab `ErrorBoundary` (kills the app-wide crash).
- Remove the `slug ^sim-` client-create rule; lock `system_logs` create to functions.
- Add Close/Archive button + CLOSED status column to Pools list (wire the existing `closePool`).
- Delete the `'ADMIN'` role branch in `espnBracket.ts`; delete `functions/.env` plaintext secrets and rotate.
- Fix `reminders.ts` to an indexed query.
- Fix the "undefined @undefined" matchup rendering in the NFL pool rows.

## Phase 2: Structural cleanup (maintainability + clarity)
- De-duplicate destructive ops → Operations is the sole home; remove System/Tournament duplicates; move Big12/BigEast (and add March Madness + other pool types) re-init into Operations/Tournament consistently.
- Extract `SuperAdmin.tsx` into per-tab modules.
- Delete verified dead code (~2,500 lines); archive completed PLAN-*.md; delete `src/nginx.conf`.
- Standardize admin auth on `assertCallerRole`; route client-side privileged writes through audited callables.
- Move the Global Props seed editor into a modal (fix the scroll-to-top UX).
- Rebuild "NFL Schedule" into an **NFL Pools** manager (import + per-week schedule viewer + management of the NFL pool types), not just an importer.

## Phase 3: Scale-readiness upgrades
- Persist + schedule Health Snapshots (hourly); show history + last-run in API Status Center.
- Convert remaining full-collection scanners to indexed queries; move `waitlist` to a subcollection.
- Paginate admin pools/users; lazy-load heavy admin panels; split `vendor-firebase`.
- Enforce App Check server-side; add per-uid rate limiting to `joinWaitlist`/`createClaimCode`.
- Member system upgrade: name search + filters + robust editable detail modal.

## Phase 4: Production hardening
- Full pool-type-segmented Test Suite with per-test descriptions; test every admin button; add tests for admin callables.
- Reconcile dependency versions + Node version (one everywhere); `npm ci` in Docker.
- Write ARCHITECTURE.md + project CLAUDE.md; single-source the CSP.
- Ratchet down ESLint warnings; make lint a gate once under control.
- Add monitoring/alerting on the scheduled jobs and Stripe webhook.

---

# Testing Strategy Recommendation

- **Unit** (vitest, already strong): keep the scoring/billing coverage; **add** tests for every admin callable in `functions/src` (auth-denial paths, dry-run vs live, audit-write assertions) — currently zero.
- **Integration** (emulator): expand beyond the single `poolCreation.emulator.test.ts` to cover pool lifecycle (create→lock→score→close), role changes + claim sync, and the Stripe webhook idempotency path.
- **Component**: add tests for the extracted admin tab modules (currently zero SuperAdmin coverage) — at minimum a smoke render per tab per pool type to catch the `.squares`-style crashes before prod.
- **E2E** (Playwright, exists): keep the unified-wizard spec; add an **admin walkthrough** spec that clicks every dashboard button per pool type and asserts no ErrorBoundary trip — this exact review would have been a passing/failing test.
- **Contract**: enforce that scoring + payload types come only from `shared/` so client and functions can't drift.
- **Performance checks**: a CI assertion on bundle chunk sizes; a lightweight test that scheduled jobs use indexed queries (no `.get()` on a bare collection).
- **CI gates**: promote lint from advisory to blocking once the count is ratcheted; add the admin-walkthrough E2E to the required jobs.

---

# Final Score

| Area | Score (1–10) |
|------|--------------|
| Architecture | 5 |
| Frontend structure | 4 |
| Backend structure | 6 |
| Database design | 6 |
| SEO architecture | 5 |
| Performance/scalability | 5 |
| Security | 5 |
| Maintainability | 4 |
| Developer experience | 6 |
| Production readiness | 5 |
| **Overall** | **5 / 10** |

**Justification.** This is a competent, genuinely-tested product with a sound money model, a real CI gate, and pockets of excellent engineering (the Operations guardrails, dual-guard auth, the domain glossary). It scores a 5 rather than higher because the surface you operate every day — the Super-Admin dashboard — is a single 4,321-line file behind one global error boundary that I watched crash the entire app from a normal admin button, with destructive operations duplicated at inconsistent guard levels and a client-side rules backdoor sitting in production. None of that is fatal; all of it is fixable, most of it in a focused Phase 1–2. Fix the crash blast radius, kill the duplicate/backdoor paths, and consolidate the god file, and this moves to a 7 quickly. The bones are worth the investment; the admin experience needs the cleanup before you scale users or add a second admin.
