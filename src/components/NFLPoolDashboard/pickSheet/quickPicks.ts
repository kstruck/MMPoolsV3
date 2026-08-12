import type { NFLGame } from '../../../types';

/**
 * "Quick Picks" — one press fills the sheet instead of sixteen.
 *
 * Kevin's testers, 2026-08-11: the complaint was the NUMBER OF PRESSES, and a
 * sixteen-game pick'em sheet is sixteen taps before the save. This is the
 * autofill half of the answer (the sticky save bar was the other half).
 *
 * ⚠️ THERE IS DELIBERATELY NO "OPTIMAL PICKS" STRATEGY. Kevin's instruction,
 * 2026-08-12, verbatim: no "Optimal/premium picks" option. Every strategy here
 * is a mechanical read of data already on the row — the favourite is whichever
 * side the stored line favours, home is home — so nothing here is advice and
 * nothing here needs a model behind it.
 *
 * ## Two rules that shape the whole module
 *
 * 1. **A game with no line is SKIPPED, never guessed.** Preseason weeks 3 and 4
 *    currently carry ZERO lines across 32 games, so the spread strategies are
 *    normally partial rather than complete, and the caller is expected to say
 *    so before the member presses anything. `pickCount`/`skipCount` exist to be
 *    rendered in the dialog, not just returned.
 * 2. **It only fills EMPTY games.** A member who has already picked twelve
 *    games and presses Favorites keeps those twelve. There is no undo on this
 *    sheet, so an autofill that overwrote saved picks would be a one-press way
 *    to lose a week's work. (ponytail: fill-only. If Kevin wants a destructive
 *    "replace everything" variant it is one extra strategy flag, not a
 *    redesign.)
 */

export type QuickPickStrategy = 'FAVORITES' | 'UNDERDOGS' | 'HOME' | 'AWAY';

export interface QuickPickPlan {
  /** gameId → team abbreviation, for the games this strategy could decide. */
  picks: Record<string, string>;
  /** How many games it would fill. */
  pickCount: number;
  /**
   * Games it deliberately left alone because the strategy needs a line and the
   * game has none (or the line is a pick'em, which has no favourite). Rendered
   * to the member BEFORE they choose — "3 games have no line yet".
   */
  skipCount: number;
}

/**
 * The side the stored line favours, or `null` when the line cannot name one.
 *
 * `spread.value` is stored HOME-RELATIVE (negative = home favoured), the same
 * convention `spreadLabel` in `GameMeta` reads. A stored `0` is a pick'em: both
 * sides are equal, so there is no favourite and no underdog, and returning
 * either one would be inventing a preference the data does not hold.
 */
export function favouredSide(game: NFLGame): 'home' | 'away' | null {
  const v = game.spread?.value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return null;
  return v < 0 ? 'home' : 'away';
}

/**
 * Build the fill for one strategy.
 *
 * `eligible` is the caller's rule for "this game can still be picked" — locked
 * games must not move, and the sheet already owns that clock-corrected
 * predicate. Passing it in keeps ONE definition of locked rather than a second
 * copy here that could disagree with the one the buttons use.
 *
 * `existing` is the sheet's current picks map; a game already in it is left
 * alone (see rule 2 above).
 */
export function planQuickPicks(
  games: NFLGame[],
  strategy: QuickPickStrategy,
  existing: Record<string, string>,
  eligible: (game: NFLGame) => boolean,
): QuickPickPlan {
  const picks: Record<string, string> = {};
  let skipCount = 0;

  for (const game of games) {
    if (existing[game.id]) continue;
    if (!eligible(game)) continue;

    let side: 'home' | 'away' | null;
    if (strategy === 'HOME') {
      side = 'home';
    } else if (strategy === 'AWAY') {
      side = 'away';
    } else {
      const favoured = favouredSide(game);
      if (favoured === null) {
        // No line, or a pick'em line. The whole point of the module.
        skipCount++;
        continue;
      }
      side = strategy === 'FAVORITES' ? favoured : (favoured === 'home' ? 'away' : 'home');
    }

    const abbr = side === 'home' ? game.homeTeam?.abbreviation : game.awayTeam?.abbreviation;
    // A game missing a team abbreviation cannot be picked by abbreviation, which
    // is the only key the pick map and the server both speak. Skipping it is not
    // the same fact as "no line", so it does not inflate skipCount — the member
    // is told about missing LINES, and a malformed game document is not one.
    if (!abbr) continue;
    picks[game.id] = abbr;
  }

  return { picks, pickCount: Object.keys(picks).length, skipCount };
}
