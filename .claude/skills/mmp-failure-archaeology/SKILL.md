---
name: mmp-failure-archaeology
description: >
  Use when investigating a bug, regression, or "why is this like this?" question in
  march-melee-pools and you need to know whether the battle was already fought: a symptom
  that looks familiar (white-screen crash, wrong scores, reverted/disappeared features,
  payment bypass, Firestore permission-denied, "undefined @undefined", pools stuck open,
  test-suite failures, region labels wrong, duplicate admin buttons), a doc that
  contradicts the code (coin flip vs deterministic tiebreaker, leaked-key claims, stale
  test counts), or a proposal that might reopen a settled decision (billing defaults,
  P2P entry fees, role renames, sim- backdoor). Also use before re-auditing anything:
  this file is the index of every major incident and investigation, each with symptom,
  root cause, evidence (commit sha / file:line), and current status. Do NOT re-litigate
  anything listed under "Settled decisions" without new evidence.
---

# MMP Failure Archaeology — the incident chronicle

Purpose: every major incident, investigation, and revert in this repo, so no session
re-fights a settled battle or trusts a doc that history already proved wrong.
Repo root: `D:\march-melee-pools`. Firebase project: `gridiron-gamble-uzuqo`.
All statuses date-stamped **as of 2026-07-06** unless noted.

Entry format: **SYMPTOM → ROOT CAUSE → EVIDENCE → STATUS**.
Statuses: `FIXED (sha)` / `OPEN` / `PARTIAL` / `WONTFIX` / `SUPERSEDED` / `DOC-WRONG`.

Jargon (once): **Pool** = one contest instance (bracket/NFL/squares/props). **Commissioner** = pool owner.
**SuperAdmin** = the 8-tab platform admin dashboard (`src/components/SuperAdmin.tsx`).
**Test Suite** = the admin tab running deterministic pool simulators against real prod Firestore.
**Callable** = Firebase Cloud Function invoked via `httpsCallable`. **Clobber** = the 2026-07-04
incident where merges silently reverted merged work (Section 4).

## When NOT to use this skill

| You want | Go to |
|---|---|
| How to classify/gate a change, the 4 discipline rules | `mmp-change-control` |
| Symptom → triage steps for a live bug | `mmp-debugging-playbook` |
| Why the architecture is shaped this way | `mmp-architecture-contract` |
| Scoring/tiebreaker math itself | `mmp-pools-domain-reference` |
| Deploy commands, Coolify, scheduled jobs | `mmp-deploy-and-operate` |
| Test commands and evidence bar | `mmp-validation-and-qa` |
| Admin dashboard contract, sim- backdoor current design | `mmp-superadmin-surface` |
| NFL first-season readiness | `mmp-nfl-season-campaign` |

---

## 0. Corrections that OVERRIDE repo docs (owner-confirmed 2026-07-06)

