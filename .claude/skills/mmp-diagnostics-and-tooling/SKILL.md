---
name: mmp-diagnostics-and-tooling
description: >-
  Use when you need to MEASURE the live state of March Melee Pools / Gridiron Gamble (Firebase project gridiron-gamble-uzuqo) instead of guessing — reading Cloud Function logs (npx firebase functions:log), interpreting the adminHealth / API Status Center snapshot (health/latest), running or cleaning up after the in-app SuperAdmin Test Suite, querying the admin_audit / pools/{id}/audit / users/{uid}/activity trails to reconstruct "what happened", counting stuck-open pools / pools missing billing / leftover sim- and "AI Test" pools with the read-only firestore-census script, or tracing where client-side errors land (logClientError -> system_logs). Symptoms/verbs in hand: "is the score sync running", "did autoClosePools actually close anything", "check the logs", "is ESPN down", "who changed this user's role", "how many test pools are polluting prod", "where do client errors go", "is email delivery healthy", "health check failing", "run the Test Suite", "clean up test pools".
---

# MMP Diagnostics and Tooling — measure, don't eyeball

Read-only observation of the production system: what the instruments are, how to read
them, and what each reading means. Everything here is verified against the repo at
`D:\march-melee-pools` as of 2026-07-06. Nothing in this skill mutates prod data; if a
diagnosis leads to a fix, load `mmp-change-control` before changing anything.

Jargon used once, defined once:

| Term | Meaning |
|---|---|
| prod project | Firebase project `gridiron-gamble-uzuqo` (there is NO `.firebaserc` in the repo — always pass `--project gridiron-gamble-uzuqo`) |
| callable | Firebase `onCall` Cloud Function invoked via `httpsCallable` from the client |
| SUPER_ADMIN | Custom-claim role `request.auth.token.role === 'SUPER_ADMIN'`; gates all admin surfaces |
| Test Suite | The SuperAdmin dashboard tab (`activeTab === 'testing'` in `src/components/SuperAdmin.tsx`) holding scenario tests + simulators |
| sim- pool | Pool doc created client-side with a slug matching `^sim-.*` — the only client-side pool create firestore.rules allows (SUPER_ADMIN only, `firestore.rules:93`) |
| heartbeat doc | A Firestore doc a scheduled job rewrites each cycle so freshness can be checked without reading logs |

Prerequisite for every command below: run from repo root `D:\march-melee-pools`, use
`npx firebase` (never a global CLI), and `npm --prefix functions install` first if
functions/node_modules is missing (see `mmp-deploy-and-operate` for the full ritual).

---

## 1. Cloud Function logs

Command (verified against firebase-tools ^15.7.0, the repo devDependency):

```powershell
# Last 100 lines across all functions
npx firebase functions:log --project gridiron-gamble-uzuqo -n 100

# One or more specific functions
npx firebase functions:log --project gridiron-gamble-uzuqo --only autoClosePools -n 50
npx firebase functions:log --project gridiron-gamble-uzuqo --only syncGameStatus,autoLockPools -n 200

# Open the Cloud Console logs page in a browser (for filtering/tailing UI)
npx firebase functions:log --project gridiron-gamble-uzuqo --open
```

The CLI has exactly three options: `--only <names>`, `-n/--lines <num>`, `--open`.
There is NO tail/follow flag — for live tailing use `--open` (Cloud Console Logs
Explorer) or re-run with `-n`. All functions deploy to us-central1 (no `region:`
options anywhere in `functions/src`).

### Healthy vs sick, per key function (log strings verified in source)

