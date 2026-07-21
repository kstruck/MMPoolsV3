---
name: mmp-debugging-playbook
description: >
  Use when debugging a failure in March Melee Pools / Gridiron Gamble: a crash,
  white screen, "Missing or insufficient permissions" / permission-denied error,
  callable HttpsError, TS2307 build failure, App Check rejection, wrong scores or
  standings, pools closing/locking unexpectedly, wizard buttons doing nothing,
  Stripe checkout oddities, ESPN import producing wrong seeds/regions, "my deployed
  fix isn't visible", or "my merged change disappeared". Contains a symptom→cause→
  experiment→fix table for this project's real historical failure modes, a decision
  tree for client-bug vs rules-bug vs function-bug, how to read function logs, how
  to reproduce with emulators, and a traps section with the story behind each trap.
---

# MMP Debugging Playbook

Symptom-first triage for D:\march-melee-pools (React + Vite client in `src/`,
Firebase Cloud Functions in `functions/src/`, Firestore rules in `firestore.rules`).
Every row below was verified against the repo on 2026-07-06. Prod Firebase project:
`gridiron-gamble-uzuqo`. Prod www frontend is served by nginx via Coolify — NOT
Firebase Hosting — and deploys only when Kevin manually triggers it in the Coolify
dashboard (as of 2026-07-06).

Jargon used below:
- **callable** — a Firebase `onCall` Cloud Function invoked from the client via `httpsCallable`.
- **claim** — the JWT custom claim `token.role` (SUPER_ADMIN | MODERATOR | COMMISSIONER | MEMBER | BANNED). Authoritative for Firestore rules.
- **doc role** — the mutable `users/{uid}.role` Firestore field. NOT authoritative; a few legacy callables still fall back to it.
- **App Check** — Firebase attestation (ReCaptcha Enterprise). ENFORCED in the prod console as of 2026-07-06.
- **sim- pool** — a pool doc created directly by the client with slug `sim-*`, allowed only for SUPER_ADMIN by `firestore.rules:93`. Used by the Tournament Simulator / admin Test Suite.

## 1. Decision tree: client bug vs rules bug vs function bug

Run these checks in order; the first hit tells you which layer to debug.

1. **Is there any error at all?** UI sits there inert (button does nothing, no console
   output) → almost certainly a CLIENT bug — historically a silently-swallowed
   validation failure (see Trap T4). Open DevTools console first; if it is clean,
   suspect swallowed promises/validation in the component.
2. **Error text contains `Missing or insufficient permissions` or code
   `permission-denied`?** → RULES layer. The client did a direct Firestore
   read/write that `firestore.rules` rejected. Go to symptom rows S5/S6.
   Key fact: `isSuperAdmin()` in rules reads ONLY the token claim
   (`firestore.rules:17-18`), never the user doc.
3. **Error is a callable failure** (console shows `FirebaseError: functions/...`
   e.g. `functions/unauthenticated`, `functions/failed-precondition`,
   `functions/internal`)? → FUNCTION layer. Read the server log:
   `npx firebase functions:log --only <functionName> --project gridiron-gamble-uzuqo`.
   `functions/internal` with nothing useful client-side almost always has a real
   stack trace server-side.
4. **Request never reaches the function / fails with an App Check or 401/403
   attestation error?** → APP CHECK layer (S7). Distinct from rules: rules
   rejections come back as `permission-denied` on Firestore ops; App Check
   rejections block the request before your code runs.
5. **Data is wrong but nothing errors** (wrong standings, wrong winners, counts
   drift)? → engine/data bug. Check the scoring-drift rows (S9, S10) and the
   `fix*` callables inventory in mmp-diagnostics-and-tooling. Domain math lives
   in mmp-pools-domain-reference.
6. **Behavior differs between your machine and prod?** → environment/config (S8,
   S12, S13). Check which Firebase project and which frontend build you are
   actually hitting before debugging code.