1. **REVERSED 2026-08-23: the Gemini API key WAS leaked.** The 2026-07-06 owner
   denial was itself the wrong claim. Measured: `git show 3340fff0^:.env | grep -c VITE_API_KEY` (count-only — never reprint the value) in the
   PUBLIC repo shows `VITE_API_KEY` (a Gemini key, per the Dockerfile:24 removal
   note), exposed since 2025-12-13. `CODE_REVIEW_REPORT.md:183`,
   `AUDIT-REPORT.md:147,278` were right all along. Rotation is Kevin's owed
   action (HANDOFF top box). Meta-lesson: this correction section spent seven
   weeks propagating a false correction — an "owner-confirmed" fact that
   contradicts a runnable command is a hypothesis until the command is run.
   Still true and separate: the plaintext Stripe **TEST** secret in `functions/.env:1-2`
   — rotation is **PENDING** (Kevin's action, `PHASE0-DEPLOY-CHECKLIST.md` Step 5).
2. **Phase 3.1 IS deployed.** PR #139 merged to main (merge `53d9872`); all 8 changed
   functions deployed (`logClientError`, `scheduledHealthCheck`, `getAdminHealthSnapshot`,
   `adminInitTournament`, `syncBracketTournament`, `onUserCreated`, `syncAllUsers`,
   `searchUsersByEmail`); tightened `firestore.rules` deployed AFTER functions;
   `searchName` backfill (Force Sync) run. (This item also claimed App Check was
   ENFORCED in the Firebase console — **that claim is superseded and UNVERIFIED as
   of 2026-07-30**; see §5.3. Everything else in this item still stands.)
   Any doc/plan describing these as "pending deploy" describes a pre-2026-07-06 state.
3. **True test counts (executed 2026-07-06 on main):** root `vitest run` = **216 passed,
   23 files**; functions suite = **96 passed, 8 files** (312 total).
   `SUPERADMIN-AUDIT-REPORT.md:38` says "203/203" — stale (written 2026-07-05). Any
   "204" figure floating in session notes is also stale. Counts drift weekly; re-run,
   never quote a doc.
4. **NFL pools have NEVER run a live season.** 2026 is the first. `scoreNFLWeek` is a
   manual per-pool/per-week callable (`functions/src/nflPools.ts:537`, exported
   `index.ts:40`); `lockNFLSpreadsJob` exists (`functions/src/nflSchedule.ts:301`) but is
   **NOT exported from `functions/src/index.ts`** → never deployed. There is no automated
   weekly NFL scoring. This is the hardest live problem — see `mmp-nfl-season-campaign`.
5. **Prod www frontend deploys via Coolify** (nginx), manual trigger by Kevin; pushing
   main does not by itself guarantee the frontend is live; `firebase.json` rewrites do
   NOT apply to www.

---

## 1. Founding-era incidents (Dec 2025 – Mar 2026)

### 1.1 App.tsx syntax death-spiral (2025-12-07)
- SYMPTOM: ~15 consecutive commits "Fix syntax error in App.tsx" / "final syntax error".
- ROOT CAUSE: hand-patching a god-file router without running the compiler between edits.
- EVIDENCE: `git log --oneline --since=2025-12-06 --until=2025-12-09 -- src/App.tsx`;
  resolved by refactor `8972a5e`. `src/App.tsx` remains the #1 churn file (208 changes).
- STATUS: FIXED (8972a5e); lesson institutionalized as "typecheck before commit".

### 1.2 Firestore undefined-field write failures (recurring, Jan 2026 onward)
- SYMPTOM: simulator/score writes throw "Cannot use undefined as a Firestore value";
  fixed at least 6 separate times (`90d1306`, `2f90eef`, `a040084`, `149211e`, `240d75e`…).
- ROOT CAUSE: optional TS fields serialized as `undefined`; Firestore rejects them.
  Each fix patched one payload instead of a shared sanitizer.
- STATUS: recurring class — assume any NEW write path can hit it. Strip/`null`-coerce
  optional fields before `set`/`update` (see PR #141 in 6.2: `.optional()` vs `.nullish()`).

### 1.3 Bracket seed/slot live-fire chain (2026-03-18/19, during the real tournament)
- SYMPTOM: wrong seeds/slots in live brackets, four fix passes in two days.
- ROOT CAUSE: seed-matching heuristics vs ESPN data shape.
- EVIDENCE: `0aca653` (replace broken seed-matching with direct team-name→slot mapping)
  → `5509818` → `264fd1a` (NCAA R1 sort order) → `2d2e9b3`.
- STATUS: FIXED; rules codified in `docs/annual-bracket-setup-runbook.md`.

### 1.4 The "midwest before west" ESPN region substring trap
- SYMPTOM: ALL Midwest games labeled "West" — two entire regions mixed up.
- ROOT CAUSE: `parseRegionAndRound` checked substring `'west'` before `'midwest'`
  ("midwest" contains "west").
- EVIDENCE: `docs/annual-bracket-setup-runbook.md:55,59,207` (postmortem); code guard
  `functions/src/espnBracket.ts:530` (`'midwest'` check with "must precede 'west'" comment).
- STATUS: FIXED in code; RE-VERIFY EVERY MARCH before import (runbook §2). If you ever
  touch `parseRegionAndRound`, this ordering is load-bearing.

### 1.5 Only two literal `Revert` commits exist in all history
- `556b807` (2026-02-10, restore temporarily-deleted skills/ dir) and `eea9501`
  (2025-12-14, cosmetic). Every other "revert" in this repo's lore was a **silent merge
  clobber** (Section 4), not a `git revert`. If features vanish, suspect merges, not reverts.

---

## 2. Security remediation era (CODE_REVIEW_REPORT.md 2026-06-11 + AUDIT-REPORT.md 2026-07-01)

Verdict trajectory: 4/10 "FRAGILE — not safe to charge customers" (2026-07-01) →
6/10 (2026-07-03) → 5/10 admin-surface-weighted (2026-07-05). The money path got fixed;
admin-surface debt concentrated.

### 2.1 Client-controlled checkout price / $0 self-activation (C1)
- SYMPTOM: any client could pass `price` to `createCheckoutSession`; `price===0` branch
  set `billing.status:'active'` with no validation.
- FIX: server-authoritative price from `settings/billing_config` + validated free reason.
- EVIDENCE: verified closed in AUDIT-REPORT-PRESEASON (`stripe.ts:85-129,598`).
- STATUS: FIXED.

### 2.2 Three payment bypasses (2026-07-01 audit)
- SYMPTOM: (a) self-granted `poolCredits`/`activeBundleType` via rules gap;
  (b) client-supplied bundle price ("pay 50¢ for a year"); (c) `createPool`/`createNFLPool`
  spread raw client payload → client sends `billing:{status:'active'}`.
- FIX: rules deny-set expansion; server bundle pricing + webhook `amount_total` check;
  `PRIVILEGED_POOL_FIELDS` allowlist strip.
- STATUS: FIXED, code-verified by the pre-season audit.

### 2.3 Any user could rig any real-money pool
- SYMPTOM: `simulateGameUpdate` checked only `request.auth` then processed attacker
  scores as ADMIN; `submitPlayoffPicks` accepted arbitrary `rankings` (`{KC:100000}`);
  `syncPlayoffPools` auth check was commented out.
- FIX: SUPER_ADMIN authz + rankings validation + auth restored.
- EVIDENCE: `scoreUpdates.ts:1287-1296`, `playoffPools.ts:483-484` (verified in
  SUPERADMIN-AUDIT-REPORT.md:81 authz sweep).
- STATUS: FIXED.

### 2.4 Stripe webhook idempotency (C3)
- FIX: `stripeWebhookEvents/{event.id}` marker in a transaction. STATUS: FIXED, verified twice.

### 2.5 Transaction-retry score corruption
- SYMPTOM: reversed home/away scores → wrong squares paid.
- ROOT CAUSE: `espnScores` object built OUTSIDE `runTransaction` with an in-place
  home/away swap; a transaction retry ran the swap twice.
- FIX: pure/cloned swap inside the transaction. STATUS: FIXED (Phase-1 execution,
  2026-07 hardening; never re-flagged).
- LESSON: anything mutated inside a Firestore transaction closure must be idempotent.

### 2.6 Unchunked 500-op batches
- SYMPTOM: scoring a pool with >500 entries throws and scores NOBODY.
- FIX: 400-op chunking. EVIDENCE: `nflPools.ts:589-602`. STATUS: FIXED.

### 2.7 13/106 tests red on main with no CI gate
- FIX: required `build-and-test` CI job. STATUS: FIXED — but note lint is still
  `continue-on-error: true` with ~600 warnings ("formalized surrender", preseason audit).

### 2.8 AdminPanel codemod-broken redirect
- SYMPTOM: saving settings navigated to homepage. ROOT CAUSE: `AdminPanel.tsx:205`
  literal `"/ pool / ${id}"` with spaces from an old codemod. STATUS: FIXED.

### 2.9 STILL-OPEN residue from this era
- **Bracket scoring triplication + client seed drift (H4):** client
  `extractSeedFromTeamId` regex returns null for display-name team IDs → client standings
  can diverge from server. Re-confirmed OPEN by SUPERADMIN-AUDIT-REPORT (2026-07-05):
  "shared/ package exists but scoring isn't in it." Highest-risk correctness bug for payouts.
- **Playoff entries 1MB doc bomb (T8):** `entries: Record<string,PlayoffEntry>` inline in
  the pool doc; ~500 entries bricks the pool. Flagged in three consecutive audits.
  Migration design settled (dedicated `pools/{id}/playoff_entries/{uid}` subcollection —
  NOT the shared `entries` collection; ownerUid-vs-userId keying conflict). NEVER BUILT. OPEN.
- **Pool doc exposes billing/entry data to guests by ID** (Medium, deferred Phase 4). OPEN.

---

## 3. The T1–T14 overhaul (AUDIT-REPORT-PRESEASON.md, 2026-07-03)

Tickets live at `AUDIT-REPORT-PRESEASON.md` from line ~296 ("Opus Execution Tickets").
Model routing precedent: T2/T8/T12 were flagged for a stronger model; the rest ran on Opus.

| Ticket | What | Status as of 2026-07-06 |
|---|---|---|
| T2 pool lifecycle | `closePool` callable + `autoClosePools` sweep; pools were stuck "open" for months because NO close sweep existed for any type and three status vocabularies coexist | `closePool` FIXED; `autoClosePools` **LIVE past dry-run** (owner-confirmed) — kill-switch `system/config.autoClose.enabled`, dry-run-default pattern in `functions/src/autoClosePools.ts:11-15,32-44`. This is the canonical prod-mutation pattern (see `mmp-change-control`) |
| T3 fake Overview cards | hardcoded "A+ (CLEAN)" scan, "42 passed / 0 failed", setTimeout theater (`SUPERADMIN-AUDIT-REPORT.md:75` has exact line cites) | Backend health card FIXED (`c7f0da2`, then persisted+scheduled `0a412f4`); fake-card deletion was clobbered then restored (`5a0dcf4`) |
| T4 GameOps NFL filter | NFL types bucketed "Other" (league undefined) | FIXED |
| T5 feature flags | flags "written by toggle UI, read by nothing" | FIXED (`poolTypeFlags` + `systemGuards.ts` + DEFAULT_FLAGS parity test); whether `assertNotMaintenance` guards EVERY state-changing callable was never fully audited — treat as PARTIAL |
| T6 5-role model | canonical SUPER_ADMIN/MODERATOR/COMMISSIONER/MEMBER/BANNED + `setUserRole` | Built (`44666d6`), FULLY CLOBBERED, restored (`a942657`,`b4a19be`,`c8d7fa8`); the **write-path sweep to canonical roles is UNMERGED** — branch `feat/superadmin-role-sweep`, single commit `217fdea` (verified still un-merged). Legacy `POOL_MANAGER`/`PARTICIPANT` still live in rules/code. OPEN |
| T7 Operations tab | consolidated destructive ops + audit + confirm modal | Built (`ed44d0d`,`6c382cf`), half-clobbered, restored (`d4cd700`); consolidation continued in Phase 2.1 (`a6ead5f`, `7ceed05`). FIXED |
| T8 playoff 1MB doc | see 2.9 | OPEN |
| T12 Test Suite harness | full per-pool-type E2E harness | NEVER BUILT; only segmentation+descriptions shipped (`0a79e4e`). OPEN |
| T14 revenue ledger | `stats/global.totalRevenue` was actually GMV (P2P prize volume), mislabeled as platform revenue | FIXED (`2865cac`: `billingCharges` from webhook + honest Overview split). Premise correction is precedent: **dues ledger ≠ platform revenue** |

---

## 4. THE CLOBBER INCIDENT (2026-07-04) — the defining process failure

- SYMPTOM: after T1–T14 was built, pushed, and merged (PRs #111–#115, 2026-07-03), the
  dashboard "looked unimproved" — nothing changed.
- ROOT CAUSE: two follow-on merges silently reverted merged work, **invisible to CI twice**:
  PR **#116** (merge `93d6056`, feat/ui-revamp — branch cut pre-overhaul; `2878ca5`
  restyled the OLD admin screens) and PR **#117** (merge `6d9fa4d`, feat/wizard-unification).
  Long-lived branches carried stale copies of files the overhaul had changed; merging
  them took the stale side.
- CASUALTY LIST (from `CLOBBER-AUDIT.md`, the authoritative Step-0 inventory): T3 fake
  cards resurrected (backend survived); T7 both halves reverted; T6 FULLY reverted;
  T14 and T5 infra survived.
- RECOVERY: 4 restore commits from git history — `a942657`, `d4cd700`, `5a0dcf4`,
  `b4a19be` — plus clobber-guard invariant tests `97e5ae8`
  (`tests/admin-surface-invariants.test.ts`: 8-tab registry, OperationsPanel rendered,
  fake-card strings absent, index.ts exports).
- FIX-OF-THE-RESTORE: `c8d7fa8` "actually land setUserRole + adminOps exports (dropped
  by bad git add)" — a `git add` aborted on an unrelated bad pathspec and silently
  dropped `adminClaims.ts` + `index.ts` from the commit; the new clobber-guard CI test
  caught it. Lesson: verify `git show --stat` matches intent after every commit.
- SECONDARY NOTE: the initial restore plan's baseline was WRONG (assumed setUserRole
  survived); the adversarial review (Codex round 1) caught it. **Restore from git
  history verbatim, diff against the historical commit; audit before planning.**
