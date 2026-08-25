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
 * Mirror of the engine's `hasReportedScores` (`nflScoringEngine.ts`).
 *
 * `nflSchedule.ts` emits NO `scores` object at all when the payload carries a
 * score for neither competitor — deliberately, so that "ESPN dropped the field"
 * stays distinguishable from "the team scored zero". `?? 0` collapses those two
 * back together, which is engine defect NFL7-3.
 */
function hasReportedScores(game: NFLGame): boolean {
  return Number.isFinite(game.scores?.home) && Number.isFinite(game.scores?.away);
}

/**
 * Grade one pick, or `null` when there is no grade to give: the game was not
 * picked, has not concluded, or is a FINAL the feed has reported no scores for.
 * All three are the engine's `continue` — an absent entry in its grades map.
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
  // ⚠️ A FINAL the feed reported no scores for is NOT a played game (NFL7-3).
  // The engine's very first act inside the loop is
  //
  //     if (game.status === 'FINAL' && !hasReportedScores(game)) continue;
  //
  // so that game gets no entry in the grades map at all — and `null` here, "no
  // grade", is exactly how this function spells that. Ordered AFTER the
  // CANCELLED branch because the engine checks its scoreless gate only on
  // FINAL: a cancelled game is VOID whatever its scores say.
  //
  // Without this line the `?? 0` below read a scoreless FINAL as 0-0: a
  // harmless PUSH straight-up, but a decided W or L in ATS, because the spread
  // moves the adjusted home score off the tie. Both the pick sheet and the
  // Current Picks grid then announced a verdict on a game the scorer is still
  // refusing to grade. The sheet gated this in `pickSheet/pickOutcome.ts` when
  // `src/utils/` belonged to another workstream (#568); fixing it at the root
  // is what makes the GRID agree too — `picksGrid.ts` calls straight into here.
  if (!hasReportedScores(game)) return null;

  // `?? 0` is unreachable after the guard above and kept only because it is the
  // engine's own expression; changing it would make the two rules read
  // differently for no behavioural gain.
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
