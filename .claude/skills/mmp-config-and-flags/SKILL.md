---
name: mmp-config-and-flags
description: "Use when you need to find, read, change, or add ANY configuration in march-melee-pools: env vars (VITE_*, .env, .env.e2e, functions secrets), feature flags (poolTypeFlags, maintenanceMode, POOLS_OPEN), kill-switches and dry-run flags (autoClose.enabled/dryRun), billing config docs (settings/billing_config vs config/billing_config split-brain), App Check / reCAPTCHA setup, Firestore composite indexes, or Coolify build args. Symptoms that should load this: 'where does this flag live', 'why is pool creation blocked', 'maintenance mode', 'is autoClosePools safe/enabled', 'add a feature flag', 'gracePeriodDays not taking effect', 'missing index error', 'App Check token missing', 'which secrets do functions use', 'what env vars does the build need'."
---

# mmp-config-and-flags — every configuration axis of March Melee Pools

Repo root: `D:\march-melee-pools`. Firebase project: `gridiron-gamble-uzuqo`.
All facts verified against the repo on 2026-07-06 (branch `fix/superadmin-phase0-control`).
This is the fastest-drifting skill in the library — re-run the Provenance commands
(bottom) before trusting any table if the repo has moved.

SECURITY RULE FOR THIS SKILL: env var and secret NAMES only. Never print, echo,
cat, or paste values of anything in `.env*` files or Secret Manager. When you
must inspect an env file, redact values first, e.g.:
`Get-Content .env | ForEach-Object { $_ -replace '=.*', '=<redacted>' }`

## 0. The five configuration planes (mental model)

| Plane | Lives in | Changed by | Takes effect |
|---|---|---|---|
| 1. Client build-time env | `.env` / `.env.e2e` locally; Coolify build args for prod www | Edit file / Coolify dashboard | Next build only (values are BAKED into the JS bundle) |
| 2. Functions runtime secrets | Google Secret Manager (`defineSecret`) | `npx firebase functions:secrets:set NAME` | Next function deploy |
| 3. Firestore flag docs | `system/config`, `settings/*`, `config/*` docs | SuperAdmin UI / callables / console | Immediately, no deploy |
| 4. Client compile-time constants | `src/config/season.ts`, `src/version.ts`, `src/seoConfig.ts` | Code edit + redeploy of the frontend | Next build |
| 5. Firestore composite indexes | `firestore.indexes.json` | `npx firebase deploy --only firestore:indexes` | Minutes after deploy (index build) |

Key trap: planes 1 and 4 require a MANUAL Coolify deploy by the owner to reach
prod www (pushing to `main` does NOT deploy the frontend; see
mmp-deploy-and-operate). Plane 3 is live instantly — which is why all
kill-switches live there.

## 1. Environment variables (NAMES ONLY — never print values)

### 1.1 Root `.env` (gitignored; local dev + local `deploy:hosting` builds)

| Name | Consumed by | Notes |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | `src/firebase.ts:8` | Firebase web config (not a secret in the classic sense, but treat as one) |
| `VITE_FIREBASE_AUTH_DOMAIN` | `src/firebase.ts:9` | |
| `VITE_FIREBASE_PROJECT_ID` | `src/firebase.ts:10` | |
| `VITE_FIREBASE_STORAGE_BUCKET` | `src/firebase.ts:11` | |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `src/firebase.ts:12` | |
| `VITE_FIREBASE_APP_ID` | `src/firebase.ts:13` | |
| `GEMINI_API_KEY` | `.agent/skills/front-end-skill` (nano-banana image-gen agent skill) — NOT the app | **CORRECTED 2026-08-23: the `.env` comment was RIGHT and the owner denial wrong** — `git show 3340fff0^:.env | grep -c VITE_API_KEY` (count-only — never reprint the value) in the public repo shows `VITE_API_KEY` (a Gemini key), exposed since 2025-12-13. Rotation is Kevin's owed action (HANDOFF). |

Referenced in `src/` but NOT present in `.env` (as of 2026-07-06):

