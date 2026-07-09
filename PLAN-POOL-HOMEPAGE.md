# Plan: Pool Homepage v2 — real metrics, live scores, consensus, profiles
_Locked via grill-with-docs — by Claude + Kevin. Terms per CONTEXT.md. Architecture per ADR 0004._

## Goal
Turn the member Pool Homepage into a real, trustworthy hub: honest metrics (no fabricated data), live scores for the whole slate, pick Consensus (pool + site-wide) and real Live Win Probability per game, sane navigation, and a Player Profile for every member. Expert Picks is scoped out pending a compliant data source. Kevin chose "no cut" — all of this targets before preseason; the ordering below front-loads the low-risk UX and the shared stats foundation, and flags the aggregation-heavy pieces as the schedule risk.

## Approach

### Phase 0 — data-hygiene + lock prerequisites (must land first, per Codex review)
0a. **Align the raw NFL status type** — pools are created `status:'OPEN'` but NFL types still declare `'active'|'archived'`; fix the raw stored `status` type to what's actually written (`OPEN|LOCKED|LIVE|FINAL`), kept **distinct** from the derived lifecycle label (`getPoolLifecycleState`, where `CLOSED` is derived). Consistent names across plan/ADR/CONTEXT/rules/tests; no new conflicting enum.
0b. **Fix ESPN game-state mapping** — `syncNFLScoresJob` maps every non-`post`/`in` state to `SCHEDULED` (`nflSchedule.ts:83`); map `canceled/postponed/delayed` explicitly, with tests, so those games don't surface/score wrong.
0c. **Bound the score sync** — add the missing lower bound to the `syncNFLScoresJob` query (currently `startTime <= now+2h` only, dragging the whole past season each 5-min run).
0d. **Centralized `effectiveLockAt(pool, week, game)`** server helper (buffer + `weekLockOverride` + kickoff), reused by **every** lock decision: `submitNFLPicks`, **`proxyPick`**, the commissioner exception flows (`poolExceptions.ts`), Pool-Consensus reveal, and Site-Wide-Consensus publish. No path keeps duplicate lock math. Consensus never reveals before a game's `effectiveLockAt`.
0e. **Tighten entry-read rules** — a member reads only their **own** entry, always. An entry doc bundles all game picks and pools support `PER_GAME` lock, so another member's entry is readable only when **every pick in it is reveal-safe** (last game locked / week complete via a server flag, or pool final) — never at "first kickoff". Per-game revealed picks + all consensus come from server projections; standings/scores read scored fields (`weeklyResults`/`totalScore`), never raw un-revealed entries.

### A. Navigation & layout (UX, low risk) — maps items 1, 2, 5
1. **Tab (+week+game) in the URL + rename Overview → "Pool Home".** Move `NFLPoolDashboard` `activeTab` **and** `selectedWeek` **and** the selected game/view into `?tab=&week=&game=` search params (default `dashboard`=Pool Home), so Back/refresh restore the full drilldown, not just the tab. Tab/game clicks `navigate` (push) so the browser **Back** steps through them instead of leaving the pool; "Full Standings" and in-page links push too. Rename the "Overview" tab label to **Pool Home**. Model on the bracket dashboard's existing search-param pattern. (Recon: tabs are pure `useState` today, `NFLPoolDashboard.tsx:40,256-266`; Full Standings is `onSelectTab` `NFLUserBentoDashboard.tsx:976`.)
2. **Enlarge the Live Weekly Pick'em card** and make the Week slate readable — give the card more width/height in the bento grid, larger slate rows, clear typography. (Item 2.)
3. **Fix the rebuy strip** (`NFLUserBentoDashboard.tsx:1142-1194`, hardcoded, not type-gated): show it **only on Survivor pools**, label it a **date** (from `settings.rebuyDeadlineWeek` → resolved kickoff date), not "Week 4-6". Non-survivor pools don't show a rebuy item. (Item 5.)

