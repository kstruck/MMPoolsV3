# March Melee Pools — Pre-Season Readiness Audit & Super-Admin Overhaul Plan

_Generated 2026-07-03 on branch `feat/ux-overhaul-phase4`. Evidence-based; build/lint/tests were run live. Supersedes nothing — builds on AUDIT-REPORT.md (2026-07-01) and verifies which of its findings are now closed._

**Scope note / premise correction:** the audit request stated the project "uses both Firebase and Supabase." It does not. A full-repo grep for `supabase` returns zero hits in application code (only inside vendored `skills/` prompt docs). This is a **Firebase-only** app: Firebase Auth + Firestore + Cloud Functions + Stripe. Every "Supabase RLS" question in the brief is therefore N/A; the Firestore rules review below covers the actual data trust boundary.

**Verification honesty:** everything cited as `file:line` was read from the working tree. Commands (`npm run lint`, `npm test`, `npx tsc -b --noEmit`, functions `tsc --noEmit`) were actually executed; outputs are reported verbatim. Things this environment cannot verify are explicitly marked **UNVERIFIED**: production Firestore contents (why *specific* pools are stuck open), whether `GEMINI_API_KEY` / Stripe secrets are actually set in prod Secret Manager, deployed Firestore indexes, and live Coolify/nginx behavior.

---

# Executive Summary

**Classification: DECENT BUT NEEDS CLEANUP** — a real upgrade from the 2026-07-01 audit's "FRAGILE."

Since the last audit, the critical money and integrity holes were genuinely closed (verified in code, not just claimed in commit messages): privileged-field stripping on pool creation (`functions/src/poolOps.ts:21-35`, `nflPools.ts:41`), server-authoritative Stripe pricing + webhook `amount_total` validation (`stripe.ts:85-129,598`), `simulateGameUpdate` authz (`scoreUpdates.ts:1287-1296`), playoff rankings validation (`playoffPools.ts:150-164`), 400-op batch chunking (`nflPools.ts:589-602`), a required CI build+test gate (`.github/workflows/ci.yml`), and repo junk removal (git ls-files: 0 hits for the old junk list). Firestore rules are now claims-based with protected-field diffs and immutable ledgers.

What remains is a different class of problem, and it is concentrated exactly where you asked me to look — the Super-Admin surface:

1. **The Super-Admin Overview dashboard is theater.** All five cards (Platform Ledger refresh, API Status Center, Security Audit "A+ CLEAN", Database Migration Tools, Automation Test Suite "42 passed / 0 failed") are hardcoded strings and `setTimeout` animations with zero backend calls (`SuperAdminBentoDashboard.tsx:48-83, 207-231, 264, 296-337, 348-382`). An admin dashboard that lies to its admin is worse than no dashboard.
2. **Feature flags are dead code.** `enableBracketPools` and `maintenanceMode` are written by the toggle UI (`SuperAdmin.tsx:2814-2830`) and read by **nothing** — no UI gate, no route guard, no server check.
3. **Pool lifecycle has no closer.** `autoLockPools` covers only SQUARES + BRACKET (`functions/src/autoLock.ts:46-60`); NFL season pools and Playoff pools have no scheduled close, and the GameOps status chips compute "open/final" from squares-only fields (`SuperAdmin.tsx:1012-1031`) — which is why months-old events still show "open."
4. **The GameOps NFL filter gap is a one-line data bug:** NFL_PICKEM/SURVIVOR/MARGIN pools fall through to `getLeagueDisplayName(pool.league)` with `league` undefined → bucketed "Other" (`SuperAdmin.tsx:995-1006`).
5. **This branch does not build:** `npx tsc -b --noEmit` fails with 2 unused-symbol errors in `ParticipantDashboard.tsx` (27,3 and 709,35) — the required CI gate would be red.

None of this is architectural rot; it is finishable in a focused pre-season sprint. The plan (PLAN-SUPERADMIN-OVERHAUL.md) sequences it.

---

# Project Understanding

SaaS for running sports pools: Squares grids, March Madness / conference brackets, NFL Pick'em / Survivor / Margin, NFL Playoff Challenge, Props pools. Managers create pools, participants join (paid or free), ESPN scores sync live, winners/payouts computed server-side. Monetization = per-pool Stripe billing + bundles + coupons + referral credits.

**Stack:** Vite 7 + React 19 SPA (TypeScript strict, react-router-dom 7, Tailwind 3), Firebase (Auth w/ custom claims, Firestore, ~70 Cloud Functions gen-2 Node 22), Stripe, Gemini (`@google/genai`), Courier SMS, Trigger-Email extension via `mail` collection. **Prod serving is nginx on Coolify via Dockerfile** (not Firebase Hosting); `firebase.json` exists for functions/rules deploy and a legacy hosting path. Social-bot OG previews for `/pool/`+`/join/` are handled by an nginx user-agent map proxying to the `joinPreview` function (`nginx.conf:5-8,35-56`).

**Pool type model** (`src/types/index.ts:909`): `SQUARES | BRACKET | NFL_PLAYOFFS | PROPS | NFL_PICKEM | NFL_SURVIVOR | NFL_MARGIN`.

---

# What Is Working Well

- **Rules are now a real trust boundary.** Claims-based `isSuperAdmin()` (`firestore.rules:17-18`); pool updates require manager + `protectedFieldsUnchanged()` diff-guard over `managerUid/ownerId/axisNumbers/squares/participants/billing` (`firestore.rules:52-60,81-84`); payments ledger and audit are `write: if false` append-only (`:100,135`); user self-writes cannot touch `role/referralCredits/freePoolsAvailable/poolCredits/activeBundleType/bundleExpiresAt` (`:220-229`); PII segregated into `squarePrivate` readable only by owner/manager/admin (`:113-125`).
- **Money path hardened and verified.** `PRIVILEGED_POOL_FIELDS` strip before spread (`poolOps.ts:21-35`); server price resolved from `billing_config` before any checkout branch and webhook validates `session.amount_total` (`stripe.ts:85-129,598`); all four secrets via `defineSecret` (`stripe.ts:17-18`, `gemini.ts:5`, `smsService.ts:1`) — nothing hardcoded.
- **CI gate exists and gates the right things.** `ci.yml`: required `build-and-test` job (npm ci root+functions, `build:static`, functions `tsc --noEmit`, `npm test`) + required `nginx -t` validation of the actual prod config; lint advisory. Live run: **114/114 tests pass**, lint **0 errors** (614 warnings).
- **SEO is now designed-in.** Central `seoConfig.ts` (14 routes mapped, unmapped → auto-noindex), `RouteSEO` at router root using React 19 native head hoisting, static OG/Twitter/Organization schema in `index.html`, robots.txt disallowing all private routes, nginx bot-detection for dynamic pool OG tags. This closes the prior audit's worst SEO findings.
- **Scoring engines remain pure and tested** — `synthetic-scenarios.test.ts` (26 property tests), `replay-2025.test.ts` (real-tournament replay), NFL pickem/survivor/margin engine tests (10).
- **Code-splitting is real:** 29/34 route components lazy (`App.tsx:15-49`), manual vendor chunks (`vite.config.ts:26-32`).

---

# Biggest Risks

