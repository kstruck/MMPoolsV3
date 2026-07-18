# HANDOFF — Session entry point (updated 2026-07-18, callable sweep: 19 callables remain; batches 1-4 deployed, everything since merged but NOT deployed)

**Start every new session with: "Review HANDOFF.md and pick up where we left off."**
This file + auto-memory carry the full state. Older narrative lives in git history.

---

## Current state: **19 SWEEP-LATER callables remain** — batches 1-4 deployed, batches 5-13 + 3 fixes merged to main but UNDEPLOYED

The trust-boundary `validated()` sweep of the parked SWEEP-LATER callables is underway. Kickoff/recipe doc: `PICKUP-CALLABLE-SWEEP.md`; classification authority: `PLAN-SECURITY-OBSERVABILITY-SWEEPS.md`.

> **Count caveat — trust the grep, not the fraction.** The SWEEPS matrix header says 51 SWEEP-LATER rows, but 35 swept + 19 still-unwrapped = 54, so the header or the row classifications are off by ~3. Don't quote an "N/51" fraction. The authoritative check is:
> ```
> grep -rn "export const <name> = " functions/src --include=*.ts
> ```
> — `= onCall(` means unwrapped, `= validated(` means done. The 19 remaining are listed at the bottom of this section.

**Fully swept files:** `bracketEntries.ts` (6/6), `adminClaims.ts` (4/4), `poolOps.ts` (3/3), `nflPools.ts` (3/3 SWEEP-LATER; `calculatePlayoffScores`-style legacy noop N/A here), `billing.ts` (2/2 SWEEP-LATER), `couponTemplates.ts` (2/2 SWEEP-LATER; 3 others already TARGET-NOW), `espnBracket.ts` (5/5), the 4 no-input SUPER_ADMIN callables (`getAdminHealthSnapshot`/`backfillPools`/`refreshExpertPicks`/`syncPlayoffPools`, one each in 4 different files). `bracketPools.ts` at 2/3 (`createBracketPool` deliberately deferred, see below).

| Batch | PR | Callables | Deploy state |
|---|---|---|---|
| 1 | #176 | `createBracketEntry` / `updateBracketEntry` / `deleteBracketEntry` | deployed |
| 2 | #177 | `updateEntryPayment` / `adminUpdateEntryOverrides` / `adminDeleteEntry` (admin two upgraded claim-only → C5 claim+doc) | deployed |
| 3 | #179 | `publishBracketPool` / `joinBracketPool` | deployed |
| 4 | #180 | `syncMyClaims` / `backfillUserRoles` (+ null-input fix) | deployed |
| 5 | #183 | `poolOps.ts`: `recalculatePoolWinners` / `toggleWinnerPaid` / `fixParticipantIds` | **merged, NOT deployed** |
| 6 | #184 | `nflPools.ts`: `joinNFLPool` / `executeSurvivorRebuy` / `scoreNFLWeek` | **merged, NOT deployed** |
| 7 | #185 | `billing.ts`: `validateBillingAccess` / `getPoolQuote` | **merged, NOT deployed** |
| 8 | #186 | no-input quartet: `getAdminHealthSnapshot` / `backfillPools` / `refreshExpertPicks` / `syncPlayoffPools` | **merged, NOT deployed** |
| 9 | #187 | `couponTemplates.ts`: `deleteCouponTemplate` / `acknowledgeMonetizationAlert` | **merged, NOT deployed** |
| 10 | #188 | `espnBracket.ts`: `importTournamentFromESPN` / `adminInitTournament` / `syncBracketTournament` / `importConferenceTournamentFromESPN` / `syncPlayInPicks` (closes a C5 auth-fallback finding for all 5) | **merged, NOT deployed** |
| 11 | #191 | `bracketScoring.ts`: `scoreBracketEntries` / `finalizeTournamentPayouts` (both claim-only → C5 claim+doc) | **merged, NOT deployed** |
| 12 | #192 | `conferenceTournaments.ts`: `initializeBigEastTournamentHttp` / `initializeBig12TournamentHttp` (both were **doc-only** role checks — last two in the fleet) | **merged, NOT deployed** |
| 13 | #194 | `squares.ts`: `updatePlayer` / `releaseSquares` | **merged, NOT deployed** |
| — | #190 | `backfillPools` dry-run gate (defaults true, `plannedWrites` report, FE dry/live button pair) | **merged, NOT deployed** |
| — | #193 | `backfillPools` status-clobber fix + per-entry fold marker | **merged, NOT deployed** |
| — | #195 | squares lookup-key `.trim()` regression fix (follow-up to #194) | **merged, NOT deployed** |

