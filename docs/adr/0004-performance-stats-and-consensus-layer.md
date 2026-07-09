# ADR 0004: A real Performance Stats + Consensus aggregation layer

Date: 2026-07-08
Status: Accepted

## Context

The Pool Homepage's "analytics" are almost entirely fabricated, and the data to make them real is not persisted anywhere:

- **Per-week W-L is discarded.** `scoreNFLWeek` computes `correctCount` in `scorePickemEntry` (`nflScoringEngine.ts:19-79`) but only writes `weeklyPoints` + `totalScore` to the entry (`nflPools.ts:706-712`); `correctCount` is used transiently for a recap highlight and thrown away. So accuracy / correct-incorrect W-L cannot be shown truthfully.
- **No per-user cross-pool index.** Picks live at `pools/{poolId}/entries/{ownerUid}`; there is no query path that gathers a user's entries across pools. A profile would otherwise fan out over every pool's `entries` subcollection.
- **No profit/winnings per user.** No live writer records prizes-won or fees; only one-off backfill scripts (`backfillHistoricalStats.cjs`, `backfill.ts`) touch `historicalStats`, which the UI never reads.
- **NFL pools don't write season history.** Only `bracketScoring.ts:533-550` writes `users/{uid}/seasonHistory`; NFL Pickem/Survivor/Margin write nothing, so a "yearly record" would be bracket-only.
- **No cross-pool pick aggregation.** Pick consensus (`PickDistribution.tsx`) is per-pool only; `getPoolsByType` is used only for prize/participant counts. Site-wide consensus is net-new, and no client may read every pool's entries (rules forbid it).
- **No real win-probability.** `liveWinProb` is `50 + scoreDiff*5` with `sin()`-noise history (`NFLUserBentoDashboard.tsx:234-320`); ESPN's `winprobability` endpoint is never fetched.

The product decision (2026-07-08) is to make these metrics **real**, add **Pool + Site-Wide Consensus** and **real Live Win Probability**, and build **Player Profiles** — all before preseason. That requires one shared persistence + aggregation layer rather than per-card hacks.

## Decision

### Phase 0 — data-hygiene prerequisites (must land first)
Adversarial review surfaced existing inconsistencies that new logic must not be layered on:
- **Align the raw NFL status type with what is written.** Pools are created `status:'OPEN'` but the NFL types still declare `'active'|'archived'` (`nflPoolTypes.ts`). Fix the raw stored `status` type to the values actually written (`'OPEN'|'LOCKED'|'LIVE'|'FINAL'`). Keep this **distinct from the derived lifecycle label** produced by `getPoolLifecycleState` (`OPEN/LOCKED/LIVE/FINAL/CLOSED`, where `CLOSED` is derived from admin-close, not a raw status). Do not invent a new enum that conflicts with the existing lifecycle helper; raw status and derived lifecycle keep separate, consistent names across plan/ADR/CONTEXT/rules/tests.
- **Fix game-state mapping.** `syncNFLScoresJob` maps every non-`post`/non-`in` ESPN state to `SCHEDULED` (`nflSchedule.ts:83`), so postponed/canceled games score wrong. Map ESPN `canceled/postponed/delayed` explicitly to `CANCELLED`/held states, with tests.
- **Bound the score sync.** `syncNFLScoresJob` queries only `startTime <= now+2h` (missing lower bound), dragging the whole past season into the 5-minute job. Add the lower bound; fetch only in-progress/recently-final.

### Centralized lock (foundational)
Add a server helper **`effectiveLockAt(pool, week, game)`** that folds in `settings.lockBufferMinutes`, per-week `weekLockOverride`, and per-game kickoff. `submitNFLPicks` today computes `weekLockOverride` but per-game validation uses raw kickoff, and reveal logic ignores overrides entirely. **Every** lock decision path reuses it: `submitNFLPicks` validation, **`proxyPick`** (`nflPools.ts`), the commissioner exception flows (`poolExceptions.ts` — `extendWeekDeadline`/`proxyPick`), Pool-Consensus reveal, and Site-Wide-Consensus publish timing. Consensus is never revealed before a game's `effectiveLockAt`. No path keeps its own duplicate lock math.