### B. Live scores + slate (reuses existing `nfl_games`, no new backend) — maps items 3, 6, 7
4. **Per-game live scores in the slate.** Each slate row shows team scores + game state: live → score + clock/quarter; final → final score; scheduled → day/time. Data from the existing `subscribeToNFLGames` snapshot (`scores/clock/period/status`, synced every 5 min). (Item 7.)
5. **Live score ticker** across the top of the homepage — an NFL ticker (there's an NCAA `LiveScoreTicker` to model, `BracketPoolDashboard/`), fed by `nfl_games` for the pool's week/season. (Item 7.)
6. **Per-game detail, not one focus game.** Clicking a slate game shows that game's live score + Consensus + Live Win Probability (the screenshot-2 layout). A "full week" link opens a list view of every game with the same metrics. Replaces the single `focusGame` model. (Items 3, 6.)

### C. Consensus + real Live Win Probability (ADR 0004) — maps item 6
7. **Pool Consensus** — a **pool-scoped server aggregate** (same shard pipeline as Site-Wide, scoped to one pool), per-game lock-gated projection the client reads. **Not** client-side from raw `entries` — that would let a participant read others' picks pre-lock (rules can't gate per-game within a doc). `PickDistribution`'s math moves server-side. Rename the "Win Probability" tile to **Consensus**.
8. **Site-Wide Consensus** — built from **per-pool/per-game shards** under a **server-only path** (`consensusShards/*`, no client read) rolled up by an **idempotent reducer** (no rescans, no hot-doc increments). The **public** projection `consensus/{season}_{week}/{poolType}/{gameId}` holds **only post-lock aggregate counts**, type-scoped (never one blended %). Client reads only the public projection. No client ever reads other pools' raw entries or the private shards.
9. **Real Live Win Probability — best-effort, isolated** — a **separate** job (not the score sync; ESPN's scoreboard has no win-prob) fetches a win-prob source per in-progress game and stores it in a **per-game subcollection** `nfl_games/{id}/winprob/*` (read week/game-scoped, not season-wide). Its failure never blocks score writes; absent → honest empty state. Distinct from Consensus.

### D. Real Performance Stats — delete the fakes (ADR 0004) — maps item 4
10. **Persist per-week results — type-specific + versioned.** `scoreNFLWeek` writes a pool-type-specific `weeklyResults[week]` (Pickem `{correct,total,points,mode}`; Survivor `{survived,strike}`; Margin `{net}`) + `resultsVersion`, and emits a "pool/week scored" event. Additive; `correctCount` is computed today and discarded (`nflPools.ts:706-712`). Certified scoring path only gains fields — must pass the NFL unit + emulator suites.
11. **Per-user Performance Stats aggregate** (`users/{uid}/performance/*`, private) — **recomputed from authoritative entry state** keyed by `resultsVersion` on the scored event (never naive `onWrite` increments — rescores/Margin 2nd pass/proxy edits would double-count). Type-scoped rollups, streaks, rank-percentile inputs, team-by-team.
12. **Make the homepage metrics real or delete them:** Pick Accuracy from real per-type results (no blended cross-type "accuracy"); **redefine the Performance Radar** with real axes + **real** Pool/Site averages (delete hardcoded 62/58/50/55/50 and `speed=65` "Agility"); Survivor Attrition from real weekly eliminations; standings sparkline from real recent form. Anything not yet backable shows a true empty state — never a mock number.

### E. Player Profiles (ADR 0004) — maps item 8.2
13. **NFL finalize lifecycle + Profit.** Add a real NFL season-finalize path **distinct from admin close** (`closePool`/`autoClosePools` emit zero stats deltas); it writes `users/{uid}/seasonHistory` (mirror `bracketScoring`). Emit the currently-unwritten `PAYOUT_PAID`/`PAYOUT_UNPAID` ledger events; **Profit** = per-entry fees + real payout events (multi-entry aware).
14. **Player Profile page** reads a **sanitized `publicProfiles/{uid}` projection** (never the private `users/{uid}`/`seasonHistory`/`performance`, which span private pools). Shows **aggregate + finalized/scored** data only — performance chart, weekly record, team-by-team, yearly record, Profit; **current-season pick history is gated per game until post-lock/post-final** so the profile can't leak un-revealed picks. **No gambling "units."** Achievements is a stub (separate future feature). Model on the AP-profile screenshots.

### F. Expert Picks — DEFERRED (item 8.1)
15. Out of scope pending a compliant data source (licensed feed / official API / admin-curated import). No third-party scraping. Profiles are built so an "expert" can later be just another profile shape. **Morning/decision item for Kevin: pick a source.**

## Key decisions & tradeoffs
- **Phase 0 prerequisites gate everything** — align the NFL status enum, fix ESPN canceled/postponed mapping, bound the score-sync query, centralize `effectiveLockAt`, and tighten entry-read rules before layering new logic (see [ADR 0004](docs/adr/0004-performance-stats-and-consensus-layer.md)). These are correctness/security foundations, not polish.
- **One shared Performance Stats + Consensus layer**, all server-maintained, clients read-only. Per-week results are persisted **type-specific + versioned** (no blended cross-type "accuracy"); per-user aggregates **recompute from authoritative state** (idempotent, not increment-on-write).
- **Security**: entry reads restricted to participants/owner/admin; Site-Wide Consensus is a **lock-gated, type-scoped, aggregate-only** projection built from idempotent shards; Player Profile reads a **sanitized `publicProfiles/{uid}`** projection, not the private per-user docs.
- **Consensus AND real Live Win Probability** (Kevin) — consensus = pick %, win-prob = real outcome estimate. Win-prob is **best-effort from a SEPARATE ESPN endpoint** (the scoreboard has none), fully isolated from score writes, stored per-game (not on the season-wide `nfl_games` doc).
- **Missing NFL lifecycle built**: a real finalize path distinct from admin close; `PAYOUT_PAID/UNPAID` events written so **Profit** (per-entry fees + payouts, multi-entry aware) is computable.
- **Tab + week + game move to the URL** so Back/refresh restore the full drilldown; "Overview" → "Pool Home".
- **No fabricated data** — real or honest empty state; the mock `5/2`=71%, `50+diff*5`, name-hash sparklines, fixed-decay attrition, and hardcoded rebuy strip are removed.
- **Expert Picks deferred** — needs a compliant source decision first.
- **"No cut" retained but flagged** — per Codex, the risky items are new authorization surfaces, new aggregation infrastructure, a missing NFL finalization lifecycle, and a new external dependency, not UI polish. Phase 0 + the auth/lifecycle/aggregation foundations are the real preseason schedule risk; ordering front-loads them so a slip degrades the heavy rollups (site-wide consensus, profiles, win-prob), not the honest UX + live-score core.

## Risks / open questions
- `scoreNFLWeek` is a Test-Suite-certified hot path; the additive `weeklyResults`/`resultsVersion` write + scored-event emit must pass the NFL unit + emulator suites before merge.
- Per-user recompute idempotency under rescores, Margin's second rank pass, and pick/proxy edits — must re-derive from authoritative state by `resultsVersion`, verified with the survivor-rescore emulator test as a model.
- Real win-probability has **no free source** — ESPN's scoreboard lacks it; a separate endpoint (best-effort) is required, isolated so failures never block scores; absence must render an honest empty state. Feasibility of a reliable source is an open risk.
- Site-Wide Consensus cost/hotspotting — must be per-pool/per-game shards + idempotent reducer, lock-gated, type-scoped; never a rescan or hot-doc increment.
- Firestore rules are a **security gate**: entry-read tightening (may affect existing readers), `publicProfiles` sanitization, `performance`/`seasonHistory` owner-only, `consensus` aggregate-only world read.
- The NFL finalize lifecycle is net-new; must be distinct from admin close and not double-fire on rescores.
- Profit edge cases (unpaid prizes, multi-entry pools, honor-system fees) — define from per-entry fee + real payout events; pin during build.
- URL state for tab+week+game must round-trip on Back/refresh without breaking bracket/other dashboards.
- Expert Picks data source is unresolved and blocks item 8.1.
- **Scope**: "no cut" spans multiple net-new backend subsystems; the preseason date is the risk. Phase 0 + foundations first so a slip drops the heaviest rollups, not the core.

## Out of scope
- Expert Picks implementation (deferred; source TBD).
- Achievements (separate future feature; stub only).
- Non-NFL pool homepages beyond what the shared components naturally cover.
- The commissioner-dashboard / roster work (separate effort on `feat/commissioner-dash`).
