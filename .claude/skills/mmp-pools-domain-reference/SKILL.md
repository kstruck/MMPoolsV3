---
name: mmp-pools-domain-reference
description: "Domain math and rules reference for every pool format in March Melee Pools / Gridiron Gamble. Use when you need to understand or verify HOW a pool scores, ranks, ties, locks, or pays out — bracket scoring systems (Classic/ESPN/Fibonacci/Custom), upset bonus math, maxPossibleScore/isTeamAlive, bracket tiebreakers (closest absolute / closest under), NFL Pick'em standard vs confidence values, Survivor strikes/mulligans/rebuys/auto-survive, Margin -14 penalty and 5-level tiebreaker cascade, Playoff Rank'Em multipliers, Squares axis numbers / 4-Sets / reverse winners / charity, Props seed catalog, ESPN data contracts (curatedRank seed, midwest-before-west region parse, seasonType 1/2/3). Load this when a user or ticket mentions: wrong score, wrong rank, tiebreaker dispute, upset bonus, max possible points, strike, eliminated, rebuy, confidence points, margin of victory, axis numbers, quarter winners, payout split, prop grading, seed import."
---

# MMP Pools Domain Reference

This is a REFERENCE, not a runbook. It explains the game math and lifecycle
semantics a zero-context session needs before touching any scoring code or
adjudicating a "my score is wrong" dispute. For operations (how to deploy,
import, trigger scoring) see `mmp-deploy-and-operate` and
`mmp-nfl-season-campaign`. Every claim below was verified against engine code
on 2026-07-06; file:line anchors are given so you can re-verify.

Repo root: `D:\march-melee-pools`. Server engines live in `functions/src/`;
client mirrors live in `src/`.

## When NOT to use this skill

| You need | Go to sibling skill |
|---|---|
| Deploy ritual, scheduled jobs, Coolify www deploy | `mmp-deploy-and-operate` |
| Getting NFL pools live-season ready (spread locking, weekly scoring ops) | `mmp-nfl-season-campaign` |
| Symptom → triage for a production failure | `mmp-debugging-playbook` |
| Why the architecture is shaped this way; invariants | `mmp-architecture-contract` |
| Change gating, the 4 discipline rules | `mmp-change-control` |
| Admin Test Suite / simulators / health checks | `mmp-diagnostics-and-tooling` |
| Test commands and evidence bar | `mmp-validation-and-qa` |

## Vocabulary (define once)

| Term | Meaning |
|---|---|
| Pool | Firestore doc in `pools/{poolId}`; `type` field is one of SQUARES, BRACKET, NFL_PICKEM, NFL_SURVIVOR, NFL_MARGIN, NFL_PLAYOFFS, PROPS |
| Entry | Per-participant doc in `pools/{poolId}/entries/{id}` (bracket allows multiple entries per user; NFL entries are keyed by uid) |
| Tournament | Doc in `tournaments/{id}`: `games` map, `slots` map, `importedTeams` map keyed by ESPN display name, `isFinalized`, `seasonYear` |
| Slot | Bracket position; entry picks are `picks[slotId] = teamId`; slot → `gameId` + `nextSlotId` wiring defines advancement |
| Team ID | Full ESPN display name, e.g. "Duke Blue Devils" (the old `E1-Duke` prefix format is deprecated; legacy regex kept only as fallback, `functions/src/bracketScoring.ts:37-43`) |
| Commissioner | Pool owner (legacy code role POOL_MANAGER); entry fees flow member→commissioner P2P, NEVER through the platform (Stripe is commissioner hosting fees only) |
| paidStatus | Bookkeeping flag on entries (PAID/UNPAID); informational, does not gate play — but it DOES gate the bracket pot calculation (see payouts) |

---

# 1. Bracket pools (NCAA + conference)

Server engine: `functions/src/bracketScoring.ts` (pure functions + callables).
Client mirror: `src/components/BracketPoolDashboard/bracketScoring.ts` — the
two MUST stay in sync.

## 1.1 Tournament formats

| Format | Teams | Rounds | Games | Byes | Init path |
|---|---|---|---|---|---|
| NCAA | 68 (64 main + 4 First Four) | 6 (+round 0) | 67 (4 FF + 63 main) | none | `initializeTournament` / `importTournamentFromESPN` (`functions/src/espnBracket.ts:146`) |
| Big East (2026) | 11 | 4 | 10 | seeds 1-5 skip R1 | `initializeBigEastTournamentHttp` (`functions/src/conferenceTournaments.ts:164`; teams at :24) |
| Big 12 (2026) | 16 | 5 | 15 | seeds 1-4 double bye (enter at QF/R3), seeds 5-8 single bye (enter R2) | `initializeBig12TournamentHttp` (`functions/src/conferenceTournaments.ts:352`; teams at :191) |