| Function (schedule) | Healthy log lines | Sick signals | Where to look next |
|---|---|---|---|
| `autoClosePools` (daily 08:00 UTC) | `[autoClosePools] disabled (...)` while kill-switch off; `DRY-RUN: would close N pool(s)` in dry-run; `closed X/Y pool(s)` live | `failed to close <id>`; live-run closing far more than expected; NOTE: LIVE (actually closing) as of 2026-07-06 | `admin_audit` action `AUTO_CLOSE_SWEEP` has the count + 10-pool sample every run (§4) |
| `syncGameStatus` (every 1 min) | `[Sync] Processing N pools (...)` or `[Sync] No active or recently completed pools found` | `[Sync] Failed to write system/scoreSync status doc`; repeated ESPN fetch errors; heartbeat `system/scoreSync` older than a few minutes during a live game | heartbeat doc `system/scoreSync` `{lastSyncAt, status: 'ok'|'error', detail?}` (`functions/src/scoreUpdates.ts:1065-1079`) |
| `autoLockPools` (every 1 min) | `[AutoLock] Starting auto-lock check`, `Found N ... pools ready to lock`, `SUCCESSFULLY LOCKED: <id>`, `Completed auto-lock check` | `[AutoLock] Critical error:`, `Failed to lock pool <id>` | pool doc `lockAt` vs now; `mmp-debugging-playbook` for lock failures |
| `runReminders` (every 15 min; was 5 min until #265, 2026-07-23) | `[runReminders] Starting reminder check`, `Found N pools to check`, `Email queued for <to>` | `Error queuing email`; heartbeat `runReminders` older than ~45 min (3× the 15-min interval — `findStaleJobs` toleranceMultiplier; ~15 min is normal) | `mail` collection + email check in §2 |
| `enforceBillingStatus` (daily 03:00 UTC) | `[BillingEnforce] Starting billing enforcement`, per-pool `trial → grace_period` transitions | `[BillingEnforce] Error transitioning pool`, `Failed to send grace-period email` | `mmp-config-and-flags` for billing config; note the `settings/billing_config` vs `config/billing_config` split-brain |
| `scheduledHealthCheck` (hourly) | (quiet — writes `health/latest`) | `health/latest.updatedAt` older than ~2h | §2 |
| `scoreNFLWeek` (MANUAL callable — still no scheduled NFL scorer as of 2026-07-12; first live NFL season is 2026) | invocation logs on demand | absence of logs during an NFL week means nobody scored it — that is the expected (bad) default | `mmp-nfl-season-campaign` |
| `nflFinalizeSweepJob` (scheduled daily 08:30, deployed — added since 2026-07-06) — NOT a scorer, a backstop finalize sweep for weeks `scoreNFLWeek` already scored | admin_audit entries (dry-run default) | kill-switch OFF/dry-run default per Rule 1; arming is a pending Kevin console item | `mmp-nfl-season-campaign`, nflFinalize.ts:230 |

`lockNFLSpreadsJob` exists in code (`functions/src/nflSchedule.ts:301`) but is STILL NOT
exported from `functions/src/index.ts` (re-verified 2026-07-12) — if you go looking for its logs, there are
none, and that is the finding, not a logging problem.

---

## 2. adminHealth / API Status Center

Source: `functions/src/adminHealth.ts` (deployed to prod as of 2026-07-06).
Two entry points share one probe (`computeAdminHealthSnapshot`):

- `getAdminHealthSnapshot` — callable, SUPER_ADMIN claim required; the "Run Check"
  button on SuperAdmin → Overview.
- `scheduledHealthCheck` — `every 60 minutes`, no auth (scheduler).

Both persist to the single doc **`health/latest`**:

```
health/latest = {
  latest:   HealthSnapshot,          // newest
  history:  HealthSnapshot[<=24],    // rolling ~1 day of hourly points
  updatedAt: <epoch ms>
}
HealthSnapshot = { at: <epoch ms>, checks: {
  espn:      { label: "ESPN NFL API",   ok, latencyMs, detail },  // GET NFL scoreboard, 5s abort; detail "N events"
  firestore: { label: "Firestore",      ok, latencyMs, detail },  // reads system/config
  email:     { label: "Email delivery", ok, latencyMs, detail },  // last 50 /mail docs' delivery.state
  functions: { label: "Cloud Functions",ok, latencyMs, detail }   // always ok:true — "handler responded" (tautological: if the probe ran, functions are up)
}}
```

Rules: `health/{docId}` is `read: if isSuperAdmin(); write: if false` (functions write
via Admin SDK, which bypasses rules) — `firestore.rules:285-288`.

How to read it:
- UI: SuperAdmin → Overview → API Status Center card hydrates from `health/latest`
  (`src/components/SuperAdminBentoDashboard.tsx:67`), shows "Last checked <time>";
  the Run Check button calls the callable and re-persists, so manual runs update history too.
- Console: Firestore → `health` → `latest`.
- Script: `firestore-census.mjs` (§5) prints `health/latest` age + failing checks.

Interpreting the email check (the subtle one): it reads the Trigger-Email extension's
`delivery.state` on the 50 most recent `mail` docs. `ok:false` with detail
`"N delivery errors (last 50)"` = the extension is trying and failing (bad SMTP creds,
rejected recipients). Detail `"N queued, no delivery field (unverified)"` = the
extension isn't stamping docs at all — email pipeline may be dead even though the
check shows ok; treat "unverified" as a yellow flag, and `"N unprocessed >10m"`
(ok:false) as the extension being down.

---

## 3. In-app admin Test Suite (SuperAdmin → Test Suite tab)

Route `/super-admin`, tab id `testing` (`src/components/SuperAdmin.tsx:2728+`). Three
tools live there. All three operate on **live production Firestore** — there is no
sandbox mode.

### 3a. Pre-defined Test Scenarios (`src/components/SimpleTestingDashboard.tsx`)

15 scenarios (verified in `src/utils/testing/scenarios/index.ts:92-108`), grouped by
pool type in the dropdown. Runner: `src/utils/testing/simpleTestRunner.ts` → per-type
simulator → **the real `createPool` callable** (billing-aware) → drives entries/scores
against live engines → code-based assertions (`winnerCount`, `totalPayout`,
`bracketTopScore`, etc.). No AI involved.

| Pool type | Scenarios (count) | What they simulate |
|---|---|---|
| SQUARES (3) | basic-quarters, every-score-wins, partial-fill | grid fill, quarterly + every-score payouts, partial-fill edge cases |
| BRACKET (9) | bracket-basic / fibonacci / custom / max-score / espn / tiebreaker / incomplete / zero-correct / bracket-e2e-full-tournament | every scoring system, tiebreakers, incomplete tournaments, 0-correct entries, full-tournament e2e |
| NFL_PLAYOFFS (2) | playoff-basic, playoff-lifecycle | ranking entries, round results, lifecycle |
| PROPS (1) | props-basic | card purchase, grading, top score |
| NFL_PICKEM / NFL_SURVIVOR / NFL_MARGIN (0) | — | **No scenarios exist.** The optgroups are in `POOL_TYPE_ORDER` but never render (dashboard filters empty groups out). NFL season pools are covered only by vitest unit tests — see `mmp-validation-and-qa`. |

Reading results: each run card shows PASS / FAIL / ERROR + per-assertion lines + the
created Pool ID.
- **PASS** — every assertion held against the real engine output.
- **FAIL** — pool was created and driven, but an assertion mismatched → likely real
  engine/scoring regression. Load `mmp-pools-domain-reference` for the expected math.
- **ERROR** — the run itself broke (callable threw, permission denied, network) →
  infra problem, not a scoring verdict. Check §1 logs for the callable involved.

### 3b. Pool Simulation (`src/components/SimulationDashboard.tsx`)

Modal picker over **existing SQUARES pools only** (`p.type === 'SQUARES'` filter at
line 29 — this is the component whose earlier `!== 'BRACKET'` filter crashed the whole
app in prod; the fix is in place). Buttons write score states directly onto whichever
LIVE pool you select via `dbService.updatePool`. It mutates real pools and has no
teardown. Only point it at a pool you created for the purpose.

### 3c. Tournament Simulator (`/tournament-sim`)

STATUS UPDATE 2026-07-12: the rules exception described below is REMOVED. This
section is kept for historical context on how the simulator worked before the fix —
do not act on the "still open" framing.

(Historical, pre-2026-07-11) Seeds a bracket pool client-side with slug `sim-${Date.now()}` and synthetic entries
(`src/components/TournamentSimulator/TournamentSimulator.tsx:163-164`). Worked only
because of the `firestore.rules:93` exception (`slug.matches('^sim-.*') && isSuperAdmin()`).
That exception is now gone entirely — `firestore.rules:125` reads "NO CREATE via
Client (must use createPool function)." If TournamentSimulator still relies on this
client-side seed path, it is now broken and needs a callable-based replacement (see
`mmp-superadmin-surface` for the audited-callable plan) — verify before assuming the
simulator UI still works as described.

### Teardown story — verified, and it is manual

- Scenario runs do NOT clean up. `cleanupTestResources` / `trackResource` exist in
  `src/utils/testing/simulators/common.ts:131-149`, but the live
  `simpleTestRunner.ts` path never calls them (grep for `cleanup` in that file: zero
  hits). The only wired cleanup UI is in the orphaned `TestingDashboard.tsx` (the
  Gemini variant), which is imported nowhere.
- There is **no `isTestPool` flag**. The only markers are naming conventions:

| Creator | Marker (verified) |
|---|---|
| squares scenarios | pool name `AI Test - <scenario> - <time>` (`squaresSimulator.ts:49`) |
| bracket scenarios | `Bracket Test - <time>` (`bracketSimulator.ts:67`) |
| playoff scenarios | `Playoff Test - <time>` (`playoffSimulator.ts:56`) |
| props scenarios | `Props Test - <time>` (`propsSimulator.ts:56`) |
| bracket e2e | `E2E Full Tournament Test (<scoring>)` (`bracketE2ESimulator.ts:103`) |
| Tournament Simulator | slug `sim-<timestamp>` |

- "Run All (15)" creates 15 real pools per click. They accumulate until someone
  deletes them (SuperAdmin → Pools tab delete, or `dbService.deletePool` per pool —
  rules allow owner/SUPER_ADMIN delete). Use `firestore-census.mjs` (§5) to count the
  current backlog before and after cleanup. Deleting prod pools is a prod-data
  mutation: follow `mmp-change-control` (list first, delete from the reviewed list).

Also deployed but orphaned: `functions/src/aiTesting.ts` callables
(`generateTestScenario` / `validateTestResults` / `generateTestReport`, Gemini-backed,
SUPER_ADMIN-gated) — reachable only by direct callable invocation; no UI imports
`TestingDashboard.tsx`. Treat logs from them as "someone invoked them by hand."

---

## 4. Audit trails as diagnostic data

Three separate trails. Pick by question:

| Question | Trail | Written by | Readable by |
|---|---|---|---|
| "What did admin X do to the platform?" | top-level `admin_audit` | Cloud Functions only (`writeAdminAudit`, `functions/src/lib/adminAudit.ts:61`) | SUPER_ADMIN (rules), in-app viewer |
| "What happened inside pool Y?" | `pools/{poolId}/audit` | Cloud Functions only (`writeAuditEvent`, `functions/src/audit.ts:21`) | pool owner/manager or SUPER_ADMIN |
| "What happened TO user Z?" | `users/{uid}/activity` | Cloud Functions only | **nobody client-side** — no rules match exists for this subcollection, so Firestore default-deny applies; read it via console or Admin SDK only |

### admin_audit schema (verified `lib/adminAudit.ts`)

```
{ actorUid, actorEmail|null, action,            // e.g. ROLE_CHANGED, POOL_CLOSED, AUTO_CLOSE_SWEEP, EMAIL_SENT, PASSWORD_RESET_SENT
  targetType|null, targetId|null,               // "pool" | "user" ...
  metadata: {...},                              // secret keys (/token|password|secret|apikey/i) redacted, strings capped 200 chars, whole map capped 1KB
  status: "success"|"error", error|null (300 chars), at: Timestamp }
```

Caveats when reading it: metadata is capped/redacted (nested objects become
`"[array]"`/`"[object]"` markers), and `writeAdminAudit` never throws — a failed audit
write is only a console warning, so absence of an entry is weak evidence that the
action didn't happen. `logAdminAction` (callable) also feeds this collection with
client-REPORTED entries — trust those less; they are convenience trail, not an authz
boundary (`functions/src/adminOps.ts`).

How to query:
- In-app: SuperAdmin dashboard mounts `AdminAuditViewer`
  (`src/components/admin/AdminAuditViewer.tsx`) — live subscription
  `orderBy('at','desc') limit 100` (`dbService.ts:731-739`). Fastest "who did what recently".
- Console: Firestore → `admin_audit`, sort `at` desc; filter field `action` or
  `actorUid`. Composite filters may prompt for an index — the console offers to
  create one; don't (that's a prod change); filter one field at a time instead.
