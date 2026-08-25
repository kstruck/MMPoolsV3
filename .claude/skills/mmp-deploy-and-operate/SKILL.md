---
name: mmp-deploy-and-operate
description: "Use when deploying or operating March Melee Pools / Gridiron Gamble in production (Firebase project gridiron-gamble-uzuqo): deploying Cloud Functions or Firestore rules, triggering the www frontend deploy in Coolify, verifying a function landed, understanding the scheduled-job (cron) inventory and kill-switches, running annual NCAA bracket setup, scoring NFL weeks manually, running backfill/one-off ops scripts, or checking what remains on PHASE0-DEPLOY-CHECKLIST.md. Symptoms/verbs in hand: 'deploy', 'firebase deploy', 'TS2307 stripe', 'push to main didn't deploy', 'Coolify', 'nginx', 'cron', 'onSchedule', 'autoClosePools', 'scoreNFLWeek', 'lockNFLSpreadsJob', 'setUserAdmin', 'backfill', 'Selection Sunday', 'import tournament from ESPN'."
---

# mmp-deploy-and-operate — deploy ritual, prod topology, scheduled jobs, seasonal ops

Repo root: `D:\march-melee-pools`. Prod Firebase project: `gridiron-gamble-uzuqo` (region: everything is `us-central1`, Node 22, Cloud Functions v2 API except `onUserCreated` which is v1 auth-trigger). All commands below are PowerShell-compatible and assume the repo root as cwd.

Jargon used once, defined once:
- **callable** — a Firebase `onCall` Cloud Function invoked from the client via `httpsCallable(functions, 'name')`.
- **kill-switch** — a Firestore config flag a scheduled job reads at runtime; job no-ops unless explicitly enabled.
- **dry-run default** — a mutating job that only *reports* what it would change until a second flag is explicitly flipped.
- **Coolify** — the self-hosted PaaS that builds/serves the prod www frontend from the repo `Dockerfile` + `nginx.conf`.
- **worktree** — a separate git checkout for parallel work (see mmp-change-control).

---

## 1. THE deploy ritual (Cloud Functions + rules)

This is non-negotiable discipline rule (b) — canonical incident history lives in **mmp-change-control**. The short form:

1. Always `npx firebase` (firebase-tools is a devDependency; there is no global CLI on the machines this runs on).
2. Always `npm --prefix functions ci` FIRST — skipping it causes `TS2307: Cannot find module 'stripe'` (and firebase-functions-test) errors during the predeploy build. **`ci`, not `install`**: `install` rewrites `functions/package-lock.json`, which dirties the tree `firebase deploy` packages and defeats any clean-worktree check (2026-07-21).
3. Deploy **functions BEFORE firestore rules** when both changed — the rules assume the new functions exist (e.g. tightened `system_logs` rules made client writes illegal because `logClientError` was supposed to take over; deploying rules first silently drops telemetry).
4. ⚠️ **Classify the rules change before choosing an order — §1a has the table.** A rules change that REVOKES a read the live frontend still makes puts the Coolify rebuild BETWEEN the functions deploy and the rules deploy. One that GRANTS a read the new bundle needs puts rules before the rebuild. One that does **both** has no safe order at all and must be split into two rules deploys.
5. Always pass `--project gridiron-gamble-uzuqo` explicitly.

### 1a. The three-step order, and when the middle step is load-bearing

**Promoted from HANDOFF 2026-08-12, where it was learned the expensive way on
#414 (commissioner-blind picks).**

The two-step ritual above assumes the rules change only *adds* permissions, or
removes ones nothing is using. **When it takes a read away from a client that is
still deployed and still making it, the order is three steps:**

```
functions  →  Coolify rebuild  →  rules
```

