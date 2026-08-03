# Plan Review Log: Importer Safety

Plan drafted 2026-08-03 from code reading at `0f548bf` (no grill session — the
defects were already confirmed and recorded in `MORNING-2026-07-31.md` item 5;
this plan is the write-up that item deferred). MAX_ROUNDS=10 (CLAUDE.md §2c —
ask Kevin with a reason past 10; stop on evidence, not the counter).
PLAN_FILE=PLAN-IMPORTER-SAFETY.md.

## Round 1 — codex exec review --base origin/main

VERDICT: REVISE. 6 findings (4 P1, 2 P2), **all 6 accepted** (final arbiter:
Claude; both code-behavior claims were verified against source before
acceptance). Summary:

1. (Critical) **Per-week replacement was not atomic** — the drafted
   delete-then-write order reproduced the very delete-then-fail window the
   plan exists to close, and ≤400-op chunking widens it. Fix: 1.1 now orders
   fetch → write → delete-stale-last, and requires a test that an injected
   commit failure preserves the prior slate.
2. (Critical) **"Fetch succeeded" was under-specified** — non-null `raw` only
   proves JSON arrived; `parseScoreboardResponse` returns `[]` for malformed
   payloads and when the PR #219 season guard filters everything. Fix: 1.2 now
   gates deletion on a non-empty parsed slate, and a genuinely game-less week
   requires an explicit operator flag, never inference.
3. (Critical) **Deleting a re-keyed id strands picks** — verified:
   `entry.picks[game.id]` (`nflScoringEngine.ts:108`). Fix: new 1.6 — a live
   run refuses to delete any id referenced by entries and reports it;
   automatic pick migration explicitly rejected (Key decisions).
4. (Critical) **`merge: true` would unlock locked spreads** — verified: the
   parser emits `spread: { …, locked: false }` (`nflSchedule.ts:342`) and only
   the sync path preserves locks (`nflSchedule.ts:746-750`, the #235 fix).
   Fix: new 1.5 — importer writes apply the same preservation.
5. (High) **Dry-run guarantee was stated wrong** — "without touching
   Firestore" is impossible (the would-delete set requires reads) and left no
   durable evidence. Fix: 0.1 now guarantees zero `nfl_games` mutations and
   persists an actor-attributed audit record for dry AND live runs.
6. (High) **Per-batch cap ≠ run cap** — chunking alone leaves a mis-scoped
   query's blast radius unbounded. Fix: 1.3 adds a total-mutation cap checked
   before the first live write, modeled on `MAX_SPREAD_LOCKS_PER_RUN`
   (`nflSchedule.ts:976-985`).

### Claude's response

All six accepted and folded into the plan text (each item cites its finding).
No rejections this round.

## Round 2 — codex exec review --base origin/main

VERDICT: REVISE. 3 findings (2 P1, 1 P2), **all 3 accepted**. Summary:

1. (Critical) **A non-empty parse is still not a usable slate** —
   `parseScoreboardResponse` drops malformed events INDIVIDUALLY, so one
   surviving event passes 1.2's non-empty check while the fetched-id
   subtraction deletes every other stored game as "stale". Fix: 1.2 now
   requires fail-closed completeness (parsed count == raw event count) plus
   the 1.3 bound on the would-delete set.
2. (Critical) **The config kill-switch was wrongly rejected** — the draft
   substituted the `dryRun:false` handshake for rule 1's required runtime
   gate, leaving no global halt lever during an incident. Fix: new 0.2 —
   `system/config.nflImport.enabled`, default OFF/absent = live runs refused,
   config read failure also refuses; Key decisions rewritten from "rejected"
   to "both layers".
3. (High) **The sweep belonged in the standalone artifact** — the
   change-control gate is plan → review log → sweep, and the inline two-row
   table was not the enumeration the gate asks for. Fix:
   `PLAN-IMPORTER-SAFETY-SWEEPS.md` added with three sweeps (all 30
   `nfl_games` sites classified; all `spread.locked` writers; all
   `picks[` readers keyed by what they index on), each ending in the result
   it feeds; the plan's inline section is now a pointer.

### Claude's response

All three accepted. Sweep 3 sharpened plan item 1.6 beyond what the finding
asked: Survivor/Margin picks key on week + team id, so only Pick'em entries
are strandable by a game-id re-key — the refusal guard needs to consider
exactly those.

## Round 3 — codex exec review --base origin/main

VERDICT: REVISE. 4 findings (3 P1, 1 P2), **all 4 accepted**. One structural
change absorbs most of them: a default live run is now UPSERT-ONLY, and stale
deletion moved behind an explicit per-call `purgeStale: true` reviewed against
a dry-run report. Summary:

1. (Critical) **parsed==raw only detects parser loss** — a syntactically
   valid feed the upstream truncated (15 of 16 events, all parsing) passes
   the completeness check and the subtraction purges the missing game. No
   automatic signal distinguishes "re-keyed" from "truncated". Fix: the
   upsert-only restructure in 1.1 — deleting stored games is always an
   operator decision, never inferred.
2. (Critical) **Week identity was a residual risk, not a runtime check** —
   if ESPN's positional calendar mapping drifts, the parser stamps the
   requested week onto a coherent WRONG week's events (it stamps from
   arguments by design — `feedSnapshot.test.ts:165`) and a purge would
   delete the real slate. Fix: 1.2 gains a runtime week-identity assertion —
   every parsed kickoff must fall inside the calendar-resolved date range
   the code already fetches; calendar unavailable (naive-URL fallback) =
   refuse the live replacement. (The draft fix was a payload self-declared
   week field; no captured fixture in the repo proves that field exists, so
   the check was built from the date range instead.)
