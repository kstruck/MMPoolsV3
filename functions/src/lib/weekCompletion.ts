// Is a week's scoring pass a COMPLETE one, or a provisional mid-week one?
//
// Lives in lib/ rather than beside the scorer because both the scorer and the
// scheduled job need it, and pulling it from nflPools.ts would drag the whole
// firebase-admin module graph (billing.ts calls admin.firestore() at load) into
// anything that only wants the predicate. Pure + framework-free, so it is
// unit-testable without an emulator.

import { effectiveLockSettings, isGameLocked as isGameLockedAt } from './effectiveLock';
import type { NFLGame } from '../nflPoolTypes';

/**
 * Is this game concluded? CANCELLED counts — the engines grade it (VOID / net 0 /
 * survive), so it is as settled as a FINAL for scoring purposes.
 */
export function isTerminalGame(g: Pick<NFLGame, 'status'>): boolean {
  return g.status === 'FINAL' || g.status === 'CANCELLED';
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
  return games.every(g =>
    isTerminalGame(g) && isGameLockedAt(now, g.startTime, week, lockSettings),
  );
}
