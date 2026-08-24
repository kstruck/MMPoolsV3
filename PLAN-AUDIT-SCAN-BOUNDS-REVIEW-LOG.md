# Review log — PLAN-AUDIT-SCAN-BOUNDS

Reviewer: `codex exec review --base origin/main` (plan + sweeps + implementation
in one diff). CLAUDE.md §2c rules; qodo DORMANT, so the stopping rule is a
clean codex round + the author's own read.

## Round 1 — 2026-08-23 (overnight)

VERDICT: CLEAN. "The bounded reminder union preserves all existing dispatch
paths, and the new score/playoff guards are scoped to their intended stale or
off-season cases."

Observed during the run: codex independently traced the `'CLOSED'` status
writers and `adminCloseUpdate` before approving the 1.2 guard — the check this
plan's R1/R2 risks asked a reviewer to make.

### Claude's response

No findings to absorb. Own read of the diff (required half of the stopping
rule):
- The fake `poolsSnapshot` object only needs `.size`/`.docs` — verified the
  loop and the log line are the only consumers.
- `withHeartbeat` contract (`HeartbeatResult.detail: Record<string, unknown>`)
  — the off-season return matches; first draft used a string and was fixed
  before commit.
- `in`-query max (30) vs 5 values; no composite index needed (no orderBy).
- The union deliberately over-fetches flagged PROPS pools (loop then skips
  them) — same outcome as today at negligible cost, rather than encoding the
  PROPS quirk into the query.

RESOLUTION: CONVERGED — round 1 clean, own read agrees, 0 findings, 0 carried.

## Round 2 — 2026-08-23, after review-log + plan-status docs added

VERDICT: REVISE. 1 finding, accepted:

1. (P1) The 1.2 guard checked `status === 'CLOSED'` — a DERIVED lifecycle
   label the application never persists. Real closes write
   `status: "COMPLETED"` + `closedVia: "ADMIN_CLOSE"` (`lib/lifecycle.ts`
   `adminCloseUpdate`), and cancels write `status: "CANCELED"`
   (`poolExceptions.ts:566`). The guard as written matched nothing.

### Claude's response

Accepted — textbook round-2 defect-in-the-fix. `isDeadSyncPool` now uses the
canonical helpers (`isTerminalStatus` + `ADMIN_CLOSE` from `lib/lifecycle.ts`)
instead of a hand-typed status string; tests updated to pin the persisted
values (`COMPLETED`, `CANCELED`, `closedVia`). Note the CANCELED case is the
material one: `adminCloseUpdate` also sets `scores.gameStatus: 'post'` (so
those pools age out of the query), but a cancel does NOT — a CANCELED pool
with a non-post gameStatus sat in the every-minute query forever.

## Round 3 — final

VERDICT recorded below after the run.
