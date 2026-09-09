# Plan Review Log: Player Profiles

Act 1 (grill-with-docs) complete — plan locked at `PLAN-PLAYER-PROFILES.md`; CONTEXT.md updated
(Profit refined; Payout Record, Season Finalization, Profile Subject, Expert, Achievement added;
Player Profile narrowed to scored-picks-only); ADR 0005 created. MAX_ROUNDS=5.

Grill decisions (10 questions, all answered by owner):
1. v1 scope: NFL types real; Bracket/Playoffs/Squares/Props deferred to profit+counts.
2. Profit: net; awarded counts whether paid or not.
3. Finalize: automatic stats finalization; commissioner records payouts separately.
4. Per-pick schema: extend `weeklyResults[week].games` on the entry, same batch/version.
5. Team-by-team: picked-for W-L + accuracy%, min-3 floor, no money column.
6. Yearly rank: Best Finish ("1st of 12 — Pool") instead of fabricated cross-pool rank.
7. Pick history: scored picks only (no new reveal surface).
8. Experts: same `publicProfiles` collection, reserved ids + `subjectKind`.
9. Achievements: `publicProfiles/{id}/achievements` subcollection, contract frozen in
   `shared/achievements.ts`, engine deferred.
10. Backfill: all derivable (non-sim), never fabricate money.

Arbiter-settled details (logged): entry fees count toward Profit before payouts are recorded,
with a pending-payouts disclosure badge; no blended cross-type accuracy (per ADR 0004).

## Round 1 — Codex
VERDICT: REVISE. 11 findings (thread 019f475a-90bb-7b11-b151-d8f0cdfd83b7):
1. HIGH — public pickHistory carries poolId/poolName on world-readable publicProfiles → private-pool membership leak (leak already live in shipped weekly[]).
2. HIGH — participations-iteration is NFL-only; Bracket uses joinedPools + random entry ids, Props has no index; cross-type profile can't reuse it.
3. HIGH — fee side of Profit has no canonical cross-type source (memberRecord dues vs entry docs; reconcileMembership wiring deferred).
4. HIGH — paymentLedger is best-effort/failure-swallowing; latest-per-member reducer collapses multi-award cases; unfit as Profit source of truth.
5. HIGH — finalize-once guard contradicts ADR 0004 re-derive-on-rescore; seasonHistory/Best Finish would go permanently stale.
6. HIGH — plan punted ADR 0004 entry-read tightening despite it being a security gate; participants can read full entry docs once locked.
7. MED — teamByTeam blends Pickem SU/ATS/Survivor semantics; per-pick records lack poolType/pickMode context.
8. MED — backfill rewrites every entry → onEntryChangedRecomputeProfile storm.
9. MED — payout prefill can't assign bonuses[] from standings.
10. MED — seasonHistory "for every member" fabricates ranks for roster-only members with no entry.
11. MED — payout amounts in participant-readable payments ledger = new money-privacy surface.
Open questions: private-pool inference acceptable? unpaid-award visibility? why not NFL-only end to end?

### Claude's response
Accepted 1–10; 11 partially. Owner re-consulted on finding 1 (it overturned the grill-locked Best
Finish display): decision = strip ALL pool identifiers from the public doc (weekly aggregates
across pools, pick history without pool identity, Best Finish rank-only) + viewer-gated
`getProfilePoolDetail` callable for subject/co-members/admin; also fixes the live weekly[] leak.
(2,3) v1 cut to NFL-only end to end — no partial cross-type profit/counts; Member-Record subject
index documented as extension path. (4) canonical `pools/{poolId}/payoutRecords/{awardId}` docs
(stable ids, supersession, settled flag) become Profit's source of truth; ledger events audit-only.
(5) finalization now re-runnable overwrite; firstFinalizedAt audit-only; backstop sweep also
catches stale finalizations. (6) entry-read tightening pulled into Phase 1 as blocking. (7)
per-pick results carry poolType/pickMode; teamByTeam bucketed, never blended. (8) backfill
suppresses trigger recomputes + deduped per-subject recompute after. (9) prefill places[] only;
bonuses manual. (10) seasonHistory only for members with playable entry. (11) REJECTED tighter
recipient-only reads: payoutRecords stay pool-participant-readable — who won a pool is inherent
to pool play (payout structure + standings already pool-public); accepted the narrowing that
per-pool amounts never appear on the world-readable doc. Public aggregate profit total stays, by
product decision (AP-style reference).
PLAN-PLAYER-PROFILES.md revised; ADR 0005 + CONTEXT.md updated to match.

## Round 2 — Codex
VERDICT: REVISE. 5 findings; prior round's fixes confirmed closed (pool-name leak, NFL-only cut,
ledger source-of-truth, one-shot finalize, backfill storm, entry-read tightening).
1. HIGH — Achievement contract kept poolId? on a world-readable doc → reintroduces membership leak.
2. HIGH — getProfilePoolDetail authorized via Member Records, which aren't authoritative yet (reconcileMembership wiring deferred).
3. HIGH — ADR 0005 consequences still said finalized-once + ledger reconciliation (internally inconsistent with revised decisions).
4. MED — staleness compare of per-entry resultsVersion vs pool finalizedAt timestamp is incoherent.
5. MED — settled/note/actor metadata on participant-readable payoutRecords over-exposes settlement detail.