- PROCESS RULES BORN HERE (canonical text in `mmp-change-control`): long-lived branches
  must merge latest main and re-verify admin surfaces before PR; invariant regression
  tests in required CI; worktree isolation for parallel work.
- STATUS: FIXED + guarded. Related same-week fallout: `#118`/`2054b6e`
  (`admin.firestore.{Timestamp,FieldValue}` namespace sweep — functions were stale),
  **#119** (merge `77b51ae`, fix `7f7d195`): SUPER_ADMIN custom claim wasn't synced to
  the auth token, so admin-only reads (audit log) were permission-denied — fixed with
  `useEnsureAdminClaims` hook; `9bcf533` `onUserCreated` "threw on every invocation";
  `a6c3ba5` CI must generate `functions/src/shared/` before typecheck.

---

## 5. SuperAdmin control era (walkthrough 2026-07-05 → PLAN-SUPERADMIN-CONTROL.md → PR #139)

Source: `SUPERADMIN-AUDIT-REPORT.md` (live prod walkthrough). All Phase 0–3 fixes below
merged in PR #139 (`53d9872`) and **deployed** (Section 0.2).

### 5.1 App-wide crash from one admin button (live-reproduced)
- SYMPTOM: clicking "Open Simulation Dashboard" → white screen for the WHOLE app.
- ROOT CAUSE: `SimulationDashboard.tsx` called `.squares.filter()` on every non-BRACKET
  pool (PROPS/PICKEM/SURVIVOR/PLAYOFF have no `squares`) → `TypeError` caught only by the
  single global ErrorBoundary (`main.tsx:13`). Generalized root cause: "everything
  non-BRACKET is assumed to be a squares GameState" — same family as the
  "undefined @undefined" matchup labels in the Pools tab.