| Name | Consumed by | Notes |
|---|---|---|
| `VITE_RECAPTCHA_SITE_KEY` | `src/firebase.ts:24` | ⛔ **Absent ON PURPOSE — setting it took prod down 2026-07-30.** App Check is then silently not initialized and prod logs a console warning (`src/firebase.ts:30-32`); that warning is the SAFE state. See §1.4 and §5. |
| ~~`VITE_API_KEY`~~ | **nothing — zero readers** | ⛔ **GONE. Do not reintroduce it, in `.env`, in the Dockerfile, or in Coolify.** It was a Gemini key. `grep -rn VITE_API_KEY src/` returns **nothing**, and the Dockerfile declares no `ARG` for it — `Dockerfile:13-14` records the removal and the reason: the only client reader was dead code, and a Gemini key must never ship in a public bundle, where anyone can read it out of the JS. This row previously named `src/components/AdminPanel.tsx:222` as its consumer and called it a live build arg; both were stale, and §1.4 additionally told operators to sync it into Coolify. All three corrected 2026-07-30. |
| `VITE_USE_FIREBASE_EMULATOR` | `src/firebase.ts:41` | e2e only; set in `.env.e2e`, never in `.env`/prod |

Vite built-ins also used: `import.meta.env.DEV` (`src/firebase.ts`,
`src/utils/logger.ts`, `src/components/ErrorBoundary.tsx`).

### 1.2 `.env.e2e` (Playwright harness; `vite --mode e2e`)

Same six `VITE_FIREBASE_*` names (placeholder values — emulators don't validate
them; projectId must match the emulator `--project demo-mmp`) plus
`VITE_USE_FIREBASE_EMULATOR`. No `GEMINI_API_KEY`. Details of the e2e harness:
mmp-validation-and-qa and mmp-build-and-env.

### 1.3 `functions/.env`

