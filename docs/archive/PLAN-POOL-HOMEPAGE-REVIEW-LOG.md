# Plan Review Log: Pool Homepage v2
Act 1 (grill-with-docs) complete — plan locked at PLAN-POOL-HOMEPAGE.md, CONTEXT.md glossary extended, ADR 0004 (Performance Stats + Consensus layer) written. MAX_ROUNDS=5. PLAN_FILE=PLAN-POOL-HOMEPAGE.md.

## Round 1 — Codex
Thread 019f418b-0164-79a0-ae8a-497894fa691a. VERDICT: REVISE. 15 findings:

1. Public profile auth: users/{uid} + seasonHistory owner-only (rules:255,277); global performance can't be "pool-member readable" (spans private pools). Fix: sanitized publicProfiles/{uid} projection or callable API; keep raw aggregates private.
2. "No client reads other pools' entries" is FALSE today: any authed user reads /pools/{id}/entries once LOCKED (rules:191); pre-lock the collection-wide NFL subscription isn't safely authorized. Fix: restrict entry reads to participants/owners/admins; expose consensus via aggregate docs.
3. Deadline extension breaks lock/reveal: submitNFLPicks computes weekLockOverride but per-game lock uses raw kickoff; reveal ignores overrides. Fix: centralize effectiveLockAt on server; reuse in submit + reveal + site-wide publish timing.
4. World-readable site-wide consensus leaks picks pre-lock; pickem/survivor/margin don't contribute on the same basis. Fix: publish only after server lock; shard/label by pool type, not one blended %.
5. Site-wide aggregation underspecified at scale: full rescans too costly; direct increments hotspot on Sunday resubmits + break on edits/rescores. Fix: per-pool/per-game shards + idempotent reducer.
6. Per-user trigger not idempotent: scoreNFLWeek rescores, Margin writes ranks in a 2nd pass, pick/proxy writes touch the entry; naive onWrite double-counts. Fix: trigger from explicit poolId/week-scored event or recompute from authoritative state keyed by versioned weeklyResults.
7. No NFL pool-completion hook: closePool/autoClosePools are admin-close with zero stats deltas (lifecycle.ts). Fix: add a real NFL finalize-season path distinct from admin close; hang seasonHistory/profile off it.
8. Profit not computable: PAYOUT_PAID/UNPAID defined but never written; member-level paid collapses multi-entry pools. Fix: define profit from per-entry fee events + real payout events before aggregating.
9. weeklyResults {correct,incorrect,points} not universal: "correct" differs by type; one cross-pool accuracy = another fake. Fix: pool-type-specific weekly result shapes; normalize only within type + pick mode.
10. syncNFLScoresJob missing lower bound (query only startTime<=now+2h) drags whole past season each 5-min run. Fix: add lower bound; fetch only in-progress/recently-final.
11. ESPN winprobability NOT in the scoreboard payload (scores/status/odds only as of 2026-07-08). Fix: separate best-effort source (summary/winprobability endpoint), isolate failures from score writes, honest empty state when absent.
12. winProbHistory on nfl_games read via season-wide subscribeToNFLGames bloats every homepage payload. Fix: per-game subcollection or week-scoped/live-games view.
13. URL migration incomplete: only tab in URL loses week/game drilldown on Back/refresh (selectedWeek + selected game stay local). Fix: encode tab+week+gameId/view together, or stop promising fully stateful nav.
14. NFL status enum inconsistent: created status:'OPEN' but types claim 'active'|'archived'. Fix: align the enum before layering URL/rules/visibility.
15. Cancellation semantics wrong: CANCELLED type exists but sync maps non-post/in to SCHEDULED; postponed/canceled surface + score wrong. Fix: map canceled/postponed/delayed explicitly + tests.

Meta: "no cut" is not realistic — the risky items are new auth surfaces, new aggregation infra, a missing NFL finalization lifecycle, and a new external dependency, not UI polish.

### Claude's response
Accepted all 15 (final arbiter). Key reshaping:
- (14)(15)(10) become a Phase 0 data-hygiene prereq (align NFL status enum; explicit ESPN canceled/postponed/delayed mapping + tests; add the syncNFLScoresJob lower bound) before layering new logic.
- (3) Centralized server `effectiveLockAt(pool, week, game)` helper, reused in submit validation, pool-consensus reveal, and site-wide publish — foundational.
- (2)(4)(1) Security: tighten entry reads to participants/owner/admin only (removes the post-lock any-authed read); Pool Consensus reads only the pool's own entries (member is a participant); Site-Wide Consensus is a lock-gated, TYPE-scoped, aggregate-only projection (never blended, never pre-lock); Player Profile reads a sanitized publicProfiles/{uid} projection, raw per-user aggregates stay private.
- (5)(6)(9) Aggregation: type-specific weekly result shapes (no cross-type "accuracy"); per-pool/per-game consensus shards rolled up by an idempotent reducer; per-user Performance Stats RECOMPUTED from authoritative entry state keyed by a versioned weeklyResults, fired by an explicit "poolId/week scored" event, not a naive onWrite.
- (7) Add a real NFL finalize path (distinct from admin close) that emits seasonHistory + profile side effects.
- (8) Write real PAYOUT_PAID/UNPAID events; Profit = per-entry fees + real payout events, multi-entry aware.
- (11)(12) Win-prob is best-effort from a SEPARATE ESPN endpoint, fully isolated from score writes, stored in a per-game subcollection (not on nfl_games), week/game-scoped read; honest empty state when absent.
- (13) URL encodes tab + week + selected game/view together (or the nav promise is scoped to tab-level).
- Meta/no-cut: keeping Kevin's "no cut" intent but making Phase 0 prereqs + the auth/lifecycle/aggregation foundations explicit gating work, and strengthening the schedule-risk callout with Codex's specifics.
Revising ADR 0004 + PLAN-POOL-HOMEPAGE.md + CONTEXT.md.