3. (Critical) **The 1.6 reference scan ran after the writes** — a refusal
   discovered at delete time leaves the re-keyed duplicate already written:
   two live fixtures for one game. Fix: 1.1 reordered — ALL preconditions,
   including the stale-id reference scan, run before any mutation commits.
4. (High) **Same-id lock preservation has a re-key hole** — the replacement
   id has no existing doc to preserve from while the OLD locked doc is the
   one being purged, leaving the slate `SPREADS_NOT_LOCKED`. Fix: 1.5 — a
   purge must carry the locked spread onto the matched replacement (same
   teams + kickoff) or refuse that week's purge.

### Claude's response

All four accepted. Consequential edits beyond the findings: 2.1's `success`
definition was rewritten (its "verifiably empty-from-feed" success state
contradicted 1.2 as amended), the result shape gained
`staleIds/purged/refused`, and the ESPN-calendar-drift risk item was
rewritten from "residual scoped damage" to "guarded at runtime, fails
closed".

## Round 4 — codex exec review --base origin/main

VERDICT: REVISE. 4 findings (3 P1, 1 P2), **all 4 accepted**. Summary:

1. (Critical) **Purge replacement was not atomic** — write commit followed by
   a failed delete commit leaves both the old and re-keyed fixture live, and
   week queries score the matchup twice. Fix: 1.1 — a `purgeStale` week
   commits writes AND deletes in one `WriteBatch` (≤16 games each way, far
   under the 500-op limit; if combined ops ever exceeded it, refuse rather
   than split).
2. (Critical) **parsed == raw-event count rejects a VALID boundary response**
   — the PR #219 season guard intentionally filters a neighboring season's
   opener out of a calendar-range payload (`nflSchedule.ts:252-265`), and
   counting that filtered event as parse loss fails the completeness check
   on a documented-correct response. Fix: 1.2 compares parsed count against
   ELIGIBLE events (those passing `eventMatchesSeason`,
   `nflSchedule.ts:227-232`); any eligible event failing to parse refuses.
3. (Critical) **Re-importing a scored week left standings stale** — the
   importer overwrites the doc, so the next sync sees no transition and
   never enqueues rescoring. Fix: new 1.7 — reuse the sync path's
   prior-state diff and same-batch rescore handoff
   (`nflSchedule.ts:776-790`, `lib/rescoreQueue.ts`); arming the queue's
   consumer remains Kevin's, enqueueing is inert until then.
4. (High) **`purgeStale` and the empty-week override would be rejected by
   the strict schema** — `z.strictObject` refuses unlisted fields before the
   handler runs. Fix: new 1.8 — every new control is added to the schema,
   service types, and UI contract together, optional with safe-when-absent
   defaults.

### Claude's response

