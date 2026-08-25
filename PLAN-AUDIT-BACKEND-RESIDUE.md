# PLAN-AUDIT-BACKEND-RESIDUE

Plan of record for **NEXT-SESSION-AUDIT-FIXES.md items 14 and 17** — the 2026-08-24
cloud re-audit's job-sizing finding and the backend re-audit's residue list.

Companion review log: `PLAN-AUDIT-BACKEND-RESIDUE-REVIEW-LOG.md`.

## 0. Why a plan doc at all, and why not PLAN-AUDIT-AUTH-HARDENING.md

**Classification: PLAN-GATED — authorization.** `mmp-change-control` §1 scopes the
gate to blast radius: money / authorization / production data / scoring. Items
17(a), 17(b) and 17(d) change **who is allowed to do what**. They are a
*tightening* — every principal admitted after the change was already admitted
before it — but the reverse is not true: a caller holding a `SUPER_ADMIN` JWT
claim whose `users/{uid}.role` doc says otherwise **passed before and is refused
after**. That is a behaviour change in an authorization concern, so the ordinary
lane is not available. §1's own words: the ordinary lane for a path like this is
earned "with evidence, not assertion" that behaviour is unchanged — and here it
deliberately is not unchanged.

Item 17(b) additionally touches **production data**: `backfillProfileData` is a
prod migration callable.

Items 14, 17(e) and 17(f) are ordinary on their own; they ride this plan because
they ship in the same PR.

**Why this file and not a phase appended to `PLAN-AUDIT-AUTH-HARDENING.md`:**
that file is owned by a concurrently-running workstream in this same overnight
batch (S1). Two sessions appending phases to one plan file is the exact
worktree-collision shape Rule 4 exists to prevent, and a plan doc that loses a
three-way merge is worse than a separate one. This plan cross-references
PLAN-AUDIT-AUTH-HARDENING Phase A rather than extending it: A1 closed the last
two claim-only gates the auth audit *found*; the backend re-audit then found nine
more of the same class that A1's grep did not reach.

## 1. Item 14 — explicit timeout/memory on three scheduled jobs

### The defect

Three `onSchedule` jobs declare no `timeoutSeconds` and no `memory`, so they run
on the Gen-2 defaults (60s / 256MiB). The named concrete failure is
`runReminders`: it scans a bounded union of pool docs and then sends email and
SMS per pool, and a 60-second wall kills the run **mid-send** — some members
notified, some not, no error a reader would connect to the cause.