- EVIDENCE: `SUPERADMIN-AUDIT-REPORT.md:45,91`; fix visible at
  `src/components/SimulationDashboard.tsx:24-28,159,260` (SQUARES-only filter + `?? []`).
- STATUS: FIXED (`42c7c57`, Phase 0), deployed.

### 5.2 `sim-` Firestore rules backdoor
- SYMPTOM/RISK: ANY authenticated user could client-create `pools/{id}` docs (and entries)
  by prefixing the slug `sim-` — arbitrary `ownerId`/`billing` = billing bypass + injection.
- ROOT CAUSE: a test affordance living in production rules (old `firestore.rules:87,:194`).
- SEQUENCING TRAP (do not re-discover): naively deleting the `sim-`/`isSuperAdmin()`
  client-write branches **breaks the Test Suite** — the simulators depend on the generic
  `isSuperAdmin()` write branches for direct entry/tournament writes. The `sim-` CREATE
  branch itself is used only by TournamentSimulator (`TournamentSimulator.tsx:163-164`);
  all five scenario simulators create pools via the real `createPool` callable — see
  mmp-superadmin-surface §7.
- FIX CHOSEN: Phase 0 tightened to `isSuperAdmin()` (current `firestore.rules:93,:204`,
  with TODO comment); Phase 2 = full simulator server API, then delete the branch.
