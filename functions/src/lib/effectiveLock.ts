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

// ---------------------------------------------------------------------------
// Weekly HARD lock (Kevin's ruling 2026-07-25) — Survivor + Margin
// ---------------------------------------------------------------------------

// The preset list and the type predicate live in shared/ because the client
// gates its pick UI on the same deadline the server enforces — see
// shared/weeklyHardLock.ts for why these pools need it at all. Re-exported here
// so lock callers have a single import site.
import { usesWeeklyHardLock, normalizeLockBufferMinutes, resolveHardWeekLock } from '../shared/weeklyHardLock';

export {
  LOCK_BUFFER_PRESETS,
  DEFAULT_LOCK_BUFFER_MINUTES,
  usesWeeklyHardLock,
  normalizeLockBufferMinutes,
  resolveHardWeekLock,
} from '../shared/weeklyHardLock';

/** Where the frozen per-week deadline lives on the pool doc. */
export function frozenHardLockFor(
  pool: { hardLockByWeek?: Record<string | number, unknown> } | undefined,
  week: number,
): number | undefined {
  const raw = pool?.hardLockByWeek?.[week] ?? pool?.hardLockByWeek?.[String(week)];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

/**
 * The authoritative week deadline for a pool, folding in the hard-lock rules and
 * the earliest-ever freeze. Returns the lock instant plus whether the freeze
 * needs persisting (callers in a write path should store it; read-only callers
 * can ignore it and still get the correct instant).
 */
export function weekLockDecision(
  pool: { type?: string; settings?: LockSettings; hardLockByWeek?: Record<string | number, unknown> } | undefined,
  week: number,
  gameStartTimes: number[],
): { lockAt: number; freezeTo?: number } {
  const settings = effectiveLockSettings(pool?.settings, pool?.type);
  const computed = effectiveWeekLockAt(gameStartTimes, week, settings);
  if (!usesWeeklyHardLock(pool?.type)) return { lockAt: computed };

  const frozen = frozenHardLockFor(pool, week);
  const lockAt = resolveHardWeekLock(frozen, computed);
  return { lockAt, freezeTo: lockAt !== frozen ? lockAt : undefined };
}

/**
 * Normalizes the settings every lock calculation reads, so callers keep their
 * existing signatures and cannot forget the hard-lock rules:
 * - buffer snapped to an allowed preset (a garbage or absent value can never
 *   move the deadline to/after kickoff, which is what makes the lock "hard");
 * - `weekLockOverrides` DROPPED for hard-lock pools, since an override applies
 *   with Math.max and could push the deadline past a kickoff that has already
 *   happened — reopening picks on a game whose result is known.
 *
 * Pick'em is unchanged: it locks per game and its picks are already immutable
 * once their own game locks, so it keeps commissioner extensions.
 */
export function effectiveLockSettings(
  settings: LockSettings | undefined,
  poolType: string | undefined,
): LockSettings {
  if (!usesWeeklyHardLock(poolType)) return settings ?? {};
  return { lockBufferMinutes: normalizeLockBufferMinutes(settings?.lockBufferMinutes) };
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
