import type { NFLGame } from '../../../types';
import { hasReportedScores, type PickemResult } from '../../../utils/pickemResult';

/**
 * "Did my pick turn out right?" — the ONE definition the three NFL pick sheets
 * use to decide whether a concluded matchup gets a green tick, a red cross, or
 * nothing at all.
 *
 * ## Why this exists (Kevin, 2026-08-24)
 *
 * `TeamPickButton` used to draw a check badge on the team you had chosen, green
 * once the pick was saved to the server. Testers read that green check as **"I
 * won this game"**. It never meant that — it meant "this selection is stored" —
 * and on a lost game it was actively wrong-looking.
 *
 * So the check glyph now means exactly one thing: **your pick was CORRECT**. A
 * wrong pick gets a red cross, and a game that has not been graded gets neither
 * mark nor card highlight. The saved/unsaved state it used to carry moved to a
 * *word* ("Saved" / "Unsaved"), which cannot be misread as a result.
 *
 * ## Not a new rule
 *
 * Nothing here invents a notion of correctness. Each grader is a documented
 * mirror of the server rule in `functions/src/nflScoringEngine.ts`, and
 * `pickOutcome.test.ts` drives the REAL engine functions over a matrix and
 * compares, exactly as `tests/pickem-result-parity.test.ts` does for
 * `gradePick`. `functions/` is a separate, module-incompatible TS root the Vite
 * bundle cannot import, which is why the sheets need a mirror at all — the same
 * arrangement, and the same parity-test discipline, as
 * `src/utils/pickemResult.ts`.
 */

/**
 * `null` is load-bearing and means "say nothing": not picked, not concluded, or
 * concluded into an outcome that is neither right nor wrong (a Pick'em PUSH, a
 * cancelled game, a Survivor week the member was exempt from). Those must not
 * render red — calling a refunded pick "incorrect" is a false statement about
 * the member's standings.
 */
export type PickOutcome = 'CORRECT' | 'INCORRECT' | null;

/**
 * Pick'em (incl. confidence mode and ATS pools).
 *
 * Takes the grade `src/utils/pickemResult.ts#gradePick` already produced rather
 * than re-deriving it — that function is the client mirror of
 * `gradePickemGames` and is pinned by `tests/pickem-result-parity.test.ts`.
 * Confidence mode changes how many POINTS a correct pick is worth, never
 * whether it was correct, so it needs no branch here.
 *
 * PUSH and VOID deliberately answer `null`: both are scored, neither is a loss.
 *
 * ⚠️ `game` IS BELT-AND-BRACES, AND IT STAYS. `gradePickemGames` opens with
 *
 *     if (game.status === 'FINAL' && !hasReportedScores(game)) continue;
 *
 * and `gradePick` had no such line: it fell straight to `scores?.home ?? 0`. On
 * a scoreless FINAL that reads 0-0, which is a harmless PUSH straight-up but a
 * decided **W or L in ATS**, because the spread moves the adjusted home score
 * off the tie — a verdict on a payload the scorer is still refusing to grade
 * (engine defect NFL7-3). A FINAL landing before its scores is the ordinary
 * shape of this feed, not a corner case.
 *
 * The pick-feedback PR gated it HERE only, because `gradePick` is shared with
 * `src/utils/picksGrid.ts`, which that PR did not own — leaving the pool grid
 * still labelling such a game W/L. **`gradePick` now carries the gate itself**
 * (`src/utils/pickemResult.ts`), which is what fixed the grid, so this line is
 * no longer the only thing standing between an ATS member and a false verdict.
 *
 * It is kept anyway: it is one finite check, it is asserted directly by
 * `tests/pick-outcome.test.ts`, and `pickemOutcome` takes a `PickemResult` from
 * whatever caller it is handed rather than computing one — so a future caller
 * that grades some other way still cannot paint a scoreless FINAL green or red
 * through this function.
 */
export function pickemOutcome(game: NFLGame, result: PickemResult): PickOutcome {
  if (game.status === 'FINAL' && !hasReportedScores(game)) return null;
  if (result === 'W') return 'CORRECT';
  if (result === 'L') return 'INCORRECT';
  return null;
}

/**
 * The "is this game gradeable at all" gate for the SCORE-reading graders below,
 * mirrored from the engine — `hasReportedScores` included.
 *
 * A FINAL carrying no scores reads 0-0, which is a real tie to every rule below —
 * and a tie is a Survivor strike by default. That is engine defect NFL7-3/NFL7-4,
 * fixed there by waiting rather than grading, and a sheet that painted the card
 * red off the same payload would re-introduce it visually.
 */
