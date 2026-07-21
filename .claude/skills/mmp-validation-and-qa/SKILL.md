---
name: mmp-validation-and-qa
description: >
  Use when you need to test, verify, or claim completion of anything in the
  march-melee-pools repo (D:\march-melee-pools): running the vitest suites,
  finding out how many tests exist and what they cover, adding a new test file,
  running Playwright e2e or the Firestore rules tests, interpreting "all tests
  pass" claims in docs, understanding the clobber-guard invariant tests, or
  deciding what evidence is required before saying a change is done. Symptoms
  that should load this: "run the tests", "how do I test this", "npm test",
  "vitest is not recognized", "add a test for X", "are the tests green",
  "what does CI run", "verify before done", "test count", "e2e", "playwright",
  "emulator tests", "rules test", "coverage", "acceptance criteria",
  "maxPossibleScore invariant", "admin-surface-invariants".
---

# mmp-validation-and-qa — what counts as evidence in this repo

Repo: `D:\march-melee-pools` (March Melee Pools / Gridiron Gamble). React 19 + Vite 7 frontend, Firebase Cloud Functions v2 backend, Firebase project `gridiron-gamble-uzuqo`. All commands are PowerShell-compatible, run from repo root `D:\march-melee-pools` unless stated.

All counts, commands, and file references below were verified by actually running/reading them on **2026-07-06** (branch `fix/superadmin-phase0-control` lineage). Test counts drift — re-verify before repeating them (see Provenance section).

## When NOT to use this skill

| You actually want | Go to |
|---|---|
| Change classification, PLAN/review-log/sweep gates, the 4 discipline rules | `mmp-change-control` |
| Setting up the dev env, npm install order, emulator/Java setup, TS2307 fixes | `mmp-build-and-env` |
| Deploying functions/rules/hosting, Coolify www, scheduled jobs | `mmp-deploy-and-operate` |
| Health checks, admin Test Suite interpretation, audit logs, ops scripts | `mmp-diagnostics-and-tooling` |
| Why a specific pool score/tiebreaker is what it is (domain math) | `mmp-pools-domain-reference` |
| Debugging a failure, not verifying a change | `mmp-debugging-playbook` |
| PLAN/AUDIT/review-log document templates and house style | `mmp-docs-and-writing` |

---

## 1. The evidence bar (house rule — non-negotiable)

**Never self-certify.** Before claiming any task complete, state the evidence: the exact command run + its output, or the file/value checked. No "done" without proof. If you could not verify, say so plainly instead of asserting success.

Concretely, in this repo:

1. **"Tests pass" must include the real count**, dated. Not "all green" — say "216/216 root + 96/96 functions, run 2026-07-06". Count it yourself (Section 2); do not copy a number from a doc.
2. **Doc numbers are historical, not current.** `AUDIT-REPORT-PRESEASON.md:43,106` says "114/114 tests pass" — that was true at audit time; the root suite alone is 216 as of 2026-07-06. `README.md` claims the synthetic scenarios stress "1,000+ combinations" — the file (`tests/synthetic-scenarios.test.ts`) is 26 test cases using randomized picks over a 63-game mock tournament; there is no 1,000-iteration loop. A "204/204" figure was referenced in planning conversations but does **not** appear in any repo `*.md` as of 2026-07-06 (verified by grep). Treat every such figure as stale until re-run.
3. **A passing suite is not evidence for untested surface.** Large areas have zero automated coverage (Section 8). "Tests pass" says nothing about SuperAdmin UI behavior, NFL scoring triggers, or email sends.
4. **UI claims need render evidence** (preview screenshot or accessibility snapshot), **prod-data claims need dry-run output** (see Section 9 and `mmp-change-control`).

---

## 2. Authoritative test counts (as of 2026-07-06)