1. **This branch fails its own CI build gate.** `tsc -b` → `TS6133` × 2 in `src/components/ParticipantDashboard.tsx(27,3)/(709,35)`. Trivial fix; blocking everything else.
2. **Admin surface displays fabricated data.** Five fake Overview cards (evidence above). Risk isn't cosmetic: you will make ops decisions during NFL Sundays off a card that always says "OPERATIONAL / A+ / 42 passed."
3. **No pool-lifecycle closer + status-model fragmentation.** Three status vocabularies coexist: bracket-style `status: DRAFT/OPEN/LOCKED/COMPLETED` (`firestore.rules:64-65`, `poolOps.ts:30`), squares-style `isLocked` + `scores.gameStatus: pre/in/post`, NFL pools with per-week locks but no terminal pool state. No scheduled function closes anything post-event (`autoLock.ts` locks, never closes; covers 2 of 7 types). Stuck-"open" pools are the guaranteed symptom. (Which *specific* prod pools and why — **UNVERIFIED**, needs a prod query, but the mechanism is established.)
4. **Feature flags have no teeth** — dead-code proof: grep for `enableBracketPools|maintenanceMode` yields only `types/index.ts:909-910`, `settingsService.ts:9-10` (defaults), `SuperAdmin.tsx:2814-2830` (toggles). Zero readers. Your launch gate (PLAN.md notes wizard routes gated by `isSuperAdmin()` in `App.tsx:357-408`) is a hardcode, not a flag.
5. **Playoff entries still a 1MB doc bomb.** `submitPlayoffPicks` writes entries as a map inside the pool doc (`playoffPools.ts` transaction on `fresh.entries`) — unfixed from prior audit; ~500 entries bricks the pool.
6. **Unbounded reads at admin + public scale.** `dbService.ts:611` public-pools subscription has no `limit()`; SuperAdmin subscribes to ALL pools + ALL users via `onSnapshot`; 63 unbounded listeners codebase-wide. Cost + memory scale linearly with success.
7. **Ops actions scattered with `window.confirm` guardrails.** Destructive callables (`backfillPools`, `adminInitTournament`, `importTournamentFromESPN`, `scoreBracketEntries`, `finalizeTournamentPayouts`, `importNFLSchedule`, `fixPoolScores`, `fixParticipantIds`, `recalculatePoolWinners`, `syncPlayoffPools`, Big12/BigEast re-inits) are spread across 4+ tabs; pool close/re-init exists in ≥3 places (Pools tab `SuperAdmin.tsx:606,667`, Tournament tab `:366,384`, SimulationDashboard writes). Two admins (or one admin twice) can collide.
8. **Config drift on the real prod path.** CSP is defined only in `firebase.json:82-84`; prod nginx (`nginx.conf`) sets no CSP → prod likely serves without CSP. Image cache 7d (firebase) vs 1y (nginx). Since prod = nginx/Coolify, firebase.json headers are dead letters.
9. **63 functions unit tests never run anywhere** — excluded by `vite.config.ts` test.exclude, no test script in `functions/package.json`, not in CI. PROPS and NFL_PLAYOFFS types have **zero** tests; SQUARES has none for scoring/payout.
10. **Residual authz nits:** `debug.ts:16` checks mutable Firestore `role` instead of the JWT claim for an HTTP debug endpoint; App Check initialized client-side (`src/firebase.ts:26-29`) but no callable sets `enforceAppCheck`.

---

# Detailed Findings By Category

## Repo & Codebase Structure
- **Finding:** Junk cleanup from prior audit landed. **Evidence:** `git ls-files | grep -E "git_superadmin|deploy_log|security_scan_results|skills_backup|functions/lib"` → 0. **Why it matters:** closes info-leak/hygiene items. **Fix:** none needed.
- **Finding:** `skills/` (300+ vendored prompt files) still dominates the tree and CI depends on `skills/skill-security-scanner/scripts/scanner.py` (`security-scan.yml`). **Why:** noise for new devs; CI coupled to prompt folder. **Fix:** move scanner to `scripts/`, evict `skills/` when convenient (Phase 2).
- **Finding:** `src/components/` remains a flat 70+ item grab-bag (marketing pages, wizards, dashboards, admin siblings). **Fix:** feature-folder regroup during SuperAdmin decomposition.
- **Finding:** Three Node versions in play: CI 20 (`ci.yml`), functions engines 22, security-scan 22, local 24. **Fix:** align on 22 + add root `engines` and `.nvmrc`.

## Frontend Super-Admin Architecture
- **Finding:** `SuperAdmin.tsx` is a 4,103-line god component holding 15 tabs (`activeTab` union at `:48`), all data subscriptions, all mutations. `AdminPanel.tsx` 1,418; `SuperAdminBillingPanel.tsx` 1,670. **Why:** every admin change concentrates regression risk in one file; re-renders whole tree per keystroke. **Fix:** split per-tab lazy modules (Phase 2 of plan).
- **Finding (Critical for trust):** Overview bento = fake. **Evidence:** `SuperAdminBentoDashboard.tsx` — refresh `:48-54` `setTimeout(800)`+toast; API status hardcoded array `:207-231`; security scan `:77-83` `setTimeout(1200)→'clean'`, "A+ (CLEAN)" literal `:264`; backfill `:64-75` writes local state only; "Clear Database Cache" `:318` is `toast.success` only; test suite `:56-62` `setTimeout(1500)`, "42 passed / 0 failed" literal `:380`. **Fix:** replace with real queries or delete cards (Ticket T3).
- **Finding:** Prop drilling: `onOpenAuth`×19 / `onLogout`×28 / `onCreatePool`×28 from `App.tsx`; single context is `ThemeContext`. **Fix:** `AuthContext` (Phase 2).
- **Finding:** Duplicated pool state mutation paths — Pools tab `dbService.updateBracketPool(...{status})` (`SuperAdmin.tsx:606,667,760,860`), Tournament tab callables (`:366,384`), SimulationDashboard `dbService.updatePool` (`SimulationDashboard.tsx:87,95`) — no shared service, no concurrency guard. **Fix:** single `poolLifecycleService` + consolidation (Tickets T2/T7).
- **Finding:** Accessibility is partial but no longer zero: 20+ aria/role usages incl. `role="dialog"` on AuthModal/ShareModal/PlayoffSettingsModal. Focus-trap/Escape handling still absent. **Fix:** Phase 4 polish.

## Backend Architecture
- **Finding:** ~70 exported functions from a flat `functions/src` (40+ files). AuthZ verified STRONG (JWT-claim checks) on the sensitive set: adminClaims `:21-24`, userManagement `:23,68`, backfill `:5`, aiTesting `:100,152,204`, espnBracket/conference inits, simulateGameUpdate `scoreUpdates.ts:1287-1296`, syncPlayoffPools `playoffPools.ts:483-484`. **Residue:** `debug.ts:16` Firestore-role check on an `onRequest` endpoint. **Fix:** claim check + or delete endpoint (T10).
- **Finding:** Lifecycle: `autoLockPools` (every 1 min, `autoLock.ts`) uses indexed queries now (`:48-58` — prior full-scan finding FIXED) but handles only SQUARES reminder-locks + BRACKET lockAt. **No close/complete sweep for any type; NFL/Playoff/Props have no pool-level terminal transition.** **Fix:** `autoClosePools` scheduled sweep + manual close callable (T2).
- **Finding:** Backfill non-idempotent (`backfill.ts:69-73` `FieldValue.increment` re-run double-counts). **Fix:** set-based writes + `schemaVersion` (Phase 3).
- **Finding:** No rate limiting on callables; ESPN fetches have 8s timeout+retry (`scoreUpdates.ts:94-100`) but no cross-pool dedupe cache — prior scale finding stands. **Fix:** per-gameId fetch dedupe (Phase 3).