Notes:
- `docs/bracket-pool-architecture.md:21` says Big 12 = 14 teams. The 2026
  code says 16 (`BIG_12_TEAMS_2026`, comment "16 Big 12 teams for 2026 —
  ACTUAL seedings from ESPN"). Trust the code; conference field sizes change
  year to year. Never hardcode team counts or `maxRound = 6` — derive
  `maxRound` from tournament game data (the engine does:
  `bracketScoring.ts:202`).
- First Four games are `round: 0` (`espnBracket.ts:170-189`). Scoring uses
  `roundIndex = game.round - 1`; round 0 → index −1 → **First Four games can
  never award points** (`bracketScoring.ts:93-94, 170-171`). This is by
  design, not a bug.
- Bracket rounds are 1-indexed; a Big East final is round 4, NCAA final is
  round 6.

## 1.2 Scoring systems

Multiplier tables (`functions/src/bracketScoring.ts:10-14`; client mirror
`src/components/BracketPoolDashboard/bracketScoring.ts:11-12`), indexed by
`round - 1`:

| System | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|
| CLASSIC | 10 | 20 | 40 | 80 | 160 | 320 |
| ESPN | 10 | 20 | 40 | 80 | 160 | 320 |
| FIBONACCI | 10 | 20 | 30 | 50 | 80 | 130 |
| CUSTOM | `settings.customScoring[]` — array length must cover maxRound (4 for Big East, 5 for Big 12, 6 for NCAA) | | | | | |

- CLASSIC and ESPN are IDENTICAL tables in the engine. They exist as separate
  labels only.
- UI copy drift (display only, math is correct): the pool-edit dropdown in
  `src/components/BracketPoolDashboard/BracketPoolDashboard.tsx:1443-1445`
  labels Classic "1-2-4-8-16-32" and Fibonacci "2-3-5-8-13-21". The engine
  actually pays 10-20-40-80-160-320 and 10-20-30-50-80-130 (= Fibonacci
  1,2,3,5,8,13 × 10). Do not "fix" the engine to match the label.
- Score = for each pick whose game is FINAL and `winnerTeamId === pickedTeamId`,
  add `multipliers[round-1]` (`calculateEntryScore`, `bracketScoring.ts:139-188`).
  A pick on a slot is judged against the game that slot maps to — picking a
  team that wins a DIFFERENT slot earns nothing.

**Worked example (CLASSIC/ESPN):** entry got 20 R1 winners, 9 R2, 3 R3, 1 R4,
0 later: 20×10 + 9×20 + 3×40 + 1×80 = 200+180+120+80 = **580 points**.
Same picks under FIBONACCI: 20×10 + 9×20 + 3×30 + 1×50 = 200+180+90+50 =
**520 points**.

## 1.3 Upset bonus

`settings.upsetBonus = { enabled, multiplier }` (types comment says default
multiplier 5, `functions/src/types.ts:598-600`; the engine falls back to ×1 if
`multiplier` is missing, `bracketScoring.ts:82,155`).

Bonus fires when the pick is correct AND `winnerSeed > loserSeed`
(higher seed number beat lower seed number):

```
bonus = (winnerSeed − loserSeed) × upsetMultiplier
```

Seeds come from `tournament.importedTeams[displayName].seed`
(`getSeedForTeam`, `bracketScoring.ts:49-57`); legacy `E1-Duke` regex is a
deprecated fallback.

**Worked example:** upset bonus enabled, multiplier 5. You correctly picked
12-seed Tennessee State over 5-seed Iowa State in R1 (CLASSIC):
base 10 + (12−5)×5 = 10 + 35 = **45 points** for that one game. An 8-vs-9
game pays a small bonus too (9-seed winning = +5) — "upset" is purely seed
differential, there is no minimum gap.

## 1.4 maxPossibleScore and isTeamAlive

`calculateEntryMaxScore` (`bracketScoring.ts:62-135`) = current score PLUS
potential points from every non-FINAL picked slot **where the picked team is
still alive**:

- Eliminated set = every loser of a FINAL game (`getEliminatedTeams`,
  `bracketScoring.ts:19-31`). Client equivalent: `isTeamAlive(teamId)` = team
  has not lost any FINAL game
  (`src/components/BracketPoolDashboard/bracketScoring.ts:69`).
- Optimistic upset bonus on pending picks: if the slot's opponent is known and
  alive and `pickSeed > oppSeed`, add `(pickSeed − oppSeed) × mult`; if the
  opponent is not yet determined, assume the WORST-case opponent seed 1, i.e.
  add `(pickSeed − 1) × mult` (`bracketScoring.ts:116-128`). So
  maxPossibleScore is an upper bound, not an expectation.
- Invariant: `maxPossibleScore >= score` always (stress-tested per README).
  If you ever see max < score, the tournament games map is corrupt.

**Worked example:** CLASSIC, no upset bonus. Entry score 580; it still has its
champion pick (round 6, 320) and one Final Four pick (round 5, 160) alive, but
its other F4 pick lost in the Elite Eight. maxScore = 580 + 160 + 320 =
**1060** (the dead F4/champ paths credit nothing).

## 1.5 Ranking and tiebreakers

`scoreTournamentEntries` (`bracketScoring.ts:193-326`) sorts every entry in
every BRACKET pool linked to the tournament:

1. `score` descending.
2. `maxScore` descending (live pools: still-alive brackets outrank dead ones).
3. Championship tiebreaker — only once the championship game (highest round)
   is FINAL. Each entry's `tieBreakerPrediction` is compared to the actual
   combined final-game total points (`actualTotal`, :205-208):
   - Default (**Closest Absolute**): smaller `|prediction − actualTotal|` wins.
   - `settings.tieBreakers.closestUnder` (**"Price is Right"**): a prediction
     with `diff <= 0` (at-or-under; exact counts as under) beats any over;
     among two unders, closest wins; **if BOTH went over, the code falls
     through to Closest Absolute** (`bracketScoring.ts:253-261`). So "all
     entries busted over" never deadlocks — it degrades to closest-absolute.
4. Entries still tied after all of the above share a competition rank
   (1,1,3,…; :266-292). There is no uid-level tiebreak for brackets.

Ranks/scores/maxScore are batch-written back in ≤400-op chunks only when
changed. Scoring is recompute-from-source: re-running always converges
(idempotent), no lock needed.

Triggers: `scheduledBracketSync` every 10 min (ESPN sync then rescore,
`espnBracket.ts:1027`) and manual SUPER_ADMIN callable `scoreBracketEntries`
(`bracketScoring.ts:331`).

## 1.6 Payouts (finalizeTournamentPayouts)

`bracketScoring.ts:386-617`, SUPER_ADMIN callable:

- `pot = (# entries with paidStatus === 'PAID') × settings.entryFee` (:415-416).
- Walks rank groups against `settings.payouts.places[]` percentages; a tie at a
  rank consumes as many places as tied entries (capped at remaining places) and
  splits their combined percentage evenly (:437-464).
- Known foot-guns (as of 2026-07-06, unfixed): pot counts only PAID entries
  but payouts iterate ALL ranked entries — an unpaid rank-1 entry still gets
  winnings; and re-running re-sends every season-recap email (no processed
  marker). Treat re-runs as a change-control event.

**Worked example:** entryFee $10, 20 PAID entries → pot $200. Payout places
50/30/20. Two entries tied at rank 1: they consume places 1+2 (50+30=80%) and
each gets $200×0.80/2 = **$80**; the rank-3 entry gets 20% = **$40**.

## 1.7 What-if simulator

Client-only (`src/components/BracketPoolDashboard/WhatIfSimulator.tsx`): user
toggles hypothetical winners for non-FINAL games; `calculateWhatIfScore`
re-scores all entries locally with the hypothetical overlay. Zero server
writes — it can never corrupt real scores.

---

# 2. NFL pools

Pure scoring: `functions/src/nflScoringEngine.ts`. Orchestration + writes:
`functions/src/nflPools.ts`. Schedule/scores: `functions/src/nflSchedule.ts`
→ `nfl_games` collection.

**Live-season status (as of 2026-07-06):** NFL pools have NEVER run a live
season; 2026 is the first. `scoreNFLWeek` is a MANUAL per-pool/per-week
callable (owner or SUPER_ADMIN) — there is NO scheduled NFL scorer. The
spread-locking job `lockNFLSpreadsJob` exists in code
(`nflSchedule.ts:301`) but is NOT exported from `index.ts`, so it never runs.
Since `submitNFLPicks` refuses ALL picks until every game's `spread.locked ===
true` (`nflPools.ts:246-249`) and imports create spreads with `locked: false`
(`nflSchedule.ts:144`), an unattended week soft-bricks pick submission. This
is the project's hardest open live problem — see `mmp-nfl-season-campaign`. Still
open 2026-07-12: `lockNFLSpreadsJob` remains unexported. A separate scheduled job,
`nflFinalizeSweepJob`, was added since this was written but is a finalize backstop,
not a spread-locker or scorer — it does not close this gap.

## 2.1 Lock semantics (shared)

- `lockBufferMinutes` default 5 (`nflPools.ts:252`). Per-game lock =
  `game.startTime − buffer`. Week lock = earliest game's lock.
- Commissioner extension: `pool.settings.weekLockOverrides[week]` (set by
  `extendWeekDeadline`); effective lock = `max(override, computed)`
  (`nflPools.ts:256-269`).
- Pick'em lock mode: `weeklyLockMode = settings.confidenceMode ||
  settings.lockMode === 'WEEKLY'` (`nflPools.ts:288`). **Confidence mode
  FORCES weekly lock** — verified.
- Survivor and Margin: weekly lock if `lockMode === 'WEEKLY'`, else per-game
  lock on the picked team's game. Changing a locked pick throws GAME_LOCKED;
  resubmitting the SAME pick after lock is allowed (idempotent).
- Schedule flexing: `syncNFLScoresJob` (every 5 min) updates `startTime`, so
  lock times move with flexed games; locked spreads are preserved.

## 2.2 Pick'em: standard vs confidence

`scorePickemEntry` (`nflScoringEngine.ts:19-64`):

| Rule | Standard | Confidence |
|---|---|---|
| Correct pick | +1 | + assigned confidence value |
| Tie game | incorrect (0) | incorrect (0) |
| Cancelled game | 0, void | 0 — the points assigned to that game are LOST, not reassigned |
| Unpicked game | 0 | invalid — completeness enforced |

Confidence validation (`validateConfidenceValues`,
`nflScoringEngine.ts:70-107`): with N games in the week, values must be
**unique integers in `[17−N .. 16]`**, all N games assigned.

**Worked examples:** 16-game week → values 1..16. **13-game (bye) week →
values 4..16** (17−13=4); 1, 2, 3 are rejected as OUT_OF_RANGE — this keeps
weekly maximums comparable across the season. If you nail your 16 and your 4
but miss everything else: 16 + 4 = **20 points**.

Weekly tiebreaker: entries store `weeklyTiebreakers[week]` (MNF total-points
prediction). In `scoreNFLWeek` this feeds only the WeeklyRecap
`closestTiebreaker` field (`nflPools.ts:643-649, 754-764`) — the server does
NOT write a rank for Pick'em entries; standings order is client-side by
`totalScore`.

**MNF caveats (verified in code, doc claims differ):**
- `docs/NFL_POOLS_README.md:88` says two-MNF weeks use the COMBINED total of
  both games. The code uses `games.find(g => g.isMonday && g.status ===
  'FINAL')` — the FIRST final Monday game only (`nflPools.ts:616-617`). The
  combined-total behavior is documented but NOT implemented.
- `isMonday` is computed as `new Date(startTime).getDay() === 1` in the
  runtime timezone (`nflSchedule.ts:86-88`). Cloud Functions run UTC, so a
  Monday 8:15pm ET kickoff is Tuesday 00:15 UTC → `isMonday` would be FALSE.
  Early MNF kickoffs (before 8pm ET) stay Monday in UTC. UNVERIFIED in
  production (no live season yet); verify against real imported data before
  week 1.

## 2.3 Survivor

Engine: `evaluateSurvivorWeek` / `updateSurvivorStatus` /
`checkAutoSurviveExemption` (`nflScoringEngine.ts:117-235`).

| Concept | Rule | Anchor |
|---|---|---|
| Strike (standard) | picked team loses OR ties | :177-183 |
| Strike (pickLosersMode) | picked team wins OR ties (inverted "pick a loser to survive") | :177-179 |
| No pick submitted | auto-strike when scoring runs | :136-138 |
| Cancelled / missing game | survive (err on safety) | :146-152 |
| Elimination | `strikesUsed >= maxStrikes + 1` → ELIMINATED. `maxStrikes` = free strikes ("mulligans"): maxStrikes 0 = sudden death (1 strike kills); maxStrikes 1 = eliminated on 2nd strike | :194-208 |
| Team reuse | a team may be picked once per season (`usedTeams`); enforced at submit (`nflPools.ts:362-364`) | |
| Auto-survive exemption | if enabled (default true) and EVERY team playing this week is already in the entry's `usedTeams` (e.g. remaining unused teams all on bye), entry survives without a pick; week appended to `exemptWeeks` | :214-235, `nflPools.ts:655-662` |
| Rebuy | `executeSurvivorRebuy`: only ELIMINATED entries, only while `week <= settings.rebuyDeadlineWeek`, only while `rebuysUsed < settings.maxRebuys`. Resets `strikesUsed` to 0, increments `rebuysUsed`, **usedTeams stay locked**. Writes a REBUY_DUE ledger event (rebuyCost ?? entryFee) — money is P2P, platform records only | `nflPools.ts:450-530` |

**Auto-strike timing:** the documented rule "auto-strikes apply only after the
final MNF game concludes" is enforced indirectly: `scoreNFLWeek` throws
ACTIVE_GAMES while any game is non-final — UNLESS the caller is SUPER_ADMIN
(`nflPools.ts:579-582`). A SUPER_ADMIN force-scoring mid-week WILL strike
everyone whose game hasn't finished or who hasn't picked yet. Never
force-score a partial week on a real pool.

## 2.4 Margin

- Weekly score = signed margin of victory of your one picked team, OT
  included (`scoreMarginWeek`, `nflScoringEngine.ts:245-267`). Chiefs win
  24-20 → **+4**; Chiefs lose 21-24 → **−3**; cancelled → 0.
- **No pick = −14** flat penalty, applied in `scoreNFLWeek`
  (`nflPools.ts:702-708`), not in the pure engine.
- One team per week; each team usable once per season (same `usedTeams`
  mechanics as Survivor).
- Derived stats per entry (recomputed every scoring run,
  `nflPools.ts:710-730`): `seasonTotal` (sum), `negativeBurden`
  (Σ |negative weeks|), `positiveWeeks` (count > 0), `bestWeek` (max single
  week).

**Tiebreaker cascade** (`sortMarginLeaderboard`,
`nflScoringEngine.ts:277-302`), exactly:

1. `seasonTotal` — higher wins
2. `negativeBurden` — LOWER wins
3. `positiveWeeks` — higher wins
4. `bestWeek` — higher wins
5. `a.ownerUid.localeCompare(b.ownerUid)` — **deterministic uid string
   compare**. `docs/NFL_POOLS_README.md:78` calls level 5 "Coin Flip
   (Random)" — that is WRONG; there is no randomness. README.md:32
   ("Deterministic ID comparison") is the correct one.

Ranks 1..N are written back to entries after each scoring run
(`nflPools.ts:735-749`).

**Worked example:** A: total +38, burden 17, B: total +38, burden 9 → B ranks
ahead (level 2). If burdens also tied at 9, compare positiveWeeks, then
bestWeek, then uid.

## 2.5 Playoff Rank'Em (NFL_PLAYOFFS)

`functions/src/playoffPools.ts`. Participants assign each playoff team an
integer ranking (the 2020+ NFL playoff field is 14 teams; the engine is
count-agnostic — validation bounds are `0..teamCount` per team against
`pool.teams`, `playoffPools.ts:151-168`).

Score = Σ over every round, for every team that WON in that round:
`rankings[teamId] × roundMultiplier` (`playoffPools.ts:107-112`). A team that
keeps winning earns its ranking again each round.

Round multipliers come from `pool.settings.scoring.roundMultipliers`; THREE
different defaults exist — always read the pool doc, never assume:

| Source | WC | DIV | CONF | SB | Anchor |
|---|---|---|---|---|---|
| Server fallback (scoring engine) | 10 | 12 | 15 | 20 | `playoffPools.ts:92-96` |
| Create-wizard default (what new pools actually get stamped) | 1 | 2 | 3 | 4 | `src/components/wizard/create/CreatePlayoffPool.tsx:58` |
| Dashboard display fallback | 1 | 2 | 4 | 8 | `src/components/PlayoffPool/PlayoffDashboard.tsx:434-437` |

The marketing "x1/x2/x4/x8" claim matches only the dashboard fallback. Since
the wizard writes multipliers into every pool, the server fallback should
rarely trigger — but a pool doc missing the field would score 10/12/15/20
while displaying 1/2/4/8. `tiebreaker` field = Super Bowl total-points
prediction (stored, `playoffPools.ts:179`).

**Worked example (wizard defaults 1/2/3/4):** you ranked KC 14. KC wins Wild
Card (14×1), Divisional (14×2), Conference (14×3), Super Bowl (14×4) → KC
alone earns 14+28+42+56 = **140 points**.

## 2.6 seasonType semantics

`seasonType: 1 = Preseason, 2 = Regular, 3 = Postseason`
(`nflSchedule.ts:13-21`). Pools default to 2 (`Number(pool.seasonType || 2)`,
`nflPools.ts:235,569`). Preseason (`seasonType=1`) is the sanctioned 4-week
test window: SuperAdmins create seasonType=1 pools and the whole app treats it
as a valid season, letting live preseason games exercise every engine before
week 1 (`docs/NFL_POOLS_README.md:92-98`).

---

# 3. Squares (Gameday Squares)

10×10 = 100-square grid on `pools/{poolId}` (`squares` array, index =
`row*10 + col`). Score sync: `syncGameStatus` scheduled every 1 min
(`functions/src/scoreUpdates.ts:1081`), per-pool Firestore transaction.

## 3.1 Axis numbers (the fairness-critical part)

- Generated SERVER-SIDE only, at lock time, by `lockPool` (callable,
  `functions/src/poolParams.ts:47-81`) or `autoLockPools` (every-1-min
  scheduler, `functions/src/autoLock.ts:125-152`). Firestore rules block any
  client write to `axisNumbers` or `isLocked`.
- Algorithm: Fisher-Yates shuffle of 0-9 using **`Math.random()`** — a uniform
  permutation but NOT a CSPRNG (`autoLock.ts:14-21`, `poolParams.ts:59-67`,
  `scoreUpdates.ts:9-16`). If any doc claims "CSPRNG", that is aspirational;
  the trust mechanism is server-side generation + an append-only
  `DIGITS_GENERATED` audit event carrying a SHA-256 commit hash of the digits
  (`computeDigitsHash`, `functions/src/audit.ts:80`).
- Test mode: `lockPool({ forceAxis: true })` writes fixed `[0..9]/[0..9]`
  axes (`poolParams.ts:50-56`).
- Winner mapping per period: home-score last digit indexes the HOME axis →
  column; away-score last digit indexes the AWAY axis → row; winning square =
  `row*10 + col` (`scoreUpdates.ts:866-872`). `reverseWinners` rule variation
  additionally pays the digit-swapped square when it differs.

**Worked example:** home axis `[3,7,1,0,9,5,8,2,6,4]`, away axis
`[5,2,8,1,7,0,9,4,3,6]`. Q1 ends Home 17 – Away 14: home digit 7 → column 1;
away digit 4 → row 7; winner = square index 7×10+1 = **71**.

## 3.2 Periods, 4-Sets, payouts, charity

- Periods: `q1`, `half`, `q3`, `final`; payout percentages in
  `payouts: {q1, half, q3, final}` (`functions/src/types.ts:54-59`). Winners
  computed once per period on finalization (guarded by "was this period
  already in freshPool.scores" — re-sync safe, `scoreUpdates.ts:938-972`).
- **4-Sets mode** (`numberSets === 4`): q1 axes generated at lock; fresh q2/q3/q4
  axes generated server-side the moment the prior period finalizes, each with
  its own DIGITS_GENERATED audit + hash (`scoreUpdates.ts:899-931`). The live
  `axisNumbers` field is swapped to the current quarter's set.
- Rule variations (`types.ts:181-190`): `reverseWinners`, `quarterlyRollover`
  (unsold-square money rolls forward), `scoreChangePayout` ("Every Score
  Pays": fixed $ per scoring event, strategies `equal_split`/`hybrid`,
  unsold handling `rollover_next`/`house`), `includeOvertime`.
- **Final Prize Randomizer**: client-side manual button in the commissioner
  AdminPanel, enabled only when the game is over AND the final-score square
  is unsold; picks a random square (`randomWinner`) to receive the rollover
  pot (`src/components/AdminPanel.tsx:758-804`; configured in
  `WizardStepPayouts.tsx`). It is NOT a Cloud Function.
- **Charity off-the-top**: `charity: {enabled, name, percentage 0-100}`;
  `charityAmount = grossPot × pct/100`, `prizePot = grossPot − charityAmount`,
  both floored (`functions/src/statsTrigger.ts:34-44`). Charity totals feed
  the public global stats (`totalDonated`).

---

# 4. Props / Side Hustle

Two shapes, one engine:
- Standalone PROPS pool, or a "Side Hustle" props tab bolted onto a Squares
  pool. Config lives at `pool.props = {enabled, cost, maxCards (default 1),
  payouts[], questions[]}` (`functions/src/types.ts:200-205`).
- Participants buy PropCards (`purchasePropCard`,
  `functions/src/propBets.ts:10`; cards in `pools/{id}/propCards`), answering
  multiple-choice questions; answers editable pre-lock via `updatePropCard`.
- Grading: `gradeProp` (`propBets.ts:115-194`) sets `correctOption` on one
  question then rescores EVERY card: `score = Σ (question.points || 1)` per
  matching answer. Fully recompute-style — re-grading a question is safe and
  retroactive. Gate is pool owner/manager only (the code comment admits no
  SUPER_ADMIN claim check, `propBets.ts:131-138`).
- **Global seed catalog**: Firestore collection `prop_questions` holds
  `PropSeed` templates (text, options, category), managed only from the
  SuperAdmin UI (`src/components/SuperAdmin.tsx` savePropSeed flows), browsed
  by commissioners via the SeedLibrary picker
  (`src/components/Props/PropsManager.tsx:516+`), read through
  `dbService.getPropSeeds()` (`src/services/dbService.ts:553-556`). Adding a
  seed COPIES it into the pool's own `props.questions` — pools never
  reference the catalog live, so editing a seed never mutates existing pools.

---

# 5. Cross-cutting: ESPN data contracts

## 5.1 NCAA bracket import (the four never-break rules)

Import path: `importTournamentFromESPN` → `fetchAndMapESPNGameData`
(`functions/src/espnBracket.ts`), scoreboard URL
`.../mens-college-basketball/scoreboard?dates=YYYY0315-YYYY0410&groups=100`.

1. **Seed** = `competitor.curatedRank.current` (fallback 99). For tournament
   events this IS the bracket seed, not an AP rank (`espnBracket.ts:409-414`).
2. **Region** parsed from `notes[0].headline` (e.g. "Midwest Region - 1st
   Round") with the `midwest` substring check BEFORE `west` — 'midwest'
   contains 'west'; getting the order wrong once mislabeled an entire region
   (`parseRegionAndRound`, `espnBracket.ts:529-532`). Round parse: "first
   four"→0, "first round"→1 … "national championship"→6 (:517-525).
3. **Team IDs are full ESPN display names** ("Duke Blue Devils"), stripped of
   any "(n) " seed prefix (:406-407). The `E1-Duke` format and its
   seed-extraction regex are deprecated fallbacks only.
4. The static `NCAA_2026_BRACKET` team→slot map is deprecated ("DO NOT use …
   it has incorrect data", `espnBracket.ts:405`) yet still consulted in the
   First-Four fallback path — an annual-maintenance trap. R2+ games are
   resolved by cascading feeder-game winners, not by the map
   (`mapESPNGamesToSkeleton`, :549+).

Expected import shape: ~67 games / ~69 team records; verify "R1 mapped:"
function logs and that Midwest is not labeled West (annual runbook:
`docs/annual-bracket-setup-runbook.md`).

## 5.2 NFL schedule/scores

- `fetchNFLWeekSchedule(week, season, seasonType)` hits
  `site.api.espn.com/.../football/nfl/scoreboard?week=&season=&seasontype=`;
  it resolves week→date-range via the league calendar to dodge ESPN's
  off-season current-week fallback (`nflSchedule.ts:17-52`).
- `importNFLSchedule` (SUPER_ADMIN) DELETES all existing `nfl_games` for that
  season+seasonType before re-import (destructive; single unbounded batch).
- `syncNFLScoresJob` (`*/5 * * * *`) refreshes scores/status/flex times and
  preserves already-locked spreads.
- Spread sign convention: relative to home team, negative = home favored
  (`nflPoolTypes.ts:33-35`).

## 5.3 Tournament data model (bracket)

`tournaments/{id}`: `games` (map id → {round, region, homeTeamId, awayTeamId,
homeScore, awayScore, winnerTeamId, status SCHEDULED|FINAL, nextGameId}),
`slots` (map slotId → {gameId, nextSlotId}), `importedTeams` (map displayName
→ {seed, record…}), `seasonYear`, `isFinalized`. Bracket entries:
`pools/{poolId}/entries/{entryId}` with `picks` (slotId → teamId),
`tieBreakerPrediction`, `score`, `maxScore`, `rank`, `paidStatus`,
`amountWon`, `isWinner`.

---

# 6. Doc-vs-code corrections (trust this table over the docs)

| Doc claim | Reality (verified 2026-07-06) |
|---|---|
| `NFL_POOLS_README.md:78`: Margin tiebreaker level 5 = "Coin Flip (Random)" | Deterministic `ownerUid.localeCompare` (`nflScoringEngine.ts:300-301`) |
| `NFL_POOLS_README.md:88`: two-MNF weeks use combined total of both games | Not implemented; `scoreNFLWeek` uses first final Monday game only (`nflPools.ts:616`) |
| `bracket-pool-architecture.md:21`: Big 12 = 14 teams | 2026 code = 16 teams, 5 rounds, 15 games (`conferenceTournaments.ts:186-330`) |
| `bracket-pool-architecture.md` edge case: seeds parsed from `E1-Duke` IDs | Deprecated; seeds come from `importedTeams[displayName].seed` (`bracketScoring.ts:49-57`) |
| "Rank 'Em multipliers x1/x2/x4/x8" | Dashboard display fallback only; wizard stamps 1/2/3/4, server fallback is 10/12/15/20 (§2.5) |
| "CSPRNG axis numbers" | Server-side Fisher-Yates via `Math.random()` + SHA-256 audit hash; not cryptographically secure RNG (§3.1) |
| UI dropdown "Classic (1-2-4-8-16-32)", "Fibonacci (2-3-5-8-13-21)" | Engine pays 10-20-40-80-160-320 / 10-20-30-50-80-130 (§1.2) |

---

# 7. Provenance and maintenance

All facts verified against the working tree on branch
`fix/superadmin-phase0-control`, 2026-07-06. One re-verification command per
drift-prone fact class (run from `D:\march-melee-pools`):

```powershell
# Bracket multiplier tables (server + client must match)
Select-String -Path functions\src\bracketScoring.ts,src\components\BracketPoolDashboard\bracketScoring.ts -Pattern "10, 20, 40|10, 20, 30"

# Bracket tiebreaker (closestUnder fallback logic)
Select-String -Path functions\src\bracketScoring.ts -Pattern "closestUnder" -Context 0,6

# Confidence value range formula
Select-String -Path functions\src\nflScoringEngine.ts -Pattern "17 - N"

# Margin cascade + deterministic level 5 (and the -14 penalty)
Select-String -Path functions\src\nflScoringEngine.ts -Pattern "localeCompare"; Select-String -Path functions\src\nflPools.ts -Pattern "\-14"

# Survivor elimination threshold and rebuy rules
Select-String -Path functions\src\nflScoringEngine.ts -Pattern "maxStrikes"; Select-String -Path functions\src\nflPools.ts -Pattern "rebuyDeadlineWeek|maxRebuys"

# MNF tiebreaker implementation (single vs combined)
Select-String -Path functions\src\nflPools.ts -Pattern "isMonday" -Context 1,2

# Spread gate + whether lockNFLSpreadsJob is exported yet
Select-String -Path functions\src\nflPools.ts -Pattern "SPREADS_NOT_LOCKED"; Select-String -Path functions\src\index.ts -Pattern "lockNFLSpreads"

# Playoff multiplier defaults (3-way divergence)
Select-String -Path functions\src\playoffPools.ts,src\components\wizard\create\CreatePlayoffPool.tsx,src\components\PlayoffPool\PlayoffDashboard.tsx -Pattern "WILD_CARD.{0,30}(10|1)"

# Squares RNG mechanism (Math.random vs crypto)
Select-String -Path functions\src\autoLock.ts,functions\src\poolParams.ts,functions\src\scoreUpdates.ts -Pattern "Math.random"

# Charity off-the-top math
Select-String -Path functions\src\statsTrigger.ts -Pattern "charity" -Context 0,2

# Props seed catalog collection name
Select-String -Path src\services\dbService.ts -Pattern "prop_questions"

# ESPN region-parse ordering (midwest before west)
Select-String -Path functions\src\espnBracket.ts -Pattern "midwest" -Context 0,2

# Conference tournament team counts / rounds (change YEARLY)
Select-String -Path functions\src\conferenceTournaments.ts -Pattern "TEAMS_20|Total:"

# NFL seasonType semantics
Select-String -Path functions\src\nflSchedule.ts -Pattern "seasonType: 1 = "
```

Highest-drift items: conference tournament shapes (rebuilt every March),
`NCAA_20XX_BRACKET` static map (annual), playoff multiplier defaults (if the
wizard or engine defaults are ever reconciled), and anything in §2 once the
2026 NFL season work in `mmp-nfl-season-campaign` starts landing.
