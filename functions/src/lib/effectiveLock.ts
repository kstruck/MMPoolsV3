// Single source of truth for when a pick locks. Folds in the lock buffer, the per-game
// kickoff, and a commissioner's per-week deadline override (which can only push the lock
// LATER). Every lock decision path — submitNFLPicks, proxyPick, poolExceptions, and the
// consensus reveal/publish timing — must use these so the rules never drift (ADR 0004).
// Pure + framework-free so it is unit-testable and shared by src/ and functions/.

export interface LockSettings {
  lockBufferMinutes?: number;
  weekLockOverrides?: Record<number, number>;
}

export function lockBufferMs(settings: LockSettings | undefined): number {
  return (settings?.lockBufferMinutes ?? 5) * 60 * 1000;
}

/** Effective lock time (epoch ms) for one game in a given week. A week override extends it later. */
export function effectiveGameLockAt(gameStartTime: number, week: number, settings: LockSettings | undefined): number {
  const base = gameStartTime - lockBufferMs(settings);
  const override = settings?.weekLockOverrides?.[week];
  return override !== undefined ? Math.max(base, override) : base;
}

/** Effective WEEK lock = the effective lock of the earliest game in the week. */
export function effectiveWeekLockAt(gameStartTimes: number[], week: number, settings: LockSettings | undefined): number {
  if (gameStartTimes.length === 0) return Number.POSITIVE_INFINITY;
  return effectiveGameLockAt(Math.min(...gameStartTimes), week, settings);
}

export function isGameLocked(now: number, gameStartTime: number, week: number, settings: LockSettings | undefined): boolean {
  return now >= effectiveGameLockAt(gameStartTime, week, settings);
}

export function isWeekLocked(now: number, gameStartTimes: number[], week: number, settings: LockSettings | undefined): boolean {
  return now >= effectiveWeekLockAt(gameStartTimes, week, settings);
}
