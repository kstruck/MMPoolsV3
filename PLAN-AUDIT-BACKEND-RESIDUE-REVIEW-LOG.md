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