All four accepted; no rejections. Round trajectory is narrowing as expected:
r1 core data-loss mechanics, r2 governance layers, r3 identity/ordering
edges, r4 interaction with adjacent subsystems (scoring queue, schema
envelope).

## Round 5 — codex exec review --base origin/main

VERDICT: REVISE. 3 findings (2 P1, 1 P2), **all 3 accepted**. Summary:

1. (Critical) **A pick submitted between the reference scan and the purge
   commit gets stranded** — a new entry doc is not a doc the transaction
   read, so it raises no conflict; the scan alone cannot serialize
   submissions. Fix: 1.6 — a `purgeStale` run sets a short-lived
   slate-scoped import gate the pick-submission validation checks
   (retryable refusal), cleared on commit or failure.
2. (Critical) **Read-then-batch lock preservation loses a concurrent lock**
   — `lockNFLSpreadsJob` committing between the importer's read and its
   batch commit gets silently reopened. Fix: 1.1/1.5 — purge weeks commit in
   ONE transaction that re-reads the games; upsert-only runs OMIT `spread`
   from the merge payload for existing ids (spread updates on existing games
   belong to the sync path and lock job). Invariant stated: no import write
   may transition `spread.locked` true→false.
3. (High) **1.3's ≤400-op delete chunking contradicted 1.1's atomicity** —
   chunking a purge recreates the partial-replacement failure. Fix: 1.3 —
   no chunking path exists; a purge that cannot fit the single transaction
   refuses outright. (Caught the plan contradicting itself as drafted.)

### Claude's response

All three accepted. r5 is the concurrency round — every finding is a race or
an internal contradiction, none is a new data-loss primitive; the core design
(dry-run default, upsert-only live, explicit gated purge) survived unchanged.

## Round 6 — codex exec review --base origin/main

VERDICT: REVISE. 3 findings (3 P1), **all 3 accepted** (each verified against
source before acceptance). Summary:

1. (Critical) **`eventMatchesSeason` is fail-open on absent metadata** —
   verified (`nflSchedule.ts:232` guards only when `s.type` is present), so
   a payload that LOST its season metadata counts every event eligible and
   can pass the kickoff-range check while belonging to a different slate.
   Fix: 1.2 — a purge additionally requires present, exactly-matching
   `season`+`seasonType` on every eligible event; fail-closed for
   destruction, tolerant for upserts (sync behavior unchanged).
2. (Critical) **In-flight-before-gate submission race** — verified:
   `submitNFLPicksInternal` loads the slate BEFORE opening its entry
   transaction (`nflPools.ts:373-377`), so a request pausing across the
   whole gate window commits a purged id after the gate clears. Fix: 1.6 —
   gate check plus picked-game-id revalidation INSIDE the submission
   transaction, with a test for exactly that interleaving.
3. (Critical) **Teams+kickoff matching reverses a home-relative line** —
   verified: `spread.value` is home-relative (`nflSchedule.ts:296-303`), so
   carrying a lock across a home/away swap (a venue correction) flips its
   meaning and misgrades ATS. Fix: 1.5 — exact home/away identity required;
   a flip never carries the lock silently, refuse and let the operator
   relock.

### Claude's response

All three accepted. The gate mechanism from r5 #1 needed r6 #2's refinement
one round later — the review log records this on purpose: a guard added to
close a finding earns its own review (CLAUDE.md §2c), and this is what that
looks like when it works.

## Round 7 — codex exec review --base origin/main

VERDICT: REVISE. 4 findings (4 P1), **all 4 accepted** (proxyPick claim
verified against source). Summary:

1. (Critical) **Phase 0's UI update could neutralize the safe default** — a
   one-click UI passing `dryRun: false` defeats dry-run-by-default the
   moment the config gate flips on, and Phase 3's report-then-confirm
   arrives later. Fix: 0.1 — the Phase-0 UI is DRY-RUN-ONLY; no UI path can
   send a live run until Phase 3 ships.
2. (Critical) **Scan-then-gate leaves a stranding gap, and a crashed run
   could gate a slate forever** — Fix: 1.6 — the gate is acquired BEFORE
   the reference scan and is an expiring, owner-tokened lease; expired
   leases read as inactive, only the owner clears its own.
