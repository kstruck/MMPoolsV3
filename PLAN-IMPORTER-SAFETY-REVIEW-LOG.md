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
