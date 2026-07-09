# ADR 0005: Player Profile data model — per-pick results, finalize lifecycle, expert subjects

Date: 2026-07-10
Status: Accepted

## Context

ADR 0004 built the Performance Stats + Consensus layer and shipped a first `publicProfiles/{uid}`
projection (overall stats, weekly record, performance chart) recomputed by
`functions/src/userProfile.ts`. Three profile sections stayed stubbed because their data does not
exist:

- **Team-by-Team and Pick History** need each pick's graded outcome per member per game.
  `scorePickemEntry` computes correctness transiently and discards it; only the per-week aggregate
  `weeklyResults[week] = {correct, total, points}` persists.
- **Profit** needs real payout data. The payment ledger (`pools/{poolId}/payments`) declares
  `PAYOUT_PAID`/`PAYOUT_UNPAID` event types but nothing writes them, and NFL pools have no
  finalization moment: `closePool`/`autoClosePools` are admin archival flows that intentionally emit
  zero stats. Only `bracketScoring.ts` writes `users/{uid}/seasonHistory`.
- **Achievements** is a future feature with no engine; the profile needs a slot with a frozen
  contract.
- The owner additionally wants an **Expert** (ESPN FPI, Vegas line — already ingested per game onto
  `nfl_games/{id}.expertPredictions` by `expertPicks.ts`) to render as just another profile.

Non-negotiables: no gambling "units"; the platform never holds participant money (Entry Fees are
peer-to-peer, see CONTEXT.md); a profile must never expose an un-revealed pick; recompute stays
bounded; all new collections server-write-only.

## Decision

1. **Per-pick graded outcomes persist on the entry, inside `weeklyResults`.**
   `scoreNFLWeek` extends each scored week with a per-game map, in the same batch and under the
   same `resultsVersion` bump it already performs:
   - Pickem: `weeklyResults[week].games = { [gameId]: { pick, result: 'W'|'L'|'PUSH'|'VOID' } }`
   - Survivor: `weeklyResults[week].game = { gameId, pick, result: 'SURVIVED'|'STRUCK'|'VOID' }`
   - Margin: `weeklyResults[week].game = { gameId, pick, net }`
   No new collection, no new rules surface, idempotent on rescore (full overwrite of the week's
   map), and reveal-safe by construction: results are written only after the week's games are
   final. Sizing: ≤ 18 weeks × ≤ 16 tiny records per entry, far under the 1 MB doc limit.

2. **Season Finalization is automatic and re-runnable; recording payouts is a Commissioner
   action.** When the last scheduled week of an NFL pool is scored FINAL, the server finalizes
   the pool: writes `users/{uid}/seasonHistory/{poolId}` (mirroring the bracket shape: season,
   poolType, finalRank, totalEntries, record, points) for every member **with a playable Entry**
   (roster-only members get no competitive history), stamps `firstFinalizedAt` (audit only) and
   `finalizedAt`, and triggers profile recompute. Finalization is a re-derivable overwrite, not
   a one-shot guard: a rescore of a completed pool re-finalizes, per ADR 0004's
   re-derive-from-authoritative-state principle. Stats never wait on a human. Separately, the
   Commissioner gets a "record payouts" flow. Money always waits on a human — the platform never
   computes a payout nobody recorded.

3. **Payouts get canonical award docs; Profit = recorded awards minus Entry Fees owed.**
   Two schemas, split by sensitivity (Firestore rules are doc-level, so the split is the schema):
   - `pools/{poolId}/payoutRecords/{awardId}` — participant-readable, server-write-only:
     `{uid, entryId?, amount, kind: 'PLACE'|'BONUS'|'ADJUSTMENT', recordedAt, supersededBy?}`.
   - `pools/{poolId}/payoutRecordsPrivate/{awardId}` — commissioner/admin + affected recipient
     only, server-write-only: `{settled: boolean, note?, recordedBy}`.
   Shared stable `awardId`; corrections supersede (append a new pair), never mutate. This is the
   source of truth for Profit; the existing best-effort payment ledger's
   `PAYOUT_PAID`/`PAYOUT_UNPAID` events are emitted alongside as audit trail only. Prefill
   covers `places[]` only; `bonuses[]` need manually-assigned recipients. Awarded counts as won
   the moment recorded; settlement state is displayed, not netted out. Entry fees count as soon
   as owed, read from an explicit `feeOwed` base-dues amount on the shared Member Record
   contract (plus `rebuyOwed`) — the single dues source, never inferred from entry existence.
   Liability: non-owner Members get `feeOwed` at join; the auto-seeded owner record carries
   `feeOwed: 0` until the owner commits a playable Entry (hosting is not playing). `entryFee` is
   editable only while a pool is OPEN, and such an edit cascade-updates `feeOwed` on that pool's
   fee-liable Member Records in the same transaction, so `feeOwed` cannot drift going forward.
   Backfilled `feeOwed` on pre-migration pools is best-effort (`feeOwedSource:
   'BACKFILL_ESTIMATE'`) because historic OPEN-phase fee edits were never snapshotted — exact
   fee-side Profit starts at live stamping, and the profile discloses the estimate. Pools with
   unrecorded payouts are disclosed on the profile ("payouts pending in N pools"). Nothing is
   world-readable; the public profile exposes only cross-pool aggregate profit.