- STATUS UPDATE 2026-07-12: no longer PARTIAL — firestore.rules:125 now reads "NO
  CREATE via Client (must use createPool function). The former sim-*..." — the
  create-path exception is fully removed, not just SUPER_ADMIN-gated. Per
  nfl-sim-harness-status memory, prod smoke (45/45 NFL + all legacy sims) passed
  post-deploy, implying TournamentSimulator's callable-based replacement (see
  mmp-superadmin-surface §7 for the "Phase 2" plan) is working — but re-verify
  TournamentSimulator's Setup phase directly before relying on this if you touch
  that component; this correction is transitively sourced, not independently
  confirmed against the simulator UI itself.

### 5.3 Client crash telemetry near-miss + App Check whiplash
- SYMPTOM: hardening `system_logs` to functions-only would have silently destroyed the
  `[ErrorHandler] CRITICAL` crash telemetry (client wrote directly to `system_logs`;
  now funneled through the callable at `src/services/errorHandler.ts:95-97`).
- FIX: `logClientError` callable (schema-whitelisted, size-capped, server-stamped,
  deliberately NOT auth-gated — auth-gating would erase anonymous crash telemetry).
  Deploy-order rule born here: **functions BEFORE rules** or telemetry silently drops.
- FOLLOW-UP INCIDENT (post-#139): `enforceAppCheck:true` rejected client errors before
  App Check was fully live → `beac092` / PR #142 set `enforceAppCheck:false` with a
  re-enable TODO (`functions/src/logClientError.ts:33-35`).
- **SECOND FOLLOW-UP INCIDENT, 2026-07-30 — App Check took the whole site down.**
  The "re-enable it, App Check is enforced now" thread above was acting on an
  attestation that was never true. Someone set `VITE_RECAPTCHA_SITE_KEY` in the
  Coolify environment to turn App Check on; the rebuild shipped a bundle that
  rendered **nothing** — permanent spinner, confirmed from two independent
  machines and networks — until the variable was deleted and the site redeployed.
  PROPOSED MECHANISM (**HYPOTHESIS — holed, see below**): the key flips
  `src/firebase.ts:25` to the initialize branch; `ReCaptchaEnterpriseProvider`
  loads `https://www.google.com/recaptcha/enterprise.js`; `nginx.conf`'s
  `script-src` lists no Google reCAPTCHA host so the browser refuses it; the App
  Check token never resolves; the Firestore SDK blocks its first request on that
  token and goes offline after ~10s.
  ⚠️ **ROOT CAUSE IS OPEN.** codex, reviewing the write-up of this very incident
  within the hour, pointed out that `Dockerfile:15-27` declares `ARG`/`ENV` for
  six variables and none is `VITE_RECAPTCHA_SITE_KEY`, `.dockerignore` excludes
  `.env`, and Vite bakes values in at `npm run build:static` (`Dockerfile:30`).
  If Coolify builds the tracked Dockerfile, that key never reached the bundle and
  the branch never flipped. Candidates, none checked: Coolify does not build the
  tracked Dockerfile; an `ARG` was added and reverted out-of-band; or the variable
  was coincidental and something else in those two rebuilds killed the site.
  **LESSON 1 — the reusable one.** The change looked safe because every callable
  runs App Check in `monitor` mode: a TRUE fact from which a FALSE conclusion was
  drawn. Server-side leniency cannot rescue a client that fails before it issues
  a request. Ask which SIDE of the wire a permissive setting lives on before
  treating it as a safety net. Same shape as the #320 Sentry CSP gap and, before
  that, the functions-before-rules rule above: a transport-layer denial no
  application-layer allowance can see.
  **LESSON 2 — the one this file exists for.** The first write-up of THIS entry
  stated the mechanism as fact and shipped it to eight documents in one pass. It
  was a plausible story that fit the symptom, reached for instead of checking the
  build path — the same failure as the retracted backslash-URL finding (HANDOFF
  item 10). Correlation was strong (set → dead, delete → alive) and correlation
  was the only thing actually established. **When recording an incident, mark the
  observation and the mechanism separately.** The instruction "do not set this"
  survives being wrong about why; a mechanism asserted as fact does not.
  ⛔ Do not re-enable. Four faults remain (CSP hosts, Enterprise-vs-v3 key, app
  never registered, no Dockerfile `ARG`) — HANDOFF's STOP POINT box.

### 5.4 CLOSED lifecycle state invisible
- ROOT CAUSE: `getPoolLifecycleState` (`src/utils/poolSport.ts`) collapsed
  COMPLETED/closedVia into `final`, so `closePool` results were undetectable in the UI.
- STATUS: FIXED (`1b2fc55`, derived `closed` state + filter chip), deployed.

### 5.5 Health snapshot theater → real + persistent
- Fake API Status Center etc. (see T3). Real snapshot made persistent + scheduled
  hourly: FIXED (`0a412f4`; `functions/src/adminHealth.ts`, single `health/latest` doc —
  "capped collection" wording was rejected: not a Firestore primitive).

### 5.6 Unaudited PII export / dup destructive ops / entryCount race / dead search
- Export Emails (CSV of all users + guest emails, no confirm/audit): moved to Members
  with IA consolidation — FIXED (`7ceed05`).
- Duplicated destructive ops with different guard strengths (Big12/BigEast init in THREE
  places): Operations made sole home — FIXED core (`a6ead5f`, `7ceed05`); rule:
  **do not delete a legacy button until its verified Operations equivalent exists.**
- entryCount race (stale client math vs transactional `FieldValue.increment`): entry
  delete routed through atomic callable — PARTIAL (`719f141`); other direct client
  writes (pool-settings save, paid-status toggle) still bypass callables. OPEN remainder.
- Member search returned nothing for names: `searchName` field + `onUserCreated`/
  `syncAllUsers` backfill + name-or-email search — FIXED (`802c8d6`), deployed,
  backfill run (owner-confirmed).

### 5.7 fixPoolScores didn't pay "Every Score Pays" winners
- ROOT CAUSE: hand-rolled backfill duplicated (badly) what `processGameUpdate` already did.
- FIX: replaced with a `processGameUpdate` call — verified applied:
  `functions/src/scoreUpdates.ts:1429` comment "Use processGameUpdate - the SAME function
  syncGameStatus uses". `FIX_INSTRUCTIONS.md` is the historical instruction doc.
- STATUS: FIXED. Pattern: never re-implement an engine for a backfill; call the engine.

---

## 6. Post-#139 fresh incidents (2026-07-06/07) — newest layer

### 6.1 Live Test Suite run: 2 pass / 8 fail / 5 error
- Source of record: `TEST-SUITE-BACKLOG.md` (parked-bugs doc, commit `b748849`).
  None caused by the Phase-0 deploy (proven: the full E2E bracket sim passes under the
  same deployed rules).

### 6.2 Pool-create schema drift (PR #141, `11dbe37`) — FIXED, deployed with #141 merge
- SYMPTOM: 5 Test Suite scenarios failed on valid create payloads.
- ROOT CAUSE: shared zod schemas drifted from engine reality — `squares.ts` gameId
  `.optional()` rejected an explicit `null` (needs `.nullish()`); `bracket.ts`
  scoringSystem enum was missing ESPN/FIBONACCI even though the engine implements both
  (`functions/src/bracketScoring.ts:71-72`).
- GUARD: `tests/pool-schema-drift.test.ts` added. Lesson: schema enums must be
  derived-from or parity-tested against the engine, never hand-copied.

### 6.3 Parked and OPEN (do not treat as new discoveries)
1. **bracketSimulator writes 0 entries** (6 scenarios fail): entry `addDoc` silently
   swallowed by try/catch (`src/utils/testing/simulators/bracketSimulator.ts:166-190`).
   NOT the firestore rule (E2E sim proves admin entry writes work). Next step: surface
   the swallowed `errMsg`. OPEN.
2. **Props Basic off-by-one** ("should be 5, got 6"). OPEN.
3. **Playoff Basic wrong winner** ("Alice should win, got Carol"). OPEN.
4. **UPSET scoring offered but unimplemented**: wizard offers it
   (`src/components/wizard/create/CreateBracketPool.tsx:32`) but `bracketScoring.ts` has
   no UPSET branch → silently scores as CLASSIC. Product decision needed. OPEN.
5. No NFL Pick'em/Survivor/Margin Test Suite scenarios exist at all. OPEN
   (feeds `mmp-nfl-season-campaign`).

---

## 7. Wizard-unification premise corrections (context for ADR-0001)

- The original plan targeted a "direct client write" hole that **no longer existed**
  (all wizards already called Cloud Functions). Caught in adversarial review round 1;
  plan rebased around consolidating three divergent create callables
  (`docs/adr/0001-unified-createpool-callable.md`).
- Mid-execution correction: stamping `billing.status:'trial'` would have switched on the
  dormant grace→lock funnel for every pool and emailed commissioners → `free` stamped
  instead (see Settled decisions).
- CURRENT STATE as of 2026-07-06: PR #117 (merge `6d9fa4d`, cutover `8291a0d`) landed
  BOTH the client cutover (7 create flows share WizardShell, 4 old wizards deleted) AND
  the server shared core (`functions/src/lib/poolCreation.ts`, shared zod schemas,
  `updatePoolSettings`, Playwright e2e). The `D:\mmp-wizard` worktree was removed after
  the merge — nothing lost. The ADR's final step (single unified `createPool` envelope,
  generic `publishPool`, thin delegates) was never implemented anywhere. On main,
  `createBracketPool`/`createNFLPool` are still full implementations with
  `validateCreateInput` bolted on (`functions/src/bracketPools.ts` imports at `:7-12`,
  `functions/src/nflPools.ts:40`). Do NOT assume ADR-0001 "Accepted" means "live".

