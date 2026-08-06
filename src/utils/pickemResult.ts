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
