---
name: mmp-build-and-env
description: "Use when setting up, rebuilding, or repairing the March Melee Pools dev environment on Windows: fresh clone to running dev server, npm install order (root AND functions), .env variable names, vite/tsc/functions builds, the copy-shared.mjs + @shared contract mechanism, Firebase emulator ports and Java requirement, git worktree creation with node_modules junctions, and build-failure symptoms like TS2307 'Cannot find module stripe', TS2307 './shared/poolTypes', 'firebase is not recognized', 'Could not spawn java', port 5173/5199 conflicts, or husky pre-commit python errors."
---

# mmp-build-and-env — recreate the dev environment from scratch (Windows)

Repo: `D:\march-melee-pools` (GitHub: `kstruck/MMPoolsV3`). React 19 + Vite 7 + TypeScript frontend, Firebase Cloud Functions v2 backend (Firestore, Auth), Firebase project `gridiron-gamble-uzuqo`. All commands below are PowerShell-compatible and assume repo root `D:\march-melee-pools` unless stated.

Facts verified against the repo on 2026-07-06 (branch state: `fix/superadmin-phase0-control` lineage). File:line references are to that snapshot.

## When NOT to use this skill

| You are trying to... | Use instead |
|---|---|
| Deploy functions/rules/hosting, or the Coolify www deploy | mmp-deploy-and-operate |
| Understand which tests exist and what evidence counts | mmp-validation-and-qa |
| Diagnose a runtime/prod failure (not a build failure) | mmp-debugging-playbook |
| Add or audit an env var / feature flag / kill switch | mmp-config-and-flags |
| Understand why the architecture is shaped this way | mmp-architecture-contract |
| Classify/gate a change, discipline rules | mmp-change-control |

## Glossary (project-specific terms used below)

- **shared/ contracts**: repo-root `shared/` — canonical pool-type enum, zod schemas, editability matrix, payment-handle adapter, consumed by BOTH the client and Cloud Functions.
- **copy-shared**: `functions/scripts/copy-shared.mjs` — mirrors `shared/` into `functions/src/shared/` (generated, gitignored) so functions `tsc` can compile it. Runs as the first step of every functions build/typecheck/test script.
- **@shared alias**: client-side import alias for `shared/` (vite.config.ts:16, tsconfig.app.json:23).
- **e2e mode**: `vite --mode e2e` loads `.env.e2e` (committed, placeholder values) and points the app at local Firebase emulators via `VITE_USE_FIREBASE_EMULATOR=true`.
- **worktree**: a second git checkout (`git worktree add`) so parallel sessions never share a working directory. Non-negotiable for parallel work — see mmp-change-control.

## 1. Prerequisites

| Requirement | Version / detail | Verified where |
|---|---|---|
| Node.js | No `.nvmrc`/volta/root `engines` field exists. Functions runtime pins Node **22** (functions/package.json:15). CI builds on Node **20** (ci.yml:22); Dockerfile uses node:20-alpine. Use Node 20 or 22; 22 matches the functions runtime. | package.json, functions/package.json, .github/workflows/ci.yml, Dockerfile:2 |
| npm | Ships with Node. CI uses `npm ci`; locally `npm install` is fine. | ci.yml:26-30 |
| Firebase CLI | Do NOT install globally. `firebase-tools` is a root devDependency (package.json:53) — always invoke as `npx firebase ...`. A bare `firebase` command is only on PATH inside npm-run-script shells (playwright.config.ts:36-38 documents this exact trap). | package.json:53 |
| Java (JRE 11+) | Required ONLY for Firestore/Auth emulators (emulator tests, Playwright e2e, `serve`). Not needed for dev server, builds, or mocked tests. No JDK is assumed on the machine; a portable JRE + `$env:JAVA_HOME` works (playwright.config.ts:7-10 injects JAVA_HOME into the emulator PATH). | playwright.config.ts:4-10 |
| Python | Required to COMMIT: husky pre-commit hook runs `python scripts/scan_secrets.py` (.husky/pre-commit:1). Must be on PATH as `python`. | .husky/pre-commit |
| Git | Standard. Worktrees used for parallel work (section 6). | — |

## 2. Fresh clone → running dev server

Run these in order. Step 3 is the one everyone skips; do not skip it.

