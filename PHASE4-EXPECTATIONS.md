# PHASE4-EXPECTATIONS — human-verification sheet for the Phase 4 edge/matrix fixtures

**Kevin: this is the oracle-honesty gate (PLAN-NFL-SIM-HARNESS, plan risk #2).**
Every expected value below was hand-computed by Claude from the documented product
rules (docs/NFL_POOLS_README.md) — NOT copied from engine output. Your job is to
spot-check the arithmetic: read each block, confirm the expected numbers follow
from the stated scores/spreads/rules. Tick the checkbox when a block looks right.
If ANY number looks wrong, the fixture is wrong (or the rules doc is) — flag it,
do not merge until resolved.

Scoring rules used throughout (from docs/NFL_POOLS_README.md + engine contract):

- **Pick'em STRAIGHT:** 1 pt per correctly picked winner. Tie = PUSH (0 pts, not a loss).
- **Pick'em ATS:** home covers when `homeScore + spread > awayScore` (spread negative =
  home favored). Exactly equal = PUSH (0). Confidence mode replaces the 1 pt with the
  entry's per-game confidence value.
- **Pick'em:** unpicked games are absent (0 pts, not counted in "total picked");
  CANCELLED + picked = VOID (0 pts, counted in total picked, not in correct).
- **Survivor (standard):** pick must WIN; lose **or tie** = strike; missed pick = strike;
  strikes > maxStrikes ⇒ ELIMINATED that week. CANCELLED = survive (VOID).
- **Survivor (pick-losers):** pick must LOSE; win **or tie** = strike.
- **Survivor auto-survive:** if enabled and every team playing this week is already in
  the entry's usedTeams ⇒ exempt (no pick needed, no strike).
- **Margin:** weekly score = picked team's signed victory margin; tie = 0;
  CANCELLED = 0; missed week = **-14**. Season rank cascade: total ↓, negative burden ↑
  (lower wins), positive weeks ↓, best week ↓, uid.
- **MNF tiebreaker:** closest to the COMBINED total of ALL Monday games (both games on
  dual-MNF weeks); resolves only when every Monday game is FINAL.
- **payoutMode (SEASON/WEEKLY/HYBRID):** commissioner display copy only — verified by
  grep to never reach the scoring engine. Matrix cells assert scoring is IDENTICAL
  across all three values.

---

## A. Pick'em combination cells (11 generated fixtures, one shared layout)

Games (same in all 11):

| wk | key | matchup | score | spread (home) | straight winner | ATS result |
|---|---|---|---|---|---|---|
| 1 | g1 | KC v BUF | 27-24 | -3 | KC | **PUSH** (27-3 = 24) |
| 1 | g2 | SF v DAL | 30-10 | -7 | SF | SF covers (23 > 10) |
| 1 | g3 (MNF) | DET v GB | 20-17 | +2 | DET | DET covers (22 > 17); MNF total **37** |
| 2 | g1 | BAL v CIN | 21-28 | -6 | CIN | CIN covers (15 < 28) |
| 2 | g2 (MNF) | PHI v MIA | 31-14 | -10 | PHI | PHI covers (21 > 14); MNF total **45** |

Picks / confidence (confidence in parentheses; valid unique ranges [14..16] wk1, [15..16] wk2):

| entry | wk1 | wk2 | tiebreakers |
|---|---|---|---|
| Alice | KC(16) SF(15) DET(14) | CIN(16) PHI(15) | 38, **45** |
| Bob | KC(14) SF(15) GB(16) | BAL(15) PHI(16) | 30, 40 |
| Carol | BUF(15) DAL(16) GB(14) | BAL(16) MIA(15) | **37**, 20 |

Expected (verify each cell):

| set | Alice w1 / w2 / total | Bob w1 / w2 / total | Carol total |
|---|---|---|---|
| STRAIGHT | 3 / 2 / **5** | 2 / 1 / **3** | **0** |
| STRAIGHT+CONF | 45 (16+15+14) / 31 (16+15) / **76** | 29 (14+15) / 16 / **45** | **0** |
| ATS | 2 (PUSH+W+W) / 2 / **4** | 1 (PUSH+W+L) / 1 / **2** | **0** |
| ATS+CONF | 29 (0+15+14) / 31 (16+15) / **60** | 15 (0+15+0) / 16 / **31** | **0** |

