// Is a week's scoring pass a COMPLETE one, or a provisional mid-week one?
//
// Lives in lib/ rather than beside the scorer because both the scorer and the
// scheduled job need it, and pulling it from nflPools.ts would drag the whole
// firebase-admin module graph (billing.ts calls admin.firestore() at load) into
// anything that only wants the predicate. Pure + framework-free, so it is
// unit-testable without an emulator.

import { effectiveLockSettings, isGameLocked as isGameLockedAt } from './effectiveLock';
import { hasReportedScores } from '../nflScoringEngine';
import type { NFLGame } from '../nflPoolTypes';

/**
 * Is this game concluded? CANCELLED counts — the engines grade it (VOID / net 0 /
 * survive), so it is as settled as a FINAL for scoring purposes.
 *
 * A `FINAL` counts only once the feed has actually reported both scores
 * (defect NFL7-3/NFL7-4). A scoreless FINAL is a broken payload, not a played
 * game, and treating it as concluded is what let a partial feed mark the week
 * complete, write the recap and FINALIZE a one-game preseason season on a result
 * nobody played. Staying non-terminal makes the week incomplete, so the scorer
 * simply waits and self-heals on the run after the scores arrive.
 *
 * CANCELLED is deliberately unconditional: a cancelled game has no scores BY
 * DEFINITION, and that is not missing data.
 */
export function isTerminalGame(g: Pick<NFLGame, 'status' | 'scores'>): boolean {
  if (g.status === 'CANCELLED') return true;
  return g.status === 'FINAL' && hasReportedScores(g);
}

/**
 * Would this week's scoring pass be a COMPLETE one — every game concluded and
 * every concluded game past its own effective lock?
 *
 * The lock-closed half is not redundant with "terminal". A Pick'em commissioner
 * can push one game's lock LATER with `settings.weekLockOverrides`, so a game can
 * be `FINAL` while its pick window is still open; revealing it would show the
 * result to members who can still change their pick. Survivor/Margin cannot reach
 * that state (`effectiveLockSettings` drops their overrides), but the same
 * predicate covers all three types.
 *
 * ONE definition, used by the scoring callable, the scheduled scorer and the
 * tests — three drifting copies of this is how a reveal gate ends up applying in
 * one path and not another.
 */
export function isWeekComplete(
  pool: { type?: string; settings?: unknown } | undefined | null,
  week: number,
  games: NFLGame[],
  now: number,
): boolean {
  const lockSettings = effectiveLockSettings(pool?.settings as never, pool?.type);
  // `games.length > 0` first: `every` is vacuously TRUE for an empty array, so
  // without it an empty slate reads as a fully-concluded week and the caller
  // derives `provisional: false` — stamping `scoredWeeks`, writing the recap and
  // finalizing a season off a slate it could not read (defect NFL7-5). Latent
  // rather than live — every caller today guards `games.length` itself — but the
  // failure would be silent and total, and the guard is one term.
  return games.length > 0 && games.every(g =>
    isTerminalGame(g) && isGameLockedAt(now, g.startTime, week, lockSettings),
  );
}