```powershell
# 1. Clone
git clone https://github.com/kstruck/MMPoolsV3.git D:\march-melee-pools
cd D:\march-melee-pools

# 2. Root install (also runs the "prepare" script -> husky installs git hooks)
npm install

# 3. Functions install — REQUIRED, separate package
npm --prefix functions install

# 4. Create .env (see below — values from Kevin or the Firebase console; NEVER invent)

# 5. Run the dev server (port 5173, strictPort)
npm run dev
```

App is at `http://localhost:5173`. Port 5173 is `strictPort: true` (vite.config.ts:29-30) — if something else holds the port, vite fails fast instead of silently moving; kill the stale process.

### Why step 3 is mandatory — the TS2307 stripe/fft trap

`functions/` is its own npm package with its own `package.json` and `node_modules`. Root `npm install` does NOT install functions deps. Two functions dependencies exist ONLY there:

- `stripe` (functions/package.json:23), imported at functions/src/stripe.ts:11
- `firebase-functions-test` (devDep, functions/package.json:29), imported by the emulator test

If `functions/node_modules` is missing, every functions build/typecheck/test — and every `npx firebase deploy --only functions`, because firebase.json:12-14 predeploy runs `npm --prefix functions run build` — dies with:

```
error TS2307: Cannot find module 'stripe' or its corresponding type declarations.
```

Fix is always: `npm --prefix functions install`. This is discipline rule (b) in mmp-change-control (as of 2026-07-06): functions install first, `npx firebase` always, functions before rules, project `gridiron-gamble-uzuqo`.

### .env setup

`.env` is gitignored (.gitignore:27). Create it at repo root with these names (verified against the live .env and src/firebase.ts:7-14; README.md "Local Developement Setup" documents the same six):

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Where values come from: Firebase console → project `gridiron-gamble-uzuqo` → Project settings → Your apps → web app config — or ask Kevin (kstruck@gmail.com). Never fabricate values; the app will initialize against garbage and fail confusingly downstream.

Additional variables that exist but are optional for basic dev:

| Var | Read at | Notes |
|---|---|---|
| `VITE_RECAPTCHA_SITE_KEY` | src/firebase.ts:24 | ⛔ **DO NOT SET THIS IN PROD.** Setting it in Coolify took production down on 2026-07-30 (blank page, spinner forever) and was rolled back by deleting it. Absent is the CORRECT state; the `App Check is NOT active` warning it produces is the SAFE state. See §7's troubleshooting row and HANDOFF's STOP POINT box for the mechanism and the four faults that must be fixed first (the fourth: the Dockerfile declares no `ARG` for the key, so the build cannot receive it — which also means adding that `ARG` is what would make the key dangerous). In dev mode the App Check debug-token flag is set (src/firebase.ts:20-23), which is unaffected. The earlier claim here that "App Check is ENFORCED in the prod console as of 2026-07-06" is **superseded and UNVERIFIED** — App Check is enforced nowhere (98 `validated()` callables on `monitor`, zero `enforce`, plus 26 bare `onCall` sites with no App Check option) and the web app was never registered for App Check. |
| `GEMINI_API_KEY` | `.agent/skills/front-end-skill` (image-generation agent skill) | NOT read by the app. **CORRECTED 2026-08-23: the leak claim is TRUE** — `git show 3340fff0^:.env | grep -c VITE_API_KEY` (count-only — never reprint the value) in the public repo shows `VITE_API_KEY` (a Gemini key), exposed since 2025-12-13; the 2026-07-06 owner denial was wrong. Rotation CLOSED 2026-08-24 (Kevin ruling, evidence-verified): the leaked value returns API_KEY_INVALID when tested live, and .env history contains no other private key — the live key ("New MarchMeleePoolsAPI2", Jan 2026) never touched git. Kevin had already rotated; no further action.. |
| `VITE_USE_FIREBASE_EMULATOR` | src/firebase.ts:41 | Only set in the committed `.env.e2e`. Never set it in `.env`. |

`.env.e2e` IS committed (verified via `git ls-files`) and contains only placeholders + `VITE_FIREBASE_PROJECT_ID=demo-mmp` — emulators don't validate credentials, the projectId just has to match the emulator `--project` flag.

## 3. Builds

All scripts verified in package.json:6-18 and functions/package.json:3-13.

