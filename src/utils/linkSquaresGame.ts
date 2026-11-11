import { squaresGameLink } from '@shared/squaresDefaults';
import { hasStarted, type ScheduleGame } from '../services/espnSchedule';

/**
 * Link a squares pool on the manage page to a game picked from the schedule —
 * and SAY IT IS LINKED ONLY ONCE IT IS.
 *
 * THE LINK IS MADE BY THE SERVER (PLAN-SQUARES-SERVER-FIELDS; plan K11). The
 * page used to write the game, kickoff and teams onto the pool itself, as the
 * browser described them. Now it sends the event id to `linkSquaresPoolGame`,
 * which looks the game up in the score feed and stores what the feed says —
 * and firestore.rules refuses the old direct write. The kickoff check below
 * stays, so a game the picker already shows as started is not sent at all;
 * the server makes the same check where it cannot be skipped.
 *
 * This is everything the link does except the two things only a component
 * can: it does not toast and it does not close anything. It reports what
 * happened, and the page acts on that.
 *
 *   - `linked`    — the server linked it. `name` is set if the pool was
 *                   given one because it had none.
 *   - `started`   — the game has kicked off, by the server-corrected clock or
 *                   by the feed's own state. Nothing was sent.
 *   - `not-a-game`— the game could not be turned into a link (no id, no
 *                   kickoff). Nothing was sent.
 *   - `not-saved` — the server refused or could not be reached. Nothing
 *                   changed. `message` is the server's own explanation when
 *                   it gave one (the game has started, the grid is locked,
 *                   the schedule could not be reached).
 */
export type LinkOutcome =
  | { status: 'linked'; name: string | null }
  | { status: 'started' }
  | { status: 'not-a-game' }
  | { status: 'not-saved'; message?: string };

/** How many names are tried — the matchup, then "(2)" … — before giving up on renaming. */
export const NAME_SEARCH_LIMIT = 50;

export interface LinkablePool {
  name?: string | null;
  reminders?: unknown;
  scores?: unknown;
}

/** Server refusals whose message is written for the commissioner (see linkSquaresPoolGame). */
const EXPLAINED = new Set(['functions/failed-precondition', 'functions/not-found', 'functions/unavailable', 'functions/permission-denied']);

function serverMessage(err: unknown): string | undefined {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e || typeof e.code !== 'string' || !EXPLAINED.has(e.code)) return undefined;
  return typeof e.message === 'string' && e.message.trim() ? e.message : undefined;
}

export async function linkSquaresGame(input: {
  game: ScheduleGame;
  pool: LinkablePool;
  /** Is this pool name free? Asked only when the pool has no name of its own. */
  nameIsFree: (name: string) => boolean;
  /** The server link (`linkSquaresPoolGame`). A rejection means nothing was linked. */
  link: (gameId: string, league: 'nfl' | 'college') => Promise<unknown>;
  /** The pool-name write, made only after the link has landed. */
  saveName: (name: string) => unknown;
  /** The clock kickoff is judged by — the server-corrected one. */
  nowMs: () => number;
}): Promise<LinkOutcome> {
  const { game, pool } = input;
  if (hasStarted(game, input.nowMs())) return { status: 'started' };
  // Only a game that could be stored as a link is sent (same test the server's
  // write makes, through the same shared function).
  if (!squaresGameLink(game, game.league, { reminders: pool.reminders, scores: pool.scores })) return { status: 'not-a-game' };

  try {
    await input.link(game.id, game.league === 'college' ? 'college' : 'nfl');
  } catch (err) {
    const message = serverMessage(err);
    return message ? { status: 'not-saved', message } : { status: 'not-saved' };
  }

  // The pool keeps its name unless it never had one. A name is only ever
  // written after it has been checked: the search used to stop at "(49)" and
  // use that one unasked (qodo, PR #760). If nothing up to there is free the
  // pool is linked and keeps the name it has. The name is not part of the
  // link: if its write fails the pool is still linked, under its old name.
  const unnamed = !pool.name || pool.name === 'New Pool';
  let name: string | null = null;
  if (unnamed) {
    const matchup = `${game.awayTeam} @ ${game.homeTeam}`;
    for (let n = 1; n < NAME_SEARCH_LIMIT && name === null; n++) {
      const candidate = n === 1 ? matchup : `${matchup} (${n})`;
      if (input.nameIsFree(candidate)) name = candidate;
    }
  }
  if (name !== null) {
    try {
      await input.saveName(name);
    } catch {
      name = null;
    }
  }
  return { status: 'linked', name };
}