Discriminating experiment for claim-vs-doc-role confusion (the most common
permission-denied cause): if an admin **callable** succeeds but a direct
Firestore admin **read/write from the client** fails with permission-denied,
the user doc says SUPER_ADMIN but the token claim is missing/stale. (Several
legacy callables fall back to the doc role — `functions/src/espnBracket.ts:822-825`,
`:981-984`, `:1009-1012` — while rules never do.) Fix: call the `syncMyClaims`
callable (`functions/src/adminClaims.ts:152`, self-only, mints the claim from
the rules-protected doc role), then force a token refresh
(`getIdToken(true)`) or sign out/in.

## 2. Symptom table

| # | What you observe | Likely cause | Discriminating experiment | Fix location |
|---|---|---|---|---|
| S1 | White screen / app-wide crash after clicking an admin tool; console shows `TypeError: Cannot read properties of undefined (reading 'filter')` on `.squares` | Code assumed every pool is a SQUARES `GameState`; `.squares` exists only on SQUARES pools. Historic instance: SimulationDashboard filtered `!== 'BRACKET'` and crashed on NFL/PROPS pools | Check the pool `type` field of the pool being rendered vs the fields the component dereferences | Filter to `p.type === 'SQUARES'` and guard with `?? []` — pattern at `src/components/SimulationDashboard.tsx:29,159,260`. Per-tab ErrorBoundary now contains SuperAdmin crashes (`src/components/SuperAdmin.tsx:1226`); global one is `src/main.tsx:13` |
| S2 | Wizard "Next" button does nothing; no error anywhere | react-hook-form `trigger()` failed and the result was ignored, OR a default value is schema-invalid (Props wizard pre-seeded a blank question failing `min(1)`) | Add a breakpoint in `goNext()` in WizardShell; check `methods.formState.errors` | `src/components/wizard/WizardShell.tsx` — commit `b792eee` added `submitError` surfacing naming the failing fields. Any NEW silent-failure = same class; mirror that fix |
| S3 | `firebase deploy --only functions` fails with `TS2307: Cannot find module 'stripe'` (or `'firebase-functions-test'`) | `functions/node_modules` not installed — the predeploy hook runs `npm --prefix functions run build` (`firebase.json`) which needs functions' own deps (root install does NOT cover them) | `Test-Path functions/node_modules/stripe` | Run `npm --prefix functions ci` from repo root, then redeploy. (`ci`, not `install`: `install` rewrites the lockfile and dirties the tree the deploy packages.) This is deploy-ritual rule (b) in mmp-change-control |
| S4 | Deployed a functions/rules change but prod www behavior unchanged | (a) Frontend change: www deploys ONLY via manual Coolify trigger — pushing main does nothing; (b) firebase.json hosting rewrites do not apply to www (nginx serves it) | Check the served bundle hash in DevTools Network vs your local `dist/`; check function deploy time via `npx firebase functions:list` | Ask Kevin to trigger the Coolify deploy (frontend), or actually run the firebase deploy (backend). See mmp-deploy-and-operate |
| S5 | `permission-denied` on an admin Firestore read/write although the user "is" SUPER_ADMIN | Token claim missing/stale; only `request.auth.token.role` counts in rules (`firestore.rules:17-18`). Doc role is irrelevant to rules | The callable-vs-direct-read experiment in section 1. Also reproduce in emulator with the same rules | Call `syncMyClaims` (`functions/src/adminClaims.ts:152`) then `getIdToken(true)` / re-login. Do NOT weaken the rule |
| S6 | `permission-denied` creating a pool doc from the client | Client-side pool creation is forbidden by design — the ONLY exception is slug `^sim-.*` + SUPER_ADMIN (`firestore.rules:93`). Everything else must go through the create callables | Check whether the write is a direct `setDoc/addDoc` on `pools/` vs a callable | Route through `createPool` / `createBracketPool` / `createNFLPool` callables (`functions/src/poolOps.ts:50`, `bracketPools.ts:20`, `nflPools.ts:40`). Never widen rules:93 |
| S7 | Requests rejected before code runs; attestation/App Check errors; works in DEV but not a prod-like build | App Check is ENFORCED in prod console (as of 2026-07-06). Client only initializes App Check when `VITE_RECAPTCHA_SITE_KEY` is set (`src/firebase.ts:24-32`); DEV sets a debug-token flag (`:20-23`) that must be registered in the Firebase console to work | Console warning `App Check is NOT active` in a non-DEV build = missing site key. In e2e/emulator this never applies (`.env.e2e` has no site key; emulators don't enforce) | Env var `VITE_RECAPTCHA_SITE_KEY` in the build environment; debug token registration in Firebase console → App Check. Note `logClientError` still has `enforceAppCheck: false` + TODO (`functions/src/logClientError.ts:33-35`) |
| S8 | App behaves totally differently / data missing — you are on the wrong backend | Emulator mode is opt-in via `VITE_USE_FIREBASE_EMULATOR=true`, set ONLY in `.env.e2e` (loaded by `vite --mode e2e`). Normal `npm run dev` talks to REAL prod Firestore | Check `src/firebase.ts:41-55` behavior: e2e mode = project `demo-mmp`, ports 9099/8080/5001, port 5199, in-memory cache. Check the browser URL port and the projectId in Network requests | Use `npm run dev:e2e` + emulators for isolated repro; plain `npm run dev` mutates prod data — treat it as prod |
| S9 | Bracket standings differ between what the client shows and what the server scored | Bracket scoring is TRIPLICATED; client copies resolve seeds via regex-only `extractSeedFromTeamId` which returns null for display-name team IDs, server uses `importedTeams` lookup | Compare seed resolution for one display-name teamId across `src/utils/bracketScoring.ts:30`, `src/components/BracketPoolDashboard/bracketScoring.ts:83`, `functions/src/bracketScoring.ts:37` (server copy is `@deprecated`, kept as fallback) | Server (`scoreBracketEntries`) is the source of truth for payouts. Long-term fix = consolidate into `shared/` (open debt, flagged in three audits). See mmp-pools-domain-reference |
| S10 | Every Score Pays / Hybrid pool has wrong or missing winners | Score-event decomposition drifted; hybrid weights missing. There is a three-layer repair pattern (`functions/src/scoreUpdates.ts:1394,1412`, `src/utils/payouts.ts:54`, `src/components/admin/WizardStepPayouts.tsx:82`) | Inspect the pool doc's `scoreEvents` and `scoreChangeHybridWeights` fields | SUPER_ADMIN `fixPoolScores` callable (`functions/src/scoreUpdates.ts:1342`) — WARNING: it resets Every-Score-Pays pools to 0-0 before re-decomposing; an ESPN outage mid-run leaves pools zeroed. Run via Operations tab, one pool at a time first |
| S11 | Pools closing by themselves every morning | `autoClosePools` is LIVE past dry-run in prod (as of 2026-07-06) — daily 08:00 UTC sweep actually closes stuck-open finished pools | Read its `admin_audit` summary entries; kill-switch = `system/config.autoClose.enabled`, dry-run flag = `.dryRun` (`functions/src/autoClosePools.ts:26-48`) | If a pool was closed wrongly, check `isAutoCloseEligible` in `functions/src/lib/lifecycle.ts`; to pause, set `system/config.autoClose.enabled=false` |
| S12 | Stripe checkout "succeeds" without charging | Mock sandbox: if `STRIPE_SECRET_KEY` is absent/placeholder, checkout activates purchases for free (`functions/src/stripe.ts:152-207, 372-414`). Fine locally, dangerous if the prod secret binding breaks | `npx firebase functions:secrets:access STRIPE_SECRET_KEY --project gridiron-gamble-uzuqo` (needs permission) or check function logs for the mock-mode path | Secret Manager binding on `createCheckoutSession`/`handleStripeWebhook` (`stripe.ts:19-20`). Reminder: Stripe = commissioner hosting fees ONLY; participant entry fees are P2P and never touch the platform |
| S13 | Billing price/tier change appears in checkout but lifecycle enforcement (trial→grace→locked) ignores it — or vice versa | CONFIG SPLIT-BRAIN: checkout reads `settings/billing_config` (`functions/src/stripe.ts:91,172,548`; admin save writes there too, `adminBillingOps.ts:32`) but `enforceBillingStatus` reads `config/billing_config` (`functions/src/billing.ts:40`) | Read both docs in the Firestore console; diff them | Until unified, any billing-config change must be checked against BOTH readers. See mmp-config-and-flags |
| S14 | ESPN bracket import yields wrong seeds/regions | Someone used `NCAA_2026_BRACKET` for seeds — its own comment says "DO NOT use ... it has incorrect data" (`functions/src/espnBracket.ts:405`). Correct sources: seed = `curatedRank.current`, region = parsed from `competition.notes[0].headline` | Compare one team's imported seed against the live ESPN scoreboard JSON | `functions/src/espnBracket.ts` WS4 block (~:400-410). Also: scheduler sync must NOT write `importedGames/importedTeams` (raw ESPN blobs contain `undefined` → Firestore crash, `:948`); only manual `importTournamentFromESPN` saves them |
| S15 | Firestore error `Transactions require all reads to be executed before all writes` in scoring/reminders | Read-after-write inside a transaction — a known landmine cluster | Stack trace points at the transaction body | Pre-read pattern: `functions/src/scoreUpdates.ts:999` (eventWinners PRE-READ), `:1300` (no `transaction.update` there), `functions/src/reminders.ts:578` (dedupe skipped deliberately). Follow the existing comments; do not "fix" them |
| S16 | Your merged change is gone from main ("nothing changed") | The Clobber pattern: a long-lived branch cut before your work merged after it and silently reverted it (PRs #116/#117 reverted the entire T1-T14 admin overhaul; invisible to CI twice) | `git log --oneline -- <file>` and diff against the commit that introduced your change; run `npx vitest run tests/admin-surface-invariants.test.ts` (the anti-clobber guard) | Restore from git history verbatim, then restyle. Process fix lives in mmp-change-control (merge latest main + re-verify admin surfaces before PR) |
| S17 | NFL week never scored / spreads never locked | `scoreNFLWeek` remains a manual per-pool/per-week callable (owner or SUPER_ADMIN; refuses while games active unless SUPER_ADMIN, `functions/src/nflPools.ts:580`). `lockNFLSpreadsJob` exists (`nflSchedule.ts:301`) but is STILL NOT exported from `functions/src/index.ts` — spread-locking has never run. STATUS UPDATE 2026-07-12: a separate scheduled job, `nflFinalizeSweepJob` (nflFinalize.ts:230, deployed, daily 08:30), now exists as a backstop for pools `scoreNFLWeek` already scored but failed to finalize — it does NOT score weeks or lock spreads, so this symptom's root cause is unchanged; kill-switch default OFF/dry-run default per Rule 1, arming is a pending Kevin item | `grep lockNFLSpreadsJob functions/src/index.ts` → no hit (re-verify — was true 2026-07-06 and 2026-07-12). Check `nfl_games` freshness (updated by `syncNFLScoresJob`, every 5 min) | Manual op for now; the real fix is the mmp-nfl-season-campaign work. 2026 is the FIRST live NFL season — nothing here is battle-tested |
| S18 | Playoff pool write fails as entries grow | T8 1MB doc bomb: playoff entries live as a `Record<string,PlayoffEntry>` map ON the pool doc; ~500 entries bricks the pool. Flagged in three audits, migration NEVER BUILT — still open as of 2026-07-06 | Check the pool doc size in Firestore console | Open debt; designed fix is a `pools/{id}/playoff_entries/{uid}` subcollection. Do not attempt casually — live-data migration risk; go through mmp-change-control |
| S19 | Prod DB polluted with pools named `AI Test - ...` or slug `sim-*` | Admin Test Suite runs against REAL prod Firestore via the real `createPool` callable and never cleans up (cleanup code exists but is wired only to the orphaned `TestingDashboard.tsx`); TournamentSimulator creates `sim-` slug pools client-side | Names come from `src/utils/testing/simulators/squaresSimulator.ts:49` | Manual deletion for now; Phase-2 simulator server API (audited callables + rules:93 removal) is the planned fix. See mmp-superadmin-surface |
| S20 | Function deployed but scheduled job runs at an odd local hour / off-season date logic breaks | Schedules without `timeZone` run in UTC (`enforceBillingStatus` 03:00, `autoClosePools` 08:00). Tournament default `lockAt` hardcodes `-04:00` — safe ONLY Mar 15–early Nov per its own comment (`functions/src/espnBracket.ts:328-338`) | Check the schedule string and timeZone in the function's options | The respective function file; never reuse the `-04:00` pattern outside the safe window |

## 3. Reading function logs

All commands from repo root `D:\march-melee-pools` (PowerShell). Always `npx firebase`
(firebase-tools ^15.7.0 is a root devDependency; there is no global CLI on this machine).

```powershell
# Recent log lines across all functions (prod)
npx firebase functions:log --project gridiron-gamble-uzuqo

# One function only, more lines
npx firebase functions:log --only scoreNFLWeek -n 200 --project gridiron-gamble-uzuqo

# Equivalent via the functions package script
npm --prefix functions run logs
```

Interpretation notes:
- Callables that threw `HttpsError` show the code + message; `functions/internal`
  seen client-side means an UNTYPED throw — the real stack is only in these logs.
- Schedulers swallow per-item errors and continue (e.g. `autoLock.ts`, `billing.ts`)
  — a "successful" run can still have per-pool failures logged as warnings.
- For richer filtering use GCP Console → Logging → Logs Explorer for project
  `gridiron-gamble-uzuqo` (resource type Cloud Function / Cloud Run function).
- In-app telemetry sinks (read via Firestore console or admin UI):
  `system_logs` (client crash telemetry via the `logClientError` callable,
  `src/services/errorHandler.ts:96-107`), `system/scoreSync` heartbeat
  (score-sync freshness), `health/latest` (hourly health snapshot),
  `admin_audit` (platform admin actions), `pools/{id}/audit_events` (pool-scoped).
  Interpretation guides: mmp-diagnostics-and-tooling.

## 4. Reproducing with emulators

The emulator stack needs a JRE (Firestore emulator is Java). `playwright.config.ts:4-10`
supports injecting `JAVA_HOME` if a portable JRE isn't on PATH.

```powershell
# 1) Full E2E (boots emulators + vite e2e server on port 5199 automatically)
npx playwright test

# 2) Functions emulator test suite only
npm --prefix functions run test:emulator

# 3) Manual interactive repro against emulators (two terminals)
npm --prefix functions run build
npx firebase emulators:start --only auth,functions,firestore --project demo-mmp
# terminal 2:
npm run dev:e2e     # vite --mode e2e --port 5199, loads .env.e2e
# browse http://localhost:5199

# 4) Pure-logic repro (no emulator needed — firebase-admin is mocked)
npm test                        # root suite, tests/*.test.ts + src/__tests__
npm --prefix functions test     # functions mocked suite
```

Emulator-mode gotchas (verified in `src/firebase.ts` and e2e specs):
- Emulator wiring activates ONLY when `VITE_USE_FIREBASE_EMULATOR=true` (set solely
  in `.env.e2e`). Plain `npm run dev` talks to prod.
- E2E uses the in-memory Firestore cache, not persistent IndexedDB (`firebase.ts:37-46`)
  — persistence bugs won't reproduce there.
- `POOLS_OPEN` launch gate is false, so every e2e test promotes its fresh user to
  SUPER_ADMIN (`tests/e2e/create-pool.spec.ts`) — the ordinary-user path is never
  exercised end-to-end. Don't conclude "works in e2e" covers member flows.
- Rules can be unit-tested in the emulator:
  `npx firebase emulators:exec --only firestore "node functions/scripts/squarePrivate.rules.test.mjs"`
  (needs `@firebase/rules-unit-testing`, not installed by default).

## 5. Traps — the story and the cost

- **T1 The Clobber (worst incident on record).** The full T1-T14 super-admin
  overhaul was built, reviewed, merged (PRs #111-#115, 2026-07-03) — then silently
  reverted by two follow-on merges (#116 ui-revamp, #117 wizard-unification) cut
  from pre-overhaul baselines. CI stayed green both times. Cost: a multi-day
  restore effort plus a dedicated CLOBBER-AUDIT.md and restore plan. Residue you
  can use: `tests/admin-surface-invariants.test.ts` regression guard. Lesson: when
  a change "disappears", suspect a merge revert before suspecting your memory.
- **T2 The stale-premise plan.** The wizard-unification plan targeted a
  "client-write hole" that had already been closed — the exploration report was
  wrong and an adversarial review round caught it. Cost: a full plan rewrite
  (ADR-0001). Lesson: verify a bug still exists in code before planning its fix;
  discovery docs are maps, not truth.
- **T3 The .squares white screen.** Live-reproduced in the 2026-07-05 prod
  walkthrough: one click on "Open Simulation Dashboard" → `TypeError` on
  `.squares.filter` → the single global ErrorBoundary caught it → white screen for
  the ENTIRE app. Root class: "everything non-BRACKET is assumed to be squares."
  Now fixed (S1) with per-tab boundaries, but the class recurs anywhere pool docs
  of mixed `type` flow through one code path — grep for unguarded `.squares`,
  `.axisNumbers`, `.participants` derefs when adding pool-generic UI.
- **T4 Silent validation.** Two separate commits fixed the same class within a
  day: schema bugs swallowed at submit, then `goNext()` swallowing `trigger()`
  failures, then a schema-invalid Props default making "Next" inert with zero
  feedback (`b792eee`). Only found by driving the real wizard with Playwright.
  Lesson: any `await trigger(...)` / `safeParse` whose failure branch does nothing
  is a bug in this codebase's house style — surface it in `submitError`.
- **T5 TS2307 stripe/fft.** Recurring deploy-time failure: the functions predeploy
  build needs `functions/node_modules` (stripe, firebase-functions-test), which a
  root `npm install` does not provide. Recorded as a standing deploy rule after
  repeated hits. Cure is always `npm --prefix functions ci` first.
- **T6 Deploy-order dependency.** Functions must deploy BEFORE rules: e.g. the
  `logClientError` callable had to exist before `system_logs` client-create was
  locked down, "else front-end error telemetry silently drops." The tightened
  rules are live in prod (as of 2026-07-06), so the same ordering applies to any
  future callable-replaces-client-write change.
- **T7 The telemetry near-miss.** A hardening pass almost locked `system_logs` to
  functions-only, which would have silently destroyed the client crash telemetry
  exactly while hardening admin ops. Caught in review. Lesson: before locking a
  collection, grep the CLIENT for writers (`src/services/errorHandler.ts` was the
  writer here).
- **T8 fixPoolScores hand-rolled backfill.** An earlier fix attempt re-implemented
  score-event decomposition manually and failed; the working fix replaced ~200
  lines with a call to the proven `processGameUpdate` transaction
  (FIX_INSTRUCTIONS.md). Lesson: repair paths must reuse the live engine, never
  reimplement it.
- **T9 The mislabeled revenue premise.** `stats/global.totalRevenue` was actually
  prize GMV (member→commissioner dues), not platform income — an entire ticket was
  re-specced mid-execution. Lesson: in this codebase "revenue" is ambiguous;
  platform income lives in `billingCharges` → `admin_stats/revenue` only.
- **T10 Non-idempotent admin ops.** `backfillPools` double-counts stats on re-run
  (`functions/src/backfill.ts:53-84`, FieldValue.increment, no dry-run);
  `finalizeTournamentPayouts` re-sends recap emails on re-run
  (`functions/src/bracketScoring.ts:386-617`); `importNFLSchedule` deletes all
  season games in one unbounded batch before re-import (`nflSchedule.ts:168-186`).
  When triaging "duplicate emails" or "doubled stats", ask "did someone re-run an
  op?" before hunting code bugs.
- **T11 Preview-MCP wrong directory (parallel-worktree hazard).** During e2e work
  in the separate worktree `D:\mmp-wizard` (a dated fact about Kevin's machine),
  the preview MCP served the WRONG directory's build — verify which checkout a dev
  server actually serves (dedicated port 5199 exists precisely to avoid colliding
  with a stray `npm run dev` from another checkout).

## 6. When NOT to use this skill

- Setting up the dev environment from scratch, Java/emulator install, env files → **mmp-build-and-env**.
- Executing a deploy, Coolify procedure, scheduled-job operations calendar → **mmp-deploy-and-operate**.
- Understanding scoring math / tiebreakers / lifecycle semantics (not debugging a deviation) → **mmp-pools-domain-reference**.
- Which config axis / kill-switch / flag exists and how to add one → **mmp-config-and-flags**.
- Health checks, audit-log interpretation, admin Test Suite usage → **mmp-diagnostics-and-tooling**.
- Full incident histories with evidence chains (this file keeps only triage-relevant summaries) → **mmp-failure-archaeology**.
- Process for landing the fix once diagnosed (plan/review/sweep gates, the 4 discipline rules) → **mmp-change-control**.
- Test commands and evidence bar for proving the fix → **mmp-validation-and-qa**.
- Admin UI contract / where an admin capability should live → **mmp-superadmin-surface**.
- NFL 2026 readiness work (S17 is a symptom row; the campaign is elsewhere) → **mmp-nfl-season-campaign**.

## 7. Provenance and maintenance

All file:line references verified 2026-07-06 on branch `fix/superadmin-phase0-control`.
Re-verify a fact class before relying on it if the anchor command below disagrees:

| Fact class | Re-verification command (repo root, PowerShell) |
|---|---|
| SimulationDashboard SQUARES guard still present | `Select-String -Path src/components/SimulationDashboard.tsx -Pattern "type === 'SQUARES'"` |
| Rules use claim-only isSuperAdmin | `Select-String -Path firestore.rules -Pattern "token.get\('role'"` |
| sim- create exception still exists | `Select-String -Path firestore.rules -Pattern "\^sim-"` |
| Billing-config split-brain still open | `Select-String -Path functions/src/stripe.ts,functions/src/billing.ts -Pattern "billing_config"` |
| lockNFLSpreadsJob still NOT deployed | `Select-String -Path functions/src/index.ts -Pattern "lockNFLSpreadsJob"` (no output = still dead) |
| autoClosePools kill-switch location | `Select-String -Path functions/src/autoClosePools.ts -Pattern "system/config"` |
| logClientError App Check still un-enforced | `Select-String -Path functions/src/logClientError.ts -Pattern "enforceAppCheck"` |
| Emulator opt-in mechanics | `Select-String -Path src/firebase.ts -Pattern "VITE_USE_FIREBASE_EMULATOR"` |
| Client/server seed-resolution drift (S9) still open | `Select-String -Path src/utils/bracketScoring.ts -Pattern "extractSeedFromTeamId"` |
| Anti-clobber guard test exists | `Test-Path tests/admin-surface-invariants.test.ts` |
| Deployed function list vs code | `npx firebase functions:list --project gridiron-gamble-uzuqo` |
| Prod-console facts (App Check enforced, autoClose live, Coolify manual deploy) | NOT verifiable from the repo — confirm with Kevin or the Firebase/Coolify consoles; treat the 2026-07-06 statements here as the last known state |
