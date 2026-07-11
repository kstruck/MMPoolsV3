# HANDOFF — Session entry point (updated 2026-07-10, post sim-harness ship)

**Start every new session with: "Review HANDOFF.md and pick up where we left off."**
This file + auto-memory carry the full state. Older narrative lives in git history.

---

## Current state: NOTHING IN FLIGHT — all efforts shipped and prod-verified

**NFL Sim Harness (PLAN-NFL-SIM-HARNESS.md) — SHIPPED 2026-07-10.**
Phases 0/1/2/3/4-core/6 built, Codex-approved plan (4 rounds), merged via PR #156,
hardened through a qodo.ai review cycle (PRs #157/#158/#159 — 6/6 findings valid, all
merged + deployed). Prod-verified twice by Kevin: all 3 NFL Test Suite scenarios green,
sweep dry-run clean (`{stranded:0, skippedActive:0}`), all `simRuns` manifests CLEANED,
zero residue. The build's first golden run also **found + fixed a real prod bug**
(`submitNFLPicks` wrote `confidence: undefined` — every non-confidence pick'em
submission would have failed INTERNAL on opening day).

Everything earlier (Player Profiles PR #153, Expert Picks ingestion, live consensus,
ticker speed, Member Roster backfill, Option-A/Coolify-to-main cleanup) also shipped —
see memory + git history.

## ⚡ Kevin's pending 5-minute item

**Arm the finalize sweep** (safe now — Phase 0 closed the sim-pool hazard):
1. Firestore console → `system` collection → `config` doc.
2. Add field `nflFinalize`, type **map**, containing `enabled` (boolean) = `true` and
   `dryRun` (boolean) = `true`.
3. Sweep runs daily 08:30, REPORTS ONLY while dryRun. After 1-2 days check
   SuperAdmin → Admin Audit Log for `NFL_FINALIZE_SWEEP` entries; when candidate
   lists look sane, ask Claude for the flip-to-live step.

## Next-effort menu (pick one to start a session)

1. **Sim Harness Phase 5** — legacy simulator migration (squares SimulationDashboard +
   tournament utils off raw client writes onto guarded callables) + drop the two
   `firestore.rules` backdoors (`slug matches '^sim-.*'` create; `isSuperAdmin()` raw
   entry writes). SUPERVISED session — rules changes. Plan section: PLAN-NFL-SIM-HARNESS.md
   Phase 5 (items 28-30).
2. **Sim Harness Phase 4 edge fixtures** — ~2 dozen hand-authored edge scenarios (tie
   games, exact-spread ATS pushes, missed-pick weeks, dual-MNF tiebreakers,
   pickLosers/autoSurvive, cancelled-game VOIDs, rebuy JSON flows, buy-flow stamps).
   Claude generates each fixture + computed expectations; **Kevin sanity-checks the
   expected values** (the plan's oracle-honesty rule). Plan items 25-27.
3. **Security/Observability plan — ON HOLD, resume when sim work satisfies Kevin.**
   Branch `feat/security-observability-phase1` (worktree `.claude/worktrees/security-observability`),
   2/41 TARGET-NOW callable retrofits done, 39 remain. FIRST STEP ON RESUME: merge main
   into the branch (13+ behind, overlapping callable files). Plan: PLAN-SECURITY-OBSERVABILITY.md.
4. **Player Profiles follow-ups** — flip `profileBackfill`/`nflFinalize` dry-runs after
   reports look right; Achievements engine requirements (Kevin gathering); Expert Picks
   UI surface (`nfl_games/{id}.expertPredictions` is ingesting, nothing displays it yet).

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