| Command | What it does | Notes |
|---|---|---|
| `npm run build` | `tsc -b && vite build` → `dist/` | Frontend typecheck + prod bundle. |
| `npm run build:static` | `npm run build && npm run prerender` | `prerender` = `tsx scripts/prerender.ts` (per-route static HTML for SEO/social). This is what the Dockerfile (Coolify www) and CI run — prefer it when verifying "does prod build". |
| `npm --prefix functions run build` | `node scripts/copy-shared.mjs && tsc` → `functions/lib/` | The ONLY correct way to build functions. Also the firebase.json:12-14 predeploy. |
| `npm --prefix functions run typecheck` | copy-shared + `tsc --noEmit` | Use this, never bare `tsc --noEmit` in functions/ (see trap table). CI runs exactly this (ci.yml:39-41). |
| `npm run lint` | `eslint .` | Advisory; CI lint job is continue-on-error with a large findings backlog. |

### The shared/ contract mechanism (why builds have a copy step)

- Canonical source: repo-root `shared/` (`@march-melee/shared`, private package: poolTypes.ts, schemas/, editability.ts, paymentHandles.ts).
- Client consumes it directly via the `@shared` alias — vite.config.ts:16 (`'@shared': path.resolve(rootDir, 'shared')`) + tsconfig.app.json:23 (`"@shared/*": ["shared/*"]`).
- Functions CANNOT alias outside their package for deploy bundling, so `functions/scripts/copy-shared.mjs` mirrors `shared/` → `functions/src/shared/` (skipping `__tests__`, `dist`, package scaffolding). That target dir is generated and gitignored (functions/.gitignore:3). Functions code imports it relatively, e.g. `from './shared/poolTypes'` (functions/src/nflPools.ts:9).
- NEVER edit `functions/src/shared/**` — it is overwritten on every build. Edit repo-root `shared/` instead, then any functions script re-copies it.
- Consequence: any bare `tsc` invocation inside `functions/` that didn't run copy-shared first fails with `TS2307: Cannot find module './shared/poolTypes'` on a fresh clone (or silently uses a stale copy on a dirty one). This bit CI once — that's why the `typecheck` npm script exists (ci.yml:36-38 comment).

### What CI gates (for parity when reproducing locally)

`.github/workflows/ci.yml`, required job `build-and-test` (Node 20): `npm ci` (root + functions), `npm run build:static`, functions `npm run typecheck`, root `npm test`, functions `npm test`. Separate required job validates nginx.conf via `docker run nginx:alpine nginx -t`. Emulator tests, rules tests, and Playwright are NOT in CI — see mmp-validation-and-qa.

## 4. Emulators

Configured in firebase.json:89-106:

| Emulator | Port |
|---|---|
| Auth | 9099 |
| Functions | 5001 |
| Firestore | 8080 |
| Hub | 4400 |
| Emulator UI | 4000 (enabled) |

All emulator runs use the fake project id `demo-mmp` (never the real project). Java required for Firestore/Auth. Client-side emulator wiring is in src/firebase.ts:49-56 (connects auth/firestore/functions when `VITE_USE_FIREBASE_EMULATOR === 'true'`).

Ways the repo uses them (all verified in package/config files):

1. **Functions-only serve**: `npm --prefix functions run serve` → build + `firebase emulators:start --only functions`.
2. **Emulator-backed functions tests**: `npm --prefix functions run test:emulator` → copy-shared + `firebase emulators:exec --only firestore --project demo-mmp "vitest run --config vitest.emulator.config.ts"`. Runs `src/**/*.emulator.test.ts` only, serially, with an `admin.initializeApp` setup file (functions/vitest.emulator.config.ts).
3. **Playwright e2e**: `npx playwright test` from repo root. playwright.config.ts spawns TWO webServers itself: (a) `npm --prefix functions run build && npx firebase emulators:start --only auth,functions,firestore --project demo-mmp` (readiness on port 8080), and (b) `npm run dev:e2e` = `vite --mode e2e --port 5199 --strictPort`, which loads `.env.e2e`. Port 5199 is dedicated to e2e precisely so a stray dev server on 5173 from another checkout can't be reused (`reuseExistingServer: false`). A `global-setup.ts` polls a callable before tests because Firestore accepting connections does NOT mean the ~80 functions have finished loading.
4. **Manual full-stack emulator dev**: `npx firebase emulators:start --only auth,functions,firestore --project demo-mmp` after a functions build, plus `npm run dev:e2e` in another terminal, gives you a browsable local stack at :5199 with zero prod contact.

Emulator behavior gotchas baked into the code (do not "fix" them):

