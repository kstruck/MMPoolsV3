# HANDOFF — Commissioner Dashboards + Pool Homepage v2 (2026-07-09)

Single entry point for a fresh session. Two large efforts are **built, reviewed, and deployed to prod**. Backfill + live-consensus (functions) shipped 2026-07-09. One **frontend Coolify deploy is intentionally held** (Kevin's call, pending the Option-A merge-to-main cleanup) — it carries two committed-but-undeployed frontend changes (consensus card copy + ticker speed). A few items remain deferred by design.

---

## ⚡ MORNING LIST (2026-07-10) — do these

Overnight effort committed to `main` (5 commits, **UNPUSHED**: `3d65ab3` expert-picks, `90de09d` grill prompts, `d31a98b` handoff, `2e61a9f` sim-block removal, `a99e8fa` vitest bump). Nothing deployed overnight — all outward-facing steps are below with your hand on them.

**A. Deploy Expert Picks** (functions only; commit `3d65ab3`). From `D:\march-melee-pools` (repo root, on `main`):
1. `git status` then `git log --oneline -5` — confirm top commit is `a99e8fa`.
2. `git push origin main`  ⚠️ Coolify is on `main` and may auto-rebuild the frontend — harmless; only `2e61a9f` (removed a legacy SuperAdmin Settings block, tsc+build verified) and `a99e8fa` (functions-only test-tooling bump) touch code, neither changes user-facing frontend behavior.
3. `npm --prefix functions install`  (guards against stripe/fft TS2307)
4. `npx firebase deploy --only functions:syncExpertPicksJob,functions:refreshExpertPicks --project gridiron-gamble-uzuqo`
5. Verify: ingestion-only (no UI yet). Preseason has no ESPN FPI data, so `nfl_games/{id}.expertPredictions` stays empty until games are scheduled (Aug) — like consensus/win-prob. Optionally call `refreshExpertPicks` (SUPER_ADMIN) from the console to confirm it runs clean.

**B. Ticker speed** — SuperAdmin → Settings → "Score Ticker Speed" → set to **~100** (higher = slower; your earlier 30 ≈ the 32s baseline, which is why it looked unchanged). Hard-refresh homepage.

**C. Sim Tools — DONE.** Kevin confirmed delete (`2e61a9f`). The legacy "Simulation Tools" block is gone from SuperAdmin → Settings; Test Suite tab (`/tournament-sim`) is the sole home for simulation tooling. Verify after deploy: Settings tab no longer shows it; Test Suite tab's Tournament Simulator still works.

**D. Two big lifts — grill prompts ready to paste** (planning, per your request):
- `PROMPT-GRILL-PLAYER-PROFILES.md` — profile page for every pool member (AP Pro Picks style; no units; profit = pool winnings; hosts Achievements as a stub).
- `PROMPT-GRILL-NFL-SIM-HARNESS.md` — simulate all NFL pool types for preseason confidence (extends existing `simHarness.ts`).
Open each, paste its `/grill-with-docs-codex …` block to start.

**E. Dependabot — DONE.** All 5 alerts closed (`a99e8fa`): `vitest` bumped 2.1.9→4.1.10 (went further than the planned 2→3; `npm install vitest@latest` resolved higher). `vite` (transitive) 5.4.21→8.1.4; `esbuild` dropped from the tree. Verified both before and after: functions tsc, 341 unit tests, 13 emulator tests, functions build, app build — all green. 2 unrelated moderate findings remain (`firebase-functions-test`, `ts-deepmerge`) — pre-existing, out of tonight's scope; low priority whenever you want them looked at.

---

**Done + deployed 2026-07-09 (prior session):** Option A cleanup complete — `main` fast-forwarded + pushed, Coolify switched to `main`, redeployed (`d468ea9`, healthy). Prod on `main` again (see [[coolify-branch-state]]).

**Done + deployed this session (2026-07-09):**
- **Member Roster backfill** — function deployed, backfill run, working (roster/mark-paid confirmed).
- **Fully-open live consensus (functions)** — `submitNFLPicks`, `consensusRefreshJob`, `recomputeConsensus` deployed to prod (exit 0). Consensus now recomputes on every pick submit; both reveal gates dropped in `functions/src/consensus.ts`; submit-triggered recompute in `functions/src/nflPools.ts`. Aggregate-only (counts/pct) — individual picks still leak-proof (raw entries gated; docs hold only away/home/total/pct). Populates live once real picks come in.

Verify after the eventual frontend deploy: submit a pick in a live pool → Pool Home → Consensus card shows pool + site-wide split updating without waiting for kickoff; SuperAdmin ticker-speed input changes scroll speed for all viewers.

---

## Branch + deploy state (READ — Option A was used)

- **Prod is deployed from branch `feat/pool-homepage-v2`, NOT `main`** (Option A: fast path, skipped merging).
- Backend: **Firebase project `gridiron-gamble-uzuqo`** — functions + `firestore.rules` + `firestore.indexes.json` deployed. ✅
- Frontend: **Coolify** (repo `kstruck/MMPoolsV3`, app `ics4kkww0c8oo0gw4wkg8w4o`) builds the Dockerfile from `feat/pool-homepage-v2` → nginx serves `dist` at www.marchmeleepools.com. ✅
- `.firebaserc` is empty → always pass `--project gridiron-gamble-uzuqo`.
- Coolify pulls from GitHub → **push the branch before redeploying frontend**.
- **⚠️ REMINDER (Kevin asked): before any FUTURE deploy, remind him to switch the Coolify Source branch back to `main`.** Clean finish for Option A: merge `feat/commissioner-dash` → `main`, then `feat/pool-homepage-v2` → `main`, switch Coolify Source to `main`, redeploy. (Also in memory: `coolify-branch-state`.)

Branch stack: `feat/pool-homepage-v2` was cut FROM `feat/commissioner-dash`, so it contains **both** efforts.

---

## What's built + live

### Effort 1 — Commissioner dashboards / roster / payments (branch feat/commissioner-dash, folded into pool-homepage-v2)
Plan: `PLAN-COMMISSIONER-DASH.md` · ADR: `docs/adr/0003-unified-pool-roster-model.md` · Status: `NOTES-COMMISSIONER-DASH.md` · Review trail: `PLAN-COMMISSIONER-DASH-REVIEW-LOG.md`.
- Nav split (My Entries vs Manage My Pools → Commissioner Hub), killed the never-written `managerStats` blob, honest Dues (Collected/Expected) cards.
- **Member Record model (ADR 0003):** `pools/{id}/members/{uid}` = cross-type roster + payment truth. Owner seeded on create (all pool types); joiner seeded on join; survivor rebuy dues on the record. `setPaidStatus` callable (commissioner-authoritative + member self-claim). `rosterSummary` projection. Aggregate-stats trigger. **Emulator-verified.**
- Payments tab: roster shows everyone who joined (incl. commissioner + no-entry members), mark-paid, reminders, "Edit/Manage Payments" button.
- Commissioner Hub redesign (grouped by type, filter, grid). Rules & Rulesets tab: commissioner edit + season lock.

### Effort 2 — Pool Homepage v2 (branch feat/pool-homepage-v2)
Plan: `PLAN-POOL-HOMEPAGE.md` · ADR: `docs/adr/0004-performance-stats-and-consensus-layer.md` · Status: `NOTES-POOL-HOMEPAGE.md` · Review trail: `PLAN-POOL-HOMEPAGE-REVIEW-LOG.md`. Both plans went through 5-round adversarial Codex review (grill-with-docs-codex).
- **Phase 0:** raw NFL status enum aligned; ESPN canceled/postponed mapping (`mapEspnGameStatus`); `syncNFLScoresJob` lower bound; centralized `effectiveLockAt` (fixed a real per-game override bug in `submitNFLPicks`); entry-read rules tightened.
- **Phase A:** tabs+week in URL (Back works), "Overview"→"Pool Home", survivor-only rebuy DATE, enlarged Live Weekly Pick'em card + readable slate with inline scores.
- **Phase B:** live-score ticker (`NFLGameTicker`) + click-any-game focus (URL `?game=`).
- **Phase C:** Consensus (pool + site-wide) as leak-proof server aggregates (`functions/consensus.ts`, `consensusRefreshJob` */10) + real Live Win Probability from ESPN's SEPARATE summary endpoint (`functions/winProbability.ts`, `syncWinProbabilityJob` */5, per-game storage). Deleted the fake win-prob tile.
- **Phase D:** `scoreNFLWeek` persists real per-week W-L (`weeklyResults`+`resultsVersion`); deleted every fabricated metric (radar/accuracy/attrition/sparkline) → real or honest empty.
- **Phase E:** Player Profiles — `functions/userProfile.ts` recomputes `publicProfiles/{uid}` (real overall stats, weekly record, performance chart) + `/profile/:uid` page. `onEntryChangedRecomputeProfile` trigger.

### Post-launch changes (2026-07-09)
- **Fully-open live consensus** (commit `af34ebd`, functions DEPLOYED): consensus updates on every pick submit instead of at kickoff. Dropped the pre-lock pool-tally gate and the site-wide kickoff-publish gate in `consensus.ts`; `submitNFLPicks` fires an idempotent per-week recompute after the entry txn (non-fatal). Still aggregate-only — individual picks never exposed. Anti-copy tradeoff accepted by product owner. Card copy updated (frontend, pending Coolify deploy).
- **Admin-controllable ticker speed** (commit `4f4aa14`, frontend pending Coolify): `SystemSettings.tickerDurationSec` (system/config, default 60s, was fixed 32s). `Ticker` takes a `durationSec` prop (inline `animationDuration` overrides the class); `NFLGameTicker` subscribes to settings and passes it live; SuperAdmin → Settings → "Score Ticker Speed" number input (15–180s, commits on blur).

**Verification done:** app+functions typecheck, 332 functions + 244 app unit tests, shared selfchecks, emulator tests (13 passed / 0 failed — needs Java, now installed), and browser screenshots of every UI change via the `/dev/dashboards` mock harness. What could NOT be run locally: the live Firestore aggregation (consensus/win-prob/profiles) — those populate on deploy as the scheduled jobs run and games happen (empty/honest-empty in preseason).

---

## Post-deploy behavior to expect (not bugs)
- **Consensus / win-prob are empty until games are live** and the `*/10`/`*/5` jobs have run; composite indexes (`pools` type+season, `nfl_games` season+seasonType+week — in `firestore.indexes.json`) finish building minutes after deploy.
- **Profiles** populate as weeks are scored (the entry trigger recomputes `publicProfiles`).
- **Pre-backfill**, old pools still show the commissioner-missing behavior until the backfill above runs.

---

## Still TODO / deferred (by design, not forgotten)
1. **Expert Picks — data layer BUILT (`3d65ab3`), needs deploy (morning A) + a display/profile layer.** Source resolved: ESPN FPI predictor + Vegas-from-spread (compliant, no scraping). `functions/src/expertPicks.ts` ingests per-game predictions to `nfl_games/{id}.expertPredictions`. STILL TODO: surface them in the UI, and the "expert as a tracked profile" (W-L record like AP Pro Picks) — that shares the Player Profile data model, so it's in the Player Profiles grill plan (`PROMPT-GRILL-PLAYER-PROFILES.md`).
2. **Player Profiles for every member — GRILL PROMPT READY** (`PROMPT-GRILL-PLAYER-PROFILES.md`). AP Pro Picks style; no units; profit = pool winnings; hosts Achievements as a stub. Blockers to resolve in planning: per-pick result persistence (Team-by-Team + pick history), NFL finalize lifecycle + `PAYOUT_PAID/UNPAID` ledger (Profit), achievements data contract. Supersedes the old "Player Profile stubs" item.
3. **NFL pool simulation harness — GRILL PROMPT READY** (`PROMPT-GRILL-NFL-SIM-HARNESS.md`). Preseason-confidence sim for all NFL pool types. EXTENDS existing `functions/src/simHarness.ts` (simRunId isolation + audit). Folds in: delete legacy Settings "Simulation Tools" block (morning C), fix SimulationDashboard `.squares` crash.
4. **Consensus scale** — currently a bounded per-week full recompute (fine at current scale); shard-based incrementalization is the documented scale-up path (ADR 0004).
5. **Dependabot** — 5 dev-only `functions/` alerts (vite/vitest/esbuild); low priority, needs a reviewed major bump (morning E).

_(Done + removed from this list: Member Roster backfill, live-consensus, Option-A cleanup/Coolify-to-main, frontend card+ticker deploy — all shipped 2026-07-09.)_

---

## Environment notes
- Emulator needs **Java** (Temurin 21 now installed): `npm --prefix functions run test:emulator`.
- Node 24 local vs functions node22 runtime — warnings only, harmless.
- Deploy: always `npx firebase ... --project gridiron-gamble-uzuqo`; run `npm --prefix functions install` if you hit stripe/fft TS2307.
- Dev preview harness: `/dev/dashboards` (unauthenticated, mock data — Hub / Homepage / Rules / Payments-Roster / Player Profile). `src/pages/DevDashboardPreview.tsx`. Unlisted; safe to leave or delete before final prod.

## Key files
- Plans/ADRs/logs: `PLAN-COMMISSIONER-DASH.md`, `PLAN-POOL-HOMEPAGE.md`, `docs/adr/0003-*.md`, `docs/adr/0004-*.md`, `NOTES-COMMISSIONER-DASH.md`, `NOTES-POOL-HOMEPAGE.md`, `CONTEXT.md` (glossary).
- Backend: `functions/src/{consensus,winProbability,userProfile,setPaidStatus,rosterAggregate}.ts`, `functions/src/lib/{effectiveLock,memberRecord,rosterSummary,commissionerAggregate,poolInclusion}.ts`, `functions/src/migrations/backfillMemberRecords.ts`.
- Frontend: `src/components/NFLPoolDashboard/{NFLPoolDashboard,NFLUserBentoDashboard,NFLGameTicker,NFLManagerView,NFLPoolRules}.tsx`, `src/components/ui/Ticker.tsx`, `src/components/PaymentsPanel.tsx`, `src/components/Dashboards/GlobalCommissionerDashboard.tsx`, `src/pages/{PlayerProfile,DevDashboardPreview}.tsx`, `src/components/admin/OperationsPanel.tsx`, `src/components/SuperAdmin.tsx` (Settings tab).
- Config/settings: `src/services/settingsService.ts` + `SystemSettings` in `src/types/index.ts` (system/config doc: maintenanceMode, poolTypeFlags, autoClose, `tickerDurationSec`).
- Shared: `shared/{memberRecord,consensus}.ts`.

## Do NOT re-do
The two plans are locked + Codex-reviewed. Don't re-run the grill. Don't fabricate the deferred metrics (Team-by-Team/Profit) — they wait for the data. Don't deploy from `main` without merging first (would revert prod).
