# PLAN-API-TRUST-BOUNDARY-REMEDIATION

**Status: REVIEW CONVERGED (codex APPROVED, round 8) — implementation in progress. Kevin decisions Q1–Q3 carried in Risks; plan defaults match the commissioning prompt's explicit requirements (kill-switch, documented hard cap).**
**Date: 2026-09-01 (ET). Author: Claude session, from Kevin's codex API-audit remediation prompt.**
**Classification: PLAN-GATED (authorization + production-data tooling — mmp-change-control §1).**

## Goal

Close the four remaining backend API audit failures without changing any live
contract the frontend depends on, while the site is accepting new members and
pools:

1. **Safe, consistent error handling** — no client response carries a raw
   caught `error.message`.
2. **Complete input validation** — no callable destructures `request.data`
   before a safe parse; every remaining raw `onCall` is a reviewed, named
   exception guarded by a source invariant.
3. **Authorization hardening** — every SUPER_ADMIN decision uses the
   claim+`users/{uid}.role` agreement pattern (`assertCallerRole` /
   `hasConfirmedRole` / `confirmedAdminClaim`), including the two privileged
   HTTP endpoints.
4. **Bounded reads** — the three audited unbounded scans get a
   cursor/cap/dry-run contract that matches the repo's existing migration
   pattern (`backfillProfileData`).

No deploy, no prod-data mutation, no Firestore-rules change is part of this
plan. Callable RPC semantics are preserved — no REST rewrite.

## Verified baseline (what the audit got right and what is stale)

Verified against source on 2026-09-01. The codex audit is **partially stale**:
PLAN-AUDIT-BACKEND-RESIDUE (17a–17f) and PLAN-AUDIT-AUTH-HARDENING (A1/A2)
already fixed several named items.

| Audit claim | Verdict | Evidence |
|---|---|---|
| `simulateGameUpdate` returns `Simulation failed: ${error.message}` | **CONFIRMED** | `functions/src/scoreUpdates.ts:1390` |
| `createBracketPool` destructures `request.data` before validation; null payload crashes | **CONFIRMED** | `bracketPools.ts:35` destructure precedes any guard; `validateCreateInput` runs at :58 |
| `simHarness.ts` `assertSuperAdmin` trusts the claim alone | **CONFIRMED** | `simHarness.ts:105-112` |
| `simLegacy.ts` same claim-only pattern | **CONFIRMED** | `simLegacy.ts:70,101,143` |
| `backfill.ts` loads all pools + all completed pools' entries | **CONFIRMED** (but already `validated()` + dryRun-default) | `backfill.ts:14,96`; schema `schemas/noInputAdmin.ts:33` |
| `nflPickReveal.ts` loads all pool entries per request | **CONFIRMED, qualified** — field-masked `select()`, bounded by pool size, no explicit cap | `nflPickReveal.ts:334-339` |
| `siteAverages.ts` scans all public profiles | **CONFIRMED, qualified** — `select('weekly','subjectKind')` projection, single aggregate write | `siteAverages.ts:55` |
| `refreshSiteAverages` / `refreshExpertProfiles` claim-only | **STALE** — both already `assertCallerRole` (claim+doc) | `siteAverages.ts:90`, `expertProfiles.ts:160` |
| AI testing callables claim-only | **STALE** for authz (assertCallerRole ×3), **CONFIRMED** for input (raw destructure) | `aiTesting.ts:105-107` |
| `searchUsersByEmail` leak fixed, preserve | **CONFIRMED fixed** — allowlist + `httpSurfaceInvariants.test.ts` pin | `userManagement.ts:260-276` |

Additional confirmed instances found by this plan's sweeps (full lists in
PLAN-API-TRUST-BOUNDARY-REMEDIATION-SWEEPS.md):

- Error-message leaks beyond `simulateGameUpdate`: `userManagement.ts:67,146,179`,
  `nflPools.ts:238`, `nflSchedule.ts:1495`, `poolOps.ts:471`, `stripe.ts:884,958`,
  `authBackup.ts:817`, `bracketScoring.ts:375`, and the `fixPoolScores` response
  payload (`scoreUpdates.ts:1508`, `reason: error.message`).
