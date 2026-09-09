# Sweep — Phase 1 callable hardening (companion to PLAN-SECURITY-OBSERVABILITY.md)

**Purpose.** Rule-3 gate artifact for `.claude/skills/mmp-change-control`. This is the COMPLETE, grep-verified inventory that the `validated(schema, handler)` + App Check + rate-limiter rollout (PLAN Phase 1, items 1–5) works against. No sampling — every exported callable and HTTP function in `functions/src/*.ts` was opened and its handler head read for the auth gate, current validation, payload shape, and App-Check posture.

**Date:** DATE_TBD (agent cannot read the wall clock).

**How this was built.**
1. `grep -rn` for the export sites, `request.auth`, `enforceAppCheck`/`consumeAppCheckToken`/`request.app`, and the role-helper definitions across `functions/src`.
2. Programmatic slice-read of the handler head (declaration + first ~25–30 lines) for each of the 108 functions in the plan's enumeration — auth check, input validation, and discriminant branch are all in that window.
3. Classification computed in code from those slices so the counts below are mechanical, not eyeballed.

**Global facts that hold across the fleet (verified, not inferred):**
- **App Check is enforced NOWHERE today.** The only function that sets the option is `logClientError` (`logClientError.ts:35`), which sets `enforceAppCheck: false` deliberately. Every other callable relies on the Firebase default (off). So the "currently enforced?" answer is uniformly **NO**; the `app-check target` column is the *recommendation*.
- **No `validated()` wrapper and no shared `assertRole()` exist yet.** Role gating is done three ways today: `assertCallerRole(request, "SUPER_ADMIN")` (adminBillingOps, adminClaims, couponTemplates, entitlements), inline `if (!request.auth || request.auth.token.role !== "SUPER_ADMIN")`, and (worse) a mutable Firestore `users/{uid}.role` read (bracketOps, espnBracket, conferenceTournaments, updateGlobalPlayoffResults). See Corrections.
- Validation today is overwhelmingly **HAND-rolled** `if (!x) throw`. Only 5 callables touch zod: `getPoolQuote`, `createCheckoutSession` (pool path), `adminSaveBillingConfig` (billing branch), `createCouponTemplate`/`updateCouponTemplate` (`parseTemplateInput`).

**Counts (108 functions total: 102 `onCall` + 6 `onRequest`):**
- **TARGET-NOW: 41** (39 first-wave + 2 `TARGET-NOW-PERMISSIVE` create paths that get the wrapper but stay passthrough per ADR-0001).
- SWEEP-LATER: 51
- INTERNAL/NA: 10 (sim-harness ×4, aiTesting ×3, `simulateGameUpdate`, `inspectPoolState`, `testSmsHttp`)
- PUBLIC-EXEMPT: 6
- **Anonymous / no-auth callables: 8**
- **Multi-shape (need discriminatedUnion): 10**
- App-Check-exempt (Sweep 2): 8

---

## Sweep 1 — Full callable validation matrix

Legend — auth: `PUBLIC/ANON` (handler can succeed with no `request.auth`), `AUTHED` (throws if `!request.auth`), `ROLE:*`/`+SUPER_ADMIN`/`+owner`/`+mgr` (additional gate, helper named). validation: `ZOD` / `HAND` / `NONE`. shape: `SINGLE` / `MULTI:<discriminant>`. app-check target: `ENFORCE` / `EXEMPT`. phase1 class: `TARGET-NOW` / `TARGET-NOW-PERMISSIVE` / `SWEEP-LATER` / `PUBLIC-EXEMPT` / `INTERNAL/NA`.

