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
