# PLAN-PAYMENT-LEDGER — adversarial review log

Act 1 (grill-with-docs) ran overnight 2026-08-15 **without Kevin** — the questions
it would have asked him are the plan's §6, each with a recommendation. Act 2 is
codex (`codex exec -s read-only`, fresh session per round, stdin closed —
`</dev/null`, or codex blocks reading "additional input" when backgrounded).
MAX_ROUNDS=5.

## Round 1 — codex (9 findings) — VERDICT: REVISE

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | Checkbox not idempotent — `recordPoolPayouts` mints a fresh id per call, `reduceAwards` sums all; a double-click doubles Profit | **ACCEPTED — the best finding of the round** | D4: deterministic id `wk{week}-{entryId}-p{place}`, create-if-absent in the transaction; K11 |
| 2 | Critical | Relaxed gate does not bind the weekly PLACE to the published award — any amount / entry / recipient accepted | **ACCEPTED** | D4: transaction reads the recap, requires owned entry, `(entryId, place)` in `weeklyPlaces`, amount = frozen figure; overrides via BONUS/ADJUSTMENT |
| 3 | High | Batch gate runs once; a mixed `awards[]` could ride an unfinalized season award in | **ACCEPTED** | D4: per-award eligibility before any write, all-or-nothing |
| 4 | High | `weeklyPayouts` unvalidated on `updatePoolSettings` (rules parity is not a callable gate) | **ACCEPTED** | D1 + T1: server validator + lifecycle gate with callable tests |
| 5 | High | "Members see only their own rows" is not enforced — `weekly_recaps` are public and would carry recipients + amounts | **ACCEPTED as a decision** | R8 + **K10**: recommend public (recap already names the winner), stated on the page; Kevin decides |
| 6 | High | WEEKLY shape underspecified; `payouts` is required today and the draft said WEEKLY would ignore it | **ACCEPTED — the draft was wrong** | D1 rewritten as a mode matrix: `payouts` unchanged for SEASON/WEEKLY; `weeklyPayouts` only for HYBRID, absent ⇒ today's behaviour |
| 7 | Medium | R5's equality test conflates the season-long weekly allocation with one week's pot | **ACCEPTED** | R5: two named units, `weeklySeasonAllocation` vs `perWeekPrizePot`; only the latter prices an award |
| 8 | Medium | `setPayoutSettled` needs supersession + concurrency rules; profile recompute is not a safeguard | **ACCEPTED** | D4: transaction over both docs, refuse superseded, transition-only events, no recompute |
| 9 | Low | D0's step-order premise was backwards (rules precede fee); import-only invariant proves nothing about persistence | **ACCEPTED** | D0 corrected; interaction test added |

9/9 accepted. Round 2 requested.

## Round 2 — codex (3 findings) — VERDICT: REVISE

Codex confirmed round 1's nine changes landed, then:

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | Critical | D2 bound WEEKLY's editor to `weeklyPayouts`, contradicting D1's matrix | **ACCEPTED — a plain contradiction** | D2: WEEKLY and SEASON bind to `settings.payouts`; only HYBRID's weekly editor binds `weeklyPayouts` |
| 2 | Critical | A rescore can invalidate a recorded weekly award; deterministic create-if-absent then blocks the correction | **ACCEPTED — the best finding of the round** | D4 rescore policy + K12: recap wins, ledger shows STALE, click re-records by supersession (`~k` suffix), one live record per (entry, week, place) |
| 3 | High | `recordPoolPayouts` admits co-managers, `setPaidStatus`'s gate does not — record vs settle would diverge | **ACCEPTED** | D4: one authorizer for both (`assertPoolOwnerOrSuperAdmin` + ban check); the co-commissioner question is answered once, in that plan |

3/3 accepted. Round 3 requested.

## Round 3 — codex (4 findings) — VERDICT: REVISE

| # | Sev | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1 | High | HYBRID → other mode transitions undefined; merge-write strands `weeklyPayouts` | **ACCEPTED** | D1: `FieldValue.delete()` on leaving HYBRID (the `hybridSplit` pattern), notice on HYBRID→WEEKLY, tests both ways |
| 2 | High | `weeklyPayouts` not in the SUPER_ADMIN direct-write firewall | **ACCEPTED** | D1: joins `callableOnlySettingsUnchanged()`; SA rules test |
| 3 | Medium | "One authorizer" named two different gates | **ACCEPTED** | D4: `assertPayoutAuthority` shared helper; `setPaidStatus` equivalence withdrawn |
| 4 | Medium | Concurrent re-record not idempotent | **ACCEPTED** | D4: re-record carries `staleAwardId`; already-superseded → return current live award, write nothing |

4/4 accepted.

### Resolution — STOPPED AT ROUND 3 (16 findings, 16 accepted, 0 rejected), NOT APPROVED

Trajectory 9 → 3 → 4. Round 3's items are all inside D1/D4 and are absorbed;
nothing new touched the money invariant or the D3 "displayed until recorded"
rule after round 1. **Claude's position:** the plan is ready for Kevin's §6
sign-off *contingent on* `PLAN-WEEKLY-PRIZES.md` being signed first (K1) —
that dependency, not review convergence, is the real gate. Codex rounds are
paid; the remaining surface is implementation contracts a ticket will settle
and an implementer will re-review on code. Handed to Kevin without faking
convergence.