## Database & Data Model (Firebase vs. Supabase split)
- **N/A on Supabase** (premise correction above). Firestore map: `pools/{id}` + subcollections (`payments` immutable, `participants`, `squarePrivate` PII, `audit`, `entries`, `messages`, `propCards`, ...), `users/{uid}` + `participations`/`seasonHistory`, `referrals`, `system/config` (flags), `config/internal` (server-only HMAC), `themes`, `coupons`, `tournaments`, `mail` (client-write false), `slugs`, `winners`, `stats`.
- **Finding:** Playoff entries map-in-doc unfixed (`playoffPools.ts` — entries object in pool doc). **Fix:** subcollection migration (T8).
- **Finding:** Status model fragmentation (three vocabularies; see Risk 3). `firestore.rules:64-65` only knows `DRAFT/OPEN`, `backfill.ts:30` derives status from `isLocked/isFinal`. **Fix:** canonical `status` + `lifecycle` map per type, written server-side (T2 includes normalization).
- **Finding:** `pools/{id}` `allow get: if true` (`firestore.rules:23`) — now mitigated because PII moved to `squarePrivate`, but pool doc still exposes billing status/entry data to guests by ID. **Fix:** field-level trim of what create/join writes into the public doc (Medium, Phase 4).
- **Finding:** `firestore.indexes.json` has 8 composite indexes aligned to visible queries; deployed-state **UNVERIFIED**.

## SEO Architecture
- Designed-in now (see Working Well). **Gaps:** static `sitemap.xml` (lastmod hardcoded 2026-07-01; missing dynamic/public pool URLs); no per-pool JSON-LD; sitemap not generated from route table at build despite `scripts/prerender.ts` existing in build chain (`build:static`). **Fix:** build-step sitemap generation + pool-page schema (Phase 4; low risk).

## Performance & Scalability
- `dbService.ts:611` public pools `where(isPublic==true)` no limit, subscribed app-wide; `:623` participating pools unbounded; SuperAdmin subscribes ALL pools + ALL users; `AdminStatsDashboard.tsx:50-110` aggregates entire collections in `useMemo`. 63 `onSnapshot` sites without limits. **Fix:** limits + pagination + one-shot aggregates (T9).
- ESPN per-pool fetch dedupe still missing (prior finding; stands). Sharded `stats/global` counters still pending.

## Security & Production Readiness
- Verified-fixed list: rules billing fields, Stripe pricing/webhook, privileged-field strip, simulateGameUpdate, syncPlayoffPools, rankings validation, batch chunking, aiTesting auth, secrets via defineSecret, junk untracked, CI gate. See "Verification of 2026-07-01 audit" table in the plan appendix.
- Open: `debug.ts:16` mutable-role check; App Check not enforced server-side (`enforceAppCheck` absent); mock-Stripe fallback behavior now key-presence-gated (`stripe.ts:151` placeholder check) — acceptable but should hard-fail in prod; CSP absent on the nginx prod path (drift); `.env` Gemini placeholder implies key rotation done but **prod secret state UNVERIFIED**.
- **Would a production engineer be nervous?** About money/integrity: no longer. About operating it on an NFL Sunday with a fake status dashboard, no pool closer, and unbounded admin reads: yes.

## Maintainability & DX
- Live results: lint 0 errors/614 warnings (467 `no-explicit-any`); tests 114/114 in 1.0s; root tsc FAILS (2 errors); functions tsc PASSES; functions tests (63) orphaned; husky pre-commit = secrets scan only.
- God files: SuperAdmin 4,103 / BracketPoolDashboard 2,253 / SuperAdminBillingPanel 1,670 / Grid 1,467 / AdminPanel 1,418 / TournamentSimulator 1,259.
- Good: 17-module services layer, repositories exist (`BaseRepository.ts`), CONTEXT.md glossary current (defines 5-role model the code hasn't implemented yet — flag: code has 3 roles `POOL_MANAGER|PARTICIPANT|SUPER_ADMIN` (`types/index.ts:908`) vs CONTEXT.md's `SUPER_ADMIN|MODERATOR|COMMISSIONER|MEMBER|BANNED`; PLAN-USER-MGMT.md already specs the migration).

---

# Feature Enhancement Deep Dives

