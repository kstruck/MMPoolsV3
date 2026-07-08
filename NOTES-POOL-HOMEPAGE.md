# Pool Homepage v2 — build status

Branch: `feat/pool-homepage-v2` (off `feat/commissioner-dash`, which has the slate/type-gating this builds on — merge in sequence: commissioner-dash → pool-homepage). Plan: PLAN-POOL-HOMEPAGE.md · ADR 0004. Nothing deployed.

## Done (typecheck + tests green; UI verified in preview)

**Phase 0 — prerequisites (commit 0b35a53)**
- Raw NFL pool `status` type aligned to `OPEN|LOCKED|LIVE|FINAL|CANCELED|COMPLETED|archived`, kept distinct from the derived `getPoolLifecycleState` label.
- `mapEspnGameStatus()` — ESPN canceled/forfeit → CANCELLED, postponed/suspended/delayed → SCHEDULED (a canceled game no longer maps to FINAL and scores 0-0). Unit-tested.
- `syncNFLScoresJob` query lower bound added (now-24h..now+2h) so the 5-min job stops scanning the whole past season.
- `effectiveLock` helper (buffer + kickoff + week override) = single lock source; fixed the 3 `submitNFLPicks` per-game checks that used raw kickoff and ignored the commissioner override (dead `gameLockTime` removed). Unit-tested.
- Entry-read rule now requires participation for the locked read (closes the any-authed post-lock pick-visibility hole). 332 functions unit tests pass incl. the certified NFL suite.

**Phase A — nav + layout (commits 06825f3, 4c660d1)**
- Tabs + selectedWeek ride in the URL (`?tab=&week=`); tab changes push history so **Back steps through tabs** instead of leaving the pool; refresh restores the view. "Overview" → **"Pool Home"**.
- Rebuy footer node: Survivor-only, shows a real **date** (first kickoff of `settings.rebuyDeadlineWeek`), hidden on Pick'em/Margin.
- Live Weekly Pick'em card is full-width; slate is a larger 2-col grid with **inline live/final scores** + LIVE clock, or day/time when scheduled.

**Phase B — live scores + per-game focus (commit 9692541)**
- `NFLGameTicker`: auto-scrolling live-score ticker across the homepage top, real `nfl_games` data (item 7).
- Every slate row + ticker game is clickable → sets the focus game (URL `?game=`); the top match panel updates to any chosen game; Back/refresh restore it (item 6 per-game detail; single-`focusGame` model replaced by selectable).
- Full-week slate = the clickable list view with inline scores (items 2/4/6).
- Verified in preview: ticker live/final/scheduled; clicking SF@GB switched the focus panel to SF 24 @ GB 20 FINAL. App tests 244 + build green.
- **Still fake in Card A (deleted/replaced in Phase C/D):** the "Win Probability" tile + graph are the old fabricated values; per-game **Consensus** + **real win-prob** content is Phase C.

**Phase C — Consensus + real Live Win Probability (commit 4bbb256)**
- `shared/consensus.ts` pure tally (selfcheck passes). `functions/consensus.ts`: `recomputeWeekConsensus` (idempotent per-week full recompute) → Pool Consensus (`pools/{id}/consensus/{gameId}`, member read, post-lock, per-pool lock-gated) + Site-Wide (`consensus/{season_seasonType_week}/{poolType}/{gameId}`, public, published only after kickoff, aggregate-only). `consensusRefreshJob` (*/10) + `recomputeConsensus` callable.
- `functions/winProbability.ts`: `syncWinProbabilityJob` (*/5) — ESPN's SEPARATE summary winprobability endpoint per in-progress game, isolated from scores, stored `nfl_games/{id}/winprob/current`.
- Rules for consensus (pool member / site public) + winprob (public), server-write-only. dbService subscriptions. Bento: fake "Win Probability" tile DELETED, replaced with real Consensus (Pool + Site-Wide) + Live Win Prob + honest empty state (verified in preview). fn 332 + app 244 tests green.
- **Populates only after the CFs deploy + run** (pre-deploy = empty state, correct). **Scale note:** consensus is a bounded per-week full recompute; shard-based incrementalization is the scale-up path if pool count grows large.
- **Composite indexes needed on deploy** (Firebase will log the exact links): `pools` (type ==, season ==); `nfl_games` (season ==, seasonType ==, week ==). Add them or the jobs error.

## Deploy note (important)
The Phase 0 entry-read rule is net-safer than today (plain members already can't collection-query entries pre-lock; this only removes the non-member post-lock hole). Safe to deploy with the functions/rules bundle. **Residual (round 5):** in PER_GAME-lock pools a participant can still read another participant's later-game picks post-week-lock via raw entry reads — fully closed only when the **server consensus/standings projection** (Phase C/D) replaces client entry reads. Track that; don't consider per-game reveal safety complete until then.

## Not yet built (large, backend-heavy — need focused sessions; emulator not runnable here, no Java)
- **Phase B**: NFL live-score ticker across the homepage; per-game detail panel (click a game → its score + consensus + win-prob); full-week list view.
- **Phase C**: Pool + Site-Wide **Consensus** as server aggregates (private `consensusShards/*` → public post-lock `consensus/{season}_{week}/{poolType}/{gameId}` projection, idempotent reducer, lock-gated via `effectiveLockAt`); real **Live Win Probability** from a separate ESPN endpoint (isolated from score writes) stored per-game.
- **Phase D**: delete the fabricated metrics; persist type-specific `weeklyResults`+`resultsVersion` in `scoreNFLWeek` (emit a scored event); per-user `performance/*` aggregate (recompute-from-authoritative); redefine the Performance Radar with real axes + real averages.
- **Phase E**: NFL finalize lifecycle (distinct from admin close) + `PAYOUT_PAID/UNPAID` events + Profit; `publicProfiles/{uid}` projection; Player Profile page (weekly record, pick history [reveal-gated], team-by-team, yearly record, Profit; Achievements stubbed).
- **Phase F**: Expert Picks — **DEFERRED**, needs a compliant data source decision (licensed feed / official API / admin-curated; not scraping). **Morning item for Kevin.**

## Verify/deploy when ready
`npm --prefix functions run test:emulator` (needs Java) for the lock/scoring wiring. Then the standard `npx firebase deploy` for functions + rules. Full plan/risks in PLAN-POOL-HOMEPAGE.md; review trail in PLAN-POOL-HOMEPAGE-REVIEW-LOG.md.