---

## 8. Doc-error registry (docs history proved wrong — trust code)

| Doc claim | Reality | Evidence |
|---|---|---|
| `docs/NFL_POOLS_README.md:78` — Margin tiebreaker level 5 is "Coin Flip (Random)" | Deterministic `ownerUid.localeCompare` | `functions/src/nflScoringEngine.ts:277-302` (`sortMarginLeaderboard`); `README.md` line ~32 ("Deterministic ID comparison") is the correct one |
| Gemini key "previously committed / rotate immediately" (`CODE_REVIEW_REPORT.md:183`, `AUDIT-REPORT.md:147,278`) | TRUE — confirmed 2026-08-23 via `git show 3340fff0^:.env | grep -c VITE_API_KEY` (count-only — never reprint the value) (public repo); the 2026-07-06 owner denial was the error | Section 0.1 |
| `docs/bracket-pool-architecture.md` edge case #4 — seed parsing of prefixed IDs (`E1-Duke`) via regex | Team IDs are full ESPN display names ("Duke Blue Devils"); the old regex does not work | `docs/annual-bracket-setup-runbook.md` Rule 4 + 2026 postmortem; this stale doc section is the ROOT of live bug H4 (client seed drift, 2.9) |
| `SUPERADMIN-AUDIT-REPORT.md:38` — "root tests 203/203" | 216/216 as of 2026-07-06 | executed `vitest run` (Section 0.3) |
| ADR-0001:18 / `PHASE-A-INVENTORY.md:108` say the POOL_CREATED activity event "has no writer at all" | Stale (pre-merge). The writer IS on main: `functions/src/lib/poolCreation.ts:110-112`, called by all three create callables — `CONTEXT.md:25` is now correct; do not add a duplicate writer | `grep -rn "POOL_CREATED" functions/src/lib/poolCreation.ts` |
| `README.md:112-122` pricing table implies trial/tier enforcement ("14-day free trial") | No create path stamps billing; missing billing = free; 10-participant cap enforced at join time | `PHASE-A-INVENTORY.md:72-88` |
| ADR-0001 says billing config "migrates to `settings/billing_config`" | `enforceBillingStatus` reads `config/billing_config` per inventory `:130`; two authorities coexist | Re-verify whichever you touch |
| Any doc saying Phase 3.1 / #139 functions are "pending deploy" | Deployed (Section 0.2) | `PHASE0-DEPLOY-CHECKLIST.md` DONE section |

