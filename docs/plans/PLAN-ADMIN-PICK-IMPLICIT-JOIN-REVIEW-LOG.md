# PLAN-ADMIN-PICK-IMPLICIT-JOIN — adversarial review log

Companion to `PLAN-ADMIN-PICK-IMPLICIT-JOIN.md`. One entry per external review
round (codex `exec review --base origin/main`, model `gpt-5.6-terra`; qodo on
the PR). Every finding gets a verdict — absorbed with the fix, or rejected with
the reason. The stopping rule is CLAUDE.md §2b/§2c: qodo clean AND a codex round
clean AND my own read of the diff agrees.

## Self-review of the diff (before round 1)

- The implicit-join flag is computed from `poolInTx` — the pool doc read inside
  the transaction — not from the pre-transaction `pool` snapshot, so a concurrent
  join cannot make the gate count a stale roster.
- The capacity assertion runs after `assertNoScoringInProgress` and before any
  write; an `HttpsError` there aborts the transaction, and `retryWhileScoring`
  re-runs only on the lease-busy message (`scoringLease.ts:278`), so a refused
  admin gets the refusal, not a retry loop.
- `arrayUnion` in the same `poolRef.update` as `entryCount`: two updates to one
  doc in one transaction would also work, but one patch is easier to read and
  cannot be split by a later edit.
- The idempotent early return (`lastRequestId === requestId`) precedes every
  write, including the roster one — a replay of an already-landed submission
  does not re-join, which is correct because the first landing joined.

## Rounds

(filled in below as they run)