- In e2e mode the client uses the SDK's default in-memory Firestore cache instead of `persistentLocalCache` (src/firebase.ts:37-46) — persistent cache serves stale IndexedDB reads against the emulator and breaks out-of-band-write assertions.
- The Auth emulator enforces a password policy (uppercase + non-alphanumeric). Weak passwords fail registration silently. The e2e suite's convention is `TestPass123!` (as of 2026-07-06).
- `waitForLoadState('networkidle')` never resolves against this app — Firestore `onSnapshot` holds a persistent channel. Never wait on networkidle.
- `POOLS_OPEN = false` (src/config/season.ts:2) means ordinary users cannot create pools, so every e2e test promotes its fresh user to SUPER_ADMIN first (tests/e2e/create-pool.spec.ts). See mmp-config-and-flags.

## 5. Windows-specific traps

1. **Always `npx firebase`, never bare `firebase`.** No global CLI is installed or wanted; `firebase-tools` resolves from root node_modules. Bare `firebase` works inside npm scripts (npm puts `node_modules/.bin` on PATH) but NOT in a raw shell — which is why playwright.config.ts:40 spells out `npx firebase`.
2. **Spawn Java from PowerShell, not git-bash.** Emulator runs need node to spawn `java`. git-bash's `/c/...`-style PATH entries prevent node from finding it — it fails silently. Set `$env:JAVA_HOME = "<jre root>"` in PowerShell before `npm --prefix functions run test:emulator` or `npx playwright test` (playwright.config.ts prepends `$JAVA_HOME\bin` to PATH for the emulator process).
3. **Husky pre-commit needs `python` on PATH.** `.husky/pre-commit` runs `python scripts/scan_secrets.py` (script verified present). On a machine with only the `py` launcher or `python3`, commits fail with a hook error. Fix: install Python and ensure `python` resolves. Never bypass with `--no-verify` — it's the secret scanner.
4. **Junctioned node_modules in worktrees.** `npm install` inside a worktree has failed on this machine before (as of 2026-07-03, D:\mmp-wizard precedent); the working pattern is a directory junction to the main checkout's node_modules — see section 6. Know that a junction SHARES deps: if your branch changes package.json deps, you must remove the junction and do a real install.
5. **strictPort everywhere.** Dev is 5173, e2e is 5199, both `--strictPort`. A "Port 5173 is already in use" error means a stale vite from an earlier session (possibly another checkout/worktree) — find and kill it (`Get-NetTCPConnection -LocalPort 5173 | Select-Object OwningProcess` then `Stop-Process -Id <pid>`). Do not let anything reuse another checkout's server: that exact failure mode once made an entire e2e suite test the wrong codebase.
6. **Claude preview MCP serves the wrong directory for worktrees.** `.claude/launch.json` defines one config ("dev", `npm run dev`, port 5173) rooted at the MAIN checkout. As of 2026-07-04 it launched vite in `D:\march-melee-pools` even when work lived in a worktree. For worktree verification, start the server yourself from the worktree path.
7. **Path separators**: repo scripts are cross-platform (node scripts, `npm --prefix`); nothing requires bash. Use PowerShell forms in docs/commands; the repo's own npm scripts already work on Windows as written.

## 6. Worktree setup for parallel work

Rule (mmp-change-control, rule d): new parallel work goes in its own worktree; never batch commits onto a branch another session may touch. Current worktrees are inspectable read-only:

```powershell
git -C D:\march-melee-pools worktree list
```

