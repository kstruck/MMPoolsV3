import type { WeeklyRecap } from '../types';

/**
 * How a weekly recap's "Sharp of the Week" value reads, per pool type.
 *
 * `sharpOfWeek.score` is one field carrying two different quantities, because
 * one recap shape serves every NFL pool type:
 *  - Pick'em  — accumulated POINTS for the week (confidence-weighted or 1/game).
 *  - Margin   — a MARGIN OF VICTORY, which is signed and is not a point total.
 *
 * Rendering the Margin number as "12 pts" is simply wrong, and rendering "-3"
 * without its sign as a point total is worse. The sign is explicit on the
 * positive side too: in a Margin pool "+12" and "12" mean the same thing but
 * only the first reads as a margin.
 */
export function formatSharpScore(poolType: string | undefined, score: number): string {
  if (poolType === 'NFL_MARGIN') {
    return `${score > 0 ? '+' : ''}${score} margin`;
  }
  return `${score} pts`;
}

/**
 * Does this recap have anything to say?
 *
 * `buildWeeklyRecap` writes only the fields it has, so a recap can legitimately
 * carry nothing but id/poolId/week/createdAt — a Margin week where every member
 * no-showed, or a Pick'em week where nothing was gradable. The card previously
 * rendered its header and then an empty body in that case, which reads as a
 * broken page rather than as a quiet week.
 */
export function recapHasHighlights(recap: WeeklyRecap): boolean {
  return (
    Boolean(recap.weeklyWinners?.length) ||
    Boolean(recap.weeklyPlaces?.length) ||
    Boolean(recap.weeklyPlacesError) ||
    Boolean(recap.sharpOfWeek) ||
    Boolean(recap.closestTiebreaker) ||
    recap.attritionCount !== undefined
  );
}

/**
 * How the weekly-winner line reads.
 *
 * Two decisions live here rather than in JSX, so the rules cannot drift apart
 * in a template:
 *
 *  - **The word "Winner" is gated on `payoutMode`.** On a SEASON pool nothing is
 *    won weekly, and a trophy line would imply a prize that does not exist. The
 *    same data is honest as "Top Scorer".
 *  - **A shared win says so.** More than one name is the ordinary outcome of a
 *    tie the pool's tiebreaker cannot separate — see `computeWeeklyWinners`. It
 *    is never an error, and it must never render as if one of them won.
 */
export function weeklyWinnerLabel(payoutMode: string | undefined, shared: boolean): string {
  if (payoutMode !== 'WEEKLY' && payoutMode !== 'HYBRID') {
    return shared ? 'Top Scorers (tied)' : 'Top Scorer';
  }
  return shared ? 'Weekly Winners (shared)' : 'Weekly Winner';
}