- Scheduled-job forensics: `autoClosePools` writes one `AUTO_CLOSE_SWEEP` entry per
  enabled run with `{dryRun, wouldClose|closed, sample:[<=10 pool ids]}` — this is the
  primary record of what the sweep did on any given day.

### pools/{poolId}/audit schema (verified `audit.ts`)

```
{ id, poolId, timestamp: <epoch ms>, type, message, severity: INFO|WARNING|CRITICAL,
  actor: { uid, role: SYSTEM|ADMIN|USER|ESPN|GUEST, label? }, payload?, dedupeKey?, createdAt }
```
Deduped events also write `pools/{poolId}/audit_dedupe/{dedupeKey}` — if you see a
dedupe doc without the event you expected, the event was written on an EARLIER run
(dedupe hit logs `[Audit] Dedupe hit for <key>` in function logs).

### users/{uid}/activity (verified writers)

- `POOL_CREATED` `{type, poolId, poolName, poolType, timestamp:<ms>}` — written in the
  shared pool-creation transaction (`functions/src/lib/poolCreation.ts:111`).
- `PASSWORD_RESET_SENT` `{type, at:serverTimestamp, actorUid}` (`userManagement.ts:126`).
- `EMAIL_SENT` `{type, at, actorUid, subject(<=200)}` (`userManagement.ts:299`).
Note the schema drift: POOL_CREATED uses `timestamp` (epoch ms), the admin actions use
`at` (Timestamp). Query both fields when reconstructing a timeline.