**STATUS UPDATE 2026-07-12 — these counts are stale and the repo's own docs now
disagree with each other:** `mmp-qodo-cycle` (verified 2026-07-11) states baselines
of 244 root / 410 functions / 83 emulator + six named rules suites — much higher
than the 216/96 below, consistent with the harness + security-retrofit work adding
tests since 2026-07-06. `HANDOFF.md` itself is internally inconsistent (one section
says "root vitest 244, functions unit 545"; another says "functions test: 410
tests"). **Do not copy any of these numbers.** Per this section's own rule #1
below — count it yourself, right now, with the commands in the recount block —
before stating a test count to Kevin or in a plan.

Counted by running the suites, not by grepping docs (numbers below are the
2026-07-06 baseline being superseded — kept for trend context only):

| Suite | Files | Tests | In CI gate? |
|---|---|---|---|
| Root vitest (`npm test`) | 23 | **216** | YES (required) |
| Functions mocked vitest (`npm --prefix functions test`) | 8 | **96** | YES (required) |
| Functions emulator vitest (`test:emulator`) | 1 | 4 | NO |
| Firestore rules tests (`functions/scripts/*.rules.test.mjs`) | 1 (+1 pure-node) | script-style asserts | NO |
| Playwright e2e (`tests/e2e/`) | 2 specs | 8 | NO |
| In-app admin Test Suite (manual, prod data) | 15 scenario JSONs | assertion-based | NO (human-driven) |

**Default CI-gated total: 312 (216 + 96).** Re-count with:

```powershell
npm test                       # root — expect "Tests  N passed (N)"
npm --prefix functions test    # functions — same
```

If either prints `'vitest' is not recognized`, the local `node_modules` install is incomplete (missing `node_modules\.bin`). Fix with `npm ci` (does not touch `package-lock.json`), or bypass with:

```powershell
node node_modules/vitest/vitest.mjs run                                        # root
cd functions; node scripts/copy-shared.mjs; node ../node_modules/vitest/vitest.mjs run   # functions
```

(Functions has no vitest devDependency; `npm run` resolves vitest from the root install via ancestor `node_modules\.bin` on PATH.)

---

## 3. Test inventory — what lives where

Framework is **Vitest 4** everywhere (root `package.json` devDep `vitest ^4.1.9`; no Jest — the `@jest/types` in `functions/package.json` is a stray devDep). Playwright `@playwright/test ^1.61.1` for e2e.

### 3a. Root suite — 23 files, 216 tests

Command: `npm test` (= `vitest run`; config is the `test` block in `vite.config.ts:46-52`, which excludes `functions/`, `shared/`, `tests/e2e/`, `.claude/`). Three groups of files:

1. **`tests/*.test.ts` (17 files)** — pure-logic tests of scoring engines and flows: `synthetic-scenarios` (26 cases, the invariant stress tests), `admin-surface-invariants` (the clobber guard, Section 6), `onboarding-flow`, `nfl-scoring`, `bracketScoring`, `feature-flags-parity`, `replay-2025` (real 2025 tournament replay), `pool-schema-drift`, `pool-sport`, `bigeast-conference`, `auto-release`, `join-preview`, `roles-parity`, `nfl-integration`, `admin-tournament`, `lock-unpaid`, `theme-scope`. Cloud Functions modules are importable here because `vite.config.ts:17-24` aliases `firebase-admin`/`firebase-functions`/`stripe` to hand-written mocks in `tests/mocks/`.
2. **`src/__tests__/billingGate.test.tsx` (1 file, 15 tests)** — the only component test. Note: its header comment says "@testing-library/react" but the file actually uses `renderToStaticMarkup` from `react-dom/server` (no jsdom, no testing-library installed) — the comment is stale.
3. **`src/components/wizard/create/build*Payload.test.ts` (5 files)** — colocated payload-builder tests for the 5 WizardShell create flows (Bracket, NFL, Playoff, Props, Squares).

### 3b. Functions mocked suite — 8 files, 96 tests

Command: `npm --prefix functions test` (= `node scripts/copy-shared.mjs && vitest run`; config `functions/vitest.config.ts` includes `src/**/*.test.ts`, excludes `*.emulator.test.ts`). Files in `functions/src/__tests__/`: `billing` (22), `coupon` (22), `referral` (19), `poolUpdate` (9), `poolCreation` (8), `lifecycle` (8), `adminAudit` (5), `billingCharges` (3). All Firestore/Admin interactions are hand-rolled test doubles — no emulator needed. The `copy-shared.mjs` step mirrors repo-root `shared/` into `functions/src/shared/` (gitignored); skipping it causes TS2307 on `./shared/*` imports.

### 3c. Functions emulator suite — 1 file, 4 tests

Command: `npm --prefix functions run test:emulator` (= `firebase emulators:exec --only firestore --project demo-mmp "vitest run --config vitest.emulator.config.ts"`). File: `functions/src/__tests__/emulator/poolCreation.emulator.test.ts`, with `admin.initializeApp` in `emulator/setup.ts`. **Requires Java** (Firestore emulator is a JVM process — see `mmp-build-and-env`). UNVERIFIED on 2026-07-06: not run in this session (Java availability not checked); pass state and duration unconfirmed.

### 3d. Firestore rules tests — script-style, not in any vitest config

- `functions/scripts/squarePrivate.rules.test.mjs` — verifies the `squarePrivate` PII subcollection rules (non-owner cannot read, owner can, no client writes, guests can still `get` the pool doc). Run per its own header:

  ```powershell
  npm i -D @firebase/rules-unit-testing
  npx firebase emulators:exec --only firestore "node functions/scripts/squarePrivate.rules.test.mjs"
  ```

  `@firebase/rules-unit-testing` is NOT in `package.json` — you must install it ad hoc (or accept the lockfile churn consciously). Requires Java. UNVERIFIED pass state as of 2026-07-06 (dependency not installed in this checkout).
- `functions/scripts/backfillSquarePrivate.test.mjs` — pure-node self-check of the H1 PII-backfill logic, no emulator. Run: `node functions/scripts/backfillSquarePrivate.test.mjs`. Verified passing 2026-07-06 ("OK — all backfill logic checks passed.", exit 0, <1s).

### 3e. Playwright e2e — 2 specs, 8 tests (this repo)

See Section 7.

---

## 4. How to run each suite: duration + pass signature

| Suite | Command | Wall time (2026-07-06 run) | Pass looks like |
|---|---|---|---|
| Root | `npm test` | ~15–20s (vitest-reported "Duration 1.51s" excludes ~16s transform+import) | `Test Files  23 passed (23)` / `Tests  216 passed (216)` |
| Functions | `npm --prefix functions test` | ~3–5s (reported 828ms) | `Test Files  8 passed (8)` / `Tests  96 passed (96)` |
| Functions emulator | `npm --prefix functions run test:emulator` | UNVERIFIED (emulator boot dominates; expect 1–3 min) | vitest summary `4 passed` inside `emulators:exec` output |
| Rules | `npx firebase emulators:exec --only firestore "node functions/scripts/squarePrivate.rules.test.mjs"` | UNVERIFIED | script exits 0, assert failures throw |
| Backfill self-check | `node functions/scripts/backfillSquarePrivate.test.mjs` | <1s | `OK — all backfill logic checks passed.` |
| Playwright | `npx playwright test` | UNVERIFIED this session (budget: 120s timeout PER test; expect several minutes incl. emulator boot) | `8 passed` from the list reporter |
| Typecheck (frontend) | `npx tsc -b` (or full `npm run build`) | ~30–60s | silent exit 0 |
| Typecheck (functions) | `npm --prefix functions run typecheck` | ~20–40s | silent exit 0 after `[copy-shared]` line |

**Watch mode:** `npx vitest` (no `run`) — vitest's default is watch. No dedicated npm script exists.

**Coverage:** NOT configured. No `--coverage` provider (`@vitest/coverage-v8` is not a dependency) and no coverage config block. Do not claim coverage percentages; there is no tooling to produce them.

**What CI runs** (`.github/workflows/ci.yml`, every PR + push to main): required job = `npm ci` (root + functions) → `npm run build:static` (tsc -b + vite build + prerender) → functions `npm run typecheck` → root `npm test` → functions `npm test`; plus a required `nginx -t` docker validation of `nginx.conf`. Lint is advisory (`continue-on-error: true`, ~540-finding backlog). **NOT in CI:** emulator suite, rules tests, Playwright, any UI verification. The only git hook is pre-commit secret scanning (`.husky/pre-commit` → `python scripts/scan_secrets.py`) — no local test gate.

---

## 5. Golden/certified inventory — the invariants that matter

There are **no snapshot tests** (`toMatchSnapshot` / `__snapshots__`: zero hits in `tests/`, `src/`, `functions/src/` as of 2026-07-06) and no golden files. The "certified" layer is invariant assertions:

1. **`maxPossibleScore >= score`** — `tests/synthetic-scenarios.test.ts:73` asserts it directly on randomized picks; line 303 asserts strict `>` for a partially-decided bracket; line 257 asserts eliminated entries reach `maxPossibleScore === 0`. This is the core bracket-integrity invariant: a leaderboard showing an entry with max-possible below current score means the scoring engine is broken.
2. **Cross-engine agreement** — `synthetic-scenarios.test.ts:306-329`: the dashboard engine (`src/components/BracketPoolDashboard/bracketScoring.ts` `calculateScore`) and the utils engine (`src/utils/bracketScoring.ts` `calculateEntryMaxScore`) must produce the same max-possible number. Two implementations exist; this test is what keeps them honest.
3. **Real-tournament replay** — `tests/replay-2025.test.ts` replays realistic 2025 bracket data through the engine.
4. **Schema/engine contract drift** — `tests/pool-schema-drift.test.ts`: the shared zod schemas (`shared/schemas/*`) must accept every value the engines implement (regression guards from live Test Suite failures: ESPN/FIBONACCI scoring systems, `gameId: null`).
5. **Perfect/worst brackets** — CLASSIC perfect bracket scores exactly 1920 / 63 correct; all-wrong scores 0 (`synthetic-scenarios.test.ts:20-43`).

When touching any scoring engine, these are the tests that must stay green, and new edge cases should be added HERE, not in new ad-hoc files.

---

## 6. Clobber-guard invariants — `tests/admin-surface-invariants.test.ts`

**Why it exists:** the T3/T6/T7 super-admin overhaul was **silently reverted twice** by merges from branches cut before it landed (PRs #116 ui-revamp, #117 wizard) — invisible to CI because nothing asserted the admin surface's shape. This is the clobber incident behind discipline rule (d) worktree isolation — full story in `mmp-change-control` and `mmp-failure-archaeology`. Commit `97e5ae8` added source-level assertions that fail loudly if the restoration regresses again.

**What it protects** (deliberately coarse — wiring, not behavior; it reads source files as strings):
- No fake/placeholder dashboard cards in `SuperAdminBentoDashboard.tsx` (the "42 passed" / "A+ (CLEAN)" theater strings must stay gone).
- `OperationsPanel` imported, rendered, and nav-registered in `SuperAdmin.tsx`.
- Role selector present, backed by `dbService.setUserRole`; role writers are canonical (MEMBER/COMMISSIONER, not PARTICIPANT/POOL_MANAGER).
- `functions/src/index.ts` exports the restored callables (`setUserRole`, `logAdminAction`, `getAdminHealthSnapshot`, `autoClosePools`, etc.).
- `autoClosePools` keeps its kill-switch + dry-run-default shape (`cfg?.enabled === true`).
- Destructive admin actions write audit trails; money-adjacent admin writes go through audited callables (no direct client `coupons`/`billing_config` writes).
- Exactly the eight canonical Super-Admin tabs, and no orphaned `activeTab` render block.

**Implication for you:** if this file fails after your change, you have probably clobbered restored admin functionality — do NOT "fix the test" by weakening an assertion; investigate the merge/rebase that removed the code. If you intentionally restructure the admin surface, update the assertions in the same PR with a review-log entry (see `mmp-change-control`).

---

## 7. E2E: this repo vs the mmp-wizard worktree

### In THIS repo (`tests/e2e/`, run with `npx playwright test`)

`playwright.config.ts` (root): testDir `./tests/e2e`, single chromium worker, no retries, baseURL `http://localhost:5199`, 120s per-test timeout. Two auto-started webServers:
1. `npm --prefix functions run build && npx firebase emulators:start --only auth,functions,firestore --project demo-mmp` (waits on port 8080) — auth+functions+firestore together because the `onUserCreated` auth trigger must fire.
2. `npm run dev:e2e` = `vite --mode e2e --port 5199 --strictPort`, loading `.env.e2e` (placeholder keys, projectId `demo-mmp`, `VITE_USE_FIREBASE_EMULATOR=true`). `reuseExistingServer: false` — always spawns its own.

Specs: `create-pool.spec.ts` (7 tests — real registration, wizard walk, real `createPool`/`createNFLPool`/`createBracketPool` callables, one per pool type) and `admin-claims.spec.ts` (1 test). Every test promotes its fresh user to SUPER_ADMIN because `POOLS_OPEN = false` (`src/config/season.ts`) gates ordinary-user creation — meaning **the ordinary-user create path is never exercised end-to-end**.

Known gotchas (encoded in the config/helpers themselves — verified in-file 2026-07-06):
- **Dedicated port 5199** so a stray `npm run dev` (5173) from another checkout can't be silently reused.
- **Memory cache in e2e:** `src/firebase.ts:37-45` skips `persistentLocalCache` in emulator mode — IndexedDB persistence serves stale reads across page reloads in e2e.
- **Auth emulator password policy:** uppercase + non-alphanumeric required; a plain lowercase password fails registration *silently* (`tests/e2e/helpers.ts:19-23` — use `TestPass123!`-shaped passwords).
- **No `networkidle` waits** — Firestore keeps a listen channel open forever; wait on UI state instead.
- **Java required** for the emulators; `JAVA_HOME` is injectable (`playwright.config.ts:7-10`).
- Use `npx firebase`, never bare `firebase` (only on PATH inside npm-run-script shells).

### Origin of the harness (historical note, corrected 2026-07-06)

The Playwright harness was developed in the (since-removed) `D:\mmp-wizard` worktree and MERGED to main via PR #117 (2026-07-04): this repo's `tests/e2e/` (create-pool.spec.ts, admin-claims.spec.ts, global-setup.ts, helpers.ts) IS the canonical e2e surface. The historical gotchas still apply (dedicated port 5199, memory cache in e2e, password policy, no networkidle waits).

### In-app admin Test Suite (manual layer — CAUTION)

SuperAdmin dashboard → Test Suite tab (`src/components/SimpleTestingDashboard.tsx`): 15 scenario JSONs in `src/utils/testing/scenarios/`, run via real `createPool` callables **against production Firestore** with **no automatic cleanup** — "Run All (15)" creates 15 real pools per click. Cleanup code exists (`src/utils/testing/simulators/common.ts`) but is wired only to the orphaned `TestingDashboard.tsx`. Scenarios cover SQUARES/BRACKET/NFL_PLAYOFFS/PROPS only — NFL_PICKEM/NFL_SURVIVOR/NFL_MARGIN have no scenarios as of 2026-07-06. Interpretation guide lives in `mmp-diagnostics-and-tooling`; treat running it as a prod-data mutation decision (see `mmp-change-control`).

---

## 8. Known coverage gaps (do not let green suites overclaim)

As of 2026-07-06, there is **no automated coverage** for: `functions/src/scoring.ts` triggers, squares payout functions, `nflScoringEngine` server side (NFL engine logic is covered only indirectly via root `tests/nfl-*.test.ts`), email/reminders, `stripe.ts` webhooks, essentially all UI/components except `billingGate` and the wizard payload builders, and the entire SuperAdmin dashboard behavior (guarded only by the string-level clobber tests). NFL pools have never run a live season; the 2026 season is first — see `mmp-nfl-season-campaign` before trusting any NFL path.

---

## 9. How to ADD tests

| You are testing | Put the file | Name it | Copy the pattern from |
|---|---|---|---|
| Scoring engine / pure domain logic | `tests/` | `<topic>.test.ts` | `tests/bracketScoring.test.ts`; shared fixtures in `tests/test-utils.ts` |
| Invariant/regression guard (schema drift, admin surface shape) | `tests/` | `<topic>-invariants.test.ts` / `<topic>-drift.test.ts` | `tests/admin-surface-invariants.test.ts` (source-as-string asserts), `tests/pool-schema-drift.test.ts` (zod contract asserts) |
| Cloud Function logic (mocked) | `functions/src/__tests__/` | `<module>.test.ts` | `functions/src/__tests__/billing.test.ts` (hand-rolled `MockDoc`/query-snapshot doubles — no emulator, no firebase-functions-test) |
| Cloud Function against real Firestore semantics | `functions/src/__tests__/emulator/` | `<module>.emulator.test.ts` (suffix is load-bearing — routes it to the emulator config) | `functions/src/__tests__/emulator/poolCreation.emulator.test.ts` |
| Component render states | `src/__tests__/` | `<Component>.test.tsx` | `src/__tests__/billingGate.test.tsx` — uses `renderToStaticMarkup` + string asserts (no jsdom/testing-library installed; do not import @testing-library without adding the dep deliberately) |
| Wizard create-payload builders | colocate in `src/components/wizard/create/` | `build<Type>Payload.test.ts` | `src/components/wizard/create/buildSquaresPayload.test.ts` |
| Firestore rules | `functions/scripts/` | `<topic>.rules.test.mjs` | `functions/scripts/squarePrivate.rules.test.mjs` (self-documenting header with run command) |
| Browser flow | `tests/e2e/` | `<flow>.spec.ts` (`.spec`, not `.test` — vitest excludes `tests/e2e/`) | `tests/e2e/create-pool.spec.ts` + `helpers.ts` |

Rules of thumb:
- Root tests may import functions modules directly (the vite alias mocks admin/functions/stripe) — prefer this for engine logic; reserve `functions/src/__tests__` for callable/trigger orchestration.
- New root files under `tests/` are auto-collected (default vitest include). Do NOT put Playwright specs anywhere vitest can see them.
- After adding, re-run the suite and **record the new total** — the count in Section 2 is now stale, and any doc quoting the old number should be updated (see `mmp-docs-and-writing`).

---

## 10. Acceptance discipline — before you may say "done"

Ties directly to the gates in `mmp-change-control`. All applicable rows must hold, with pasted evidence:

| # | Gate | Evidence to state |
|---|---|---|
| 1 | Frontend typecheck clean | `npx tsc -b` (or `npm run build`) exit 0 |
| 2 | Functions typecheck clean | `npm --prefix functions run typecheck` exit 0 |
| 3 | Root suite green **with count** | `npm test` → `Tests  N passed (N)` (216 baseline as of 2026-07-06) |
| 4 | Functions suite green **with count** | `npm --prefix functions test` → `Tests  N passed (N)` (96 baseline) |
| 5 | Touched a scoring engine? | Section 5 invariant tests specifically named as passing |
| 6 | Touched the admin surface? | `tests/admin-surface-invariants.test.ts` passing (do not weaken asserts) |
| 7 | Touched firestore.rules? | rules test run (Section 3d) or explicit UNVERIFIED statement + manual rule-diff reasoning |
| 8 | Touched a create-flow/wizard? | Playwright specs run, or explicit statement they were not |
| 9 | Prod-data mutation path? | **Dry-run output pasted** before any enable — kill-switch + dry-run-default first (autoClosePools pattern; canonical in `mmp-change-control`) |
| 10 | UI change? | Screenshot or preview snapshot of the changed state — a green build is not render evidence |
| 11 | Multi-file change? | PLAN-*.md + adversarial review log + sweep pass exist (`mmp-change-control`) |

Deploy evidence is a separate gate (`mmp-deploy-and-operate`): always `npx firebase`, `npm --prefix functions ci` first, functions before rules, project `gridiron-gamble-uzuqo`; and note the prod www frontend deploys only via a MANUAL Coolify trigger — pushing to main does NOT deploy it (as of 2026-07-06).

---

## Provenance and maintenance

Every fact class above with a one-liner to re-verify it (run from `D:\march-melee-pools`):

| Fact class | Re-verify with |
|---|---|
| Root test count | `npm test` (read the `Tests  N passed` line) |
| Functions test count | `npm --prefix functions test` |
| Which files root vitest collects | `node node_modules/vitest/vitest.mjs list --filesOnly` |
| Emulator suite exists/passes | `npm --prefix functions run test:emulator` (needs Java) |
| E2E spec count | `npx playwright test --list` |
| Rules-test run command | `Get-Content functions/scripts/squarePrivate.rules.test.mjs -TotalCount 16` |
| Clobber-guard scope | `Get-Content tests/admin-surface-invariants.test.ts` (describe blocks) |
| maxPossibleScore invariant | `Select-String -Path tests/synthetic-scenarios.test.ts -Pattern maxPossibleScore` |
| CI gate contents | `Get-Content .github/workflows/ci.yml` |
| Coverage still unconfigured | `Select-String -Path package.json -Pattern coverage` (expect no hits) |
| No snapshot tests appeared | `Get-ChildItem -Recurse -Filter __snapshots__ tests,src,functions/src` (expect none) |
| Stale doc figures | `Select-String -Path AUDIT-REPORT-PRESEASON.md -Pattern '114/114'` then compare to a fresh run |
| POOLS_OPEN gate (e2e superadmin workaround still needed?) | `Get-Content src/config/season.ts` |
| mmp-wizard worktree still exists | `git worktree list` (dated fact about Kevin's machine; harness may have merged/moved) |
