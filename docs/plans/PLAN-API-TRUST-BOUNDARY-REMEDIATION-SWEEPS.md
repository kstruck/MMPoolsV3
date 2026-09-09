# PLAN-API-TRUST-BOUNDARY-REMEDIATION — SWEEPS

Deterministic, grep-derived complete instance lists. All commands run from
`D:\march-melee-pools\functions\src` on 2026-09-01 against the working tree at
`main` (`fa0100cf` + this plan's uncommitted docs). Re-run the command before
trusting a list.

## S1 — Raw `onCall` exports (no `validated()` wrapper)

Command:
`grep -rn "export const \w* = onCall(\|functions.https.onCall(" --include=*.ts . | grep -v __tests__ | grep -v lib/validated.ts`

26 exports. Zero `functions.https.onCall` callables remain (the only
`functions.https.*` uses are the two `onRequest` HTTP endpoints in S6).

| # | Callable | File:line | Verdict |
|---|---|---|---|
| 1 | generateTestScenario | aiTesting.ts:96 | claim+doc gated; **input fix Phase 2** |
| 2 | validateTestResults | aiTesting.ts:150 | same |
| 3 | generateTestReport | aiTesting.ts:204 | same |
| 4 | createBracketPool | bracketPools.ts:30 | **null-shape guard Phase 2**; keeps gate order (exception) |
| 5 | refreshExpertProfiles | expertProfiles.ts:159 | claim+doc gated; **typed schema Phase 2** |
| 6 | logClientError | logClientError.ts:36 | exception: deliberately pre-auth, hand caps |
| 7 | recordPoolPayouts | payoutRecords.ts:204 | exception: hand cross-field money validation; **claim-half hardened Phase 3** |
| 8 | setPayoutSettled | payoutRecords.ts:426 | same |
| 9 | simulateGameUpdate | scoreUpdates.ts:1293 | **schema Phase 2 + error fix Phase 1**; auth already claim+doc/ownership |
| 10 | notifyPasswordReset | securityNotices.ts:65 | exception: public by design, constant response, rate-limited |
| 11 | getServerTime | serverTime.ts:8 | exception: no auth/input/data |
| 12–22 | simStartRun, simWriteEntries, simUpdatePool, simSeedNFLGames, cleanupSimPool, sweepSimRuns, simJoinMembers, simSubmitPicks, simExecuteRebuy, simReportRun, simFinalizePool | simHarness.ts:79–772 | exceptions: null-safe destructure + typed hand checks + simRunId/namespace anchors; **assertSuperAdmin → claim+doc Phase 3** |
| 23–25 | simSetTournament, simDeleteTournament, simFillSquares | simLegacy.ts:63,96,125 | exceptions: null-safe + typed hand checks; **claim-only role → claim+doc Phase 3** |
| 26 | refreshSiteAverages | siteAverages.ts:89 | claim+doc gated; consumes no input |

## S2 — `request.data` consumed outside `validated()` handlers

Command:
`grep -rn "request\.data" --include=*.ts . | grep -v __tests__ | grep -v lib/validated.ts | grep -v lib/correlationId.ts`
(comment-only hits excluded below)

Unsafe-before-parse (destructure of possibly-null `request.data`):

| File:line | Handler | Fix |
|---|---|---|
| aiTesting.ts:107,161,215 | the 3 AI callables | Phase 2 named schemas |
| bracketPools.ts:35 | createBracketPool | Phase 2 shape guard |
| scoreUpdates.ts:1302 | simulateGameUpdate | Phase 2 named schema |

Null-safe uses (no change; classified): expertProfiles.ts:161 (`|| {}`),
logClientError.ts:52 (`?? {}`), payoutRecords.ts:208,430 (`|| {}`),
securityNotices.ts:66 (`?.` + String), simHarness.ts ×11 and simLegacy.ts ×3
(`?? {}` + typed checks), nflPools.ts:118,146 / poolOps.ts:377 /
bracketPools.ts:137,142,148 (post-validation reads of the raw payload inside
`validated()`/gated handlers, `?.` or `|| {}` guarded).

## S3 — Direct JWT role comparisons (`role ===/!== 'SUPER_ADMIN'`)

Command:
`grep -rn "role\s*[!=]==\?\s*['\"]SUPER_ADMIN['\"]" --include=*.ts .` (variants collapsed)

| File:line | Kind | Verdict |
|---|---|---|
| simHarness.ts:108 | claim-only gate (11 callables) | **Phase 3 migrate** |
| simLegacy.ts:70,101,143 | claim-only | **Phase 3 migrate** |
| migrations/backfillMemberRecords.ts:168 | hand claim check inside validated() | **RECLASSIFIED at implementation: no change** — the `validated()` config already carries `role: "SUPER_ADMIN"` (claim+doc via assertCallerRole); the hand check is redundant belt, not the gate |
| migrations/reconcilePaymentTruth.ts:67 | hand claim check inside validated() | same — no change |
| setPaidStatus.ts:113 | claim-only admin bypass (money) | **Phase 3 migrate** |
| bracketEntries.ts:440 | claim-only admin bypass in transaction | **Phase 3 migrate (hoist)** |
| payoutRecords via assertPayoutAuthority (:217,:438 call sites) | claim-only half of owner-or-admin | **Phase 3: confirmedAdminClaim** |
| squares.ts:181,226 | **doc-only** (no claim check) | **Phase 3 migrate to claim+doc** |
| debug.ts:22 | HTTP, claim-only after verifyIdToken | **Phase 3: confirmedSuperAdminHttp** |
| userManagement.ts:204 (testSmsHttp) | HTTP, claim-only | **Phase 3: confirmedSuperAdminHttp** |
| nflPoolDues.ts:156 | claim short-circuit + assertCallerRole confirm | correct — no change |
| nflPickReveal.ts:185 | claim short-circuit + assertCallerRole confirm | correct — no change |
| bracketEntries.ts:440 aside, playoffPools.ts:282 / userProfile / nflPools / poolOps bypasses | already hasConfirmedRole/confirmedAdminClaim (pinned by backendResidue.test.ts) | no change |
| nflPickReveal/nflPoolDues claim reads, scoreUpdates:1327 | hint-then-confirm pattern | no change |

**S3b — INDIRECT claim passes (codex r1 #1): raw `token.role` handed to
`assertPoolOwnerOrSuperAdmin` / `loadPoolAndAssertManager`.** Command:
`grep -rn "assertPoolOwnerOrSuperAdmin(\|loadPoolAndAssertManager(" --include=*.ts . | grep -v __tests__` then classify each call site's third argument.

| File:line | Callable | Verdict |
|---|---|---|
| invites.ts:73 | sendPoolInvites | **Phase 3: confirmedAdminClaim** |
| manualReminders.ts:62 | sendManualReminders | **Phase 3: confirmedAdminClaim** |
| poolParams.ts:27 | lockPoolAndAssignNumbers-shape | **Phase 3: confirmedAdminClaim** |
| poolOps.ts:505 | updatePoolSettings | **Phase 3: confirmedAdminClaim** |
| poolExceptions.ts:131,240,555,614 | extendWeekDeadline / proxy ops / cancelPool-shape / closePool (r2 #2) | **Phase 3: confirmedAdminClaim** |
| payoutRecords.ts:217,438 (via assertPayoutAuthority) | recordPoolPayouts / setPayoutSettled | **Phase 3: confirmedAdminClaim** (already listed above) |
| nflPools.ts / poolOps.ts toggleWinnerPaid / scoreNFLWeek sites | already resolve via confirmedAdminClaim (backendResidue pins) | no change |

**S3c — remaining raw-claim SUPER_ADMIN privilege decisions (codex r3 #1),
verified against source:**

| File:line | Decision | Verdict |
|---|---|---|
| coCommissioners.ts:54,68 | owner-gate bypass (pre-read + in-tx) | **Phase 3: confirmedAdminClaim resolved once, pre-tx** |
| nflEntryDelete.ts:427 (→:100) | `actorRole` bypass on destructive entry delete | **Phase 3: resolve at wrapper** |
| nflPools.ts:1029-1033 (submitNFLPicks), nflEntryRename.ts:195 | `actorRole` → `assertNFLPickMembership` SUPER_ADMIN bypass | **Phase 3: resolve at wrapper** (hot path pays zero reads via short-circuit) |
| nflPools.ts:118, poolOps.ts:340 | claim gates `simRunIdForCreate` (sim-pool minting past creation kill-switch) | **Phase 3: resolve at wrapper** |
| poolOps.ts:136-140 (`simRunIdForCreate`), nflPools.ts:414-422 (`assertNFLPickMembership`) | pure helpers receiving a role string | no change — call sites resolve |
| bracketEntries.ts:440, setPaidStatus.ts:113 | already listed in S3 above | — |
| assertNotBanned(claimRole, …) sites | ban check, not a privilege grant (doc half checked in-tx; assertNotBannedLive covers live bans) | classified, no change |

## S4 — Client-facing error text derived from caught errors

Command:
`grep -rn "HttpsError(['\"]internal['\"]" --include=*.ts .` + manual catch-body review + `grep -rn "reason: error.message"`

Leaks to FIX (Phase 1):

| File:line | Surface | Note |
|---|---|---|
| scoreUpdates.ts:1390 | simulateGameUpdate | also re-wraps expected HttpsErrors as internal |
| scoreUpdates.ts:1508 | fixPoolScores response `reason:` | payload leak, SUPER_ADMIN caller |
| userManagement.ts:67,146,179 | deleteUserAccount / sendAdminPasswordReset / sendSecuritySMSAlert | :179 reaches ordinary users |
| nflPools.ts:238 | createNFLPool | has instanceof guard; message still leaks |
| nflSchedule.ts:1495 | importNFLSchedule | |
| poolOps.ts:471 | createPool | fragile `error.code && error.details` guard |
| stripe.ts:884,958 | checkout callables | provider message → ordinary users |
| authBackup.ts:817 | runAuthBackup | failure already durably recorded |
| bracketScoring.ts:375 | scoring callable | `msg` from caught e |
| billing.ts:566 | getPoolQuote (public) | codex r1 #4 — caught `e.message` as `invalid-argument`; keep code, use stable text |
| stripe.ts:516 | checkout quote path | same |

Safe / no change: every parameterized business error naming ids/teams/amounts
(bracketEntries, nflPools GAME_LOCKED family, payoutRecords binding errors,
feedReplay, espnBracket, coCommissioners, entitlements, billing, confirmPayment,
poolExceptions, nflSpreadOverride, authBackup.ts:789 static, aiTesting generic
strings, waitlist/userSync/nflEntryDelete static, stripe.ts:917,1025 static);
server-side-only messages (heartbeat returns, audit `error:` fields, console
logs, scheduled-job `{ok:false,error}` returns that never reach a client);
`lib/aiProviderError.ts` stable reason codes (deliberate).

## S5 — Collection scans without cursor/limit/cap

Command:
`grep -rn "collection(...).get()" family` (see command in repo history; per-pool subcollection scans grouped)

Top-level unbounded scans (fix in Phase 4):

| File:line | Scan | Fix |
|---|---|---|
| backfill.ts:14 | all `pools` + :96 entries of completed pools | cursor+cap+kill-switch |
| poolOps.ts:825 (fixParticipantIds) | all `pools` + :855 entries | cursor+cap |
| siteAverages.ts:55 | all `publicProfiles` (projected) | paged loop + page cap + truncation flag |

Member-facing per-pool scan getting an explicit cap (Phase 4):

| nflPickReveal.ts:334 | pool entries (field-masked) | limit(CAP+1), fail-loud |

Classified, no change (bounded by pool size = caller contract; commissioner/
admin/scheduled surfaces): aiCommissioner.ts:327, bracketScoring.ts:226,407,492,
consensus.ts:70, debug.ts:46, espnBracket.ts:1402, lib/commissionerAggregate.ts:15,
lib/rosterSummary.ts:39, manualReminders.ts:85-86, migrations/* (already
cursor+capped per run), nflFinalize.ts:362, nflPoolDues.ts:108-109,
nflPools.ts:1542,1598, poolExceptions.ts:88, poolOps.ts:675, expertProfiles.ts:94
(experts collection, tiny), scoreUpdates fixPoolScores :1420 (filtered by
gameStatus in/post; SUPER_ADMIN tool — flagged Q2 in the plan).

## S6 — HTTP endpoints and accepted methods

Command: `grep -rn "export const \w* = ...onRequest" --include=*.ts .` + per-file `grep -n "req.method"`

| Endpoint | File | Methods accepted | Auth |
|---|---|---|---|
| inspectPoolState | debug.ts:5 | GET, HEAD | Bearer + SUPER_ADMIN (claim-only → **Phase 3**) |
| cspReport | cspReport.ts:382 | POST (OPTIONS preflight handled) | public report sink |
| manageEmailPrefs | emailPrefsPage.ts:73 | GET, POST | signed token |
| joinPreview | joinPreview.ts:26 | GET, HEAD | public preview |
| emailUnsubscribe | emailUnsubscribeHttp.ts:16 | GET | signed link |
| readiness | readiness.ts:17 | GET, HEAD | public probe |
| handleStripeWebhook | stripe.ts:1384 | POST | Stripe signature |
| testSmsHttp | userManagement.ts:187 | GET, POST | Bearer + SUPER_ADMIN (claim-only → **Phase 3**) |

`__tests__/httpSurfaceInvariants.test.ts` already enforces "every onRequest has
a req.method check". No method sets change in this plan.
