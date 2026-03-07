# NFL Pools — Internal Product & Developer Guide

This document outlines the business logic, product rules, and technical implementation details for the NFL Pool types in the March Melee Pools platform.

---

## 1. Pool Types Overview

The platform supports three distinct NFL pool types, all leveraging the same ESPN scheduling and scoring integration:

1. **Weekly Pick'em:** Pick the winner of every game each week. Supports standard scoring (1 pt/win) or Confidence assigned scoring.
2. **Survivor:** Pick one winner per week. If the team loses/ties, you take a strike. Once strikes equal the limit, you are eliminated (unless rebuys are active). You cannot pick the same team twice in a season.
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
- **Pick-Loser Mode:** Boolean. If true, the logic is inverted: picking a loser = survive. Picking a winner/tie = strike.
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
  - The picked team loses or ties (in standard mode).
  - The picked team wins or ties (in pick-loser mode).
  - The user **forgets to submit a pick** before the week locks (Auto-Strike).
- **State Machine:**
  - `ALIVE`: `strikes < maxStrikes + 1`
  - `ELIMINATED`: `strikes >= maxStrikes + 1` (Note: if `maxStrikes = 0`, 1 strike = `ELIMINATED`).
- **Auto-Survive Exemption:** If a player is alive but has no eligible teams left to pick (e.g., all remaining valid teams are on bye), they automatically survive the week without using a pick.
- **Rebuy State:** If eligible and within deadline, `strikesUsed` resets to 0, `rebuysUsed` increments. Importantly, **previously used teams remain locked** and cannot be picked again.

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
5. **Two Monday Night Football Games:** For closest-to-the-pin MNF tiebreakers, when there are two MNF games, the total score of **both** games combined is used as the target.

---

## 6. Pre-Season Testing Protocol

To ensure all logic works perfectly before week 1:

1. SuperAdmins can create test pools by setting `seasonType=1` (Preseason) during pool configuration.
2. The entire app (wizards, dashboards, scoring engine) treats this as a valid 4-week season.
3. Use the generated invite links to onboard test users, select games, and trigger live scoring events as preseason games conclude.
