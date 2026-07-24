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