## 1. User Management
- **Current:** Management→Users tab wired: live `onSnapshot` on `users`, columns incl. read-only role badge; Reset Password (`SuperAdmin.tsx:2462` → `sendAdminPasswordReset`, SUPER_ADMIN-gated `userManagement.ts:68`), Edit name/email (`:2484`), Delete (`:2504` → `deleteUserAccount` `:23`). Backend `setSuperAdminClaim` exists (`adminClaims.ts`, caller-claim-checked) but **no client caller exists** (grep: 0 hits in src). Referral data (`referrals/*`, `users.referralCount/referredBy`) and loyalty tiers (`settingsService.ts:12-14`, `system/config.loyaltyTiers`) exist but render in separate tabs.
- **Gap:** no role-change UI; no MODERATOR/COMMISSIONER/MEMBER/BANNED roles (CONTEXT.md defines them; code doesn't); no unified profile view.
- **Design:** extend `adminClaims.ts` to a generic `setUserRole(targetUid, role)` validating against the CONTEXT.md role enum, writing claim + mirror + `admin_audit` + target `activity` log; UserProfileDrawer (click row → drawer) aggregating `users/{uid}` + `participations` + `seasonHistory` + referrals query + computed loyalty tier; role selector with typed-confirm guardrail for SUPER_ADMIN grants.
- **Effort:** M (3-5d). **Risk:** Medium — role escalation path; must keep claim+mirror atomic and audited.

## 2. GameOps
- **Current:** pools via `onSnapshot`; sport filter `SuperAdmin.tsx:989-1007`; status chips `:1012-1031`; per-row Manage/Sim/Fix/Delete wired.
- **Root causes found:** (a) **NFL filter:** NFL_PICKEM/SURVIVOR/MARGIN hit the `else` → `getLeagueDisplayName(pool.league)`; NFL season pools don't set `league` → "Other". Fix = map those three types to 'NFL Football' explicitly (the grouping at `:1057-1070` has the identical bug). (b) **Stuck "open":** no close sweep exists for any type (`autoLock.ts` locks only SQUARES/BRACKET); chips derive from squares-only fields for non-bracket types, so NFL pools can never be 'final'.
- **Design:** fix both mappings; add `closePool` callable (SUPER_ADMIN or owner) setting canonical terminal status per type + audit entry; add `autoClosePools` daily sweep (event end date/final week detection per type); manual "Close pool" row action with explain-what-happens confirm.
- **Effort:** S for filter (hours); M for lifecycle (2-4d). **Risk:** filter Low; lifecycle Medium (must not close live pools — dry-run mode first).

## 3. Tournament Simulator → Test Suite tab
- **Current:** `SimulationDashboard.tsx` (334 lines): simulates score progression / grid fill / rule toggles on **real pool docs** via `dbService.updatePool` (`:87,95`); **excludes BRACKET** (`:32`); rules allow client sim-pool creation only for slug `^sim-.*` (`firestore.rules:197` area, pools create rule `:87`). Separate `TournamentSimulator.tsx` (1,259 lines) at `/tournament-sim`. AI testing (below) is separate again.
- **Gap:** no per-pool-type end-to-end validation (create → join → picks → lock → score → winners → payout), no assertions, no bracket coverage, three disconnected testing surfaces.
- **Design:** one Test Suite tab = scenario runner per pool type built on the `sim-` namespace: for each of the 7 types, a scripted lifecycle driver calling the *real* callables (createX, joinX, submit picks, score, finalize) against sim pools, then asserting invariants (entry counts, standings math vs pure engines, payout sums, status transitions), with a results table (real pass/fail, not the fake bento). Reuse `aiTesting.ts` scenario generation as optional input, not the engine.
- **Effort:** L (1-2wk). **Risk:** Medium — must hard-isolate sim pools (slug prefix + `isSimulation` flag + excluded from public queries/stats/emails).

## 4. Operations consolidation + guardrails
- **Current inventory (scattered):** Tournament tab: `initializeBig12TournamentHttp`, `scoreBracketEntries` (`SuperAdmin.tsx:366,384`); espnBracket callables `adminInitTournament`, `importTournamentFromESPN`, `importConferenceTournamentFromESPN`, `syncBracketTournament`; NFL tab: `importNFLSchedule`, `syncNFLScoresJob`; System tab: `fixPoolScores` (`:2640`), `fixParticipantIds` (`:2651`), email export; plus `backfillPools`, `recalculatePoolWinners`, `syncPlayoffPools`, `finalizeTournamentPayouts`. Guardrails today = `window.confirm` (61 instances per prior audit) or none.
- **Design:** single Operations tab: action registry (name, description, blast radius, target selector, destructive flag) → one `ConfirmActionModal` (explains effect, requires typing pool ID/action name for destructive ops) → invokes callable → appends to an `admin_audit` doc + shows real run log. Remove duplicate buttons from other tabs.
- **Effort:** M (4-6d, mostly moving existing wiring). **Risk:** Low-Medium; pure re-plumbing of already-gated callables.

## 5. Configuration tab — Themes (low priority)
- **Current:** wired CRUD on `themes` collection (seed presets / edit via ThemeBuilder / delete / set default, `SuperAdmin.tsx:2160`+); presets are March-Madness-only.
- **Design:** add `appliesTo: PoolType[]` to theme schema + preset packs per sport; wizard theme pickers filter by pool type. **Effort:** S-M. **Risk:** Low.

## 6. AI Testing tab
- **Current:** **works on paper end-to-end**: `SimpleTestingDashboard`/`TestingDashboard` → `aiTestingService` (httpsCallable) → `aiTesting.ts` `generateTestScenario/validateTestResults/generateTestReport`, all SUPER_ADMIN-gated (`:100,152,204`), Gemini via `defineSecret`, structured-output schema, generic `poolType` param (not bracket-only). **UNVERIFIED:** prod `GEMINI_API_KEY` secret set (client `.env` shows a placeholder, but the functions secret is separate); actual runtime success.
- **Gap:** unproven in prod; results not persisted; no link into the Test Suite runner; prompt takes `userRequest` unsanitized (`aiTesting.ts:109`) — prompt-injection into your own tool (low severity given SUPER_ADMIN-only, still worth a wrapper).
- **Design:** fold into Test Suite tab as "AI scenario author"; persist scenarios/results to `testRuns` collection; verify secret + add a smoke button that reports the real model response.
- **Effort:** S-M. **Risk:** Low.

## 7. Monetization tab
- **Current:** `SuperAdminBillingPanel.tsx` (1,670 lines) wired to real Firestore (coupons/tiers/packages/referrals/pools with billing status); Stripe checkout+webhook server-side (`stripe.ts`); billing lifecycle `free|trial|grace_period|locked|active` enforced by daily `enforceBillingStatus` (`billing.ts:44`); manual paid-toggle exists. Overview "Total Revenue" stat comes from the stats prop (global stats doc), not a ledger aggregate.
- **Gap:** no revenue reporting (MRR, per-type revenue, coupon redemption cost, refunds); no reconciliation view Stripe↔`pools/*/payments` ledger; the panel is another god file.
- **Design:** add a read-only Revenue section fed by a scheduled aggregate (functions writes `stats/revenue` daily from ledger + Stripe events already stored); split panel into subcomponents during decomposition.
- **Effort:** M. **Risk:** Low (read-only aggregates).

## 8. Settings / Feature Flags
- **Current:** flags stored `system/config` (`settingsService.ts:4`), rules write=SUPER_ADMIN (`firestore.rules:269-272`), toggles wired (`SuperAdmin.tsx:2814-2830`) — **zero readers anywhere** (grep evidence in Risks #4). Launch gating is hardcoded `isSuperAdmin()` on wizard routes (`App.tsx:357-408`).
- **Gap:** flags are decorative; disabling a pool type changes nothing.
- **Design:** see "Feature Flag System Design" below. **Effort:** M (2-4d). **Risk:** Low-Medium (must fail-open sensibly if config doc missing).

---

# Proposed Super-Admin Information Architecture

Eight tabs replace the current 15-value `activeTab` union + 4 nav groups. Rule: **one capability lives in exactly one place.**

| Tab | Purpose (one line) | What moved here |
|---|---|---|
| **Overview** | Real platform vitals only — no synthetic cards | Platform Ledger stats (already real); NEW real health pings; fake cards deleted |
| **Pools** | Find/inspect/manage any pool; the only place a pool's state changes by hand | GameOps Pools + fixed filters + NEW Close action; per-pool Fix actions move here from System |
| **Operations** | Global batch/import/sync actions with guardrails + run log | Tournament init/import, NFL schedule import/sync, backfills, global props — from Tournament/NFL/System tabs |
| **Test Suite** | Validate every pool type E2E before season; sim + AI authoring | SimulationDashboard + TournamentSimulator + AI Testing merged |
| **Users** | Membership: list → unified profile drawer → role management | Users + Referrals + Loyalty (as profile facets, not sibling tabs) |
| **Monetization** | Billing config + coupons + revenue reporting | Billing panel + NEW revenue aggregates |
| **Configuration** | Flags (with teeth), themes, seasons | Settings flags + Themes; loyalty tier *definitions* stay here |
| **System** | Audit log, email export, health diagnostics | AuditLogViewer, exports; debug endpoints retired |

Explicitly removed duplications: pool status changes exit Tournament tab and SimulationDashboard (simulator manipulates only `sim-` pools); `fixPoolScores`/`fixParticipantIds` become per-pool row actions in Pools (single target) — batch variants live in Operations.

# Feature Flag System Design

- **State:** stay in `system/config` (already rules-protected, already subscribed via `settingsService.subscribe` onSnapshot). Extend shape: `poolTypeFlags: Record<PoolType, boolean>` + keep `maintenanceMode`.
- **Frontend checks:** (1) `CreatePoolSelection.tsx` hides/disables cards for disabled types; (2) wizard routes in `App.tsx` render a "temporarily unavailable" screen when flag off (replaces the hardcoded `isSuperAdmin()` launch gate — super-admin bypass flag `allowAdminOverride` preserved); (3) landing-page CTAs check the same hook `useFeatureFlags()`.
- **Server enforcement (authoritative):** each create callable (`createPool`, `createNFLPool`, `createBracketPool`, playoff/props creators) reads `system/config` and rejects disabled types with `failed-precondition`. This is the teeth; UI is UX.
- **Caching/staleness:** client — none needed, onSnapshot is push; server — per-invocation `getDoc` is 1 read/creation (negligible volume), optionally memoize 60s per instance. Fail-safe: missing doc/field → `DEFAULT_FLAGS`, duplicated across the two module-incompatible TS roots (functions copy = source of truth, root vitest parity test asserts deep equality so CI fails on drift) so prod misconfig can't brick creation; `maintenanceMode` checked in the same guard and by a top-level banner.
- **Configuration tab:** per-type toggle matrix with live "who reads this" indicator and a confirm modal stating exactly which surfaces will change.

---

# Top 10 Priority Fixes

| # | Fix | Priority | Effort | Impact | Area | Why now |
|---|---|---|---|---|---|---|
| 1 | Fix 2 TS6133 errors in `ParticipantDashboard.tsx` — CI build gate is red | Critical | Small | Large | DX | Everything else merges through this gate |
| 2 | Pool lifecycle: canonical status per type + `autoClosePools` sweep + manual Close action | Critical | Medium | Large | Backend/Frontend | Stuck-open pools are live prod damage; pre-season deadline |
| 3 | Delete/replace 5 fake Overview cards with real data | High | Small-Med | Large | Frontend | Admin surface must not lie during NFL Sundays |
| 4 | GameOps: NFL type→sport mapping + status chips per pool type | High | Small | Medium | Frontend | One-line bugs blocking daily ops; unblocks pool triage |
| 5 | Feature flags with teeth (poolTypeFlags end-to-end + maintenanceMode) | High | Medium | Large | Full-stack | Launch gating currently hardcoded; needed for staged pre-season rollout |
| 6 | Role management: `setUserRole` + role UI + unified user profile drawer | High | Medium | Large | Full-stack | Core super-admin ask; backend half exists |
| 7 | Operations tab consolidation + typed-confirm guardrails + admin_audit | High | Medium | Large | Frontend/Backend | Destructive actions currently one `window.confirm` from disaster, in 4 places |
| 8 | Playoff entries → subcollection migration | High | Medium | Large | DB | 1MB doc bomb before playoffs; unfixed from prior audit |
| 9 | Bounded reads: `limit()` on `dbService.ts:611/623`, paginate admin users/pools, one-shot aggregates | Medium | Medium | Medium | Perf/Cost | Cost scales with success; admin tab load time |
| 10 | Run functions tests in CI; `debug.ts` claim check; `enforceAppCheck` on money/AI callables | Medium | Small-Med | Medium | Security/DX | 63 orphaned tests; last authz nits |

# Files and Folders That Need the Most Attention

- `src/components/SuperAdmin.tsx` (4,103) — every feature above lands here; decompose as you go, not after.
- `src/components/SuperAdminBentoDashboard.tsx` — the fake-data file; smallest fix, biggest honesty win.
- `functions/src/autoLock.ts` + (new) `autoClose` — lifecycle gap.
- `functions/src/playoffPools.ts` — last unfixed prior-audit critical (entries map).
- `src/services/dbService.ts` (:611,:623) — unbounded subscriptions.
- `src/services/settingsService.ts` + `src/types/index.ts:908-910` — flag + role model extension point.
- `functions/src/debug.ts` — weak-auth HTTP endpoint.
- `nginx.conf` vs `firebase.json` — prod header drift (CSP).

# Architectural Smells

God components (SuperAdmin/BillingPanel/AdminPanel); three pool-status vocabularies; simulator writing production collection with only a slug convention as isolation; flags written-never-read; role model drift (code 3 roles vs CONTEXT.md 5); ops actions duplicated across tabs; `window.confirm` as the only guardrail on destructive callables; test infra triplicated (Simulation/TournamentSimulator/AI Testing); 614 lint warnings normalizing `any`.

# What Will Hurt Later If Ignored

Playoff entries doc bomb (bricks pools mid-playoffs); unbounded listeners (read billing grows with pool count × visitors); non-idempotent backfill (`backfill.ts:69-73`) + no `schemaVersion` (every migration is risky); functions tests rotting unexecuted; ESPN fetch fan-out without dedupe (Sunday throttling); node-version drift (20/22/24) surfacing as "works locally" bugs.

# SEO Verdict

**Substantially fixed since 2026-07-01; now designed-in.** Central `seoConfig.ts` + `RouteSEO` with auto-noindex fallback, static OG in `index.html`, robots.txt correct, nginx bot-proxy for pool/join OG previews. Remaining: sitemap is static (hardcoded lastmod, no dynamic pool URLs) — generate from the route table in `build:static`; no per-pool JSON-LD. Rendering model (CSR + prerender script + bot proxy) is now adequate for this product; a marketing-SSG migration is optional, not urgent.

# Scalability Verdict

Backend scales to pre-season, not to peak-Sunday at 1k pools. Breaks first: (1) ESPN per-pool fetch fan-out (no gameId dedupe cache), (2) unbounded pool/user subscriptions in admin + `App.tsx` public-pools stream, (3) playoff entries doc size, (4) `stats/global` single-doc contention. Fix 1-3 before growth (Phase 3); sharded counters and trigger consolidation can wait.

# Maintainability Verdict

Workable for one skilled dev, hostile to a team: 4k-line admin file, 614 `any`-class warnings, three testing surfaces, orphaned functions tests. The services layer, strict TS, CI gate, and CONTEXT.md glossary are real assets. Highest-leverage: decompose SuperAdmin per-tab (do it as part of the IA rework, zero extra cost), AuthContext, run functions tests, one pool-lifecycle service.

# Suggested Ideal Structure

```
src/
  app/routes.tsx            # route table (also feeds sitemap gen)
  contexts/AuthContext.tsx
  features/
    admin/
      overview/  pools/  operations/  test-suite/  users/  monetization/  configuration/  system/
      shared/ConfirmActionModal.tsx  actionRegistry.ts
    pools-{squares,bracket,nfl,playoff,props}/
    marketing/
  services/ (keep; add poolLifecycleService, featureFlagService)
  shared/{components,hooks,seo}/
functions/src/
  lib/{authGuards,featureFlags,poolLifecycle,espnClient,fieldAllowlists}.ts
  domains/{billing,scoring,pools,brackets,playoff,props,notifications}/
  scheduled/{autoLock,autoClose,enforceBilling}.ts
```

# Refactoring Plan

## Phase 1: Quick wins (days) — unblock + stop the lying
Fix TS errors (#1); GameOps filter + status chips (#4); delete/replace fake bento cards (#3); wire functions tests into CI + fix `debug.ts` (#10 part).

## Phase 2: Structural cleanup (1-2 weeks) — the Super-Admin overhaul
New 8-tab IA with per-tab lazy modules (decomposing SuperAdmin.tsx as tabs move); Operations tab + ConfirmActionModal + admin_audit (#7); Users tab: setUserRole + unified profile drawer (#6); feature flags end-to-end (#5); AuthContext.

## Phase 3: Scale-readiness (1-2 weeks)
Pool lifecycle sweep + manual close (#2 — can start in Phase 1 as callable, UI lands with Ops tab); playoff entries subcollection (#8); bounded reads/pagination (#9); ESPN gameId dedupe; idempotent backfills + schemaVersion.

## Phase 4: Production hardening (ongoing, pre-launch)
Test Suite tab (full per-type E2E harness, folds in AI testing + simulator); themes per pool type; revenue aggregates in Monetization; `enforceAppCheck`; CSP into nginx.conf + cache-header reconciliation; sitemap generation in build; modal focus-trap a11y; align Node 22 everywhere.

# Testing Strategy Recommendation

- **Keep:** pure-engine unit tests (strong). **Add unit:** flag guard, lifecycle transitions, role validator.
- **Integration:** run `functions/src/__tests__` (63 tests) in CI (add `"test":"vitest run"` to functions); rules-unit-testing for the protected-field diffs and flag-doc writes.
- **E2E (the new Test Suite tab doubles as this):** scripted lifecycle per pool type against emulators in CI (create→join→picks→lock→score→finalize→payout, assert invariants); PROPS + NFL_PLAYOFFS + SQUARES-scoring coverage is currently zero — start there.
- **Contract:** snapshot ESPN parser responses.
- **SEO checks in CI:** route-table↔sitemap parity; unique title/canonical per public route.
- **Gates:** existing ci.yml + functions tests + (later) emulator E2E job; keep lint advisory until `any` debt burned down, then promote.

# Final Score

| Area | Score |
|---|:--:|
| Architecture | 6 |
| Frontend structure | 5 |
| Backend structure | 6 |
| Database design | 5 |
| SEO architecture | 7 |
| Performance/scalability | 5 |
| Security | 6 |
| Maintainability | 5 |
| Developer experience | 6 |
| Production readiness | 5 |
| **Overall** | **6 / 10** |

**Justification:** The July-1 criticals — payment bypasses, winner-rigging, no CI gate, PII in world-readable docs — are verifiably closed in code, which moves this from "risky to charge money" to "decent but needs cleanup." What holds it at 6 is operational readiness rather than exploitability: an admin dashboard whose Overview is fabricated, feature flags that do nothing, no pool-close lifecycle (with live stuck-open pools as the symptom), one unfixed data-model bomb (playoff entries), unbounded reads, and a branch that currently fails its own build gate. Every one of these has a bounded, known fix in the plan; landing Phases 1-2 before pre-season plausibly makes this a 7-8.

---

# Opus Execution Tickets

_Self-contained; each implementable independently unless a dependency is listed. All destructive-action tickets require the guardrail pattern from T7. Terms per CONTEXT.md._

_**Model guidance (approved by Kevin 2026-07-03):** T1, T3, T4, T5, T7, T9, T10, T11, T13, T14 are well-specified and routine — Opus. Three tickets warrant switching to Fable 5 (or extra review if run on Opus): **T2** (lifecycle dual-write interacts with live-money stats triggers, `recalculateGlobalStats` pot math, and prod data — a wrong transition corrupts global stats or emails users), **T8** (live-data migration of playoff entries with dual read path and new rules — data-loss risk), **T12** (service-layer extraction across 6+ callable files + sim-leak containment across every trigger — the most architectural ticket, and a missed guard sends real email). **T6** is borderline: the role cutover spec is complete, but it is a privilege-escalation surface — Opus acceptable, request an extra review pass on `setUserRole` and the alias layer before merge._

**T1 — Fix CI-blocking TypeScript errors**
- Objective: make `tsc -b` green on `feat/ux-overhaul-phase4`.
- Files: `src/components/ParticipantDashboard.tsx` (remove unused `RotateCcw` import at 27,3 and unused `canRerun` at 709,35 — or use them if intended).
- Acceptance: `npx tsc -b --noEmit` exit 0; `npm run build` succeeds; CI build-and-test green.
- Deps: none. Risk: none.

**T2 — Pool lifecycle: canonical close + auto-close sweep**
- Objective: every pool type reaches a terminal status automatically after its event ends, and Super-Admin can close any pool manually.
- Files: new `functions/src/autoClose.ts` (scheduled, daily), `closePool` callable added to the existing lifecycle/exception layer (`functions/src/poolExceptions.ts`, alongside `cancelPool`) — authz `ownerId || managerUid || SUPER_ADMIN` (repo-standard principal, `firestore.rules:34-49`); per-type terminal status: SQUARES→`scores.gameStatus:'post'`+`isFinal`, BRACKET/NFL_*/PLAYOFF/PROPS→`status:'COMPLETED'`; lifecycle precedence: `CANCELED` (written by `poolExceptions.ts:342-392`) is terminal — `closePool` and the sweep reject/skip pools already in a terminal state (test: sweeping a CANCELED pool leaves it CANCELED); `functions/src/index.ts` exports, `src/services/dbService.ts` wrapper, Pools-tab row action.
- Dual-write requirement: `closePool` sets canonical `status` AND the legacy fields non-admin surfaces read (`isLocked:true`, `isFinal:true`, game-bound types `scores.gameStatus:'post'`) — BrowsePools.tsx:81,305 / ManagerDashboard.tsx:205 / ParticipantDashboard.tsx:236 derive state from those, not `status` — AND `closedVia:'ADMIN_CLOSE'` in the same update. Trigger suppression is mandatory: `onPoolLocked` (`statsTrigger.ts:10,46`, increments stats/global) and `onGameComplete` (`postGameEmail.ts:35,58`, sends email) both fire on these legacy-field transitions; both get early-return on `closedVia` + pool-type guards. Same guard for the batch path: `recalculateGlobalStats` (`statsTrigger.ts:115`) must exclude `closedVia:'ADMIN_CLOSE'` locks or gain NFL/PROPS pot math before dual-write ships. Acceptance: admin close ⇒ zero stats/global deltas + zero mail writes, and a follow-up `recalculateGlobalStats` run leaves totals unchanged (emulator test).
- Email-health external assumption (T3 dependency shared here): Trigger-Email `delivery.state` shape must be confirmed against one real `/mail` doc before the health payload locks; fallback metric = docs-written-24h + oldest doc missing `delivery`.
- Acceptance: unit tests for transition map per type; sweep dry-run mode logs candidates before acting; closing writes an `audit` entry; manually closed pool disappears from "open" filters in SuperAdmin AND BrowsePools/ManagerDashboard/ParticipantDashboard; sweeping a CANCELED pool leaves it CANCELED; a sim pool with past event date is auto-closed by the sweep in emulator test.
- Deps: T4 (status chips must read new statuses correctly). Guardrails: manual close uses ConfirmActionModal (T7) or interim typed-confirm; sweep ships behind a config kill-switch and dry-run first week.

**T3 — Replace fake Overview cards with real data**
- Objective: no hardcoded/synthetic values on `/super-admin` Overview.
- Files: `src/components/SuperAdminBentoDashboard.tsx`.
- Actions: DELETE Security Audit card, Database Migration card, Automation Test Suite card (their real homes: Operations tab T7 / Test Suite T12). REPLACE API Status Center with a new SUPER_ADMIN callable `getAdminHealthSnapshot` (server-side: ESPN scoreboard timed fetch, Firestore timed read, function self-latency, email delivery health via the Trigger-Email extension's `delivery.state` field — counts of PROCESSING/ERROR last 24h + last error; NOT raw `/mail` count, which has no pending/sent semantics per `reminders.ts:54-61`; `mail` is not client-readable per `firestore.rules:300-301`); drop the SendGrid row (SendGrid isn't in the stack). Wire Refresh to re-invoke the callable.
- Acceptance: grep shows no hardcoded 'OPERATIONAL'/'A+'/'42 passed' literals; each metric traceable to a real call; failure states render (test by pointing one check at an invalid URL in dev).
- Deps: none.

**T4 — GameOps: NFL filter + per-type status chips**
- Objective: NFL season pools filterable as 'NFL Football'; status chips correct per pool type.
- Files: `src/components/SuperAdmin.tsx:989-1074` (both the filter and the `poolsBySport` grouping).
- Actions: in both switch blocks add `else if (['NFL_PICKEM','NFL_SURVIVOR','NFL_MARGIN'].includes(p.type)) sport = 'NFL Football'`; rework status derivation (`:1012-1031`) to a per-type map: bracket-like types use `status`, SQUARES uses `isLocked/scores.gameStatus`, NFL_* use `status` + current-week lock state.
- Acceptance: NFL FOOTBALL chip shows pick'em/survivor/margin pools; a COMPLETED NFL pool matches 'Final' filter; unit test for the sport-mapping function (extract it to a util).
- Deps: pairs with T2's canonical statuses (works standalone using existing fields).

**T5 — Feature flags with teeth**
- Objective: disabling a pool type removes creation ability end-to-end; enabling restores it.
- Files: `src/types/index.ts` (add `poolTypeFlags: Record<PoolType, boolean>`), `src/services/settingsService.ts` (defaults), new `src/hooks/useFeatureFlags.ts`, `src/components/CreatePoolSelection.tsx`, `src/App.tsx` wizard routes (replace hardcoded `isSuperAdmin()` gate at ~357-408 with flag check + admin override), functions: shared `functions/src/lib/featureFlags.ts` guard called at top of `createPool`/`createNFLPool`/`createBracketPool`/playoff/props creators, plus `assertNotMaintenance()` from the same module called by ALL state-changing callables (create/join/submit picks/reserve/pay/grade) so `maintenanceMode` has real semantics; SuperAdmin Configuration tab toggle matrix.
- Acceptance: with `poolTypeFlags.NFL_SURVIVOR=false`: card hidden, direct route shows unavailable screen, direct callable invocation returns `failed-precondition` (emulator test); flipping flag restores all three within one snapshot tick; missing config doc → defaults (all enabled types per current launch posture) and creation still works.
- Deps: none. Risk note: server guard must fail-open to defaults on read error — never brick creation on a missing doc.

**T6 — Role management + unified user profile**
- Objective: change any user's role from the dashboard; one click shows everything known about a user.
- Files: `functions/src/adminClaims.ts` (generalize to `setUserRole(targetUid, role)` with enum validation per CONTEXT.md roles — coordinate with PLAN-USER-MGMT.md which already specs MODERATOR/COMMISSIONER/MEMBER/BANNED). **Hard prerequisite:** grep-zero sweep of legacy enum write-paths (`userSync.ts:37`, `participant.ts:31`, `poolOps.ts:117-118`, `nflPools.ts:82-84`, `src/utils/auth.ts:28`, `types/index.ts:515`, `firestore.rules:222`) + alias layer (POOL_MANAGER→COMMISSIONER, PARTICIPANT→MEMBER) before exposing `setUserRole`. `src/types/index.ts:908` role union, new `src/features/admin/users/UserProfileDrawer.tsx` (profile fields + `participations` + `seasonHistory` + referrals query + computed loyalty tier from `system/config.loyaltyTiers`), Users tab row → drawer, role selector.
- Acceptance: role change writes claim + `users/{uid}.role` mirror + `admin_audit` entry + target `activity` `ROLE_CHANGED`; non-SUPER_ADMIN caller rejected (emulator test); drawer shows live data for a seeded user; SUPER_ADMIN grant requires typed confirmation.
- Deps: T7 modal (or interim typed-confirm). Risk: privilege escalation surface — server must re-validate caller claim, never trust UI.

**T7 — Operations tab + guardrail modal + admin audit**
- Objective: all global ops actions in one place, each behind an explain-then-confirm guardrail, all logged.
- Files: new `src/features/admin/operations/` (action registry + panel), new `src/features/admin/shared/ConfirmActionModal.tsx` (shows: what it does, targets, irreversibility; destructive ⇒ type action name), remove duplicated buttons from Tournament/NFL/System tabs in `SuperAdmin.tsx`; functions: ensure each invoked callable writes `admin_audit`. `admin_audit` spec (define BEFORE wiring — collection has zero references today): doc shape `{actorUid, actorEmail, action, targetType, targetId, metadata, status, error, at}` — `metadata` is a per-action redacted subset capped at 1KB (never raw params/results: PII + doc-size risk), `status`/`error` short summaries; composite indexes `(actorUid, at desc)` + `(action, at desc)`; reader panel in System tab (AuditLogViewer pattern); 12-month retention via Firestore TTL on `at`.
- Registry contents: adminInitTournament, importTournamentFromESPN, importConferenceTournamentFromESPN, initializeBig12/BigEastTournamentHttp, syncBracketTournament, importNFLSchedule, syncNFLScoresJob, backfillPools, fixPoolScores (batch), fixParticipantIds (batch), recalculatePoolWinners, syncPlayoffPools, finalizeTournamentPayouts.
- Acceptance: every action reachable from exactly one UI location; destructive ones cannot fire without typed confirm; each run appends `admin_audit` doc (actor, action, target, result) visible in System tab; zero `window.confirm` left in the ops paths.
- Deps: none (T2/T6 consume the modal).

**T8 — Playoff entries → subcollection**
- Objective: eliminate the 1MB pool-doc bomb.
- Files: `functions/src/playoffPools.ts` (`submitPlayoffPicks` write path, scoring reads, `managePlayoffEntry`), migration script in `functions/scripts/` (idempotent, set-based), `src/components/PlayoffPool/*` readers, new `firestore.rules` block. Target is a DEDICATED `pools/{id}/playoff_entries/{uid}` subcollection — NOT the shared `entries` subcollection, whose rules/readers key on `ownerUid` (`firestore.rules:185-198`, `bracketEntries.ts:58,83`) while playoff entries key on `userId` (`playoffPools.ts:174,193,271`).
- Acceptance: new entries write to `pools/{id}/playoff_entries/{uid}` with a rules block mirroring the entries pattern under playoff keying; scoring produces identical standings on a replayed fixture (test against existing playoff scoring logic); migration is re-runnable without duplication; old map read-path kept behind a fallback until migration confirmed.
- Deps: none. Risk: data migration — run in dry-run, then on a copy, then prod; keep the old map untouched until verified.

**T9 — Bounded reads + admin pagination**
- Objective: no unbounded collection subscriptions.
- Files: `src/services/dbService.ts:611,623` (add `limit()` + where filters), `src/components/SuperAdmin.tsx` pools/users subscriptions (paginate or cap + search-by-query), `AdminStatsDashboard.tsx` (one-shot aggregate or server-computed stats doc).
- Acceptance: no `onSnapshot(collection(...))` without `limit` in src (lint-able via grep in CI); admin Users tab paginates past 100; public pools stream capped.
- Deps: none.

**T10 — CI/functions-tests + authz nits**
- Objective: orphaned tests run; last weak checks closed.
- Files: `functions/package.json` (add `"test":"vitest run"`), `ci.yml` (run it), fix the 65 unused-var warnings in functions tests if they fail; `functions/src/debug.ts:16` (JWT claim check or delete endpoint); add `enforceAppCheck: true` to money/AI callables (staged: log-only first if supported).
- Acceptance: CI executes 63+ functions tests and gates on them; `inspectPoolState` rejects a caller whose Firestore role says SUPER_ADMIN but claim doesn't; App Check enforcement verified against emulator or staged rollout documented.
- Deps: none.

**T11 — Prod header reconciliation (nginx is prod)**
- Objective: prod serves CSP + consistent caching.
- Files: `nginx.conf` (add the CSP from `firebase.json:82-84`, align image cache to 7d or consciously choose 1y), CI `nginx-validate` already checks syntax.
- Acceptance: `nginx -t` passes in CI; deployed response headers show CSP (manual verify post-deploy — note in PR).
- Deps: none. Risk: overly strict CSP can break GA/ESPN/Gemini — copy the tested firebase.json policy verbatim.

**T12 — Test Suite tab (per-pool-type E2E harness)**
- Objective: one tab that provably exercises every pool type end-to-end against sim pools before season.
- Files: new `src/features/admin/test-suite/` (merges `SimulationDashboard.tsx`, `TournamentSimulator.tsx` entry, `SimpleTestingDashboard.tsx`/`TestingDashboard.tsx`), new `functions/src/testHarness.ts` (SUPER_ADMIN callable), persist runs to `testRuns` collection. Two prerequisites: (a) extract lifecycle logic from auth-bound `onCall` handlers (`poolOps.ts:40`, `bracketPools.ts:13`, `playoffPools.ts:135`, `nflPools.ts:31,126,193`, `squares.ts:11`, `propBets.ts:9`) into plain service functions consumed by both the callables and the harness — no callable-to-callable hops; (b) sim-leak containment: add `isSimulation` early-return guards to every side-effecting trigger (`statsTrigger.ts:46`, `postGameEmail.ts:35`, `billing.ts:309`, reminder/email senders) with an emulator test asserting a full sim lifecycle produces zero `mail` writes and zero stats deltas. If guard coverage proves unmaintainable, harness runs emulator-only.
- Scenarios per type (minimum): create → join ×N → submit picks/reserve squares → lock → score (scripted game results) → finalize → assert entry counts, standings vs pure-engine recomputation, payout sums, terminal status.
- `testRuns` spec: doc `{runId, poolType, scenario, startedAt, finishedAt, status:'running'|'passed'|'failed', assertions:[{name, passed, expectedSummary, actualSummary}] (≤256 chars each; full artifacts → testRuns/{runId}/artifacts subcollection with its own explicit rules block per repo convention (firestore.rules:89,95): SUPER_ADMIN read, write:false, docs ≤200KB, 90-day TTL), simPoolIds, triggeredBy}`; rules `write: if false` (harness/Admin SDK only), read SUPER_ADMIN-only; index `(poolType, startedAt desc)`; 90-day TTL on `startedAt`.
- Acceptance: running the suite for all 7 types yields a real pass/fail table persisted to `testRuns`; sim pools excluded from public queries/stats/emails (assert `isSimulation` flag filtered in `dbService` public queries + reminder/email senders); BRACKET included (removing `SimulationDashboard.tsx:32` exclusion via the new harness).
- Deps: T2 (terminal statuses), T5 (flag interplay), T7 (modal). Largest ticket — split per pool type if needed.

**T13 — Themes for all pool types (low priority)**
- Objective: theme presets per sport/pool type.
- Files: theme type (+`appliesTo: PoolType[]`), SuperAdmin themes tab, wizard theme pickers.
- Acceptance: NFL wizard offers NFL presets; existing MM themes untouched (default `appliesTo: ['BRACKET']` backfill).
- Deps: none.

**T14 — Monetization: revenue reporting**
- Objective: real PLATFORM revenue aggregates in the Monetization tab + honest Overview.
- **Premise correction (found during execution 2026-07-03, confirmed w/ Kevin):** the original spec said "rollup from `pools/*/payments` ledger" — but that path is the Entry-Fee DUES ledger (`writeLedgerEvent`, member→commissioner GMV), NOT platform income. Platform revenue is Stripe billing. And `stats/global.totalRevenue` is currently `totalAllTimePrizes` (GMV) — mislabeled (`statsTrigger.ts:151` "treat Revenue as Prizes for now"). Bundle sales (`buy_3`/`unlimited_1yr`) store their charge amount nowhere in Firestore, so summing `pools.billing.pricePaid` alone undercounts.
- **Decided design (Kevin, 2026-07-03):** (a) Record every Stripe charge to a top-level `billingCharges` collection from the webhook (pool + bundle branches, and mock paths): `{userId, kind:'pool'|'bundle', poolId?, bundleType?, tier?, amount, couponCode?, stripeSessionId, at}`; rules read SUPER_ADMIN / write:false; idempotent per `stripeSessionId`. (b) Aggregate → `stats/revenue` (`{totalRevenue, last30d, byKind, updatedAt}`) via a scheduled rollup + on-write. (c) Overview: SPLIT into two cards — "Platform Revenue" (`stats/revenue`, real Stripe income) and "Prize Volume / GMV" (`stats/global.totalPrizes`, relabeled).
- Files: `functions/src/stripe.ts` (write billingCharges on all grant paths), new `functions/src/revenueAggregates.ts` (scheduled), pure reducer + test, `firestore.rules` + `firestore.indexes.json` (billingCharges), `src/services/dbService.ts` (subscribe stats/revenue), `SuperAdminBentoDashboard.tsx` (split cards), `SuperAdminBillingPanel.tsx` (revenue section).
- Acceptance: aggregate equals sum of seeded `billingCharges` (unit test on the pure reducer); Overview shows Platform Revenue ≠ Prize Volume; bundle charges included.
- Deps: none. (Reconciles with Stripe via `amount_total`, already stored per charge.)

_Suggested order: T1 → T4 → T3 → T2 → T7 → T5 → T6 → T10 → T9 → T8 → T11 → T12 → T14 → T13._
