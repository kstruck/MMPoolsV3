# HANDOFF — Session entry point (updated 2026-07-17, Phase 2 observability code-complete)

**Start every new session with: "Review HANDOFF.md and pick up where we left off."**
This file + auto-memory carry the full state. Older narrative lives in git history.

---

## Current state: Phase 2 observability (#8–14) CODE-COMPLETE, PR open, awaiting Kevin merge+deploy

Branch `claude/phase-2-security-observability-4697dd`, PR [#171](https://github.com/kstruck/MMPoolsV3/pull/171) — built overnight 2026-07-17 (Kevin's standing overnight-autonomy grant). All 7 plan items (Sentry FE spine, correlation id, business-failure→Sentry wiring, ops alert dispatcher, readiness endpoint, in-app Ops Health card, SLO definitions + webhook-durability backstop sweep) shipped, qodo's 4 findings on the Sentry commit fixed in a follow-up commit. Full detail, Kevin's action list, and the SLO instrumentation table: `PICKUP-PHASE2-OBSERVABILITY.md`. Gates at final HEAD: frontend `tsc -b` clean, root vitest 257/257, functions unit 574/574, emulator 89/10-skip. NOT merged, NOT deployed — deploy is Kevin's gate (Rule 2), and several steps (Firestore `opsAlerts` config, GCP Uptime Check + SLO objects, optional `SENTRY_DSN` secret) are Kevin-console-only regardless.

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

## ⚡ Kevin's pending items — Phase 2 observability (PR #171)

1. **Review + merge PR #171** (or ask Claude for a walkthrough first — it's 8
   commits, ~1500 lines, touches `stripe.ts` and `validated.ts`).
2. **After merge:** run the deploy ritual (functions first, `npm --prefix
   functions install` first) — full checklist in `PICKUP-PHASE2-OBSERVABILITY.md`.
3. **Populate ops alert recipients** (5 min, Firestore console): `system/config`
   doc → add field `opsAlerts`, type map, containing `emailRecipients` (array of
   strings) and `smsRecipients` (array of E.164 phone strings). Empty/missing =
   the dispatcher silently no-ops, so nothing breaks if this is skipped for now.
4. **GCP Console** (whenever there's Monitoring-console time, not urgent):
   Uptime Check against the deployed `/readiness` endpoint, plus SLO objects +
   burn-rate alerting policies per the table in `PICKUP-PHASE2-OBSERVABILITY.md`.
5. **Optional:** `firebase functions:secrets:set SENTRY_DSN` to turn on backend
   Sentry events for Stripe webhook failures (the Firestore `monetization_alerts`
   docs + ops email/SMS already work without this).

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
   Phase 2 (observability, #8-14) is now CODE-COMPLETE — see "Current state"
   at the top of this file + PICKUP-PHASE2-OBSERVABILITY.md, PR #171.
   AFTER Phase 2 merges+deploys, remaining Phase-1-adjacent follow-ups (pick
   one): (a) App Check monitor→enforce flips per endpoint (PLAN #5) after a
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
| `PLAN-SECURITY-OBSERVABILITY.md` + `-SWEEPS.md` + `-REVIEW-LOG.md` | Security/observability plan — Phase 1 shipped+deployed, Phase 2 code-complete (PR #171, unmerged) |
| `PICKUP-PHASE2-OBSERVABILITY.md` | Phase 2 live status ledger + Kevin's action list — delete once Phase 2 ships |
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
