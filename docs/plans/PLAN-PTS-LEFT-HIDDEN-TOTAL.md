# PLAN — Pts Left and Max for every member, from one server total

> **STATUS: BUILT — one PR, not merged, not deployed.** Deploy is **functions
> first, then `www`** (no rules change). Review log:
> `PLAN-PTS-LEFT-HIDDEN-TOTAL-REVIEW-LOG.md`. Sweeps:
> `PLAN-PTS-LEFT-HIDDEN-TOTAL-SWEEPS.md`.

Kevin, 2026-11-23, from a member: *"the Weekly Results page has ? under the PTS
Left for all players. Also the Max column should reflect the max pts left if that
user gets the remaining picks correct. It is currently showing the Max pts for
the week (130 for this week)."* Then, on the server total: approved ("Yes, send
the total"), and *"Make this an option for the pool manager to turn on or off."*

**Classification (`mmp-change-control` §1): PLAN-GATED — authorization** (what a
member may learn about another member's unrevealed sheet). No money or scoring
change: scores, grading and what is charged are untouched.

---

## 1. What was wrong — verified on `origin/main` @ `fd6ff223`

1. **"?" for every other player.** Pts Left for another row needs the weights on
   that row's unrevealed picks. `getPoolPicks` (correctly) sends no pick or
   weight before a game's lock, so on a PER_GAME pool every other row read "?"
   until its last games kicked off. Kevin's own screenshot showed numbers only
   because a SUPER_ADMIN receives `fullReveal`.
2. **Max was the week's ceiling.** `NFLResults` printed
   `weeklyMaxPoints(scoreable games)` — 130 on a 13-game week — on every row.

The client cannot derive the hidden sum itself. A complete confidence sheet
uses a fixed weight set, so its hidden total is `set total − revealed weights`.
But on a PER_GAME pool a member who misses a game ends up with a different set
(`validatePerGameConfidence`), so the complement is not reliable.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| P1 | `getPoolPicks` returns `hiddenLeft`: per ENTRY, one total of the points on its picks that are **not revealed to the caller** and on games **not FINAL/CANCELLED** (weights in confidence mode, 1 per pick otherwise). Pick'em only. | The one number the client is missing. Built from the same `allowedKeys` allowlist as the picks, so a revealed game is never counted twice. |
| P2 | **No pick content**: no team, no per-game weight, only a sum. | Kevin's approval was for the total. With one hidden game left the total equals that game's weight. For a complete sheet that weight was already derivable from the public weights; the help text says so plainly. |
| P3 | **Ungated by principal**, after the departed-member filter, exactly like `counts`. SUPER_ADMIN gets 0s (nothing is hidden from them). | One definition; an emulator test asserts member and commissioner receive identical totals. |
| P4 | An entry with a hidden open pick that has **no stored weight** is left out, so the client shows "?" rather than a short total. | Never a silently wrong number. |
| P5 | **Commissioner toggle** `settings.shareHiddenPointsLeft` (Pick'em, **default ON**). Off sends no totals, which is the previous behaviour. Validated as a strict boolean in `flattenSettingsPatch`. | Kevin: "an option for the pool manager to turn on or off". Default on because members asked for it and Kevin approved it for every pool first. A stored `"false"` string is refused, because `sharesHiddenPointsLeft` would read it as ON. |
| P6 | **Max is per player**: `tallyGridRow`'s `max` = points won + Pts Left. The Current Picks grid already used it, so both pages agree. | Kevin's definition of the column. |
| P7 | **Client falls back.** With no `hiddenLeft` (old server, setting off, missing weight), the tally behaves exactly as before. A hidden pick on an already-DECIDED game (the reveal lagging the game) keeps confidence Max unknown and bounds standard Max at 1 each. | Safe in either deploy order; an upper bound never dips below the real score. |

## 3. What changes

- `functions/src/nflPickReveal.ts`: computes and returns `hiddenLeft`, gated by `sharesHiddenPointsLeft`.
- `shared/pointsLeftSharing.ts`: new; the effective-setting reader.
- `functions/src/lib/poolUpdate.ts`: validates `settings.shareHiddenPointsLeft`.
- `src/utils/picksGridMax.ts`: `tallyGridRow` takes `hiddenLeft`.
- `src/components/NFLPoolDashboard/NFLResults.tsx`: Max per row from the tally; passes `hiddenLeft`.
- `src/components/NFLPoolDashboard/NFLPicksGrid.tsx`: passes `hiddenLeft`.
- `src/components/NFLPoolDashboard/NFLManagerView.tsx`: a Pick'em-only checkbox, sent only when touched.
- `src/services/dbService.ts`: the client mirror type gets an optional `hiddenLeft`.
- Copy: the Week Results caption (`src/utils/nflResults.ts`), a help topic, and the `CONTEXT.md` Pick Reveal entry.

## 4. Evidence

- **Emulator** (`blindPicks.emulator.test.ts`, stamped PER_GAME confidence pool):
  - the member's total is 7 + 3, excluding a cancelled game's 9 and the revealed game;
  - no open pick or weight is returned;
  - a missing weight leaves the entry out;
  - commissioner equals member;
  - SUPER_ADMIN gets 0;
  - setting off means no `hiddenLeft` for anyone;
  - Survivor has no field.
- **Unit tests:**
  - `poolUpdate.test.ts`: boolean-only validation, and the default-on reader;
  - `picksGridMax.test.ts`: totals, the "?" fallback, a real 0, the lagging-finished-game cases in both scoring modes, and the own row;
  - `resultsPointsLeft.test.tsx`: per-row Max, "?" before the total, real numbers with it.

## 5. Deploy and rollback

- **Deploy:** `git pull` in `D:\march-melee-pools`, then `npm --prefix functions ci`, then `npx firebase deploy --only functions`, then Coolify `www` Redeploy. Either order is safe (P7).
- **Rollback:**
  - Fastest: the commissioner unticks the setting. Nothing is sent from the next poll on.
  - Code: revert the PR and redeploy both.
  - Nothing is stored except the optional setting.
