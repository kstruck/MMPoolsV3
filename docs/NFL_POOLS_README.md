# NFL Pools — Internal Product & Developer Guide

This document outlines the business logic, product rules, and technical implementation details for the NFL Pool types in the March Melee Pools platform.

---

## 1. Pool Types Overview

The platform supports three distinct NFL pool types, all leveraging the same ESPN scheduling and scoring integration:

1. **Weekly Pick'em:** Pick the winner of every game each week. Supports standard scoring (1 pt/win) or Confidence assigned scoring.
2. **Survivor:** Pick one winner per week. By default, if the team loses or ties you take a strike, and you cannot pick the same team twice in a season — both are commissioner settings (`tieCountsAs`, `maxTeamUses`; see Survivor Settings). Once strikes equal the limit, you are eliminated (unless rebuys are active).
3. **Margin:** Pick one team per week. Your score is their margin of victory. If they lose, the negative margin counts against you.

---

## 2. Business Rules & Admin Options

### Pick'em Settings

- **Confidence Mode:** Boolean. If true, players rank games 1 to N (N = number of games). Completeness is required (all games must be ranked uniquely).
- **Lock Deadlines:**
  - *Per-Game Lock:* Each game locks exactly at its scheduled kickoff time (plus buffer).
  - *Weekly Lock:* Every game in the week locks when the **first** game of the week kicks off. This is **forced** if Confidence Mode is enabled.
- **Grace Period (Lock Buffer):** Configurable buffer (e.g., 5 mins) to allow picks slightly after the official kickoff time to account for broadcast delays.

### Survivor Settings

- **Max Strikes:** Integer. Set to `0` for true sudden death. Set to `> 0` to allow "mulligans".
- **Pick-Loser Mode:** Boolean. If true, the logic is inverted: picking a loser = survive. Picking a winner = strike.
- **Tie Outcome (`tieCountsAs`):** `'LOSS'` (default, and what every pool created before this setting existed does) or `'WIN'`. At the default a tied game is a strike in BOTH modes. At `'WIN'` the tie grades as the picked team WINNING, which composes with the mode: survive in standard, strike in pick-loser.
- **Team-Use Limit (`maxTeamUses`):** Integer, default `1` — one use per team per season, today's rule. `N >= 2` allows a team in up to N distinct weeks; `0` means unlimited.
  Both settings are absent from existing pool docs and default at every read site, so no migration was needed. Both are also refused by `updatePoolSettings` once the pool has published a scored week: the engine recomputes past weeks with CURRENT settings, so changing either would rewrite results members have already seen.
- **Max Buy-Backs (Rebuys):** Default `0`. Number of times an eliminated player can pay to re-enter.
- **Buy-Back Deadline:** The final week rebuys are permitted (e.g., Week 4).
- **Buy-Back Cost:** Dollar amount added to the pot for re-entering.

### Margin Settings

- Lock mode is strictly **Weekly Lock** (locks at the first game of the week).

---

## 3. Scoring Logic & Computation

### Pick'em

- `Score = sum(points_earned_per_correct_pick)`
- **Standard:** 1 point per correct pick.
- **Confidence:** `X` points per correct pick, where `X` is the unique value [1..16] assigned by the player. Incorrect picks earn 0. Cancelled games earn 0.

### Survivor

- A "Strike" is logged if:
  - The picked team loses (in standard mode), or wins (in pick-loser mode).
  - The picked team TIES — in both modes, unless `tieCountsAs` is `'WIN'`, in which case the tie grades as that team winning (survive in standard mode, strike in pick-loser mode).
  - The user **forgets to submit a pick** before the week locks (Auto-Strike).
- **State Machine:**
  - `ALIVE`: `strikes < maxStrikes + 1`
  - `ELIMINATED`: `strikes >= maxStrikes + 1` (Note: if `maxStrikes = 0`, 1 strike = `ELIMINATED`).
