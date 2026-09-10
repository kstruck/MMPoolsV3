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

With the branch's file, run 2026-09-10: 3 passed.

### qodo round 1 — PR #686, Code Review posted 2026-09-10T15:18:34Z, 8 inline findings (watcher settled `QODO REPORTED — 8 inline finding(s)` on the third arming, 2026-09-10 ~15:30Z — the complete set)

| # | Finding | Verdict | Action |
|---|---|---|---|
| 1 | Participation mirror can carry `undefined` `name`/`type`; admin SDK has no `ignoreUndefinedProperties`, so the whole transaction would be rejected | VALID (low — `type` is dereferenced before the transaction and `name` is required at create, so no pool made through the callable hits it) | Absorbed via `stageEnrollment`: both fields `?? null`. Applies to the explicit join too, which had the same exposure. |
| 2 | Member removed between the pre-transaction gate and the transaction is re-enrolled by "absent → join" | VALID — security | `assertNFLPickMembership(poolInTx, uid, ctx.actorRole)` re-run inside the transaction; only host / SUPER_ADMIN may be enrolled by a pick. Emulator test injects the removal through a Firestore proxy on `runTransaction`; fails on round-1 code, passes now. |
| 3 | `createdByUid` treated coequal with `ownerId`; a stale creator gains durable membership | VALID — security | Both the gate and the host exemption now use `poolOps.isPoolOwnerOrManager` (`ownerId \|\| createdByUid`, `managerUid` separate). Unit + emulator tests for the disagreeing-fields case. Side effect, recorded in SWEEPS S4: `nflEntryRename` inherits the precedence. |
| 4 | Test result in this log has no run date | VALID (doc) | Dated. |
| 5 | Enrollment writes duplicated between explicit and implicit join | VALID (maintainability) | `stageEnrollment` — one definition, both callers. |
| 6 | Plan-gated change has no sweep artifact | VALID (process) | `PLAN-ADMIN-PICK-IMPLICIT-JOIN-SWEEPS.md`, linked from the plan. |
| 7 | Emulator suite leaves fixed-ID residue | VALID | `wipe()` in `beforeAll` and `afterAll` (recursiveDelete on the six pools and four users, delete the game), then `test.cleanup()`. |
| 8 | Replay: capacity gate ran before the `lastRequestId` no-op; and a replay should repair missing roster indexes | SPLIT | Ordering half VALID — `assertJoinCapacity` moved after the replay return; emulator test seeds a landed request in a full pool, expects `{ success: true }`. Repair-on-replay half REJECTED: a replay is a client resend within seconds, and the only roster-less replay is one whose first landing predates this deploy; making a documented no-op path write would change its contract for a window that is the deploy itself. The next real submission enrolls. |

Every fix here is code codex has not seen — round 2 below.

### Round 2 — codex `gpt-5.6-terra`, `--base origin/main`, on `9da2d006` (all qodo fixes in)

Clean. Verbatim: "The transaction now enrolls implicitly admitted submitters
atomically with their entry and member record, while applying the existing
capacity rules and preserving replay behavior. Type checking passes; the
targeted Vitest run could not start in this environment because Vite failed to
spawn a subprocess (EPERM)." No findings. The `usage limit` grep hit once — on
this log's own round-1 sentence quoted in the diff, not on a codex message.
Codex's own vitest attempt failed in its sandbox; the suites were run here
instead (below).

### Gates on `9da2d006`, 2026-09-10

| Gate | Result |
|---|---|
| `npx vitest run` | 3193 passed (172 files) |
| `npm --prefix functions test` | 2203 passed (134 files) — 2200 + the 3 new precedence cases; a concurrent run showed one file failing to LOAD under three-suite contention, 13/13 alone |
| `npm --prefix functions run test:emulator` | 613 passed, 2 expected fail, 10 skipped — `adminImplicitJoin` 6/6; the 3 qodo-round cases FAIL on round-1 code (`951b6847`'s `nflPools.ts` swapped in: 3 failed / 3 passed) |
| `npx tsc -b && npm run build` | clean, built in 10.86s |
| `npm --prefix functions run typecheck` / `build` | clean |
| `npm run lint` | 1862 warnings / 0 errors — equals `origin/main` (1862), delta 0 |

Stopping rule: qodo reported and every finding absorbed or rejected in writing
(above, and on the PR); codex round 2 clean on the final diff; own read agrees.
Two codex rounds total.

### qodo round 2 — re-review after the draft → ready toggle (Code Review updated 2026-09-10T15:36:56Z; watcher `QODO REPORTED — 3 inline finding(s)` on the second arming of that SINCE)

Round-1 findings #1–#7 marked `✓ Resolved` by qodo; #8 marked `✗ Dismissed` (the
written rejection stood). Three NEW findings, all documentation:

| # | Finding | Verdict | Action |
|---|---|---|---|
| R2-1 | `CONTEXT.md` glossary does not describe implicit membership from an accepted pick, nor `ownerId` precedence over `createdByUid` | VALID (doc — CONTEXT.md is the canonical glossary) | Pool and Member Record entries updated. Read-repair while there: the Member Record entry claimed `reconcileMembership` keeps the three membership stores consistent, but that helper has no callers (measured); the entry now names what actually writes them. |
| R2-5 | The S3 census is not reproducible — no command, no output artifact | VALID (doc) | `functions/scripts/censusMembership.mjs` committed (read-only, same shape as `censusPayoutRanks.mjs`); invocation and verbatim output in SWEEPS S3, plus the expected post-repair line. |
| R2-6 | S1/S2 grep commands do not exclude tests and use basic-regex `\|` | VALID (doc) | Commands rewritten to the `grep -E` + `grep -vE "__tests__|\.test\.ts"` forms actually run; re-executed after the rewrite and they reproduce the tables. |

New code in this round is one read-only census script — round 3 below.

### Round 3 — codex `gpt-5.6-terra`, `--base origin/main`, on `74622ac1` (census script + glossary + sweep commands)

Clean. Verbatim: "The implicit enrollment is transactionally coupled to the
entry and member record, rechecks authorization against transactional state,
and applies capacity limits without breaking idempotent replays." No findings.
`usage limit` grep: hits only on this log's own earlier sentences in the diff.
Gates re-run on `74622ac1`: root 3193 passed, lint 1862 / 0 (delta 0); CI green
on `8b3c691e` (e2e-playwright included). Three codex rounds total.