4. **Experts are Profile Subjects in the same collection.** `publicProfiles/{subjectId}` gains
   `subjectKind: 'PLAYER' | 'EXPERT'`. Experts use reserved ids (`expert_espnFpi`, `expert_vegas`)
   that cannot collide with Firebase uids. A grader in the scoring path grades
   `nfl_games.expertPredictions` against final scores into a server-only expert results store, and
   the same projection recompute renders the same shape (weekly, overall, teamByTeam). Money and
   achievements are null/absent for experts; the page renders both kinds with no separate UI path.

5. **Achievements live in `publicProfiles/{subjectId}/achievements/{achievementId}`** — one doc per
   earned achievement `{code, title, description, iconKey, tier?, earnedAt, season?, meta}`,
   world-readable, server-write-only, typed in `shared/achievements.ts`. No pool identifiers on
   the public doc (`meta` contractually excluded from carrying pool identity) — same leak rule as
   the projection; a future engine keeps pool linkage private and surfaces it via the gated
   detail path. Fully decoupled from the projection doc so the future engine ships without
   touching `userProfile.ts` and neither writer can clobber the other. v1 renders an honest
   empty state.

6. **Profile v1 is NFL-only end to end** (NFL_PICKEM, NFL_SURVIVOR, NFL_MARGIN) — stats,
   Profit, and participation counts alike; Bracket / Playoffs / Squares / Props are absent (not
   partial) until their finalize/payout flows and a Member-Record-based subject index exist. No
   blended cross-type or cross-mode accuracy (per ADR 0004): per-pick results carry
   `poolType`/`pickMode` context and Team-by-Team is bucketed by (poolType, pickMode) — Pickem
   straight-up, Pickem ATS, and Survivor are separate buckets. Picked-for W-L + accuracy% with a
   minimum-picks floor (3) and **no money column** — per-team profitability is a units concept
   with no honest equivalent. Yearly Record shows season, W-L, accuracy%, Profit, and **Best
   Finish** instead of a fabricated single cross-pool rank. Pick History shows **scored picks
   only** — no new pre-scoring reveal surface.

7. **The public projection carries zero pool identifiers.** `publicProfiles` is world-readable,
   so any pool name/id on it would let an anonymous visitor infer membership in private pools
   (a leak the shipped `weekly[]` already had — fixed by this work). Weekly rows aggregate
   across pools; pick history rows omit pool identity; Best Finish is "1st of 12" with no pool
   name. Per-pool detail (names, per-pool breakdowns, per-pool profit) is served by a
   viewer-gated callable taking an explicit `poolId`, authorized per pool per call (one shared
   pool never unlocks the subject's other pools), available to the subject, co-members of that
   pool, and admins. Co-membership is checked against `participantIds`/entry existence — the
   sources authoritative today for NFL pools — until ADR 0003's Member Record wiring is
   complete, then migrated.

8. **Backfill derives everything derivable and fabricates no money.** An Operations-tab action
   re-grades every scored week of every non-sim NFL pool (writing the per-game maps, bumping
   `resultsVersion`) and sweeps already-completed NFL pools through the finalize path, with
   trigger-driven profile recomputes suppressed during the run and one deduped recompute per
   affected subject afterwards. Payouts are never backfilled computationally; Commissioners may
   retro-record them through the same flow.

## Alternatives considered

- **Per-pick results in a new subcollection** (`entries/{uid}/pickResults/{week}`): cleaner
  unbounded growth, but a new rules surface, doubled scoring writes, and fan-out reads in every
  profile recompute. Rejected — the entry doc has ample headroom.
- **Per-pick results only in the private per-user aggregate**: loses pool-scoped re-derivation on
  rescore, violating ADR 0004's re-derive-from-authoritative-state principle. Rejected.
- **Commissioner-gated finalize** (one ceremony writes seasonHistory + payouts): profiles rot for
  every pool whose commissioner never clicks. Rejected.
- **Auto-computed payouts** from payout structure × standings: asserts money moved that the
  platform never witnessed; contradicts the honor-system model. Rejected (also for backfill).
- **Profit counts only `PAYOUT_PAID`**: a member's profit would change when a commissioner flips
  settlement state, and unpaid wins would vanish. Rejected.
- **Separate `expertProfiles` collection / separate page**: duplicates projection, rules, and UI —
  exactly the divergence the product wants to avoid. Rejected.
- **Achievements as an array field on the projection doc**: couples the future engine and the
  recompute writer on one doc. Rejected.

## Consequences

- `scoreNFLWeek` writes grow (per-game maps + a pool-level `lastScoredAt`/`scoredThroughWeek`
  marker) but stay additive and inside the existing path; the certified NFL scoring suite must
  not regress.
- A new finalize path exists per NFL pool as a re-runnable overwrite (rescores re-finalize;
  `firstFinalizedAt` is audit metadata), plus a scheduled backstop sweep keyed on
  `finalizedAt < lastScoredAt`; admin close remains stats-free.
- `pools/{poolId}/payoutRecords` (+ `payoutRecordsPrivate` for settlement state, notes, actor
  metadata — commissioner/admin/recipient only) become the source of truth for Profit;
  `PAYOUT_PAID`/`PAYOUT_UNPAID` ledger events are emitted as audit trail only. Profit reconciles
  against payoutRecords reduced over supersession.
- `publicProfiles` becomes subject-typed; rules stay world-read/server-write; a new
  `achievements` subcollection carries the same rule.
- Expert grading adds a small server-only results store keyed by expert id and week.
- Squares/Props/Bracket profit depends on their finalize/payout-recording flows — explicitly
  future work; the profile shape already accommodates it.