- **Auto-Survive Exemption:** If a player is alive but has no eligible teams left to pick (e.g., all remaining valid teams are on bye), they automatically survive the week without using a pick. "Eligible" respects `maxTeamUses`, so under an unlimited limit the exemption can never fire — a week nobody could play is handled by the void-week rule instead. Eligibility counts uses in weeks **strictly before** the week being scored (PLAN-SURVIVOR-EXEMPTION-RESERVATIONS): a pick pre-submitted for a *later* week is not yet a use, so future-week reservations cannot exhaust a slate and excuse a missed pick. The submit/proxy reuse **guards** deliberately still count every other week including future reservations — "may I pick this team now?" and "had this member run out of options by the scored week?" are different questions with different answers.
- **Rebuy State:** If eligible and within deadline, `strikesUsed` resets to 0, `rebuysUsed` increments. Importantly, **previously used teams are retained** — a rebuy does not refund team uses, whatever `maxTeamUses` is.

### Margin

- Score is the exact final score differential (including Overtime).
- Example: Choose Chiefs. Chiefs win 24-20. Score = +4.
- Example: Choose Chiefs. Chiefs lose 21-24. Score = -3.
- **Burden:** The absolute value of all negative scores is tracked as "Negative Burden".

---

## 4. Tiebreaker Logic (Margin Pool)

Because Margin pools often result in similar total scores, a strict 5-level cascade is computed at the end of the season to determine the final rank:

1. **Highest Total Points:** Sum of all weekly margins.
2. **Lowest Negative Burden:** Sum of the absolute values of all losing weeks. (e.g., A player who lost by -3 beats a player who lost by -14).
3. **Most Positive Weeks:** Total number of weeks the player scored > 0.
4. **Highest Single-Week Score:** The single best week margin in the season.
5. **Coin Flip (Random):** Assigned if all metrics above are identical.

---

## 5. Critical Edge Cases Handled

1. **Schedule Flexing:** The `syncNFLScores` job continuously updates the `startTime` of games. If a game is flexed to later in the day, the lock time automatically pushes back. If flexed to earlier, the lock time pulls forward.
2. **Bye Weeks in Confidence Mode:** In a 13-game week, confidence values range from 4 to 16. Values 1, 2, and 3 are invalid to maintain parity with 16-game weeks across the season scoring.
3. **Cancelled Games:** If a game is cancelled post-lock in Confidence mode, the points assigned to that game are lost (score=0). They are not re-assigned.
4. **End of Week Auto-Strikes:** Survivor auto-strikes are applied by the scoring engine **only after the final game of the NFL week (MNF) concludes**. Applying them earlier would prematurely eliminate players who might want to pay for a rebuy before the next week starts.
5. **The weekly tiebreaker target (PLAN-WEEKLY-TIEBREAKERS, PLAN-WEEKLY-PRIZES B1):** the pool's `settings.weeklyTiebreaker` decides which game(s) the closest-to-the-pin prediction is measured against — `MNF_LAST_GAME` (the LAST Monday game to kick off; the default for new pools), `MNF_FIRST_GAME` (the FIRST Monday game to kick off), `NONE` (no tiebreaker; ties are shared), or the legacy `MNF_COMBINED` (every Monday game summed — what an absent value still resolves to, so no existing pool's week moves; no longer offered to a commissioner). On a week with **no Monday game**, `MNF_LAST_GAME`/`MNF_FIRST_GAME` use the final game of the week; legacy `MNF_COMBINED` has no target and ties are shared. **The target is frozen per pool-week** on the week's first submission (`pool.frozenTiebreakTargets[week]`, a game-id list, server-only) — a flex, a postponement or an `isMonday` change after members have submitted does not re-point their prediction, and a client whose sheet showed a different target is refused (`TIEBREAK_TARGET_STALE`) until it reloads. A frozen game that is later cancelled has no score to compare against, so the tie is shared. One resolver, `shared/nflTiebreaker.ts` `resolveTiebreakTargetIds`, is used by the pick sheet, the submit path and the scorer.
6. **A week where EVERY game was cancelled — no no-show penalty.** The Survivor
   auto-strike and the Margin −14 exist to punish not showing up *for a game*.
   When every game of the week is `CANCELLED` there was no legal pick to make, so
   a member who never submitted is **not** struck and **not** charged −14; the
   Margin week nets 0, which is what a member who *did* pick a cancelled game
   already receives. This is a property of the slate, not a pool setting — it
   applies even when `autoSurviveExemptionEnabled` is turned off. It is only
   reachable on a one-game week (the Hall of Fame opener); any other week leaves
   other teams to pick.
