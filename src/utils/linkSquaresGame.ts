import { squaresGameLink } from '@shared/squaresDefaults';
import type { ScheduleGame } from '../services/espnSchedule';

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
 *   - `not-a-game`— the game could not be turned into a link (no id, no
 *                   kickoff). Nothing was written.
 *   - `not-saved` — the write was refused or failed. Nothing changed.
 */
export type LinkOutcome =
  | { status: 'linked'; name: string | null }
  | { status: 'not-a-game' }
  | { status: 'not-saved' };

export interface LinkablePool {
  name?: string | null;
  reminders?: unknown;
  scores?: unknown;
}

export async function linkSquaresGame(input: {
  game: ScheduleGame;
  pool: LinkablePool;
  /** Is this pool name free? Asked only when the pool has no name of its own. */
  nameIsFree: (name: string) => boolean;
  /** The pool write. May return a promise; a rejection means nothing was saved. */
  save: (patch: Record<string, unknown>) => unknown;
}): Promise<LinkOutcome> {
  const { game, pool } = input;
  // The league the game was found in travels with it (see useScheduleSearch).
  const patch = squaresGameLink(game, game.league, { reminders: pool.reminders, scores: pool.scores });
  if (!patch) return { status: 'not-a-game' };

  // The pool keeps its name unless it never had one.
  const unnamed = !pool.name || pool.name === 'New Pool';
  let name: string | null = null;
  if (unnamed) {
    name = `${game.awayTeam} @ ${game.homeTeam}`;
    for (let n = 2; !input.nameIsFree(name) && n < 50; n++) name = `${game.awayTeam} @ ${game.homeTeam} (${n})`;
  }

  try {
    await input.save({ ...(patch as Record<string, unknown>), ...(name ? { name } : {}) });
  } catch {
    return { status: 'not-saved' };
  }
  return { status: 'linked', name };
}