| # | function | file:line | auth | current validation | shape (+discriminant) | app-check target | phase1 class |
|---|---|---|---|---|---|---|---|
| 1 | `sendPoolInvites` | invites.ts:61 | AUTHED | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 2 | `lockPool` | poolParams.ts:8 | AUTHED+owner | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 3 | `adminSaveBillingConfig` | adminBillingOps.ts:26 | ROLE:SUPER_ADMIN | ZOD-partial (BillingConfigSchema, billing branch only; not strict) | MULTI:kind (billing\|referral) | ENFORCE | TARGET-NOW |
| 4 | `adminManageCoupon` | adminBillingOps.ts:68 | ROLE:SUPER_ADMIN | HAND | MULTI:op (create\|delete\|toggle) | ENFORCE | TARGET-NOW |
| 5 | `adminUpdatePoolBilling` | adminBillingOps.ts:109 | ROLE:SUPER_ADMIN | HAND | MULTI:action (override\|extendTrial\|resetGrace) | ENFORCE | TARGET-NOW |
| 6 | `adminAdjustUserCredits` | adminBillingOps.ts:157 | ROLE:SUPER_ADMIN | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 7 | `createBracketPool` | bracketPools.ts:22 | AUTHED | HAND + validateCreateInput gate | SINGLE | ENFORCE | SWEEP-LATER |
| 8 | `publishBracketPool` | bracketPools.ts:155 | AUTHED+owner(txn) | HAND (slug regex) | SINGLE | ENFORCE | SWEEP-LATER |
| 9 | `joinBracketPool` | bracketPools.ts:236 | AUTHED | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 10 | `createBracketEntry` | bracketEntries.ts:16 | AUTHED | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 11 | `updateBracketEntry` | bracketEntries.ts:115 | AUTHED+owner | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 12 | `submitBracketEntry` | bracketEntries.ts:338 | AUTHED | NONE at head (delegates to submitBracketEntryInternal) | SINGLE | ENFORCE | TARGET-NOW |
| 13 | `deleteBracketEntry` | bracketEntries.ts:350 | AUTHED+owner/mgr | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 14 | `getAdminHealthSnapshot` | adminHealth.ts:159 | ROLE:SUPER_ADMIN (inline) | NONE (no input) | SINGLE | ENFORCE | SWEEP-LATER |
| 15 | `backfillPools` | backfill.ts:6 | ROLE:SUPER_ADMIN (inline) | NONE | SINGLE | ENFORCE | SWEEP-LATER |
| 16 | `setUserRole` | adminClaims.ts:62 | ROLE:SUPER_ADMIN (assertCallerRole) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 17 | `setSuperAdminClaim` | adminClaims.ts:110 | ROLE:SUPER_ADMIN (assertCallerRole) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 18 | `syncMyClaims` | adminClaims.ts:152 | AUTHED (self) | NONE | SINGLE | ENFORCE | SWEEP-LATER |
| 19 | `backfillUserRoles` | adminClaims.ts:184 | ROLE:SUPER_ADMIN (assertCallerRole) | HAND (dryRun bool) | SINGLE | ENFORCE | SWEEP-LATER |
| 20 | `createPool` | poolOps.ts:205 | AUTHED | HAND + CreatePoolInput gate (permissive per ADR-0001) | MULTI:type (flat vs {type,config}) | ENFORCE | TARGET-NOW-PERMISSIVE |
| 21 | `updatePoolSettings` | poolOps.ts:353 | AUTHED+owner (assertPoolOwnerOrSuperAdmin) | HAND + buildPoolSettingsUpdate gate | SINGLE | ENFORCE | TARGET-NOW |
| 22 | `recalculatePoolWinners` | poolOps.ts:413 | ROLE:SUPER_ADMIN (token claim) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 23 | `toggleWinnerPaid` | poolOps.ts:481 | AUTHED+owner | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 24 | `fixParticipantIds` | poolOps.ts:533 | ROLE:SUPER_ADMIN (token claim) | HAND (dryRun) | SINGLE | ENFORCE | SWEEP-LATER |
| 25 | `markEntryPaidStatus` | bracketOps.ts:15 | AUTHED+owner/mgr | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 26 | `updateTournamentData` | bracketOps.ts:97 | AUTHED+SUPER_ADMIN (users doc read) | NONE (tournamentData merged raw) | SINGLE | ENFORCE | TARGET-NOW |
| 27 | `generateTestScenario` | aiTesting.ts:95 | ROLE:SUPER_ADMIN (inline) | NONE | SINGLE | ENFORCE | INTERNAL/NA |
| 28 | `validateTestResults` | aiTesting.ts:147 | ROLE:SUPER_ADMIN (inline) | NONE | SINGLE | ENFORCE | INTERNAL/NA |
| 29 | `generateTestReport` | aiTesting.ts:199 | ROLE:SUPER_ADMIN (inline) | NONE | SINGLE | ENFORCE | INTERNAL/NA |
| 30 | `refreshExpertPicks` | expertPicks.ts:131 | ROLE:SUPER_ADMIN (inline) | NONE | SINGLE | ENFORCE | SWEEP-LATER |
| 31 | `validateBillingAccess` | billing.ts:230 | PUBLIC/ANON (no request.auth) | HAND (poolId) | SINGLE | ENFORCE | SWEEP-LATER |
| 32 | `redeemCoupon` | billing.ts:258 | AUTHED+owner | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 33 | `getPoolQuote` | billing.ts:512 | AUTHED | ZOD:poolQuoteInputSchema (not .strict()) | SINGLE | ENFORCE | SWEEP-LATER |
| 34 | `createNFLPool` | nflPools.ts:44 | AUTHED | HAND + validateCreateInput gate | MULTI:type (NFL_PICKEM\|NFL_SURVIVOR\|NFL_MARGIN) | ENFORCE | TARGET-NOW-PERMISSIVE |
| 35 | `joinNFLPool` | nflPools.ts:152 | AUTHED | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 36 | `submitNFLPicks` | nflPools.ts:253 | AUTHED | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 37 | `executeSurvivorRebuy` | nflPools.ts:501 | AUTHED | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 38 | `scoreNFLWeek` | nflPools.ts:610 | AUTHED+owner/admin | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 39 | `extendWeekDeadline` | poolExceptions.ts:104 | AUTHED+mgr (loadPoolAndAssertManager) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 40 | `proxyPick` | poolExceptions.ts:172 | AUTHED+mgr | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 41 | `cancelPool` | poolExceptions.ts:344 | AUTHED+mgr | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 42 | `closePool` | poolExceptions.ts:405 | AUTHED+mgr | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 43 | `logAdminAction` | adminOps.ts:14 | ROLE:SUPER_ADMIN (inline) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 44 | `recomputeConsensus` | consensus.ts:125 | ROLE:SUPER_ADMIN (inline) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 45 | `confirmPayment` | confirmPayment.ts:15 | AUTHED (checked AFTER input parse) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 46 | `createCouponTemplate` | couponTemplates.ts:44 | ROLE:SUPER_ADMIN (assertCallerRole) | ZOD:parseTemplateInput | SINGLE | ENFORCE | TARGET-NOW |
| 47 | `updateCouponTemplate` | couponTemplates.ts:68 | ROLE:SUPER_ADMIN | ZOD:parseTemplateInput | SINGLE | ENFORCE | TARGET-NOW |
| 48 | `deleteCouponTemplate` | couponTemplates.ts:96 | ROLE:SUPER_ADMIN | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 49 | `mintCouponFromTemplate` | couponTemplates.ts:126 | ROLE:SUPER_ADMIN | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 50 | `acknowledgeMonetizationAlert` | couponTemplates.ts:173 | ROLE:SUPER_ADMIN | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 51 | `importTournamentFromESPN` | espnBracket.ts:820 | ROLE:SUPER_ADMIN (token OR users doc) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 52 | `adminInitTournament` | espnBracket.ts:979 | ROLE:SUPER_ADMIN (token OR users doc) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 53 | `syncBracketTournament` | espnBracket.ts:1008 | ROLE:SUPER_ADMIN (token OR users doc) | HAND (default id) | SINGLE | ENFORCE | SWEEP-LATER |
| 54 | `importConferenceTournamentFromESPN` | espnBracket.ts:1281 | ROLE:SUPER_ADMIN (token OR users doc) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 55 | `syncPlayInPicks` | espnBracket.ts:1340 | AUTHED+SUPER_ADMIN (token OR users doc) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 56 | `scoreBracketEntries` | bracketScoring.ts:331 | ROLE:SUPER_ADMIN (inline) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 57 | `finalizeTournamentPayouts` | bracketScoring.ts:386 | ROLE:SUPER_ADMIN (inline) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 58 | `submitPlayoffPicks` | playoffPools.ts:137 | AUTHED | HAND (rankings bounds) | SINGLE | ENFORCE | TARGET-NOW |
| 59 | `managePlayoffEntry` | playoffPools.ts:263 | AUTHED+mgr/admin | HAND | MULTI:action (togglePaid\|delete) | ENFORCE | TARGET-NOW |
| 60 | `calculatePlayoffScores` | playoffPools.ts:348 | AUTHED | NONE (legacy noop) | SINGLE | ENFORCE | SWEEP-LATER |
| 61 | `updateGlobalPlayoffResults` | playoffPools.ts:362 | AUTHED+SUPER_ADMIN (users doc) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 62 | `syncPlayoffPools` | playoffPools.ts:487 | ROLE:SUPER_ADMIN (inline) | NONE | SINGLE | ENFORCE | SWEEP-LATER |
| 63 | `initializeBigEastTournamentHttp` | conferenceTournaments.ts:164 | AUTHED+SUPER_ADMIN (users doc) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 64 | `initializeBig12TournamentHttp` | conferenceTournaments.ts:352 | AUTHED+SUPER_ADMIN (users doc) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 65 | `adminGrantEntitlement` | entitlements.ts:165 | ROLE:SUPER_ADMIN (assertCallerRole) | HAND | MULTI:productKind (CREDIT_BUNDLE\|UNLIMITED_PASS) | ENFORCE | TARGET-NOW |
| 66 | `adminRevokeEntitlement` | entitlements.ts:323 | ROLE:SUPER_ADMIN | HAND | MULTI:scope (bundle\|credit\|pass) | ENFORCE | TARGET-NOW |
| 67 | `redeemPoolCredit` | entitlements.ts:498 | AUTHED | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 68 | `logClientError` | logClientError.ts:27 | PUBLIC/ANON (no request.auth) | HAND/whitelist (severity, JSON cap) | SINGLE | EXEMPT (enforceAppCheck:false set explicitly, ln 35) | PUBLIC-EXEMPT |
| 69 | `createClaimCode` | participant.ts:43 | PUBLIC/ANON (no request.auth) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 70 | `claimMySquares` | participant.ts:93 | AUTHED | NONE (guestDeviceKey unchecked) | SINGLE | ENFORCE | SWEEP-LATER |
| 71 | `claimByCode` | participant.ts:157 | AUTHED | NONE (claimCode unchecked) | SINGLE | ENFORCE | TARGET-NOW |
| 72 | `sendManualReminder` | manualReminders.ts:51 | AUTHED+owner/mgr | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 73 | `backfillMemberRecords` | migrations/backfillMemberRecords.ts:68 | ROLE:SUPER_ADMIN (inline) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 74 | `importNFLSchedule` | nflSchedule.ts:359 | AUTHED+SUPER_ADMIN (token claim) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 75 | `recalculateGlobalStats` | statsTrigger.ts:113 | ROLE:SUPER_ADMIN (RETURNS, does not throw) | NONE | SINGLE | ENFORCE | SWEEP-LATER |
| 76 | `simWriteEntries` | simHarness.ts:96 | ROLE:SUPER_ADMIN (assertSuperAdmin) | HAND | SINGLE | ENFORCE | INTERNAL/NA |
| 77 | `simUpdatePool` | simHarness.ts:141 | ROLE:SUPER_ADMIN (assertSuperAdmin) | HAND | SINGLE | ENFORCE | INTERNAL/NA |
| 78 | `simSeedNFLGames` | simHarness.ts:174 | ROLE:SUPER_ADMIN (assertSuperAdmin) | HAND | SINGLE | ENFORCE | INTERNAL/NA |
| 79 | `cleanupSimPool` | simHarness.ts:217 | ROLE:SUPER_ADMIN (assertSuperAdmin) | HAND | SINGLE | ENFORCE | INTERNAL/NA |
| 80 | `reserveSquare` | squares.ts:13 | PUBLIC/ANON (guest allowed; auth optional) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 81 | `markSquaresPaid` | squares.ts:156 | AUTHED+owner | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 82 | `updatePlayer` | squares.ts:237 | AUTHED+mgr (assertPoolManager) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 83 | `releaseSquares` | squares.ts:305 | AUTHED+mgr | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 84 | `recomputeRevenue` | revenueAggregates.ts:43 | ROLE:SUPER_ADMIN (inline) | NONE | SINGLE | ENFORCE | SWEEP-LATER |
| 85 | `purchasePropCard` | propBets.ts:10 | PUBLIC/ANON (guest via name+email) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 86 | `gradeProp` | propBets.ts:115 | AUTHED+owner/mgr | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 87 | `updatePropCard` | propBets.ts:197 | AUTHED+owner | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 88 | `createCheckoutSession` | stripe.ts:155 | AUTHED | ZOD:checkoutPoolInputSchema (pool path) + HAND (bundle path) | MULTI:bundleType (bundle vs pool) | ENFORCE | TARGET-NOW |
| 89 | `joinWaitlist` | waitlist.ts:14 | PUBLIC/ANON (no request.auth) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 90 | `deleteUserAccount` | userManagement.ts:14 | AUTHED+SUPER_ADMIN (token claim) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 91 | `sendAdminPasswordReset` | userManagement.ts:77 | AUTHED+SUPER_ADMIN (token claim) | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 92 | `sendSecuritySMSAlert` | userManagement.ts:164 | AUTHED (self, opt-in gated) | NONE (no input) | SINGLE | ENFORCE | TARGET-NOW |
| 93 | `searchUsersByEmail` | userManagement.ts:234 | AUTHED+SUPER_ADMIN/MODERATOR | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 94 | `sendUserEmail` | userManagement.ts:273 | AUTHED+SUPER_ADMIN/MODERATOR | HAND | SINGLE | ENFORCE | TARGET-NOW |
| 95 | `setPaidStatus` | setPaidStatus.ts:11 | AUTHED (self-claim) / owner/admin (authoritative) | HAND | MULTI:claim (claim-present vs authoritative) | ENFORCE | TARGET-NOW |
| 96 | `generateReferralToken` | referral.ts:73 | AUTHED | NONE | SINGLE | ENFORCE | SWEEP-LATER |
| 97 | `resolveReferralToken` | referral.ts:88 | PUBLIC/ANON (auth optional) | HAND (token) | SINGLE | ENFORCE | SWEEP-LATER |
| 98 | `recomputeMyProfile` | userProfile.ts:90 | AUTHED (self or SUPER_ADMIN) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 99 | `simulateGameUpdate` | scoreUpdates.ts:1261 | AUTHED+owner/mgr/SUPER_ADMIN (gate in txn, :1288-1297) | HAND | SINGLE | ENFORCE | INTERNAL/NA |
| 100 | `fixPoolScores` | scoreUpdates.ts:1342 | ROLE:SUPER_ADMIN (token claim) | HAND | SINGLE | ENFORCE | SWEEP-LATER |
| 101 | `syncAllUsers` | userSync.ts:58 | AUTHED (ANY authed user; NO role gate) | NONE | SINGLE | ENFORCE | SWEEP-LATER |
| 102 | `getServerTime` | serverTime.ts:8 | PUBLIC/ANON (no request.auth) | NONE | SINGLE | EXEMPT (uptime canary / clock-sync) | PUBLIC-EXEMPT |
| 103 | `inspectPoolState` | debug.ts:5 (onRequest) | ROLE:SUPER_ADMIN (Bearer verifyIdToken) | N/A (query param) | HTTP | EXEMPT (HTTP, App Check N/A) | INTERNAL/NA |
| 104 | `manageEmailPrefs` | emailPrefsPage.ts:73 (onRequest) | PUBLIC (HMAC unsub token) | HAND (token verify) | HTTP | EXEMPT (HTTP email link) | PUBLIC-EXEMPT |
| 105 | `emailUnsubscribe` | emailUnsubscribeHttp.ts:16 (onRequest) | PUBLIC (HMAC unsub token) | HAND (token verify) | HTTP | EXEMPT (HTTP email link) | PUBLIC-EXEMPT |
| 106 | `joinPreview` | joinPreview.ts:26 (onRequest) | PUBLIC (none) | NONE | HTTP | EXEMPT (HTTP public link / crawler) | PUBLIC-EXEMPT |
| 107 | `handleStripeWebhook` | stripe.ts:786 (onRequest) | PUBLIC (Stripe signature verify) | SIGNATURE (constructEvent) | HTTP | EXEMPT (HTTP webhook) | PUBLIC-EXEMPT |
| 108 | `testSmsHttp` | userManagement.ts:191 (onRequest) | ROLE:SUPER_ADMIN (Bearer verifyIdToken) | HAND (query param) | HTTP | EXEMPT (HTTP admin tool) | INTERNAL/NA |

