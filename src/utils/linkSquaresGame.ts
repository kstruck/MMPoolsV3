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
 *   - `played`    — the pool already played ANOTHER game (winner records, a
 *                   score history, or scores showing play). Nothing was written.
 *   - `not-ready` — a change of game, but the winner records are not known
 *                   yet. Nothing was written.
 *   - `not-a-game`— the game could not be turned into a link (no id, no
 *                   kickoff). Nothing was written.
 *   - `not-saved` — the write was refused or failed. Nothing changed.
 */
export type LinkOutcome =
  | { status: 'linked'; name: string | null }
  | { status: 'started' }
  | { status: 'played' }
  | { status: 'not-ready' }
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
  /** The score history the sync keeps on the pool — evidence the grid has been played. */
  scoreEvents?: unknown;
}

/**
 * Has this grid PLAYED a game? Winner records, a score history, or scores that
 * show play (under way, over, a period, points). A grid that has cannot be
 * moved to another game (qodo, PR #760): its winner records, any final-prize
 * draw and the sync's per-pool score markers belong to the game it played.
 * The server refuses the same thing in `linkSquaresPoolGame` (#765).
 */
export function squaresGridHasPlayed(pool: LinkablePool, winnerCount: number): boolean {
  if (winnerCount > 0) return true;
  if (Array.isArray(pool.scoreEvents) && pool.scoreEvents.length > 0) return true;
  const s = (pool.scores ?? null) as { gameStatus?: unknown; q1?: unknown; half?: unknown; q3?: unknown; final?: unknown; current?: { home?: unknown; away?: unknown } | null } | null;
  if (!s) return false;
  if (s.gameStatus === 'in' || s.gameStatus === 'post') return true;
  if (s.q1 || s.half || s.q3 || s.final) return true;
  return (Number(s.current?.home) || 0) > 0 || (Number(s.current?.away) || 0) > 0;
}

export async function linkSquaresGame(input: {
  game: ScheduleGame;
  pool: LinkablePool;
  /**
   * How many winner records the pool has. Any at all means the grid has been
   * played. `null` means NOT KNOWN — the records have not loaded, or could not
   * be read — and a change of game is then refused as `not-ready` rather than
   * read as "none" (qodo, PR #760).
   */
  winnerCount?: number | null;
  /** Is this pool name free? Asked only when the pool has no name of its own. */
  nameIsFree: (name: string) => boolean;
  /** The pool write. May return a promise; a rejection means nothing was saved. */
  save: (patch: Record<string, unknown>) => unknown;
  /** The clock kickoff is judged by — the server-corrected one. */
  nowMs: () => number;
}): Promise<LinkOutcome> {
  const { game, pool } = input;
  if (hasStarted(game, input.nowMs())) return { status: 'started' };
  // Another game on a grid that has already played one: refused, nothing written.
  if (pool.gameId !== game.id) {
    if (input.winnerCount === null) return { status: 'not-ready' };
    if (squaresGridHasPlayed(pool, input.winnerCount ?? 0)) return { status: 'played' };
  }
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
