import { squaresGameLink } from '@shared/squaresDefaults';
import { hasStarted, type ScheduleGame } from '../services/espnSchedule';

/**
 * Link a squares pool on the manage page to a game picked from the schedule —
 * and SAY IT IS LINKED ONLY ONCE IT IS.
 *
 * The page called its update and showed "Linked to …" on the next line. The
 * update is a write that can be refused (the rules stop a commissioner
 * changing a pool that has closed, a connection can drop), so the page could
 * say a game was linked while the pool had not changed — and close the
 * picker, leaving nothing on screen to show otherwise (qodo, PR #762).
 *
 * This is everything the link does except the two things only a component
 * can: it does not toast and it does not close anything. It reports what
 * happened, and the page acts on that.
 *
 *   - `linked`    — the write went through. `name` is set if the pool was
 *                   given one because it had none.
 *   - `started`   — the game has kicked off, by the SERVER's clock or by the
 *                   feed's own state. Nothing was written. The picker greys
 *                   such a game out, but a greyed-out button was the only
 *                   thing that refused it (qodo, PR #760): a grid linked to
 *                   a game under way locks at once on whatever numbers it
 *                   has. Refusing it on the server as well is plan K11.
 *   - `not-a-game`— the game could not be turned into a link (no id, no
 *                   kickoff). Nothing was written.
 *   - `not-saved` — the write was refused or failed. Nothing changed.
 */
export type LinkOutcome =
  | { status: 'linked'; name: string | null }
  | { status: 'started' }
  | { status: 'not-a-game' }
  | { status: 'not-saved' };

/** How many names are tried — the matchup, then "(2)" … — before giving up on renaming. */
export const NAME_SEARCH_LIMIT = 50;

export interface LinkablePool {
  name?: string | null;
  reminders?: unknown;
  scores?: unknown;
  /** The game the pool is linked to now. A different one starts from fresh scores. */
  gameId?: unknown;
}

export async function linkSquaresGame(input: {
  game: ScheduleGame;
  pool: LinkablePool;
  /** Is this pool name free? Asked only when the pool has no name of its own. */
  nameIsFree: (name: string) => boolean;
  /** The pool write. May return a promise; a rejection means nothing was saved. */
  save: (patch: Record<string, unknown>) => unknown;
  /** The clock kickoff is judged by — the server-corrected one. */
  nowMs: () => number;
}): Promise<LinkOutcome> {
  const { game, pool } = input;
  if (hasStarted(game, input.nowMs())) return { status: 'started' };
  // The league the game was found in travels with it (see useScheduleSearch).
  const patch = squaresGameLink(game, game.league, { reminders: pool.reminders, scores: pool.scores, gameId: pool.gameId });
  if (!patch) return { status: 'not-a-game' };

  // The pool keeps its name unless it never had one. A name is only ever
  // written after it has been checked: the search used to stop at "(49)" and
  // use that one unasked (qodo, PR #760). If nothing up to there is free the
  // pool is linked and keeps the name it has.
  const unnamed = !pool.name || pool.name === 'New Pool';
  let name: string | null = null;
  if (unnamed) {
    const matchup = `${game.awayTeam} @ ${game.homeTeam}`;
    for (let n = 1; n < NAME_SEARCH_LIMIT && name === null; n++) {
      const candidate = n === 1 ? matchup : `${matchup} (${n})`;
      if (input.nameIsFree(candidate)) name = candidate;
    }
  }

  try {
    await input.save({ ...(patch as Record<string, unknown>), ...(name ? { name } : {}) });
  } catch {
    return { status: 'not-saved' };
  }
  return { status: 'linked', name };
}