3. (Critical) **`proxyPick` bypasses the gated submission path** — verified:
   it writes `entry.picks[gameId]` in its own transaction
   (`poolExceptions.ts:316-345`) without touching
   `submitNFLPicksInternal`. Fix: 1.6 — the gate check + id revalidation is
   required in EVERY pick-writing transaction (two paths; Sweep 3 now lists
   the writers), and the interleaving test runs on both.
4. (Critical) **A re-keyed game breaks the "safe" upsert too** — the
   replacement id has no existing doc, so lock-preservation-by-omission
   does not apply: the upsert writes a duplicate `locked: false` fixture
   while the old locked doc remains, and ATS submission blocks on any
   unlocked game — the whole slate goes down. Fix: 1.1 — an upsert-only
   run REFUSES a week containing a re-key (new id whose exact home/away +
   kickoff matches a stored doc under a different id); re-keys are only
   resolvable through the reviewed `purgeStale` path.

### Claude's response

All four accepted. r7 attacked the seams BETWEEN the safety mechanisms
(UI ↔ default, gate ↔ scan, gate ↔ second write path, upsert ↔ lock rule)
rather than the mechanisms themselves — the expected shape when the core is
converging.

## Round 8 — codex exec review --base origin/main

VERDICT: REVISE. 4 findings (4 P1), **all 4 accepted** (id construction,
`survivorAllowedForGroup`, and the same-id-only diff helpers verified against
source). Summary:

1. (Critical) **Missing/duplicate source ids collapse the fetched-id set** —
   the parser builds `espn_${event.id}` with no presence or uniqueness
   validation (`nflSchedule.ts:276`), so the parsed-count check passes while
   the stale subtraction purges real games. Fix: 1.2 — a purge requires a
   present, unique source id on every eligible event.
2. (Critical) **A purge outliving its lease commits into resumed picks** —
   owner-only clearing does not fence an in-flight owner. Fix: 1.6 — the
   purge transaction re-reads its own lease INSIDE the delete transaction
   and aborts if expired or no longer owned; pick and purge windows become
   disjoint.
3. (Critical) **Removal/re-key is invisible to the reused sync diff** —
   `detectStatCorrections` / `isTerminalTransition` walk fresh SAME-ID games
   (`lib/feedSnapshot.ts:87`, `nflSchedule.ts:77`); purging a final game or
   re-keying it to a nonterminal replacement produces no rescore event. Fix:
   1.7 — a purge computes its own removal/re-key diff and enqueues the
   reconciliation event in the same transaction as the delete.
4. (Critical) **Survivor's queue defers scored-week corrections forever** —
   `survivorAllowedForGroup` (`lib/rescoreQueue.ts:255`) rejects correction
   events once the week or a later week is scored/published, so enqueueing
   is not reconciliation there. Fix: 1.7 — a live import that would change
   score-relevant fields on a week already scored for an affected Survivor
   pool REFUSES that week; Survivor reset-and-replay added to Out of scope
   as its own future plan.

### Claude's response

All four accepted; no rejections.

## Round 9 — codex exec review --base origin/main

VERDICT: REVISE. 3 findings (3 P1), **all 3 accepted**. Summary:

1. (Critical) **The Survivor precondition raced the scorer** — the 1.6 gate
   blocks pick writers, not scoring, so a scorer publishing the week between
   the check and the import commit invalidates it silently. Fix: 1.7 — the
   commit re-checks affected pools' scored/published state under the same
   per-pool scoring fence the submission path respects (the
   `retryWhileScoring` lease, `nflPools.ts:367-370`).
2. (Critical) **A re-key that also flexes the kickoff evaded the duplicate
   guard** — matching home/away + kickoff misses ESPN correcting both at
   once. Fix: 1.1 — the matcher is same-week same-home/away pair under a
   different id, kickoff matching or not; an NFL matchup occurs at most
   once per week, so that shape is always a re-key.
3. (Critical) **Enqueueing to a disarmed consumer recreates the stale
   standings** — the queue event sits inert until an operator arms the
   consumer. Fix: 1.7 — a live import changing score-relevant fields on an
   already-scored week requires the rescore consumer to be live at run
   time, else that week refuses; unscored weeks unaffected.

### Claude's response

All three accepted; no rejections.