## Round 2 — Codex
VERDICT: REVISE. 11/15 prior confirmed addressed. 4 residual refinements:

1. Status enum still inconsistent in docs: ADR says reconcile to OPEN|LOCKED|LIVE|FINAL|CANCELED "per getPoolLifecycleState", but the helper derives closed/final from raw COMPLETED/CANCELED and CONTEXT defines CLOSED as the derived terminal. Fix: define raw stored NFL statuses separately from derived lifecycle labels; use identical names across plan/ADR/context/rules/tests.
2. publicProfiles may re-leak picks: "pick history" + "weekly record" don't say scored-only/post-lock-only. Fix: limit public profiles to aggregate + finalized/scored history; gate current-season pick history until post-lock/post-final.
3. Site-wide consensus shard/projection separation under-specified: "shards + rollup" at the world-readable path risks exposing per-pool or pre-lock shards. Fix: private shards under a server-only path; reserve the public consensus/.../{gameId} path for post-lock projection docs only.
4. effectiveLockAt reuse omits proxyPick + commissioner exception flows (duplicate lock logic today). Fix: every lock decision path incl. proxyPick + poolExceptions calls the shared helper.

### Claude's response
Accepted all 4 (refinements).
- (1) ADR/PLAN reworded: the prereq aligns the RAW stored NFL `status` type declaration ('active'|'archived') to the values actually written ('OPEN'/'LOCKED'/'LIVE'/'FINAL'); derived lifecycle labels stay owned by getPoolLifecycleState (CLOSED is derived, not a raw status). No new conflicting enum.
- (2) Public profile = aggregate + finalized/scored history only; current-season pick history gated until post-lock (per game) / post-final. Reflected in ADR item 3, PLAN item 14, CONTEXT Player Profile.
- (3) Private consensus shards live under a server-only path (e.g. `consensusShards/*`, no client read); the public `consensus/{season}_{week}/{poolType}/{gameId}` path holds only post-lock projection docs.
- (4) effectiveLockAt reuse list extended to proxyPick (nflPools) + poolExceptions commissioner flows — every lock decision calls the shared helper.
Revising ADR 0004 + PLAN + CONTEXT.

## Round 3 — Codex
VERDICT: REVISE. 1 finding: ADR Consequences still listed `consensus/{season}_{week}/{poolType}/*` as "shards + rollup", collapsing the private shard path back into the public consensus namespace (contradicts Decision item 5; rules/deploy leak risk).

### Claude's response
Accepted. Fixed the ADR Consequences line: private `consensusShards/*` (server-only, no client read) rolled up into the public `consensus/{season}_{week}/{poolType}/{gameId}` post-lock aggregate-only projection. Now consistent with Decision item 5.

## Round 4 — Codex
VERDICT: REVISE. 1 material finding: Pool Consensus is computed client-side from raw `entries`, but the tightened entry-read rule is membership-gated ("participants/owner/admin"). A participant could query other members' entries PRE-lock (Firestore rules can gate by membership but not per-game lock within a doc), leaking picks early.

### Claude's response
Accepted (material pick-visibility leak). Fix unifies the model: **Pool Consensus is no longer client-side from raw entries** — it becomes a pool-scoped server aggregate, per-game lock-gated projection, produced by the same shard pipeline as Site-Wide Consensus (scoped to one pool). Clients read the projection, never raw entries, so no participant can read others' picks before a game's effectiveLockAt. Entry-read rules: a member reads only their OWN entry pre-lock; broader entry reads (standings/manager) stay post-(week)-lock views and consensus never depends on them. Revised ADR item 5 + PLAN item 7 + entry-read note + CONTEXT Pool Consensus.

## Round 5 — Codex (MAX_ROUNDS cap)
VERDICT: REVISE. 1 finding: entry-read rule opening broad reads "after the week is locked" is unsafe for PER_GAME lock pools — an entry doc bundles ALL game picks, so opening it at first kickoff exposes later-game picks before their effectiveLockAt. Fix: own-entry-only until every pick in the doc is reveal-safe, or serve per-game revealed-picks via projections.

### Claude's response
Accepted (final refinement). Entry-read rule: a member reads only their own entry always; another member's full entry doc is readable only when EVERY pick in it is reveal-safe (last game locked / week complete via a server flag, or pool final) — not at first kickoff. Per-game revealed picks + all consensus come from server projections; standings/scores read scored fields (weeklyResults/totalScore), never raw un-revealed entries. Updated ADR entry-read section + PLAN 0e.

## Resolution — cap reached, substantively converged
Loop terminated at MAX_ROUNDS=5 without a formal APPROVED. NOT a deadlock of disagreement: every finding across all five rounds was accepted and incorporated; no unresolved Claude counter-position. Findings narrowed monotonically (15 → 4 → 1 → 1 → 1) and never reopened the core architecture (the Phase-0 + shared aggregation-layer model held from round 1). The reviewer defaults to REVISE while any refinement remains; the round-5 PER_GAME reveal-safety catch is folded in. Plan is considered substantively converged and ready for Kevin's sign-off. Residual would be incremental hardening during implementation, not structural.