(As of 2026-07-06 this shows the main checkout plus two under `.claude/worktrees/`. The historical `D:\mmp-wizard` worktree — branch `feat/wizard-unification` — merged to `main` via PR #117 on 2026-07-04 and was removed afterward; nothing in it was lost. Treat D:\mmp-wizard as a dated precedent on Kevin's machine, not a live path.)

Procedure (verified against the D:\mmp-wizard precedent recorded 2026-07-03/04; the git commands are standard):

```powershell
# 1. Create the worktree with a new branch, as a sibling of the main checkout
git -C D:\march-melee-pools worktree add D:\mmp-<topic> -b feat/<topic>

# 2. Share dependencies via directory junctions (mklink /J needs cmd; no admin required)
cmd /c mklink /J D:\mmp-<topic>\node_modules D:\march-melee-pools\node_modules
cmd /c mklink /J D:\mmp-<topic>\functions\node_modules D:\march-melee-pools\functions\node_modules

# 3. Copy the untracked env file (worktrees don't inherit gitignored files)
Copy-Item D:\march-melee-pools\.env D:\mmp-<topic>\.env

# 4. Dev server in the worktree: use a NON-5173 port so nothing collides with
#    or reuses the main checkout's server
cd D:\mmp-<topic>
npx vite --port 5175 --strictPort
```

Caveats:

- If the worktree branch adds/changes dependencies, junctions are wrong — `Remove-Item D:\mmp-<topic>\node_modules` (removes the junction, not the target) and run a real `npm install` + `npm --prefix functions install` there. The mmp-wizard precedent added deps at ROOT via the main checkout so the junction stayed valid.
- e2e in a worktree already has a dedicated port (5199) and `reuseExistingServer: false` — that guard exists because of a worktree collision incident.
- Cleanup when done: `git -C D:\march-melee-pools worktree remove D:\mmp-<topic>` (refuses if dirty; junctions inside are removed with the dir and never touch the shared target).

- 🛑 **Do NOT reuse one worktree to check out a series of unrelated branches** — especially old ones such as dependabot PRs. `git checkout` renormalises line endings only for files it **rewrites**, so once a worktree has been materialised on a branch that predates `.gitattributes`, every file that branch did not touch keeps its CRLF for good. The suites that read repo source off disk then fail on a commit that is green everywhere else, and it reads as a code defect. One worktree per branch, or `git add --renormalize .` after switching. Measured 2026-08-28 — see the CRLF row in section 7.

## 7. Known traps — symptom → cause → fix

| Symptom (how the build fails) | Cause | Fix |
|---|---|---|
| `TS2307: Cannot find module 'stripe'` (or `firebase-functions-test`) during functions build/typecheck/deploy predeploy | `functions/node_modules` missing — root install doesn't cover the functions package | `npm --prefix functions install` |
| `TS2307: Cannot find module './shared/poolTypes'` (or `../shared/schemas`) in functions | Ran bare `tsc`/`tsc --noEmit` in functions/ — `functions/src/shared/` is generated+gitignored and wasn't copied | Use the npm scripts: `npm --prefix functions run build` / `typecheck` / `test` (all run copy-shared first) |
| Edits to `functions/src/shared/*` vanish | That dir is a generated mirror, overwritten every build | Edit repo-root `shared/` instead |
| `firebase : The term 'firebase' is not recognized` | No global CLI (by design) | `npx firebase ...` from repo root |
| Emulator start hangs/fails; java spawn errors or silent exit | No JRE, or spawned from git-bash where node can't resolve `java` | Install/point to a JRE, set `$env:JAVA_HOME` in PowerShell, run from PowerShell |
| `Port 5173 is already in use` (vite exits) | strictPort + a stale dev server (possibly another checkout) | Find owner of :5173 and kill it; never reuse another checkout's server |
| All Playwright tests fail with generic `internal` callable error at start | Functions emulator still loading its ~80 functions after Firestore's port opened | Already guarded by tests/e2e/global-setup.ts polling; if it recurs, re-run — do not "fix" tests |
| e2e registration silently does nothing | Auth emulator password policy rejects weak passwords without a visible throw | Use `TestPass123!`-class passwords in tests |
| e2e assertion never sees an out-of-band Firestore write | `persistentLocalCache` vs emulator | Already handled: e2e mode uses in-memory cache (src/firebase.ts:41-46); don't re-enable persistence in e2e |
| Playwright wait on `networkidle` times out | Firestore onSnapshot keeps a channel open forever | Wait on selectors/URLs, never networkidle |
| `git commit` fails in the hook with a python error | husky pre-commit runs `python scripts/scan_secrets.py`; python not on PATH | Install Python / alias `python`; do NOT `--no-verify` |
| `npm install` fails inside a worktree | Worktree install issue seen on this machine (2026-07-03) | Junction node_modules from the main checkout (section 6) |
| Console warn `App Check is NOT active` in a prod build | `VITE_RECAPTCHA_SITE_KEY` absent at build time — **deliberately** | ⛔ **LEAVE IT. This warning is the safe state, not a defect.** Acting on the previous advice in this row ("supply the key") preceded prod going down on 2026-07-30 — set → blank page, deleted → alive, two machines, two networks. ⚠️ The mechanism first written down (CSP blocks the reCAPTCHA script → token never resolves → Firestore SDK goes offline) is a HYPOTHESIS and cross-model review holed it: `Dockerfile:15-27` declares no `ARG` for this key, so it has no known path into the Vite build. The instruction stands on the observation, not the story. Four faults must ALL be fixed first (CSP hosts, Enterprise-vs-v3 key, app never registered, no Dockerfile `ARG`) — see HANDOFF's STOP POINT box. |
| **ROOT** `npx vitest run` fails **7 test FILES** with `Cannot find module '../shared/schemas/quote'` and zero failing assertions | `functions/src/shared/` is generated and gitignored, and several ROOT test files import `functions/src` code that resolves `../shared/*` from that mirror. The skill's other copy-shared rows are about the FUNCTIONS build; this one bites the root suite, on a fresh worktree, before anything is wrong | `node functions/scripts/copy-shared.mjs` once, then re-run. **The signature is N failed FILES with 0 failed assertions** — that is the harness, never a regression. Measured 2026-08-28: 7 files failed, 2845 assertions passed; after copy-shared, 157 files / 2969 passed |
| A REUSED worktree fails `tests/addon-purchase.test.ts` (3 tests) while the same commit is green elsewhere | **CRLF.** `.gitattributes` (`* text=auto eol=lf`) forces LF on checkout — but `git checkout` only renormalises files it **rewrites**. A worktree first materialised on a branch that PREDATES `.gitattributes` keeps CRLF in every unchanged file forever after, and that suite reads `functions/src/stripe.ts` off disk and asserts on multi-line \n literals | Measure, do not guess: `tr -dc '\r' < functions/src/stripe.ts | wc -c` — **0** on a good tree, **1871** on the bad one (2026-08-28). Fix by deleting and re-creating the worktree, or `git add --renormalize .`. ⚠️ **It looks exactly like a dependency bump broke the suite** — it appeared under three different dependabot bumps in one night before the cause was found |
| Functions behave differently under root vitest vs functions vitest | Root vite.config.ts:17-24 aliases firebase-admin/firebase-functions/stripe to hand-written mocks in tests/mocks/ for root tests | Expected: root suite = pure-logic with mocks; functions suite = its own doubles; emulator suite = real Firestore. See mmp-validation-and-qa |
| Tempted to "fix" the firebase-admin version skew (root ^13.6.1 vs functions ^12.7.0) | Real, verified skew — root's copy feeds test mocks/aliases **AND the `scripts/*.mjs` ops scripts** (`checkWinners`, `inspectPool`, `migrate-entitlements`, the `.claude/skills` census scripts). ⚠️ **Root tests do NOT exercise it**: `vite.config.ts:22-23` aliases both `firebase-admin` and `firebase-admin/firestore` to a mock, so the suite is just as green with the package uninstalled — a green root suite is NOT evidence about this dependency. Nothing tests the ops scripts either | Leave it unless a ticket says otherwise; upgrading the functions copy is a deploy-affecting change → mmp-change-control. Note dependabot could not have proposed the functions half before 2026-08-28: `.github/dependabot.yml` watched `directory: "/"` only, and `directory` is not recursive |

## 8. Quick sanity checklist after setup

```powershell
cd D:\march-melee-pools
npm run build:static                     # frontend typecheck + build + prerender
npm --prefix functions run typecheck     # copy-shared + tsc --noEmit
npm test                                 # root vitest (pure-logic suites)
npm --prefix functions test              # functions mocked suite
```

All four are exactly what the required CI job runs. If they pass, the environment matches CI. Emulator/e2e verification is optional extra credit and needs Java (section 4).

## Provenance and maintenance

Written 2026-07-06 from the repo files cited above plus owner interview 2026-07-06. Re-verify each fact class before trusting it after significant time or dependency changes:

| Fact class | Re-verification command (PowerShell, from D:\march-melee-pools) |
|---|---|
| Root npm scripts / deps / Node hints | `Get-Content package.json` |
| Functions scripts / engines / stripe+fft deps | `Get-Content functions\package.json` |
| Predeploy + emulator ports | `Get-Content firebase.json` |
| copy-shared behavior | `Get-Content functions\scripts\copy-shared.mjs` |
| @shared alias (client) | `Select-String -Path vite.config.ts,tsconfig.app.json -Pattern '@shared|shared'` |
| .env variable names actually read by the app | `Select-String -Path src -Pattern 'import\.meta\.env\.' -Recurse` |
| e2e ports / webServer commands / JAVA_HOME handling | `Get-Content playwright.config.ts` |
| Husky hook contents | `Get-Content .husky\pre-commit` |
| CI parity commands | `Get-Content .github\workflows\ci.yml` |
| Current worktrees | `git worktree list` |
| Wizard-unification branch still unmerged | `git branch --all | Select-String wizard` and `git log origin/main --oneline -20` |
| Emulator suite config | `Get-Content functions\vitest.emulator.config.ts` |
