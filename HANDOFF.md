# HANDOFF — Commissioner Dashboards + Pool Homepage v2 (2026-07-09)

Single entry point for a fresh session. Two large efforts are **built, reviewed, and deployed to prod**; one operational step remains (a data backfill) and a few items are intentionally deferred.

---

## ⚡ IMMEDIATE NEXT ACTION (do this first)

**Member Roster backfill: DONE 2026-07-09** — function deployed, backfill run, working (roster/mark-paid confirmed). No longer pending.

**Pending: deploy the fully-open live-consensus change (commit `af34ebd`).**
Product decision 2026-07-09 — Consensus card now updates on every pick submit instead of gating until kickoff (anti-copy tradeoff accepted). Touches `functions/src/consensus.ts` (dropped both reveal gates), `functions/src/nflPools.ts` (submit-triggered recompute), and the Pool Homepage card copy.

1. **Functions redeploy** (Firebase-only, unaffected by Coolify branch — safe):
   ```
   npx firebase deploy --only functions:submitNFLPicks,functions:consensusRefreshJob,functions:recomputeConsensus --project gridiron-gamble-uzuqo
   ```
   (Or `--only functions` for all.)
2. **Frontend redeploy** for the card-text change (Coolify). ⚠️ This is a frontend deploy — see the Coolify branch reminder below (switch Source to `main` after merging, per Option A cleanup). If shipping fast on `feat/pool-homepage-v2`, push the branch first so Coolify pulls it.
3. Verify post-deploy: submit a pick in a live pool → Pool Home → Consensus card shows the pool + site-wide split updating without waiting for kickoff.

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

**Verification done:** app+functions typecheck, 332 functions + 244 app unit tests, shared selfchecks, emulator tests (13 passed / 0 failed — needs Java, now installed), and browser screenshots of every UI change via the `/dev/dashboards` mock harness. What could NOT be run locally: the live Firestore aggregation (consensus/win-prob/profiles) — those populate on deploy as the scheduled jobs run and games happen (empty/honest-empty in preseason).

---

## Post-deploy behavior to expect (not bugs)
- **Consensus / win-prob are empty until games are live** and the `*/10`/`*/5` jobs have run; composite indexes (`pools` type+season, `nfl_games` season+seasonType+week — in `firestore.indexes.json`) finish building minutes after deploy.
- **Profiles** populate as weeks are scored (the entry trigger recomputes `publicProfiles`).
- **Pre-backfill**, old pools still show the commissioner-missing behavior until the backfill above runs.

---

## Still TODO / deferred (by design, not forgotten)
1. **Run the backfill** (immediate action above) — blocked only on the functions redeploy.
2. **Expert Picks** — DEFERRED pending Kevin's compliant data-source choice (licensed feed / official API / admin-curated; NOT scraping nflpickwatch). Profile shape is ready to host an "expert" later.
3. **Player Profile stubs** — Team-by-Team, Profit, Achievements render honest "coming soon". Need: per-pick result persistence (Team-by-Team + full pick history), a NFL finalize lifecycle distinct from admin close + `PAYOUT_PAID/UNPAID` ledger events (Profit), and the Achievements feature.
4. **Option A cleanup** — merge both branches → `main`, switch Coolify back to `main` (see branch state above).
5. **Consensus scale** — currently a bounded per-week full recompute (fine at current scale); shard-based incrementalization is the documented scale-up path (ADR 0004).

---

## Environment notes
- Emulator needs **Java** (Temurin 21 now installed): `npm --prefix functions run test:emulator`.
- Node 24 local vs functions node22 runtime — warnings only, harmless.
- Deploy: always `npx firebase ... --project gridiron-gamble-uzuqo`; run `npm --prefix functions install` if you hit stripe/fft TS2307.
- Dev preview harness: `/dev/dashboards` (unauthenticated, mock data — Hub / Homepage / Rules / Payments-Roster / Player Profile). `src/pages/DevDashboardPreview.tsx`. Unlisted; safe to leave or delete before final prod.

## Key files
- Plans/ADRs/logs: `PLAN-COMMISSIONER-DASH.md`, `PLAN-POOL-HOMEPAGE.md`, `docs/adr/0003-*.md`, `docs/adr/0004-*.md`, `NOTES-COMMISSIONER-DASH.md`, `NOTES-POOL-HOMEPAGE.md`, `CONTEXT.md` (glossary).
- Backend: `functions/src/{consensus,winProbability,userProfile,setPaidStatus,rosterAggregate}.ts`, `functions/src/lib/{effectiveLock,memberRecord,rosterSummary,commissionerAggregate,poolInclusion}.ts`, `functions/src/migrations/backfillMemberRecords.ts`.
- Frontend: `src/components/NFLPoolDashboard/{NFLPoolDashboard,NFLUserBentoDashboard,NFLGameTicker,NFLManagerView,NFLPoolRules}.tsx`, `src/components/PaymentsPanel.tsx`, `src/components/Dashboards/GlobalCommissionerDashboard.tsx`, `src/pages/{PlayerProfile,DevDashboardPreview}.tsx`, `src/components/admin/OperationsPanel.tsx`.
- Shared: `shared/{memberRecord,consensus}.ts`.

## Do NOT re-do
The two plans are locked + Codex-reviewed. Don't re-run the grill. Don't fabricate the deferred metrics (Team-by-Team/Profit) — they wait for the data. Don't deploy from `main` without merging first (would revert prod).