### Reconstructing "what happened" — recipe

1. Pin the time window (user report, or §1 log line).
2. `admin_audit` sorted by `at` desc → any admin/system action in the window?
3. If a specific pool: `pools/{id}/audit` sorted by `timestamp` → engine/lock/score
   events with actor roles (ESPN = sync jobs, SYSTEM = schedulers).
4. If a specific user: console → `users/{uid}/activity`.
5. Cross-check function logs (§1) for the same window; `system_logs` (§6) for
   client-side errors from the same user (`uid` field).

---

## 5. Firestore inspection recipes

### The credentials pattern (verified, with a warning)

Existing ops scripts (`functions/scripts/backfillSquarePrivate.mjs` is the model;
`scripts/inspectPool.js`, `scripts/checkPoolConfig.js` are older and inconsistent) use
a service-account JSON key, expected at `scripts/service-account.json` (repo root
convention) — **which is NOT in `.gitignore` as of 2026-07-06**. The pre-commit secret
scan (`scripts/scan_secrets.py`, which matches the PEM `BEGIN PRIVATE KEY` header —
written without the surrounding dashes here so this doc does not trip its own scanner)
would catch a
staged key, but don't rely on it: prefer keeping the key OUTSIDE the repo and pointing
`GOOGLE_APPLICATION_CREDENTIALS` at it. Get a key from Firebase console → Project
settings → Service accounts → Generate new private key (SUPER_ADMIN/owner only).