`setGlobalOptions({ maxInstances: 10 })` (#548) is **not** touched: an inline
`timeoutSeconds`/`memory` merges with the global options object; only a key
actually named inline overrides. `maxInstancesInvariants.test.ts` continues to
pin the global cap.

### The sizes, and the peer that justifies each

Every value below is already in use in this repo. Nothing new is invented.

| Job | Cadence | Chosen | Peer that justifies it |
|---|---|---|---|
| `syncNFLScoresJob` | `*/5 * * * *` | **270s / 512MiB** | `nflAutoScoreJob` (`nflAutoScore.ts:666`) — the *same* `*/5` cadence, 270s/512MiB, with a written invariant: "timeoutSeconds MUST stay under the cadence… 270s is still far more than a real pass needs". Same cadence ⇒ same ceiling. |
| `runReminders` | `every 15 minutes` | **540s / 512MiB** | `nflFinalizeSweepJob` (`nflFinalize.ts:507`) and `recomputeGlobalStatsDaily` (`statsTrigger.ts:527`), both 540s/512MiB — the repo's ceiling value, used for the whole-collection scan-and-write jobs. 540s < the 900s cadence gap, so two runs still cannot overlap. This is the job the audit named, and it does the most per-run work of the three. |
| `nflDeepScoreSweepJob` | `30 11 * * *` | **540s / 512MiB** | Same two daily peers. It is a 7-day-wide `syncScoresWindow` — strictly the heaviest variant of the same call `syncNFLScoresJob` makes on a 24h window. |

512MiB across the board because **every** sized scheduled job in this repo uses
512MiB except the three trivial ones (`aggregateRevenueDaily` at 256MiB and the
two `onRequest` page handlers). Consistency is the point; none of the three has
a measured memory problem to size against.

### Scope note — 14 jobs lacked sizing, item 14 names 3

A brace-matched scan of all 24 `onSchedule` call sites found **14** with no
explicit sizing. Item 14 names three. The other **eleven** —
`checkPlayoffScores`, `consensusRefreshJob`, `enforceBillingStatus`,
`gradeExpertProfilesJob`, `lockNFLSpreadsJob`, `scheduledBracketSync`,
`scheduledHealthCheck`, `siteAveragesJob`, `syncExpertPicksJob`,
`syncWinProbabilityJob`, `webhookDurabilitySweep` — live in files other
workstreams own tonight, so they are **not** changed here. They are pinned as a
named known-gap allowlist in the guard below, which asserts the unsized set
*equals* that list: the number can go down, and a NEW unsized job trips it.

### Guard

`__tests__/jobSizing.test.ts`: scans every `onSchedule` call site, asserts the
three named jobs declare BOTH `timeoutSeconds` and `memory`, and asserts the
remaining unsized set equals a pinned allowlist — so a NEW scheduled job cannot
ship unsized without tripping it.

## 2. Item 17 — backend residue

### 17(a) — three claim-only SUPER_ADMIN gates in `aiTesting.ts`

`generateTestScenario`, `validateTestResults`, `generateTestReport` each gate on
`request.auth.token.role !== "SUPER_ADMIN"` alone. Replaced with
`assertCallerRole(request, "SUPER_ADMIN")` — the identical edit
PLAN-AUDIT-AUTH-HARDENING A1 made to `siteAverages.ts` and `expertProfiles.ts`.
These three run paid Gemini jobs, so the principal set that can drain the quota
is exactly the concern.

### 17(b) — `backfillProfileData` is a raw `onCall` with no schema

Wrapped in `validated({ schema, role: "SUPER_ADMIN", appCheck: "monitor",
options: { timeoutSeconds: 540, memory: "1GiB" } })`, matching its four sibling
migrations (`backfillMemberRecords`, `backfillPublishedWeeks`,
`reconcilePaymentTruth`, `backfillFrozenSpreads`). New
`backfillProfileDataSchema` in `schemas/migrations.ts` follows that file's
conventions verbatim: `dryRun` defaults **true at the schema layer** (Rule 1, the
#183 lesson), and the resume cursor takes `null` as first-page (the JS SDK
`undefined`→`null` wire encoding, found in prod 2026-07-27).

The only live caller is `OperationsPanel.tsx`, which sends `{ dryRun }` and
nothing else — verified by grep; `afterPoolId` has zero client callers today but
stays in the schema because the handler implements the cursor.

### 17(c) — DEFERRED, not done

Stale header comment in `schemas/bracketPools.ts`. That file is owned by
workstream S1 in this same batch. Deliberately untouched; the coordinator lands
it separately.

### 17(d) — five claim-only admin-bypass branches on owner-gated paths

Six code sites, five callables:

| Site | Shape before |
|---|---|
| `playoffPools.ts:280` (`managePlayoffEntry`) | `const isAdmin = request.auth!.token.role === 'SUPER_ADMIN'` |
| `scoreUpdates.ts:1335` (`simulateGameUpdate`) | `const isSuperAdmin = request.auth?.token.role === 'SUPER_ADMIN'` |
| `userProfile.ts:113` (`recomputeMyProfile`) | `request.auth.token?.role !== 'SUPER_ADMIN'` |
| `userProfile.ts:138` (`getProfilePoolDetail`) | `const isAdmin = request.auth.token?.role === 'SUPER_ADMIN'` |
| `nflPools.ts:2019` (`scoreNFLWeek`) | `token.role \|\| 'USER'` → `assertPoolOwnerOrSuperAdmin` |
| `poolOps.ts:782` (`toggleWinnerPaid`) | same |

`assertCallerRole` **throws**; a bypass branch needs a **boolean**. New
`lib/confirmedRole.ts` provides it:

- `hasConfirmedRole(request, ...roles): Promise<boolean>` — the boolean half.
- `confirmedAdminClaim(request): Promise<string | undefined>` — returns the raw
  claim, except an **unconfirmed** `SUPER_ADMIN` claim becomes `undefined`. This
  is for the two sites that hand a role *string* to
  `assertPoolOwnerOrSuperAdmin`, whose signature is shared with three files this
  workstream does not own (`invites.ts`, `manualReminders.ts`,
  `payoutRecords.ts`) and therefore must not change.

**The doc read is short-circuited.** No Firestore read happens unless the claim
already says `SUPER_ADMIN`, so a normal member pays nothing. This is not a new
idea: `stripe.ts:234`'s `readCallerRole` (PLAN-COMMISSIONER-TRANSFER K17) is the
same shape, with the same comment — "not claiming SA — no doc read needed".

**Fail-closed on a read error.** A `users/{uid}` read that throws yields `false`
(logged), never `true`. The caller then falls to the owner check, which is what a
principal we cannot confirm should get.

**`scoreUpdates.ts` resolves the flag OUTSIDE the transaction**, following the
`assertNotBannedLive` comment eleven lines above it: a plain `get()` inside
`runTransaction()` is re-executed on every retry without the transaction's
consistency guarantees.

**Why `assertPoolOwnerOrSuperAdmin` itself is not changed:** it is synchronous
and pure, called from six sites, three of them in files another workstream owns
tonight. Making it async would be a cross-workstream signature change for no
extra safety — resolving the effective role at the call site is equivalent and
local.

### 17(e) — REJECTED, with a partial

**The premise does not hold.** Measured, not asserted (`safeParse` of a valid
payload plus one unknown key, run under vitest):

| Schema module | Finding |
|---|---|
| `schemas/opsHealth.ts` | `z.object({}).strict()` — already rejects unknown keys |
| `schemas/prodWatchdog.ts` | `noInputSchema` = `z.preprocess(v => v ?? {}, z.strictObject({}))` — already rejects |
| `schemas/squaresProps.ts` | all three exported schemas are `z.strictObject` — already reject |
| `schemas/tournamentAdmin.ts` | all three exported schemas are `z.strictObject` — already reject |

The only non-strict nodes anywhere in the four files are **two nested stripping
objects**, and both are deliberate with the reasoning already written down:

1. `squaresProps.customerDetails` — "STRIPPING object (not strict): unknown keys
   are dropped before they can reach the `squarePrivate` PII doc". This is a
   **public guest** purchase flow; making it strict converts a currently-tolerated
   extra key into a hard rejection on a money-adjacent path nobody controls.
2. `tournamentAdmin.updateGlobalPlayoffResultsSchema.results` — the round-trip
   shape `PlayoffResultsManager` echoes back from the stored doc. Strict here
   would reject a legacy key that exists in production data.

Tightening either is a regression, not a hardening, so 17(e) is **rejected**.

**The partial that IS done:** the doc comment above
`updateGlobalPlayoffResultsSchema` reads "Non-strict object: a legacy key … is
stripped, not rejected" while the schema it sits on is `z.strictObject`. The
sentence describes the *nested* `results` object, not the declaration underneath
it. That is the same defect class 17(c) reports — a comment describing code that
changed — and the file is in scope, so it is corrected. The audit pointed at
something real; it just was not the thing it claimed.

A guard pins all four modules' strictness so the claim cannot be re-raised
without evidence, and pins the two nested strippers as deliberate.

### 17(f) — `getProfilePoolDetail` is a raw `onCall`

Wrapped in `validated({ schema, auth: "required", appCheck: "monitor" })` with a
strict `{ subjectId, poolId }` schema in `schemas/userProfile.ts`. The hand-rolled
`invalid-argument` checks the wrapper subsumes are deleted; the per-pool viewer
authorization stays in-handler unchanged (it needs the pool doc, which the gate
stage cannot see).

Safe against the live caller: `dbService.ts:660` sends
`withCorrelationId({ subjectId, poolId })`, and `validated()` strips
`_correlationId` before the schema ever sees it.

## 3. Sweep — the complete instance lists

Deterministic, and each one is re-runnable.

**S1 — every claim-only `SUPER_ADMIN` compare left in `functions/src`.**

```
grep -rn "token\??\.\(token\.\)\?role\s*[!=]==\s*['\"]SUPER_ADMIN['\"]" functions/src --include=*.ts
```

After this PR the survivors are: `bracketPools.ts` (S1's file this batch),
`nflPickReveal.ts:162` (already documented as claim+doc via `assertCallerRole`
immediately below), `poolOps.ts` inside `assertPoolOwnerOrSuperAdmin` /
`assertPoolOwnerOrManagerNoCo` (the shared helpers, fed a **resolved** role by
this PR's two call sites but still raw at three call sites in files this
workstream does not own), and `userManagement.ts`. **Named, not closed** — the
remaining set is a follow-up item, and this PR does not claim the class is
finished.

**S2 — every `onSchedule` without explicit sizing.** Machine-generated by
`__tests__/jobSizing.test.ts`; the allowlist in that file IS the list.

**S3 — every bare `onCall` in `functions/src` (no `validated()`).**

```
grep -rn "= onCall(" functions/src --include=*.ts
```

This PR removes two (`backfillProfileData`, `getProfilePoolDetail`). The rest are
outside items 14/17 and outside this workstream's file set.

## 4. Test plan — the standing rule

Every change ships with its own test in the same PR, and a hardening ships with a
test proving the gate **now refuses what it used to allow**.

- `__tests__/jobSizing.test.ts` — item 14.
- `__tests__/backendResidue.test.ts` — 17(a), (b), (d), (e), (f), including the
  behavioural proof for `hasConfirmedRole`: a caller whose claim says
  `SUPER_ADMIN` and whose `users/{uid}.role` doc says `MEMBER` gets `false`
  (it used to get `true`), a matching claim+doc gets `true`, a non-admin claim
  gets `false` **with no Firestore read at all**, and a read that throws yields
  `false` rather than `true`.

## 5. Not done here / open

- 17(c) — deferred to the coordinator (S1 owns the file).
- The remaining ten unsized scheduled jobs (§1 scope note).
- The remaining claim-only compares from sweep S1 (§3).
- `assertPoolOwnerOrSuperAdmin`'s three other call sites still pass a raw claim.
  Closing those means making the shared helper async, which is a cross-file
  change this workstream cannot make safely tonight.