- Claim-only SUPER_ADMIN checks beyond sim files:
  `migrations/backfillMemberRecords.ts:168`, `migrations/reconcilePaymentTruth.ts:67`,
  `setPaidStatus.ts:113`, `bracketEntries.ts:440`,
  `payoutRecords.ts` (claim half of `assertPayoutAuthority`, call sites :217 and :438),
  HTTP: `debug.ts:22` (`inspectPoolState`), `userManagement.ts:204` (`testSmsHttp`).
- Doc-only SUPER_ADMIN checks (reverse weakness): `squares.ts:181,226`.
- A fourth unbounded top-level scan: `poolOps.ts:825` (`fixParticipantIds`).

## Approach — phases, each independently shippable

### Phase 1 — Safe error handling (Fix 1)

New pure helper `functions/src/lib/safeError.ts`:

- `internalError(label: string, err: unknown): HttpsError` — logs the full
  error server-side (`console.error(label, err)`) and returns
  `HttpsError('internal', 'Internal error — the failure was logged.')`
  (one stable generic string; exact wording final at implementation).
- `rethrowOrInternal(label, err)` — rethrows `err` unchanged when
  `err instanceof HttpsError` (expected errors keep code + message), else
  throws `internalError(label, err)`.

Apply at every site in Sweep S4 (the leak list). Rules:

- Expected `HttpsError`s thrown inside a wrapped body must pass through
  unchanged (this FIXES `simulateGameUpdate`, which today re-wraps an in-transaction
  `not-found`/`permission-denied` as `internal`).
- Server-side logs/audits keep the full message (existing `writeAdminAudit`
  `error:` fields, `console.error`, `recordFailure` are untouched).
- `fixPoolScores` per-pool `reason` becomes a stable code
  (`'processing-error'`) with the real message logged server-side.
