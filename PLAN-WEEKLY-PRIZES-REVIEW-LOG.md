# PLAN-WEEKLY-PRIZES — adversarial review log

Act 1 (grill-with-docs) ran overnight 2026-08-14 **without Kevin**; its questions
are the plan's §6 D1–D8, each with a recommendation, and Kevin signed "all
recommendations" on 2026-08-15. Act 2 was codex (`codex exec -s read-only`,
read-only, fresh session per round) — **nine rounds ran on 2026-08-14 while the
plan was drafted**, and every absorbed finding is cited inline in the plan body
as `(codex P1/P2, plan review rN)`. **The raw round transcripts were not saved by
that session** — this log is reconstructed 2026-08-16 from those citations,
round by round, so that the record is in the file the gate names
(`mmp-change-control`: plan → review log → sweeps → code). Round 10 below is a
live round run today against the signed plan on `origin/main` @ `42906ecc`, and
its transcript IS quoted in substance.

## Rounds 1–9 (2026-08-14) — reconstructed — 14 findings absorbed, 1 rejected

| Round | Sev | Finding (as cited in the plan) | Verdict | Where it landed |
|---|---|---|---|---|
| r1 | P1 | The tiebreak target is resolved from the CURRENT schedule at scoring time; a flex move / postponement / `isMonday` change silently re-points an already-submitted prediction — the §0 defect arriving through the schedule | **ABSORBED** | §2b(3): freeze the resolved target on EVERY week, `frozenHardLockFor`-style |
| r1 | P1 | "Fall back to deriving `weeksInSeason`" leaves the divisor floating for every existing pool (all lack the field) — the fallback is the common path | **ABSORBED** | §3b D5: freeze at creation; absent → derive ONCE and PERSIST in the first-publish transaction (Rule-1 gated) |
| r1 | P2 | `poolSeasonWeeks` (`src/utils/nflPending.ts`) did not exist on `main` yet (#427 unmerged) — the plan leaned on a helper an implementer would not find | **ABSORBED** | §3b "DEPENDENCY, not an existing fact"; sweeps S7 confirms #427 is now merged and the server still has no equivalent |
| r1 | P2 | `hybridSplit` exists ONLY on `payoutMode: HYBRID`; a single hybrid formula leaves WEEKLY pools with no computable prize | **ABSORBED** | §3b per-mode pot table (HYBRID / WEEKLY / SEASON) |
| r2 | P2 | §0 claimed "nothing writes to an existing pool document", but §3b's freeze-on-first-publish writes `weeksInSeason` to an existing pool — a prod-data write hidden behind a blanket assurance | **ABSORBED** | §0 and §5 now name the one production write and its kill-switch + dry-run gate |
| r3 | P1 | Skipping `negativeBurden` in the Margin season-tie cascade would award the season prize to a different player than `NFLStandings.tsx` shows leading | **ABSORBED** | §2c: full cascade in standings order; D4 |
| r3 | P1 | N ≠ `payouts.places.length` — ranks are sparse and unordered (`payoutPlaceSchema`), `[{rank:1},{rank:3}]` has length 2 and would omit third place | **ABSORBED** | §3a: depth = `max(places[].rank)`, ranking runs past it |
| r3 | P2 | The helper signature invented a `place` key; the persisted shape is `{rank, percentage}` — an implementer passing `pool.payouts.places` would read `undefined` for every rank | **ABSORBED** | §4b: `rank`, taken verbatim, no normalization |
| r4 | P1 | Freezing a SINGLE game id makes a legacy `MNF_COMBINED` prediction score one game after the freeze — silently changing the rule for exactly the pools §0 protects | **ABSORBED** | §2b: frozen value is `string[]`; the scorer sums the list |
| r5 | P2 | Freezing per ENTRY gives two members different targets for the same week after a schedule change; their `tiebreakDiff`s become incomparable in a cascade that decides money | **ABSORBED** | §2b: one `pool.frozenTiebreakTargets.<week>` per pool-week, set atomically on first submission |
| r5 | P2 | "Running past the last paid rank" was worded as if overflowing players miss out — contradicting §4 | **ABSORBED** | §3a worked example: three tied at 2 in a pay-to-3 pool split ranks 2+3 three ways |
| r7 | P2 | The FIRST submitter's sheet was rendered before the freeze; a schedule update between render and submit freezes a value they were never shown | **ABSORBED** | §2b: submit carries the displayed target; server stores it if nothing frozen, else rejects on mismatch and asks for a reload |
| r7 | P1 | `weeksInSeason` frozen but `entries` live on a rescore — the pot moves after publication | **ABSORBED** (superseded by r9) | §3b-i |
| r8 | P1 | Weekly pot computed GROSS overstates every prize on a charity pool and awards money promised to the charity; `PayoutsPanel.tsx` takes charity off first with `Math.floor` | **ABSORBED** | §3b: `charityFactor`, match the panel exactly including floor |
| r8 | P2 | `payoutPlaceSchema` allows duplicate ranks; the helper would have two answers for rank 1 | **ABSORBED** | §4b: uniqueness enforced at create AND update; helper THROWS on duplicates |
| r9 | P1 | Generalisation of r7: `entryFee`, `hybridSplit`, charity settings, `payouts.places` are ALL editable while OPEN and all re-price a published week on rescore; freezing inputs one at a time is a losing game | **ABSORBED — closes the class** | §3b-i: freeze the OUTPUT (pot, places snapshot, entry count, weeksInSeason) at first publication |
| r6/r8 (unnumbered in plan) | P2 | `weeklyPerEntry × entries ÷ weeksInSeason` understates every weekly prize — the product is already one week's pot | **REJECTED** | §3b-i: `PayoutsPanel.tsx:334` labels that figure "weekly total" and its tooltip says "weekly prize **pots**" (plural) — it is the season-long weekly allocation; one week's pot is that ÷ weeks. Recorded because it will be re-raised. |

Round 6 is not cited in the plan body; the reconstruction cannot say whether it
was clean or its findings were folded into a later round's wording. Treated as
"no surviving finding of its own".

## Round 10 — codex, live, 2026-08-16 (`origin/main` @ `42906ecc`) — 10 findings — VERDICT: REVISE

Prompted with the signed plan, the sweeps, the ledger plan, and the fact that
#427–#450 (multi-entry T1/T2, co-commissioners, empty-submission fee) merged
after rounds 1–9. Findings in substance:

| # | Finding | Verdict | Where it landed |
|---|---|---|---|
| 1 | `weeklyPlaces` still user-keyed; candidates emit `ownerUid`; two entries by one owner merge/misidentify awards | **ABSORBED** | §9 A1 (`entryId` on candidates, places, recap types, split, payout binding); sweeps S10 |
| 2 | Plan never specifies ranking every paid place — `computeWeeklyWinners` resolves only the top group | **ABSORBED** | §9 A2 `rankWeeklyPlaces` (full ranking, missing prediction ranks below any prediction, residual ties share) |
| 3 | "entries" is ambiguous and now wrong — `pool.entryCount` is server-maintained and counts liable entries | **ABSORBED** | §9 A3: `pool.entryCount` (derived in-tx when absent), frozen with the pot |
| 4 | Frozen-target handshake not implementable from the current callable contract (strict schema, payload type, `dbService`, sim callers lack the field) | **ABSORBED** | §9 A6 (`displayedTiebreakTargetIds`), sweeps S11 enumerates every path |
| 5 | The handshake trusts a client-provided target — a first submitter could freeze a favourable list | **ABSORBED — the best finding of the round** | §9 A6: server recomputes the canonical target IN the transaction and requires equality; client list never becomes the frozen value on its own |
| 6 | HYBRID snapshot freezes `payouts.places` while the ledger introduces `weeklyPayouts` for HYBRID weekly awards | **ABSORBED** | §9 A4: snapshot `weeklyPayouts ?? payouts`, one selector in `shared/prizePot.ts` |
| 7 | Scorer throwing on legacy duplicate ranks is unsafe in deployment order — census/validation land later | **ABSORBED** | §9 A5: publication fails closed (`weeklyPlacesError`), scoring unaffected |
| 8 | Empty / zero-percent payout lists make `max(places[].rank)` undefined | **ABSORBED** | §9 A2: publish the FULL ranking; prize only for paid ranks; no depth to compute |
| 9 | Sweeps S6 incomplete for the post-T2 identity model | **ABSORBED** | S10 with a known multi-entry fixture |
| 10 | Sweeps S2 omits the callable-client contract and proxy/sim submit paths | **ABSORBED** | S11 |

10/10 absorbed. **This is round 10 — the §2c ceiling.** An eleventh round to
verify §9 is Kevin's call (CLAUDE.md §2c: past 10, ask first, say why): the
reason it might be worth it is that §9 is new text no reviewer has read; the
reason it might not is that every §9 row is a tightening of a signed decision,
and the code PRs each get their own codex rounds against the same plan.