### The layer (all server-maintained, clients read-only)

1. **Persist per-week results on the entry — type-specific, versioned.** `scoreNFLWeek` writes a pool-type-specific `weeklyResults[week]` (Pickem: `{correct, total, points, mode}`; Survivor: `{survived, strike}`; Margin: `{net}`) plus a monotonically increasing `resultsVersion`. "Correct" is defined only within a pool type + pick mode — there is no blended cross-type "accuracy." Additive to the certified scoring path (new fields only; `weeklyPoints`/`totalScore` untouched).

2. **Per-user Performance Stats aggregate** at `users/{uid}/performance/*` (private; owner + admin read only). Maintained by an explicit **"pool/week scored" event** (emitted by `scoreNFLWeek`), and each recompute **re-derives from authoritative entry state** keyed by `resultsVersion` — it never does naive `onWrite` increments (which would double-count on rescores, Margin's second rank pass, and pick/proxy edits). Holds type-scoped rollups, streaks, rank-percentile inputs, and team-by-team tallies.

3. **Public profile projection.** The Player Profile page reads a **sanitized `publicProfiles/{uid}`** doc (or a callable-backed API) — never the private `users/{uid}` doc, `seasonHistory`, or raw `performance` aggregate (those span unrelated private pools and stay owner-only). The projection exposes only **aggregate figures and finalized/scored history** — current-season pick history is included only per game after that game's `effectiveLockAt` (or after the pool is final), so the profile surface cannot re-leak un-revealed picks.

4. **NFL finalize lifecycle + Profit.** Add a real **NFL season-finalize path distinct from admin close** (`closePool`/`autoClosePools` are admin flows that intentionally emit zero stats deltas). The finalize path writes `users/{uid}/seasonHistory/{poolId}` for NFL pools (mirroring `bracketScoring`) and updates Profit. **Profit** is computed from **per-entry fee events + real payout events**: emit the currently-unwritten `PAYOUT_PAID`/`PAYOUT_UNPAID` ledger events when prizes are marked, and account fees per entry (multi-entry pools count each paid entry, not one member-level flag). Profit is a recorded figure, never money the platform holds.

5. **Consensus (both scopes are server aggregates — clients never compute consensus from raw entries).**
   - **Pool Consensus** — a **pool-scoped server aggregate**, produced by the same shard pipeline as Site-Wide but scoped to one pool, published per game **only after that game's `effectiveLockAt`** as an aggregate-only projection the client reads. It is NOT computed client-side from raw `entries`: a pool participant must not be able to read other members' picks before a game locks, and Firestore rules can gate entry reads by membership but not per-game lock within a doc. `PickDistribution`'s existing math moves server-side into the aggregation.
   - **Site-Wide Consensus** — a server aggregation built from **per-pool/per-game shards** rolled up by an **idempotent reducer** (no full rescans; no direct increments into one hot per-game doc that would break on Sunday resubmits/edits). The private shards live under a **server-only path** (`consensusShards/*`, no client read). The **public** path `consensus/{season}_{week}/{poolType}/{gameId}` holds **only the post-lock projection doc** — aggregate counts, type-scoped (never one blended percentage), published only after the game's `effectiveLockAt`, individual picks never exposed. Clients read only the public projection.

6. **Live Win Probability — best-effort, isolated.** ESPN's scoreboard payload does **not** carry win probability; a **separate** endpoint (event summary / winprobability) is fetched by a job **isolated from score writes** (its failure never blocks scores). Stored in a **per-game subcollection** (`nfl_games/{id}/winprob/*`), **not** on the `nfl_games` doc (which is read season-wide via `subscribeToNFLGames` and would bloat every homepage). Read week/game-scoped. When absent, the UI shows an honest empty state; Consensus fills the pre-kickoff slot. Distinct from Consensus (picks vs outcome).

### Entry-read tightening (security)
Today Firestore rules let **any authenticated user** read `/pools/{id}/entries/*` once the pool is `LOCKED`. The hazard: an entry doc bundles **all** of a member's game picks, and pools support `lockMode: 'PER_GAME' | 'WEEKLY'`; a coarse "week locked" read (which effectively opens at first kickoff) would expose a member's **later-game** picks before those games' `effectiveLockAt` in a PER_GAME pool. Therefore:
- A member reads **only their own entry** at all times.
- Another member's full entry doc is readable only when **every pick in it is reveal-safe** — i.e. after the last relevant game locks / the week is complete (a server-maintained flag, not "first kickoff"), or when the pool is final. Owner/admin retain management reads.
- **Per-game revealed picks and all consensus come from server projections** (revealed only after each game's `effectiveLockAt`), and **standings/scores read scored fields** (`weeklyResults`/`totalScore`, reveal-safe post-scoring) — never raw un-revealed entry docs. Clients never obtain another member's un-locked pick through any path.

## Alternatives considered

- **Compute everything on the client by fanning out over all pools' entries.** Impossible for Site-Wide Consensus (rules forbid reading other pools' entries) and O(pools) slow for profiles. Rejected.
- **One giant scheduled batch recompute of all stats.** Simpler to reason about but stale between runs and expensive at scale; live consensus/scores need freshness. Rejected in favor of event-triggered + scheduled backstop.
- **Store per-week W-L only, derive the rest on read.** Leaves the cross-pool profile fan-out on the client and recomputes team-by-team every load. Rejected: the per-user aggregate is read far more than written.
- **Skip real win-probability, use consensus only.** Was offered; the product decision is to show both (real ESPN win-prob + pick consensus), so the ESPN winprobability sync is in scope.

## Consequences

- New collections/fields: entry `weeklyResults` (type-specific) + `resultsVersion`, `users/{uid}/performance/*` (private), NFL `users/{uid}/seasonHistory/*`, per-user Profit aggregate, **`publicProfiles/{uid}`** projection, **private `consensusShards/*` (server-only, no client read)** rolled up into the **public `consensus/{season}_{week}/{poolType}/{gameId}` post-lock projection** (aggregate-only), `nfl_games/{id}/winprob/*` subcollection.
- Firestore rules change: **entry reads restricted to participants/owner/admin** (removes the current any-authed post-lock read); `performance`/`seasonHistory` owner+admin only; `publicProfiles` world/member readable (sanitized); `consensus` world-readable aggregate-only; all server-write-only. Rules are a security review gate before deploy.
- `scoreNFLWeek` gains additive writes + emits a "pool/week scored" event; must not regress the certified NFL suite (unit + emulator). Per-user recompute is idempotent (re-derives from authoritative state by `resultsVersion`).
- A **new NFL finalize lifecycle** distinct from admin close is required before profiles/season-history are correct; `PAYOUT_PAID`/`PAYOUT_UNPAID` must actually be written before Profit is trustworthy.
- Win-probability is a **best-effort, isolated** dependency on a separate ESPN endpoint (not the scoreboard); its failure never blocks scores, and absence renders an honest empty state.
- Site-Wide Consensus cost grows with pool count; it is sharded per-pool/per-game with an idempotent reducer (no rescans, no hot-doc increments), published lock-gated and type-scoped, never a client read of raw entries.
- Phase 0 (status enum, ESPN state mapping, sync lower bound) lands first; the URL/rules/visibility work depends on it.
- "League average" everywhere becomes the real Pool or Site-Wide average from this layer; the hardcoded radar/accuracy constants and the fabricated win-prob/sparkline/attrition are deleted.
- **Scope realism:** these are new authorization surfaces, new aggregation infrastructure, a missing NFL finalization lifecycle, and a new external dependency — not UI polish. "No cut" is retained as intent, but Phase 0 + the auth/lifecycle/aggregation foundations are explicit gating work and the primary schedule risk against preseason.
- Expert Picks is explicitly **out of scope** here pending a compliant data source; profiles are built to accept an "expert" as just another profile shape later.
