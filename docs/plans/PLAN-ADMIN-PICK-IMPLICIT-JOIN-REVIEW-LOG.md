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

### Round 1 — codex `gpt-5.6-terra`, `--base origin/main`, on `951b6847`

Clean. Codex ran `npm run typecheck` and the membership unit test itself before
answering. Verbatim: "The transaction now atomically records the implicit
membership and profile participation mirror while applying the same capacity
checks as explicit joins. The refactoring preserves the existing join-capacity
behavior." No findings. Output checked for `usage limit` / `Review was
interrupted`: neither present.

Not in that diff: `582aeefa`, the one-line guard-test update in
`tests/free-cap-notice.test.ts` (the source guard looked for the pre-hoist
expression `participantIds.length >= FREE_PLAN_PARTICIPANT_CAP`). Test text
only, no runtime code; left to qodo on the PR rather than a paid round.

### Evidence the defect test is a defect test

With `origin/main`'s `functions/src/nflPools.ts` swapped in, the new emulator
file fails all three cases and the assertions name the defect:

```
× adds the admin to participantIds in the same write as the entry and Member Record
  AssertionError: expected [ 'implicit-join-host' ] to include 'implicit-join-admin'
× the bypass still honours the free-plan seat cap — nothing is written on refusal
  AssertionError: promise resolved "{ success: true }" instead of rejecting
× an ordinary member and the host are untouched by the gate
  AssertionError: expected [ 'implicit-join-member', …(8) ] to include 'implicit-join-host'
```

With the branch's file: 3 passed.
