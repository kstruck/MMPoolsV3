// Does this pool lock the whole week, or each game on its own?
//
// ONE definition, because the answer decides whether a member can still edit a
// pick — and until this file existed the rule was written out by hand in six
// places (two client, four server) and two of the server copies had already
// drifted by dropping `confidenceMode`.
//
// ⚠️ THE CLIENT GOT THIS WRONG IN PRODUCTION, WHICH IS WHY THIS FILE EXISTS.
// `NFLPoolDashboard` computed a single week lock from the week's EARLIEST
// kickoff for every NFL pool type and never read `lockMode`, and
// `PickemPickEntry` then treated every game as locked once that flag was set.
// So a PER_GAME Pick'em pool — the wizard default — closed its whole sheet at
// the Thursday night kickoff, while `submitNFLPicks` would still have accepted
// a Sunday pick. Kevin's ruling, 2026-08-18: **the pool manager makes the
// decision on that option and the site must abide by that option selection.**
//
// Lives in `shared/` so the client and `functions/` cannot disagree about it.

import {
  usesWeeklyHardLock,
  normalizeLockBufferMinutes,
  resolveHardWeekLock,
  frozenHardLockFor,
  DEFAULT_LOCK_BUFFER_MINUTES,
} from './weeklyHardLock';

/** WEEKLY: one deadline for the whole week. PER_GAME: each game on its own. */
export type NFLLockMode = 'WEEKLY' | 'PER_GAME';

/** The settings this rule reads. Deliberately narrow. */
export interface NFLLockModeSettings {
  lockMode?: string;
  confidenceMode?: boolean;
}

/**
 * The lock mode a pool actually plays, folding in the two rules that override
 * the stored setting.
 *
 * 1. **Survivor and Margin are always WEEKLY**, derived from the pool TYPE and
 *    never from stored settings, so no settings write (or missing field) can
 *    downgrade one to per-game locking. `shared/weeklyHardLock.ts` carries the
 *    reasoning: those formats make ONE pick a week and the submit path only
 *    checks the newly selected team's kickoff, so per-game locking there would
 *    let a member replace a locked Thursday selection after seeing the result.
 *
 * 2. **Confidence mode forces WEEKLY on Pick'em**, whatever `lockMode` says.
 *    A confidence sheet spends each weight across the week's games exactly
 *    once, so the week has to be answered as one unit. This is the clause the
 *    two drifted server copies dropped, and it is the easy one to miss because
 *    such a pool's `lockMode` still reads `PER_GAME`.
 *
 * Mirrors `functions/src/nflPools.ts:568` (`submitNFLPicks`) and
 * `functions/src/lib/pickReveal.ts:71`. `tests/nfl-lockmode-parity.test.ts`
 * fails if those stop agreeing with this.
 */
export function nflLockMode(
  poolType: string | undefined | null,
  settings: NFLLockModeSettings | undefined | null,
): NFLLockMode {
  if (usesWeeklyHardLock(poolType)) return 'WEEKLY';
  return settings?.confidenceMode || settings?.lockMode === 'WEEKLY' ? 'WEEKLY' : 'PER_GAME';
}

/** Convenience for the many call sites that only ask the yes/no question. */
export function usesWeeklyLock(
  poolType: string | undefined | null,
  settings: NFLLockModeSettings | undefined | null,
): boolean {
  return nflLockMode(poolType, settings) === 'WEEKLY';
}

/**
 * A commissioner's `extendWeekDeadline` for this week, in epoch ms, or
 * `undefined` when there is none that applies.
 *
 * Hard-lock pools get `undefined` even when a value is stored: `extendWeekDeadline`
 * refuses those types outright (`HARD_WEEKLY_LOCK`) and `proxyPick` drops the
 * override for them, so honouring one here would open a sheet the server keeps
 * shut. Firestore map keys arrive as strings, so both spellings are read — the
 * same allowance `frozenHardLockFor` makes.
 */