---

## 9. Settled decisions — DO NOT REOPEN without new evidence

1. **Billing is free-by-default, no auto-lock.** RESOLVED 2026-07-03,
   `docs/wizard-unification/PHASE-A-INVENTORY.md:87-88` ("stamp `free`, no auto-lock —
   preserve today's behavior exactly"). Stamping `trial` activates a dormant grace→lock
   funnel + emails commissioners. Never "just enable" billing enforcement.
2. **Entry fees are P2P; the platform NEVER touches participant money.** Stripe is for
   commissioner hosting fees ONLY (`CONTEXT.md:48-57`). Never propose platform-processed
   entry fees or escrow.
3. **No partial role rename.** Rejected repeatedly across review rounds: partial
   normalization makes canonical queries silently miss legacy docs. The rename happens
   as one deliberate migration (grep-gate → deploy → backfill → verify);
   `feat/superadmin-role-sweep` (`217fdea`) is the pending vehicle.
4. **No client-side privileged writes, no carve-outs.** A "non-destructive low-risk
   client writes may stay temporarily" exception was proposed and DELETED in review
   ("reopens the audit hole").
5. **Delete fake dashboard cards rather than build fake-real equivalents** where no
   backend exists — "honesty over feature count"; data unavailable → card says
   "unavailable", never a plausible substitute.
6. **Playoff-entry migration target is a dedicated `playoff_entries` subcollection**,
   not the shared `entries` collection (ownerUid-vs-userId keying conflict).
7. **`logClientError` stays un-auth-gated** (anonymous crash telemetry) and
   schema-whitelisted (a free-form sink just moves the hole).
8. **DEFAULT_FLAGS is intentionally duplicated** (client + functions are incompatible TS
   roots) with a CI parity test; a shared module was tried and rejected. Same for
   npm workspaces ("Windows + Firebase deploy friction — boring over clever").
9. **Health history lives in one bounded `health/latest` doc**, not a "capped
   collection" (not a Firestore primitive) and not a TTL collection.
10. **Operations tab is the sole home for destructive actions**; everything else mirrors
    read-only; replacement-before-deletion for legacy buttons.
11. **Big-bang wizard client cutover** (locked by Kevin) — staged per-pool-type rollout
    was rejected; already shipped (`8291a0d`).
12. **`sim-` rule end-state is deletion via a server simulator API**, with the interim
    `isSuperAdmin()` tightening — not a naive rule delete (breaks the Test Suite) and
    not permanent retention.

---

## 10. Open-items ledger (as of 2026-07-06, ranked by risk)

1. `sim-` backdoor — CLOSED 2026-07-12 (was OPEN): rules-level create exception fully
   removed, see §5.2 STATUS UPDATE above. Re-rank remaining items accordingly.
2. Canonical role write-path sweep + backfill — OPEN, unmerged branch `217fdea` (re-verify still unmerged).
3. T8 playoff 1MB doc migration — OPEN, three audits old (re-verify still open).
4. H4 bracket scoring triplication / client seed drift — OPEN, payout-correctness risk (re-verify still open).
5. NFL first live season: STILL no automated weekly scoring, `lockNFLSpreadsJob` still
   unexported (re-verified 2026-07-12) — OPEN. A new backstop finalize sweep
   (`nflFinalizeSweepJob`) exists but does not score weeks or lock spreads — does not
   close this item.
6. Stripe TEST secret rotation (`functions/.env:1-2`) — PENDING (Kevin) (re-verify still pending).
7. ~~Re-enable `enforceAppCheck` on `logClientError`~~ — **WITHDRAWN 2026-07-30. Do
   not do this.** Its premise ("App Check is enforced") was never true: 98
   `validated()` callables are `monitor` with zero `enforce`, plus 26 bare
   `onCall` sites carrying no App Check option at all. Acting on that premise
   from the client side coincided with prod going down; see §5.3's second
   follow-up incident.
8. Test Suite parked bugs (bracketSimulator 0-entries, props +1, playoff winner, UPSET) — OPEN.
9. Coolify env misconfig (`VITE_FIREBASE_STORAGE_BUCKET`/`AUTH_DOMAIN` malformed) — OPEN
   (checklist Step 6; harmless until Storage is used).
10. Remaining direct client privileged writes (pool-settings save, paid toggle) — OPEN.
11. T12 full test harness; zero tests on admin callables/SuperAdmin components — OPEN.

---

## Provenance and maintenance

Written 2026-07-06 against main @ `a0ff311` (post-#139/#141/#142/#138). Every sha above
was verified with `git show --stat`; file:line cites were read from the working tree.
Re-verify before relying on drift-prone facts:

| Fact class | Re-verification command (PowerShell, repo root) |
|---|---|
| Any commit sha cited here | `git show --stat --format='%h %ad %s' <sha>` |
| True test counts | `npx vitest run` and `npm --prefix functions run test` (never quote a doc) |
| `sim-` rule current state | `Select-String -Path firestore.rules -Pattern 'sim-' -Context 2` |
| Margin tiebreaker still deterministic | `Select-String -Path functions\src\nflScoringEngine.ts -Pattern 'localeCompare'` |
| midwest-before-west guard intact | `Select-String -Path functions\src\espnBracket.ts -Pattern 'midwest'` |
| `lockNFLSpreadsJob` still unexported | `Select-String -Path functions\src\index.ts -Pattern 'lockNFLSpreadsJob'` (no hit = still unexported) |
| autoClosePools kill-switch/dry-run config | `Select-String -Path functions\src\autoClosePools.ts -Pattern 'enabled|dryRun'` and Firestore doc `system/config` field `autoClose` |
| logClientError App Check enforcement | `Select-String -Path functions\src\logClientError.ts -Pattern 'enforceAppCheck'` |
| Role sweep still unmerged | `git branch --contains 217fdea` (only `feat/superadmin-role-sweep` = still pending) |
| Open Test Suite bugs | read `TEST-SUITE-BACKLOG.md` |
| Deploy state of record | read `PHASE0-DEPLOY-CHECKLIST.md` (DONE vs REMAINING sections) |
| Clobber casualty inventory | read `CLOBBER-AUDIT.md` (authoritative over any plan's assumed baseline) |

If a status here contradicts fresh evidence, the evidence wins — update this file in the
same change, per `mmp-docs-and-writing` conventions.