Batches 1-4 deployed 2026-07-17/18 (see prior narrative below). **Batches 5-13 plus the three fix PRs (2026-07-18) are merged to `main` but explicitly NOT deployed** — deploy is Kevin's gate per `mmp-change-control`; nothing has run `firebase deploy`. Before deploying, verify every merge landed (`git log origin/main --oneline -20`), then follow the functions-first ritual:

```
npm --prefix functions install
npx firebase deploy --only functions:recalculatePoolWinners,toggleWinnerPaid,fixParticipantIds,joinNFLPool,executeSurvivorRebuy,scoreNFLWeek,validateBillingAccess,getPoolQuote,getAdminHealthSnapshot,backfillPools,refreshExpertPicks,syncPlayoffPools,deleteCouponTemplate,acknowledgeMonetizationAlert,importTournamentFromESPN,adminInitTournament,syncBracketTournament,importConferenceTournamentFromESPN,syncPlayInPicks,scoreBracketEntries,finalizeTournamentPayouts,initializeBigEastTournamentHttp,initializeBig12TournamentHttp,updatePlayer,releaseSquares --project gridiron-gamble-uzuqo
```

**The frontend also has undeployed changes** (`OperationsPanel.tsx` gained a "Backfill Pools (dry run)" button in #190) — that needs the manual Coolify trigger, which does NOT happen on push to `main`.

### ⚠️ `backfillPools` behavior change — read before running it
PR #190 changed `backfillPools` to **default to dry-run**. The existing "Backfill Pools" button now sends `dryRun: false` explicitly, so it still writes — but any *other* caller that omits the flag now reports instead of writing. PR #193 then fixed two real defects in it:
- It used to reset **COMPLETED pools to DRAFT** (it recomputed `status` from `isLocked`/`isFinal`, ignoring the existing value). If this backfill has ever been run against prod, **finished pools may already have been un-completed** — worth an audit query before running it again.
- The historical-stats fold (`FieldValue.increment` on `users/{uid}.historicalStats`) is now guarded per-entry so it can't double-count. **Limitation:** entries folded by a run predating that marker carry none and would fold again. Dry-run first and read `plannedWrites`.

**Verify-before-strict lessons banked** (all now encoded in the PICKUP recipe):
1. `createBracketEntry` accepts a handler-*ignored* `tiebreakerScore` — must stay accepted or real calls break.
2. `updateEntryPayment`'s `paidAt`/`paymentNote` use explicit `null` to CLEAR the field → schema uses `.nullable()` NOT `nullish()` (nullish maps null→undefined and silently kills the clear feature). A test pins null-preservation.
3. **No-input callables must `z.preprocess((v) => v ?? {}, z.strictObject({}))`** — a no-arg `httpsCallable(fn)()` delivers `request.data` as `null`, which a bare strict object rejects. Shipped as a real bug in batch 4 (`syncMyClaims`), caught in review, fixed in #180. Batch 8 (#186) promoted this to a shared `noInputSchema` helper in `lib/zodHelpers.ts` (5th occurrence) and used it for all 4 remaining no-input callables — that gotcha is now fully closed across the fleet.
4. **A prod batch-mutation callable's `dryRun` flag must fail SAFE (default true) at the SCHEMA layer, not the handler.** qodo caught this on PR #183: `fixParticipantIds`'s pre-existing handler logic (`dryRunInput === true`) silently ran LIVE when the flag was omitted — contradicted the schema's own "default true" doc comment and the repo's dry-run-by-default convention (PRs #127/#129/#180). Fixed with `z.boolean().optional().default(true)` at the schema layer instead of a handler-side truthy check. Check any other dryRun-flag callable you retrofit for the same footgun. (`backfillPools` had NO dry-run at all — since fixed in #190, which also uncovered two real defects in it; see the warning box above.)
5. **Shared cross-boundary schemas (anything under `shared/schemas/`, generated into `functions/src/shared/`) are OUT OF SCOPE for `.strict()`-ifying** even when a SWEEP-LATER row uses one — `getPoolQuote`'s `poolQuoteInputSchema` was deliberately left non-strict (batch 7, PR #185): it's consumed by both the callable and the checkout flow, and the matrix documents its current shape as intentional. Move the auth+parse gate onto `validated()` using the existing schema as-is; don't tighten a shared contract on a drive-by.
6. **The C5 finding (some admin callables read a spoofable Firestore `users/{uid}.role` as a fallback when the JWT claim is absent) resolves for free** when you retrofit with `validated()`'s `role:` option — it calls `assertCallerRole`, which requires claim AND doc to agree, not claim-OR-doc. Batch 10 (#188, `espnBracket.ts`) closed 5 instances in one pass; batch 12 (#192, `conferenceTournaments.ts`) closed the last two, which were **doc-only** (weaker still — the JWT claim was never consulted at all). **No admin callable in the fleet now authorizes off a Firestore doc alone.**
7. **NEVER `.trim()` a string the handler uses as a LOOKUP KEY.** Regression shipped in batch 13 (#194), caught by qodo, fixed in #195. `updatePlayer.originalName` / `releaseSquares.ownerName` are matched with `===` against the stored `squares[].owner`; `reserveSquare` stores names untrimmed, so `" Alice "` is reachable. Trimming at the boundary made that player un-editable and silently un-releasable (released nothing, still returned success). Rule: `.trim()` is safe on server-generated identifiers (`poolId`, `tournamentId`), never on user-supplied strings used to match stored data. Normalizing at a trust boundary is only correct if the stored side was normalized identically.
8. **Some optional fields are load-bearing — omission can be a MEANING, not a mistake.** `scoreBracketEntries`'s `tournamentId` is optional because omitting it is the *global* form (score every pool-linked tournament), which is exactly what the OperationsPanel button does. A required schema would have broken it. Check what a *missing* field does in the handler before making it required.
9. **A callable can have more than one caller sending different shapes.** Batch 12's two callables are hit by OperationsPanel (`{}`) *and* TournamentManager (five fields, three of which those handlers ignore). Grep every call site, not the first one.
10. **An idempotency marker must be written in the SAME batch as the write it guards.** qodo caught this on #193: a per-pool marker written after the entry loop is not safe, because a pool with >400 entries flushes mid-loop and can commit increments before the marker exists. Marker moved per-entry, staged alongside its own increment, with the flush check after both — batch commits are atomic, so an applied increment can never be unmarked.
7. **A handler that soft-returns `{success:false, message}` instead of throwing on missing input** can still get a `.strict()`+required-field schema — just verify the FE always sends those fields (never omits them) and already wraps the call in try/catch, so a thrown `invalid-argument` surfaces the same way to the user as the old soft-return did. Two espnBracket.ts callables hit this in batch 10; both verified safe via the FE call site before tightening.

**Next on the fleet — 19 remaining, grep-verified as still `= onCall(`:**

Same-file pairs (best batches): `propBets.ts` (`gradeProp`/`updatePropCard`), `referral.ts` (`generateReferralToken`/`resolveReferralToken` — note `resolveReferralToken` is PUBLIC/ANON, use `auth:"public"`).

Singles: `poolParams.ts` (`lockPool`), `bracketOps.ts` (`markEntryPaidStatus`), `adminOps.ts` (`logAdminAction`), `consensus.ts` (`recomputeConsensus`), `playoffPools.ts` (`calculatePlayoffScores` — legacy noop), `participant.ts` (`claimMySquares` — matrix flags `guestDeviceKey` as unchecked), `migrations/backfillMemberRecords.ts`, `nflSchedule.ts` (`importNFLSchedule`), `statsTrigger.ts` (`recalculateGlobalStats` — matrix warns its role check RETURNS instead of throwing), `revenueAggregates.ts` (`recomputeRevenue`), `userManagement.ts` (`searchUsersByEmail` — declared as `functions.https.onCall`, not the bare `onCall` import), `userProfile.ts` (`recomputeMyProfile`), `scoreUpdates.ts` (`fixPoolScores`), `userSync.ts` (`syncAllUsers` — matrix flags NO role gate today; wrapping it must not silently add one without a decision).

Same recipe, runnable unattended.

**Deliberately deferred:** `createBracketPool` (SWEEPS row 7) — rich nested `settings` with a `...settings` passthrough spread that stores arbitrary client fields; a flat `.strict()` would reject data it currently persists. Needs a passthrough envelope or client cutover, same treatment as the ADR-0001 PERMISSIVE creates. Its own careful batch, not a drive-by.

Baselines measured on merged `main` at 42be636 (2026-07-18): root vitest **257** (unchanged all session), functions unit **665**, emulator **97 pass / 10 skipped**, frontend `tsc -b` clean. Counts rise with every batch — re-measure, don't trust a stale number.

---

## Phase 2 observability (#8–14) — SHIPPED, merged, deployed, prod-verified

PR [#171](https://github.com/kstruck/MMPoolsV3/pull/171) (all 7 plan items — Sentry FE spine, correlation id, business-failure→Sentry wiring, ops alert dispatcher, readiness endpoint, in-app Ops Health card, SLOs) merged `7b2a522`, functions + frontend deployed, qodo's 4 findings fixed pre-merge. **One post-deploy bug found+fixed**: `readiness` was configured at 128MiB and OOM'd at cold start (Admin SDK + Node 22 alone use ~131MiB) — Kevin's live GCP Uptime Check test caught it as a 503, fixed in a same-day follow-up PR #173 (bumped to 256MiB, merged, redeployed) — Uptime Check now green. Firestore `system/config.opsAlerts` populated (Kevin). Sentry confirmed live in prod (`window.__SENTRY__` present, real DSN baked into the bundle, verified via direct browser check against `marchmeleepools.com`).

**Not done (optional, not urgent):**
- GCP Cloud Monitoring SLO objects + burn-rate alerting policies (uptime check alone is done; the other 3 SLOs — checkout success, webhook error rate, latency p95 — still need console setup). Target numbers in `PLAN-SECURITY-OBSERVABILITY.md`'s Phase 2 SLO section.
- Cosmetic: the Sentry lazy-load (dynamic `import('@sentry/react')` in `src/sentry.ts`) didn't actually get code-split into its own chunk by Vite's bundler in the prod build — it got merged into the main bundle. Functionally harmless (Sentry works), just didn't achieve the "defer off initial load" perf intent. Kevin said fix "when it makes sense" — not urgent.
- `SENTRY_DSN` functions secret (optional — activates backend Sentry events for Stripe webhook failures; Firestore alerts + ops email/SMS already work without it).

Below this: prior narrative (sim harness — still COMPLETE, deployed, prod-verified; unrelated to Phase 2).

**NFL Sim Harness (PLAN-NFL-SIM-HARNESS.md) — ALL PHASES SHIPPED.**
Core (0/1/2/3/4-core/6) 2026-07-10 via PR #156 + qodo PRs #157-159. **Phase 4
(matrix, items 25-27) + Phase 5 (legacy migration + rules-backdoor removal, items
28-30) shipped 2026-07-11 via PRs #161/#162**, expectations human-verified
(PHASE4-EXPECTATIONS.md, signed-margin rule confirmed), qodo cycle absorbed (3
findings: 4 surviving raw entry writes migrated onto new `updateEntryPayment`/
`adminUpdateEntryOverrides`/`adminDeleteEntry` callables; slug fix; audit-comment
honesty). Functions (7 new) + **firestore.rules (both backdoors DROPPED)** +
Coolify deployed 2026-07-11 evening, functions-first. **Prod smoke: 45/45 NFL
scenarios + squares/playoff/props/bracket-E2E + Tournament Simulator + Fill Grid
all green through the migrated guarded-callable path.** 45-fixture matrix runs in
emulator CI; `simRuns` manifests carry per-assertion run history (`simReportRun`).
No client can raw-create pool docs or raw-write entries anymore — including
SUPER_ADMIN sessions.

## ⚡ Kevin's pending 5-minute item

**Arm the finalize sweep** (safe — deployed stack has all guards):
1. Firestore console → `system` collection → `config` doc.
2. Add field `nflFinalize`, type **map**, containing `enabled` (boolean) = `true` and
   `dryRun` (boolean) = `true`.
3. Sweep runs daily 08:30, REPORTS ONLY while dryRun. After 1-2 days check
   SuperAdmin → Admin Audit Log for `NFL_FINALIZE_SWEEP` entries; when candidate
   lists look sane, ask Claude for the flip-to-live step.

## Phase 2 observability — CLOSED 2026-07-17

PR #171 merged+deployed, PR #173 (readiness OOM fix) merged+deployed, Firestore
`opsAlerts` populated, GCP Uptime Check green, Sentry confirmed live in prod.
Remaining optional items (SLO objects, cosmetic chunk-splitting) listed in the
"Current state" section above — not blocking, not time-sensitive.

## Next-effort menu (pick one to start a session)

1. **Security/Observability plan — Phase 1 COMPLETE (callables + webhook durability) and DEPLOYED.**
   Webhook durability (PR #166, merge 6c87891, deployed 2026-07-17): handleStripeWebhook
   no longer deletes failure state — a failed event flips to status:"failed" + attemptCount,
   de-dupes on Stripe's retry, and alerts ops once (=== threshold) via monetization_alerts/
   WEBHOOK_FAILED_<id>; claimEvent() re-claims failed docs (set/merge, safe on raced delete);
   added handlers for checkout.session.async_payment_failed + payment_intent.payment_failed
   (were falling through the silent default). Pure decideEventClaim/shouldAlertOnFailure in
   lib/webhookDurability.ts, 9 unit tests. qodo: 3 findings (2 fixed, 1 rejected w/ evidence).
   NOTE (deploy gotcha, 2026-07-17): a first merge attempt silently didn't take — git pull
   said "Already up to date" and deploy skipped every function as "No changes detected"
   because main never advanced. ALWAYS verify `gh pr view <N> --json state` == MERGED and
   `git log origin/main` shows the merge commit BEFORE trusting a deploy; a no-op skip on a
   change you expect to ship means the merge/pull didn't land.
   CLOSED SECURITY ITEM: npm critical websocket-driver<=0.7.4 (GHSA-mp7j-qc5w-4988 +
   GHSA-xv26-6w52-cph6) — fixed PR #170 (merge c95edb4, 2026-07-17). Transitive via
   firebase-admin AND the root firebase client SDK → @firebase/database → faye-websocket.
   Added "websocket-driver":">=0.7.5" to the overrides block in BOTH package.json (root +
   functions) — the CI security-audit runs `npm audit --audit-level=high` at ROOT, so a
   functions-only fix left it red (qodo + CI both caught this). App is Firestore-only so the
   WS path never loads; low real risk, but it's a critical + blocked CI. Lockfiles regen'd
   --package-lock-only (only websocket-driver moved). NOT merged as a functions deploy — the
   change is a lockfile-only bump of an unused transitive; rides with the next functions deploy.
   REMAINING (low-pri backlog): 2 moderate npm advisories below the high gate —
   @opentelemetry/core (via @google-cloud/pubsub→firebase-tools, DEV) and morgan (log-forging).
   Neither blocks CI. firebase-admin pinned ^12.7.0 (latest 14.2.0) — a future major-bump task
   would clear these + the whole transitive chain naturally.

   Prior wave (callables): 
   Wave 1: PR #164 (16 callables, deployed 2026-07-11 night). Wave 2: PR #165
   (remaining 25, merged f4df975 + functions deployed by Kevin 2026-07-12 late
   night; functions:list + post-deploy log sweep clean — zero invalid-argument
   or Invalid-request rejections). Every TARGET-NOW callable now runs through
   validated() (App Check monitor → auth → role claim+doc → strict zod);
   schemas in functions/src/schemas/* with unit tests pinning real client
   payloads. qodo lifetime on this plan: 3 findings, 3 VALID, all absorbed.
   Baselines now: functions unit 545, root vitest 244, emulator 84+10 skipped.
   Note: root tests mock onCall in tests/mocks/firebase-functions-v2-https.ts
   — it now supports the two-arg onCall(options, handler) form validated()
   uses, and onboarding-flow assertions pin the NEW gate error messages.
   Phase 2 (observability, #8-14) is now SHIPPED+DEPLOYED — see "Current
   state" at the top of this file, PR #171 + #173.
   Remaining Phase-1-adjacent follow-ups (pick one): (a) App Check
   monitor→enforce flips per endpoint (PLAN #5) after a
   coverage-measurement window; (b) firestore.rules write-path sweep (the
   pools allow-update isSuperAdmin() rule + playoff/props raw writes
   deliberately parked for it); (c) SWEEP-LATER callable fleet (63, includes
   the correlation-id sweep's ~13 remaining direct-httpsCallable files);
   (d) tighten the two PERMISSIVE create envelopes (ADR-0001); (e) Phase 3
   (backups #15-19).
   Note from Phase 5: the general pools `allow update: isSuperAdmin()` rule + playoff/props
   pool-doc/propCards raw writes were deliberately left for THIS plan's write-path sweep.
2. **Player Profiles follow-ups** — flip `profileBackfill`/`nflFinalize` dry-runs after
   reports look right; Achievements engine requirements (Kevin gathering); Expert Picks
   UI surface (`nfl_games/{id}.expertPredictions` is ingesting, nothing displays it yet).
3. **Small follow-ups parked from Phase 4/5:** settingsMatrix test uses wrong key
   `autoSurviveExemption` (engine reads `autoSurviveExemptionEnabled`; inert, 1-line);
   `profileField` assertion implemented but unwired (needs a `simRecomputeProfile`
   callable if a browser golden ever wants profile asserts); optional margin/survivor
   "season teams strip" UI (all 32 teams, used ones crossed out — pick sheets already
   gray out used teams per game).

## Key documents

| Doc | What |
|---|---|
| `HANDOFF.md` | THIS FILE — session entry point |
| `PLAN-NFL-SIM-HARNESS.md` + `-REVIEW-LOG.md` | Locked harness plan + Codex trail |
| `TAKEOVER-NFL-SIM-HARNESS.md` | Overnight-build narrative + deploy runbook (historical) |
| `PLAN-SECURITY-OBSERVABILITY.md` + `-SWEEPS.md` + `-REVIEW-LOG.md` | Security/observability plan — Phase 1 + Phase 2 both shipped+deployed (PR #171, #173); Phase 3 not started |
| `PROMPT-GRILL-PLAYER-PROFILES.md` | Consumed — profiles shipped via PR #153 |
| `CONTEXT.md` | Glossary (Sim Run, Test Pool, Scenario, Golden Scenario, Scenario Oracle, …) |
| `docs/adr/0006-*.md` | Real-path fidelity via extracted internals |

## Environment / deploy facts (unchanged)

- Deploy: `npm --prefix functions install` first, then `npx firebase deploy --only functions:… --project gridiron-gamble-uzuqo`. Functions before rules. Frontend = Coolify — **manual trigger only**, pushing to `main` does NOT auto-deploy it (corrects a stale claim that lived here; matches CLAUDE.md + the mmp-deploy-and-operate skill).
- Emulator tests need Java on PATH: `JAVA_HOME=/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot`; run `npm --prefix functions run test:emulator`. Unit: `npm --prefix functions test` (410 tests; emulator suite 39).
- qodo.ai reviews PRs (14-day trial from 2026-07-10). Its findings have been 6/6 valid but severity is converging — validate before auto-fixing.
- Untracked strays at root: `PLAN-LOOPS.md`, `PLAN-SECURITY-OBSERVABILITY*.md` (copies of branch-committed files). Harmless; don't commit blindly.

## Do NOT re-do

Plans are locked + adversarially reviewed (Codex ×4 for the harness; ×5 for profiles/security). Don't re-grill. Don't author Phase-4 edge fixtures without Kevin verifying expectations. Don't arm `nflFinalize.dryRun:false` without dry-run reports. The `sim-` rules backdoors stay until Phase 5 (supervised).