### Shipped script: `firestore-census.mjs` (READ-ONLY — it never writes)

```powershell
# from D:\march-melee-pools (functions/node_modules must exist)
npm --prefix functions install   # once, if needed
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\gridiron-admin.json"   # key kept OUT of the repo
node .claude/skills/mmp-diagnostics-and-tooling/scripts/firestore-census.mjs
node .claude/skills/mmp-diagnostics-and-tooling/scripts/firestore-census.mjs --json   # machine-readable
```

One field-masked scan of `/pools` + two single-doc reads answers:

| Census section | Definition used (mirrors prod code) | Why it needs a script |
|---|---|---|
| Stuck-open pools | `scores.gameStatus=='post' OR isFinal==true`, status not in `[CANCELED, COMPLETED]`, `closedVia != 'ADMIN_CLOSE'` — same predicate as `isAutoCloseEligible` (`functions/src/lib/lifecycle.ts:71-77`), so it predicts exactly what `autoClosePools` would close | needs merged two-field logic |
| Pools missing `billing` | `data.billing === undefined` | Firestore cannot query "field is missing" — only a scan finds these |
| Test/sim pool census | name prefixes from §3 table + slug `sim-*` | prefix match across two fields |
| Heartbeats | `system/scoreSync` age/status; `health/latest` age + failing checks | one command instead of two console visits |

Console fallback (no key available): Firestore console → `pools` → Filter — you can
check `isFinal == true` or `scores.gameStatus == "post"` individually and eyeball
status, and prefix-match names with `>= "AI Test -"` / `<= "AI Test -"` range
filters; the missing-`billing` question has **no console equivalent** (missing-field
queries are unsupported) — script or nothing.

Emulator dry-run of the script itself (to validate it before a prod run):
`FIRESTORE_EMULATOR_HOST=localhost:8080 node .claude/skills/mmp-diagnostics-and-tooling/scripts/firestore-census.mjs`
(PowerShell: `$env:FIRESTORE_EMULATOR_HOST = 'localhost:8080'; node ...`).

### Other single-doc reads worth knowing