Contains NO active (uncommented) variables as of 2026-07-06 — but the two
COMMENTED-OUT lines still hold the plaintext Stripe TEST key and webhook secret
(`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, since moved to Secret Manager).
Deleting those lines and rotating both in the Stripe dashboard is the PENDING
rotation task (§2, PHASE0-DEPLOY-CHECKLIST Step 5) — do NOT treat their presence
as a new regression, and do NOT treat "no active variables" as the rotation
being done. Once rotated and deleted, finding NEW uncommented values here =
regression; flag it.

### 1.4 Coolify build args (prod www frontend)

⚠️ **CORRECTED 2026-07-30 — this section said SEVEN build args including
`VITE_API_KEY`. It is SIX, and `VITE_API_KEY` is gone.** The tracked Dockerfile
declares `ARG` at `:15-20` and mirrors to `ENV` at `:22-27`, and every one is a
`VITE_FIREBASE_*` name. `Dockerfile:13-14` is now a comment recording that
`VITE_API_KEY` (a Gemini key) was **removed** because its only client reader was
dead code and a Gemini key must never ship in a public bundle. Re-read
`Dockerfile:15-27` rather than trusting this paragraph; it was stale for weeks
and the staleness mattered (see below).

Coolify holds ITS OWN copies of these values in the dashboard — they are NOT
read from the repo `.env`. Changing `.env` locally does nothing for prod www;
sync Coolify build args manually, then trigger a manual Coolify deploy.

**A build arg is the ONLY way a `VITE_*` value reaches the bundle.** Vite inlines
`import.meta.env.X` at build time, `.dockerignore` excludes `.env`, and
`Dockerfile:30` runs `npm run build:static` inside the build stage. A Coolify
variable with no matching `ARG` line is invisible to the build, and a *runtime*
variable cannot change an already-built static bundle at all. Check this before
believing any story about a `VITE_*` value taking effect in prod.

✅ **ANSWERED 2026-07-30, the hard way. The old open question asked how the prod
bundle obtains the reCAPTCHA site key. It does not obtain it, and that is
correct.** `VITE_RECAPTCHA_SITE_KEY` is absent from the Coolify environment on
purpose. Someone SET it, Coolify rebuilt, and **production went down** — blank
page, permanent spinner, confirmed from two independent machines and networks —
until the variable was deleted and the site redeployed. ⛔ **Do not set it. Do
not re-open this as a question to resolve by experiment.**

The old question's premise was also wrong: App Check is **not** enforced.
`functions/src/lib/validated.ts:94-97` defaults every callable to `"monitor"`
and only sets `enforceAppCheck` for `"enforce"`, and there are **98 `monitor`
declarations and zero `enforce`** across `functions/src`. Firestore is plainly
not enforcing either — an enforcing Firestore with no registered app would
reject every read, and the site works. The 2026-07-06 "ENFORCED in the console"
owner attestation is **superseded and UNVERIFIED**; the incident report says the
web app was never registered in the console's App Check section at all.

⚠️ **The set→dead, delete→alive correlation is solid; the CAUSAL STORY is not.**
The first write-up blamed CSP blocking the reCAPTCHA script, but the build-arg
paragraph above rules that out on the tracked Dockerfile — the key has no known
path into the bundle, so the branch it was supposed to flip cannot have flipped.
**WHY the site died is an OPEN QUESTION**, and an unexplained way to kill prod is
worse than an understood one. Four faults block re-enabling regardless (CSP
hosts, Enterprise-vs-v3 key, app never registered, no Dockerfile `ARG`):
HANDOFF's STOP POINT box. It is not pilot work.

⛔ **A note that used to sit here said to include `VITE_API_KEY` when syncing
Coolify build args "or the AdminPanel feature that reads it silently breaks".
DELETED 2026-07-30 — following it would have put a Gemini key into the public
JS bundle for no benefit.** There is no such feature: `grep -rn VITE_API_KEY src/`
returns nothing, and the Dockerfile declares no `ARG` for it. Six build args, all
`VITE_FIREBASE_*`. Server-side AI uses Secret Manager.

## 2. Functions runtime secrets (Google Secret Manager)

Inventory of every `defineSecret` in `functions/src` (verified by grep, 2026-07-06):

| Secret name | Defined at | Bound to / used by |
|---|---|---|
| `STRIPE_SECRET_KEY` | `functions/src/stripe.ts:19` | `createCheckoutSession`, `handleStripeWebhook` |
| `STRIPE_WEBHOOK_SECRET` | `functions/src/stripe.ts:20` | `handleStripeWebhook` signature verification |
| `GEMINI_API_KEY` | `functions/src/gemini.ts:5` | AI commissioner + admin Test Suite functions |
| `COURIER_AUTH_TOKEN` | `functions/src/notifications/smsService.ts:3` | SMS alerts (`sendSecuritySMSAlert`, `testSmsHttp`) |

`process.env` usage in deployed code is limited to the platform-provided
`GCLOUD_PROJECT` (`functions/src/emailPrefs.ts:63`). Everything else is
Secret Manager. Set/rotate with:
`npx firebase functions:secrets:set STRIPE_SECRET_KEY --project gridiron-gamble-uzuqo`
then redeploy the functions that bind it (deploy ritual: mmp-deploy-and-operate).

Status as of 2026-07-06: Stripe TEST secret rotation is PENDING (owner ground
truth) — still to do.

DANGEROUS IMPLICIT SWITCH: if `STRIPE_SECRET_KEY` is unset or a placeholder,
`createCheckoutSession` activates a MOCK sandbox that grants pools/bundles for
free with no payment (`functions/src/stripe.ts:152-207, 372-414`). A broken
secret binding in prod silently turns off billing. Money scope reminder: Stripe
handles commissioner hosting fees ONLY; participant entry fees are P2P honor
system and the platform never touches them. Never propose otherwise.

## 3. Server feature gates (Firestore `system/config` doc)

The single runtime flag doc is `system/config` (collection `system`, doc
`config`). Rules: world-readable, SUPER_ADMIN-writable (`firestore.rules`
`system` block). Toggled from SuperAdmin > System tab via
`settingsService.update()` (`src/services/settingsService.ts:56-64`).

Schema (client type `SystemSettings`, `src/types/index.ts:913-924`; server type
`FlagConfig`, `functions/src/lib/featureFlags.ts:43-45`):

| Field | Type / default | Semantics |
|---|---|---|
| `maintenanceMode` | bool, default false | ON blocks pool creation AND (where wired) state-changing callables, server-side |
| `poolTypeFlags` | map of 7 pool types → bool; missing = fail-open TRUE | Per-type creation gate: SQUARES, BRACKET, NFL_PLAYOFFS, PROPS, NFL_PICKEM, NFL_SURVIVOR, NFL_MARGIN |
| `autoClose` | `{enabled?: bool, dryRun?: bool}` | Kill-switch + dry-run for the daily close sweep — see §4 |
| `currentSeason` | number (2026 default) | Season selector |
| `propCategories`, `loyaltyTiers` | arrays | Content config, not gates |
| `enableBracketPools` | bool | LEGACY DEAD FLAG, superseded by poolTypeFlags (comment at `settingsService.ts:9`) — do not wire new logic to it |

Server enforcement (`functions/src/lib/systemGuards.ts` — reads `system/config`
per call, FAIL-OPEN on read error by design):

| Guard | Rejects when | Verified call sites |
|---|---|---|
| `assertPoolCreationAllowed(type)` | maintenanceMode ON, or `poolTypeFlags[type] === false` | `bracketPools.ts:38` (createBracketPool), `nflPools.ts:57` (createNFLPool), `poolOps.ts:71` (createPool, `data.type || 'SQUARES'`) |
| `assertNotMaintenance()` | maintenanceMode ON | `nflPools.ts:135` (joinNFLPool) — the ONLY non-creation call site as of 2026-07-06; other join/submit callables are NOT maintenance-gated |
| `assertNotBannedLive(uid)` | Firestore `users/{uid}.role` is BANNED | participation callables (reads live doc role so a ban bites on the next call) |

Client mirrors (UX only — "client gate is UX only; server guard is
authoritative", `src/hooks/useFeatureFlags.ts`): `useFeatureFlags`,
`PoolTypeGate` (`src/components/PoolTypeGate.tsx`),
`src/utils/featureFlags.ts`. Client/server predicate parity is CI-tested by
`tests/feature-flags-parity.test.ts` — if you change one side, the test forces
the other.

### 3.1 `POOLS_OPEN` — the pre-season creation gate (KNOWN-WEAK POINT)

`src/config/season.ts:2` → `export const POOLS_OPEN = false;` (as of
2026-07-06). Consumed only by `src/utils/auth.ts`:
`canAccessPoolCreation(user) = POOLS_OPEN || isSuperAdmin(user)` — gates all
`/create/*` routes in `App.tsx`.

Three properties to keep straight:
1. It is a COMPILE-TIME constant, not a Firestore flag. Flipping it requires a
   code change + frontend build + manual Coolify deploy.
2. It is CLIENT-ONLY. No server code reads it. A non-superadmin who invokes
   `createNFLPool`/`createPool` directly would pass server checks as long as
   `poolTypeFlags` are enabled (their fail-open default is all-true). The
   real server-side pre-season closure, if desired, is setting
   `poolTypeFlags.<TYPE>: false` in `system/config` — verify prod values in
   the SuperAdmin System tab; they are runtime data, not in the repo.
3. e2e tests work around it by promoting the test user (see
   `tests/e2e/helpers.ts:33-34`).

### 3.2 Rules-level config gates (see mmp-architecture-contract for full rules model)

- `settings/*` docs: readable by all, SUPER_ADMIN-writable EXCEPT
  `settings/billing_config` and `settings/referral_config` which are
  server-only (`firestore.rules:366-372`) — money config must go through the
  `adminSaveBillingConfig` callable.
- `config/internal`: holds the unsubscribe HMAC key
  (`functions/src/emailPrefs.ts:34`) — server-only, excluded from the
  otherwise-readable `config` collection.
- `config/playoffs`: playoff global config; writing it fires
  `onPlayoffConfigUpdate` which syncs to ALL playoff pools
  (`functions/src/playoffPools.ts:446-490`) — a config write with fan-out
  side effects; treat edits as prod-data mutations (mmp-change-control).
- Pool create via client SDK: only `sim-*` slugs by SUPER_ADMIN
  (`firestore.rules:93`) — Test Suite backdoor, Phase 2 removal planned.

## 4. Kill-switches and dry-run flags

### 4.1 `autoClosePools` (the reference pattern — copy it for any new prod-data sweep)

File: `functions/src/autoClosePools.ts`. Daily scheduler (`every day 08:00`,
UTC — no timeZone set). Flags live in the `system/config` doc under `autoClose`:

| Flag | Location | Default / fail-safe | Verified at |
|---|---|---|---|
| Kill-switch | `system/config` field `autoClose.enabled` | Job no-ops unless `=== true`; a config read ERROR also means disabled | `autoClosePools.ts:32-47` |
| Dry-run | `system/config` field `autoClose.dryRun` | Dry-run unless EXPLICITLY `false` (`dryRun !== false`) | `autoClosePools.ts:33,39,59` |

Behavior: dry-run writes one `admin_audit` entry (`action:
"AUTO_CLOSE_SWEEP"`, `metadata.dryRun: true`, `wouldClose` count + 10-id
sample) and closes nothing. Live run closes via the shared `adminCloseUpdate`
(no member emails, no stats deltas), capped at `MAX_PER_RUN = 200` per day,
and audits the same action with `dryRun: false`.

STATUS as of 2026-07-06 (owner ground truth): LIVE past dry-run in prod —
`autoClose.enabled: true, dryRun: false`; it actually closes pools daily.
The repo default (`settingsService.ts:23`) is still `{enabled:false,
dryRun:true}` — the repo default is NOT the prod state. To verify prod state,
read the `system/config` doc (SuperAdmin System tab) or check the latest
`AUTO_CLOSE_SWEEP` entries in the admin audit log (mmp-diagnostics-and-tooling).
Emergency stop: set `autoClose.enabled: false` in `system/config` — effective
before the next 08:00 UTC run, no deploy needed.

### 4.2 Everything else — mostly NO kill-switch (know this before you panic or deploy)

| Job / path | Kill-switch? | Dry-run? | Notes |
|---|---|---|---|
| `autoLockPools` (every 1 min, `autoLock.ts:41`) | NONE global | No | Driven per-pool: SQUARES via `reminders.lock.enabled` + `reminders.lock.lockAt`; BRACKET via `type/status/lockAt`. To stop a single pool locking, clear its lockAt/flag. To stop the job globally you must delete/disable the function itself. |
| `syncGameStatus`, `syncNFLScoresJob`, `scheduledBracketSync`, `checkPlayoffScores`, `runReminders`, `enforceBillingStatus`, `aggregateRevenueDaily`, `scheduledHealthCheck` | NONE | No | Score/comms/billing schedulers run unconditionally. Pause = Cloud Scheduler console or function delete. |
| `backfillPools` (callable, SUPER_ADMIN) | Caller-gated only | NO dry-run, NOT idempotent (double-counts stats on re-run) | Violates discipline rule (a); do not run casually — see mmp-change-control before touching. |
| Stripe mock sandbox | Implicit: presence of `STRIPE_SECRET_KEY` | n/a | See §2 — absence of the secret IS the switch. |
| `logClientError` | `enforceAppCheck: false` (`logClientError.ts:35`) | n/a | Function-level App Check enforcement is OFF with a TODO. ⚠️ **This row used to add "console-level enforcement is the active layer" — CORRECTED 2026-07-30: there is no active layer.** 98 `validated()` callables are `monitor`, zero `enforce`, 26 bare `onCall` sites carry no option, and the client never initializes App Check in prod. Do NOT flip this TODO; see §1.4. |

Non-negotiable discipline rule (canonical home: mmp-change-control): NO new
prod-data-mutating job or sweep ships without (1) a `system/config`-style
kill-switch defaulting OFF, (2) dry-run defaulting ON, (3) verified dry-run
audit output reviewed BEFORE enabling. `autoClosePools` is the template.

## 5. Client config (plane 4) + App Check

- `src/config/` contains exactly one file: `season.ts` (`POOLS_OPEN`, §3.1).
- `src/version.ts`: single export `BUILD_TIMESTAMP = '2026-01-12-APP-REFACTOR-FIX'`
  — a manual build marker. It is NOT auto-bumped; a stale value on prod tells
  you when www was last meaningfully rebuilt only if someone updated it.
- `src/seoConfig.ts`: central per-route SEO metadata; exports
  `SITE_URL = 'https://www.marchmeleepools.com'` and `DEFAULT_OG_IMAGE`.
  Consumed by `<RouteSEO/>` and the build-time prerender
  (`scripts/prerender.ts` via `npm run build:static`). Social crawlers don't
  run JS — previews depend on prerender + the nginx bot-proxy (deploy detail:
  mmp-deploy-and-operate).
- App Check (`src/firebase.ts:18-32`): initialized with
  `ReCaptchaEnterpriseProvider(VITE_RECAPTCHA_SITE_KEY)` ONLY if the env var is
  present at build time; dev mode sets `FIREBASE_APPCHECK_DEBUG_TOKEN = true`.
  ⛔ **The env var is deliberately absent in prod and MUST STAY absent.** Setting
  it on 2026-07-30 was followed by the site rendering nothing; deleting the
  variable and redeploying restored it. ⚠️ **That is the OBSERVATION. The
  MECHANISM is unproven** — the first write-up blamed CSP blocking the reCAPTCHA
  script (token never resolves → Firestore SDK waits on it → goes offline), but
  §1.4 shows the tracked Dockerfile has no build `ARG` for this key, so it has no
  known path into the bundle. Root cause is OPEN. Do not chase the CSP story
  during a live incident without first confirming the CSP refusal is actually in
  the browser console.
  **The reverse of the old advice here is the true one:** before any frontend
  build you intend to ship, confirm the key does **not** reach the build.
  App Check is enforced NOWHERE — 98 `monitor` declarations, zero `enforce`
  (`functions/src/lib/validated.ts:94-97`) — so a bundle without the key costs
  nothing. The 2026-07-06 "ENFORCED in the console" attestation is superseded
  and UNVERIFIED; see §1.4.
- Firestore client cache: persistent multi-tab in prod, in-memory under
  `VITE_USE_FIREBASE_EMULATOR` (`src/firebase.ts:41-46`) — a config-driven
  behavioral fork that matters for e2e determinism (mmp-validation-and-qa).

## 6. Composite indexes (`firestore.indexes.json`) → the queries they serve

9 composite indexes, 0 fieldOverrides (verified 2026-07-06):

| # | Collection (scope) | Fields | Serves (verified consumer) |
|---|---|---|---|
| 1 | `admin_audit` | actorUid ASC, at DESC | No current code query found — the only audit read is `dbService.ts:732` (plain `orderBy(at desc)`, single-field). UNVERIFIED consumer; likely provisioned for filtered audit views. Do not delete without checking the console's index-usage stats. |
| 2 | `admin_audit` | action ASC, at DESC | Same as #1 — UNVERIFIED consumer. |
| 3 | `pools` | type ASC, tournamentId ASC | `TournamentManager.tsx:219-221` (pools of a tournament by type) |
| 4 | `pools` | scores.gameStatus ASC, updatedAt ASC | `scoreUpdates.ts:1108-1111` (`syncGameStatus` recently-completed-pools query: gameStatus == post AND updatedAt >= cutoff) |
| 5 | `pools` | status ASC, createdAt DESC | No current code query found — UNVERIFIED consumer (admin pool lists are unfiltered `limit(CAP)` snapshots in `dbService.ts:642`). |
| 6 | `entries` (COLLECTION_GROUP) | ownerUid ASC, score DESC | No `collectionGroup(` call exists anywhere in current code — UNVERIFIED consumer (historical or planned cross-pool leaderboard). |
| 7 | `entries` (COLLECTION_GROUP) | paidStatus ASC, ownerName ASC | Same as #6 — UNVERIFIED consumer. |
| 8 | `themes` | isActive ASC, name ASC | `dbService.ts:931` (active themes ordered by name) |
| 9 | `nfl_games` | season ASC, startTime ASC | `nflSchedule.ts:226-228` (`syncNFLScoresJob`: season == X AND startTime range); also the never-deployed `lockNFLSpreadsJob` query at `nflSchedule.ts:309-311` |
| 10 | `pools` | type ASC, status ASC, lockAt ASC | `autoLock.ts:56-60` (BRACKET pools due to lock: type == BRACKET, status in [DRAFT,OPEN], lockAt <= now+30s) |

(The file lists them in the order shown; #10 is the last entry.) If a new
query throws `FAILED_PRECONDITION: The query requires an index`, add the index
to `firestore.indexes.json` (never only click the console link — the console
creates it out-of-band and the repo drifts), then
`npx firebase deploy --only firestore:indexes --project gridiron-gamble-uzuqo`.

## 7. Billing config SPLIT-BRAIN (open known-weak point, as of 2026-07-06)

Two different Firestore docs both named `billing_config`, in different
collections, read by different money code:

| Code | Reads/Writes | Doc | Verified at |
|---|---|---|---|
| `createCheckoutSession` (authoritative server price) | READ | `settings/billing_config` | `stripe.ts:91`, also `:172`, `:548` |
| `handleStripeWebhook` | READ | `settings/billing_config` | `stripe.ts:548` |
| `adminSaveBillingConfig` (the ONLY sanctioned writer) | WRITE | `settings/billing_config` | `adminBillingOps.ts:32-33` |
| Client billing UIs (PricingPage, BillingInvoiceCard, SuperAdminBillingPanel) | READ | `settings/billing_config` | `PricingPage.tsx:123`, `BillingInvoiceCard.tsx:177`, `SuperAdminBillingPanel.tsx:131` |
| `enforceBillingStatus` (daily trial→grace→locked job) | READ | `config/billing_config` — THE ODD ONE OUT | `billing.ts:40` |
| Referral config (for contrast — consistent) | R/W | `settings/referral_config` | `referral.ts:41`, `adminBillingOps.ts:32`, `ReferralSharePanel.tsx:51` |

Consequence: `gracePeriodDays` edited through the SuperAdmin billing panel
lands in `settings/billing_config` and is IGNORED by `enforceBillingStatus`,
which reads `config/billing_config` and falls back to its hardcoded default
(7 days, `billing.ts:42`) unless someone maintains that second doc by hand.
Everything else in billing config (pricing tiers, packages, coupons) is
unaffected because only `enforceBillingStatus` reads the `config/` copy.

Status: OPEN. The likely fix (point `billing.ts:40` at
`settings/billing_config`) is a one-line prod-behavior change to a money job —
classify and gate it via mmp-change-control; verify with a before/after read
of the doc each side sees. Until fixed: if you need a non-default grace
period, write it to BOTH docs and say so in the audit trail.

## 8. "Add a new flag" checklist

Decide the plane first: if the flag must change prod behavior WITHOUT a
deploy (kill-switch, ops toggle, seasonal gate), it belongs in `system/config`
(plane 3). Compile-time constants like `POOLS_OPEN` are for things that should
be impossible to toggle accidentally at runtime. Never add a new top-level
Firestore config doc — extend `system/config` (avoid growing the
settings/config split-brain zoo of §7).

For a `system/config` runtime flag:
1. Classify the change with mmp-change-control FIRST. If the flag enables
   anything that mutates prod data, discipline rule (a) applies: the flag
   set must be kill-switch (`enabled`, default OFF) + dry-run (`dryRun`,
   default ON — pattern `dryRun !== false`), and you verify dry-run audit
   output before enabling. Copy `autoClosePools.ts:31-47` verbatim as the
   read pattern (fail-safe: read error → disabled).
2. Server: add the field to `FlagConfig` (`functions/src/lib/featureFlags.ts`)
   and a pure predicate there; wire enforcement via
   `functions/src/lib/systemGuards.ts` (or a direct doc read for schedulers).
   Server is the authoritative gate — never client-only for anything that
   matters (learn from `POOLS_OPEN`, §3.1).
3. Client: add the field to `SystemSettings` (`src/types/index.ts:913`) and
   the default to `DEFAULT_SETTINGS` (`src/services/settingsService.ts:8`);
   surface the toggle in SuperAdmin > System tab; consume via
   `useFeatureFlags` if it's a gate. Decide fail-open vs fail-closed
   EXPLICITLY and make client and server agree.
4. Parity: extend `tests/feature-flags-parity.test.ts` so client and server
   predicates are locked together.
5. Audit: any toggle that changes prod behavior should be visible — either
   the SuperAdmin toggle path already writes through rules-gated
   `settingsService.update`, or (for money/destructive flags) route through
   a callable that writes `admin_audit` like `adminSaveBillingConfig`.
6. Document the flag in this skill's tables (env var → §1, secret → §2,
   `system/config` field → §3/§4) and date-stamp it.
7. Deploy per ritual (mmp-deploy-and-operate): `npm --prefix functions ci`,
   `npx firebase deploy --only functions ... --project gridiron-gamble-uzuqo`,
   functions BEFORE rules; frontend changes additionally need the manual
   Coolify deploy.

For a new functions secret: `defineSecret("NAME")` in the module, bind it in
the function options, `npx firebase functions:secrets:set NAME`, deploy, then
add the name (only) to §2.

## 9. When NOT to use this skill

- How to DEPLOY a config change / Coolify mechanics / scheduled-job ops →
  mmp-deploy-and-operate.
- Classifying whether a change needs a plan/review/dry-run gate →
  mmp-change-control (canonical home of the four discipline rules).
- Recreating a dev environment, emulators, `.env` bootstrapping →
  mmp-build-and-env.
- Debugging a symptom that might be config ("payments free?!", "index
  error", "App Check rejections") → start at mmp-debugging-playbook, which
  routes back here for the flag locations.
- Firestore RULES semantics and the security model → mmp-architecture-contract.
- Reading prod flag VALUES / health / audit logs → mmp-diagnostics-and-tooling
  and the SuperAdmin surface (mmp-superadmin-surface).
- Pool scoring/lifecycle semantics behind the flags → mmp-pools-domain-reference.

## 10. Provenance and maintenance

Every table above drifts. Re-verify from repo root `D:\march-melee-pools`
(PowerShell) before relying on it:

- Env var names (values redacted — keep it that way):
  `Get-Content .env, .env.e2e, functions\.env | ForEach-Object { $_ -replace '=.*', '=<redacted>' }`
- Env vars the client code actually reads:
  `Get-ChildItem src -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'import\.meta\.env\.[A-Z_]+' | Select-Object -Unique Line`
- Coolify/Dockerfile build args:
  `Select-String -Path Dockerfile -Pattern '^(ARG|ENV) '`
- Functions secrets inventory:
  `Get-ChildItem functions\src -Recurse -Filter *.ts | Select-String -Pattern 'defineSecret\(|process\.env\.'`
- Server gates + call sites:
  `Get-ChildItem functions\src -Recurse -Filter *.ts | Select-String -Pattern 'assertPoolCreationAllowed|assertNotMaintenance|assertNotBannedLive'`
- `system/config` schema + defaults:
  `Get-Content src\services\settingsService.ts -TotalCount 25; Select-String -Path src\types\index.ts -Pattern 'SystemSettings' -Context 0,12`
- autoClose kill-switch/dry-run wiring:
  `Select-String -Path functions\src\autoClosePools.ts -Pattern 'enabled|dryRun|MAX_PER_RUN'`
- autoClose PROD state (runtime, not in repo): read `system/config` in the
  SuperAdmin System tab, or check recent `AUTO_CLOSE_SWEEP` rows in the admin
  audit log for `dryRun: false`.
- POOLS_OPEN:
  `Get-Content src\config\season.ts`
- Billing split-brain (should show billing.ts as the only `config/` reader;
  if that changes, update §7):
  `Get-ChildItem functions\src, src -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'billing_config|referral_config'`
- Composite indexes:
  `Get-Content firestore.indexes.json`
- Index consumers (spot-check the UNVERIFIED rows):
  `Get-ChildItem src, functions\src -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'collectionGroup|scores\.gameStatus|where\(.startTime'`
- App Check init:
  `Select-String -Path src\firebase.ts -Pattern 'AppCheck|RECAPTCHA' ; Get-ChildItem functions\src -Recurse -Filter *.ts | Select-String -Pattern 'enforceAppCheck'`
- Deployed secrets in the cloud (names only):
  `npx firebase functions:secrets:list --project gridiron-gamble-uzuqo` (UNVERIFIED command output — cross-check against §2; requires auth)

Date-stamped volatile facts to re-confirm on next major session:
autoClosePools LIVE (2026-07-06), Stripe TEST secret rotation PENDING
(2026-07-06), `POOLS_OPEN = false` (2026-07-06), and the §7 split-brain still
open. **Two entries were RESOLVED on 2026-07-30 and are no longer volatile:**
the §1.4 reCAPTCHA-key-in-Coolify open question (answered — the key is absent on
purpose and setting it takes prod down), and "App Check ENFORCED in console"
(superseded and UNVERIFIED — 98 `validated()` callables are `monitor`, zero `enforce`, plus 26 bare `onCall` sites with no App Check option).