- **(codex r1 #4)** Two additional sites leak a caught `e.message` under
  `invalid-argument`: `billing.ts:566` (`getPoolQuote`) and `stripe.ts:516`
  (checkout quote). `computeQuote` throws plain `Error`s whose text names
  internals (`formatTierMap`). Both keep their `invalid-argument` code and get
  the already-present stable fallback text ("Unable to price this pool
  format."), full error logged server-side; any `HttpsError` from the try body
  is rethrown unchanged.
- The source invariant catches direct `.message`-in-`HttpsError` shapes; alias
  shapes (`const msg = e.message` then `HttpsError(..., msg)`) cannot be
  caught by a sane regex, so each fixed alias site (`bracketScoring.ts`,
  `authBackup.ts`) additionally gets a per-file source pin.
- `lib/aiProviderError.ts` reason codes are deliberate operator diagnostics
  (machine-readable short codes, not raw provider messages) — out of scope.

Regression guard: extend `__tests__/httpSurfaceInvariants.test.ts` with a
source-wide ban on `HttpsError('internal', …)` whose message expression
references `.message` or a caught error identifier, plus unit tests for the
helper (HttpsError passthrough; generic wrap; no message propagation).

### Phase 2 — Input validation (Fix 2)

1. **`simulateGameUpdate`** — new named schema
   `simulateGameUpdateSchema` in `schemas/scoreUpdates.ts`:
   `poolId` (trimmed string 1–200) + `scores` (plain non-null, non-array
   object; keys/size bounded). Parsed **before** any use of `request.data`,
   after the existing auth check. Stays a raw `onCall` **by design**: its
   authorization is ownership-based with a hoisted claim+doc admin check that
   must stay outside the transaction (`backendResidue.test.ts` pins this), and
   `validated()`'s auth gate would change the unauthenticated error code the
   handler deliberately throws. Documented exception + schema test.
2. **`createBracketPool`** — add a null/shape guard (named helper) before the
   destructure so `null`/array/primitive payloads return `invalid-argument`
   instead of crashing to `internal`. The existing gate order is preserved
   deliberately: `assertPoolCreationAllowed` → `validateCreateInput('BRACKET')`
   (the full `bracketCreateInputSchema` parse) → strict `bracketSettingsSchema`
   re-parse. Top-level strictness is NOT added: launch fields
   (`estimatedPlayers`, `addons`, `couponCode`) ride at top level by contract
   and the shared create schemas are non-strict by documented design
   ("unknown keys are legitimate per-type config" — `shared/schemas/index.ts`).
   The stale "deferred because of `...settings` spread" note in
   `schemas/bracketPools.ts` is corrected (the spread is gone since A2).
3. **`aiTesting.ts` ×3** — null-safe parse with named bounded schemas
   (`poolType` string ≤64, `userRequest` string ≤4000, etc. per handler) before
   destructure. SUPER_ADMIN-only surface, so schemas are minimal-bounded, not
   behavior-changing.
4. **`refreshExpertProfiles`** — named schema: `season` string/number → string
   (1–16 chars), `seasonType` literal 1|2|3 default 2 (kills the
   `Number(x || 2)` NaN path).
5. **Raw-callable exception invariant** — new
   `__tests__/rawCallableExceptions.test.ts`: comment-blanked source scan (same
   proven harness as `callableExportSurface.test.ts`) that collects every
   `export const X = onCall(`/`functions.https.onCall(` and asserts the set is
   EXACTLY the reviewed allowlist (name + file + one-line justification each).
   A new raw callable fails the test until it is either `validated()` or
   reviewed onto the list.

Remaining reviewed exceptions (justifications in the test):
`getServerTime` (no auth/input/data), `logClientError` (deliberately pre-auth,
self-capping), `notifyPasswordReset` (public by design, constant response,
rate-limited), `recordPoolPayouts`/`setPayoutSettled` (ownership-based
authorization + hand validation that encodes cross-field money rules;
claim-half hardened in Phase 3), `simulateGameUpdate` (above),
`createBracketPool` (gate-order + non-strict envelope, above), 11×`simHarness`
+ 3×`simLegacy` (SUPER_ADMIN-gated test tooling with `simRunId`/namespace
anchors; hardened in Phase 3), `refreshSiteAverages`/`refreshExpertProfiles`
(claim+doc gated; no/typed input).

### Phase 3 — Authorization hardening (Fix 3)

All migrations use existing helpers; no new authorization semantics invented.
Fail-closed everywhere (helper already yields `false`/throws on doc
mismatch/missing/error). Non-admin callers pay zero extra reads (claim
short-circuit is pinned by existing tests).

| Site | Today | Change |
|---|---|---|
| `simHarness.ts` `assertSuperAdmin` (11 callables) | claim-only | make helper async → claim + `hasConfirmedRole`; same error text; audit flow preserved |
| `simLegacy.ts` ×3 | claim-only | `hasConfirmedRole(request,'SUPER_ADMIN')`; `simFillSquares` keeps ownership path untouched |
| `migrations/backfillMemberRecords.ts`, `migrations/reconcilePaymentTruth.ts` | `validated()` but hand claim-only check | add `role: "SUPER_ADMIN"` to the `validated()` config, delete the hand check |
| `setPaidStatus.ts:113` | claim-only bypass beside commissioner check | `hasConfirmedRole` (outside the transaction) |
| `bracketEntries.ts:440` (markEntryPaidStatus-shape) | claim-only bypass INSIDE transaction | hoist `hasConfirmedRole` before the transaction (the `simulateGameUpdate` pattern) |
| `payoutRecords.ts` `assertPayoutAuthority` call sites (:217, :438) | SUPER_ADMIN half claim-only | pass `await confirmedAdminClaim(request)` instead of the raw claim — owner/co-commissioner path byte-identical |
| `squares.ts:181,226` | **doc-only** (claim never checked) | claim+doc via `hasConfirmedRole` hoisted before the transaction; ownership path unchanged |
| `debug.ts` `inspectPoolState`, `userManagement.ts` `testSmsHttp` (HTTP) | verifyIdToken + claim-only | new **async** helper `confirmedSuperAdminHttp(decoded)` in `lib/confirmedRole.ts` (it reads Firestore — not pure; codex r2 #4): claim short-circuit, then `users/{uid}.role` agreement; returns false on doc-read failure (fail closed, logged). Error boundaries separated: `verifyIdToken` failure stays 401 in its own try/catch; a verified-but-unconfirmed caller gets 403 outside it |
| **(codex r1 #1, r2 #2)** call sites passing the RAW claim into `assertPoolOwnerOrSuperAdmin` / `loadPoolAndAssertManager` (either gate variant): `invites.ts:73`, `manualReminders.ts:62`, `poolParams.ts:27`, `poolOps.ts:505`, `poolExceptions.ts:131,240,555,614` (`closePool` included — destructive) | admin bypass half claim-only | pass `await confirmedAdminClaim(request)` — owner/commissioner path byte-identical, non-claimants pay zero reads; plus a source pin enumerating every call site of BOTH helpers and asserting none hands them raw `token.role` |
| **(codex r3 #1)** remaining raw-claim SUPER_ADMIN privilege decisions: `coCommissioners.ts:54,68` (owner-gate bypass), `nflEntryDelete.ts:427→100` (`actorRole` bypass on entry delete), `nflEntryRename.ts:195` and `nflPools.ts:1029-1033` (`actorRole` → `assertNFLPickMembership`'s SUPER_ADMIN bypass), `nflPools.ts:118` + `poolOps.ts:340` (claim gates `simRunIdForCreate` sim-pool minting) | claim-only | resolve `await confirmedAdminClaim(request)` ONCE at each callable's wrapper edge (before any transaction) and thread the resolved value; the pure helpers (`simRunIdForCreate`, `assertNFLPickMembership`) stay pure and keep receiving a role string. Non-claimants pay zero reads on the hot submit path (short-circuit). |
| `nflPoolDues.ts:156`, `nflPickReveal.ts:185-206`, `nflPools/poolOps/userProfile/playoffPools` bypasses | already claim+doc | no change (classified) |

Behavioral notes, stated plainly:
- A **promoted-but-stale-token** caller on the two `squares.ts` sites is now
  denied until token refresh (previously admitted by doc-only read). That is
  the standard the rest of the codebase already enforces (`assertCallerRole`
  requires BOTH to agree).
- SIM namespace/run-id protections and every `admin_audit` write are preserved
  verbatim.

Tests: extend `backendResidue.test.ts`-style pins + behavioral tests (mocked
`firebase-admin`) for `confirmedSuperAdminHttp` covering: unauthenticated,
wrong role, stale SUPER_ADMIN claim (doc says MEMBER/BANNED), missing doc,
doc-read error (fail closed), correct SUPER_ADMIN. Matrix pins for each
migrated site.

### Phase 4 — Bounded reads (Fix 4)

The pagination contract is defined here in full, NOT by reference to
`backfillProfileData` (codex r1 #7 — that migration bounds only its OUTER
scan). Contract for both repair callables:

- Outer: deterministic `orderBy(documentId())`, `MAX_POOLS_PER_RUN = 25`,
  optional `afterPoolId` cursor (null→undefined normalized at the schema
  layer), fetch cap+1 → response carries `{ nextCursor, hasMore }` and the
  `admin_audit` summary carries the same continuation state.
- Inner (codex r1 #3, r2 #1): every per-pool subcollection read is capped —
  `.limit(ENTRY_SCAN_CAP + 1)` with `ENTRY_SCAN_CAP = 10_000`. The bound is
  NOT derived from a "no legal pool can reach it" claim (codex r2 #1 disproved
  that: entitlements permit `maxPlayersPerPool` up to 9,999); it is the
  explicit worst-case work bound per pool per run. A pool over the cap is NOT
  partially processed: its heavy leg is skipped, the pool id lands in an
  `oversizedPools` list in the response/audit (dry-run reports it too, so the
  operator learns BEFORE a live run), and the outer cursor still advances
  (per-entry idempotency markers make a later targeted rerun safe). Per-entry
  resumption is deliberately not built; `oversizedPools` is the honest
  escalation path.
- Completion path (codex r1 #2, r2 #3): `OperationsPanel` is updated in the
  same change — its `backfillPools` / `fixParticipantIds` actions become
  bounded sequential runners: call, read `nextCursor`, continue until
  `hasMore` is false (client safety stop at 100 pages), aggregate counts,
  render per-page progress. On an error OR the page stop, the panel reports
  the run as **INCOMPLETE**, displays the last cursor, and the action offers
  a "Continue from cursor" invocation rather than restarting from page one.
  A clean `hasMore:false` finish reports complete. (Frontend change ⇒ a
  Coolify rebuild is owed at deploy time.)
- Mode-bound cursors (codex r3 #3): the response echoes `dryRun` beside
  `nextCursor`, and the panel keys its stored cursor by (operation, mode) —
  a live run NEVER continues from a dry-run cursor (it would silently skip
  every already-dry-scanned pool without writing it); switching mode starts
  from the beginning. Tested.
- Execution budget (codex r3 #4, r4 #2): both repair callables get explicit
  `options: { timeoutSeconds: 300, memory: "512MiB" }` (the repo's
  batch-migration budget) plus a per-run staged-write budget
  `WRITE_BUDGET_PER_RUN = 5_000` checked **between pools only**: before
  starting the next pool, if writes staged so far ≥ budget, stop and return
  the cursor at the last completed pool. A single pool is never split (the
  whole-pool rule), so one pool may overshoot the threshold — bounded by the
  inner cap at worst ~2 × ENTRY_SCAN_CAP + O(1) pool-level writes — and the
  run total is bounded by budget + one worst-case pool. This removes the
  round-3 contradiction codex r4 #2 found (a 2,500+-entry pool could never
  finish under a hard 5,000 mid-pool stop): the budget is a stopping
  threshold at pool boundaries, the entry cap is the per-pool bound, and
  together they bound the run without ever half-processing a pool.

1. **`backfillPools`** (`backfill.ts`) — the contract above; `dryRun` default
   true preserved at the schema layer; idempotency markers
   (`historicalStatsFoldedAt`) unchanged. **Plus a kill-switch for live
   runs**: `dryRun:false` additionally requires
   `system/config.backfillPools.enabled === true`, fail-safe (read error =
   disabled); dry runs never blocked. The refusal is a `failed-precondition`
   with an actionable stable message naming the config key, so the operator
   path is self-describing in the panel output (codex r1 #5). Provisioning:
   the key simply does not exist until Kevin sets it in the console — absent
   means disabled; no deploy-time step required.
2. **`fixParticipantIds`** (`poolOps.ts:825`) — same contract (audit did not
   name it; the sweep did). No kill-switch: it is a pure reconciliation of
   `participantIds` from membership sources, already dryRun-defaulted.
3. **`recomputeSiteAverages`** (`siteAverages.ts`) — keep the
   server-maintained aggregate design; page the projection scan
   (`orderBy(documentId()).limit(1000)` loop) with a hard page cap
   (50 pages = 50k profiles). Hitting the cap **aborts without writing** —
   `recomputeSiteAverages` THROWS (codex r3 #6: a plain `{ok:false}` return
   from the recompute would be folded into a success detail by the job
   wrapper) — the last complete aggregate stays published; the scheduled
   job's existing catch converts the throw to `{ok:false}` so the heartbeat
   reports unhealthy, and the on-demand callable surfaces the framework's
   generic internal error (no internals leak; message logged).
4. **`getPoolPicks`** (`nflPickReveal.ts`) — the caller contract needs the
   complete roster (standings/progress), so pagination is wrong. Chosen
   option: **documented hard cap enforced server-side, two layers**
   (codex r5 #1, r6 #1):
   - `.limit(REVEAL_ENTRY_CAP + 1)` with `REVEAL_ENTRY_CAP = 2_000` on the
     entries scan — the per-request WORK bound. Overflow throws a loud
     `failed-precondition` (`ENTRY_SCAN_OVERFLOW`, stable message, pool id
     logged server-side).
   - an enforced serialized-response BYTE budget — the TRANSPORT bound: the
     assembled response is measured with
     `Buffer.byteLength(JSON.stringify(...), 'utf8')` (true UTF-8 bytes, not
     UTF-16 code units — codex r7 #1; multibyte boundary test pinned) before
     return and a result over `REVEAL_RESPONSE_BYTE_BUDGET = 8_000_000`
     (margin under the ~10 MB callable limit) throws the same stable
     overflow class. This is the layer the doc-count cap cannot provide:
     Pick'em's worst legal entry (≤50 picks + ≤50 confidence + counts +
     entries rows, ~100-char strings) can serialize to ~25 KB, so document
     count alone is not demonstrably transport-safe.
   Both constants documented in place and pinned by tests. A silently
   truncated reveal would corrupt counts/progress — fail loud beats fail
   wrong. Repair jobs keep `ENTRY_SCAN_CAP = 10_000` (count-shaped
   responses). Reveal privacy boundary (`weekRevealFor`, allowlist, masks)
   untouched.

Tests: cursor advancement + cap (page 1 → nextCursor → page 2 disjoint),
dry-run stages-but-commits-nothing, kill-switch fail-closed, siteAverages
paging fold equivalence + truncation flag, pickReveal cap constant + overflow
behavior, and a source pin that `backfill.ts` no longer contains an
un-cursored `collection('pools').get()`.

### Phase 5 — Response-data + HTTP verification (no behavior change expected)

- `searchUsersByEmail` allowlist: already pinned; keep.
- HTTP method matrix re-verified (sweep S6); no changes to
  `emailUnsubscribe` (signed GET), `manageEmailPrefs` (GET/POST),
  `joinPreview`/`readiness` (GET/HEAD), Stripe webhook (POST), `cspReport`
  (POST), `testSmsHttp` (GET/POST). The only HTTP edits are the Phase 3 role
  confirmations on `inspectPoolState`/`testSmsHttp`.
- `inspectPoolState` returns the raw pool doc — SUPER_ADMIN-only diagnostic;
  classified, not changed.

## Key decisions & tradeoffs

- **D1 — `simulateGameUpdate` stays raw `onCall` + named schema** rather than
  `validated()`: preserves the deliberate unauthenticated error code and the
  hoisted-outside-transaction role check the residue tests pin. Tradeoff:
  one more allowlisted exception; mitigated by the schema + invariant test.
- **D2 — no top-level strictness on `createBracketPool`**: the shared create
  schemas are non-strict by documented design; adding strictness risks
  refusing live wizard payload evolution mid-launch. Tradeoff: unknown
  top-level keys are ignored rather than rejected — but nothing unknown is
  persisted (document is built field-by-field; A2 removed the spread).
- **D3 — payoutRecords keeps hand validation**: the cross-field money rules
  (award binding, supersession chains) are better expressed in code with
  per-rule tests than re-encoded in zod mid-season. The audit's actual
  weakness there (claim-only admin half) is fixed. Tradeoff: two more
  allowlist entries.
- **D4 — kill-switch on `backfillPools` live runs** (new config key
  `system/config.backfillPools`): Rule 1 conformance; sibling migrations
  currently rely on role+dryRun only. Flagged to Kevin as DECISION — default
  in this plan is to ADD the switch (fail-safe OFF), since the tool is rarely
  used and a blocked live run is a config flip away.
- **D5 — squares.ts doc-only → claim+doc** tightens who passes (stale-token
  promotions lose access until refresh). Consistent with the codebase
  standard; called out because it is the one place this plan makes an
  authorization check stricter for a principal that previously passed.

## Risks / open questions

- **R1**: `assertSuperAdmin` becoming async touches 11 call sites in
  `simHarness.ts` — mechanical, but the Test Suite (prod tooling) exercises
  these; mitigations: no signature change beyond `await`, same error message,
  full functions suite + targeted tests.
- **R2** (rewritten after codex r2 #1 / r3 #2/#5): entitlements permit
  `maxPlayersPerPool` up to 9,999, so a configured-to-the-ceiling pool could
  in principle exceed the 10,000-entry scan cap; such a pool would get a loud
  `ENTRY_SCAN_OVERFLOW` on `getPoolPicks` and land in `oversizedPools` on the
  repair jobs (never partially processed). This makes the cap a **product
  ceiling decision** — Q3 below — not a claimed impossibility. Today's real
  pools are orders of magnitude smaller; a join-time aggregate entry ceiling
  is named as follow-up work, out of scope here.
- **R3**: error-message hardening reduces client-visible diagnostics on admin
  tools (deleteUserAccount etc.). Operator diagnostics remain in logs +
  admin_audit; acceptable per audit requirement.
- **Q1 — RULED (Kevin, 2026-09-01): keep the kill-switch.**
  `system/config.backfillPools.enabled === true` is required for live runs;
  absent/false/unreadable = disabled; dry runs always allowed. As implemented.
- **Q2 — RULED (Kevin, 2026-09-01): future plan.** `fixPoolScores`
  global-by-default (no poolId = fix every pool) stays as-is for now; named
  as its own future plan-gated change. Tracked in TOMORROW-TASKS.md.
- **Q3 — RULED (Kevin, 2026-09-01): approved.** The documented product
  ceilings stand as implemented:
  - reveal (`getPoolPicks`): `REVEAL_ENTRY_CAP = 2_000` entries AND an
    8 MB UTF-8 response byte budget — overflow fails loud, never truncates;
  - repair jobs: `ENTRY_SCAN_CAP = 10_000` per-pool subcollection bound —
    over-cap pools are skipped whole and reported, never half-processed.
  The join-time aggregate entry ceiling remains named follow-up work.

## Out of scope

- Deploys, prod-data runs, Firestore rules, App Check posture changes.
- REST rewrite or CORS changes; callable semantics preserved.
- `aiProviderError` reason codes; `inspectPoolState` response shape.
- The pre-existing `fixPoolScores` global default (Q2).
- The `.limit()`-per-pool subcollection scans bounded by pool size (classified
  in sweeps as caller-contract-bounded; only `getPoolPicks` gets the explicit
  cap because it is member-facing and polled).

## Implementation status

| Phase | Item | Status |
|---|---|---|
| 1 | lib/safeError.ts + all S4 sites + invariant test | ✅ implemented |
| 2 | simulateGameUpdate schema | ✅ implemented |
| 2 | createBracketPool shape guard | ✅ implemented (assertCreatePayloadIsObject) |
| 2 | aiTesting schemas | ✅ implemented (schemas/aiTesting.ts) |
| 2 | refreshExpertProfiles schema | ✅ implemented |
| 2 | rawCallableExceptions invariant test | ✅ implemented (26-entry reviewed list) |
| 3 | simHarness + simLegacy claim+doc | ✅ implemented |
| 3 | migrations ×2 role option | ✅ RECLASSIFIED no-change — both already carry `role: "SUPER_ADMIN"` in their validated() config (the hand claim check is redundant belt, not the gate); the S3 sweep row was wrong |
| 3 | setPaidStatus / bracketEntries / payoutRecords / squares + r1/r3 helper-caller sites | ✅ implemented |
| 3 | HTTP helper + inspectPoolState + testSmsHttp | ✅ implemented (confirmedSuperAdminHttp) |
| 4 | backfillPools cursor+cap+switch (+ core split for tests) | ✅ implemented |
| 4 | fixParticipantIds cursor+cap | ✅ implemented |
| 4 | siteAverages paging (abort-on-cap) | ✅ implemented |
| 4 | getPoolPicks caps (2k entries + 8MB UTF-8 byte budget) | ✅ implemented |
| 4 | OperationsPanel sequential runner (mode-bound cursors) | ✅ implemented |
| 5 | verification + tests (apiTrustBoundary, rawCallableExceptions, emulator fixture updates) | ✅ implemented — evidence in the final session report |
