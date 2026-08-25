# PLAN-AUDIT-BACKEND-RESIDUE — review log

Adversarial review rounds for `PLAN-AUDIT-BACKEND-RESIDUE.md` (items 14 and 17).
Reviewer: `codex exec review --base origin/main` (CLAUDE.md §2c). qodo is
**DORMANT** (§2b), so the stopping rule here is TWO conditions: a codex round
clean AND my own read of the diff agrees.

Cap: 10 rounds (flat while §2b is dormant).

Every finding gets a verdict — ACCEPTED (with the fix) or REJECTED (with the
reasoning). A rejection is a legitimate outcome; silence is not.

---

## Round 0 — self-review before the first codex pass

Recorded because §2c says a clean round 1 is not the review, and self-review is
the only other opinion while qodo is off. These were found and fixed before any
codex round ran:

| # | Finding | Verdict |
|---|---|---|
| 0.1 | `deliveryTally.test.ts` pinned `runReminders`' options as a VERBATIM string, so item 14's sizing broke a test that guards the Courier secret binding and nothing else. | ACCEPTED — rewritten to match the options object by regex. Mutation-checked: deleting `secrets: [courierAuthToken]` still fails it. |
| 0.2 | The plan doc said "13 jobs lack sizing… the other ten". The brace-matched scan says 14 of 24, so eleven remain. An off-by-one in a doc that a guard's allowlist is derived from. | ACCEPTED — §1 scope note corrected and the eleven named. |
| 0.3 | The `poolOps.ts:782` callable was labelled `togglePayoutPaid` in the plan and the test table. Its real name is `toggleWinnerPaid`. | ACCEPTED — corrected in both. |
| 0.4 | `jobSizing.test.ts`'s first draft sliced options to the first `}`, which under-reads a multi-line options object (`nflLockWatchJob`) and would report a SIZED job as unsized — a guard that cries wolf gets an allowlist entry added to silence it, and then guards nothing. | ACCEPTED — replaced with a brace-matched extractor. |
| 0.5 | Both new guards could be vacuous. | ACCEPTED — mutation-checked. Removing `runReminders`' sizing fails 3 of the 8 `jobSizing` assertions; removing the secret binding fails the `deliveryTally` one. |

---

## Round 1 — `codex exec review --base origin/main`

See the PR body for the per-finding verdict table; findings and responses are
recorded below as they land.