function concludedScores(
  game: NFLGame,
  pick: string | undefined,
): { home: number; away: number; isHome: boolean } | null {
  if (!pick) return null;
  if (game.homeTeam.abbreviation !== pick && game.awayTeam.abbreviation !== pick) return null;
  if (game.status !== 'FINAL') return null;
  if (!hasReportedScores(game)) return null;
  // Safe after the guard above: `hasReportedScores` is exactly the finite check
  // on both fields, so neither `?? NaN` can survive to the arithmetic.
  const home = game.scores?.home ?? NaN;
  const away = game.scores?.away ?? NaN;
  return { home, away, isHome: game.homeTeam.abbreviation === pick };
}

/** The two settings the Survivor strike rule actually reads. */
export interface SurvivorOutcomeRules {
  /** Pool setting: pick a team you expect to LOSE. */
  pickLosersMode: boolean;
  /** Pool setting via `effectiveTieCountsAs` — what a tied game does to the picked team. */
  tieCountsAs: 'WIN' | 'LOSS';
  /** True when the member was auto-survive exempt this week; the pick did not matter. */
  exempt?: boolean;
}

/**
 * Survivor — mirror of the per-GAME branch of `evaluateSurvivorWeek`.
 *
 * CORRECT = survived this pick, INCORRECT = it struck. The tie fold happens
 * BEFORE the mode branch, exactly as the engine does it, so `pickLosersMode`
 * composes with `tieCountsAs` instead of needing a 2×2 matrix.
 *
 * ⚠️ SCOPE: this grades THE PICK, not the ENTRY. Strike counts, `maxStrikes`,
 * rebuys and elimination are week-level and entry-level facts the sheet does not
 * claim anything about — a red cross here says "that team did not do what this
 * pool needed", never "you are out". The one entry-level fact that IS honoured
 * is `exempt`: on an exempt week the pick could not strike, so marking it wrong
 * would be a false statement, and it answers `null`.
 *
 * A CANCELLED game answers `null` (the engine survives it — no strike, but no
 * achievement either), and so does a missing/unpicked/unconcluded game.
 */
export function survivorOutcome(
  game: NFLGame,
  pick: string | undefined,
  rules: SurvivorOutcomeRules,
): PickOutcome {
  if (rules.exempt) return null;
  const s = concludedScores(game, pick);
  if (!s) return null;

  let teamWon = s.isHome ? s.home > s.away : s.away > s.home;
  let teamTied = s.home === s.away;
  const teamLost = !teamWon && !teamTied;

  if (teamTied && rules.tieCountsAs === 'WIN') {
    teamWon = true;
    teamTied = false;
  }

  const strike = rules.pickLosersMode ? (teamWon || teamTied) : (teamLost || teamTied);
  return strike ? 'INCORRECT' : 'CORRECT';
}

/**
 * Margin — mirror of the SIGN of `scoreMarginWeek`.
 *
 * A Margin week is scored as a number, not a verdict, so "correct" here is the
 * only reading the engine supports: a positive net helped the season total, a
 * negative one is subtracted from it. **A net of exactly 0 answers `null`** —
 * that is a tie or a cancelled game, it moves the total nowhere, and it is
 * neither a right nor a wrong pick.
 */
export function marginOutcome(game: NFLGame, pick: string | undefined): PickOutcome {
  const s = concludedScores(game, pick);
  if (!s) return null;
  const net = s.isHome ? s.home - s.away : s.away - s.home;
  if (net > 0) return 'CORRECT';
  if (net < 0) return 'INCORRECT';
  return null;
}

/**
 * Whole-card highlight (Kevin's request (d)): green for a correct pick, red for
 * an incorrect one, and the ordinary card border for everything else.
 *
 * Theme-safe in both directions — every colour is stated as an alpha wash over
 * the card's own background plus an explicit `dark:` pair, so neither mode
 * inherits the other's contrast. The literals are the same green (`#0F7B4A` /
 * `#4CC38A`) and the same `brandred` ramp the rest of the pick sheet already
 * uses; a third green would be a fourth definition of "good".
 */
export function pickOutcomeCardClass(outcome: PickOutcome): string {
  if (outcome === 'CORRECT') {
    return 'border-[#0F7B4A]/50 bg-[#0F7B4A]/10 dark:border-[#4CC38A]/60 dark:bg-[#4CC38A]/10';
  }
  if (outcome === 'INCORRECT') {
    return 'border-brandred-600/50 bg-brandred-600/10 dark:border-brandred-500/60 dark:bg-brandred-500/10';
  }
  return 'border-line';
}

/**
 * The words behind the colour (Kevin's request (g)).
 *
 * WCAG 1.4.1: a green card and a red card are the same card to a colour-blind
 * member and to a screen reader. The sheets render this into an `sr-only` span
 * inside the badge AND as the badge's `title`, so the state is always available
 * as text. Empty string for `null` — an ungraded game has nothing to announce,
 * and announcing "pending" on every unplayed matchup would bury the two that
 * matter.
 */
export function pickOutcomeLabel(outcome: PickOutcome): string {
  if (outcome === 'CORRECT') return 'Correct pick';
  if (outcome === 'INCORRECT') return 'Incorrect pick';
  return '';
}
