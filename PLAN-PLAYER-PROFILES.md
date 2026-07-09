# Plan: Player Profiles — real stats, profit, pick history for every pool member

_Locked via grill-with-docs — by Claude + Kevin, 2026-07-10. Terms per CONTEXT.md; data model per
ADR 0005 (which builds on ADR 0003 Member Record and ADR 0004 Performance Stats/Consensus).
Revised after Codex review round 1 (see PLAN-PLAYER-PROFILES-REVIEW-LOG.md)._

## Implementation status

Branch `feat/player-profiles` (worktree `.claude/worktrees/player-profiles`). Kevin sign-off
2026-07-10 ("go"). Sweep pass: `PLAN-PLAYER-PROFILES-SWEEPS.md`.

| Phase | Status | Evidence |
|---|---|---|
| Sweeps | ✅ 2026-07-10 | PLAN-PLAYER-PROFILES-SWEEPS.md (4 sweeps) |
| 1 — contracts + rules groundwork | ✅ 2026-07-10 | shared/profile.ts + shared/achievements.ts; achievements rule in firestore.rules; profileSubjects.test.ts 5/5; profileAchievements.rules.test.mjs ALL PASSED (emulator); squarePrivate+monetization rules tests still green; functions suite 346/346. Entries rule flip → Phase 2 per Sweep 1. |
| 2 — per-pick persistence (+ standings projection, + entries rule flip) | ✅ 2026-07-10 | gradePickemGames/gradeSurvivorWeekGame/gradeMarginWeekGame; scorePickemEntry derived from grades (certified suites green); weeklyResults+resultsVersion all 3 types; pools/{id}/standings/current (allowlist rows, usedTeams excluded); pool lastScoredAt/scoredThroughWeek; NFL entries rule → own-only pre-FINAL (bracket coarse read kept); member views → standings+own entry; PickDistribution → server consensus. Evidence: functions 363/363, perPickResults.test.ts (14 tests), entriesStandings.rules.test.mjs ALL PASSED, all 4 rules tests green, tsc -b + vite build clean. Known cost: member standings empty until first scored week. |
| 3 — finalize | ✅ 2026-07-10 | functions/src/nflFinalize.ts: maybeFinalizeNFLPool (re-runnable; entry-holders only; firstFinalizedAt audit-only) called best-effort from scoreNFLWeek; pool.scoredWeeks completeness map; nflFinalizeSweepJob daily backstop (kill-switch system/config.nflFinalize, dry-run default, MAX 200, sim- excluded). computeFinalRanks unit-tested (pickem ties, survivor alive/elim, margin cascade). Functions 369/369. |
| 4 — payouts/Profit | ✅ 2026-07-10 | commit b79fa66: payoutRecords/payoutRecordsPrivate contracts + recordPoolPayouts callable + RecordPayoutsCard; feeOwed liability rules (owner-0, join stamp, heal-on-touch, entryFee cascade); rules emulator test passed; functions 379/379. |
| 5 — projection expansion | ✅ 2026-07-10 | lib/profileBuild.ts pure builder (zero pool identifiers — leak-asserted in tests); recomputeUserProfile rewritten (teamByTeam buckets, scored-only pickHistory w/ matchup abbrs stamped at scoring time, yearly + Best Finish, profit w/ pending disclosure); getProfilePoolDetail(subjectId, poolId) viewer-gated callable; recordPoolPayouts refreshes recipients; backfill trigger-suppression guard. profileBuild.test.ts (10 tests); functions 389/389. |
| 6 — experts | ✅ 2026-07-10 | expertProfiles.ts: gradeExpertGame (SU; EVEN/cancelled→VOID) into server-only expertResults/{id}/seasons/*; publicProfiles/expert_espnFpi + expert_vegas rendered via the SAME buildPublicProfile (subjectKind EXPERT, profit null); daily gradeExpertProfilesJob + admin refreshExpertProfiles; expertResults rules deny-all. expertProfiles.test.ts; functions 392/392. |
| 7 — UI | ✅ 2026-07-10 | PlayerProfile.tsx rebuilt: URL-persisted tabs (Stats/Weekly/Picks/Achievements), real Team-by-Team buckets w/ min-3 best/worst callouts, Yearly Record w/ Best Finish + profit column, Profit card w/ pending+estimated disclosures, achievements subcollection w/ honest empty state, expert variant (badge, no money), viewer-gated "Pools you share" panel via getProfilePoolDetail. /dev/dashboards: full-shape player mock + expert mock tab. Verified live on worktree preview (port 5199): tabs render, pick history shows matchups/badges/no pool names, expert hides profit, achievements render. tsc + vite build clean. |
| 8 — backfill | ✅ 2026-07-10 | migrations/backfillProfileData.ts callable (SUPER_ADMIN, dryRun DEFAULT true, 25-pool cap + resume cursor, sim- excluded, trigger suppression + deduped recompute, official points preserved, feeOwed = BACKFILL_ESTIMATE fee-liable only, finalize pass, admin_audit report) + two Operations-tab actions (dry/live, explain-then-confirm). Never fabricates payouts. Functions 392/392, builds clean. NOT yet run against prod (Kevin gate). |

**Plan correction from Sweep 1 (2026-07-10):** the entries rule flip moved from Phase 1 to
Phase 2 — the flip depends on a member-readable standings projection
(`pools/{id}/standings/current`, written by `scoreNFLWeek`) plus client rewiring
(member views → projection; `PickDistribution` → server consensus docs), because every NFL
member view consumes the raw entries collection today (`dbService.subscribeToNFLEntries`).
Rule flip + projection + rewire land together in Phase 2 so no intermediate broken state
exists. Phase 1 keeps: shared contracts, achievements rule, expert-id collision proof, and the
audit (done — Sweep 1).

## Goal

Every Profile Subject — every pool Member, and each Expert — has a public Player Profile at
`/profile/:subjectId` showing real Performance Stats across all Pools they have entered:
performance chart, weekly record, yearly record with Best Finish, team-by-team performance,
scored-picks-only pick history, Profit reconciled to Payout Records, and a hosted Achievements
slot (engine deferred). v1 is NFL-only **end to end** (Pickem, Survivor, Margin): stats, Profit,
and participation counts all draw solely from NFL pools; other types are absent (not partial)
until their finalize/payout flows exist. The public projection is aggregate-only — it carries no
pool identifiers; per-pool detail is viewer-gated to co-members. No gambling units anywhere. The
platform records money figures; it never holds or computes participant money.

## Approach

### Phase 1 — Shared contracts, rules groundwork, entry-read tightening (blocking)
1. `shared/profile.ts`: `PublicProfile` type — `subjectKind: 'PLAYER'|'EXPERT'`, `overall`,
   `weekly[]`, `yearly[]`, `teamByTeam[]`, `pickHistory[]`, `profit`, `updatedAt`. **No pool
   identifiers anywhere in the public shape.** Reserved expert id namespace `expert_*` with a
   unit test proving non-collision with Firebase uids (if uids can contain `_`, switch to a
   separator uids cannot contain).
2. `shared/achievements.ts`: `Achievement` doc contract `{code, title, description, iconKey,
   tier?, earnedAt, season?, meta?}` — frozen extension point; no engine. **No pool identifiers
   on the public achievement doc** (same leak rule as the projection); `meta` is contractually
   forbidden from carrying pool identity — a future engine keeps any pool linkage in its own
   private store and surfaces it only via the gated detail path.
3. `firestore.rules`: `publicProfiles/{id}/achievements/{aid}` read `true` / write `false`;
   `publicProfiles` stays world-read/server-write.
4. **Entry-read tightening (ADR 0004 security gate, pulled into this plan as blocking):**
   a member reads only their own entry at all times; another member's full entry doc is readable
   only when a server-maintained reveal-safe flag says every pick in it is revealed (or the pool
   is final); owner/admin retain management reads. Audit client code paths that read others'
   entries (standings et al.) and point them at scored fields/projections per ADR 0004.
5. Acceptance: rules emulator tests — unauthenticated read of profile + achievements succeeds;
   client writes denied; participant cannot read another member's entry pre-reveal in a
   PER_GAME pool; standings still render from scored fields.

### Phase 2 — Per-pick result persistence (unblocks Team-by-Team + Pick History)
6. `scoreNFLWeek` (`functions/src/nflPools.ts` + `nflScoringEngine.ts`): persist per-pick graded
   outcomes inside the existing per-entry write, same batch, same `resultsVersion` bump. Each
   scored week also records its scoring context (`poolType`, and for Pickem the `pickMode`
   — straight-up vs ATS — per ADR 0004's `mode`):
   - Pickem `weeklyResults[week] += { mode, games: {gameId: {pick, result: 'W'|'L'|'PUSH'|'VOID'}} }`
   - Survivor `weeklyResults[week] += { game: {gameId, pick, result: 'SURVIVED'|'STRUCK'|'VOID'} }`
   - Margin `weeklyResults[week] += { game: {gameId, pick, net} }`
   Rescore fully overwrites the week's map (idempotent). VOID covers canceled/postponed games.
7. Acceptance: unit tests per type (incl. rescore overwrite, PUSH, VOID, ATS-vs-SU context);
   certified NFL scoring suite green with zero changes to `weeklyPoints`/`totalScore`; emulator
   run shows entry doc size well under limits for an 18-week season.

### Phase 3 — Season Finalization (auto, re-runnable) + seasonHistory for NFL pools
8. Finalize path: when `scoreNFLWeek` scores the pool's last scheduled week (all games FINAL),
   the server finalizes: writes `users/{uid}/seasonHistory/{poolId}` (season, poolType,
   finalRank, totalEntries, record, points — mirroring the bracket shape) **for every member
   with a playable Entry** (roster-only members and pick-less commissioners get no competitive
   history), stamps `pools/{id}.firstFinalizedAt` (audit metadata only) + `finalizedAt`
   (last-run). **Finalization is a re-runnable overwrite, not a one-shot:** any rescore of a
   completed pool re-derives and overwrites seasonHistory/ranks (ADR 0004 re-derive principle);
   nothing goes permanently stale. Admin close remains stats-free and neither blocks nor
   duplicates finalization.
9. Pool-level scoring marker: `scoreNFLWeek` stamps `pools/{id}.lastScoredAt` (+
   `scoredThroughWeek`) so staleness is comparable pool-metadata-to-pool-metadata (per-entry
   `resultsVersion` vs a pool timestamp is not a coherent comparison). Scheduled backstop sweep:
   finds season-complete pools that are unfinalized or stale (`finalizedAt < lastScoredAt`) and
   (re)finalizes them.
10. Acceptance: emulator tests — scoring the final week finalizes; re-run is a clean overwrite
    (no dupes); a rescore after finalize updates seasonHistory; roster-only member gets no
    seasonHistory doc; admin-closing an unfinalized pool writes no stats.

### Phase 4 — Payout Records + Profit (NFL pools only in v1)
11. **Canonical award docs, not ledger events — two docs, split by sensitivity (Firestore rules
    are doc-level, so the split IS the schema, not a field-level read rule):**
    - `pools/{poolId}/payoutRecords/{awardId}` (participant-readable, server-write-only):
      `{uid, entryId?, amount, kind: 'PLACE'|'BONUS'|'ADJUSTMENT', recordedAt, supersededBy?}`
      — who-won-what only, inherent to pool play since payout structure and standings are
      already pool-public.
    - `pools/{poolId}/payoutRecordsPrivate/{awardId}` (commissioner/admin + affected recipient
      only, server-write-only): `{settled: boolean, note?, recordedBy}` — settlement state and
      actor metadata never reach other participants.
    Stable shared `awardId`; corrections append a superseding record pair (append-only chain).
    The existing best-effort ledger (`paymentLedger.ts`) gets `PAYOUT_PAID`/`PAYOUT_UNPAID`
    events emitted alongside as audit trail only — Profit derives exclusively from
    `payoutRecords` (+ private settlement state for the subject's own display) reduced over
    supersession. Nothing is world-readable.
12. Commissioner "Record payouts" flow: prefilled from final standings × the pool's `places[]`
    payout structure only; `bonuses[]` require manually-added award rows with no auto-recipient.
    Commissioner edits amounts, marks settled per line, submits; may reopen and correct later
    (supersession). Stamps `pools/{id}.payoutsRecordedAt`.
13. Profit aggregation (v1 scope: NFL pools): `profit.won` = sum of non-superseded award amounts
    (settled or not); `profit.feesOwed` = dues owed per the Member Record. `feeOwed` becomes an
    explicit field on the shared Member Record contract (`shared/memberRecord.ts`) and the
    single dues source (alongside existing `rebuyOwed`) — never inferred from entry existence.
    Liability rules: a non-owner Member gets `feeOwed` stamped at join; the auto-seeded owner
    record gets `feeOwed: 0` until the owner commits a playable Entry (hosting ≠ playing — no
    bogus negative-profit commissioner profiles). Drift closure: `entryFee` is editable only
    while a pool is OPEN (per `shared/editability.ts`), and any such edit cascade-updates
    `feeOwed` on that pool's fee-liable Member Records in the same transaction — after lock the
    pool's `entryFee` is immutable, so completed-pool backfill from `pool.entryFee` is accurate.
    (NFL types are one-entry-per-member; the per-entry rule is stated for future multi-entry
    types.) `profit.net` = won − feesOwed; `profit.poolsPendingPayouts` = finalized NFL pools lacking
    `payoutsRecordedAt`. Profile displays net + pending-disclosure badge. `profit.won`/`net`
    totals are public by product decision (AP-style); per-pool amounts are not on the public doc.
    Reconciliation invariant: profile profit for a pool equals the reducer over that pool's
    payoutRecords.
14. Acceptance: emulator tests — recording payouts updates profit; unsettled counts toward won;
    supersession reconciles; bonus rows require explicit recipient; a pool with no recorded
    payouts shows fees owed + pending badge, never a fabricated prize; non-participant cannot
    read payoutRecords.

### Phase 5 — Projection expansion (`functions/src/userProfile.ts`)
15. `recomputeUserProfile` derives from authoritative entry state (per ADR 0004, keyed by
    `resultsVersion`, full recompute, never increments). **Public doc is aggregate-only — this
    phase also removes `poolId`/`poolName` from the already-shipped `weekly[]` (fixes the live
    membership leak):**
    - `weekly[]`: per season+week totals aggregated across pools — no pool identifiers.
    - `teamByTeam[]`: bucketed by `(poolType, pickMode)` — Pickem-SU, Pickem-ATS, Survivor as
      separate buckets, never one blended accuracy table; per NFL team picked-for W-L +
      accuracy% within bucket; min-3-picks floor applied at render-rank time.
    - `pickHistory[]`: scored picks only, newest first, capped (last N=200, per-season
      pagination story documented); rows `{season, week, gameId, teams, pick, result, poolType,
      pickMode}` — **no poolId/poolName**.
    - `yearly[]`: per season — W-L (bucketed as above; headline accuracy% is Pickem-scoped),
      Profit that season, Best Finish `{rank, totalEntries}` — **no pool name on the public doc**.
    - `overall` + `profit` from Phase 4. Survivor contributes survival record, Margin net
      points, each rendered type-scoped.
16. **Viewer-gated pool detail:** callable `getProfilePoolDetail(subjectId, poolId)` — poolId is
    REQUIRED and authorization is per pool, per call: the caller must be the subject, an admin,
    or a co-member of THAT pool; one shared pool never unlocks the subject's other pools. (The
    profile page enumerates the viewer's own pools client-side and enriches only those rows.)
    Co-membership is checked against sources that are authoritative TODAY for NFL pools —
    `participantIds` / entry existence — NOT Member Records, whose `reconcileMembership` wiring
    is still deferred repo-wide (ADR 0003); migrate the check to Member Records when that wiring
    lands. **Rendering: gated detail is a separate viewer-only section** ("Pools you share with
    X"), keyed by the caller-supplied `poolId` — it does NOT try to enrich anonymous public rows
    (the public doc deliberately has no join key, and an opaque row key would itself be a
    correlatable identifier). Public page renders aggregate; the shared-pools panel appears for
    signed-in co-members.
17. Recompute stays bounded: same participations-iteration pattern (sufficient for v1 —
    NFL entries are keyed `entries/{uid}` and indexed by `users/{uid}/participations`; the
    cross-type subject index from Member Records is documented as the extension path when
    non-NFL types join). Document the shard path per ADR 0004.
18. Acceptance: unit tests on aggregation math (buckets, floor, yearly rollup, profit merge);
    trigger test — scoring a week updates the projection; leak assertions — projection doc
    contains no un-scored pick and no pool identifier; callable denies non-co-member.

### Phase 6 — Expert grading + expert profiles
19. Grader step (attached to the score/sync path, isolated, best-effort): grades
    `nfl_games.expertPredictions` (`espnFpi`, `vegas`) against final scores into a server-only
    store `expertResults/{expertId}` (weekly shape parallel to `weeklyResults`; EVEN/no-pick =
    VOID). Projection recompute renders `publicProfiles/expert_espnFpi` etc. with
    `subjectKind:'EXPERT'`, same weekly/overall/teamByTeam shape; `profit` null; no achievements.
20. Acceptance: unit tests on grading (home/away/EVEN/void); expert profile renders on the same
    page component; rules test — `expertResults` unreadable by clients.

### Phase 7 — UI (`src/pages/PlayerProfile.tsx`) + dev harness
21. Tabbed layout per reference design — Stats (chart + team-by-team + yearly), Weekly Records,
    Pick History, Achievements — matching Tailwind tokens/`font-display`/card styles; tab in URL
    (per Pool Homepage precedent). Stubs replaced: Team-by-Team and Profit render real data;
    Achievements renders the subcollection with honest empty state ("none earned yet").
    Co-member "Pools you share with X" panel via the Phase 5 callable (separate section, not
    row enrichment); experts hide money sections entirely.
22. `/dev/dashboards` Player Profile mock updated to the full new shape (incl. an expert mock
    and a co-member-enriched variant).
23. Acceptance: `/dev/dashboards` renders all tabs from mock data; live page renders a real
    profile + an expert profile; anonymous view shows no pool names; visual pass against design
    tokens.

### Phase 8 — Backfill (Operations tab)
24. One explain-then-confirm Operations action (audit-logged, per Operations standard):
    re-grades every scored week of every non-sim NFL pool (writes per-game maps, bumps
    `resultsVersion`), seeds `feeOwed` on existing NFL Member Records — **fee-liable members
    only** (non-playing seeded owners keep `feeOwed: 0`, same liability rules as Phase 4) —
    from `pool.entryFee` with provenance `feeOwedSource: 'BACKFILL_ESTIMATE'` (vs `'LIVE'` going
    forward): the repo allowed OPEN-phase `entryFee` edits and never snapshotted per-member
    dues or old/new values in the settings audit, so pre-migration fee history is
    **best-effort, not exact** — the profile disclosure covers this ("fees estimated for pools
    joined before <migration>"). Exact fee-side Profit starts with live `feeOwed` stamping.
    Then sweeps completed NFL pools through finalize. Batched/resumable;
    excludes `sim-*` pools. **Recompute-storm control:** the backfill sets a guard
    (checked by `onEntryChangedRecomputeProfile`) suppressing per-write profile recomputes,
    then enqueues one deduped recompute per affected subject after the batch + finalize pass.
    No payout fabrication ever — commissioners may retro-record via the Phase 4 flow.
25. Acceptance: dry-run report (pools/weeks/entries counted) before execute; trigger-suppression
    verified (function invocation count bounded); post-run spot-check — a historical member's
    profile shows backfilled team-by-team and yearly rows; profit for unrecorded pools shows
    pending badge.

## Key decisions & tradeoffs

- **Per-pick outcomes live on the entry inside `weeklyResults`** (same batch, same version,
  with `poolType`/`pickMode` context) — no new collection/rules; reveal-safe by construction.
  See ADR 0005.
- **Public projection is aggregate-only: zero pool identifiers.** Per-pool detail is a
  viewer-gated callable for co-members/self/admin. Also fixes the pre-existing `weekly[]`
  pool-name leak. (Codex round 1, finding 1.)
- **v1 is NFL-only end to end** — stats, Profit, and counts; no knowingly-partial cross-type
  numbers. (Codex round 1, findings 2–3.)
- **Profit's source of truth is canonical `payoutRecords` award docs** (stable ids,
  supersession, settled flag); ledger events are audit-only. (Codex round 1, finding 4.)
- **Finalization is automatic and re-runnable**; `firstFinalizedAt` is audit metadata; rescores
  re-derive. Payouts remain human. (Codex round 1, finding 5.)
- **Entry-read tightening is blocking Phase 1 work**, not a parallel follow-up. (Finding 6.)
- **Profit counts awarded-not-yet-settled** and discloses pending pools; fees count when owed.
- **No units, no per-team money, no fabricated cross-pool rank, no blended accuracy** —
  bucketed by (poolType, pickMode); Best Finish is rank-only on the public doc.
- **Pick history = scored picks only** — strictly narrower than any lock gate.
- **Experts share the collection, the recompute, and the page** via `subjectKind` + reserved ids.
- **Achievements = subcollection contract, engine deferred.**
- **Within-pool payout visibility accepted** (participants may read their pool's payoutRecords):
  who won a pool is inherent to pool play; rejected tighter recipient-only reads as fighting the
  product. Public doc exposes only cross-pool aggregate profit.

## Risks / open questions

- Expert id non-collision with Firebase uids must be proven (Phase 1 test).
- Entry-read tightening may surface client code silently depending on coarse entry reads —
  Phase 1 includes an audit, but unknown-unknowns are the schedule risk.
- Backfill volume unknown until dry-run; batched writes must respect Firestore limits.
- Fee source of record is `feeOwed` (+ `rebuyOwed`) on the Member Record — never
  `pool.entryFee × playable entry` (that inference is exactly the bug Phase 4's liability rules
  exist to prevent). `reconcileMembership` wiring is still deferred repo-wide; Profit reads fee
  owed, not paid state, so it does not depend on that wiring — verify during Phase 4.
- Pre-migration fee-side Profit is best-effort (`feeOwedSource: 'BACKFILL_ESTIMATE'`): historic
  OPEN-phase `entryFee` edits are unrecoverable (no per-member snapshot, audit logged keys
  only). Exactness starts at live stamping; the profile disclosure is the honesty valve.
- Consensus went fully-open on 2026-07-09 (published pre-lock); profiles deliberately do NOT
  follow — scored-only. Confirm product is comfortable with the asymmetry.

## Out of scope

- Achievement engine (rules, awarding, catalog) — only the slot ships.
- All non-NFL pool types (SQUARES / BRACKET / NFL_PLAYOFFS / PROPS): stats, profit, counts, and
  their finalize/payout flows. The profile shape and the Member-Record-based subject index are
  the documented extension path.
- Pre-scoring (post-lock pending) pick reveal on profiles.
- Site-wide percentile ranking / leaderboards.
- Any change to consensus publishing or the certified scoring outputs
  (`weeklyPoints`/`totalScore`).