ATS notes: wk1 g1 is a PUSH for every entry (either side). Carol's wk1 g1 pick (BUF)
also grades PUSH — pushes are side-independent — and every other Carol pick loses.

Recap tiebreakers (all 11 cells): wk1 closest = **Carol** (37 exact); wk2 closest = **Alice** (45 exact).

- [ ] A verified

## B. Pick'em edges

1. **ats-push** — KC -3 wins 20-17: 17+(-3+20)=… KC 20-17, spread -3 ⇒ 20-3 = 17 = 17 ⇒ PUSH both sides. SF -7 wins 28-20 ⇒ 21 > 20 ⇒ SF covers. Alice(KC,SF)=1; Bob(BUF,DAL)=0. Standings row: correct 1 / total 2.
2. **tie-push** — KC 21-21 tie ⇒ PUSH both sides. Alice(KC,SF)=1, Bob(BUF,DAL)=0.
3. **missed-picks** — Alice full slate = 3. Bob picks g1 only (KC, correct) = 1 with total-picked 1. Carol no picks = 0 with correct 0 / total 0. Tiebreaker: MNF 20+17=37, Alice 37 exact.
4. **tiebreaker-week** — both entries 2/2; MNF total 37; Bob 36 (diff 1) beats Alice 35 (diff 2).
5. **dual-mnf** — TWO Monday games: totals 37 + 49 = **86**. Alice 86 exact; Bob 49 is 37 off. Alice 3 pts, Bob 0.
6. **cancelled-void** — g2 CANCELLED: VOID for both. Alice = 1 (KC) with correct 1/total 2; Bob = 0.
7. **preseason** — seasonType=1 plumbing; Alice 2, Bob 0.
8. **lock-pergame** (REAL submit path) — pick on future game accepted; NEW pick on kicked-off game rejected `GAME_LOCKED`. Final: alice = 1 (KC won; SF pick never landed). Real-path userNames are lowercase run-uid suffixes by design.
9. **lock-weekly** (REAL) — WEEKLY mode locks the whole week at FIRST kickoff. Pre-lock submit of KC+SF lands; post-kickoff change to DAL rejected `WEEK_LOCKED`; alice = 2.

- [ ] B verified

## C. Survivor

Standard-mode weekly results used below — wk1: KC beat BUF, SF beat DAL. wk2: CIN beat BAL, DET beat GB. wk3: PHI beat MIA, SEA beat PIT.

