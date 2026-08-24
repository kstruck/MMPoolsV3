---
name: mmp-architecture-contract
description: >
  Load-bearing architecture decisions, system invariants, and known-weak points for
  March Melee Pools / Gridiron Gamble (D:\march-melee-pools). Use when you need to
  understand WHY the system is shaped the way it is before changing it: how the
  React+Vite client talks to Firestore/Cloud Functions, which fields clients may
  never write, why the custom claim (not the user doc) is the authz authority, what
  the shared/ zod contract folder is and how it gets into functions, what ADR-0001
  actually shipped vs what was never implemented, how pool lifecycle state is
  derived (OPEN→LOCKED→LIVE→FINAL→CLOSED) vs the raw status field, and where the
  bodies are buried (billing config split-brain, no scheduled NFL scorer, sim-
  backdoor, mock admin UI, no backup story). Load this BEFORE designing any
  plan-gated change, touching firestore.rules, adding a create/score/lock path,
  or reasoning about "who is allowed to write X". Symptoms that should trigger it:
  "permission-denied", "why are there two billing configs", "can the client set
  isLocked", "is ADR-0001 live", "where does @shared resolve", "why is the pool
  showing closed", "who writes the activity log".
---

# MMP Architecture Contract

Ground truth for the load-bearing design of March Melee Pools ("MMP", also branded
Gridiron Gamble for NFL) — a sports-pool platform where commissioners host pools
(squares, brackets, NFL pick'em/survivor/margin, playoff rank-em, props) and members
join. All file:line references verified in the repo at D:\march-melee-pools on
branch `fix/superadmin-phase0-control`, 2026-07-06. Facts marked **owner-attested**
come from the project owner (Kevin) on 2026-07-06 and describe deployed prod state
that cannot be verified from the repo alone.

Jargon used once, defined once:

| Term | Meaning |
|---|---|
| Callable | Firebase Cloud Functions v2 `onCall` endpoint, invoked via `httpsCallable` from the client |
| Custom claim | `request.auth.token.role` — a field baked into the Firebase Auth JWT, set server-side only |
| Commissioner | A user who creates/hosts pools (legacy code value `POOL_MANAGER`) |
| sim- pool | A pool doc with slug prefix `sim-`, created client-side by the admin Test Suite |
| Worktree | A separate git checkout of another branch (parallel-work isolation discipline) |
| Prod project | Firebase project `gridiron-gamble-uzuqo` |

---

## 1. System shape

```
React 19 + Vite + TS (src/)                     External services
  |  direct Firestore SDK reads/subscriptions     - ESPN scoreboard API (scores/schedules, no key)
  |  httpsCallable for privileged mutations       - Stripe (commissioner hosting fees ONLY)
  v                                               - Gemini via @google/genai (AI commissioner, test suite)
Firestore  <-->  Cloud Functions v2 (functions/src/)   - Trigger Email extension (writes to `mail` collection)
  rules deny nearly all client writes             - Courier/Twilio SMS
  functions (Admin SDK) bypass rules
```

- Client transport is two-pattern by design: **reads are live Firestore
  subscriptions** (e.g. `subscribeToPools` in `src/services/dbService.ts`, a
  1,300-line god service), **writes that matter are callables**. If you find a
  client-side `setDoc`/`updateDoc` on a sensitive field, that is a bug or the
  sim- exception (section 6).
- Functions runtime: Node 22, `firebase-functions` v7 (v2 API), no
  `setGlobalOptions` — everything deploys to us-central1 with defaults unless
  set inline. All exports flow through `functions/src/index.ts`; a function not
  exported there **does not exist in prod** (this bit the NFL spread-lock job,
  section 6).
- App Check: ReCaptcha Enterprise, initialized in `src/firebase.ts:24-32` only
  if `VITE_RECAPTCHA_SITE_KEY` is set (warns loudly in prod if missing).
  ⛔ **The key is deliberately absent in prod, and setting it coincided with the
  site going down** (2026-07-30 incident: set → dead, deleted → alive, two
  machines, two networks). The loud warning is the SAFE state. ⚠️ The *mechanism*
  is an open question, not a settled fact — the first write-up blamed CSP blocking
  the reCAPTCHA script, but `Dockerfile:15-27` declares no `ARG` for this key, so
  it has no known path into the Vite build. Do not repeat the CSP story as
  established; see HANDOFF's STOP POINT box. App Check is enforced NOWHERE in code: `lib/validated.ts:94-97`
  defaults to `"monitor"` and 98 `validated()` callables declare `monitor` and zero declare `enforce`, plus 26 bare `onCall` sites with no App Check option at all.
  The 2026-07-06 owner attestation that it is ENFORCED in the Firebase console is
  **superseded and UNVERIFIED** — the incident report says the web app was never
  registered there. See HANDOFF's STOP POINT box.

### Deploy topology — the part everyone gets wrong

| Surface | How it actually deploys | Trap |
|---|---|---|
| Prod www frontend | Docker (node build → nginx:alpine) via **Coolify, manually triggered by Kevin in the Coolify dashboard** (owner-attested 2026-07-06) | Pushing to main does NOT deploy the frontend. `firebase.json` hosting rewrites are **dead on www** — nginx.conf serves it |
| Functions + rules | `npx firebase deploy` from the repo (predeploy builds functions) | Functions BEFORE rules; see mmp-deploy-and-operate for the full ritual |
| Social previews | nginx proxies ONLY crawler user-agents on `/pool/` and `/join/` to the `joinPreview` Cloud Function (nginx.conf:40-69, 418-trick with runtime DNS so upstream failure can't block nginx startup) | Humans get the SPA; do not "fix" the 418 |

- Pools are resolved by **id OR slug OR urlSlug**: the client route `/pool/:id`
  matches all three (`src/components/routes/PoolRoute.tsx:63`); share links use
  `/pool/:id`. BRACKET pools use `slug`, other types `urlSlug`
  (`AdminRoute.tsx:84`) — a naming split you must preserve when touching links.
- Pool creation is currently gated app-wide: `POOLS_OPEN = false` in
  `src/config/season.ts:2`, so `/create/*` routes are super-admin-only until the
  2026 NFL season opens. That client gate is UX-only; the server-side guard is
  `assertPoolCreationAllowed` (feature flags in `system/config.poolTypeFlags`).

---

## 2. Identity and authorization contract

**The Firebase custom claim `role` is AUTHORITATIVE. The `users/{uid}.role`
Firestore field is a display mirror and bootstrap fallback.** Why: firestore.rules
can only cheaply read the token; the user doc is client-visible and its write
rules could regress, so nothing security-critical may trust it alone.

- Canonical roles (`functions/src/lib/roles.ts:16-22`, client mirror
  `src/utils/roles.ts` with a parity test):
  `SUPER_ADMIN | MODERATOR | COMMISSIONER | MEMBER | BANNED`.
  Legacy values `POOL_MANAGER`→COMMISSIONER and `PARTICIPANT`→MEMBER are still
  live in write paths (rename is mid-flight, deliberately deferred); every read
  must normalize via `normalizeRole`.
- Rules use exactly one role check: `isSuperAdmin()` =
  `request.auth.token.role == 'SUPER_ADMIN'` (firestore.rules:17-19). Everything
  else in rules is ownership (`ownerId`/`managerUid`) or participant lists.
- Claim lifecycle: `setUserRole` (adminClaims.ts) writes claim + doc together
  and **revokes refresh tokens on demotion**; `syncMyClaims` is the self-only
  bootstrap that mints the claim from the rules-protected doc role. The client
  hook `useEnsureAdminClaims` runs `syncMyClaims` + token refresh before any
  claim-gated admin subscription (the fix for the audit-log permission bug).
- Callable authz convention: **claim first, user-doc fallback** — e.g.
  `functions/src/espnBracket.ts:821-825` reads `request.auth.token.role`, and
  only if absent falls back to the user doc. New callables must follow this
  order; checking ONLY the doc is the known-worst pattern (see
  `updateTournamentData`, section 6).
- `users/{uid}` self-writes cannot create with a role other than
  MEMBER/PARTICIPANT and cannot touch `role, referralCredits,
  freePoolsAvailable, poolCredits, activeBundleType, bundleExpiresAt`
  (firestore.rules:226-235) — the privilege/credit-escalation guard.

Money boundary (non-negotiable, never propose otherwise): **Stripe touches
commissioner hosting fees ONLY. Participant entry fees are peer-to-peer honor
system** — `markEntryPaidStatus`/`markSquaresPaid` flip bookkeeping flags and
write ledger events; no money moves through the platform.

---

## 3. System invariants — WHY and WHERE ENFORCED

Each row: violate it and something concrete breaks. Verify the enforcement point
before relying on it (rules and code drift; commands in Provenance).

| # | Invariant | Why | Enforced where |
|---|---|---|---|
| 1 | Activity log `users/{uid}/activity` is written ONLY by functions | It feeds user-facing history; client writes would let users forge activity | No rules match for `activity` subcollection → default-deny for clients; writer is `writePoolCreationSideEffects` (functions/src/lib/poolCreation.ts:110-112, POOL_CREATED) called inside all three create callables' transactions |
| 2 | `admin_audit` is append-only, functions-write only | Forensic trail of admin actions must be tamper-proof | firestore.rules:302-305 (`allow write: if false`); writes via `writeAdminAudit` (functions/src/lib/adminAudit.ts) which redacts secrets, caps metadata at 1KB, never throws into the caller |
| 3 | Clients never write `axisNumbers`, `squares`, `participants`, `billing`, `ownerId`, `managerUid`, `createdAt`, `createdBy` on pools | Axis digits are the fairness core of squares (server CSPRNG at lock); billing is money state | `protectedFieldsUnchanged()` in firestore.rules (~:53-60) gates owner/manager updates; plus updates allowed only while status DRAFT/OPEN (`poolIsEditable`) |
| 4 | `isLocked` is set only by `lockPool` callable / `autoLockPools` scheduler | Locking triggers axis generation and freezes entries | **Convention + status gate only** — `isLocked` is NOT in the rules protected-field list. An owner client-write of `isLocked` on an OPEN pool would pass rules. Treat as a known soft spot; do not widen it |
| 5 | `maxPossibleScore >= score` for every bracket entry | Leaderboard "max possible" drives who-can-still-win UX and tiebreak sort | `calculateEntryMaxScore` (functions/src/bracketScoring.ts:62) credits only still-alive picks; stress-tested by tests/synthetic-scenarios.test.ts (1,000+ random pick/result combos, per README.md:186) |
| 6 | Never hardcode 6 rounds — derive `maxRound` from tournament games | Big East = 4 rounds, Big 12 = 5, NCAA = 6; a hardcoded 6 silently breaks conference pools | `bracketScoring.ts:202`: `maxRound = games.reduce((max,g)=>Math.max(max,g.round),0)`; championship = game at maxRound. Follow this pattern in ANY new bracket loop |
| 7 | Scoring multiplier arrays support lengths 4/5/6 | Same reason as #6 — engines index by `game.round` | CLASSIC/ESPN/FIBONACCI tables at bracketScoring.ts:11-13 (length 6); CUSTOM arrays come from `settings.customScoring` (:73-74) with no server length validation (schema is `z.unknown()` in shared/schemas/bracket.ts:23) — callers must ensure length >= that tournament's maxRound |
| 8 | Authz: custom claim first, user-doc fallback | Section 2 | Pattern at espnBracket.ts:821-825; strictest form `assertCallerRole` (adminClaims.ts) requires claim AND doc to agree |
| 9 | Server clock, not device clock, for lock/countdown display | Device drift caused wrong countdowns near deadlines | `serverClock.now()` (src/utils/serverClock.ts) backed by the unauthenticated `getServerTime` callable |
| 10 | New scheduled prod-data mutators ship kill-switched + dry-run-default | One bad sweep can close/lock hundreds of live pools | Reference implementation: `autoClosePools` (functions/src/autoClosePools.ts) — does nothing unless `system/config.autoClose.enabled === true`, reports-only unless `dryRun: false`, config-read failure = disabled, 200/run cap. This is a non-negotiable discipline rule; canonical home: **mmp-change-control** |
| 11 | Email goes through `sendEmail` → Firestore `mail` collection | Unsubscribe/category opt-out checks live there (fail-open, `transactional` exempt); direct sends bypass compliance | functions/src/reminders.ts:22-62; rules block client `mail` creates |

ESPN-import invariants (seed from `curatedRank.current`, region parse order
'midwest' before 'west', full display-name team IDs) are domain rules — see
**mmp-pools-domain-reference** and docs/annual-bracket-setup-runbook.md.

---

## 4. ADR-0001 (unified createPool) — precise status as of 2026-07-06

The only ADR: `docs/adr/0001-unified-createpool-callable.md` (Status: Accepted,
2026-07-03). Reading it alone will make you over-assume. Actual split:

**LIVE on this branch / main:**
- Shared creation core `functions/src/lib/poolCreation.ts`: `validateCreateInput`
  (zod gate from shared/schemas), `assertNotBanned` (claim-first),
  `freeBilling()` (explicit `{status:'free'}` stamp, no trial/auto-lock),
  `writePoolCreationSideEffects` (managedPools index + NFL participations +
  POOL_CREATED activity event + first-pool role upgrade, all in-transaction).
- All three create callables route through that core:
  `createPool` (poolOps.ts:110,143), `createNFLPool` (nflPools.ts:83,100),
  `createBracketPool` (bracketPools.ts:103,119).
- Client wizard unification: 7 create flows share `WizardShell` — merged to main
  (PR #117, commit 8291a0d).

**NOT merged (do not assume it exists in prod):**
- The single unified `createPool` accepting the `{type, config}` envelope,
  `publishPool` as the generic publish path, and `createNFLPool`/
  `createBracketPool` reduced to thin delegates then deleted.
  `createBracketPool` (bracketPools.ts:20) and `createNFLPool` (nflPools.ts:40)
  are **still full independent implementations** with the shared core bolted on.
- Corrected 2026-07-06: nothing is "lost in a worktree". The `D:\mmp-wizard`
  worktree's actual content — shared zod schemas, `lib/poolCreation.ts` core,
  `updatePoolSettings`, client WizardShell cutover, Playwright e2e suite — ALL
  merged to `main` via PR #117 (2026-07-04, merge `6d9fa4d`), and the worktree
  was removed afterward as normal cleanup (`origin/feat/wizard-unification` is
  0 commits ahead of `main`, as expected for a merged branch). The remaining
  ADR-0001 items above (envelope `createPool`, generic `publishPool`, thin
  delegates) were **never implemented anywhere** — they are new work to be
  built from `main`, not recovery work (see mmp-product-frontier B-2).

Consequence: any change to pool-creation behavior must currently be applied in
up to three callables, and must not conflict with the pending consolidation —
coordinate via **mmp-change-control** before touching create paths.

---

## 5. The shared/ contract folder — one schema, two consumers

`shared/` at repo root holds the canonical zod contracts: `poolTypes.ts` (the
7-type enum), `schemas/` (per-type CreatePoolInput: bracket, nfl, squares,
playoff, props, common), `editability.ts`, `paymentHandles.ts`.

Two consumption mechanisms, verified:

1. **Functions**: `functions/package.json` build script is
   `node scripts/copy-shared.mjs && tsc`. The copy script
   (functions/scripts/copy-shared.mjs) mirrors repo-root `shared/` into
   `functions/src/shared/` (skipping `__tests__`, dist, tsconfig, package.json).
   `functions/src/shared/` is **generated and gitignored — never edit it by
   hand**. firebase.json's functions predeploy runs
   `npm --prefix functions run build`, so every deploy re-copies.
2. **Client**: vite alias `'@shared': path.resolve(rootDir, 'shared')`
   (vite.config.ts:16). Root vitest excludes `shared/**`; shared/ self-checks
   run standalone (`npx tsc -p shared`).

Drift risks to keep in mind:
- If you edit `shared/` and run functions typecheck/tests WITHOUT the copy step
  (the npm scripts all include it; ad-hoc `tsc` invocations do not), functions
  compile against the stale copy.
- A stale `functions/src/shared/` from an old build can mask a broken shared/
  edit until the next clean build. The copy script does `rm -rf` first, so a
  full `npm --prefix functions run build` always resyncs.
- Client and functions consume the SAME source, so there is no schema
  version skew between them at build time — but a deployed prod function
  carries whatever shared/ looked like at its deploy, which can lag the client
  Coolify deploy (and vice versa, since the two surfaces deploy independently).

---

## 6. Known-weak points — stated plainly

| Weak point | Current state (2026-07-06) | Where |
|---|---|---|
| Billing config split-brain | `createCheckoutSession` reads **`settings/billing_config`** (stripe.ts:91,172,548) while `enforceBillingStatus` reads **`config/billing_config`** (billing.ts:40). Admin save writes `settings/` (adminBillingOps.ts:32). ADR-0001 names `settings/` the single authority; migration not done. Anyone touching billing must re-verify which doc each consumer reads | functions/src/stripe.ts, billing.ts, adminBillingOps.ts |
| Legacy create callables unconsolidated | Section 4 — three full create implementations sharing only the bolted-on core | bracketPools.ts:20, nflPools.ts:40, poolOps.ts |
| **No scheduled NFL scorer** — STATUS UPDATE 2026-07-12 (see below) | `scoreNFLWeek` remains a **manual per-pool/per-week callable**; `lockNFLSpreadsJob` (nflSchedule.ts:301) is **still not exported from index.ts → spreads are not being locked automatically**. What changed: `nflFinalizeSweepJob` (nflFinalize.ts:230, scheduled daily 08:30) is now deployed as a **backstop finalize sweep** — it does NOT score weeks, it catches pools `scoreNFLWeek` already scored but failed to finalize. Kill-switch default OFF + dry-run default per Rule 1; arming (`system/config.nflFinalize.enabled`/`dryRun`) is a pending Kevin console item per HANDOFF.md. Manual weekly scoring and manual spread-locking are both still the reality — see **mmp-nfl-season-campaign** | functions/src/nflPools.ts:537, nflSchedule.ts:301, nflFinalize.ts:230, index.ts:110 |
| sim- backdoor — STATUS UPDATE 2026-07-12: REMOVED, not just SUPER_ADMIN-gated | The row below described the interim SUPER_ADMIN-gated state; that is now superseded. `firestore.rules:125` reads "NO CREATE via Client (must use createPool function). The former sim-*..." — the create-path bypass is gone entirely, Phase 2 of this item is done. (Historical, for context) previously closed to SUPER_ADMIN only: `allow create: if request.resource.data.slug.matches('^sim-.*') && isSuperAdmin()`. Before that, ANY authed user could create sim- pools with arbitrary ownerId/billing | firestore.rules:125; status also tracked in **mmp-superadmin-surface** |
| Mock admin UI still shipping | Loyalty tab "Mock Promo Campaign Creator" — Execute fires only `toast.success('Campaign successfully simulated! …')`, no backend (SuperAdmin.tsx:2235,2317). Playoffs tab seeds a hardcoded `MOCK` PlayoffTeam array (SuperAdmin.tsx:4080-4096). Do not build on either; do not mistake them for real features | src/components/SuperAdmin.tsx (4,300-line monolith) |
| No backup/DR story | No Firestore export/backup job, script, or doc anywhere in the repo (verified by grep across scripts/, docs/, package.json, firebase.json). A bad sweep or rules mistake has no restore path beyond Google-side PITR if enabled (UNVERIFIED whether PITR is enabled in the console — check GCP → Firestore → disaster recovery) | — |
| `isLocked` not rules-protected | Invariant #4 nuance: convention-enforced only | firestore.rules protected-fields list |
| Weakest authz gate | `updateTournamentData` checks ONLY the Firestore doc role, then does an unvalidated merge-set on any tournament doc | functions/src/bracketOps.ts:97-115 |
| Pools world-readable by ID | `allow get: if true` on pools/{poolId} (guest links). Entire PII posture depends on sensitive data living in the `squarePrivate` subcollection instead | firestore.rules:24, :120-131 |
| Stripe mock bypass | If STRIPE_SECRET_KEY is unset/placeholder, checkout silently activates purchases for free (sandbox convenience; dangerous if the secret binding ever breaks in prod). Owner-attested: Stripe TEST-key rotation is still PENDING as of 2026-07-06 | functions/src/stripe.ts:152-207 |

Owner-attested prod state as of 2026-07-06 (for orientation; re-verify before
relying): Phase 3.1 functions (`onUserCreated`, `syncAllUsers`,
`searchUsersByEmail` with the `searchName` lowercase index field) + adminHealth
deployed; tightened firestore.rules deployed; searchName backfill run;
`autoClosePools` is LIVE past dry-run (actually closes pools daily). The Gemini
key ~~was NOT leaked~~ **WAS leaked — corrected 2026-08-23.** `git show
3340fff0^:.env` in the public repo shows `VITE_API_KEY` (a Gemini key), exposed
since 2025-12-13. Rotation is Kevin's owed action (HANDOFF top box).

---

## 7. Pool lifecycle: derived state vs raw status

Two different things — confusing them causes wrong UI and wrong sweeps:

- **Raw `status` field** on the pool doc: type-dependent values like
  `DRAFT / OPEN / LOCKED / LIVE / COMPLETED / CANCELED` (squares also carry
  `isLocked`, `isFinal`, `scores.gameStatus`). Squares start DRAFT, Bracket has
  draft→publish (DRAFT→OPEN), NFL starts OPEN, Props start 'active'.
- **Derived lifecycle state**: `getPoolLifecycleState` in
  `src/utils/poolSport.ts:98-117` returns
  `'open' | 'locked' | 'live' | 'final' | 'closed'` (type at :40). Logic,
  verified:
  1. `closedVia === 'ADMIN_CLOSE'` → **closed** (admin-archived; raw status
     stays COMPLETED — derived label only, deliberately NOT a status migration)
  2. `status CANCELED/COMPLETED`, any other `closedVia`, or `isFinal` → **final**
  3. SQUARES: `scores.gameStatus 'post'` → final, `'in'` → live, else
     `isLocked ? locked : open`
  4. Other types: `status LIVE` → live; `LOCKED` or `isLocked` → locked; else open

Rules of engagement: UI listings and admin filtering must key off the derived
state (SuperAdmin.tsx:1041 does); server sweeps must use the shared helpers in
`functions/src/lib/lifecycle.ts` (`isAutoCloseEligible`, `adminCloseUpdate`) so
close-triggered guards fire uniformly (zero member emails, zero stats deltas on
admin close). Never write a new if-ladder over raw status in the client — extend
`getPoolLifecycleState` instead. Domain semantics of each state per pool type:
**mmp-pools-domain-reference**.

---

## When NOT to use this skill

| You actually need | Go to |
|---|---|
| The deploy ritual, Coolify steps, scheduled-job ops | **mmp-deploy-and-operate** |
| The 4 discipline rules with incident history, change gating | **mmp-change-control** (canonical home of the rules referenced here) |
| Scoring math, tiebreakers, per-format edge cases | **mmp-pools-domain-reference** |
| Symptom→cause triage for a live bug | **mmp-debugging-playbook**, incident history in **mmp-failure-archaeology** |
| Env vars, kill-switches, feature flags inventory | **mmp-config-and-flags** |
| Setting up dev env / emulators | **mmp-build-and-env** |
| Admin dashboard tab contract, Test Suite, sim- operational conventions | **mmp-superadmin-surface** |
| Getting NFL ready for the 2026 season | **mmp-nfl-season-campaign** |
| Test commands and evidence bar | **mmp-validation-and-qa** |
| Health checks and measurement tooling | **mmp-diagnostics-and-tooling** |
| Doc templates and house style | **mmp-docs-and-writing** |
| Open product problems / research method | **mmp-product-frontier** |

---

## Provenance and maintenance

Written 2026-07-06 against branch `fix/superadmin-phase0-control` (main at
a0ff311). Every fact class below can drift; re-verify with one command from
D:\march-melee-pools before relying on it in a change.

| Fact class | Re-verify with |
|---|---|
| sim- backdoor state | `grep -n "sim-" firestore.rules` |
| Rules-protected pool fields (incl. isLocked absence) | `grep -n -A 8 "protectedFieldsUnchanged" firestore.rules` |
| Canonical roles | `grep -n -A 8 "CANONICAL_ROLES" functions/src/lib/roles.ts` |
| What is actually deployed-able (exports) | `grep -n "lockNFLSpreadsJob\|scoreNFLWeek\|createPool" functions/src/index.ts` |
| Billing config split-brain | `grep -rn "billing_config" functions/src/stripe.ts functions/src/billing.ts functions/src/adminBillingOps.ts` |
| shared/ copy mechanism | `grep -n "copy-shared" functions/package.json && grep -n "@shared" vite.config.ts` |
| Lifecycle derivation | `grep -n -A 20 "export function getPoolLifecycleState" src/utils/poolSport.ts` |
| ADR-0001 merge status | `git log --oneline --all -- functions/src/lib/poolCreation.ts`; note `git log main..origin/feat/wizard-unification` → 0 commits (fully merged via PR #117; the remaining ADR items were never implemented, see §4) |
| Activity-log writer | `grep -rn "POOL_CREATED" functions/src/lib/poolCreation.ts firestore.rules` |
| Creation gate flag | `grep -n "POOLS_OPEN" src/config/season.ts` |
| autoClosePools kill-switch defaults | `sed -n 30,50p functions/src/autoClosePools.ts` |
| Mock admin UI still present | `grep -n "Mock Promo\|successfully simulated\|const MOCK" src/components/SuperAdmin.tsx` |
| maxRound derivation & multiplier tables | `grep -n "maxRound\|CLASSIC:\|FIBONACCI:" functions/src/bracketScoring.ts` |
| Prod deployed function list (needs gcloud auth) | `npx firebase functions:list --project gridiron-gamble-uzuqo` |
| Prod rules actually deployed | Firebase console → Firestore → Rules (repo file is not proof of deployment) |
