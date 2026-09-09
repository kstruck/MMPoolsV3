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

**Verdict: CLEAN.** "No discrete, actionable regressions were identified in the
changes relative to the specified merge base." Zero findings.

§2c is explicit that a clean round 1 is not the review — "round 1 finds defects
in the code, and rounds 2+ find defects in the fixes" — and with qodo dormant the
diff read is the only other opinion. It earned its keep:

| # | Finding (self-review after codex round 1) | Verdict |
|---|---|---|
| 0.6 | **`scoreNFLWeek`'s `userRole` has a SECOND consumer the audit's item text never mentioned**: the `ACTIVE_GAMES` gate 25 lines below the ownership check, which exempts SUPER_ADMIN from "all games must be FINAL". 17d's one-line change therefore also reaches a **scoring** bypass — the one that applies Survivor strikes and Margin -14s mid-week. | ACCEPTED as correct-and-intended (an unbacked claim losing a scoring bypass is strictly more restrictive; no principal gains anything), but it was **undeclared**. Named in the plan §0, which now classifies the change as authorization + prod data + **scoring**; pinned by a test asserting the gate reads the resolved role and that no second `userRole` binding shadows it. |
| 0.7 | `jobSizing.test.ts` passed `text.search(re)` straight into `firstObjectLiteral`, so a failed search (-1) would make it read the FILE'S FIRST object literal and assert about the wrong thing — a guard that looks like it guards and does not. | ACCEPTED — the index is asserted `>= 0` before use, at both call sites. |

## Round 2 — `codex exec review --base origin/main` (on the round-1 fixes)

Required by §2c: the code written to close a finding has never been reviewed.

**Verdict: CLEAN.** Zero findings. Self-review of the r1 fixes agreed, with one
tidy-up carried to round 3: `userProfile.ts` still imported `onCall` after 17f
removed its last use.

## Round 3 — `codex exec review --base origin/main` (final diff)

**Verdict: CLEAN.** "No discrete, actionable regressions were identified relative
to the specified merge base. Type checking passes." (Its own attempt to run the
suite hit a Windows EPERM spawn error inside its sandbox; the four gates were run
directly instead — see the PR body.)

---

## Stopping

Both conditions of the §2c rule are met — a clean codex round AND my own read of
the diff agrees — and **no findings are carried**. 3 paid rounds of a cap of 10.
qodo is DORMANT, so it is two conditions, not three.

## Local-gate note (not a finding)

`npm test` at the repo root reports 3 failures in `tests/addon-purchase.test.ts`.
They are **not** from this change and are **not** weakened or worked around:

- The branch never touches `functions/src/stripe.ts` — `git diff
  origin/main...HEAD -- functions/src/stripe.ts` is empty and no commit on the
  branch touches it.
- The assertions are multi-line `toContain('… ,
            purchaseKind,')`
  substrings of that file, and this Windows worktree has `core.autocrlf=true`
  with no `.gitattributes`, so every checked-out file has CRLF terminators.
  Measured: both needles are `false` against the raw file and `true` against the
  same bytes with `
` normalized to `
`.

CI checks out LF on Linux, and CI is the authoritative gate (coordinator
bulletin). Every test THIS PR adds is line-ending agnostic by construction —
single-line regexes, or character classes that admit ``.
