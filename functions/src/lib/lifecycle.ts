/**
 * Pool lifecycle helpers (T2). Pure — no firebase-admin — so trigger guards and
 * their unit tests share one source of truth.
 *
 * closePool dual-writes the legacy fields non-admin screens read (isLocked,
 * isFinal, scores.gameStatus:'post') so a closed pool leaves "open"/"live" lists
 * everywhere. Those same fields are trigger-watched (onPoolLocked sends "Numbers
 * Set" emails + increments stats; onGameComplete sends the post-game email), so
 * both triggers early-return on the admin-close transition via
 * isAdminCloseTransition() — an admin close must produce zero member emails and
 * zero stats deltas.
 */

export const ADMIN_CLOSE = "ADMIN_CLOSE";

/** Terminal lifecycle states a pool can never transition out of. */
export const TERMINAL_STATUSES = ["CANCELED", "COMPLETED"] as const;

interface ClosableDoc {
  closedVia?: string;
  status?: string;
}

/**
 * True exactly on the update where an admin close is being applied (closedVia
 * becomes ADMIN_CLOSE). Used by side-effecting triggers to skip the wave of
 * member emails / stat increments that the dual-written legacy fields would
 * otherwise fire.
 */
export function isAdminCloseTransition(
  before: ClosableDoc | undefined | null,
  after: ClosableDoc | undefined | null
): boolean {
  return after?.closedVia === ADMIN_CLOSE && before?.closedVia !== ADMIN_CLOSE;
}

/** A pool already in a terminal state must not be re-closed or swept. */
export function isTerminalStatus(status: string | undefined | null): boolean {
  return !!status && (TERMINAL_STATUSES as readonly string[]).includes(status);
}

interface SweepableDoc extends ClosableDoc {
  isFinal?: boolean;
  scores?: { gameStatus?: string };
}

/**
 * The exact field set an admin close writes. Dual-writes the canonical status
 * AND the legacy fields non-admin screens read, plus closedVia:'ADMIN_CLOSE'
 * (the flag the triggers watch to stay silent). Shared by closePool and the
 * autoClosePools sweep so both close identically. Pure — dot-path keys.
 */
export function adminCloseUpdate(now: number): Record<string, unknown> {
  return {
    status: "COMPLETED",
    isLocked: true,
    isFinal: true,
    "scores.gameStatus": "post",
    closedVia: ADMIN_CLOSE,
    closedAt: now,
  };
}

/**
 * Conservative auto-close eligibility: the pool's event is over (game went to
 * 'post' or it is otherwise final) but it was never formally closed, and it is
 * not already terminal or admin-closed. The sweep runs dry-run first, so this
 * predicate only needs to be safe against closing an ACTIVE pool — an over
 * signal is required, never a mere date guess.
 */
export function isAutoCloseEligible(pool: SweepableDoc | undefined | null): boolean {
  if (!pool) return false;
  if (isTerminalStatus(pool.status)) return false;
  if (pool.closedVia === ADMIN_CLOSE) return false;
  const eventOver = pool.scores?.gameStatus === "post" || pool.isFinal === true;
  return eventOver;
}
