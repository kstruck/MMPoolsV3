import type { NFLGame } from '../types';

/**
 * CLIENT MIRROR of the Pick'em grading rule in
 * `functions/src/nflScoringEngine.ts`'s `gradePickemGames`.
 *
 * The pick sheet colours a concluded matchup green or red. It used to derive
 * that purely from the raw score:
 *
 *     const homeWon = (scores.home ?? 0) > (scores.away ?? 0);
 *
 * which is correct for straight-up scoring and WRONG for ATS. On an ATS pool a
 * pick that covers but loses outright rendered RED while the scorer recorded a
 * WIN, and a winner that failed to cover rendered GREEN while the scorer
 * recorded a loss. The member's own sheet contradicted their standings.
 *
 * That was unreachable until the wizard gained a Straight/ATS control, because
 * no supported path could create an ATS pool. Exposing the mode is what made
 * this defect live, so it is fixed in the same change. (codex, on that PR.)
 *
 * ## Why a copy
 *
 * `functions/` is a separate, module-incompatible TS root the Vite bundle
 * cannot import, and moving the rule into `shared/` would make every future
 * frontend tweak owe a functions deploy. Duplicated deliberately — the same
 * arrangement as `src/utils/poolUsesSpreads.ts` and `src/utils/featureFlags.ts`
 * — and pinned by `tests/pickem-result-parity.test.ts`, which drives the REAL
 * `gradePickemGames` over a matrix and compares it to this function.
 */

export type PickemResult = 'W' | 'L' | 'PUSH' | 'VOID' | null;

/**
 * CLIENT MIRROR of `hasReportedScores` in the engine.
 *
 * "The feed dropped the field" and "the team scored zero" are different facts,
 * and `?? 0` collapses them. Exported because the pick sheets' shared outcome
 * module (`components/NFLPoolDashboard/pickSheet/pickOutcome.ts`) asks the same
 * question of Survivor and Margin games; one client definition, not two.
 */
export function hasReportedScores(
  game: { scores?: { home?: number; away?: number } | null },
): boolean {
  return Number.isFinite(game.scores?.home) && Number.isFinite(game.scores?.away);
}

/**
 * Grade one pick, or `null` when the game has not concluded / was not picked.
 *
 * `spread.value` is relative to the HOME team (negative = home favoured), so
 * the home side covers when `homeScore + spread.value` beats `awayScore`.
 */
export function gradePick(
  game: NFLGame,
  pick: string | undefined,
  pickMode: string | undefined,
): PickemResult {
  if (!pick) return null;
  if (game.status === 'CANCELLED') return 'VOID';
  if (game.status !== 'FINAL') return null;

  // ⚠️ A FINAL THE FEED REPORTED NO SCORES FOR IS NOT GRADED. This mirrors the
  // engine's opening line — `if (game.status === 'FINAL' && !hasReportedScores(game)) continue;`
  // — and it was missing here (codex, on the pick-feedback PR). Without it the
  // reads below fall to `?? 0`, which is a harmless 0-0 PUSH straight-up but a
  // decided W or L in ATS, because the spread moves the adjusted home score off
  // the tie. The sheet and the grid then announced a verdict on a game the
  // scorer is still refusing to grade (engine defect NFL7-3), contradicting the
  // member's own standings. A FINAL landing before its scores is the ordinary
  // shape of this feed, not a corner case.
  //
  // `null` is the mirror of the server's `continue`: no grade recorded, so
  // `gradePickemGames(...)[game.id]` is `undefined` and this returns `null`.
  if (!hasReportedScores(game)) return null;

  // Safe after the guard above: `hasReportedScores` is exactly the finite check
  // on both fields, so the `?? 0` fallbacks can no longer stand in for a
  // missing score. They are kept because the engine writes them identically.
  const homeScore = game.scores?.home ?? 0;
  const awayScore = game.scores?.away ?? 0;
  const home = game.homeTeam.abbreviation;
  const away = game.awayTeam.abbreviation;

  // The ATS branch requires a NUMERIC spread. A missing one falls through to
  // straight-up, exactly as the server does — not to an error and not to a
  // push, either of which would disagree with the recorded score.
  if (pickMode === 'ATS' && typeof game.spread?.value === 'number') {
    const adjustedHome = homeScore + game.spread.value;
    if (adjustedHome === awayScore) return 'PUSH';
    return pick === (adjustedHome > awayScore ? home : away) ? 'W' : 'L';
  }
  if (homeScore === awayScore) return 'PUSH';
  return pick === (homeScore > awayScore ? home : away) ? 'W' : 'L';
}