| Doc | Tells you | Written by |
|---|---|---|
| `system/scoreSync` | `{lastSyncAt, status, detail?}` — squares score-sync freshness | `syncGameStatus` every cycle |
| `health/latest` | §2 snapshot + 24-point history | adminHealth |
| `system/config` | kill-switches incl. `autoClose.{enabled,dryRun}`, `poolTypeFlags` | SUPER_ADMIN via rules; see `mmp-config-and-flags` |
| `admin_stats/revenue` | Stripe revenue rollup (commissioner hosting fees ONLY — the platform never touches participant entry fees) | `aggregateRevenueDaily` / `recomputeRevenue` |

---

## 6. Client-side error pipeline (logClientError → system_logs)

Verified in `functions/src/logClientError.ts` and `src/services/errorHandler.ts`:

```
ErrorBoundary / errorHandler.handleError()
  → httpsCallable('logClientError')            (errorHandler.ts:97)
  → schema-whitelisted, size-capped, server-stamped doc
  → Firestore collection `system_logs`
```

Doc shape: `{ message(<=2000), code(<=200), stack(<=4000), url(<=500),
context(JSON, <=2000), severity: low|medium|high|critical, type:"error",
source:"client", uid|null, timestamp:<epoch ms, server-stamped>, createdAt }`.

Reading it: rules give `system_logs` `read: if isSuperAdmin()`, create/update/delete
false (functions-only). In-app, `dbService.getSystemLogs()` fetches
`orderBy('timestamp','desc') limit 50`. Console: Firestore → `system_logs`, sort
`timestamp` desc. `syncGameStatus` and other server jobs also write here (`source`
distinguishes client vs server entries).

Two integrity caveats:
1. The callable **never throws to the caller** and errorHandler swallows its own
   failures — a quiet `system_logs` does NOT prove a healthy client. Cross-check §1.