7. **A `FINAL` game the feed reported no scores for is NOT scored.** ESPN
   occasionally returns a game as final with no score payload at all. The importer
   deliberately stores no `scores` field in that case, and the scorer treats such
   a game as **not concluded**: nothing is graded, the week does not complete, no
   recap is written and the season is not finalized. Waiting is the intended
   outcome — grading it would publish a fabricated 0-0, which reads as a PUSH for
   every Pick'em entry and as a TIE for Survivor, and a tie is a strike by default. The game
   is marked so its slate keeps being re-fetched, and the condition is reported as
   a DEGRADED score-sync heartbeat until the feed delivers.
8. **What the weekly recap holds, per pool type.** A `weekly_recaps/week_N`
   document is written **only by a COMPLETE (non-provisional) pass**, so it never
   appears mid-week, and it carries only the fields that apply:

   | pool type | recap contents |
   |---|---|
   | Pick'em | `sharpOfWeek` — the highest weekly POINT total; plus `closestTiebreaker` when the MNF tiebreaker resolved |
   | Margin | `sharpOfWeek` — the largest MARGIN OF VICTORY, among entries that actually submitted |
   | Survivor | `attritionCount` — how many entries are still alive |
   | Pick'em + Margin | `weeklyWinners` (the tie-broken rank-1 group), and — PLAN-WEEKLY-PRIZES — **`weeklyPlaces`**: EVERY scored entry, competition-ranked (1,1,3), keyed by `entryId` with `userId`/`userName`/`entryName?`, `points`, `tiebreakDiff?`, and `prize` (whole dollars) on paid ranks of a priced week; **`weeklyPrize`**: the FROZEN `{pot, places, entryCount, weeksInSeason, payoutMode, frozenAt}` the prizes came from — written at first publication and re-read verbatim on every rescore (a rescore re-ranks players against a pot that does not move), or `null` = published UNPRICED (SEASON mode / no pot; never re-priced later); **`weeklyPlacesError`**: publication failed CLOSED (e.g. `PRIZE_SPLIT_DUPLICATE_RANK`) — the week still scores. `weeklyPlaces` ABSENT means "not published" (older recap, void week), never "nobody placed". A pool with no `weeksInSeason` gets it written once, on its first priced publication. |

   `sharpOfWeek.score` therefore means different things in different pool types
   — points in Pick'em, a signed margin in Margin — and the client formats it
   per type (`src/utils/recapHighlight.ts`). A Margin **no-show scores −14**,
   which is a larger number than any loss by more than two touchdowns, so
   non-submitters are excluded from the sharp calculation entirely; otherwise a
   week everybody forgot would crown the least-punished absentee. A recap with
   none of these fields is legitimate — a Margin week nobody entered — and the
   card says so rather than rendering empty.

---

## 6. Pre-Season Testing Protocol

To ensure all logic works perfectly before week 1:

1. SuperAdmins can create test pools by setting `seasonType=1` (Preseason) during pool configuration.
2. The entire app (wizards, dashboards, scoring engine) treats this as a valid 4-week season.
3. Use the generated invite links to onboard test users, select games, and trigger live scoring events as preseason games conclude.
