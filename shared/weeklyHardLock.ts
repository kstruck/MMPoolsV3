// The Survivor/Margin HARD weekly deadline (Kevin's ruling 2026-07-25).
//
// Lives in shared/ because BOTH sides must agree on it: the server enforces the
// deadline, and the client gates its pick UI on the same number. When they
// disagree the member is either shown a pick form the server will reject, or
// told they are locked while the server would still accept — both look like bugs.
//
// Why these pools need it: Survivor and Margin have ONE pick per week, and the
// submit path only checks the newly selected team's kickoff — so without a hard
// weekly deadline a member could replace a locked Thursday selection with a
// Sunday team AFTER seeing the Thursday result. That also makes live per-game
// scoring unsafe for them. A single deadline before the week's first kickoff
// closes both.

/** Buffer presets, in minutes before the week's first kickoff. Widest first. */
export const LOCK_BUFFER_PRESETS = [60, 30, 5] as const;

export const DEFAULT_LOCK_BUFFER_MINUTES = 5;

/**
 * Pool types that run the hard weekly deadline. Derived from the pool TYPE and
 * never from stored settings, so no settings write (or missing field) can
 * downgrade one of these to per-game locking.
 */
export function usesWeeklyHardLock(poolType: string | undefined | null): boolean {
  return poolType === 'NFL_SURVIVOR' || poolType === 'NFL_MARGIN';
}

/**
 * Snap a stored or client-supplied buffer to an allowed preset.
 *
 * Every preset is strictly positive, which is the property that makes the lock
 * "hard": the deadline always lands BEFORE the first kickoff. A stored `0` (the
 * old UI offered it) or a negative value would put the deadline at or after
 * kickoff and reopen picks on a game in progress.
 */
export function normalizeLockBufferMinutes(raw: unknown): number {
  return (LOCK_BUFFER_PRESETS as readonly number[]).includes(raw as number)
    ? (raw as number)
    : DEFAULT_LOCK_BUFFER_MINUTES;
}

/**
 * A week's deadline may only ever move EARLIER.
 *
 * Without this, a commissioner could reopen a week they had already closed: set
 * the pool to a 60-minute buffer, let that deadline pass, then switch to 5
 * minutes — the recomputed lock lands 55 minutes later and picks are live again
 * on a week that was locked.
 *
 * (This used to add "settings are written straight to Firestore by the manager
 * UI, so this cannot be caught by validating the write." That stopped being
 * true at #279 — client-direct `settings` writes on NFL pools are denied by
 * `firestore.rules` and go through `updatePoolSettings`. The monotonic rule is
 * still the right answer, for a better reason: it holds for EVERY writer,
 * present and future, without each one having to remember. `updatePoolSettings`
 * does not freeze the week today — see the KNOWN RESIDUAL in
 * `functions/src/lib/effectiveLock.ts`.)
 *
 * So the server remembers the earliest deadline it has ever computed for the
 * week (`pool.hardLockByWeek.{week}`) and resolves against it. Tightening the
 * buffer still takes effect immediately — that only ever closes picks sooner,
 * which is safe.
 */
export function resolveHardWeekLock(frozenMs: number | undefined, computedMs: number): number {
  return typeof frozenMs === 'number' && Number.isFinite(frozenMs)
    ? Math.min(frozenMs, computedMs)
    : computedMs;
}

/**
 * Reads the frozen deadline off a pool doc. Shared so the client gates its pick
 * UI on the same instant the server enforces — otherwise a widened buffer shows
 * members an editable form for a week the server has already locked.
 *
 * Firestore map keys arrive as strings; week numbers are used as numbers
 * throughout the app, so both spellings are accepted.
 */
export function frozenHardLockFor(
  pool: { hardLockByWeek?: Record<string | number, unknown> } | undefined | null,
  week: number,
): number | undefined {
  const raw = pool?.hardLockByWeek?.[week] ?? pool?.hardLockByWeek?.[String(week)];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

/**
 * The buffer (in minutes) that reproduces this week's ACTUAL deadline, including
 * the freeze.
 *
 * Several client surfaces — the week checklist, the "picks due" CTA — are built
 * around a buffer rather than an absolute instant. Rather than re-plumb them,
 * this converts the effective deadline back into the equivalent buffer, so they
 * agree with enforcement without changing their signatures.
 */
export function effectiveBufferMinutesForWeek(
  pool: { type?: string; settings?: { lockBufferMinutes?: number }; hardLockByWeek?: Record<string | number, unknown> } | undefined | null,
  week: number,
  gameStartTimes: number[],
): number {
  const raw = pool?.settings?.lockBufferMinutes;
  if (!usesWeeklyHardLock(pool?.type)) return raw ?? DEFAULT_LOCK_BUFFER_MINUTES;

  const normalized = normalizeLockBufferMinutes(raw);
  if (gameStartTimes.length === 0) return normalized;

  const earliest = Math.min(...gameStartTimes);
  const computed = earliest - normalized * 60_000;
  const effective = resolveHardWeekLock(frozenHardLockFor(pool, week), computed);
  return (earliest - effective) / 60_000;
}
