# HANDOFF — Session entry point (updated 2026-07-11, post Phase 4+5 ship)

**Start every new session with: "Review HANDOFF.md and pick up where we left off."**
This file + auto-memory carry the full state. Older narrative lives in git history.

---

## Current state: NOTHING IN FLIGHT — sim harness COMPLETE (all phases), deployed, prod-verified

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
   OPEN SECURITY ITEM (low real risk): npm critical websocket-driver<=0.7.4, transitive via
   firebase-admin→@firebase/database→faye-websocket. App is Firestore-only (zero RTDB usage),
   so the vulnerable WS path never loads at runtime. Fix = add "websocket-driver":">=0.7.5"
   to the EXISTING functions/package.json overrides block (already pins qs/uuid/@tootallnate).
   NOT firebase-admin 12→14 major bump, NOT audit fix --force. 3 dependabot PRs open (cut from
   pre-#166 main; will rebase). firebase-admin pinned ^12.7.0 (latest 14.2.0).

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
   NEXT for this plan (pick one): (a) App Check monitor→enforce flips per
   endpoint (PLAN #5) after a coverage-measurement window; (b) firestore.rules
   write-path sweep (the pools allow-update isSuperAdmin() rule + playoff/
   props raw writes deliberately parked for it); (c) SWEEP-LATER callable
   fleet (63); (d) tighten the two PERMISSIVE create envelopes (ADR-0001).
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
| `PLAN-SECURITY-OBSERVABILITY.md` + `-SWEEPS.md` + `-REVIEW-LOG.md` | On-hold security plan (also untracked root copies — byte-identical strays, ignore) |
| `PROMPT-GRILL-PLAYER-PROFILES.md` | Consumed — profiles shipped via PR #153 |
| `CONTEXT.md` | Glossary (Sim Run, Test Pool, Scenario, Golden Scenario, Scenario Oracle, …) |
| `docs/adr/0006-*.md` | Real-path fidelity via extracted internals |

## Environment / deploy facts (unchanged)

- Deploy: `npm --prefix functions install` first, then `npx firebase deploy --only functions:… --project gridiron-gamble-uzuqo`. Functions before rules. Frontend = Coolify, auto-rebuilds on push to `main`.
- Emulator tests need Java on PATH: `JAVA_HOME=/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot`; run `npm --prefix functions run test:emulator`. Unit: `npm --prefix functions test` (410 tests; emulator suite 39).
- qodo.ai reviews PRs (14-day trial from 2026-07-10). Its findings have been 6/6 valid but severity is converging — validate before auto-fixing.
- Untracked strays at root: `PLAN-LOOPS.md`, `PLAN-SECURITY-OBSERVABILITY*.md` (copies of branch-committed files). Harmless; don't commit blindly.

## Do NOT re-do

Plans are locked + adversarially reviewed (Codex ×4 for the harness; ×5 for profiles/security). Don't re-grill. Don't author Phase-4 edge fixtures without Kevin verifying expectations. Don't arm `nflFinalize.dryRun:false` without dry-run reports. The `sim-` rules backdoors stay until Phase 5 (supervised).