1. **strikes2** (maxStrikes 2) — Alice picks BUF(L), BAL(L), PHI(W) ⇒ 2 strikes, ALIVE. Bob picks DAL(L), BAL(L), MIA(L) ⇒ 3rd strike wk3 ⇒ ELIMINATED wk3, strikeWeeks [1,2,3]. Carol KC, CIN, SEA all W ⇒ 0.
2. **picklosers** (sudden death) — Alice BUF (lost ⇒ survive); Bob KC (won ⇒ strike ⇒ ELIMINATED wk1).
3. **picklosers-strikes2** — Alice: BUF(survive), CIN won(strike 1), SEA won(strike 2) ⇒ ALIVE on 2. Bob: KC, CIN, PHI all won ⇒ 3 strikes ⇒ ELIMINATED wk3. Carol: BUF, BAL, MIA all lost ⇒ 0.
4. **autosurvive** — Alice usedTeams = all 4 teams playing ⇒ EXEMPT (ALIVE, 0 strikes, exemptWeeks [1]) despite no pick. Bob picks SF normally.
5. **autosurvive-off** — same setup, exemption disabled ⇒ Alice's missing pick = auto-strike ⇒ ELIMINATED wk1.
6. **tie-strike** — KC 21-21: tie = strike (docs §2 "loses/ties") ⇒ Alice ELIMINATED wk1. **NOTE: this fixture exposed a Scenario Oracle bug** — the oracle's original "ties survive" rule contradicted the product doc; fixed in shared/simOracle.ts this PR. Confirm the DOC is the rule you want (tie = strike).
7. **missed-pick** — Bob submits nothing ⇒ auto-strike ⇒ ELIMINATED wk1.
8. **all-eliminated** — both entries pick losers ⇒ both ELIMINATED wk1; recap still generates.
9. **duplicate-team** (REAL) — re-picking KC in wk2 rejected `TEAM_ALREADY_USED`; SF accepted; alice survives (KC won wk1; SF beat KC wk2).
10. **rebuy** (REAL) — carol picks BUF, KC wins ⇒ ELIMINATED; simExecuteRebuy wk2 ⇒ ALIVE, strikes 0, rebuysUsed 1.
11. **rebuy-limits** (REAL) — deadline wk2, maxRebuys 1. Elim wk1 ⇒ rebuy wk3 rejected `PAST_DEADLINE`; rebuy wk2 OK. Weeks ≤ lastRebuyWeek(2) are absorbed on rescore, so his DAL wk2 loss does NOT re-strike; MIA wk3 loss eliminates wk3. Second rebuy rejected `MAX_REBUYS_EXCEEDED`.
12. **last-man** (finalize arc) — Alice ALIVE both weeks; Bob out wk1; Carol out wk2. Final ranks: Alice 1 (champion), Carol 2 (lasted longer), Bob 3. Payout $50 place 1 recorded for Alice via the REAL recordPoolPayouts.
13. **cancelled-void** — Alice's KC game CANCELLED ⇒ survive, grade VOID. Bob's DAL lost the real game ⇒ ELIMINATED.

- [ ] C verified

## D. Margin

1. **weekly / hybrid** (2 cells) — Alice: KC +3, CIN +7 ⇒ **10**. Bob: DAL −20, BAL −7 ⇒ **−27** (burden 27, positive 0, best −7). Alice rank 1. Identical numbers in both cells (payoutMode inert).
2. **tie-zero** — KC 21-21 ⇒ Alice 0 (no burden, not a positive week). Bob SF +20 ⇒ rank 1.
3. **missed-pick** — Bob: +20 then missed wk2 ⇒ 20 − 14 = **6** (burden 14, positive 1, best 20). Alice 10 ⇒ rank 1.
4. **season-tiebreak** — Alice: SEA +10, GB −4 ⇒ 6 (burden 4). Bob: KC +3, PHI +3 ⇒ 6 (burden 0). Equal totals ⇒ cascade level 2: Bob rank 1.

- [ ] D verified

## E. Buy-flow (item 15 — stamps only, never the paid path)

1. **free-launch** — plain create via REAL createNFLPool ⇒ `billing.status = 'free'`, no `billing.paid`.
2. **free-cap** — creator + 9 joins = 10 participants; the 10th joiner (11th participant) rejected with the "Free Plan … limit of 10" message via the REAL join flow.
3. **trial-stamp** — create payload carries `aiCommissioner: true` (a PAID_ADDON_KEY) ⇒ server stamps `billing.status = 'trial'`; still no `billing.paid`.

- [ ] E verified

---

## Known findings surfaced while authoring (for the morning report)

1. **Scenario Oracle survivor-tie bug (fixed this PR):** `shared/simOracle.ts` treated
   ties as survive; docs/NFL_POOLS_README.md §2/§30 and the engine both say tie = strike.
   Oracle fixed to the documented rule. Decision to confirm: the doc IS the intended rule.
2. **`settingsMatrix.emulator.test.ts` uses a wrong settings key:** it sets
   `autoSurviveExemption: false`, but the engine reads `autoSurviveExemptionEnabled`
   (default **true**). Inert in those generated cells (no entry ever exhausts teams),
   but the key is corrected nowhere else — the new fixtures use the REAL key. Left the
   old test untouched (behavior unchanged); flagged for a trivial follow-up.
3. **payoutMode is display-only.** No engine/finalize branch reads it (grep-verified).
   The WEEKLY/HYBRID matrix cells therefore assert scoring invariance — that is the
   honest, complete coverage of what the setting does today.
