# Bare `onCall(` callables — classification (2026-07-22)

A classification pass, **not** a sweep. Nothing in this document was changed;
it exists so the next person deciding what to harden starts from evidence
rather than from a count in a stale doc.

## The count was wrong

There are **26** bare-`onCall(` callable exports in `functions/src`, not 25.

Two corrections to what the docs said:

- `HANDOFF.md` and `PICKUP-PRESEASON-PILOT.md` both said **25**. They also said
  "~16 sim-harness"; it is **14** (11 in `simHarness.ts`, 3 in `simLegacy.ts`).
- `PICKUP-CALLABLE-SWEEP.md` warns that `searchUsersByEmail` is declared
  `functions.https.onCall` and that a plain grep misreports it. **That note is
  now stale** — it was migrated and is `validated(...)` at
  `functions/src/userManagement.ts:228` with `role: ["SUPER_ADMIN","MODERATOR"]`.
  There is zero `functions.https.onCall` left in `functions/src`.

All 26 are exported from `index.ts`. **No dead-code callables.**

## The gate that matters

`assertCallerRole` (`functions/src/lib/assertRole.ts`) requires the role to
match in **both** the JWT claim **and** `users/{uid}.role`, specifically to
block a demoted-but-unrefreshed token. **Every bare callable below that checks a
role does so from the claim only.** That is the single shared weakness.

`validated()`'s `role:` option closes it for the callables whose authorization
is purely role-based — but **not** for the ones that also admit non-admins
through persisted ownership, because `role:` runs before the handler and would
reject them. `recordPoolPayouts` is the example; see the ordering note below.

## Verdict

| Bucket | Count |
|---|---|
| GENUINELY FINE | 13 |
| WANTS `validated()` | 12 |
| DEFERRED BY DESIGN | 1 |

### GENUINELY FINE (13)

`getServerTime` (`serverTime.ts`) returns `Date.now()` — no auth, no input, no
data, no trust boundary. `logClientError` (`logClientError.ts`) is deliberately
pre-auth so the global ErrorBoundary can reach it, and already does what
`validated()` would: hand whitelist, per-field size caps, server-stamped uid.
Requiring auth would break its purpose. *(It does ship with
`enforceAppCheck: false` and a documented TODO — an unauthenticated write path
into `system_logs` whose only defence is those caps. Worth knowing.)*

The 11 `simHarness.ts` callables are the caller's explicit carve-out and hold
up on inspection: `assertSuperAdmin` plus, more importantly, `getVerifiedSimPool`'s
persisted `simRunId` match, which refuses any non-sim pool **regardless of
role**. That anchor — not the role check — is what makes them safe, and it is
why `simLegacy.ts` lands in the next bucket instead.

### WANTS `validated()` (12)

| Callable | File | Why |
|---|---|---|
| `simulateGameUpdate` | `scoreUpdates.ts:1263` | **Highest risk.** Entry gate is only "is anyone logged in"; the real authorization happens inside a Firestore transaction off a claim-only role read; `scores` gets **one truthiness check** before `processGameUpdate` computes winners and can auto-generate axis numbers. The comment still says "Relaxed Auth for Dev/Test" while the code below acknowledges it decides winners on real pools. |
| `backfillProfileData` | `migrations/backfillProfileData.ts:42` | A 540s / 1GiB mass mutation over every non-sim NFL pool that also toggles `system/config.profileBackfill.suppressTriggers`, behind a single claim read, with `afterPoolId` taken off `request.data` untyped. The dry-run default is the only thing between a stale admin token and a repo-wide rewrite. |
| `recordPoolPayouts` | `payoutRecords.ts:36` | Writes the **money ledger** — `payoutRecords`, `payoutRecordsPrivate`, ledger events, profile recomputes. Its hand validation is the best in this set and I would not rush to replace it; the *role* half of `assertPoolOwnerOrSuperAdmin` is claim-only, which is exactly the case `assertCallerRole` exists to close. |
| `simSetTournament` | `simLegacy.ts:61` | Writes an **arbitrary client object** over `tournaments/{id}` behind a claim-only role check. No `simRunId` anchor — the file's own header admits the tournament doc is shared test infrastructure, not a Test Pool. |
| `simDeleteTournament` | `simLegacy.ts:94` | Destructive delete, claim-only. |
| `simFillSquares` | `simLegacy.ts:123` | Overwrites an entire squares grid, claim-only. |
| `generateTestScenario` | `aiTesting.ts:95` | Claim-only gate, **zero** input validation, spends real Gemini budget (300s / 1GiB). |
| `validateTestResults` | `aiTesting.ts:147` | Same, and dereferences `scenario.poolType` unguarded. |
| `generateTestReport` | `aiTesting.ts:199` | Same pattern, third copy. |
| `refreshExpertProfiles` | `expertProfiles.ts:153` | Claim-only; `Number(seasonType \|\| 2)` accepts NaN into a write path. |
| `refreshSiteAverages` | `siteAverages.ts:78` | Seven lines, claim-only, triggers a site-wide recompute. |
| `getProfilePoolDetail` | `userProfile.ts:126` | Lowest severity here — read-only, and its per-pool authorization is sound; the admin bypass is claim-only and there is no schema. |

### DEFERRED BY DESIGN (1)

`createBracketPool` (`bracketPools.ts:24`) — line 101's `...settings` spread
passes arbitrary client keys through into the stored pool object. A flat
`.strict()` schema would reject data it currently persists. Needs a passthrough
envelope or a client cutover, which is its own careful batch. This is already
recorded as deferred in `HANDOFF.md` and the SWEEPS matrix.

## Recommended order, if this becomes work

1. `simulateGameUpdate` — the only one where an unvalidated client object
   reaches winner determination on real pools.
2. `backfillProfileData` — blast radius.
3. `recordPoolPayouts` — money, but **NOT a one-line `role:` gate.**
   `validated()`'s `role:` runs `assertCallerRole` BEFORE the pool is loaded,
   which would reject ordinary pool owners and co-managers — and this callable
   deliberately admits them via persisted pool ownership, through
   `assertPoolOwnerOrSuperAdmin`. An unconditional role gate here would break
   normal commissioner payout recording. Use `validated()` for the auth +
   schema boundary only, and separately harden the SUPER_ADMIN *bypass* to check
   the user document as well as the claim.
4. `simLegacy.ts` ×3 — no `simRunId` anchor, unlike their `simHarness` siblings.
5. The rest as convenient. `aiTesting` ×3 are cheap and spend real money on
   failure.

**Not urgent for preseason.** None of these is a regression, and none is on the
NFL pilot path. This is a list to work from in September, not before 2026-08-13.