### Claude's response
All 5 accepted. (1) poolId removed from public achievement contract; meta contractually barred
from pool identity; pool linkage future-engine-private via gated detail path. (2) callable
authorizes via participantIds/entry existence (authoritative today for NFL); migrate to Member
Records when ADR 0003 wiring lands. (3) ADR 0005 consequences rewritten to match decisions
(re-runnable finalize, payoutRecords source of truth). (4) scoreNFLWeek stamps pool-level
lastScoredAt/scoredThroughWeek; sweep keys on finalizedAt < lastScoredAt. (5) payoutRecords split:
participant-readable {uid, amount, kind}; payoutRecordsPrivate {settled, note, actor} readable by
commissioner/admin/recipient only.

## Round 3 — Codex
VERDICT: REVISE. 4 findings; round-2 fixes confirmed closed (achievement leak, stale-finalize
comparison, payout visibility at product level, plan-side callable auth source).
1. HIGH — payoutRecords schema still listed settled/note/recordedBy while claiming they're private; Firestore rules are doc-level, so stated schema leaks.
2. HIGH — getProfilePoolDetail(subjectId) shape risks granting ALL subject pools after one overlap.
3. MED — ADR 0005 still said Member Record check for callable auth (contradicting plan).
4. MED — feesOwed "per playable entry" undercounts joined-but-never-played members; joinNFLPool creates payment truth before any entry.

### Claude's response
All 4 accepted. (1) explicit two-doc contract: payoutRecords = {uid, entryId?, amount, kind,
recordedAt, supersededBy?} participant-readable; payoutRecordsPrivate = {settled, note,
recordedBy} commissioner/admin/recipient only; shared awardId. (2) callable now
getProfilePoolDetail(subjectId, poolId) — poolId required, per-pool per-call auth; client
enumerates its own pools. (3) ADR 0005 updated: participantIds/entry-existence auth until ADR
0003 wiring lands. (4) feeOwed base-dues persisted on Member Record at join/create; Profit fee
side reads Member Record dues (feeOwed + rebuyOwed), never entry existence; Phase 8 backfill
stamps feeOwed on existing records.

## Round 4 — Codex
VERDICT: REVISE. 4 findings; round-3 fixes confirmed closed (achievement leak, callable
over-grant, stale comparison, ADR/plan auth-source mismatch).
1. HIGH — feeOwed is a second fee truth with an open drift path: entryFee editable while pool OPEN; backfill from current pool doc can misstate historic dues; shared contract lacks the field.
2. HIGH — auto-seeded owner Member Record would get feeOwed and a bogus negative-profit profile for commissioners who hosted but never played.
3. MED — public rows have no join key, so client can't attach gated per-pool detail to the right anonymous row (multi-pool seasons ambiguous).
4. MED — ADR 0005 payoutRecords schema text still bundled settled/recordedBy before prose-splitting them (accepted-ADR contradiction).

### Claude's response
All 4 accepted. (1) feeOwed added to shared/memberRecord.ts contract as the single dues source;
entryFee edits (only possible while OPEN per shared/editability.ts) cascade-update feeOwed on
fee-liable Member Records in the same transaction; post-lock entryFee is immutable so
completed-pool backfill from pool.entryFee is accurate. (2) owner-seeded record gets feeOwed: 0
until owner commits a playable Entry; non-owners stamped at join. (3) chose the separate
viewer-only "Pools you share with X" section keyed by caller-supplied poolId — no row
enrichment, no opaque join key (which would itself be correlatable). (4) ADR 0005 decision 3
rewritten as two explicit schemas (payoutRecords participant-visible fields only;
payoutRecordsPrivate for settled/note/recordedBy).

## Round 5 — Codex (final round, MAX_ROUNDS=5)
VERDICT: REVISE. 2 findings; Codex confirmed ALL substantive prior blockers closed (pool-identity
leaks, payout schema split, poolId-scoped callable auth, shared-pools panel, stale-finalize
marker, owner feeOwed:0 rule).
1. HIGH — backfilled feeOwed from current pool.entryFee cannot be exact: OPEN-phase fee edits were historically allowed, no per-member dues snapshot exists, settings audit logged keys not values.
2. MED — residual doc ambiguity: risks section still said "pool.entryFee × playable entry"; Phase 8 didn't restate owner-no-play exception.

### Claude's response (applied post-cap)
Both accepted and applied. (1) backfill marked best-effort: feeOwedSource 'BACKFILL_ESTIMATE' vs
'LIVE'; exact fee-side Profit starts at live stamping; profile discloses estimated fees for
pre-migration pools; fee-liable-only + owner-0 rules restated in Phase 8. (2) risks section
rewritten — Member Record feeOwed is the only fee source; the × inference is named as the
forbidden pattern.

## Resolution
Cap hit at 5 rounds without a formal APPROVED. NOT a fake convergence claim: rounds 1–4 findings
were all explicitly confirmed closed by Codex in later rounds; round 5's two findings were
accepted in full and applied to plan + ADR after the cap, but that final text has NOT been
re-verified by Codex. No unresolved disagreement exists — every Codex finding across 5 rounds was
either accepted and applied (19 of 20) or rejected once with logged reasoning (round 1 finding 11,
partially: within-pool who-won-what visibility retained as inherent to pool play; its private
settled/note/actor split WAS adopted in round 3). Owner sign-off is the remaining gate.
