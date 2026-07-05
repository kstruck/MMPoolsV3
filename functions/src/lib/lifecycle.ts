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