export function weekLockOverrideFor(
  pool: { type?: string; settings?: { weekLockOverrides?: Record<string | number, unknown> } } | undefined | null,
  week: number,
): number | undefined {
  if (usesWeeklyHardLock(pool?.type)) return undefined;
  const raw = pool?.settings?.weekLockOverrides?.[week] ?? pool?.settings?.weekLockOverrides?.[String(week)];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

/**
 * When one game's pick closes, in epoch ms.
 *
 * The same arithmetic `functions/src/lib/effectiveLock.ts` `effectiveGameLockAt`
 * does: kickoff minus the buffer, and an override may only ever move it LATER.
 */
export function gameLockAt(
  gameStartTime: number,
  bufferMinutes: number,
  overrideMs?: number,
): number {
  const base = gameStartTime - bufferMinutes * 60_000;
  return typeof overrideMs === 'number' ? Math.max(base, overrideMs) : base;
}

/** What the lock helpers need off a pool doc. Structural, so tests need no fixture. */
export interface NFLLockPool {
  type?: string;
  settings?: {
    lockMode?: string;
    confidenceMode?: boolean;
    lockBufferMinutes?: number;
    weekLockOverrides?: Record<string | number, unknown>;
  };
  hardLockByWeek?: Record<string | number, unknown>;
}

/** The buffer this pool actually enforces, snapped to a preset on hard-lock types. */
export function lockBufferMinutesFor(pool: NFLLockPool | undefined | null): number {
  return usesWeeklyHardLock(pool?.type)
    ? normalizeLockBufferMinutes(pool?.settings?.lockBufferMinutes)
    : (pool?.settings?.lockBufferMinutes ?? DEFAULT_LOCK_BUFFER_MINUTES);
}

/**
 * The instant this WEEK is closed — no pick in it can be edited afterwards.
 *
 * ⚠️ THE REFERENCE KICKOFF DEPENDS ON THE MODE, and taking it from the earliest
 * kickoff unconditionally was the production defect this module exists to fix.
 * A PER_GAME week is not over until its LAST game has started: the Thursday
 * game locking does not close Sunday.
 *
 * Hard-lock pools additionally honour the earliest deadline ever frozen for the
 * week, so a widened buffer cannot reopen one. Everything else honours a
 * commissioner's extension, which may only move the deadline later.
 */
export function weekLockAtFor(
  pool: NFLLockPool | undefined | null,
  week: number,
  gameStartTimes: readonly number[],
): number | null {
  if (gameStartTimes.length === 0) return null;
  const mode = nflLockMode(pool?.type, pool?.settings);
  const reference = mode === 'PER_GAME' ? Math.max(...gameStartTimes) : Math.min(...gameStartTimes);
  const computed = reference - lockBufferMinutesFor(pool) * 60_000;
  if (usesWeeklyHardLock(pool?.type)) {
    return resolveHardWeekLock(frozenHardLockFor(pool, week), computed);
  }
  const override = weekLockOverrideFor(pool, week);
  return typeof override === 'number' ? Math.max(computed, override) : computed;
}

/**
 * The soonest lock still ahead of `now`, for a countdown.
 *
 * On a weekly pool this is the week deadline. On a PER_GAME pool the week
 * deadline is the LAST game's, which is right for "is the week over" and wrong
 * to count down to — it would tell a member they have until Sunday evening to
 * make a Thursday pick. Falls back to the week deadline once nothing is left.
 */
export function nextLockAtFor(
  pool: NFLLockPool | undefined | null,
  week: number,
  gameStartTimes: readonly number[],
  now: number,
): number | null {
  const weekLockAt = weekLockAtFor(pool, week, gameStartTimes);
  if (weekLockAt === null) return null;
  if (nflLockMode(pool?.type, pool?.settings) === 'WEEKLY') return weekLockAt;
  const buffer = lockBufferMinutesFor(pool);
  const override = weekLockOverrideFor(pool, week);
  const upcoming = gameStartTimes
    .map((t) => gameLockAt(t, buffer, override))
    .filter((at) => at > now);
  return upcoming.length > 0 ? Math.min(...upcoming) : weekLockAt;
}

/**
 * The picks a submission may carry, with stale locked ones removed.
 *
 * `submitNFLPicks` refuses a locked game whose pick CHANGED, and it refuses the
 * WHOLE submission when it does. So a member who selected a Thursday game,
 * never saved it, and returns on Sunday would have every open Sunday pick
 * rejected because of one selection they can no longer edit.
 *
 * A locked pick that MATCHES what the server already holds is kept — the server
 * compares rather than rejects, so sending it costs nothing and keeping it makes
 * the payload a straightforward picture of the sheet.
 *
 * Returns the ids that were dropped as well, because dropping one silently is
 * indistinguishable to the member from the app losing their pick.
 */
export function dropStaleLockedPicks(
  gameIds: readonly string[],
  picks: Readonly<Record<string, string>>,
  savedPicks: Readonly<Record<string, string>>,
  isLocked: (gameId: string) => boolean,
): { picks: Record<string, string>; droppedGameIds: string[] } {
  const droppedGameIds = gameIds.filter(
    (id) => isLocked(id) && picks[id] !== undefined && picks[id] !== savedPicks[id],
  );
  if (droppedGameIds.length === 0) return { picks: { ...picks }, droppedGameIds };
  const dropped = new Set(droppedGameIds);
  return {
    picks: Object.fromEntries(Object.entries(picks).filter(([id]) => !dropped.has(id))),
    droppedGameIds,
  };
}