2. Code-level `enforceAppCheck` is `false` in `logClientError.ts:35`, with a
   comment saying App Check isn't operational. **That comment is CORRECT and the
   note that used to sit here calling it stale was not.** App Check is off
   platform-wide: 98/98 callables declare `appCheck: "monitor"` and zero declare
   `enforce` (`lib/validated.ts:94-97`), and the client never initializes it in
   prod because `VITE_RECAPTCHA_SITE_KEY` is deliberately absent. The 2026-07-06
   "enforced at the console/product level" attestation is superseded and
   UNVERIFIED. ⛔ Do not flip this flag and do not set the site key — setting it
   took prod down on 2026-07-30 (HANDOFF's STOP POINT box).

---

## 7. Interpretation tables — observation → meaning → action

| Observation | Likely meaning | Action / skill to load |
|---|---|---|
| `health/latest` espn check `ok:false` | ESPN scoreboard API down or blocked | Wait/retry; if during a live game, expect stale squares scores and a growing `system/scoreSync` age. `mmp-debugging-playbook` |
| email check `"unverified"` or `"unprocessed >10m"` | Trigger-Email extension not stamping/delivering | Check extension status in Firebase console; check `mail` docs' `delivery` field |
| `system/scoreSync` age > ~5 min during a live game | `syncGameStatus` failing or not deployed | §1 logs `--only syncGameStatus`; `mmp-deploy-and-operate` to verify deployment |
| `health/latest.updatedAt` > ~2h old | `scheduledHealthCheck` not running | §1 logs; check Cloud Scheduler in console |
| `AUTO_CLOSE_SWEEP` entries show `dryRun:true` unexpectedly (or vice versa) | `system/config.autoClose` flags differ from what you assumed — autoClosePools is LIVE (dryRun false) as of 2026-07-06 | Read `system/config`; changing flags = prod mutation → `mmp-change-control` |
| Census: stuck-open count > 0 persisting across days | autoClosePools capped (200/run), disabled, or pools lack the over-signal (`post`/`isFinal`) | Compare census sample with the sweep's `admin_audit` sample; `mmp-pools-domain-reference` for lifecycle semantics |
| Census: pools missing `billing` | Pools created before billing rollout, or a create path skipping billing init | `mmp-config-and-flags` (billing axes), `mmp-architecture-contract` (create paths) |
| Census: test-pool count climbing | Test Suite runs without cleanup (expected — §3) | Manual delete pass via SuperAdmin Pools tab, gated by `mmp-change-control` |
| Test Suite scenario FAIL | Engine/scoring regression on a real callable path | `mmp-pools-domain-reference` for expected math; diff against last green run |
| Test Suite scenario ERROR | Infra: callable threw / permissions / App Check | §1 logs for `createPool` etc.; `mmp-debugging-playbook` |
| `system_logs` burst of `source:"client"` docs with same `code` | Real user-facing crash shipping telemetry | Reproduce from `url` + `stack`; `mmp-debugging-playbook` |
| `admin_audit` entry `status:"error"` | Admin action attempted and failed server-side | The `error` field (capped 300 chars) + §1 logs at that timestamp |
| Expected `admin_audit` entry absent | Action may still have happened (audit writes are non-fatal, best-effort) | Corroborate with function logs and the target doc's current state |
| No logs at all for `lockNFLSpreadsJob` | Correct — it was never exported/deployed | `mmp-nfl-season-campaign` |
| Logs mention `generateTestScenario`/`validateTestResults` | Someone invoked the orphaned Gemini test callables directly (no UI path exists) | Ask who; consider it unexpected traffic |

---

## When NOT to use this skill

| You actually want to... | Load instead |
|---|---|
| Deploy, verify a deploy landed, run seasonal ops | `mmp-deploy-and-operate` |
| Triage a specific failure symptom to a root cause | `mmp-debugging-playbook` |
| Check what a past incident was and how it ended | `mmp-failure-archaeology` |
| Run vitest/Playwright suites, know the evidence bar | `mmp-validation-and-qa` |
| Change any flag, config, or kill-switch you just read | `mmp-config-and-flags` + `mmp-change-control` |
| Understand the 8-tab admin UI contract itself | `mmp-superadmin-surface` |
| Understand pool scoring math a test asserted | `mmp-pools-domain-reference` |
| Mutate prod data based on what a census found | `mmp-change-control` (non-negotiable) |

---

## Provenance and maintenance

All file:line references verified 2026-07-06 on branch `fix/superadmin-phase0-control`
(HEAD 365ae83). One re-verification command per fact class that can drift:

| Fact class | Re-verify with |
|---|---|
| functions:log CLI flags | `npx firebase functions:log --help` |
| adminHealth checks + `health/latest` shape | `Get-Content functions\src\adminHealth.ts` (checks at lines 30-105, doc at 142-157) |
| health/system_logs/admin_audit rules | `Select-String -Path firestore.rules -Pattern 'health/|system_logs|admin_audit|sim-' -Context 2` |
| Scenario count + per-type coverage | `(Select-String -Path src\utils\testing\scenarios\index.ts -Pattern 'as unknown as TestScenario').Count` (15 as of 2026-07-06) |
| Test-pool name prefixes | `Select-String -Path src\utils\testing\simulators\*.ts -Pattern 'poolName ='` |
| No automatic Test Suite cleanup | `Select-String -Path src\utils\testing\simpleTestRunner.ts -Pattern 'cleanup'` (expect zero hits) |
| admin_audit schema/caps | `Get-Content functions\src\lib\adminAudit.ts` |
| activity subcollection writers | `Get-ChildItem functions\src -Recurse -Filter *.ts \| Select-String "collection\('activity'\)\|collection\(""activity""\)"` |
| logClientError App Check flag | `Select-String -Path functions\src\logClientError.ts -Pattern 'enforceAppCheck'` |
| autoClosePools eligibility predicate (census must mirror it) | `Select-String -Path functions\src\lib\lifecycle.ts -Pattern 'isAutoCloseEligible' -Context 0,8` |
| service-account key still not gitignored | `git check-ignore scripts/service-account.json` (exit 1 = still not ignored) |
| Exported (deployed) function list | `Get-Content functions\src\index.ts` |
| Kill-switch/dry-run state of autoClosePools | Firestore console → `system/config` → `autoClose` (owner-stated LIVE past dry-run as of 2026-07-06) |

Volatile facts embedded above, mostly date-stamped 2026-07-06 with corrections added
2026-07-12: adminHealth deployed; autoClosePools LIVE past dry-run; ~~App Check enforced~~
**(CORRECTED 2026-07-30 — App Check is enforced NOWHERE; 98/98 callables are `monitor`)**
in console while `logClientError` code flag stays false; sim- rules exception is now
REMOVED (was open, closed 2026-07-11 — do not trust the "still open" phrasing
elsewhere in this file without checking the correction notes); NFL pools have never
run a live season, `lockNFLSpreadsJob` still unexported, and the new
`nflFinalizeSweepJob` backstop is a finalize sweep, not a scorer.