**Not client-facing callables (context, not in the 108 count):** `billing.ts` also exports `enforceBillingStatus` (`billing.ts:76`, `onSchedule` daily) and `onPoolParticipantChange` (`billing.ts:353`, `onDocumentWritten` trigger). Neither is a callable/HTTP endpoint — no App Check / validated() surface. Scheduled/trigger siblings seen while sweeping (`scheduledHealthCheck`, `scheduledBracketSync`, `checkPlayoffScores`, etc.) are likewise out of Phase-1 scope.

---

## Sweep 2 — App-Check exemption list (MUST stay exempt)

These 8 endpoints cannot carry a valid App Check token from the Firebase web SDK, so enforcing App Check would hard-break them. Keep them permanently exempt (or, for the HTTP ones, App Check is not even an applicable option — they are `onRequest`, which has no `enforceAppCheck`). Reason cited from code:

1. **`logClientError`** (`logClientError.ts:27`) — crash/error telemetry that must accept **pre-auth, pre-App-Check-init** reports; the file already sets `enforceAppCheck: false` with a TODO (`logClientError.ts:28-35`). Exempt until App Check is registered AND enforcing.
2. **`getServerTime`** (`serverTime.ts:8`) — trivial `{ serverTime: Date.now() }`; used as the availability **canary/clock-sync** (PLAN #14 SLO) and can be hit by GCP Uptime Checks / boot code that has no App Check token. No auth, no input.
3. **`handleStripeWebhook`** (`stripe.ts:786`, `onRequest`) — called by **Stripe's servers**; authenticity is the signed `stripe-signature` header verified via `constructEvent` (`stripe.ts:801`). No Firebase App Check possible.
4. **`emailUnsubscribe`** (`emailUnsubscribeHttp.ts:16`, `onRequest`) — clicked from a **mail client**, not the app; authenticity is the HMAC unsub token (`verifyUnsubToken`, ln 27). Public link.
5. **`manageEmailPrefs`** (`emailPrefsPage.ts:73`, `onRequest`) — same HMAC-token email-link path (ln 86); GET renders a form, POST saves prefs. Public link.
6. **`joinPreview`** (`joinPreview.ts:26`, `onRequest`) — **public share link / social crawler** OG-preview + SPA passthrough; no auth by design (ln 29 checks user-agent, not identity).
7. **`inspectPoolState`** (`debug.ts:5`, `onRequest`) — admin debug tool authenticated by a **Bearer ID token** (ln 8-20), not App Check; HTTP has no App-Check option. (Class INTERNAL/NA, but listed here because it must not be swept into any App-Check gate.)
8. **`testSmsHttp`** (`userManagement.ts:191`, `onRequest`) — admin SMS test tool, **Bearer ID token** SUPER_ADMIN gate (ln 193-208); HTTP, App Check N/A.

Note on the anon *callables* (`reserveSquare`, `purchasePropCard`, `createClaimCode`, `joinWaitlist`, `validateBillingAccess`, `resolveReferralToken`): these run inside the web app and **can** attach an App Check token even without a signed-in user, so they are NOT on the permanent-exempt list — they are exactly the abuse surface App Check should protect. During rollout they stay in Monitoring (soft) per PLAN #5 until coverage-by-version is proven, then flip to enforce; they are not exempt forever.

---

## Sweep 3 — Anonymous / unauthenticated callables (rate-limiter identity problem)

8 callables can complete with **no `request.auth`**. There is no `uid` to key the sharded `identity:endpoint:appId:window` bucket on, so each needs a stable non-uid identity from its payload (+ App Check token + `appId`).

| callable | file:line | why anon | stable non-uid identity available in payload |
|---|---|---|---|
| `createClaimCode` | participant.ts:43 | no auth check at all; links a code to a guest key | **`guestDeviceKey`** (required, ln 50-53) + `poolId` |
| `joinWaitlist` | waitlist.ts:14 | no auth check; anon hot-pool write | **`poolId`** + `email` (both required, ln 16-22); key on App-Check token + `poolId` + `appId` (email is user-supplied/spoofable) |
| `reserveSquare` | squares.ts:13 | explicit guest path — unauth users allowed if `customerDetails.name` present (ln 22-43) | **`guestDeviceKey`** (ln 20), else `customerDetails.email` / `poolId` |
| `purchasePropCard` | propBets.ts:10 | explicit guest mode — `userId = \`guest:${email}\`` when unauth (ln 24-32) | **`email`** (guest id derived from it) + `poolId` |
| `validateBillingAccess` | billing.ts:230 | **zero auth check** — reads billing status for any `poolId` | `poolId` (only field; low-value read but still an unauthenticated fan-out) |
| `resolveReferralToken` | referral.ts:88 | auth is optional (only used to block self-referral, ln 100) | `token` (the referral token itself) |
| `logClientError` | logClientError.ts:27 | pre-auth crash sink (App-Check-exempt) | App-Check token only (no stable payload id); size-cap + severity-whitelist is the current throttle |
| `getServerTime` | serverTime.ts:8 | no auth; canary | none (no payload) — rate-limit by App-Check token / IP if guarded at all |

PLAN #5's abuse-prone anon set named only `createClaimCode` and `joinWaitlist`. **`reserveSquare` and `purchasePropCard` are the higher-value anon writes** (they create paid squares / prop cards for guests) and MUST be added to the anon-keyed limiter — see Corrections C2.

---

## Sweep 4 — Multi-shape callables (need `discriminatedUnion`, not a flat `.strict()`)

10 callables branch on a discriminant field. A single flat `.strict()` schema would reject valid variant-specific fields; each needs a zod `discriminatedUnion` (strict per variant) or a split into separate callables.

| callable | file:line | discriminant | variants | notes |
|---|---|---|---|---|
| `adminManageCoupon` | adminBillingOps.ts:70 | `op` | create \| delete \| toggle | create needs `data.code`; delete/toggle need `couponId` |
| `adminUpdatePoolBilling` | adminBillingOps.ts:111 | `action` | override \| extendTrial \| resetGrace | override needs `data`; resetGrace reads `data.gracePeriodDays` |
| `adminSaveBillingConfig` | adminBillingOps.ts:28 | `kind` | billing \| referral | billing branch is zod-validated; referral is passthrough — union keeps that asymmetry |
| `createCheckoutSession` | stripe.ts:161 | `bundleType` presence | bundle-purchase vs pool-checkout | pool path already uses `checkoutPoolInputSchema`; bundle path is hand-checked (PLAN #1/#3 already flags this one) |
| `managePlayoffEntry` | playoffPools.ts:265 | `action` | togglePaid \| delete | `value` only meaningful for togglePaid |
| `adminGrantEntitlement` | entitlements.ts:169 | `productKind` | CREDIT_BUNDLE \| UNLIMITED_PASS | different required fields (creditsTotal vs termDays/maxPlayers) per kind |
| `adminRevokeEntitlement` | entitlements.ts:327 | `scope` | bundle \| credit \| pass | scope=credit additionally requires `creditId` (ln 340) |
| `setPaidStatus` | setPaidStatus.ts:14 | `claim` presence | member self-report (`claim` present) vs authoritative mark | two different authz paths AND payload shapes on the same callable (ln 24-34) |
| `createPool` | poolOps.ts:216 | `type` (+ flat vs `{type,config}`) | SQUARES / BRACKET / NFL_* | **stays permissive** per ADR-0001 — union is descriptive; do NOT `.strict()` until client cutover |
| `createNFLPool` | nflPools.ts:56 | `type` | NFL_PICKEM \| NFL_SURVIVOR \| NFL_MARGIN | settings shape differs per type; keep permissive with the create gate until cutover |

PLAN §1/§3 named only `createCheckoutSession`, `adminManageCoupon`, `adminUpdatePoolBilling`. The other 7 (`adminSaveBillingConfig`, `managePlayoffEntry`, `adminGrantEntitlement`, `adminRevokeEntitlement`, `setPaidStatus`, plus the two permissive creates) are additional discriminated-union work the implementer must not miss — see Corrections C1.

---

## Corrections to the plan (vs. actual code)

**C1 — Multi-shape set is under-counted.** PLAN #1 lists only `createCheckoutSession`, `adminManageCoupon`, `adminUpdatePoolBilling` as multi-shape. Code shows **10** discriminated callables (Sweep 4). Missing from the plan: `adminSaveBillingConfig` (`kind`, adminBillingOps.ts:28), `managePlayoffEntry` (`action`, playoffPools.ts:265), `adminGrantEntitlement` (`productKind`, entitlements.ts:169), `adminRevokeEntitlement` (`scope`, entitlements.ts:327), `setPaidStatus` (`claim` presence, setPaidStatus.ts:14), and the two permissive creates `createPool`/`createNFLPool`. Each will break under a flat `.strict()`.

**C2 — Anon rate-limiter set omits the two highest-value guest writes.** PLAN #5 names `createClaimCode` and `joinWaitlist` as the unauthenticated abuse paths and puts `reserveSquare`/`purchasePropCard` only in the authed pool-writes list (§3). But **`reserveSquare` (squares.ts:22-43) and `purchasePropCard` (propBets.ts:24-32) both run fully unauthenticated in a guest path** — they create paid squares / prop cards with no `uid`. They must be keyed by `guestDeviceKey`/`guest:email` (not `uid`) exactly like `createClaimCode`, or the limiter collapses every guest into one hotspot bucket. Also `validateBillingAccess` (billing.ts:230) and `resolveReferralToken` (referral.ts:88) are unauthenticated and were not identified as anon anywhere in the plan.

**C3 — `confirmPayment` validates BEFORE it authenticates.** PLAN #3 says replace `confirmPayment`'s hand-rolled `if (!poolId…)` with a schema. Note the ordering bug the wrapper fixes for free: today the input check (`confirmPayment.ts:19`) runs **before** the auth check (`confirmPayment.ts:24`), so an unauthenticated caller can probe input-shape errors. The `validated()` wrapper must run auth first, then schema.

**C4 — `syncAllUsers` has NO role gate (CONFIRMED real). `simulateGameUpdate` DOES (false positive — corrected).**
- `syncAllUsers` (userSync.ts:58-62): checks only `request.auth`; **any signed-in user** can trigger a listing of up to 1000 Auth users (emails/providers) written into `users/{uid}` docs. No SUPER_ADMIN gate. **Genuine latent authz hole** — flag for a role gate independent of the validation work.
- `simulateGameUpdate` (scoreUpdates.ts:1261): the handler HEAD only checks `request.auth`, but the real authz gate is **inside the transaction** (`scoreUpdates.ts:1288-1297`): SUPER_ADMIN OR pool owner/manager/coManager, else `permission-denied`. This was a head-only-read false positive — it is **NOT** an authz hole. (Matches the mmp-change-control record that the old `simulateGameUpdate` any-user hole was fixed.) Verified by Claude 2026-07-09.

**C5 — Admin authz is inconsistent and partly reads a MUTABLE Firestore role.** The plan assumes admin callables are role-gated. They are, but via three different mechanisms, and several read `users/{uid}.role` from Firestore (spoofable if a user doc is compromised) instead of the tamper-proof JWT claim: `updateTournamentData` (bracketOps.ts:104-105), `importTournamentFromESPN`/`adminInitTournament`/`syncBracketTournament`/`importConferenceTournamentFromESPN`/`syncPlayInPicks` (espnBracket.ts — token OR users-doc fallback), `updateGlobalPlayoffResults` (playoffPools.ts:367-368), `initializeBigEast/Big12TournamentHttp` (conferenceTournaments.ts:171-173/359-361). The plan's `validated()` wrapper is a good place to also standardize on `assertCallerRole` (JWT-claim) and retire the Firestore-role fallback.

**C6 — Some money/admin writes the plan omitted from the first wave.** PLAN §3's TARGET list is missing several money/entitlement/admin-write callables that clearly belong in wave 1: `adminGrantEntitlement`/`adminRevokeEntitlement` (entitlements.ts — grant/revoke real credits & passes), `createCouponTemplate`/`updateCouponTemplate`/`mintCouponFromTemplate` (couponTemplates.ts — mint real coupons), `managePlayoffEntry` (togglePaid/delete), `setPaidStatus` (payment mark), `updateTournamentData` (raw `tournamentData` merge with NO validation), `updateGlobalPlayoffResults`, and `sendManualReminder`/`sendPoolInvites` (email/SMS fan-out abuse surface). I placed these in TARGET-NOW in Sweep 1; the plan text should be updated to match so they aren't silently deferred.

**C7 — `submitBracketEntry` has NO head-level validation.** Unlike its siblings it does zero field checks in the callable — it delegates straight to `submitBracketEntryInternal(request.auth.uid, request.data, db)` (bracketEntries.ts:344). The plan lists it as a pick-submit target; note the schema must be applied at the wrapper since the internal helper currently trusts `request.data` wholesale.

**C8 — `validateBillingAccess` is a public read, not the authed billing path.** It has no `request.auth` reference (billing.ts:230-251) and returns billing status for any `poolId`. The plan's "Billing plane" discussion implies these are gated; this one is not. Low severity (read-only) but it belongs in the anon inventory and should get App Check + a light limiter.