**Why.** #414's rules edit removed the owner/manager read of `entries`. The
frontend then live in production (`subscribeToNFLEntries`,
`NFLPoolDashboard.tsx:139` on the pre-#414 build) was still subscribing to it.
Deploying rules before the rebuild revokes the read out from under a client that
does not know to stop asking — **every commissioner's standings tab blanks for
the length of the build**. Deploying the new callable first does not help: the
old bundle does not know to call it.

**Rebuilding early was free ON #414** — but that is a property of #414, not a
general one, and the first draft of this section wrongly generalised it. #414
was a **pure revocation**: it took the `entries` read away and added no rule the
new client needed (the replacement was a *callable*, `getPoolPicks`, which rules
do not gate). So the new bundle asked only for things the old rules still
allowed, and landing it early cost nothing.

⚠️ **A change that revokes AND grants has no safe two-step order.** If the rules
diff both removes a read the old client makes and adds one the NEW client needs,
then:

- rules first → the old client's read dies for the length of the build;
- rebuild first → the new client's read is denied until the rules land.

Both orders break production, in opposite directions. (codex, on the PR that
promoted this section — the first draft claimed rebuild-first was always safe.)

### Classify the diff before choosing an order

Two questions, asked of `firestore.rules` against the **currently deployed**
bundle and the **about-to-be-built** one:

| | New bundle needs a rule the OLD rules do not grant? | |
|---|---|---|
| | **no** | **yes** |
| **Rules revoke a read the OLD bundle makes? — no** | ordinary two-step: functions → rules → Coolify (rebuild last, order does not matter) | ordinary two-step: functions → **rules** → Coolify. Rules must land BEFORE the client that needs them |
| **— yes** | **three-step: functions → Coolify → rules** (§1a; this is #414) | 🛑 **MIXED — no ordering works.** Split it, see below |

### The mixed case: split the rules deploy in two

When both are true, the rules have to pass through a state that permits **both**
clients at once:

1. Deploy **functions**.
2. Deploy a **compatibility ruleset** — the union: keeps the read the old client
   still makes, and adds the one the new client needs. Nothing is revoked yet.
3. **Coolify rebuild.** Both bundles are now legal.
4. Deploy the **final ruleset**, which drops the old read.

Steps 2 and 4 are two separate `--only firestore:rules` deploys of two different
file states, so this needs planning before the branch is cut — it is not a thing
to discover on deploy night. If splitting is not practical, the alternative is to
make the change pure: keep serving the old read until a later PR removes it.

⚠️ **None of these variants reorder functions.** Functions go first in every
case: a new callable the rebuilt client calls must exist before that client
ships, or the rebuild lands on a 404.

### Full sequence (copy-paste)

```powershell
# 1. Install functions deps (avoids TS2307 stripe / firebase-functions-test)
#    ci, NOT install — install rewrites the lockfile and dirties the deploy tree
npm --prefix functions ci

# 1b. The tree that gets packaged must be clean
if (git status --porcelain -- functions shared) { throw "functions/ or shared/ is dirty - deploy packages the WORKING TREE, not the commit. Stash or commit first." }

# 2. Optional fail-fast build (the deploy predeploy hook runs this anyway)
npm --prefix functions run build

# 3. Deploy ALL functions
npx firebase deploy --only functions --project gridiron-gamble-uzuqo

# 3b. ⚠️ CLASSIFY THE RULES CHANGE FIRST — §1a's table.
#     Revokes a read the live client still makes  -> the Coolify rebuild goes
#       HERE, before the rules deploy. Manual trigger in the dashboard; wait.
#     Grants a read the NEW bundle needs          -> rules first, rebuild after.
#     Does BOTH                                   -> no order works; §1a's
#       compatibility-ruleset split, planned before the branch is cut.

# 4. THEN rules, only if firestore.rules changed
npx firebase deploy --only firestore:rules --project gridiron-gamble-uzuqo

# 5. Indexes, only if firestore.indexes.json changed
npx firebase deploy --only firestore:indexes --project gridiron-gamble-uzuqo
```

### Anatomy

| Piece | What it does | Source |
|---|---|---|
| `npm --prefix functions ci` | Installs `functions/node_modules` (separate package.json, Node 22 engine) strictly from the committed lockfile. **`ci`, not `install`** — `install` rewrites `functions/package-lock.json` and dirties the tree `firebase deploy` packages | `functions/package.json` |
| predeploy hook | `npm --prefix functions run build` = `node scripts/copy-shared.mjs && tsc` — mirrors repo-root `shared/` into `functions/src/shared/` (gitignored) then compiles to `functions/lib/` | `firebase.json:12-14`, `functions/package.json` |
| `--only functions` | Deploys every export of `functions/src/index.ts` — ONLY exports there deploy; anything defined but not exported is dead code in prod | `functions/src/index.ts` |
| `--only functions:name1,functions:name2` | **Partial deploy** — deploys just the named functions. Preferred for one-function fixes (faster, smaller blast radius). Example: `npx firebase deploy --only functions:logClientError --project gridiron-gamble-uzuqo` | Firebase CLI standard |
| `--only firestore:rules` | Deploys `firestore.rules` only | `firebase.json:17-20` |

Notes and traps:
- `npm run deploy:backend` (root package.json) runs `npx firebase deploy --only functions,firestore:rules,firestore:indexes --project gridiron-gamble-uzuqo` in ONE command — but it does not let you sequence functions-before-rules deliberately, so prefer the explicit two-step ritual above. ⚠️ **All three of those properties were fixed on 2026-08-04 and the reasons are worth keeping.** It previously (a) shipped `functions,firestore:rules` only, so declared indexes were silently never created — this is how `enforceBillingStatus` ran its whole life without its two composite indexes; (b) invoked a bare `firebase`, against the repo-wide `npx firebase` convention; and (c) omitted `--project`, which became materially riskier once the script started deploying indexes, because an index deploy RECONCILES against the file and can delete indexes in whichever project happened to be active. (b) and (c) were qodo findings on PR #365.
- A scheduled function's Cloud Scheduler job is created automatically on first deploy of that function (observed with `scheduledHealthCheck`).
- Deleting an export then deploying prompts the CLI to confirm deleting the prod function. Do not blind-confirm; check what it wants to delete.

### Verify a function landed (VERIFIED WORKING 2026-07-06)

```powershell
npx firebase functions:list --project gridiron-gamble-uzuqo
```

Prints a table (name / v1-v2 / trigger / location / memory / runtime). To check one name, pipe: `npx firebase functions:list --project gridiron-gamble-uzuqo | Select-String scoreNFLWeek`. To watch logs: `npx firebase functions:log --project gridiron-gamble-uzuqo` (also available as `npm --prefix functions run logs`, which omits `--project`). `gcloud functions list` is UNVERIFIED here — gcloud may not be installed/authed on the ops machine; `functions:list` is the known-good path.

---

### 1c. Cloud Run healthcheck flakes during a mass deploy — measured 2026-08-13

*(1c, not 1b — the deploy ritual's copy-paste block already uses `# 1b.` as a
step label, and two things answering to "1b" in one skill is how a reference
points at the wrong one. qodo, on #425.)*

On a full-fleet deploy (~180 functions), a random subset can fail with
`Container Healthcheck failed … PORT=8080 … within the allocated timeout`.
Measured signature of the INFRA flake, as opposed to a real startup crash:

- The revision logs show `Starting new instance` then **four minutes of total
  silence** before `STARTUP TCP probe failed … DEADLINE_EXCEEDED. The instance
  was not started.` A real code crash logs *something* — an exception, a module
  error. Zero application output means Node never ran.
- The failing subset is **non-deterministic across retries** (`createNFLPool`
  failed attempt 1 and passed attempt 2 with an identical bundle). A code-level
  import crash fails every function, every attempt — they share one container
  image.
- Healthy deploys of the same family pass the probe in ~5 seconds.

**What is and is not broken while this happens:** Cloud Run keeps the LAST GOOD
revision serving when a new one fails its healthcheck, so a failed update is
NOT an outage — users stay on the previous deploy's code. The risk is a split
fleet (some functions on the new bundle, some on the old), which matters only
if the change spans functions that must agree.

**The procedure that worked:**

1. Retry ONLY the failed subset:
   `npx firebase deploy --only functions:fnA,functions:fnB,... --project gridiron-gamble-uzuqo`
2. If the retry fails too, **WAIT ~10 minutes** before the next attempt.
   Back-to-back retries during the flake window fail the same way, and each
   attempt costs ~5 minutes of probe timeout per function. The 2026-08-13
   incident: attempt 1 failed 7, immediate attempt 2 failed 5 of the same 7,
   ten-minute wait → attempt 3 passed all 5.
3. Before any third attempt, pull the revision logs
   (`npx firebase functions:log --only <fn> --project gridiron-gamble-uzuqo` —
   the explicit project matters exactly here: a worktree has no `.firebaserc`
   default, and logs pulled from some other active project would falsely show
   "no application output", i.e. this flake's own signature) and check for the
   silence-then-DEADLINE_EXCEEDED signature. Application output in the gap
   means it is NOT this flake — stop retrying and read the error.
4. Never `npm audit fix --force` or change code between attempts — the retry
   must ship the same bundle, or a pass proves nothing about the failure.

## 2. www frontend deploy (Coolify — NOT Firebase Hosting)

**As of 2026-07-06, per owner: prod www deploy is a MANUAL trigger in the Coolify dashboard by Kevin. Pushing to `main` does NOT deploy the frontend.** (PHASE0-DEPLOY-CHECKLIST.md line 19 claims "Coolify auto-builds main on push" — that doc claim is superseded by the owner interview; treat auto-deploy as false.)

Topology:

| Layer | Serves | Config |
|---|---|---|
| Coolify → Docker → nginx | The prod www site (static SPA build) | `Dockerfile` (2-stage: node:20-alpine `npm run build:static`, then nginx:alpine), `nginx.conf` |
| Firebase Hosting | Still configured (`firebase.json` "hosting": public `dist`, rewrite `/join/**` → `joinPreview` function, `**` → SPA `index.html`, cache + CSP headers) but **does not serve prod www** — its rewrites/headers do NOT apply to the Coolify site | `firebase.json:21-88` |
| nginx (prod) | Replicates the SPA fallback + headers itself; for `/pool/` and `/join/` paths it serves the SPA to humans but proxies **social crawlers only** (UA map) to `us-central1-gridiron-gamble-uzuqo.cloudfunctions.net/joinPreview` for OG tags | `nginx.conf:5-8,40-69` |

Deploy steps for a frontend change:
1. Merge to `main`.
2. Kevin opens the Coolify dashboard and manually triggers a redeploy of the www app.
3. Confirm the deployment's commit SHA matches the merge commit (Coolify shows it) and the container healthcheck passes.
4. Smoke-test: hard-refresh the site (index.html is no-cache; hashed js/css are immutable-cached 1 year, so a stale shell is the usual symptom of a half-landed deploy).

Routing facts (as of 2026-07-06, from deploy-topology notes): pools are resolved by slug on www; share links use `/pool/:id`. `nginx.conf` is CI-validated (`nginx -t` job in `.github/workflows/ci.yml`), so a broken nginx config fails PR CI before it can reach Coolify.

Known-pending Coolify build-env misconfig (see §6): `VITE_FIREBASE_STORAGE_BUCKET` and `VITE_FIREBASE_AUTH_DOMAIN` values are malformed (harmless today, must be fixed before enabling Storage/uploads).

Firebase Hosting deploy (`npm run deploy:hosting`) still exists and would publish to the firebaseapp.com/web.app domains — deploying it does NOT update prod www. Don't use it expecting a prod release.

---

## 3. Scheduled jobs inventory (all verified in `functions/src` + `functions:list`, 2026-07-06)

All schedules without an explicit `timeZone` run in **UTC** for v2 `onSchedule`.

| Function | Schedule | What it does | Kill-switch | Source |
|---|---|---|---|---|
| `autoLockPools` | every 1 min (300s/512MiB) | Locks due pools: SQUARES via `reminders.lock.enabled` + `lockAt`, BRACKET via root `lockAt` (due = within 30s); generates axis digits; bounded concurrency 15 | **NONE** — always live | `autoLock.ts:41` |
| `syncGameStatus` | every 1 min | ESPN score pull for active squares pools; per-pool transactions; heartbeat doc `system/scoreSync` | **NONE** — always live | `scoreUpdates.ts:1081` |
| `runReminders` | every 15 min (was 5 min until #265, 2026-07-23) | Deadline/lock reminder emails | NONE | `reminders.ts:115` |
| `syncNFLScoresJob` | `*/5 * * * *` | Refreshes `nfl_games` scores + flex-schedule moves; preserves locked spreads | NONE | `nflSchedule.ts:221` |
| `scheduledBracketSync` | every 10 min | Syncs all non-finalized tournaments from ESPN, then rescores all bracket entries | NONE (no-ops when no active tournaments) | `espnBracket.ts:1027` |
| `checkPlayoffScores` | every 30 min | NFL playoff score sync | NONE | `playoffPools.ts:376` |
| `scheduledHealthCheck` | every 60 min | Writes health snapshot to `health/latest` (Overview API Status Center) | NONE | `adminHealth.ts:176` |
| `enforceBillingStatus` | every day 03:00 **UTC** | trial→grace→locked billing transitions + commissioner emails | NONE (but pools without a `billing` field are treated as free and skipped) | `billing.ts:35` |
| `autoClosePools` | every day 08:00 **UTC** (300s/512MiB) | Closes stuck-open finished pools (over-signal required, cap 200/run, audited to `admin_audit` as `AUTO_CLOSE_SWEEP`) | **YES**: Firestore `system/config` doc, `autoClose.enabled === true` to run; `autoClose.dryRun !== false` = dry-run. Fail-safe: read error → disabled. **LIVE (enabled, past dry-run — actually closes pools daily) as of 2026-07-06 per owner.** | `autoClosePools.ts:26-47` |
| `aggregateRevenueDaily` | every 24 h | `billingCharges` → `admin_stats/revenue` | NONE | `revenueAggregates.ts:34` |
| `lockNFLSpreadsJob` | `0 9 * * 2` Tue 09:00 America/New_York | Would mark `spread.locked` on upcoming `nfl_games` | — **NOT EXPORTED from index.ts → NOT DEPLOYED** (verified: absent from `functions:list` output 2026-07-06). Spreads are never auto-locked in prod. | `nflSchedule.ts:301` |

DST sensitivity:
- The two daily UTC jobs (`enforceBillingStatus`, `autoClosePools`) shift local wall-clock time by an hour across DST — benign for these sweeps.
- `espnBracket.ts:~328-338` computes a default tournament `lockAt` with a **hardcoded `-04:00` offset** — only correct mid-March through early November (its own comment says so). An annual-setup trap if a tournament is configured outside EDT.
- Actual pool locking compares epoch-ms `lockAt` values, so DST correctness depends on whoever computed the stored `lockAt` (usually the commissioner's browser).
- `autoClosePools` is the reference implementation of discipline rule (a): kill-switch + dry-run-default + review-dry-run-audits-before-enabling. Any new prod-data-mutating job MUST copy this pattern (canonical rule text: **mmp-change-control**).

---

## 4. Seasonal operations

### 4a. Annual NCAA bracket setup (each March)

Full runbook: `docs/annual-bracket-setup-runbook.md` (last updated March 2026). Cited functions verified to still exist and be deployed: `importTournamentFromESPN` (exported, `espnBracket.ts`), helper `fetchAndMapESPNGameData` (`espnBracket.ts:365`), `adminInitTournament`, `syncBracketTournament`. Condensed:

1. ~1 week before Selection Sunday: test-fetch `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=200`; verify field shape (`curatedRank.current` = seed, `notes[0].headline` = region/round, `team.displayName` = team ID, `records[0].summary` = W-L). Shape drift → update `fetchAndMapESPNGameData`.
2. Respect the "never break" rules: seed ONLY from `curatedRank.current`; check `'midwest'` BEFORE `'west'` in region parsing (substring trap that once mislabeled a whole region); the static `NCAA_20XX_BRACKET` map is deprecated fallback only; team IDs are full ESPN display names (`"Duke Blue Devils"`), not `E1-Duke`.
3. Import: as SUPER_ADMIN in the app → Tournament Manager → select the "Men's 20XX" NCAA entry → "Import Data from ESPN" → expect ~67 games / ~69 teams; verify "R1 mapped:" lines in the `importTournamentFromESPN` function logs; confirm Midwest is not labeled West.
4. UI checks: correct #1 seeds per region, seeds + records visible, mobile region tabs OK.
5. Conference tournaments: `initializeBigEastTournamentHttp` / `initializeBig12TournamentHttp` callables seed skeletons; re-init also possible via the Operations tab or `functions/reinit_big12.js` (see §5).
6. Live season: `scheduledBracketSync` (every 10 min) takes over; scoring is automatic. `scoreBracketEntries` / `finalizeTournamentPayouts` are SUPER_ADMIN callables for manual rescore and end-of-tournament payout finalization. WARNING: `finalizeTournamentPayouts` has no processed-marker — re-running re-sends recap emails.

### 4b. NFL season operations — as they exist TODAY (2026-07-06)

**NFL pools have never operated a live season; the 2026 season is the first.** This is the project's hardest open live-ops problem. The executable campaign to fix it is **mmp-nfl-season-campaign** — go there for the plan; this section documents only current reality.

- **There is NO automated weekly NFL scoring.** `syncNFLScoresJob` refreshes game scores into `nfl_games` every 5 minutes, but pool standings only update when someone runs `scoreNFLWeek` — a **manual, per-pool, per-week callable**.
- Exact invocation (verified `functions/src/nflPools.ts:537`): callable `scoreNFLWeek`, payload `{ poolId: string, week: number }`. Auth: pool owner/manager or SUPER_ADMIN (`assertPoolOwnerOrSuperAdmin`). Refuses while any game in the week is non-FINAL/non-CANCELLED unless caller is SUPER_ADMIN. Re-running a week is idempotent (recompute-style writes; chunked batches so >500-entry pools don't fail).
- UI path: pool manager view → `NFLManagerView.tsx:180` calls `dbService.scoreNFLWeek(pool.id, week)` (`src/services/dbService.ts:1159`).
- Console alternative (no repo script exists for this): call it from the app as the pool owner, or as SUPER_ADMIN via a temporary admin script using the same callable. There is no "score all pools" function — every pool × every week is a separate manual call.
- `lockNFLSpreadsJob` is written but **not exported/deployed** (§3) — spreads never auto-lock. Anyone relying on Tuesday-morning spread locking is relying on nothing.
- Season import: `importNFLSchedule` callable (SUPER_ADMIN, `nflSchedule.ts:341`) — **destructive**: deletes existing `nfl_games` for the season/type before re-import, in a single unbounded batch (fails >500 docs). Do not run mid-season casually.
- Preseason (seasonType=1) is a supported 4-week test season (`docs/NFL_POOLS_README.md`); the intended pre-week-1 validation path is live preseason pools.
- Feature gate: `src/config/season.ts` → `POOLS_OPEN = false` — NFL pool creation is closed until flipped for the 2026 season.

---

## 5. Backfills and one-off ops

### Where one-offs are SUPPOSED to happen: the Operations tab

Convention (verified `src/components/admin/OperationsPanel.tsx:12,141`): every one-off data action lives in the Super-Admin Dashboard → **Operations** tab, behind one **explain-then-confirm** guardrail (`ConfirmActionModal`), and writes an `admin_audit` entry via `logAdminAction` on both success and error. If you are adding a new one-off, add it there — not as a loose script. Details of the 8-tab admin contract: **mmp-superadmin-surface**.

### Deployed backfill callables

| Callable | Danger notes |
|---|---|
| `backfillPools` (`backfill.ts`, SUPER_ADMIN) | Walks EVERY pool, mutates status/createdByUid/isPublic, `FieldValue.increment`s historical stats — **re-running double-counts** poolsEntered/poolsWon/totalPoints. No dry-run. Audited but not idempotent. |
| `backfillUserRoles` (`adminClaims.ts`) | Role backfill; deployed (verified in functions:list). |
| `fixPoolScores` (`scoreUpdates.ts:1342`, SUPER_ADMIN) | Global mode resets Every-Score-Pays pools to 0-0 before re-decomposing — an ESPN outage mid-run leaves pools zeroed. |
| `recalculateGlobalStats`, `recomputeRevenue`, `syncAllUsers` | Recompute-style; safe to re-run. `syncAllUsers` = the searchName backfill (already run in prod, §6). |

### Loose scripts inventory (verified on disk 2026-07-06)

`functions/` (root of functions package — run with `node functions/<name>`; auth via `functions/service-account.json` or ADC):

| Script | What | Risk flag |
|---|---|---|
| `setUserAdmin.cjs` | Sets Auth custom claim `role` + mirrors to `users/{uid}` doc. `node functions/setUserAdmin.cjs <UID> [SUPER_ADMIN\|POOL_MANAGER\|PARTICIPANT]`; defaults to SUPER_ADMIN. Hardcoded project gridiron-gamble-uzuqo. | **DANGEROUS — role-escalation script that bypasses the audited `setUserRole` callable. Per audit: use the in-app Members tab / `setUserRole` instead; this is break-glass only.** |
| `reinit_big12.js` | Re-initializes tournament `big12-2026` via `lib/conferenceTournaments` against prod. | **DANGEROUS — direct prod tournament mutation, no confirm, no audit. Prefer the Operations tab re-init.** |
| `backfillHistoricalStats.cjs` | Squares historical stats backfill. | **BROKEN projectId: initializes `march-melee-pools`, not `gridiron-gamble-uzuqo` — will hit the wrong/nonexistent project as written.** |
| `backfillBracketParticipants.cjs` | Backfills bracket pool `participantIds`; needs `functions/service-account.json`. | One-time; likely stale. |
| `inspectPool.cjs` | Read-only pool dump; needs service-account.json. | Safe (read-only). |

`functions/scripts/`: `backfillSquarePrivate.mjs` — the H1 PII migration (moves `playerDetails` off public pool docs into `squarePrivate`). **Dry-run by default; `--commit` to apply; idempotent** — this is the model script. Plus its tests and `copy-shared.mjs` (build plumbing, not ops).

`scripts/` (repo root — mostly read-only diagnostics): `checkPoolConfig.js`, `checkPoolGame.mjs`, `checkWinners.mjs`, `inspectPool.js`, `inspectESPN.mjs`, `testFixPool.mjs`, `fixPoolScores.js` (mutating — same caveats as the callable), `prerender.ts` (build step, not ops), `scan_secrets.py` (pre-commit hook). Interpretation guides: **mmp-diagnostics-and-tooling**.

Rule of thumb: any script that writes prod data violates discipline rule (a) unless it has dry-run-default + explicit commit flag (only `backfillSquarePrivate.mjs` qualifies). Treat the rest as legacy break-glass; route new one-offs through the Operations tab.

---

## 6. PHASE0-DEPLOY-CHECKLIST.md — state as of 2026-07-06 (owner-confirmed)

The checklist (repo root) is the Phase 0-3 deploy runbook for the super-admin control work (PR #139, merged `53d9872`). Current truth:

| Item | Status |
|---|---|
| Phase 3.1 functions deployed (`onUserCreated`, `syncAllUsers`, `searchUsersByEmail`) + `adminHealth` (`getAdminHealthSnapshot`, `scheduledHealthCheck`) + `logClientError` | **DONE** (verified in `functions:list` 2026-07-06) |
| Tightened `firestore.rules` deployed (sim-* create → SUPER_ADMIN-only; `system_logs` functions-only; `health/*`), functions-before-rules order respected | **DONE** |
| `searchName` backfill (Members → Force Sync / `syncAllUsers`) | **DONE** (run in prod) |
| App Check enforced in Firebase console | ⛔ **NOT ENFORCED, AND MUST STAY THAT WAY FOR NOW.** The old "DONE — ENFORCED" claim here was wrong: 98 `validated()` callables declare `appCheck: "monitor"` and zero declare `enforce` (`lib/validated.ts:94-97`), and the incident report says the web app was never registered in the console at all. Turning it on by setting `VITE_RECAPTCHA_SITE_KEY` in Coolify **took production down on 2026-07-30** (blank page; rolled back by deleting the variable). `logClientError`'s `enforceAppCheck: false` (`logClientError.ts:35`, beac092 / PR #142) is therefore consistent with the rest of the fleet, not an outlier, and re-enabling it is **not** a follow-up to pick up. See HANDOFF's STOP POINT box. |
| `autoClosePools` | **LIVE past dry-run** (see §3) |
| Stripe TEST secret rotation (delete the commented plaintext test key + webhook secret from `functions/.env`, rotate both in Stripe dashboard test mode) | **PENDING — still to do.** Prod secrets are in Secret Manager and fine. |
| Coolify build-env fix (`VITE_FIREBASE_STORAGE_BUCKET` = a pasted literal, `VITE_FIREBASE_AUTH_DOMAIN` doubled) | UNVERIFIED — checklist Step 6 lists it; owner interview didn't confirm completion. Check Coolify env vars before enabling Storage. |

Doc corrections: the checklist's "Coolify auto-builds main on push" is wrong per owner (manual trigger, §2). ~~Any doc claiming a leaked **Gemini** key is wrong~~ **CORRECTED 2026-08-23: the Gemini key WAS leaked** — `git show 3340fff0^:.env | grep -c VITE_API_KEY` (count-only — never reprint the value) in the public repo shows `VITE_API_KEY` (a Gemini key), exposed since 2025-12-13; Rotation CLOSED 2026-08-24 (Kevin ruling, evidence-verified): the leaked value returns API_KEY_INVALID when tested live, and .env history contains no other private key — the live key ("New MarchMeleePoolsAPI2", Jan 2026) never touched git. Kevin had already rotated; no further action.. The Stripe TEST key issue is separate and also pending.

Money reminder (never violate): Stripe handles **commissioner hosting fees only**; the platform NEVER touches participant entry fees (P2P honor system). Never propose platform-mediated entry-fee handling.

---

## When NOT to use this skill

- Recreating a **dev environment**, emulators, local build traps → **mmp-build-and-env**.
- How a change should be **classified/gated/reviewed**, the 4 discipline rules' canonical text + incident history → **mmp-change-control**.
- A prod symptom you need to **triage** (scores wrong, emails missing, crash) → **mmp-debugging-playbook**; past-incident detail → **mmp-failure-archaeology**.
- Health checks, admin Test Suite, audit-log reading, script output interpretation → **mmp-diagnostics-and-tooling**.
- Config axes, feature flags, kill-switch drift re-verification as a topic → **mmp-config-and-flags**.
- Making NFL pools production-ready (automation, spread locking, weekly scoring plan) → **mmp-nfl-season-campaign**.
- Admin dashboard tab contract / Operations tab UI details → **mmp-superadmin-surface**.
- Pool scoring math/lifecycle semantics → **mmp-pools-domain-reference**.
- Tests/QA commands → **mmp-validation-and-qa**. Docs conventions → **mmp-docs-and-writing**. Architecture rationale → **mmp-architecture-contract**.

---

## Provenance and maintenance

Facts above were verified against the repo and live project on **2026-07-06** (branch `fix/superadmin-phase0-control`; owner interview same date). Re-verify before trusting, one command per fact class:

| Fact class | Re-verify with |
|---|---|
| What is actually deployed | `npx firebase functions:list --project gridiron-gamble-uzuqo` |
| Which functions CAN deploy (exports) | `Select-String -Path functions\src\index.ts -Pattern 'export'` |
| Scheduled jobs + crons | `Get-ChildItem functions\src -Recurse -Filter *.ts \| Select-String 'onSchedule\('` |
| autoClosePools kill-switch state | Read Firestore doc `system/config` field `autoClose` (Firebase console) — code contract at `functions/src/autoClosePools.ts:31-47` |
| lockNFLSpreadsJob still dead | `Select-String -Path functions\src\index.ts -Pattern 'lockNFLSpreads'` (no match = still not deployed) |
| Hosting/rewrite config | `Get-Content firebase.json`; nginx behavior: `Get-Content nginx.conf` |
| Coolify deploy mode (manual vs auto) | Ask Kevin / check the Coolify app's webhook settings — not derivable from the repo |
| Checklist remaining items | `Get-Content PHASE0-DEPLOY-CHECKLIST.md` (and confirm against owner — the doc lags reality) |
| Stripe TEST key rotation done? | `Get-Content functions\.env -TotalCount 5` (lines gone = rotated locally; dashboard rotation only Kevin can confirm) |
| Ops scripts inventory | `Get-ChildItem functions, functions\scripts, scripts -File \| Where-Object {$_.Extension -in '.js','.cjs','.mjs','.py'}` |
| NFL scoring entry point | `Select-String -Path functions\src\nflPools.ts -Pattern 'export const scoreNFLWeek'` |
| POOLS_OPEN gate | `Get-Content src\config\season.ts` |
